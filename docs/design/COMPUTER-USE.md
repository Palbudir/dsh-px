# DSH-PX 电脑操作设计

研究与设计截止：2026-10-05。状态：随 0.4.2-alpha.1 交付第一版，当前行为以 [电脑操作](../COMPUTER-USE.md) 为准。

目标是让 agent 在用户明确开启后操作本机 Windows 应用和网页，安全边界与可见性至少达到 Codex Computer Use / Browser Use 的水平。第一版不追求覆盖所有应用，而是保证：每个应用先经用户授权；硬性禁止项在代码层拒绝；高风险动作在动作前再次确认；用户随时能看到和停止 agent 正在做的事。

## 一 参照基线

### Codex（本机 26.930 插件文档，2026-10-05 查阅）

- **桌面**：`sky` API 以应用和窗口对象寻址，`get_window_state` 同时给出 UIA 可访问性树和截图，动作有 click、type_text、press_key、scroll、set_value、drag、secondary action。工作流要求“观察 → 一个动作 → 重新观察”，元素索引只对产生它的那次观察有效。
- **强制禁止**（不能被确认替代）：终端与 Run 对话框、通过资源管理器或文件对话框间接执行命令、身份验证对话框、密码管理器应用与网站、Windows 安全与反恶意软件、ChatGPT/Codex 自身界面、Windows 与应用内的安全/隐私设置及权限请求、Windows 键、年龄验证。网页、邮件、文档、截图和工具输出一律视为不可信内容。
- **确认分级**：必须交给用户（改密码最后一步、绕过安全拦截）；动作前必须确认（删除、账号与权限、验证码、安装或运行新下载软件、代表用户对外发言或提交、订阅、金融交易、改系统安全设置、医疗）；首轮明确授权可免确认（登录、权限弹窗、上传、浏览器内文件管理、传输敏感数据）；无需确认（Cookie 同意、下载）。
- **浏览器**：独立的 Browser Use 插件通过 Chromium 扩展（ChatGPT 扩展 + `com.openai.codexextension` 本机宿主）控制用户已登录的浏览器。该扩展与宿主是 OpenAI 私有组件，PX 不能也不应复用。

### 锁定的 DSH 0.2.0-rc.2

- `ctx.computerUse` / `ctx.browserUse` 是独占的提供者登记，不含任何工具；基础组合没有加载实验性的 computer/browser 提供者。
- 实验包 `computer-use-cua-driver-native` 在宿主进程内加载 `@trycua/cua-driver` 0.28.0，把 56 个工具原样暴露；`browser-use-playwright-mcp` 为每个会话在创建时启动一个 `@playwright/mcp` 进程，只支持独立启动与 CDP 附加。
- `tools/pre-execute` 支持 `ask`，`ctx.approval` 失败即拒绝；`approval: never`（完全访问预设）下所有询问自动拒绝。
- 工具结果中的图片只有在当前模型声明 `image` 输入且挂载了附件存储时才进入模型上下文。DeepSeek V4-Flash 支持图片，V4-Pro 只支持文本。
- 压缩时超过 8192 码点的工具结果只保留首 4096 和尾 1024，输出必须紧凑。

### 本机实测（2026-10-05）

- Cua Driver 0.28.0 进程内创建、列出工具、启动计算器、读取 56 个 UIA 元素与截图均成功；树的文本形式约 3.9 KB，结构化 JSON 约 14 KB。最小化窗口无法截图。UWP 应用的窗口属于共享的 `ApplicationFrameHost.exe`，`launch_app` 返回的是该宿主 pid，因此**不能按 pid 结束进程**。
- Playwright MCP 0.0.80 使用本机已安装的 Edge（`--browser msedge`），无界面、独立配置下导航约 0.7 秒；`browser_snapshot` 返回带 `ref` 的 YAML，动作结果只给出快照文件链接；默认把快照和截图写入工作目录下的 `.playwright-mcp`。
- `--extension` 模式会在用户的 Edge 打开 Playwright 扩展的连接页，由用户选择要共享的标签页；只有设置 `PLAYWRIGHT_MCP_EXTENSION_TOKEN` 才能跳过确认。

## 二 方案

