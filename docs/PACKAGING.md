# 打包笔记 —— dsh-px 运行时是如何装配的

这些是在编写 `scripts/stage-runtime.mjs` 过程中发现的、不那么显然的约束。
把它们记下来，是因为**每一条都是撞上去才学到的**。

## 装配了什么

`runtime/` 由三部分组成：

| 部分 | 来源 | 为什么需要 |
|---|---|---|
| `runtime/node/` | 来自 `nodejs.org/dist` 的独立 Node 构建 | 让用户什么都不用装。由 `DSH_PX_NODE_VERSION` 锁定版本。 |
| `runtime/dsh/` | 官方 `@deepseek-ai/dsh` 安装 | harness 本体。由 `DSH_PX_DSH_VERSION` 锁定版本。 |
| `runtime/dsh-home/` | 一份种子 Harness home：`profiles/<名称>/` + 插件树 | 让应用一启动就有一份可用、且插件完整的 profile。 |

## 约束 1 —— dsh 安装本身已经是自包含的

一份全局 dsh 安装会把它自己的 `node_modules` 里的 **239 个 `@deepseek-ai/*` 嵌套包**带着走
（在这台机器上约 213 MB）。它**并不**依赖外部的提升（hoisted）同级树来解析自己的组合包层。

推论：整体复制 dsh 安装目录就足以支撑组合包解析，不需要重建任何 `@deepseek-ai` fallback 树。

```js
// stage-runtime.mjs
const src = join(execFileSync('npm', ['root', '-g']).trim(), '@deepseek-ai', 'dsh')
cpSync(src, dest, { recursive: true, dereference: true })
```

## 约束 2 —— 绝不能把 dsh 的 `@deepseek-ai` fallback 树实体化

`$DSH_HOME/profiles/node_modules/@deepseek-ai/*` 是指回全局 dsh 安装的 **Windows Junction**。
这里有两种方向相反的错法，而构建过程中**两种都犯过**：

**（甲）普通复制会把它们丢掉。** 不加 `dereference: true`，Junction 会变成死链接，
于是这个包就悄悄依赖上了本机的全局 dsh。

**（乙）解引用它们会让启动直接失败。** 加上 `dereference: true` 后 Junction 变成真目录，dsh 随即拒绝启动：

```
Error: dsh: <home>/profiles/node_modules/@deepseek-ai/dsh exists and is not a
symlink or dsh-managed module proxy; remove it so dsh can manage the
installation fallback
```

那棵树不是我们的东西，不能复制。它是 **dsh 自己管理的 module proxy fallback**，
dsh 在启动时会断言自己拥有它的形态。而且它也是**冗余的**：
随附的 `runtime/dsh` 已经带了全部 239 个 `@deepseek-ai` 嵌套包，
而组合包名称的解析**优先**走 dsh 安装目录。

正确的解法是**有选择地复制**。`profiles/node_modules` 里装着两种截然不同的东西，
它们需要相反的处理：

| 内容 | 处理 | 原因 |
|---|---|---|
| `node_modules/@deepseek-ai/**`（246 MB） | **排除** | dsh 自己管理的 proxy；与 `runtime/dsh` 冗余；实体化会导致启动失败 |
| `node_modules/<其他一切>`（react、mermaid、`@codemirror`、`node-pty` 等） | **复制，且解引用** | 第三方插件的依赖；在这个包里别处找不到 |

```js
const SKIP_IN_PROFILE_TREE = new Set(['@deepseek-ai'])
copyTree(srcWebModules, join(profileDir, 'node_modules'), { skip: SKIP_IN_PROFILE_TREE })
```

`cpSync` 没有排除选项，这就是 `stage-runtime.mjs` 里那个小 `copyTree` 辅助函数的由来。
剪掉这一个目录同时也省下约 246 MB —— 这是**目前能找到的最大一笔体积收益**。

如果你在某个装配产物上再次看到 "not a symlink or dsh-managed module proxy" 这个错误，
说明这条约束又被违反了。

## 约束 3 —— `profiles/node_modules` 是 Junction 树

`profiles/node_modules` 下剩余的条目（以及 `profiles/<profile>/node_modules` 下的插件树）
同样是 Junction，所以被复制的那部分**仍然需要** `dereference: true`：

```js
cpSync(from, to, { dereference: true, force: true })
```

因此有两条装配路径：

- `--from-existing` —— 复制本机已经在跑的那份 profile。快、可离线，
  而且复现的是一份**你亲手验证过的**配置。
- `--with-plugins` —— 用装配好的 dsh 本身从零构建 profile
  （`dsh plugin --profile <名称> add ...`）。慢、需要网络，但从干净检出开始完全可复现，适合 CI。

在那条路径上，**用 `dsh plugin add` 重做安装而不是手工复制，不是可选项**：
`dsh plugin` 才是负责协调 `dsh.profile.bundles` 的东西。
手工去编辑那个列表，就是"包装上了但从未被挂载"的成因。

