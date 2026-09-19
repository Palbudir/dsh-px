/**
 * dsh-px —— Electron 主进程。
 *
 * 职责划分（这是刻意的，请保持这样）：
 *   - Electron 只拥有桌面外壳：窗口、托盘、菜单、生命周期。
 *   - 随附的 `dsh` CLI 拥有全部 harness 能力：智能体、工具、会话、插件组合、设置。
 *     我们绝不在这里重新实现任何 harness 行为。
 *
 * 正因如此，"至少达到官方 dsh 能力"才是可达的：打包进去的运行时**就是**官方 dsh 安装，
 * 原样启动，组合出的 profile 与一次 `dsh --profile web` 调用所构建的完全一致。
 *
 * @module dsh-px/main
 */
import { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage, Notification } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, cpSync, writeFileSync, readdirSync, realpathSync, readFileSync, createWriteStream } from 'node:fs'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * electron-updater 是 CJS 包，从 ESM 里用 createRequire 加载最稳。
 *
 * 分工很重要，别把两件事搞混：
 *   - **外壳自身**（Electron 二进制 + app.asar）由 electron-updater 更新，
 *     它是这块的业界标准，自带差分下载（blockmap）、校验与回滚。
 *   - **随附的 dsh 核心与插件**由 dsh 侧的插件负责（生态规范内的做法）。
 * 两者通道不同、节奏不同，混在一起就会互相踩。
 */
const require = createRequire(import.meta.url)
let autoUpdater = null
try {
  ({ autoUpdater } = require('electron-updater'))
} catch (err) {
  // 开发态（未打包）下通常拿不到 app-update.yml，属正常，不应致命。
  process.stdout.write(`[dsh-px] electron-updater 不可用（开发态正常）：${err?.message ?? err}\n`)
}

// ── 日志落盘 ────────────────────────────────────────────────────────────────
//
// 为什么需要：本文件里有 20 多处 `process.stdout.write`，而**双击启动时用户看不到
// 任何输出**（GUI 没有控制台）。于是出问题时用户手上没有任何证据，只能描述现象 ——
// 既让用户难以自查，也让远程排查几乎无从下手。
//
// 做法：在最早时机劫持 stdout/stderr 的写入，把每一行同时追加到
// `<userData>/dsh-px.log`。好处是**不必改动任何既有调用点**；
// 连 harness 子进程的输出（我们也转发到 stdout）会一并进日志。
//
// `userData` 要等 app ready 才稳定，所以先缓冲，ready 后再落盘。
const LOG_BUFFER = []
let LOG_STREAM = null
let LOG_PATH = null

/** 追加文本到日志缓冲或文件。 */
function appendLog (text) {
  const line = text.endsWith('\n') ? text : text + '\n'
  if (LOG_STREAM) {
    try { LOG_STREAM.write(line) } catch { /* 日志写入失败不该影响应用 */ }
  } else if (LOG_BUFFER.length < 5000) {
    LOG_BUFFER.push(line)   // 缓冲上限，避免 ready 之前无限增长
  }
}

/** 劫持标准输出/错误，使所有既有输出自动进日志。 */
function teeStdio () {
  for (const [stream, tag] of [[process.stdout, 'out'], [process.stderr, 'err']]) {
    const original = stream.write.bind(stream)
    stream.write = (chunk, encoding, cb) => {
      try {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        appendLog(tag === 'err'
          ? text.split('\n').map((l) => (l ? `[stderr] ${l}` : l)).join('\n')
          : text)
      } catch { /* 忽略 */ }
      return original(chunk, encoding, cb)
    }
  }
}

/** app ready 后打开日志文件，并把缓冲刷进去。 */
function openLogFile () {
  try {
    LOG_PATH = join(app.getPath('userData'), 'dsh-px.log')
    mkdirSync(dirname(LOG_PATH), { recursive: true })
    LOG_STREAM = createWriteStream(LOG_PATH, { flags: 'a' })
    LOG_STREAM.write(`\n${'='.repeat(70)}\n`)
    LOG_STREAM.write(`[dsh-px] 启动 ${new Date().toISOString()}  版本 ${app.getVersion()}  平台 ${process.platform}\n`)
    for (const line of LOG_BUFFER) LOG_STREAM.write(line)
    LOG_BUFFER.length = 0
  } catch {
    LOG_STREAM = null   // 日志失败绝不阻断启动
  }
}

/** 日志文件路径（错误弹窗里告知用户）。 */
function logPath () {
  return LOG_PATH ?? '(尚未初始化)'
}

teeStdio()

