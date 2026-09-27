# 开发与维护

先阅读 [产品标准](docs/PRODUCT.md)、[当前状态](docs/STATUS.md) 和 [插件合约](docs/PLUGINS.md)。范围与优先级以 [路线图](docs/ROADMAP.md) 为准。

## 开发环境

使用 Node 24 或更新的兼容版本，通过 `npm ci` 安装锁定依赖。`postinstall` 使用 Electron 官方安装器并核对二进制版本；修复失败时运行 `node scripts/run.mjs repair-electron`，不要手工覆盖缓存归档或伪造路径文件。

```powershell
npm ci
npm run stage -- --with-plugins
npm run dev
```

`npm run dev` 重建源码、刷新装配并在隔离开发数据中迁移受管插件，避免重启后仍加载旧拷贝。内容摘要不变时不会重复迁移。其他实例显式设置 `DSH_PX_USER_DATA_DIR` 为独立绝对路径，并设置 `DSH_PX_PORT`。同时运行的服务不能共享同一个 DSH_HOME。评测使用专用目录与会话，常规测试不写入日常数据。

## 实现约定

- 从独立分支开始，先定义具体行为与回归风险，再修改代码。保留不相关的用户改动。
- 复用 DSH 的执行、权限、会话和插件机制；Electron 负责桌面生命周期及应用更新。
- 自制插件使用共享主题、请求、草稿和状态工具。页面与注册入口分离；兼容宿主 DOM 的代码集中声明适用边界。
- API 验证输入与来源，支持请求取消，区分收到请求、入队、执行与最终结果。
- 测试覆盖实际风险：重复操作、并发、归属、错误恢复及升级保留。视觉变化须检查实际窗口；浏览器验收不替代 Electron 验收。
- 注释说明当前约束和设计原因。用户文档写功能、边界及可执行说明；调试过程、临时路径、原始日志和对话记录保留在忽略目录。

## 检查

```powershell
npm run format
npm run typecheck
npm run test
npm run check:repo
npm run build
npm run stage -- --with-plugins
npm run verify -- --boot
```

提交源码及重建后的四个插件 `lib` 产物。生成文件不能手工编辑。完整 CI 和发布共用 `scripts/release-quality.mjs`；构建后工作树不应产生未提交的产物差异。变更依赖时同步锁文件并检查审计结果，不自动强制升级不兼容依赖。

独立审查绑定当前提交 SHA。每次 push 或 PR 更新均重新审查；旧结论不能批准新提交。P0、P1、P2 发现须修复并复核，审查执行失败或缺失也不能合并。审查执行器与仓库规则见 [GitHub 维护说明](docs/github/README.md)。

## 诊断与交付

```powershell
npm run audit:logs -- --log <应用日志> --sessions <会话目录> --out <本机汇总.json>
```

日志汇总不输出对话或工具正文。计数可能包含分支继承记录；工具返回状态需结合对应输出解释。不要将历史错误文本、测试故意失败或明确请求的重启当作新的产品故障。

交付流程：分支 → 检查和实际使用 → 独立审查与 PR → 合并 → 发布资格核验 → tag / Release → 安装后数据与功能复核。详细要求见 [RELEASING.md](docs/RELEASING.md)。

旧 profile 备份和隔离测试记录使用 [受控维护命令](docs/MAINTENANCE.md) 整理。先列出明确计划，再按确认值执行；不要手工覆盖运行中的业务存储或递归清理整个数据目录。
