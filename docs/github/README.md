# 仓库治理与发布门禁

本目录保存期望配置。`reviewAppId: 0`、`workflowId: 0`、`UNCONFIGURED` 和空公钥表示尚未启用，必须阻止门禁放行及发布，不能当成通过记录。线上配置需另行核对。

## 专用 GitHub App 的权限

[app-manifest.json](app-manifest.json) 是需要明确授权的注册清单：私有 App，只选择 `Palbudir/dsh-px` 安装，关闭 webhook 与安装时 OAuth。

| 权限          | 级别  | 用途                                            |
| ------------- | ----- | ----------------------------------------------- |
| Contents      | read  | 核对目标提交、受保护主分支和可信控制器源码      |
| Pull requests | read  | 核对当前 PR 的 head/base；拒绝自动处理外部 fork |
| Actions       | read  | 核对可信 workflow 的真实运行与构建产物          |
| Checks        | write | 发布两个必需检查                                |

App 没有代码、tag 或 Release 的写权限。RSA 私钥只存本机可信目录的 `github-app.pem`，不进入仓库、日志或 Actions secrets。安装 token 被进一步限制为这个仓库及上述权限，并只存在于本机进程内存。[GitHub App manifest](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)、[安装 token 权限](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)

## 身份与检查

必需检查为 `dsh-px/independent-review` 和 `dsh-px/quality`，都必须来自专用 App ID。同仓分支创建的同名 GitHub Actions job 无法满足这个身份条件。不要填通用 GitHub Actions App ID `15368`。

1. `review-request.yml` 在所有分支 push 和 PR 变更时只记录元数据，不检出 PR 代码。请求按 run ID/attempt 定位。
2. 本机可信 worker 从精确 head、base 与 merge-base 的 Git 对象收集变更、必要本地依赖、更新消费者和策略显式引用的源码，保留文件名原始空白和 UTF-8 内容。越界、必要依赖缺失或超预算会阻断；大文本分批完整审阅，不截断后放行。每批是一次独立的 DeepSeek Chat Completions 请求（默认模型 `deepseek-flash`，开启 thinking 模式、JSON Output），请求不携带任何工具定义，模型只能返回文本；响应中出现工具调用、截断或非 JSON 内容都判为失败。
3. worker 用 Node 内置 `fetch` 直接调用 `https://` 模型端点，零第三方依赖；设置 `HTTPS_PROXY` 时使用 Node 内置的环境代理支持。API key 只从安装时指定名称的环境变量读取（默认 `DEEPSEEK_API_KEY`），安装配置只记录变量名；key 不写入配置、日志、trace、证明或 GitHub 输出，变量缺失时 worker 启动即失败。每批响应必须严格符合审查 JSON Schema，并逐字回填本次 head/base/batchId，否则失败关闭。429、5xx 和网络错误在总超时内做有限次指数退避重试，其他 4xx 直接失败。
4. 本地 Ed25519 证明绑定 repository、head、base、tree、批次、源码与上下文摘要、模型身份（provider、model、baseUrl 及其摘要）、worker 摘要和时间。全部批次通过且无 P0/P1/P2 或源码审查阻塞项，才能通过。这里的通过只指静态源码审查，CI 和目标环境实际运行验收仍是独立必需门禁；一般未附运行结果不自动构成源码缺陷，但具体缺陷、必要源码缺失或无法确认的关键假设仍须阻断并说明原因。
5. App 核对证明后发布独立审查 check。维护者已有 gh 登录触发默认分支的只读 `trusted-quality.yml`。
6. App 核对质量运行的 `workflow_id`、路径、事件、controller SHA、源码白名单摘要，以及 run-name 绑定的目标 SHA。通过后才发布 `dsh-px/quality`。

新 SHA 需要新证据。缺失或离线保持等待，失败不能通过。同 head/base/worker/模型配置的已签名通过结果可去重。CI 的新 attempt 重新结算；状态不变时不重复发布 check，新请求优先处理。SQLite 锁在进程退出时自动释放。

本项目采用单维护者流程：每次 push 前先由本机独立 reviewer 复核当前提交 SHA（包含 workflow 修改），保留对应结论。Fork PR 需维护者先审查来源并导入本仓库分支。

