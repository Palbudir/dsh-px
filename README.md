# dsh-px

一个**把 DeepSeek Harness（`dsh`）完整打包进单个应用的 Electron 桌面客户端**。

不需要终端，不需要用户在本地 `npm install`，不需要单独安装 Node、pnpm 或 dsh。
下载、双击，完整的 harness 就在那里。

> **状态：beta 开发中。** beta 的验收标准是刻意写得具体的：
> **打包后的应用必须达到至少等同于官方 `dsh` 的能力。**
> 这条标准是被**度量**出来的，不是被声明的 —— 见 [验收](#验收)。

---

## 核心思路

`dsh` 本身就已经是一个 Web 应用：`dsh --profile web` 会在 `127.0.0.1` 上提供浏览器界面。
所以桌面客户端**不需要重新实现任何 harness 行为**，它只需要做两件事：

1. **拥有运行时** —— 自带一份固定版本的 Node 和官方 dsh 安装，于是用户机器上的环境变得无关紧要。
2. **拥有窗口** —— 拉起这份 dsh，等它的 HTTP 面就绪，然后嵌进原生窗口。

其余一切（智能体、工具、沙箱、会话、插件组合、设置）都是官方 dsh 在做它本来就在做的事。
这就是为什么"至少达到官方能力"是一个可达的目标，而不是一次重写。

```
Electron 主进程
  └─ spawn  runtime/node/node.exe runtime/dsh/lib/bin.js --profile web --no-open
              │  DSH_HOME = <userData>/dsh-home   （首次运行从 runtime/dsh-home 播种）
              └─ 服务 http://127.0.0.1:<端口>  ──►  BrowserWindow
```

有一个细节决定窗口能不能用，值得提前讲清楚：
**上面那个干净 URL 会返回 `401`。** dsh 用一个**进程级启动令牌**围栏它的浏览器面，
只有 `dsh web` 自己宣告的那个 URL（干净 URL 加上 `?token=…`）才能把令牌换成签名会话 cookie。
所以外壳**只把干净 URL 当作就绪探针**，真正加载的是 harness 打印出来的那个 URL。
详见 `docs/PACKAGING.md` 的约束 6。

## 仓库结构

```
app/
  main.mjs                Electron 主进程：解析运行时、拉起 dsh、窗口、托盘
  bootstrap.mjs           无 Electron 的冒烟测试 —— 直接启动已装配的运行时
scripts/
  stage-runtime.mjs       装配 ./runtime（Node + dsh + 种子 profile）
  verify-capabilities.mjs beta 验收工具（结构 + 能力平价 + 启动）
  repair-electron.mjs     修复被 npm 装坏的 Electron（postinstall 自动调用）
docs/
  PACKAGING.md            运行时如何装配，以及为什么必须这样做
  ROADMAP.md              beta 到底指什么，以及之后做什么
```

`runtime/` 是**生成物，永不入库** —— 它是数百 MB 的第三方代码。`.gitignore` 已经强制了这一点。

## 快速开始（开发）

```sh
npm install

# 装配运行时
#   --from-existing  克隆你本地已经在用的 profile（快，可离线）
#   --with-plugins   用 npm 全新安装默认插件集（可复现）
npm run stage -- --from-existing

# 证明装配出的运行时是真的、且能力达标
npm run verify -- --boot

# 启动桌面客户端
npm start
```

## 验收

`npm run verify` 就是 beta 的门禁。它做三项互相独立的检查：

| 检查 | 它证明了什么 |
|---|---|
| **结构** | 装配出的运行时存在、其 profile 声明了随附的组合包层、且有 manifest 记录了究竟装配了什么。 |
| **能力平价** | 把装配版的组合插件树与**官方**安装的插件树分别 dump 出来**逐行对比**。官方有而装配版缺的任何一行都是能力缺口，直接判定失败。 |
| **启动**（`--boot`） | 装配出的 harness 真的能启动，且它的 HTTP 面有应答。 |

其中平价检查是关键：它把"至少达到官方能力"从一句主张变成了一个 diff。
随附插件合理地让装配版成为**超集**；门禁只对**缺失**的行报错。

```sh
npm run verify -- --boot --json     # 机器可读，供 CI 用
```

## 随附插件

beta 版预装了以下插件到 web profile（包名均已核验）：

| 包 | 作用 |
|---|---|
| `dshmarket` | 应用内插件市场：浏览、一键安装/升级、主题 |
| `dsh-better-sidebar` | VSCode 式右侧栏（文件、编辑器、终端、Git、浏览器）；同时是其他 UI 插件注册页签的扩展点 |
| `dsh-mermaid-render` | 把 mermaid 代码块渲染成图表卡 |
| `dsh-find-plugin` | 让智能体从精选清单里发现插件 |

插件组合**不是硬编码的**，它就是 profile 的 `dsh.profile.bundles` 列表 —— 官方机制本身。
应用是**继承**它，而不是重新实现它。

## 打包

```sh
npm run stage -- --with-plugins   # 从 npm 装配可复现的运行时
npm run dist                      # electron-builder -> dist/
```

`electron-builder` 会把 `runtime/` 复制进应用的 `resources/`，因此装出来的应用是真正自包含的。
那些不那么显然的约束（Junction 树、pnpm 构建审批、`allowBuilds`）见 `docs/PACKAGING.md`。

## 已知限制（beta）

- **Windows 是首要目标**；macOS / Linux 的打包目标已配置但未实测。
- **尚无自动更新。** `docs/ROADMAP.md` 写了设计意图，以及为什么它要复用现成且经过验证的
  更新插件，而不是自己造一个。
- Electron 构建**未签名**。
- 鉴权沿用 dsh 自己的浏览器信任围栏；外壳不再叠加第二层登录。
- **在应用内安装插件需要 PATH 上有 `pnpm`。** 初始插件集已预装在随附 profile 里，
  所以应用开箱可用；但要从市场添加更多插件目前需要 pnpm（市场在检测到缺失时会提供一键安装引导）。
- 装配后的运行时约 620 MB（Node 100 MB + dsh 213 MB + 插件树 309 MB），
  所以装出来的体积偏大。`electron-builder` 会压缩，但确实还有明显的裁剪空间。

### 在 Windows 上验证 Electron 本身

`npm install` 有可能静默留下一个坏掉的 Electron（见 `docs/PACKAGING.md` 约束 7）。
如果 `npx electron --version` 失败，通常缓存里的 zip 是好的，只是解压失败了：

```sh
tar -xf "$LOCALAPPDATA/electron/Cache"/*/electron-v*-win32-x64.zip -C node_modules/electron/dist
printf 'electron.exe' > node_modules/electron/path.txt
```

`setup.ps1` / `setup.sh` 会把这一步连同前置检查一起做完，也可以直接跑它。

## 许可证

MIT
