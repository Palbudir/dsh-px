# 开发与维护

先读 [当前现状](docs/STATUS.md)、[插件合约](docs/PLUGINS.md) 和对应版本说明。产品目标是在本台电脑提供可靠 Agent 能力；每版以明确功能实现与可复现验收为硬标准。

## 本机开发

使用 Node 24，运行 `npm install`、`npm run stage -- --with-plugins`、`npm run dev`。仓库的 postinstall 会调用 Electron 官方安装器核对匹配版本；不再自行解压下载缓存。

开发默认数据目录和端口与原安装隔离。需要其他验收实例时，显式设置 `DSH_PX_USER_DATA_DIR`（绝对路径）与 `DSH_PX_PORT`。不要把凭据复制进仓库，不要用源码链接替代原安装升级验收。

## 修改约定

- 先记录具体问题、复现步骤与预期；区分确定缺陷、体验建议、历史现象和环境限制。
- 保持原生执行、权限、会话与更新边界；第三方安装树是生成物，改动必须有可重跑的源码或固定补丁入口。
- 自制插件共用主题、请求与状态工具；功能页面和注册入口分离。格式由 Prettier 统一，生成的 lib 不参与手工格式化。
- 新增工具/API 使用明确输入验证、请求取消和真实状态；不得把接收确认写成执行成功。
- 测试应覆盖实际回归风险，包括错误、重复操作、状态恢复和跨会话归属。视觉变化通过实际界面核对，避免只检查实现字符串。
- 日志分析只读，报告保留编号、状态与来源。看到 Error 字样、服务重启或测试故意失败，都不足以单独认定产品故障。

## 提交前

```text
npm run format
npm run typecheck
npm run test
npm run check:repo
npm run build
npm run stage -- --with-plugins
npm run verify -- --boot
```

提交源码及重建后的四个插件 `lib`。CI 会校验清单、版本、格式、预构建产物一致性、行为测试、运行时装配与启动。依赖更新查看 `npm audit`，结合使用边界与官方修复记录，不盲目执行 `audit fix --force`。

## 诊断

```text
npm run audit:logs -- --log <dsh-px.log> --sessions <DSH_HOME/sessions> --out <本机汇总.json>
```

脚本不会输出对话或工具正文。计数可能包含分支继承或验收复制记录；`returned` 只表示工具正常返回，未结算记录也可能仍在运行。具体原因需用会话里的执行证据核对。

## 交付

功能分支 → 检查和实际使用 → PR → 合并 → tag / Release → 安装包校验 → 原安装更新 → 配置、旧会话、插件及真实任务复核。版本和发版细节见 [RELEASING.md](docs/RELEASING.md)。