专用 App 约束合并检查来源，本机控制器约束规定的正式发布流程。GitHub 默认 workflow 权限为 read 并不是权限上限；持有仓库 write/admin 权限的维护者仍能另写高权限 workflow、修改规则或直接改 Release。本机制不声称防御维护者故意违反前置审查和发布流程。

## 本机配置

先完成实现的独立复核，取得本次 App 创建和安装权限授权。注册清单不执行安装；下面的安装器也不会创建 App 或修改 GitHub 设置。

```powershell
$reviewWorker = Join-Path $env:LOCALAPPDATA 'DSH-PX-review-worker'
node scripts/review-install.mjs "--directory=$reviewWorker"
```

安装器复制已审查的 `review-*.mjs`、`release-*.mjs`，以及经过锁定来源和摘要校验的独立解析器、许可证与来源记录，再记录完整摘要并生成本地签名密钥。解析器只在使用时校验后加载，不从候选检出加载依赖。目录必须在仓库外，`..name` 前缀的仓库子目录也会被拒绝。重新安装保留既有身份配置；程序或模型配置变化需要重新验证。模型参数为 `--model=`（默认 `deepseek-flash`）、`--base-url=`（默认 `https://api.deepseek.com`，只接受 https）和 `--api-key-env=`（默认 `DEEPSEEK_API_KEY`）。运行 worker 前在当前用户的环境变量中设置该变量，勿写入仓库或可信目录。

用户授权并创建私有 App 后：

1. 仅选择 dsh-px 安装，将 GitHub PEM 安全保存到可信目录，勿显示密钥内容。
2. 读取 App ID、installation ID、repository ID；默认分支两个可信 workflow 注册后读取 workflow ID。
3. 再执行安装器，填写 `--app-id=... --installation-id=... --repository-id=... --quality-workflow-id=... --build-workflow-id=...`。`--app-private-key=绝对路径` 可导入 PEM；`--seven-zip=绝对路径` 可指定本机 7-Zip。
4. 检查生成的 `public-policy.json`，经审查提交公共配置到 `review-policy.json`，并同步 `protection.json` 中两个必需检查的 `app_id`。通过在线验收后再应用保护规则。

```powershell
node scripts/review-smoke.mjs
npm test
node (Join-Path $reviewWorker 'review-worker.mjs') --publish
```

`review-smoke` 通过同一模型接口执行正常/缺陷两个样例（会产生 API 计费），不调用 GitHub 写接口；可用同名参数指定模型、端点和 key 变量名。worker 默认不发布 check，`--publish` 才调用已授权 App。每次默认处理一个请求，`DSH_PX_REVIEW_MAX_JOBS` 可调整数量；`--rerun=运行ID --publish` 重审仍然有效的请求。已删除、被替代或已合并的旧 push 请求以及已关闭 PR 的请求退出队列，保留历史但不生成新的审查结论。重新打开 PR 会产生新请求；未知状态或读取失败保持等待与重试。

公开检查不包含本机异常详情或未经完整验证的证明。私有原因保存在可信目录的 `queue-state.json` 和 `jobs/<runId>-<attempt>/publication-status.json`，后者区分源码审查结论与检查发布阶段；恢复后清理当前错误状态，不改写已签名的源码结论。

通过验证的原始请求另存于同一任务目录的 `request-identity.json`，已有监控不依赖 Actions 附件的保留期。读取时仍校验仓库、运行及 attempt 等身份，并重新检查当前 PR 或分支；动态 base 不覆盖原始请求。旧监控没有这份记录时，可从尚未过期的原附件补建；缺少有效身份会记录本机诊断，并通过验证失败或检查缺失保持门禁阻断。恢复需要有效的新请求或可验证的原附件，不能把缺失或损坏的身份当作通过。

常驻运行使用同一可信目录中的循环入口，可通过当前用户的登录启动项以隐藏窗口启动：

```powershell
node (Join-Path $reviewWorker 'review-loop.mjs') --publish
# 单轮在线验收
node (Join-Path $reviewWorker 'review-loop.mjs') --publish --once
# 在另一个终端请求停止，等待当前 worker 完成
node (Join-Path $reviewWorker 'review-loop.mjs') --stop
```

