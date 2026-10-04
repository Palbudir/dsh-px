# Pack 与 Desktop

DSH-PX 使用同一套插件整合包提供 Agent 工作能力。Pack 是统一安装入口，内部保留各插件的职责与生命周期，不要求合并成一个插件。Pack 是原生 DSH 插件整合包，Desktop 是以官方 Desktop 源码为基础、首次启动预装 Pack 的 Windows 客户端。浏览器连接同一 DSH 服务时使用同一套插件与会话，不是另一份产品实现。

## 当前状态

两个产品都基于锁定的官方宿主 DSH 0.2.0-rc.2（上游提交见 [native-desktop.json](../config/native-desktop.json)）。旧的 Electron 外壳已经退役：源码、装配与发布流程已从仓库移除，已发布的旧版本及其资产保持原样，旧客户端不会收到新产品的更新。

[产品清单](../config/products.json) 记录 Pack、Desktop、接口代际、宿主范围和已验证的入口；`desktop.architecture` 只接受 `official-derived`。[native-pack.json](../config/native-pack.json) 与 [native-desktop.json](../config/native-desktop.json) 是宿主版本与上游提交的唯一来源，`npm run check:plugins` 交叉校验三者的版本与提交一致。[插件清单](../config/plugins.json) 记录自制插件与待迁移的社区插件。

当前发布主线为 `web` 与 `px-desktop`。0.2.1 曾验证未修改的官方 Windows Desktop 0.2.0-rc.2 安装同一 Pack；0.3 不将原版客户端列为完整验收入口，也不为后续官方版本增加专用适配层。既有使用说明和历史版本保留。不同服务实例仍不能共写数据。

## 版本规则

双方使用 `0.x.y`，可附加 `-alpha.N` 等预览标识。`x` 是 PX 接口兼容代际，`y` 是各产品的独立迭代次数。Pack 0.3.4 可以与满足能力要求的 Desktop 0.3.1 配合，但 Desktop 每次构建锁定一个确切 Pack 版本。0.3 引入基础部署及多功能包安装协议，Desktop 升级清单可明确允许从代际 2 迁移。

需要双方配合的破坏性接口变化提升共同代际。新增兼容功能、修复或桌面资源调整可独立提升版本。共同代际是版本约束，不替代接口能力检测。官方 DSH 版本独立锁定，不跟随上游的后续预览版本，也不通过 PX 的版本号推断兼容性。

数据格式版本与接口代际分开。当前数据格式标识 1 表示既有 PX 存储组合，不改写各插件已有的内部存储标识，也不授权自动降级或转换会话。

## 数据所有权

同一数据目录由一个 DSH 服务负责管理；桌面和浏览器可以同时连接它。不同服务实例使用独立目录，避免重复调度任务、并发迁移和配置覆盖。

Desktop 使用独立应用身份 `com.palbudir.dshpx.desktop`、外部协议 `dsh-px` 和数据目录 `%USERPROFILE%\.dsh-px`，与官方客户端及旧 DSH-PX 并行安装、互不覆盖。首次启动在宿主启动之前、原生 profile 锁内（profile 目录已创建）先写入默认配置，再由原生流程补齐 profile，然后预装 Pack；已有配置、用户自定义的插件声明与明确禁用项不被覆盖。卸载始终保留 `%USERPROFILE%\.dsh-px`。

## 宿主职责

重启、退出、窗口、应用更新和进程生命周期属于原生宿主。Pack 在本代际不提供旧外壳的更新桥、重启或停机请求：

- `dsh-px-updater` 报告 Pack 自身版本与声明的宿主版本，并通过签名 Pack 更新清单检查新版本；在 PX Desktop 提供打开独立更新窗口的入口；下载、安装与重启由桌面主进程负责。独立 Web 只提示，通过原生插件管理器安装。
- `dsh-px-workbench` 提供只读活动快照与本机诊断，不显示宿主进程状态，也不提供重启按钮。

## 发布通道

Pack 与 Desktop 分别以 `pack-v<版本>` 与 `desktop-v<版本>` 发布为 GitHub prerelease，首发通道为 preview，不成为 GitHub Latest；旧客户端读取的 Latest 保持为最后一个旧外壳版本。更新清单由维护者在本机离线签名，发布到 `updates` 分支的 `desktop-preview.json` 与 `pack-preview.json`。详见 [RELEASING.md](RELEASING.md)。

## 原生 Pack 构建

先运行 `npm run build:plugins`，再运行 `npm run build:pack -- build-test/<新目录> --candidate`；输出目录必须不存在。`--candidate` 只用于隔离验证。正式构建要求干净检出并以 `--expect-head=<完整SHA>` 证明来源提交，由可信构建流程执行。

构建器从固定来源获取侧栏插件，核对完整归档 SRI 后应用认证补丁；自制插件只复制声明的发行文件。可用 `--sidebar-archive=<文件路径>` 复用已下载归档，仍执行相同的完整性校验。聚合入口与 Desktop 均使用原生精确包名发现成员代码及本地化元数据。`distribution.json` 固定基础包及五个功能包的版本与摘要，`artifact.json` 标识整体发布产物；二者不包含构建机路径。

Desktop 在宿主启动前、profile 锁内迁移旧受管聚合包。一次原生安装应用整套功能依赖；失败时恢复原配置并通过原生安装恢复依赖树，中断后按持久记录先恢复再重试。用户自管的聚合包或同名功能不被接管。业务数据不随拆包搬迁，已有明确禁用、删除与配置保留。基础组件由 Desktop 管理的原生 installation 运行缓存供给，不与旧聚合包重复注册。整个 Pack 可独立更新；客户端构建锁定的是随附版本，启动不会用更旧的随附 Pack 覆盖已独立升级且兼容的版本。更新需匹配 PX 代际、DSH 版本和上游提交，跨宿主更新先升级客户端。
