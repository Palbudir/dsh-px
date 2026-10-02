# 开发与维护

先阅读 [产品标准](docs/PRODUCT.md)、[当前状态](docs/STATUS.md)、[Pack 与 Desktop](docs/EDITIONS.md) 和 [插件合约](docs/PLUGINS.md)。范围与优先级以 [路线图](docs/ROADMAP.md) 为准。

## 开发环境

使用 Node 24 或更新的兼容版本，通过 `npm ci` 安装锁定依赖。仓库不再包含 Electron 外壳；Desktop 由锁定的官方源码在 GitHub Windows runner 上构建，本机不需要 C++ 工具链。

```powershell
npm ci
npm run build
```

`npm run build` 重建四个自制插件的 `lib` 产物。需要完整 Pack 时运行 `npm run build:pack -- build-test/<新目录> --candidate`，输出目录必须不存在；`--candidate` 只用于隔离验证。本机 Desktop 验证与目录构建步骤见 [PACKAGING.md](docs/PACKAGING.md)。

隔离实例显式设置独立数据目录，不共享同一个 DSH_HOME。评测使用专用目录与会话，常规测试不写入日常数据。

## 实现约定

- 从独立分支开始，先定义具体行为与回归风险，再修改代码。保留不相关的用户改动。
- 复用 DSH 的执行、权限、会话和插件机制；Desktop 生命周期、窗口与应用更新由官方源码负责，PX 只维护可审查的覆盖层。
- 自制插件使用共享主题、请求、草稿和状态工具。页面与注册入口分离；兼容宿主 DOM 的代码集中声明适用边界。
- 宿主不存在的能力诚实降级：不显示假“已连接”，不提供无法兑现的操作按钮。
- API 验证输入与来源，支持请求取消，区分收到请求、入队、执行与最终结果。
- 测试覆盖实际风险：重复操作、并发、归属、错误恢复及升级保留。视觉变化须检查实际窗口；浏览器验收不替代 Desktop 验收。
- 注释说明当前约束和设计原因。用户文档写功能、边界及可执行说明；调试过程、临时路径、原始日志和对话记录保留在忽略目录。

## 检查

```powershell
npm run format
npm run typecheck
npm run test
npm run check:repo
npm run build
node scripts/release-quality.mjs
```

`check:repo` 包含插件清单、产品与原生宿主锁定交叉校验、文档、密钥扫描和格式检查。`release-quality.mjs` 是 CI 与发布共用的门禁：运行上述检查、确认构建后工作树无差异，再构建候选 Pack 到临时目录并核对 `artifact.json` 与归档内清单。它会联网下载固定来源的侧栏归档。

历史源码回归使用 `fixtures/review-context-bb118989` 固定标签，CI 需获取完整历史与标签。该标签不是产品发行，不能移动或删除；它使回归样本不依赖临时开发分支是否保留。

提交源码及重建后的四个插件 `lib` 产物。生成文件不能手工编辑。变更依赖时同步锁文件并检查审计结果，不自动强制升级不兼容依赖。

每个 PR 在候选内容稳定后做一次针对增量的独立审查，优先使用 DeepSeek Flash。记录准确 SHA、范围、结论和需要处理的问题；后续代码修复只复核相关增量。确认会影响本机使用、数据或升级的 P0/P1/P2 必须修复；一般维护建议进入后续任务，不无限扩大当前版本。测试通过不替代审查，也不证明未测场景正确。

普通 CI 是 GitHub 必需检查。本地检查已经通过且源码没有变化时，不重复运行同一套测试；最终 CI 或发布构建运行完整质量命令。类型检查、相关回归和实际使用检查按改动范围选择。独立审查不再通过专用 App 的串行全量循环强制执行，见 [GitHub 维护说明](docs/github/README.md)。

## 交付

交付流程：分支 → 检查和实际使用 → 独立 DS Flash 审查与 PR → 普通 CI 通过 → 合并 → 精确提交构建 → 资产核对 → 产品 tag / 预览 Release → 离线签名更新清单 → 安装后数据与功能复核。详细要求见 [RELEASING.md](docs/RELEASING.md)。