循环顺序执行 worker，每轮结束后等待两分钟；独立锁防止重复启动。状态在 `review-loop-state.json`，本轮 worker 日志在 `worker-latest.log`。

停止命令仅在收到匹配 `requestId` 和 `instanceId` 的持锁实例回执后返回 `requested: true`，这表示该实例已接收请求，当前 worker 仍会正常完成。启动间隙、实例更换、并发请求覆盖或超时可能返回“未确认”，应查看状态后重试；仅写入请求不算送达。确认回执对应实例已为 `stopped` 且没有新实例运行后，再重新安装或修改配置。脚本、配置或策略变化会在校验时停止循环，核对后重新启动；不会中止已经运行的 worker。电脑离线、睡眠或未登录时，未完成检查继续阻止合并。

## 只读构建与本机发布

`release.yml` 仅响应明确的 workflow_dispatch，输入精确 SHA 与产品标签（`desktop-v<版本>` 或 `pack-v<版本>`），从受保护 master 加载可信控制器。它不响应 tag 自动公开，不持有发布写权限，也不读取 secret。run-name 同时绑定 SHA 与产品标签，一次运行只证明一个产品。Pack job 构建干净 release Pack；Desktop job 在 `windows-2025` 上从锁定官方源码构建未签名 NSIS 安装程序。构建产物只有主资产、`artifact.json` 与 `release-manifest.json`。

资产使用不含空格的规范名称，版本中的 `+` 编码为 `_`。任何 `*.yml` 更新索引和 `*.blockmap` 差分文件都不会进入构建产物或 Release。

最终发布由仓库外的本机 `release-controller.mjs` 使用维护者原有 gh 身份执行。它核对当前受保护 master、专用 App check、签名、最新可信质量运行、同一产品标签的可信构建、产品内版本顺序、GitHub Latest 仍为旧外壳版本，以及下载和上传摘要；不执行 tag 或候选提交中的发布脚本。所有发布均为 prerelease，`make_latest` 为 false。

```powershell
node (Join-Path $reviewWorker 'release-controller.mjs') --head=完整SHA --product=desktop --version=完整版本 --build-run=构建运行ID
```

默认只准备可检查的 `release-plan.json`，不创建 tag 或 Release。公开说明放在可信目录 `releases/<产品标签>/notes.md`。完成原生窗口/Web/数据保留验收并得到本次发版确认后，使用同一参数加 `--publish`：先创建草稿资产，复核远端摘要及门禁后才公开。发布过程持有本机排他锁；已发布 tag/资产不重写。失败留下草稿时保留现场，核对后重试。

构建资产下载最多等待 30 分钟。后续运行只复用大小和 SHA-256 均符合 GitHub 当前元数据的完整归档；部分或损坏文件会重新下载，失败文件保留用于诊断。复用缓存不会跳过每次运行的发布门禁。

## 首次启用与在线验收

默认分支尚无可信 workflow 时，先完成独立 agent review、本机正常/故障测试及普通 CI，引入已审查的控制器。随后在用户授权的 App 下验证真实 check 来源，最后启用必需检查。初始化过程不能伪造通过记录。

发布前必须在线确认：同名 Actions job 不能放行；新 SHA、旧证明、错误 workflow/controller、worker 离线/失败、模型接口失败或输出不符和 CI rerun 均能阻断或正确恢复。

```powershell
gh api repos/Palbudir/dsh-px/branches/master/protection
gh api repos/Palbudir/dsh-px/commits/master/check-runs
gh api -X PUT repos/Palbudir/dsh-px/branches/master/protection --input docs/github/protection.json
```

`ruleset.json` 只负责禁止删除和非快进，`security.json` 保存密钥扫描的期望设置。更新规则集前先查现有 ID，避免重复创建。只有在线验收结果可以写成“已生效”。

模型接口依据：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion)、[JSON Output](https://api-docs.deepseek.com/guides/json_mode)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)。检查来源配置：[GitHub 分支保护](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection)。
