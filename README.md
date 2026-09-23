# dsh-px


> 当前开发目标：在这台 Windows 电脑上持续可用的 Agent 工作台。跨平台、分发和签名暂不作为验收门槛。

日常使用入口仍为已安装的 **DSH-PX**。新功能通过正式版本发布与应用内更新交付。
选择本机项目与模型后直接开始任务。会话右侧栏的 **任务进展** 支持执行历史分页与按需读取输出；**设置 → 运行与帮助** 提供入门、网络来源和实际网页读取检查。
会话工作区提供顶部标签、文件/终端/产物入口、原文批注和会话定时任务。re.0.10 集中修复交互和维护问题；先看 [当前现状](docs/STATUS.md)、[质量审查](docs/quality-2026-09-24/README.md) 与 [版本说明](docs/releases/re.0.10.md)。
目标是以 DSH 原生插件架构交付完整、可靠的 Agent 工作能力。插件是实现方式，产品标准见 [PRODUCT.md](docs/PRODUCT.md)。
开发验证记录见 [本机使用与验收记录](docs/LOCAL-WORKBENCH.md)，发版步骤见 [RELEASING.md](docs/RELEASING.md)。
最新调查见 [成熟 Agent 能力审计](docs/agent-maturity-2026-09-22/README.md)：100 项分阶段功能、18 项问题排期、安装版实测及可离线复现证据；[交互清单](docs/agent-maturity-2026-09-22/index.html) 可直接在本机浏览器打开。

> **非官方项目。** 本项目与深度求索（DeepSeek）公司**无任何从属、合作或授权关系**，
> 是一个基于 DeepSeek Harness 构建的第三方客户端。项目名使用官方品牌规范建议的缩写
> "DSH"。详见 [NOTICE.md](./NOTICE.md)。

一个**把 DeepSeek Harness（`dsh`）完整打包进单个应用的 Electron 桌面客户端**。

随附 Node 与 dsh，日常通过已安装应用进入。当前版本针对本机现有环境验收；
首次升级自管插件使用本机 pnpm 与缓存，工作台会显示依赖检查结果。