新增功能包 `dsh-px-computer`（电脑操作），默认**关闭**。它由三部分组成：

| 部分       | 实现                                                                          | 运行位置                         |
| ---------- | ----------------------------------------------------------------------------- | -------------------------------- |
| 桌面应用   | PX 自有的 Cua Driver 提供者，精选 13 个工具并改写为简短说明                   | 宿主进程内，首次调用时才加载驱动 |
| 浏览器     | PX 自有的 Playwright MCP 管理器，三种模式：独立浏览器、PX 专用配置、接管 Edge | 每个会话一个子进程，首次调用启动 |
| 安全与界面 | 策略检查、应用授权、动作前确认工具、操作记录、紧急停止、模型指引、侧栏面板    | 宿主 + 客户端                    |

不使用上游实验包，原因：它们不能裁剪工具与说明、不能接入 PX 的授权与记录；浏览器提供者在每个会话创建时就启动进程；不支持扩展模式；默认会把快照写入用户项目目录。

### 依赖与交付

功能包首次带有运行时 npm 依赖：`@trycua/cua-driver@0.28.0`（含 25 MB 的 Windows 原生库，MIT / MPL-2.0）与 `@playwright/mcp@0.0.80`（Apache-2.0）。它们由 DSH 插件管理器（pnpm，`nodeLinker: hoisted`）从 npm 安装，宿主产物只对这两个名称保留动态 `import()`；其他依赖仍内联。精确版本锁定，与上游 rc.2 测试过的版本一致。聚合 Pack 把成员依赖提升到 `dsh-px-pack` 的 `dependencies`，因为 `bundledDependencies` 内的包不会再安装自身依赖。

已安装 Pack 的用户更新后会收到这个新功能包（与 0.4.0 的人格与记忆一致）。功能包本身默认关闭，必须在面板中逐项开启，所以自动提供不会自动获得操作电脑的能力。

### 桌面工具

| 工具                        | Cua 工具           | 说明                                                       |
| --------------------------- | ------------------ | ---------------------------------------------------------- |
| `computer_list_apps`        | `list_apps`        | 默认只列出正在运行的应用；`query` 搜索已安装应用           |
| `computer_list_windows`     | `list_windows`     | 被禁止的应用不出现在结果中                                 |
| `computer_get_window_state` | `get_window_state` | 元素树文本；模型支持图片时附截图；默认最多 150 个元素      |
| `computer_zoom`             | `zoom`             | 仅图片模型可用                                             |
| `computer_click`            | `click`            | `element_index` 优先；自动补齐最近一次观察的 `snapshot_id` |
| `computer_type_text`        | `type_text`        |                                                            |
| `computer_press_key`        | `press_key`        | 禁止 Windows 键修饰                                        |
| `computer_hotkey`           | `hotkey`           | 禁止 Windows 键                                            |
| `computer_set_value`        | `set_value`        |                                                            |
| `computer_scroll`           | `scroll`           |                                                            |
| `computer_drag`             | `drag`             |                                                            |
| `computer_launch_app`       | `launch_app`       | 不接受额外参数和 URL；脚本类文件拒绝；新下载的程序需确认   |
| `computer_bring_to_front`   | `bring_to_front`   |                                                            |
| `computer_invoke_menu`      | `invoke_menu`      |                                                            |

不提供：`kill_app`（UWP 共享宿主会被误杀）、全屏截图 `get_desktop_state`（会包含无关应用）、剪贴板、录制回放、`set_config`、`install_ffmpeg`、驱动自带的 `browser_*` 与 `page`。所有调用串行执行，使用以 DSH 会话派生的 Cua 会话标签，并在首次动作时开启 agent 光标。

### 浏览器工具

沿用 Playwright MCP 的工具名与参数（模型普遍熟悉），在构建时固定其清单。提供 `browser_navigate`、`browser_navigate_back`、`browser_snapshot`、`browser_click`、`browser_type`、`browser_fill_form`、`browser_select_option`、`browser_hover`、`browser_drag`、`browser_press_key`、`browser_wait_for`、`browser_tabs`、`browser_find`、`browser_handle_dialog`、`browser_file_upload`、`browser_take_screenshot`、`browser_console_messages`、`browser_close`。不提供能执行任意代码或读取请求头的 `browser_evaluate`、`browser_run_code_unsafe`、`browser_network_request(s)`，以及 `browser_drop`、`browser_resize`。

