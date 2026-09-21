# 发版流程

## 版本号：完整比较预发布段

继续使用 `0.1.0-beta.re.0.N`，但发版前必须用 SemVer 库验证顺序。
2026-09-22 核对规范和本地 semver 实现后，修正此前文档中的两处比较错误：

| 版本 | prerelease 段 | 与 `0.1.0-beta.8` 比较 |
|---|---|---|
| `0.1.0-beta-re.0.1` | `["beta-re", "0", "1"]` | **更大**：`beta-re` 按 ASCII 排序大于 `beta` |
| `0.1.0-beta.re.0.1` | `["beta", "re", "0", "1"]` | **更大**：非数字标识 `re` 大于数字标识 `8` |
| `0.1.0-beta.9` | `["beta", "9"]` | 更大：数字 `9 > 8` |

`beta-re.0.1` 本身不是“非法更新版本”。以前那次更新拒绝的具体原因不能由
错误的字典序推导证明，需结合实际 feed、通道和 updater 日志重新判断。
完整规则见 [SemVer 2.0.0](https://semver.org/#spec-item-11)。

插件现在也比较完整预发布段，不再把所有 `0.1.0-beta.*` 都判为相同版本。
`beta.re.0.10` 大于 `beta.re.0.9`；build metadata 不影响顺序。

推论（发版时逐条核对）：

- 改 `package.json` 的 `version` 之后，**必须**让新的版本号按上述规则严格大于线上最新版。
- git tag 是 `v` + `package.json` 的 version，两者必须一致（`release.yml` 靠 tag 触发）。
- 版本号的唯一真相源是 `package.json`：`runtime-manifest.json` 里的 `app.version`
  由装配时读取它写入（见 `scripts/stage-runtime.ts`）。

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
   → 校验安装包内容 → 公开 Release。构建资产先进入草稿，通过校验才公开为 Latest。

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


## 交付完成的判据

“本机可用”限定验收环境，不省略开发分支、PR、tag、Release 和更新流程。
发版之后要启动原安装目录的应用，检查并安装新版本；核对安装后的版本、manifest、自管插件与原配置/会话。
源码运行、临时端口上的开发实例、手工添加源码链接都只是开发验证，不能替代已安装版本更新。