## 约束 4 —— pnpm ≥ 10 会拦截依赖的构建脚本

安装 `dsh-better-sidebar` 时会打印：

```
Ignored build scripts: node-pty@1.1.0.
```

`node-pty` 需要它的 postinstall 来放置 `conpty.dll` 和 `OpenConsole.exe`。
一旦被跳过，侧栏终端会在**运行时**才失败 —— 而这距离那次一路绿灯的安装已经很久了。

因此 profile 的 `pnpm-workspace.yaml` 必须带上：

```yaml
allowBuilds:
  node-pty: true
```

然后批准：

```sh
pnpm approve-builds --all
```

**键名本身很关键。** `onlyBuiltDependencies` 是较早的写法；
pnpm 10.34 接受的是 `allowBuilds`，这也正是 `pnpm approve-builds` 会写下的键。
请用 `pnpm approve-builds --help` 确认，而不是相信某篇博客。

## 约束 5 —— 组合包成员的变动需要重启

带 `patchReload: live` 的 profile 会热应用对 `cordis.patch.yml` 的编辑，
但它**不会**热应用**组合包成员**的变动。

本机实测行为：执行 `dsh plugin add` 之后，`--dump-config` 立刻就能看到新的四层，
但**正在运行**的宿主在重启之前一直对这些插件的路由返回 `404`。

对桌面应用的推论：从市场里安装插件，可能让它在重启 harness 进程之前处于"看得见但不起作用"的状态。
外壳必须能够按请求重启 harness，界面也应该把这件事讲清楚。

## 约束 6 —— 外壳必须加载 harness **宣告**的 URL，而不是干净 URL

`dsh web` 用一个**进程级启动令牌**围栏它的浏览器面。本机实测：

| 请求 | 结果 |
|---|---|
| `GET http://127.0.0.1:<端口>/`（干净） | **401** —— `dsh web authentication required; reopen the URL printed by dsh web.` |
| `GET http://127.0.0.1:<端口>/?token=<启动令牌>` | **200**，重定向到干净 URL，并签发签名 cookie |
| 带该 cookie 访问 `GET http://127.0.0.1:<端口>/` | **200** |

其机制是 `connection.authenticatedUrl(baseUrl)`：它把进程启动令牌追加到 URL 上，
而 index 处理器会把一个有效的根查询令牌换成持久化的签名 cookie（密钥由凭据提供方加载）。

对任何嵌入方（Electron、Tauri，或自研外壳）的推论是：
**不要导航到你拼出来的那个 URL。** 让 `printUrl`（默认开启）把宣告的 URL 输出到 stdout，
捕获它，然后加载**它**：

```
dsh web: http://127.0.0.1:3099/?token=bQKvr5kOK4MxQUaD_cJm36aDNlbOnRggdwzj7QRUi34
```

因此 `app/main.mjs` 只把干净 URL 当作**就绪探针**（任何 HTTP 状态码，包括 401，
都证明套接字已经绑定），而加载的是宣告出来的 URL。
一个加载干净 URL 的外壳会显示一个光秃秃的 401 页面，看起来就像坏了。

推论：必须传 `--no-open`，以免 harness 又去拉起系统浏览器；
但 `printUrl` 必须保持开启。**不要两个都关掉。**

## 约束 7 —— Electron 自己的安装可能静默失败，务必验证

`npm install` 有可能让 `node_modules/electron/dist/` 里只剩**一个文件**
（实测：75 个归档条目里只落下了 `locales/sr.pak`），而包本身依然报告安装成功。
此时 `require('electron')` 会抛 *"Electron failed to install correctly"*，
而重跑 `install.js` 会直接空转，因为 `@electron/get` 报告 **cache hit** ——
zip 是好的，**解压**才是失败的那一步。

不必重新下载即可诊断和修复：

```sh
# 1. 缓存里的 zip 是完整的，先确认
ls "$LOCALAPPDATA/electron/Cache"/*/electron-v*-win32-x64.zip
tar -xf <那个 zip> -C node_modules/electron/dist      # 失败的其实是解压
# 2. electron 从这个文件读取二进制路径；手工解压必须自己写它
printf 'electron.exe' > node_modules/electron/path.txt
npx electron --version
```

`path.txt` 是最容易漏掉的一步：`index.js` 靠它定位二进制，
而正常情况写它的是 `install.js`。

仓库里的 `scripts/repair-electron.mjs` 已经把这一切自动化，并挂在 `postinstall` 上，
因此新克隆的仓库会自愈。

## 约束 8 —— Electron 的 Node 不是 harness 的 Node

harness 跑在一个**被 spawn 出来的** Node 进程里，**从不**跑在 Electron 的运行时之内。
这是刻意的：

- 原生模块（`node-pty`）匹配的是装配的 Node 的 ABI，而不是 Electron 的。
- harness 崩溃不会带走外壳；外壳可以报告它、重启它。
- 子进程环境是显式构造的（`DSH_HOME`、`NODE_OPTIONS: ''`），
  而不是从启动 Electron 的那个环境继承来的。