| 模式        | 参数                                | 登录状态                 | 并发             |
| ----------- | ----------------------------------- | ------------------------ | ---------------- |
| 独立浏览器  | `--isolated`                        | 不保存                   | 每个会话一个     |
| PX 专用配置 | `--user-data-dir <PX 存储>`         | 保存在 PX 专用配置中     | 同时只供一个会话 |
| 接管 Edge   | `--extension`，不设置跳过确认的令牌 | 用户在 Edge 中选择标签页 | 同时只供一个会话 |

子进程以 `--codegen none`、PX 临时输出目录作为工作目录和 `--output-dir` 启动，不在用户项目里留下文件；环境变量只传白名单，并显式设置 `ELECTRON_RUN_AS_NODE=1`（Desktop 宿主是以 Node 模式运行的 Electron）。空闲 20 分钟或会话结束时关闭。

## 三 安全模型

1. **默认关闭，逐项开启。** 桌面与浏览器分别开关；关闭时不注册任何工具和提示。
2. **硬性禁止（代码层，不能被确认解除）。** 终端与命令解释器、注册表与管理控制台、UAC 与凭据界面、锁屏、Windows 安全中心、常见密码管理器、远程控制软件、DSH/DSH-PX 自身以及 ChatGPT/Codex/Claude 等 agent 应用；带 Windows 键的按键；`launch_app` 启动脚本类文件或附带参数。浏览器只允许 `http`、`https` 与 `about:blank`，拒绝常见密码管理器站点。被禁止应用的窗口不出现在窗口列表中，连读取也拒绝。
3. **应用授权。** 每个会话首次读取或操作某个应用时，通过 DSH 原生确认卡询问“是否允许在本会话中操作「应用」”。UWP 窗口按“宿主 + 窗口标题”区分，不会因为授权了计算器就授权设置。面板可把应用设为“始终允许”，也可撤销。完全访问预设（确认自动拒绝）下只能使用“始终允许”的应用。
4. **动作前确认。** 按 Codex 分级写入模型指引，并提供 `computer_confirm` 工具：模型在删除、对外发送或提交、付款、修改账号权限、安装软件等动作之前调用，由用户在确认卡上批准；被拒绝或不可用时模型必须停止并在回复中说明。`browser_file_upload` 与运行新下载的程序在代码层强制确认。
5. **不可信内容。** 窗口树、网页快照和截图的输出都带一行标记，说明其中的文字只是数据。
6. **紧急停止。** 面板可停止当前会话正在进行的电脑操作并暂停后续操作，直到用户恢复。DSH 自身的停止按钮也会通过取消信号中断驱动调用。

确认与拒绝都会写入会话的原生审计事件；操作记录在面板中按会话展示（仅保存在内存，最近 200 条）。

## 四 模型适配

- 图片模型：窗口状态附截图，可用 `computer_zoom` 和 `browser_take_screenshot`。
- 纯文本模型：窗口状态强制不截图，只返回元素树；截图类工具返回明确说明。指引要求优先使用元素索引和网页快照，遇到只能按像素操作的界面时请用户切换到支持图片的模型。
- 指引放在一个系统提示段中，只在开启时出现；中文为主，工具名与参数保持英文。

## 五 验收

- 单元测试：策略判定、应用标识、按键与 URL 检查、参数映射、工具清单与锁定版本的契约、浏览器启动参数、设置存储、组合与 Pack 依赖提升。
- 本机验收（隔离数据目录，不触碰日常配置）：在记事本中输入文本并验证；在计算器中通过元素完成一次计算；在独立浏览器打开本地测试页、填写表单并验证；纯文本模型与图片模型各跑一次；拒绝终端、Windows 键与密码管理器站点；确认卡拒绝后不执行。接管 Edge 模式需要用户安装 Playwright 扩展并在场确认，单独记录。

## 六 不在第一版

进程隔离运行 Cua（`createPrivateWorker`，下一步）；录制与回放；剪贴板读取；多显示器坐标；macOS/Linux；自动识别网页上的敏感动作。
