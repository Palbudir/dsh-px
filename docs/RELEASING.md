# 发版流程

## 版本号：一个必须知道的陷阱

**`0.1.0-beta-re.0.1` 是非法的更新版本号**，尽管它是合法的 semver。

semver 的 prerelease 段是**按点分段、逐段比较**的：数字段按数值比，字母段按字典序比，
且**段数少的更小**（`alpha` < `alpha.1`）。

| 版本 | prerelease 段 | 与 `beta.8` 比较 |
|---|---|---|
| `0.1.0-beta.8` | `["beta","8"]` | — |
| `0.1.0-beta-re.0.1` | `["beta-re","0","1"]` | **更小** —— `"beta-re" < "beta"`（字典序） |
| `0.1.0-beta.re.0.1` | `["beta","re","0","1"]` | **更大** —— 前两段相同，段数更多 |
| `0.1.0-beta.9` | `["beta","9"]` | 更大（`9 > 8`） |

后果很严重且**在界面上看不出来**：`electron-updater` 拒绝把更小的版本当作更新
（`Update for version X is not available (downgrade is disallowed)`），
已装上一版的用户**永远收不到这个版本** —— 只能重新下载安装包。

所以重构版发的是 **`0.1.0-beta.re.0.1`**（保留 `beta.re.0.1` 读法，但写成分段形式）。

推论（发版时逐条核对）：

- 改 `package.json` 的 `version` 之后，**必须**让新的版本号按上述规则严格大于线上最新版。
- git tag 是 `v` + `package.json` 的 version，两者必须一致（`release.yml` 靠 tag 触发）。
- 版本号的唯一真相源是 `package.json`：`runtime-manifest.json` 里的 `app.version`
  由装配时读取它写入（见 `scripts/stage-runtime.mjs`）。

## 发布一版的步骤

```sh
# 1. 在分支上改完，确认门禁与单元测试都过
npm run typecheck
npm run test

# 2. 装配运行时（CI 也会做，这里是为了本地先验一次）
npm run stage -- --with-plugins
npm run verify -- --boot      # 结构 + 能力平价 + 真实启动

# 3. 清理种子树
#    注意：verify --boot 会真的启动 harness，从而在种子树里生成 dsh 的运行时产物
#    （实测 dsh-home 从 308 MB 涨到 924 MB）。打包前必须再清一次，
#    否则这些纯冗余会被 extraResources 原样打进安装包 —— beta.0 就是这样胖了约 830 MB。
#    这一步同时会裁掉 *.map 与 tests/（见 docs/PACKAGING.md 约束 10）。
npm run prune

# 4. 本地完整打包 + 校验安装包内容（可选但推荐；CI 上一定会做）
npm run dist
```

然后：

1. 把分支推上去，开 PR 合入 `master`（`master` 有分支保护，见 `docs/github/README.md`）。
2. 在 `master` 上打 tag 并推送：`git tag v0.1.0-beta.re.0.1 && git push origin v0.1.0-beta.re.0.1`。
3. `release.yml` 自动触发：装配 → 验证 → 裁剪 → 图标 → `electron-builder --win --publish always`
   → 校验安装包内容。全部通过后资产出现在 GitHub Releases。

## 发布资产必须齐三样

`electron-updater` 缺任意一样都会出问题：

| 资产 | 作用 | 缺了会怎样 |
|---|---|---|
| `DSH-PX-Setup-<版本>.exe` | 安装包本体 | 无法安装 |
| `latest.yml` | 版本清单 | 检查更新直接失败 |
| `*.exe.blockmap` | 差分块索引 | **静默退化为每次全量下载** —— 界面上完全看不出来 |

这就是 `release.yml` 用 `--publish always` 而不是 `--publish never` 的原因。

差分下载实测有效：beta.7 → beta.8 时安装包全量 232.4 MB，
用户机器实际只下载 **2.5 MB**（省 98.9%），日志里有真实的
`download range: bytes=…` 区间请求。见 `docs/PACKAGING.md`「增量更新实测」。

## 回滚

`electron-updater` 不会自动降级。要回滚一版，必须发一个**版本号更大**的新版本
（例如在末尾加 `.1`），不能把版本号改小 —— 那对已升级的用户是不可见的。