const HERE = dirname(fileURLToPath(import.meta.url))          // <app>/app
const APP_ROOT = resolve(HERE, '..')                          // <app>
const PROFILE_NAME = process.env.DSH_PX_PROFILE ?? 'web'
const HOST = '127.0.0.1'
const DEFAULT_PORT = Number(process.env.DSH_PX_PORT ?? 3080)
/** 等待 harness 的 HTTP 面给出应答的上限；超时即判定启动失败。 */
const READY_TIMEOUT_MS = Number(process.env.DSH_PX_READY_TIMEOUT_MS ?? 180_000)

/** @type {import('node:child_process').ChildProcess | null} */
let harness = null
/** @type {BrowserWindow | null} */
let win = null
/** @type {Tray | null} */
let tray = null
let quitting = false

/**
 * 拉起 harness 所需的全部状态。重启 harness 时要重新求值，
 * 所以单独存起来而不是散落在 main 里。
 * @type {{runtime:any, home:string, port:number}|null}
 */
let ctxState = null
/** 当前窗口应加载的干净 URL（重启后端口可能变，所以要跟着更新）。 */
let currentCleanUrl = null

/**
 * 解析已装配的运行时。支持两种布局，使同一份代码在开发态和安装后都能跑：
 *   打包后：  <resources>/runtime/{node,dsh,dsh-home}
 *   开发态：  <仓库>/runtime/{node,dsh,dsh-home}
 * @returns {{root:string,node:string,dshEntry:string,seedHome:string}|null}
 */
function resolveRuntime () {
  const roots = []
  if (process.resourcesPath) roots.push(join(process.resourcesPath, 'runtime'))
  roots.push(join(APP_ROOT, 'runtime'))

  for (const root of roots) {
    const node = process.platform === 'win32'
      ? join(root, 'node', 'node.exe')
      : join(root, 'node', 'bin', 'node')
    const dshEntry = join(root, 'dsh', 'lib', 'bin.js')
    const seedHome = join(root, 'dsh-home')
    if (existsSync(node) && existsSync(dshEntry)) {
      return { root, node, dshEntry, seedHome: existsSync(seedHome) ? seedHome : null }
    }
  }
  return null
}

/**
 * 建立"哪些目录项是 dsh 自己管理的 fallback"的判定函数，这类项**绝不能复制**。
 *
 * 实测背景：开发机上 `profiles/node_modules` 有 **164 个 Junction 全部指向
 * `runtime/dsh/node_modules`**（dsh 自己的包树），另有 23 个实体目录才是真三方依赖。
 * dsh 启动时会断言这些 fallback 必须是链接或它自己管理的 proxy，
 * 一旦被解引用成真目录就拒绝启动：
 *
 *   dsh: <home>/profiles/node_modules/commander exists and is not a symlink or
 *        dsh-managed module proxy
 *
 * **两套判据缺一不可**，因为同一条路径会经历两次解引用：
 *
 *   1. 按链接目标判断（`targetName` / `isSymbolicLink`）—— 覆盖**开发态**。
 *      开发时这些项确实还是 Junction，按目标判断最准确。
 *   2. 按"名字是否出现在 dsh 自己的直接依赖清单里"判断 —— 覆盖**打包态**。
 *      electron-builder 打包 `extraResources` 时会**再次解引用** Junction，
 *      于是应用看到的 `commander` 已经是真目录，判据 1 完全失效（实测踩到）。
 *      dsh 的直接依赖清单随附在 `runtime/dsh/package.json` 里，确定且可读。
 *
 * 注意不能笼统排除 `node_modules`：pnpm 的 `.pnpm` 内部链接指向 profile 自己的
 * store，那是真依赖，必须复制。也正因如此，真实的插件依赖（如 `react`）
 * 不在 dsh 的直接依赖清单里，会被正确保留。
 * @param {string|null} dshDir 随附的 dsh 安装目录
 * @returns {{ skipEntry: (entry: import('node:fs').Dirent, fullPath: string) => boolean, skipName: Set<string> }}
 */
