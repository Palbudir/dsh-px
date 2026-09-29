# 发布流程

## 产品、版本与标签

Pack 与 Desktop 独立发布，版本来源分别为 [products.json](../config/products.json) 的 `pack.version` 与 `desktop.version`；根 `package.json` 的版本与 Desktop 一致，四个受管插件与 Pack 一致。

| 产品    | 标签              | 资产                                                 |
| ------- | ----------------- | ---------------------------------------------------- |
| Desktop | `desktop-v<版本>` | `DSH-PX-Desktop-<版本>-win-x64.exe`、`artifact.json` |
| Pack    | `pack-v<版本>`    | `dsh-px-pack-<版本>.tgz`、`artifact.json`            |

每个产品在自己的标签前缀内按 SemVer 完整预发布段严格递增；历史 `v*` 标签属于已退役的旧外壳，不参与比较。发布器拒绝任何 `v*` 标签：旧客户端的更新器会把这类标签当作自己的更新。版本的 `+` 在资产名中表示为 `_`。

所有新发布均为 GitHub prerelease 并设置 `make_latest: false`，首发通道为 preview。GitHub Latest 必须保持为 `v0.1.0-beta.re.0.11`：发布前后都会核对，不一致即停止。不上传任何 `*.yml` 更新索引或 `*.blockmap` 差分文件；更新只通过签名清单进行。不要改写已发布 tag 或删除历史资产。

发布提交必须在受保护主分支中，并有对应提交的质量检查与独立审查。新 push 使旧 SHA 的审查失效；审查失败、超时、缺失或未处理 P0/P1/P2 发现均阻止合并和发布。规则与执行器见 [GitHub 维护说明](github/README.md)。

## 发布前

1. 明确范围及正常、失败、并发、恢复和数据保留的验收条件。
2. 完成源码、锁文件、插件产物和用户文档；运行共享质量门禁 `node scripts/release-quality.mjs`。
3. 在隔离数据目录验证 Desktop 窗口和连接同一服务的浏览器。核对安装程序、Pack 与清单摘要，不能误用旧构建。
4. 覆盖常规任务、长任务、后台工作、重复操作、断连、关闭与安装边界；明确测试限制。
5. 独立 reviewer 检查当前提交。修复后重跑相关检查并重新审查。

## 可信构建

默认分支的 `release.yml` 只响应 workflow_dispatch，输入精确 SHA 与产品标签，权限为只读，不使用任何 secret：

- **Pack**：运行质量门禁，以 `--expect-head` 构建干净 release Pack，核对 `artifact.json` 与归档内清单。
- **Desktop**：在 `windows-2025` runner 上检出锁定的官方源码并核对提交，构建官方运行时，生成 PX 覆盖层与安装界面品牌，产出一个未签名的完整 NSIS 安装程序；拒绝 blockmap，记录 SHA-256/SHA-512 与 Authenticode 状态。若该镜像的编译器拒绝官方安装辅助库，改用 `windows-2022` 并重新审查 workflow。

构建产物只包含两个资产和 `release-manifest.json`，由 GitHub Actions artifact 保存 14 天。

## 发布

使用仓库外已审查的本机发布控制器：

```powershell
node (Join-Path $reviewWorker 'release-controller.mjs') --head=完整SHA --product=desktop --version=完整版本 --build-run=构建运行ID
```

默认只准备可检查的 `release-plan.json`。控制器核对受保护 master、专用 App check、签名、最新可信质量运行、同一产品标签的可信构建、版本顺序、GitHub Latest 与资产摘要，不执行候选提交中的发布脚本。完成验收并得到本次发版确认后加 `--publish`：先创建草稿并上传资产，复核远端摘要和门禁，再公开为 prerelease，最后确认 Latest 未变化。

公开后在本机离线签名更新清单：

```powershell
node scripts/run.mjs sign-release-manifest sign --product desktop --channel preview --file installer=<安装程序> --upgrade-from 2 --key <仓库外私钥> --out <desktop-preview.json>
node scripts/run.mjs sign-release-manifest sign --product pack --channel preview --file pack=<Pack 归档> --key <仓库外私钥> --out <pack-preview.json>
```

签名器从干净检出读取产品与宿主锁定，并用固定公钥复核结果。清单发布到 `updates` 分支；CI 从不接触私钥。发布说明只写用户可见变化、已知限制和升级影响，不放开发对话、临时路径、PID、原始日志或验收流水账。

## 安装后复核与回退

发布后通过正式更新通道升级，核对应用版本、Pack 版本与摘要，检查模型配置、历史会话、批注、定时配置和实际任务。手工替换插件或临时开发实例不能替代这一步。

若需撤回已发布实现，发布版本号更高的修复版本；不要改小版本号、移动 tag 或静默替换已下载资产。安装恢复与插件预装恢复是不同层次，不能仅恢复清单就宣称整个安装已回滚。
