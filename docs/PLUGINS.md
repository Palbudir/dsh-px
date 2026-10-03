# 插件目录与扩展合约

[config/plugins.json](../config/plugins.json) 记录自制插件与待迁移的社区插件。自制插件共同跟随 [Pack 版本](../config/products.json)，与 Desktop 版本分别校验。原生宿主版本、依赖与 peer 只由 [native-pack.json](../config/native-pack.json) 声明。版本与入口边界见 [Pack 与 Desktop](EDITIONS.md)。

## 能力所有者

| 插件               | 功能                                     | 必需或可降级的依赖                                           |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| dsh-px-updater     | Pack 版本、签名 Pack 更新清单检查与提示  | HTTP 服务；检查需要网络。不控制 Desktop 更新，不自动安装     |
| dsh-px-workbench   | 运行诊断、工作区入口、布局存储、活动快照 | 活动判断依赖 Agent、任务与终端合约；其它操作依赖对应原生服务 |
| dsh-px-taskflow    | 执行记录、按需证据、可选工作摘要         | 原生会话日志与侧栏注册服务，Agent 工具不依赖侧栏             |
| dsh-px-workspace   | 工作工具栏、会话内容索引与共享存储       | 原生会话、输入与 HTTP 服务；保留旧数据格式和接口路径         |
| dsh-px-artifacts   | 会话产物列表与预览入口                   | workspace 与原生侧栏／文件面板                               |
| dsh-px-annotations | 内容引用、批注与草稿插入                 | workspace 与原生输入、侧栏服务                               |
| dsh-px-schedules   | 定时任务配置与调度启停                   | workspace 与原生会话输入服务；停用会停止新的调度             |
| dsh-better-sidebar | 文件、编辑器、终端、文件变动与任务视图   | 原生终端及对应工具依赖；随 Pack 提供已认证补丁的固定版本     |

“已安装”“已加入组合包”和“实际服务已激活”是不同状态。在“运行与帮助”检查实际依赖。禁用 betterSidebar 会影响由它提供的文件变动等面板；PX 的产物、批注、定时任务和执行记录使用原生侧栏注册，官方会话侧栏仍可使用。

## 待迁移的社区插件

旧外壳随附的 dshmarket、dsh-mermaid-render 与 dsh-find-plugin 首发不进入 Pack，列于 `deferredCommunity`。它们需要逐个核对原生 0.2 宿主接口、来源与许可后再加入；在此之前可以通过官方插件管理器自行安装，PX 不对其兼容性作出声明。

## 代码结构

- `packages/<name>/src/index.ts`：宿主入口与 API。
- `packages/<name>/src/client.tsx`：客户端注册入口；复杂页面放入 `src/client/`。
- `packages/shared/`：构建时内联的主题、请求、状态和合约工具，不是额外运行时插件。
- `packages/<name>/lib/`：随包交付的预构建产物，由构建器生成并入库。
- `scripts/plugins/`：统一插件构建工具；`scripts/build-native-pack.ts` 组装原生 Pack。

## 集成约束

1. React 由 DSH 宿主提供；客户端不引入 Node 模块或另一份 React。
2. 宿主产物只保留 Node 内置导入；共享实现构建时内联。
3. 服务通过 Cordis 注入获取，并随生命周期释放。可选依赖缺失时显示降级说明，不能让整组能力静默消失。
4. 宿主不存在的能力诚实降级。本代际没有 PX 外壳桥：插件不提供重启、停机或安装操作，也不报告宿主进程状态。
5. UI 优先使用公开插槽与服务。宿主 DOM 兼容代码集中于适配层，变更核心版本时必须单独回归。
6. 输入事件显式携带目标会话上下文。请求取消、任务所有者和结果来源不可省略。
7. 插件 HTTP API 通过原生 Connection 验证宿主登录会话，并保留 Host、Origin、Fetch Metadata 和写操作标记检查。
8. 会话正文仍由 DSH 管理。插件仅保存自身业务状态，恢复不自动重复执行有副作用的工作。
9. 日志仅保存必要诊断；不提交凭据、用户对话、整份设置或本机运行数据。

修改第三方依赖时核对来源、许可、公开合约及原生模块兼容性。不要手改安装目录中的副本作为正式修复。组合包成员变化后需重启服务；用户自定义声明与明确禁用项在升级时保留。

## 侧栏认证补丁

随附的 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 0.24.1 使用其 MIT 许可。其 HTTP 接口原本只做本机来源检查；构建器对固定 SRI 的原始归档应用一个补丁，使接口改用原生 Connection 认证。来源 SRI、原始与结果 SHA-256 定义于 [sidebar-auth-compatibility.ts](../src/shared/sidebar-auth-compatibility.ts)，补丁只作用于构建目录中的私有拷贝。

该版本没有自己的终端注册表，不需要旧补丁的终端计数服务。workbench 读取已观察会话中的两类终端资源：各 Agent 的工具终端（`terminals` 服务，官方预设把它装在每个预设版本共享的隔离插件组里，按 Agent 通过 `agentPresets.serviceFor` 查找）和用户在侧栏打开的交互 shell（宿主的 `terminalController`）。官方接口没有完整终端所有者枚举；后台任务读取也只覆盖当前 Agent 和无主任务。因此活动接口返回 `scope: observed-sessions`、`known: false`，`observedKnown` 仅表示该范围内读取成功。数量是观测下界，零不表示宿主空闲；该接口不参与停机决策。缺少服务或接口不兼容时，连观测结果也报告为未知。

功能插件的宿主注册由原生依赖注入管理；workspace 只创建一个共享存储所有者。停用 schedules 会取消未完成的投递请求并停止调度计时器，已经被宿主接收的任务仍遵循原生取消机制。重新启用不会重建用户的定时配置。