function makeDshFallbackFilter (dshDir) {
  // 判据 2 的数据源：dsh 自己的直接依赖名。
  const dshOwnDeps = new Set()
  if (dshDir) {
    try {
      const manifest = JSON.parse(readFileSync(join(dshDir, 'package.json'), 'utf8'))
      for (const name of Object.keys(manifest.dependencies ?? {})) {
        // 依赖名可能是 '@scope/pkg'；顶层条目按 scope 目录出现，所以两种形式都收。
        dshOwnDeps.add(name)
        if (name.startsWith('@')) dshOwnDeps.add(name.split('/')[0])
      }
    } catch (err) {
      process.stderr.write(`[dsh-px] 警告：无法读取 dsh 依赖清单，打包态判据将退化：${err?.message ?? err}\n`)
    }
  }

  const prefix = dshDir ? (join(dshDir, 'node_modules') + sep).toLowerCase() : null

  const skipEntry = (entry, fullPath) => {
    // dsh / 插件自己的状态目录一律不复制。它们都是生成物，首次启动会自行重建，
    // 而复制它们会把 Junction 解引用成真目录，从而让 dsh 拒绝启动：
    //   .dsh-module-fallback —— profile 内的 module fallback 树，其 Junction 指向
    //     profile 自己的 node_modules；
    //   .dsh-market —— 插件市场状态。
    if (entry.name.startsWith('.dsh-')) return true

    if (entry.isSymbolicLink() && prefix) {
      let target
      try { target = realpathSync(fullPath) } catch { return true } // 悬空链接
      if ((target + sep).toLowerCase().startsWith(prefix)) return true
    }
    return false
  }

  return { skipEntry, skipName: dshOwnDeps }
}

/**
 * 递归复制 `src` 到 `dest`，跳过 `skip` 里的名字，以及 `skipEntry` 判定为
 * dsh 管理 fallback 的链接。
 *
 * 这是本次开发中**同一个错误犯的第二次**（第一次在装配脚本里，见
 * docs/PACKAGING.md 约束 2），所以在这里也写清楚为什么必须这样做。
 */
function copyProfileTree (src, dest, { skip, skipEntry = null }) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const from = join(src, entry.name)
    if (skipEntry && skipEntry(entry, from)) continue
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyProfileTree(from, to, { skip, skipEntry })
    } else {
      // recursive:true 是必须的：Dirent 报的是链接本身，
      // 而实际源可能是目录（实测 '@agentclientprotocol/sdk/' 就是这种情况），
      // 少了它 cpSync 会以 "Recursive option not enabled" 直接失败。
      cpSync(from, to, { recursive: true, dereference: true, force: true })
    }
  }
}

/** dsh 自己管理的 fallback 命名空间；见 makeDshFallbackFilter 的说明。 */
const SKIP_IN_PROFILE_TREE = new Set(['@deepseek-ai'])

/**
 * 选定 harness home。优先级：
 *   1. DSH_PX_HOME —— 显式覆盖（也是在开发插件时，把外壳指向你现有 ~/.dsh 的方式）。
 *   2. <userData>/dsh-home —— 应用自己的 home：首次运行从随附的树播种，
 *      此后归用户所有。
 *
 * 首启播种的实测数据：随附种子树约 30 万文件，同步复制耗时**约 3 分钟**。
 * 因此这里：先写认领标记、逐项检查可续传、并且把失败如实报出来 ——
 * 而不是让应用带着一个空壳 profile 启动、再表现出一堆莫名其妙的症状。
 * @param {any} runtime
 * @returns {string}
 */
