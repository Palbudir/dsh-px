# Pack 与 Desktop

DSH-PX 使用同一套插件提供 Agent 工作能力。Pack 是原生 DSH 插件整合包，Desktop 是以官方 Desktop 源码为基础、首次启动预装 Pack 的 Windows 客户端。浏览器连接同一 DSH 服务时使用同一套插件与会话，不是另一份产品实现。

## 当前状态

两个产品都基于锁定的官方宿主 DSH 0.2.0-rc.1（上游提交见 [native-desktop.json](../config/native-desktop.json)）。旧的 Electron 外壳已经退役：源码、装配与发布流程已从仓库移除，已发布的旧版本及其资产保持原样，旧客户端不会收到新产品的更新。

[产品清单](../config/products.json) 记录 Pack、Desktop、接口代际、宿主范围和已验证的入口；`desktop.architecture` 只接受 `official-derived`。[native-pack.json](../config/native-pack.json) 与 [native-desktop.json](../config/native-desktop.json) 是宿主版本与上游提交的唯一来源，`npm run check:plugins` 交叉校验三者的版本与提交一致。[插件清单](../config/plugins.json) 记录自制插件与待迁移的社区插件。

支持的入口为 `web` 与 `px-desktop`。未修改的官方 Desktop 加载同一 Pack 尚未实测，暂不声明 `official-desktop`。

## 版本规则

双方使用 `0.x.y`，可附加 `-alpha.N` 等预览标识。`x` 是 PX 接口兼容代际，`y` 是各产品的独立迭代次数。Pack 0.2.4 可以与 Desktop 0.2.1 配合，但 Desktop 每次构建锁定一个确切 Pack 版本。

需要双方配合的破坏性接口变化提升共同代际。新增兼容功能、修复或桌面资源调整可独立提升版本。共同代际是版本约束，不替代接口能力检测。官方 DSH 版本独立锁定，不跟随上游的后续预览版本，也不通过 PX 的版本号推断兼容性。

数据格式版本与接口代际分开。当前数据格式标识 1 表示既有 PX 存储组合，不改写各插件已有的内部存储标识，也不授权自动降级或转换会话。

## 数据所有权

同一数据目录由一个 DSH 服务负责管理；桌面和浏览器可以同时连接它。不同服务实例使用独立目录，避免重复调度任务、并发迁移和配置覆盖。

Desktop 使用独立应用身份 `com.palbudir.dshpx.desktop`、外部协议 `dsh-px` 和数据目录 `%USERPROFILE%\.dsh-px`，与官方客户端及旧 DSH-PX 并行安装、互不覆盖。首次启动在宿主启动之前、原生 profile 锁内（profile 目录已创建）先写入默认配置，再由原生流程补齐 profile，然后预装 Pack；已有配置、用户自定义的插件声明与明确禁用项不被覆盖。卸载始终保留 `%USERPROFILE%\.dsh-px`。

## 宿主职责

重启、退出、窗口、应用更新和进程生命周期属于原生宿主。Pack 在本代际不提供旧外壳的更新桥、重启或停机请求：

- `dsh-px-updater` 报告 Pack 自身版本与声明的宿主版本，并通过签名 Pack 更新清单检查新版本；只做提示，不下载、不安装。
- `dsh-px-workbench` 提供只读活动快照与本机诊断，不显示宿主进程状态，也不提供重启按钮。

## 发布通道

Pack 与 Desktop 分别以 `pack-v<版本>` 与 `desktop-v<版本>` 发布为 GitHub prerelease，首发通道为 preview，不成为 GitHub Latest；旧客户端读取的 Latest 保持为最后一个旧外壳版本。更新清单由维护者在本机离线签名，发布到 `updates` 分支的 `desktop-preview.json` 与 `pack-preview.json`。详见 [RELEASING.md](RELEASING.md)。

## 原生 Pack 构建

先运行 `npm run build:plugins`，再运行 `npm run build:pack -- build-test/<新目录> --candidate`；输出目录必须不存在。`--candidate` 只用于隔离验证。正式构建要求干净检出并以 `--expect-head=<完整SHA>` 证明来源提交，由可信构建流程执行。

构建器从固定来源获取侧栏插件，核对完整归档 SRI 后应用认证补丁；自制插件只复制声明的发行文件。可用 `--sidebar-archive=<文件路径>` 复用已下载归档，仍执行相同的完整性校验。成员使用包内真实文件入口，保留各自的客户端元数据，避免首次动态启用依赖尚未刷新的嵌套包解析表。`artifact.json` 只记录文件名、版本、来源与摘要，不包含构建机路径。
