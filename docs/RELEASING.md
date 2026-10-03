# 发布流程

## 产品、版本与标签

Pack 与 Desktop 独立发布，版本来源分别为 [products.json](../config/products.json) 的 `pack.version` 与 `desktop.version`；根 `package.json` 的版本与 Desktop 一致，四个受管插件与 Pack 一致。

| 产品    | 标签              | 资产                                                 |
| ------- | ----------------- | ---------------------------------------------------- |
| Desktop | `desktop-v<版本>` | `DSH-PX-Desktop-<版本>-win-x64.exe`、`artifact.json` |
| Pack    | `pack-v<版本>`    | `dsh-px-pack-<版本>.tgz`、`artifact.json`            |

每个产品在自己的标签前缀内按 SemVer 完整预发布段严格递增；历史 `v*` 标签属于已退役的旧外壳，不参与比较。不要使用任何 `v*` 标签：旧客户端的更新器会把这类标签当作自己的更新。版本的 `+` 在资产名中表示为 `_`。

所有新发布均为 GitHub prerelease 并设置 `make_latest: false`，首发通道为 preview。GitHub Latest 必须保持为 `v0.1.0-beta.re.0.11`：发布前后都会核对，不一致即停止。不上传任何 `*.yml` 更新索引或 `*.blockmap` 差分文件；更新只通过签名清单进行。不要改写已发布 tag 或删除历史资产。

发布提交必须是受保护主分支的当前提交，通过普通 CI，并完成独立 DeepSeek Flash 审查。审查针对当前 PR 增量；改动后复核受影响部分，记录最终 SHA。确认的使用缺陷须修复，纯维护建议另行排期。当前流程不要求旧专用 App 的检查或证明，见 [GitHub 维护说明](github/README.md)。

## 发布前

1. 明确范围及正常、失败、并发、恢复和数据保留的验收条件。
2. 完成源码、锁文件、插件产物和用户文档；运行共享质量门禁 `node scripts/release-quality.mjs`。
3. 在隔离数据目录验证 Desktop 窗口和连接同一服务的浏览器。核对安装程序、Pack 与清单摘要，不能误用旧构建。
4. 按本次改动选择关键使用、失败恢复和升级保留场景；已有有效证据不重复跑，明确测试限制。
5. 独立 DS Flash reviewer 检查当前提交；修复后只复核相关增量。

## 可信构建

默认分支的 `release.yml` 只响应 workflow_dispatch，输入精确 SHA 与产品标签，权限为只读，不使用任何 secret：

- **Pack**：运行质量门禁，以 `--expect-head` 构建干净 release Pack，核对 `artifact.json` 与归档内清单。
- **Desktop**：在 `windows-2025` runner 上检出锁定的官方源码并核对提交，构建官方运行时，生成 PX 覆盖层与安装界面品牌，产出一个未签名的完整 NSIS 安装程序；拒绝 blockmap，记录 SHA-256/SHA-512 与 Authenticode 状态。若该镜像的编译器拒绝官方安装辅助库，改用 `windows-2022` 并重新审查 workflow。

构建产物只包含两个资产和 `release-manifest.json`，由 GitHub Actions artifact 保存 14 天。

## 发布

使用维护者现有 GitHub 身份和常规 Release 流程，不再调用旧专用发布控制器。

维护工具、注释与文档的清理不改变产品版本，也不重发同版本资产。只有需要交付产品行为或安装更新变化时，才提升对应版本并执行下面的产品发布流程。

1. 核对当前主分支 SHA、普通 CI、独立审查结论与本机验收。构建运行必须来自该 SHA 的 `release.yml`，run-name 对应同一产品标签。
2. 下载该运行的 Actions artifact；检查其中 `release-manifest.json` 的来源 SHA、产品、版本、文件名、大小和 SHA-256，并核对主资产 `artifact.json` 的 SHA-256/SHA-512。不要用本地候选包代替正式构建。
3. 使用精确 SHA 创建产品 tag 和 draft Release；只上传主资产及 `artifact.json`，核对远端摘要。历史 tag 和资产不得改写，版本必须在自己的产品前缀内递增。
4. 最终安装验收通过后，公开为 prerelease，明确 `make_latest: false`；核对 GitHub Latest 仍为旧客户端版本。可用 `gh release` 或 GitHub API 完成这些常规操作。

公开后在本机离线签名更新清单：

```powershell
node scripts/run.mjs sign-release-manifest sign --product desktop --channel preview --file installer=<安装程序> --artifact <该构建的 artifact.json> --upgrade-from 2 --key <仓库外私钥> --out <desktop-preview.json>
node scripts/run.mjs sign-release-manifest sign --product pack --channel preview --file pack=<Pack 归档> --artifact <该构建的 artifact.json> --key <仓库外私钥> --out <pack-preview.json>
```

签名器从干净检出读取产品与宿主锁定，要求检出提交等于 `artifact.json` 的 `sourceCommit`、本地文件的名称、大小与两种摘要都与 `artifact.json` 一致，并用固定公钥复核结果。清单发布到 `updates` 分支；CI 从不接触私钥。发布说明只写用户可见变化、已知限制和升级影响，不放开发对话、临时路径、PID、原始日志或验收流水账。

## 安装后复核与回退

发布后通过正式更新通道升级，核对应用版本、Pack 版本与摘要，检查模型配置、历史会话、批注、定时配置和实际任务。手工替换插件或临时开发实例不能替代这一步。

若需撤回已发布实现，发布版本号更高的修复版本；不要改小版本号、移动 tag 或静默替换已下载资产。安装恢复与插件预装恢复是不同层次，不能仅恢复清单就宣称整个安装已回滚。