function resolveHarnessHome (runtime) {
  if (process.env.DSH_PX_HOME) return resolve(process.env.DSH_PX_HOME)

  const home = join(app.getPath('userData'), 'dsh-home')
  const marker = join(home, '.dsh-px-seed-claimed')
  const profileManifest = join(home, 'profiles', PROFILE_NAME, 'package.json')

  // 已经播种完整：直接用。
  if (existsSync(profileManifest)) return home

  // 认领这次播种。先落盘，这样即便中途被打断也能看出这是哪一次尝试。
  mkdirSync(home, { recursive: true })
  writeFileSync(marker, `claimed at ${new Date().toISOString()}\nseedSource=${runtime.seedHome ?? '(none)'}\n`)

  if (!runtime.seedHome) {
    mkdirSync(join(home, 'profiles'), { recursive: true })
    process.stdout.write('[dsh-px] 警告：随附运行时里没有种子 home，profile 需要自行初始化\n')
    return home
  }

  // 逐个子项复制并记录：中断后可精确续传，也便于在日志里定位卡在哪一项。
  const items = ['profiles', 'settings.yaml', '.credentials.yaml']
  for (const item of items) {
    const from = join(runtime.seedHome, item)
    if (!existsSync(from)) continue
    const to = join(home, item)
    process.stdout.write(`[dsh-px] 首次运行：正在准备 ${item}（首次约需数分钟，请稍候）…\n`)
    try {
      if (item === 'profiles') {
        // profiles/ 下有两棵 node_modules，处理方式完全不同：
        //
        //   profiles/node_modules          —— **整体跳过**。实测开发机上它有 164 个
        //     Junction（全部指向 dsh 包树）+ 23 个实体目录，而那 23 个全是 dsh 自己的
        //     依赖作用域（@aws-sdk、@octokit、@opentelemetry、@anthropic-ai、
        //     @deepseek-ai …）。也就是说它整棵就是 dsh 托管的 fallback 树，
        //     不含任何插件依赖；dsh 首启会自行重建。
        //     （曾试图按名字过滤：不可行 —— dsh 的传递依赖闭包很大，
        //       `argparse` 这类不在其直接依赖清单里，逐个枚举必然漏。）
        //
        //   profiles/<name>/node_modules   —— **有选择地复制**。这里才混着真插件依赖
        //     （mermaid、@codemirror、node-pty、react…）与 dsh 管理的链接。
        const { skipEntry, skipName } = makeDshFallbackFilter(join(runtime.root, 'dsh'))
        const isTopLevelModules = (entry, fullPath) =>
          entry.name === 'node_modules' && dirname(fullPath) === from
        copyProfileTree(from, to, {
          skip: new Set([...SKIP_IN_PROFILE_TREE, ...skipName]),
          skipEntry: (entry, fullPath) => isTopLevelModules(entry, fullPath) || skipEntry(entry, fullPath)
        })
      } else {
        cpSync(from, to, { recursive: true, dereference: true, force: false, errorOnExist: false })
      }
    } catch (err) {
      // 不吞掉：把真实原因告诉用户，否则应用会以一个空壳 profile 启动。
      const detail = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[dsh-px] 准备 ${item} 失败：${detail}\n`)
      dialog.showErrorBox(
        'dsh-px —— 首次运行准备失败',
        `无法把随附的运行时复制到：\n${home}\n\n失败项：${item}\n原因：${detail}\n\n` +
        '可尝试：删除该目录后重新启动；或检查磁盘空间与杀毒软件拦截。'
      )
      throw err
    }
  }

  writeFileSync(join(home, '.dsh-px-seeded'), `seeded from ${runtime.seedHome} at ${new Date().toISOString()}\n`)
  process.stdout.write('[dsh-px] 首次运行准备完成\n')
  return home
}

/**
 * 找一个空闲 TCP 端口，优先使用 `preferred`，
 * 这样如果默认端口上已经有一个 harness 在跑，就会被复用而不是重复起一个。
 * @param {number} preferred
 * @returns {Promise<number>}
 */
function findPort (preferred) {
  return new Promise((res) => {
    const probe = (port) => {
      const srv = createServer()
      srv.once('error', () => probe(port + 1))
      srv.once('listening', () => srv.close(() => res(port)))
      srv.listen(port, HOST)
    }
    probe(preferred)
  })
}

/**
 * 轮询 harness 的 HTTP 面直到有应答。任何 HTTP 状态码
 * （包括来自浏览器信任围栏的 401）都证明服务器已在监听；
 * 我们真正在等的是"连接被拒绝"这件事结束。
 * @param {string} url
 * @param {number} timeoutMs
 */
async function waitForReady (url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastErr = 'no attempt made'
  while (Date.now() < deadline) {
    if (harness && harness.exitCode !== null) {
      throw new Error(`harness exited early with code ${harness.exitCode}`)
    }
    try {
      const res = await fetch(url, { redirect: 'manual' })
      return res.status
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    await new Promise((r) => setTimeout(r, 350))
  }
  throw new Error(`harness did not become ready within ${timeoutMs}ms (last error: ${lastErr})`)
}

/**
 * harness 用一个**进程级启动令牌**围栏它的浏览器面：
 * 干净的 `http://127.0.0.1:<端口>/` 会返回 401，只有 `dsh web` 宣告的那个 URL
 * （`authenticatedUrl()` = 干净 URL 加上进程令牌）才能把令牌换成签名的浏览器会话 cookie。
 *
 * 所以外壳**不能猜** URL —— 它要读取 harness 打印出来的那一个。
 * 干净 URL 仍作为就绪探针；真正加载的是宣告出来的 URL。
 * @param {string} text
 * @returns {string | null}
 */
function extractAuthenticatedUrl (text) {
  const match = text.match(/dsh web:\s*(http:\/\/\S+)/)
  return match ? match[1] : null
}

/**
 * 拉起随附的 harness，并在它宣告出自己的鉴权 URL 后兑现 Promise。
 * @param {{runtime:any, home:string, port:number}} opts
 * @returns {{child: import('node:child_process').ChildProcess, authUrl: Promise<string|null>}}
 */
function startHarness ({ runtime, home, port }) {
  const args = [runtime.dshEntry, '--profile', PROFILE_NAME, '--host', HOST, '--port', String(port), '--no-open']
  const env = {
    ...process.env,
    DSH_HOME: home,
    DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE ?? 'workspace-write',
    // 告诉 dsh 侧插件真正的运行时根目录。
    //
    // 为什么必须由外壳注入：随附插件安装在**用户数据目录**（<userData>/dsh-home），
    // 它按自身位置上溯只能找到**安装目录**里的 runtime，而那里不是活动的那一份。
    // 外壳恰好知道正确路径，所以由外壳显式告知，比让插件去猜可靠。
    // 应用版本不在这里传 —— 它写进了 runtime-manifest.json，那才是唯一真相源
    // （Electron 的 app.getVersion() 在开发态返回的是 Electron 自身版本）。
    DSH_PX_RUNTIME_ROOT: runtime.root,
    // Electron 自带自己的 Node；harness 必须跑在随附的那个运行时上。
    NODE_OPTIONS: '',
    ELECTRON_RUN_AS_NODE: '1'
  }
  const child = spawn(runtime.node, args, {
    env,
    cwd: app.getPath('home'),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  let announced = ''
  let settle
  const authUrl = new Promise((res) => { settle = res })

  const consume = (chunk) => {
    const text = chunk.toString()
    announced += text
    process.stdout.write(`[dsh] ${text}`)
    if (settle) {
      const url = extractAuthenticatedUrl(announced)
      if (url) { const done = settle; settle = null; done(url) }
    }
  }
  child.stdout?.on('data', consume)
  child.stderr?.on('data', consume)

  child.on('exit', (code, signal) => {
    process.stdout.write(`[dsh] harness exited code=${code} signal=${signal}\n`)
    harness = null
    // 解除仍在等待 URL 的那一方，好让调用方报告"提前退出"，
    // 而不是一直挂到就绪超时。
    if (settle) { const done = settle; settle = null; done(null) }
    if (!quitting) {
      dialog.showErrorBox('dsh-px',
        `harness 进程意外退出（code ${code}）。\n\n最后的输出：\n${announced.slice(-1500)}`)
    }
  })

  return { child, authUrl }
}

function createWindow (url) {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#111318',
    // 标题栏固定显示应用名，而不是跟随页面。
    // Electron 默认行为是让页面里的 document.title 覆盖窗口标题，而 dsh 的
    // Web UI 会把标题设成**当前会话名**（用户实测看到的就是会话名）。
    // 光在这里设 title 不够 —— 必须在下面拦截 page-title-updated。
    title: `DSH-PX ${app.getVersion()}`,
    autoHideMenuBar: true,
    webPreferences: {
      // harness 前端是一个可信的本地源；别把 Node 暴露进去。
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  // 阻止页面改写窗口标题（dsh 的 UI 会把它设成会话名）。
  // 这是桌面客户端该有的行为：窗口标题标识**应用**，不是标识当前文档。
  win.on('page-title-updated', (event) => {
    event.preventDefault()
    win?.setTitle(`DSH-PX ${app.getVersion()}`)
  })

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => { win = null })

  // 外部链接交给真正的浏览器打开，绝不在外壳里打开。
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://127.0.0.1') || target.startsWith('http://localhost')) {
      return { action: 'allow' }
    }
    void shell.openExternal(target)
    return { action: 'deny' }
  })

  void win.loadURL(url)
  return win
}

/** 最近一次检查到的更新状态，供托盘菜单显示。 */
let updateState = { status: '未检查', version: null }

/**
 * 配置并触发外壳自身的更新检查。
 *
 * 这里刻意把"检查"与"安装"分开：检查是静默的、后台的；安装必须由用户确认，
 * 因为它会重启应用。这也是主流桌面应用的做法。
 * @returns {void}
 */
function setupAutoUpdate () {
  if (!autoUpdater) return
  // 不自动下载：让用户先看到"有新版本 + 更新内容"，再决定是否下载安装。
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    updateState = { status: '正在检查更新…', version: null }
  })
  autoUpdater.on('update-not-available', (info) => {
    updateState = { status: '已是最新版本', version: info?.version ?? app.getVersion() }
    process.stdout.write('[dsh-px] 已是最新版本\n')
  })
  autoUpdater.on('update-available', async (info) => {
    updateState = { status: `有新版本 ${info.version}`, version: info.version }
    process.stdout.write(`[dsh-px] 发现新版本 ${info.version}\n`)

    // **不再弹模态对话框。**
    //
    // 用户反馈："更新怎么是弹窗？" —— 这是对的批评。Curosr / Codex / VS Code
    // 这类成熟产品都不会用模态弹窗打断工作：更新是后台行为，只需一个不打扰的
    // 提示 + 用户主动确认。模态框会夺走焦点、挡住正在看的界面，且必须处理掉
    // 才能继续用 —— 对一个"每天开着"的客户端来说这是明显的体验倒退。
    //
    // 现在的行为：
    //   - 后台静默下载（不打断任何操作）
    //   - 托盘图标 + 菜单显示进度与状态
    //   - 下载完成后发一条系统通知，并在托盘菜单提供"重启并安装"
    //   - 退出应用时自动安装（autoInstallOnAppQuit）
    //   - 仅在用户**主动点击**"手动检查更新"且已是最新时，才给一个反馈弹窗
    //     （那是用户发起的动作，需要回执；后台检查不需要）
    //
    // DSH_PX_AUTO_UPDATE=1 保留：语义是"连系统通知也不发"，供自动化/无人值守。
    const silent = process.env.DSH_PX_AUTO_UPDATE === '1'
    process.stdout.write('[dsh-px] 开始后台下载更新（不打断使用）\n')

    autoUpdater.on('download-progress', (p) => {
      updateState = { status: `正在下载 ${Math.round(p.percent)}%`, version: info.version }
      process.stdout.write(`\r[dsh-px] 下载 ${p.percent.toFixed(1)}% (${(p.transferred / 1048576).toFixed(1)}MB/${(p.total / 1048576).toFixed(1)}MB)`)
      refreshTray()
    })
    autoUpdater.on('update-downloaded', async (done) => {
      process.stdout.write('\n')
      updateState = { status: `已下载 ${done.version}，待重启安装`, version: done.version }
      process.stdout.write(`[dsh-px] 更新已下载完成：${done.version}\n`)
      refreshTray()
      if (silent) {
        process.stdout.write('[dsh-px] 静默模式：将在退出时安装\n')
        return
      }
      // 系统通知而非模态框：不夺焦点、不阻塞。
      try {
        const n = new Notification({
          title: 'DSH-PX 更新已就绪',
          body: `新版本 ${done.version} 已下载完成。可从托盘菜单选择"重启并安装"，或在退出应用时自动安装。`
        })
        n.on('click', () => { if (win) { win.show(); win.focus() } })
        n.show()
      } catch {
        // 某些环境不支持通知；托盘状态仍会显示，不影响使用。
      }
    })
    autoUpdater.on('error', (err) => {
      updateState = { status: '更新失败', version: null }
      process.stderr.write(`[dsh-px] 更新出错：${err?.message ?? err}\n`)
    })

    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      dialog.showErrorBox('下载更新失败', String(err?.message ?? err))
    }
  })

  // 打包态才有 app-update.yml；开发态直接跳过，避免噪音报错。
  if (!app.isPackaged) {
    process.stdout.write('[dsh-px] 开发态，跳过自动更新检查\n')
    return
  }
  // 启动后延后 8 秒再查，避免和 harness 启动抢资源/抢网络。
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      process.stdout.write(`[dsh-px] 检查更新失败：${err?.message ?? err}\n`)
    })
  }, 8000)
}

