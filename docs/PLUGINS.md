# 插件清单与工程合约

唯一选型清单是 [config/plugins.json](../config/plugins.json)。构建、运行时装配、迁移与安装包检查从它生成列表；新增自制插件须同时通过 `npm run check:plugins`。

| 插件 | 版本规则 | 负责什么 | 依赖 / 约束 |
|---|---|---|---|
| dsh-px-updater | 随整合包同步 | 查询版本、展示更新器状态 | 下载和安装由 Electron 负责；开发环境只有版本查询 |
| dsh-px-workbench | 随整合包同步 | 工作区入口、环境与网络诊断 | 复用 workspaceController 与 web.fetch |
| dsh-px-taskflow | 随整合包同步 | 工作记录、执行证据、任务侧栏 | 复用会话日志；read/view 中出现的历史错误不算工具失败 |
| dsh-px-workspace | 随整合包同步 | 标签、批注、产物、会话调度 | 复用 sessions、conversation、sidebarRight、Session Controller |
| dshmarket | 1.48.0 | 插件发现与管理 | MIT；包清单声明仓库为 [dsh-market](https://github.com/dsh-market/dsh-market) |
| dsh-better-sidebar | 0.19.1 | 文件、终端、Git、侧栏及后台任务 | MIT；[上游仓库](https://github.com/omdsh-dev/DSH-better-sidebar) |
| dsh-mermaid-render | 0.1.11 | Mermaid 展示 | MIT；当前包未声明 repository 字段，来源以锁定 npm 包为准 |
| dsh-find-plugin | 0.3.7 | DSH 插件检索 | MIT；[上游仓库](https://github.com/awesome-dsh-plugin/dsh-find-plugin) |

社区信息来自本机已装配包的 `package.json`。本版不修改社区插件的安装副本。升级第三方包时，应单独核对公开合约、原生模块、来源和 UI 回归。

## 源码布局

- `packages/<插件>/src/index.ts`：宿主入口与 API 注册；只保留必要的合约边界类型。
- `packages/<插件>/src/client.tsx`：客户端注册入口；工作区页面拆分在 `src/client/`。
- `packages/shared/`：构建时内联的共享 HTTP、主题、草稿、请求来源检查与诊断代码，不是第五个运行时插件。
- `scripts/plugins/`：统一构建器；旧 updater 构建路径保留兼容转发。
- `packages/<插件>/lib/`：随包交付的预构建产物，必须入库，不能手改。

## 集成约束

1. React 由宿主静态模块表提供；不打包第二份 React，不在客户端引入 Node 模块。
2. Host 产物只保留 `node:` 内置导入；共享代码在构建时内联。
3. UI 使用公开插槽和服务；标签关闭只关闭视图。原生子 Agent 留在会话层级中管理。
4. Cordis 输入事件必须显式传入会话上下文，不能依靠方法接收者隐式过滤。
5. 原生 API 以当前锁定版本的类型及实测为准；例如 `sessionController.prompt` 必须提供取消信号。
6. 本机接口执行 Host / Origin / Fetch Metadata 校验；写操作保持额外请求标记与字段验证。这是本机来源边界，不是跨用户身份认证系统。
7. 会话日志归 DSH 管理；插件只保存自身业务状态。投递记录先持久化，未确认时暂停核对。
8. 样式限制在 PX 自有区域，使用 DSH 主题变量；交互动画遵守减少动态效果设置。
9. 日志只记录必要的事件编号与状态。原始用户对话、凭据和整份设置不能提交到仓库或公开报告。