> **当前版本 `0.1.0-beta.re.0.10.1`**（[Releases](https://github.com/Palbudir/dsh-px/releases)）。[维护修订说明](docs/releases/re.0.10.1.md)。
> 打包后的应用需保留官方 `dsh` 的基础组合，并通过本机实际任务验证。
> 组合树对比是结构门禁，完整产品能力还需要正常与异常任务验收 —— 见 [验收](#验收)。

---

## 核心思路

`dsh` 本身就已经是一个 Web 应用：`dsh --profile web` 会在 `127.0.0.1` 上提供浏览器界面。
桌面外壳沿用官方 harness，产品能力通过原生插件扩展：

1. **拥有运行时** —— 自带固定版本的 Node 和官方 dsh；本机 Git、pnpm、代理和项目环境仍需检查。
2. **拥有窗口** —— 拉起这份 dsh，等它的 HTTP 面就绪，然后嵌进原生窗口。
3. **交付经过验收的能力组合** —— 复用原生工具与社区插件，自制项目任务、验证和产物能力，并在安装版里验证完整流程。

DSH 继续管理 Agent 执行、沙箱、会话、插件组合与设置。DSH-PX 通过这些扩展点完善任务体验；当前可用范围和缺口见 [产品目标](docs/PRODUCT.md) 与 [审计报告](docs/agent-maturity-2026-09-22/README.md)。

```
Electron 主进程
  ├─ 首启：把随附 runtime/dsh-home 硬链接物化到 <userData>/dsh-home（秒级，见下）
  └─ spawn  runtime/node/node.exe runtime/dsh/lib/bin.js --profile web --no-open
              │  DSH_HOME = <userData>/dsh-home
              └─ 服务 http://127.0.0.1:<端口>  ──►  BrowserWindow
```

有一个细节决定窗口能不能用，值得提前讲清楚：
**上面那个干净 URL 会返回 `401`。** dsh 用一个**进程级启动令牌**围栏它的浏览器面，
只有 `dsh web` 自己宣告的那个 URL（干净 URL 加上 `?token=…`）才能把令牌换成签名会话 cookie。
所以外壳**只把干净 URL 当作就绪探针**，真正加载的是 harness 打印出来的那个 URL。
详见 `docs/PACKAGING.md` 的约束 6。

## 首启为什么是秒级

早期实现用同步整树复制把随附运行时铺进用户数据目录：**4–5 分钟，界面冻结**。
现在改为**硬链接物化** —— 同卷内不复制数据，实测 **5.7 秒**铺完约 1.3 万个文件，
且几乎不额外占盘。

- 跨卷时 `linkSync` 抛 `EXDEV`，自动回退逐文件复制，并显示**进度页**
  （不是模态框：可以忽略，不夺焦点）。
- 硬链接失败（含 NTFS 单文件 1024 条链接上限）**一律回退复制**，绝不因此中断首启。
- 可续传：中途失败后再启动不会从头再来。

细节与实验数据见 [`docs/design-first-run.md`](docs/design-first-run.md)。

## 仓库结构

```
src/
  main/index.ts           Electron 主进程：解析运行时、物化 home、拉起 dsh、窗口、托盘、更新
  main/materialize.ts     首启硬链接物化（跨卷回退、续传、进度）
  main/update-controller.ts 更新检查、下载、安装状态机（并发保护与失败恢复）
  main/update-bridge.ts   外壳 ↔ 界面之间的更新状态桥（文件，原子写）
  renderer/               首启进度页（真 renderer 入口，非 data: URL）
  preload/index.ts        进度页 preload（窗口标题看守）
packages/dsh-px-updater/  自研 dsh 插件（宿主半边 + 客户端半边，均为预构建产物）
packages/dsh-px-workbench/  本机入门与运行诊断
packages/dsh-px-taskflow/   任务交接与执行证据
packages/dsh-px-workspace/  会话标签、产物、引用批注与定时任务
scripts/                  构建与验证脚本（TypeScript 源码，经 scripts/run.mjs 编译执行）
docs/
  PACKAGING.md            运行时如何装配，以及 10 条踩出来的约束
  design-first-run.md     首启物化的设计与实测数据
  RELEASING.md            发版流程，以及**版本号那个坑**
  ROADMAP.md              当前能力路线图入口
```

`runtime/` 与 `out/`、`dist/`、`build-scripts/`、`build-test/` 都是**生成物，永不入库**。
`.gitignore` 已强制这一点。

## 快速开始（开发）

```sh
npm install

# 装配运行时
#   --from-existing  克隆你本地已经在用的 profile（快，可离线）
#   --with-plugins   用 npm 全新安装默认插件集（可复现）
npm run stage -- --from-existing

# 类型检查 + 单元测试
npm run typecheck        # 主进程 + 插件两半 + 构建脚本，三套配置
npm run test             # 含首启物化、插件两个半边的产物形态校验

# 校验装配结构与真实启动；任务能力另做安装版验收
npm run verify -- --boot

# 启动桌面客户端
npm start
```

## 验收

门禁分三层，全部可机械复现：

| 命令 | 它证明了什么 |
|---|---|
| `npm run typecheck` | 三套 tsconfig 全绿（主进程/渲染、插件两半、构建脚本）。 |
| `npm run test` | 首启物化的行为（硬链接、跨卷/上限回退、幂等、链接规则）+ 插件两个半边产物的形态与导出面。 |
| `npm run verify -- --boot` | **组合结构**、**官方基础插件树保留**、**真实启动**。 |

其中组合树门禁把装配版与**官方**安装的插件树分别 dump 出来
**逐行对比**。官方有而装配版缺的任何一行都是能力缺口，直接判定失败。
随附插件合理地让装配版成为**超集**；门禁只对**缺失**的行报错。
这不能证明每个工具在本机可用、模型正确使用工具或异常恢复可靠；实际任务与限制见 [安装版评测](docs/agent-maturity-2026-09-22/evaluations.md)。

```sh
npm run verify -- --boot --json     # 机器可读，供 CI 用
```

还有一层**视觉**验证：`npm run screenshot` 用 Playwright 驱动 Electron 截图
（进度页、harness 界面、设置页分区），把"看起来对不对"也变成可检查项。

## 随附插件

新增自制 `dsh-px-taskflow`：项目任务交接、执行证据与会话侧栏。它复用官方工具和会话持久化，不增加另一套执行或权限机制。
re.0.8 的历史分页、`task_evidence` 和系统代理接入方式见 [版本说明](docs/releases/re.0.8.md)。每版以明确功能验收为硬标准，Agent 整体效果作为软观察，见 [验收分层](docs/PRODUCT.md)。

预装到 web profile（包名均已核验）：

| 包 | 作用 |
|---|---|
| `dshmarket` | 应用内插件市场：浏览、一键安装/升级、主题 |
| `dsh-better-sidebar` | VSCode 式右侧栏（文件、编辑器、终端、Git、浏览器）；同时是其他 UI 插件注册页签的扩展点 |
| `dsh-mermaid-render` | 把 mermaid 代码块渲染成图表卡 |
| `dsh-find-plugin` | 让智能体搜索 GitHub 上的 DSH 插件 |
| `dsh-px-updater` | **本项目自研**：版本/更新状态查询，并在 dsh 设置页注册一个「版本与更新」分区 |
| `dsh-px-workbench` | **本项目自研**：运行与帮助、环境诊断、项目入口 |
| `dsh-px-taskflow` | **本项目自研**：任务工作记录、实际执行证据和任务侧栏 |
| `dsh-px-workspace` | **本项目自研**：会话标签、常用面板入口、产物汇总、引用批注与会话定时任务 |

插件组合**不是硬编码的**，它就是 profile 的 `dsh.profile.bundles` 列表 —— 官方机制本身。
应用是**继承**它，而不是重新实现它。自研插件同样走官方范式：声明 `dsh.bundle.patch`
参与组合，并声明 `dsh.client` 提供客户端半边。

## 更新

当前版本为 re.0.10.1，改动通过功能分支、PR、Release 和原安装版更新交付。
历史接力记录见 [开发交接](docs/DEVELOPMENT-HANDOFF.md)，当前后续事项以 [能力路线图](docs/ROADMAP.md) 为准。

两层东西独立更新：

| 层 | 通道 | 机制 |
|---|---|---|
| 桌面外壳 | GitHub Releases | `electron-updater`，差分下载（区块级） |
| 随附 dsh 核心 | 跟随外壳 | 装进外壳的 `runtime/`，所以升外壳即升它 |

行为刻意**非模态**：后台静默下载，托盘显示进度，界面设置页出现一条可忽略的提示横幅，
退出应用时自动安装。只有用户**主动**检查更新时才给回执。

差分下载**实测有效**：`beta.re.0.1 → beta.re.0.2` 时全量 217 MB，
实际只下载 **15.5 MB（7%）**。省多少取决于改动的分布，不是固定值 ——
`beta.7 → beta.8` 那次是 2.5 MB（省 98.9%）。

## 打包

```sh
npm run stage -- --with-plugins   # 从 npm 装配可复现的运行时
npm run prune                     # 裁掉 *.map 与 tests/（约省 111 MB）
npm run dist                      # electron-builder -> dist/
```

`electron-builder` 会把 `runtime/` 复制进应用的 `resources/`，因此装出来的应用是真正自包含的。
那些不那么显然的约束（Junction 树、pnpm 构建审批、`allowBuilds`、为什么必须裁剪）见
[`docs/PACKAGING.md`](docs/PACKAGING.md)。

## 已知限制（beta）

- **Windows 是首要目标**；macOS / Linux 的打包目标已配置但**未实测**。
- **Electron 构建未签名**，Windows SmartScreen 会提示。
- **跨卷首启未经真实验证**：本项目的开发机只有一个卷，无法构造 `EXDEV`。
  判据级测试已覆盖，回退分支也已被"真实触发 NTFS 链接上限"的用例跑通（同一段代码），
  但真实跨卷下的耗时与进度显示仍待验证。
- 鉴权沿用 dsh 自己的浏览器信任围栏（进程启动令牌 → 签名 cookie）；
  外壳不叠加第二层登录。**注意干净 URL 会返回 401**，外壳加载的是 harness
  自己宣告的那个 URL，详见 `docs/PACKAGING.md` 约束 6。
- **在应用内安装插件需要 PATH 上有 `pnpm`。** 初始插件集已预装在随附 profile 里，
  所以应用开箱可用；但要从市场添加更多插件目前需要 pnpm
  （市场在检测到缺失时会提供一键安装引导）。
- 早期 re.0.2 安装包约 **212 MB**（NSIS）；当前文件大小以对应 Release 为准。
- 卸载时**不会**提示"数据目录仍占用空间"。硬链接与安装目录共享数据，
  两边都删才真正释放 —— 这一提示尚未实现。
- `dsh` 核心固定为装配时锁定的版本（当前 `0.1.5-rc.2`）。
  换核心版本要重新装配外壳，不能单独升级。

### 在 Windows 上验证 Electron 本身

`npm install` 有可能静默留下一个坏掉的 Electron（见 `docs/PACKAGING.md` 约束 7）。
`scripts/repair-electron.ts` 挂在 `postinstall` 上自动处理；
若仍失败，通常是缓存里的 zip 是好的、只是解压失败：

```sh
tar -xf "$LOCALAPPDATA/electron/Cache"/*/electron-v*-win32-x64.zip -C node_modules/electron/dist
printf 'electron.exe' > node_modules/electron/path.txt
```

## 许可证

MIT