/**
 * 取托盘图标。
 *
 * 历史教训（用户实测"托盘还是没有鲸鱼娘图标"）：最初用
 * `app.getFileIcon(process.execPath)` 从可执行文件提取 —— 开发态下 execPath 是
 * electron.exe，于是拿到 **Electron 默认图标**；即使打包态能拿到鲸鱼图标，
 * 这种"依赖从 exe 提取"的做法也是脆的。
 *
 * 正确做法是**自带专用托盘图标资源**（桌面应用通行做法）：
 * 构建时产出 tray-16/32.png，经 extraResources 放进 resources/，运行期直接读。
 * 顺序：打包态资源 → 开发态 build/ → exe 图标兜底 → 内存绘制兜底。
 * @returns {Promise<import('electron').NativeImage>}
 */
async function trayImage () {
  const candidates = [
    // 打包态：extraResources 落在 resources/ 下
    process.resourcesPath ? join(process.resourcesPath, 'tray-32.png') : null,
    process.resourcesPath ? join(process.resourcesPath, 'tray-16.png') : null,
    // 开发态：仓库 build/ 目录
    join(APP_ROOT, 'build', 'tray-32.png'),
    join(APP_ROOT, 'build', 'tray-16.png')
  ].filter(Boolean)

  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) {
          process.stdout.write(`[dsh-px] 托盘图标：${p}\n`)
          return img
        }
      }
    } catch { /* 试下一个 */ }
  }

  // 兜底 1：从可执行文件提取（打包态通常就是应用自己的图标）
  try {
    const exeIcon = await app.getFileIcon(process.execPath, { size: 'small' })
    if (exeIcon && !exeIcon.isEmpty()) {
      process.stdout.write('[dsh-px] 托盘图标：从可执行文件提取（兜底）\n')
      return exeIcon
    }
  } catch { /* 继续 */ }

  // 兜底 2：在内存里画一个 16×16 蓝色方块，保证托盘项至少可见可点。
  process.stdout.write('[dsh-px] 托盘图标：使用内存绘制兜底\n')
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i += 1) {
    buf[i * 4 + 0] = 0x2e   // B
    buf[i * 4 + 1] = 0x6b   // G
    buf[i * 4 + 2] = 0xe6   // R
    buf[i * 4 + 3] = 0xff   // A
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

function createTray (url) {
  try {
    // 先用空图标同步构造，避免 await 期间托盘项缺失；随后替换为真实图标。
    tray = new Tray(nativeImage.createEmpty())
    tray.setToolTip(`DSH-PX ${app.getVersion()}`)
    void trayImage().then((img) => {
      try { tray?.setImage(img) } catch { /* 托盘可能已销毁 */ }
    })
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(url)))
    tray.on('double-click', () => { win?.show(); win?.focus() })
  } catch {
    // 托盘是尽力而为的；无头/CI 环境没有通知区域。
  }
}