其推论：子进程上设置了 `ELECTRON_RUN_AS_NODE`，
并且子进程使用的是随附的 `runtime/node/node.exe` —— 而不是 `process.execPath`。

## 约束 9 —— 首启播种：不能复制的三类"dsh 自管理 proxy"

这是整个项目里**最难定位的一类问题**：同一个根因以三种不同面貌出现三次，
而且**只在"全新 userData 首启"这条路径上暴露** ——
开发机一直在用既有的 `~/.dsh`，所以最初完全没踩到。

### 为什么会踩到

`profiles` 树里混着两类外观相似、处理方式却完全相反的东西：

| 内容 | 处理 | 原因 |
|---|---|---|
| 真三方依赖（`@codemirror`、`mermaid`、`node-pty`、react 等） | **复制**，解引用 | 别处找不到 |
| dsh 自己管理的 module proxy / fallback | **绝不复制** | dsh 启动时会断言它必须是链接 |

dsh 在启动时会校验这些 fallback。用 `cpSync({dereference:true})` 复制会把 Junction
变成真目录，于是它直接拒绝启动：

```
Error: dsh: <home>/profiles/node_modules/<X> exists and is not a symlink or
dsh-managed module proxy; remove it so dsh can manage the installation fallback
```

### 实测命中的三处（都真实踩过）

| # | 路径 | 说明 |
|---|---|---|
| 1 | `profiles/node_modules/@deepseek-ai/*` | 名字看着像"该排除的包"，但绝非全部 |
| 2 | `profiles/node_modules/commander`、`accepts` … | **同一类链接，只是不在 `@deepseek-ai` 下** —— 只按名字判断必然漏 |
| 3 | `profiles/web/.dsh-module-fallback/*` | 每个 profile 内的 fallback 树，其 Junction 指向 **profile 自己的** `node_modules` |

实测数据（开发机）：`profiles/node_modules` 里 **164 个 Junction 全部指向
`runtime/dsh/node_modules`**，另有 **23 个实体目录**才是真依赖。

### 正确的判定方式：按链接目标，而不是按名字

```js
function makeDshFallbackFilter (dshDir) {
  const prefix = (join(dshDir, 'node_modules') + sep).toLowerCase()
  return (entry, fullPath) => {
    if (entry.name.startsWith('.dsh-')) return true          // dsh/插件生成物
    if (!entry.isSymbolicLink()) return false
    let target
    try { target = realpathSync(fullPath) } catch { return true }  // 悬空链接
    return (target + sep).toLowerCase().startsWith(prefix)   // 指向 dsh 包树
  }
}
```

三个要点：

1. **不能笼统排除 `node_modules`。** pnpm 的 `.pnpm` 内部链接指向 profile 自己的
   store，那是真依赖，必须复制。只有指向 **dsh 包树**的链接才是 fallback。
2. **不能只认 `@deepseek-ai`。** `commander`、`accepts` 等同样是被 dsh 接管的 fallback。
3. **`.dsh-` 前缀一律跳过。** `.dsh-module-fallback`（profile 内 fallback）与
   `.dsh-market`（市场状态）都是生成物，首启会自行重建。

同一套过滤在**两个地方**都要用，缺一处就会在另一条路径上复发：

- `scripts/stage-runtime.mjs` —— 构建随附的种子树时；
- `app/main.mjs` —— 首启把种子树复制进用户 `userData` 时。

### 顺带修掉的两个连带 bug

- `copyProfileTree` 的文件分支必须带 `recursive: true`。`Dirent` 报告的是链接本身，
  而实际源可能是目录（实测 `@agentclientprotocol/sdk/`），少了它会以
  **`Recursive option not enabled, cannot copy a directory`** 直接失败。
- **播种标记必须在复制之前写。** 原来的顺序是"复制 → 写标记"，于是一次中断就留下
  一个既没有标记、又不完整的 home，下次启动仍会看到"没有标记"而重来 —— 永远无法自愈。
  现在改为先写认领标记，并且把失败**如实弹窗报出**，而不是让应用带着空壳 profile
  启动、再表现出一堆莫名其妙的症状。

### 首启实测数据

| 项 | 实测值 |
|---|---|
| 种子树大小 | 约 690 MB（约 30 万文件） |
| 首次播种耗时 | **约 4–5 分钟**（同步复制，期间主进程被占用） |
| 之后每次启动 | 秒级（检测到 `profiles/<name>/package.json` 即直接复用） |
| 打包后安装包 | 约 373 MB（NSIS） |

首次启动的等待是目前 beta 最大的体验短板，`docs/ROADMAP.md` 记录了改进方向。

## 如何验证一次装配

```sh
npm run verify -- --boot
```

结构 + 能力平价 + 启动。`--json` 供 CI 使用。
平价检查会把装配出的组合树与官方安装的树做 diff，并在**任何缺失的行**上失败；
随附插件带来的额外行是预期内的，会被报告，但不会因此扣分。