/**
 * 构造托盘菜单。
 *
 * 独立成函数是为了能**重建**菜单：更新状态会变化（正在下载 42% → 已就绪），
 * 而 Electron 的托盘菜单是快照，改状态必须重新 setContextMenu。
 * @param {string} url 兜底打开地址（无窗口时用）
 * @returns {import('electron').MenuItemConstructorOptions[]}
 */
function buildTrayMenu (url) {
  const readyToInstall = updateState.version && updateState.status.includes('待重启安装')
  const items = [
    { label: `DSH-PX ${app.getVersion()}`, enabled: false },
    { label: updateState.status, enabled: false }
  ]

  // 下载完成后，把"重启并安装"提到最显眼的位置 —— 这是用户此刻唯一要做的事。
  if (readyToInstall) {
    items.push({ type: 'separator' })
    items.push({
      label: `重启并安装 ${updateState.version}`,
      click: () => {
        quitting = true
        if (harness && harness.exitCode === null) harness.kill()
        autoUpdater?.quitAndInstall()
      }
    })
  }

  items.push(
    { label: '手动检查更新', click: () => void checkUpdatesManually() },
    { type: 'separator' },
    { label: '打开 DSH-PX', click: () => { if (win) { win.show(); win.focus() } else { createWindow(url) } } },
    { label: '重启 harness', click: () => void restartHarness() },
    { type: 'separator' },
    { label: '打开日志文件', click: () => void shell.openPath(logPath()) },
    { label: '打开数据目录', click: () => void shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: '在浏览器中打开', click: () => void shell.openExternal(currentCleanUrl ?? url) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } }
  )
  return items
}

/** 重建托盘菜单以反映最新状态（下载进度、更新就绪等）。 */
function refreshTray (url) {
  try {
    tray?.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(url ?? currentCleanUrl ?? '')))
  } catch { /* 托盘可能尚未创建或已销毁 */ }
}

/**
 * 用户主动触发的更新检查。与后台检查的区别只在于反馈方式：
 * 无论结果如何都要给一个明确回执，不能"点了没反应"。
 * @returns {Promise<void>}
 */
async function checkUpdatesManually () {
  if (!autoUpdater) {
    dialog.showMessageBox({ type: 'info', message: '开发态不支持自动更新', detail: '打包后的应用才会启用此功能。' })
    return
  }
  if (!app.isPackaged) {
    dialog.showMessageBox({ type: 'info', message: '开发态不支持自动更新', detail: `当前版本 ${app.getVersion()}。请使用打包后的应用。` })
    return
  }
  try {
    const res = await autoUpdater.checkForUpdates()
    if (!res?.updateInfo) {
      dialog.showMessageBox({ type: 'info', message: '已是最新版本', detail: `当前版本 ${app.getVersion()}` })
    }
    // 有新版本时由 update-available 事件接管并弹下载确认。
  } catch (err) {
    dialog.showErrorBox('检查更新失败', String(err?.message ?? err))
  }
}

/**
 * 关掉当前 harness 并重新拉起一个，然后把窗口重新指向新的鉴权 URL。
 *
 * 为什么必须有这个功能：组合包成员的变动**只在启动时生效**
 * （见 docs/PACKAGING.md 约束 5）。从市场里装完插件后，插件已经是"看得见但不起作用"，
 * 只有重启 harness 才会真正挂载。
 *
 * 这里刻意不复用旧端口：旧进程释放端口有延迟，
 * 重新探测端口比跟 TIME_WAIT 抢更可靠。
 * @returns {Promise<boolean>} 是否重启成功
 */
async function restartHarness () {
  if (!ctxState) return false
  const { runtime, home } = ctxState

  process.stdout.write('[dsh-px] 正在重启 harness\n')
  if (harness && harness.exitCode === null) {
    const dying = harness
    dying.removeAllListeners('exit')
    dying.kill()
    // 给旧进程一点时间释放句柄，避免新旧实例互相干扰。
    await new Promise((res) => {
      const t = setTimeout(res, 4000)
      dying.once('exit', () => { clearTimeout(t); res() })
    })
  }

  const port = await findPort(DEFAULT_PORT)
  ctxState = { runtime, home, port }
  const cleanUrl = `http://${HOST}:${port}/`
  currentCleanUrl = cleanUrl

  const started = startHarness({ runtime, home, port })
  harness = started.child

  try {
    const status = await waitForReady(cleanUrl, READY_TIMEOUT_MS)
    process.stdout.write(`[dsh-px] 新 harness 已监听（HTTP ${status}）于 ${cleanUrl}\n`)
    const authUrl = await Promise.race([
      started.authUrl,
      new Promise((res) => setTimeout(() => res(null), 20_000))
    ])
    if (!authUrl) {
      process.stdout.write('[dsh-px] 警告：未捕获到宣告的 URL；加载干净 URL（预期会撞 401 围栏）\n')
      return false
    }
    if (win) {
      await win.loadURL(authUrl)
      win.show()
      win.focus()
    }
    createTray(cleanUrl)
    return true
  } catch (err) {
    dialog.showErrorBox('dsh-px —— 重启 harness 失败', String(err?.message ?? err))
    return false
  }
}

async function main () {
  const runtime = resolveRuntime()
  if (!runtime) {
    dialog.showErrorBox(
      'dsh-px —— 缺少运行时',
      '没有找到随附的运行时。\n\n请先执行 `npm run stage` 装配它，然后重新启动。'
    )
    app.exit(1)
    return
  }

  const home = resolveHarnessHome(runtime)
  const port = await findPort(DEFAULT_PORT)
  const cleanUrl = `http://${HOST}:${port}/`
  ctxState = { runtime, home, port }
  currentCleanUrl = cleanUrl

  process.stdout.write(`[dsh-px] node=${runtime.node}\n[dsh-px] dsh=${runtime.dshEntry}\n[dsh-px] DSH_HOME=${home}\n[dsh-px] url=${cleanUrl}\n`)

  const started = startHarness({ runtime, home, port })
  harness = started.child

  let openUrl = cleanUrl
  try {
    const status = await waitForReady(cleanUrl, READY_TIMEOUT_MS)
    process.stdout.write(`[dsh-px] harness listening (HTTP ${status}) at ${cleanUrl}\n`)
    // 优先使用 harness 宣告的 URL：它带着进程启动令牌；
    // 加载干净 URL 只会在浏览器围栏上撞到 401。
    const authUrl = await Promise.race([
      started.authUrl,
      new Promise((res) => setTimeout(() => res(null), 20_000))
    ])
    if (authUrl) {
      openUrl = authUrl
      process.stdout.write('[dsh-px] using harness-announced authenticated URL\n')
    } else {
      process.stdout.write('[dsh-px] WARNING: no announced URL captured; loading the clean URL (expect a 401 fence)\n')
    }
  } catch (err) {
    dialog.showErrorBox('dsh-px —— harness 启动失败', String(err?.message ?? err))
    quitting = true
    app.quit()
    return
  }

  createWindow(openUrl)
  createTray(cleanUrl)
  setupAutoUpdate()
}

app.on('window-all-closed', () => {
  // 一个没有窗口却还在运行的桌面客户端是维护负担；
  // 因此在所有平台上都随窗口一起退出。
  quitting = true
  app.quit()
})

app.on('before-quit', () => { quitting = true })

app.on('will-quit', () => {
  if (harness && harness.exitCode === null) {
    process.stdout.write('[dsh-px] stopping harness\n')
    harness.kill()
  }
})

/**
 * 单实例锁：第二次启动时聚焦已有窗口，而不是再起一个 harness。
 * 两个 harness 共享同一份 DSH_HOME 会导致会话互相踩，所以这个必须拦住。
 */
if (!app.requestSingleInstanceLock()) {
  process.stdout.write('[dsh-px] 已经有一个实例在运行，退出本次启动\n')
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady()
    .then(() => {
      // 最先打开日志文件：越早越好，这样连 main() 里的准备工作也被记录。
      openLogFile()
      return main()
    })
    .catch((err) => {
      dialog.showErrorBox(
        'DSH-PX —— 启动异常',
        `${String(err?.stack ?? err)}\n\n日志文件：${logPath()}`
      )
      app.exit(1)
    })
}
