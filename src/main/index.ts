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

/** 从 unknown 的 catch 变量里安全取出可读消息（strict 下 catch 变量是 unknown）。 */
function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, createWriteStream } from 'node:fs'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import type { WriteStream } from 'node:fs'
import type { NativeImage, MenuItemConstructorOptions, Event as ElectronEvent } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { materializeSeedHome } from './materialize'
import type { SeedProgress } from './materialize'
import { setUpdateState, watchInstallRequests } from './update-bridge'
import type { UpdateBridgeState } from './update-bridge'

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
let autoUpdater: AppUpdater | null = null
try {
  ({ autoUpdater } = require('electron-updater'))
} catch (err) {
  // 开发态（未打包）下通常拿不到 app-update.yml，属正常，不应致命。
  process.stdout.write(`[dsh-px] electron-updater 不可用（开发态正常）：${errText(err)}\n`)
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
const LOG_BUFFER: string[] = []
let LOG_STREAM: WriteStream | null = null
let LOG_PATH: string | null = null

/** 追加文本到日志缓冲或文件。 */
function appendLog (text: string): void {
  const line = text.endsWith('\n') ? text : text + '\n'
  if (LOG_STREAM) {
    try { LOG_STREAM.write(line) } catch { /* 日志写入失败不该影响应用 */ }
  } else if (LOG_BUFFER.length < 5000) {
    LOG_BUFFER.push(line)   // 缓冲上限，避免 ready 之前无限增长
  }
}

/** 劫持标准输出/错误，使所有既有输出自动进日志。 */
function teeStdio (): void {
  // 写入回调的窄化别名：只需保留"可选的错误回调"这一位置，不复制 node 的整组重载。
  type WriteCallback = (err?: Error | null) => void
  for (const [stream, tag] of [[process.stdout, 'out'], [process.stderr, 'err']] as const) {
    const original = stream.write.bind(stream)
    stream.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | WriteCallback, cb?: WriteCallback): boolean => {
      try {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        appendLog(tag === 'err'
          ? text.split('\n').map((l) => (l ? `[stderr] ${l}` : l)).join('\n')
          : text)
      } catch { /* 忽略 */ }
      // 只需窄化 `original` 的编码参数位置，行为与原 .mjs 完全一致。
      return (original as (chunk: string | Uint8Array, encoding?: BufferEncoding, cb?: WriteCallback) => boolean)(chunk, encoding as BufferEncoding, cb)
    }) as typeof stream.write
  }
}

/**
 * 应用自身版本号。
 *
 * 注意**不能只看 `app.getVersion()`**：开发态（未打包）时它返回的是 **Electron 的版本**
 * （实测日志里出现 "版本 38.8.6"，而应用是 0.1.0-beta.8），会把排查带偏。
 * 因此开发态回退到仓库 package.json 的 version；打包态才是权威的应用版本。
 */
function appVersion (): string {
  if (app.isPackaged) return app.getVersion()
  try {
    return (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? app.getVersion()
  } catch {
    return app.getVersion()
  }
}

/** app ready 后打开日志文件，并把缓冲刷进去。 */
function openLogFile (): void {
  try {
    LOG_PATH = join(app.getPath('userData'), 'dsh-px.log')
    mkdirSync(dirname(LOG_PATH), { recursive: true })
    LOG_STREAM = createWriteStream(LOG_PATH, { flags: 'a' })
    LOG_STREAM.write(`\n${'='.repeat(70)}\n`)
    LOG_STREAM.write(`[dsh-px] 启动 ${new Date().toISOString()}  版本 ${appVersion()}  平台 ${process.platform}\n`)
    LOG_STREAM.write(`[dsh-px] electron=${process.versions.electron ?? '(非 Electron)'} node=${process.versions.node} packaged=${app.isPackaged}\n`)
    for (const line of LOG_BUFFER) LOG_STREAM.write(line)
    LOG_BUFFER.length = 0
  } catch {
    LOG_STREAM = null   // 日志失败绝不阻断启动
  }
}

/** 日志文件路径（错误弹窗里告知用户）。 */
function logPath (): string {
  return LOG_PATH ?? '(尚未初始化)'
}

teeStdio()

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 仓库/应用根目录。
 *
 * 由 `HERE` 向上找最近的、带 `package.json` 的祖先，而不是写死退几层：
 * 这段代码的来源路径会随构建方式变化 —— 迁移前是 `<app>/app/main.mjs`（退一层），
 * 现在是 `<app>/out/main/index.js`（**要退两层**）。曾因写死 `resolve(HERE, '..')`
 * 而把根算成 `<app>/out`，导致 `resolveRuntime()` 找不到随附运行时、
 * 应用起来只弹一个模态错误框（进程还在，但既无日志也无端口），极难排查。
 * 按「带 package.json 的祖先」判断对上述两种布局以及将来换 outDir 都成立。
 */
function findAppRoot (from: string): string {
  let dir = from
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return resolve(from, '..')   // 兜底：维持旧行为，不外抛
}

const APP_ROOT = findAppRoot(HERE)
const PROFILE_NAME = process.env.DSH_PX_PROFILE ?? 'web'
const HOST = '127.0.0.1'
const DEFAULT_PORT = Number(process.env.DSH_PX_PORT ?? 3080)
/** 等待 harness 的 HTTP 面给出应答的上限；超时即判定启动失败。 */
const READY_TIMEOUT_MS = Number(process.env.DSH_PX_READY_TIMEOUT_MS ?? 180_000)

let harness: ChildProcess | null = null
let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

/** 已装配的运行时描述（`resolveRuntime` 的返回值）。 */
interface RuntimeDescriptor {
  /** 运行时根目录（`…/runtime`）。 */
  root: string
  /** 随附的 node 可执行文件路径。 */
  node: string
  /** 随附的 dsh CLI 入口（`…/dsh/lib/bin.js`）。 */
  dshEntry: string
  /** 随附的种子 home；随附运行时里没有该目录时为 null。 */
  seedHome: string | null
}

/** 拉起 harness 所需的全部状态（profile home 与端口）。 */
interface HarnessContext {
  runtime: RuntimeDescriptor
  home: string
  port: number
}

/**
 * 拉起 harness 所需的全部状态。重启 harness 时要重新求值，
 * 所以单独存起来而不是散落在 main 里。
 */
let ctxState: HarnessContext | null = null
/** 当前窗口应加载的干净 URL（重启后端口可能变，所以要跟着更新）。 */
let currentCleanUrl: string | null = null

/**
 * 解析已装配的运行时。支持三种布局，使同一份代码在开发态和安装后都能跑：
 *   显式覆盖：$DSH_PX_RUNTIME_ROOT —— 与启动 harness 时传给它的同名变量保持一致
 *   打包后：  <resources>/runtime/{node,dsh,dsh-home}
 *   开发态：  <仓库>/runtime/{node,dsh,dsh-home}
 *
 * 找不到时把**试过哪些路径**写进日志：这个函数返回 null 只会导致一个模态错误框，
 * 而模态框在无人值守/自动化场景下看起来就是"进程卡住"，没有候选路径几乎无法排查。
 */
function resolveRuntime (): RuntimeDescriptor | null {
  const roots: string[] = []
  const override = process.env.DSH_PX_RUNTIME_ROOT
  if (override) roots.push(resolve(override))
  if (process.resourcesPath) roots.push(join(process.resourcesPath, 'runtime'))
  roots.push(join(APP_ROOT, 'runtime'))

  const tried: string[] = []
  for (const root of roots) {
    const node = process.platform === 'win32'
      ? join(root, 'node', 'node.exe')
      : join(root, 'node', 'bin', 'node')
    const dshEntry = join(root, 'dsh', 'lib', 'bin.js')
    const seedHome = join(root, 'dsh-home')
    if (existsSync(node) && existsSync(dshEntry)) {
      return { root, node, dshEntry, seedHome: existsSync(seedHome) ? seedHome : null }
    }
    tried.push(`${root}（node=${existsSync(node) ? '有' : '无'} dsh=${existsSync(dshEntry) ? '有' : '无'}）`)
  }
  process.stdout.write(`[dsh-px] 未找到随附运行时，已尝试：\n${tried.map((t) => `  - ${t}`).join('\n')}\n`)
  return null
}

/**
 * 选定并准备 harness home。优先级：
 *   1. DSH_PX_HOME —— 显式覆盖（也是在开发插件时，把外壳指向你现有 ~/.dsh 的方式）。
 *   2. <userData>/dsh-home —— 应用自己的 home：首次运行从随附的树物化，
 *      此后归用户所有。
 *
 * 物化用**硬链接**（见 materialize.ts）：同卷首启实测 3.5 秒，跨卷自动回退到
 * 逐文件复制并给出进度。旧实现是同步整树复制，实测 4–5 分钟且界面冻结。
 *
 * 完成判据用 `.dsh-px-materialized` 标记**并**实际核对 profile 清单存在：
 * 只认标记会在"标记写了但物化被中断"时错误地跳过准备，让应用带着空壳 profile 启动。
 */
async function resolveHarnessHome (
  runtime: RuntimeDescriptor,
  onProgress: (p: SeedProgress) => void
): Promise<string> {
  if (process.env.DSH_PX_HOME) return resolve(process.env.DSH_PX_HOME)

  const home = join(app.getPath('userData'), 'dsh-home')
  const doneMarker = join(home, '.dsh-px-materialized')
  const profileManifest = join(home, 'profiles', PROFILE_NAME, 'package.json')

  // 已经物化完整：直接用（二次启动零开销）。
  if (existsSync(doneMarker) && existsSync(profileManifest)) return home

  // 认领这次物化。先落盘，这样即便中途被打断也能看出这是哪一次尝试。
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, '.dsh-px-seed-claimed'),
    `claimed at ${new Date().toISOString()}\nseedSource=${runtime.seedHome ?? '(none)'}\n`)

  if (!runtime.seedHome) {
    mkdirSync(join(home, 'profiles'), { recursive: true })
    process.stdout.write('[dsh-px] 警告：随附运行时里没有种子 home，profile 需要自行初始化\n')
    return home
  }

  process.stdout.write('[dsh-px] 首次运行：正在从随附运行时准备本地数据目录…\n')
  try {
    const r = await materializeSeedHome({
      seedHome: runtime.seedHome,
      home,
      profileName: PROFILE_NAME,
      dshDir: join(runtime.root, 'dsh'),
      onProgress
    })
    process.stdout.write(
      `[dsh-px] 首次运行准备完成：硬链接 ${r.linked}、复制 ${r.copied}、跳过 ${r.skipped}、` +
      `共 ${r.total} 项，耗时 ${(r.ms / 1000).toFixed(1)} 秒\n`
    )
  } catch (err) {
    // 不吞掉：把真实原因告诉用户，否则应用会以一个空壳 profile 启动。
    const detail = errText(err)
    process.stderr.write(`[dsh-px] 首次运行准备失败：${detail}\n`)
    dialog.showErrorBox(
      'dsh-px —— 首次运行准备失败',
      `无法把随附的运行时准备到：\n${home}\n\n原因：${detail}\n\n` +
      '可尝试：删除该目录后重新启动；或检查磁盘空间与杀毒软件拦截。'
    )
    throw err
  }

  return home
}

/**
 * 找一个空闲 TCP 端口，优先使用 `preferred`，
 * 这样如果默认端口上已经有一个 harness 在跑，就会被复用而不是重复起一个。
 */
function findPort (preferred: number): Promise<number> {
  return new Promise((res) => {
    const probe = (port: number): void => {
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
 */
async function waitForReady (url: string, timeoutMs: number): Promise<number> {
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
      lastErr = err instanceof Error ? errText(err) : String(err)
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
 */
function extractAuthenticatedUrl (text: string): string | null {
  const match = text.match(/dsh web:\s*(http:\/\/\S+)/)
  return match ? match[1] : null
}

/** 拉起 harness 的结果：子进程句柄 + 宣告鉴权 URL 的 Promise。 */
interface HarnessStartResult {
  child: ChildProcess
  authUrl: Promise<string | null>
}

/**
 * 拉起随附的 harness，并在它宣告出自己的鉴权 URL 后兑现 Promise。
 */
function startHarness ({ runtime, home, port }: HarnessContext): HarnessStartResult {
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
    // 让随附插件能定位外壳的数据目录 —— 更新状态桥（update-bridge）就在这里。
    // 插件在 harness 里跑，拿不到 Electron 的 app.getPath()，只能由外壳告知。
    DSH_PX_USER_DATA: app.getPath('userData'),
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
  let settle: ((value: string | null) => void) | null = null
  const authUrl = new Promise<string | null>((res) => { settle = res })

  const consume = (chunk: Buffer): void => {
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

/**
 * 首启/重启进度页的路径。
 *
 * 由 electron-vite 的 renderer 目标构建（源在 `src/renderer/index.html`）。
 * 之所以做成真入口而不是主进程里的 HTML 模板字符串，见 `src/renderer/splash.ts`
 * 头部说明：一是页面可维护，二是 electron-vite 的
 * "renderer and preload config is missing" 警告无法在配置里关掉。
 *
 * 两种布局都要覆盖：
 *   开发态：`<repo>/out/renderer/index.html`
 *   打包后：`<app.asar>/out/renderer/index.html`
 */
function splashPagePath (): string | null {
  const candidates = [
    join(APP_ROOT, 'out', 'renderer', 'index.html'),
    join(app.getAppPath(), 'out', 'renderer', 'index.html')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  process.stderr.write(
    `[dsh-px] 未找到进度页（已试：${candidates.join('、')}）。是否漏跑了 npm run build？\n`
  )
  return null
}

/** 向进度页推送状态（页面可能已经切走，失败一律忽略）。 */
function reportSeedProgress (p: SeedProgress): void {
  if (!win || win.isDestroyed()) return
  const now = Date.now()
  // 节流：跨卷复制时进度会很密集，没必要每次都跨进程发。
  if (p.done < p.total && now - lastSeedPushAt < 120) return
  lastSeedPushAt = now
  const percent = p.total > 0 ? Math.min(99, Math.round((p.done / p.total) * 100)) : 0
  const detail = p.total > 0 ? `${p.done} / ${p.total} 项（${percent}%）` : ''
  // 调页面里那个唯一的入口（见 src/renderer/splash.ts）。
  void win.webContents.executeJavaScript(
    `window.__dshPxProgress?.(${JSON.stringify(p.phase)}, ${JSON.stringify(detail)})`
  ).catch(() => { /* 页面已切到 harness，正常 */ })
}

/** 进度推送节流时间戳。 */
let lastSeedPushAt = 0

/**
 * 创建窗口并先显示启动进度页。
 *
 * 返回 Promise 是因为进度页用 `loadFile` 从磁盘加载（异步）。调用方
 * **应当 await**，否则后面的进度推送可能赶在页面就绪之前发出 ——
 * 那些推送会被 `executeJavaScript` 静默丢弃，用户看到的就是一个
 * 永远停在"正在启动…"的窗口。
 */
async function createShellWindow (): Promise<BrowserWindow> {
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
    title: `DSH-PX ${appVersion()}`,
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
  win.on('page-title-updated', (event: ElectronEvent) => {
    event.preventDefault()
    win?.setTitle(`DSH-PX ${appVersion()}`)
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

  // 加载进度页。用 loadFile 从磁盘读（打包后在 app.asar 里），
  // 而不是 data: URL —— 这样页面是构建产物，可维护、可检查。
  const page = splashPagePath()
  if (page !== null) {
    await win.loadFile(page)
  } else {
    // 兜底：进度页缺失（例如漏跑构建）也要让窗口有内容，而不是一片空白，
    // 否则用户看到的是"应用卡死"。此时进度无法显示，但至少能看出在启动。
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="background:#111318;color:#e6e8ee;font-family:sans-serif;' +
      'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
      '正在启动 DSH-PX…</body>'
    ))
  }
  return win
}

/** 把窗口切到 harness 的真实地址。 */
async function loadHarnessUrl (url: string): Promise<void> {
  if (!win || win.isDestroyed()) return
  await win.loadURL(url)
  win.show()
  win.focus()
}

/** 最近一次检查到的更新状态。 */
interface UpdateState {
  status: string
  version: string | null
}

/** 最近一次检查到的更新状态，供托盘菜单显示。 */
let updateState: UpdateState = { status: '未检查', version: null }

/** 停止监听界面发来的安装请求（应用退出时调用）。 */
let stopInstallWatch: (() => void) | null = null

/**
 * 同步更新状态。
 *
 * 这是**唯一的**状态写入点：托盘菜单与界面（经 update-bridge）都从这里取，
 * 避免两处各自维护一份而慢慢不一致。曾经的状态散落在 6 个事件回调里各自赋值，
 * 加一处新消费方就得改 6 个地方。
 */
function publishUpdateState (next: UpdateState, bridge: Partial<Omit<UpdateBridgeState, 'updatedAt'>>): void {
  updateState = next
  setUpdateState(bridge)
  refreshTray()
}

/**
 * 配置并触发外壳自身的更新检查。
 *
 * 这里刻意把"检查"与"安装"分开：检查是静默的、后台的；安装必须由用户确认，
 * 因为它会重启应用。这也是主流桌面应用的做法。
 */
function setupAutoUpdate (): void {
  if (!autoUpdater) return
  // **开发态必须最先返回。** 下面会注册"界面请求安装"的监听，那条路径最终会
  // 退出应用；开发态响应它毫无意义，却会让调试中的实例被自己关掉
  // （实测：开发态 POST 一次 /install，harness 随即被 SIGTERM）。
  // 打包态才有 app-update.yml。
  if (!app.isPackaged) {
    process.stdout.write('[dsh-px] 开发态，跳过自动更新（含安装请求监听）\n')
    return
  }

  // 不自动下载：让用户先看到"有新版本 + 更新内容"，再决定是否下载安装。
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // 界面可以请求"重启并安装"（经插件端点 → 请求文件 → 这里）。
  // 这是界面侧唯一的写操作，且它只表达"用户点了按钮"，不携带任何参数 ——
  // 界面无法让外壳做别的事。
  stopInstallWatch = watchInstallRequests(() => {
    try {
      installUpdateNow()
    } catch (err) {
      process.stderr.write(`[dsh-px] 安装更新失败：${errText(err)}\n`)
    }
  })

  autoUpdater.on('checking-for-update', () => {
    publishUpdateState({ status: '正在检查更新…', version: null },
      { phase: 'checking', status: '正在检查更新…', version: null, percent: null, error: null })
  })
  autoUpdater.on('update-not-available', (info) => {
    const v = info?.version ?? appVersion()
    publishUpdateState({ status: '已是最新版本', version: v },
      { phase: 'idle', status: '已是最新版本', version: v, percent: null, error: null })
    process.stdout.write('[dsh-px] 已是最新版本\n')
  })
  autoUpdater.on('update-available', async (info) => {
    publishUpdateState({ status: `有新版本 ${info.version}`, version: info.version },
      { phase: 'downloading', status: `正在下载 ${info.version}`, version: info.version, percent: 0, error: null })
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
      publishUpdateState(
        { status: `正在下载 ${Math.round(p.percent)}%`, version: info.version },
        {
          phase: 'downloading',
          status: `正在下载 ${Math.round(p.percent)}%`,
          version: info.version,
          percent: Math.round(p.percent),
          error: null
        }
      )
      process.stdout.write(`\r[dsh-px] 下载 ${p.percent.toFixed(1)}% (${(p.transferred / 1048576).toFixed(1)}MB/${(p.total / 1048576).toFixed(1)}MB)`)
    })
    autoUpdater.on('update-downloaded', async (done) => {
      process.stdout.write('\n')
      publishUpdateState(
        { status: `已下载 ${done.version}，待重启安装`, version: done.version },
        { phase: 'ready', status: '已下载，待重启安装', version: done.version, percent: 100, error: null }
      )
      process.stdout.write(`[dsh-px] 更新已下载完成：${done.version}\n`)
      if (silent) {
        process.stdout.write('[dsh-px] 静默模式：将在退出时安装\n')
        return
      }
      // 系统通知而非模态框：不夺焦点、不阻塞。
      // 界面里同时会出现一条**非模态**的提示（设置页与本桥同一份状态）。
      try {
        const n = new Notification({
          title: 'DSH-PX 更新已就绪',
          body: `新版本 ${done.version} 已下载完成。可在界面或托盘菜单选择"重启并安装"，也会在退出时自动安装。`
        })
        n.on('click', () => { if (win) { win.show(); win.focus() } })
        n.show()
      } catch {
        // 某些环境不支持通知；界面与托盘状态仍会显示，不影响使用。
      }
    })
    autoUpdater.on('error', (err: unknown) => {
      const detail = errText(err)
      publishUpdateState({ status: '更新失败', version: null },
        { phase: 'error', status: '更新失败', version: null, percent: null, error: detail })
      process.stderr.write(`[dsh-px] 更新出错：${detail}\n`)
    })

    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      // 后台下载失败不该弹模态框打断用户：状态已经通过桥与托盘可见。
      publishUpdateState({ status: '更新失败', version: info.version },
        { phase: 'error', status: '下载更新失败', version: info.version, percent: null, error: errText(err) })
      process.stderr.write(`[dsh-px] 下载更新失败：${errText(err)}\n`)
    }
  })

  // 启动后延后 8 秒再查，避免和 harness 启动抢资源/抢网络。
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      process.stdout.write(`[dsh-px] 检查更新失败：${errText(err)}\n`)
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
 */
async function trayImage (): Promise<NativeImage> {
  const candidates = [
    // 打包态：extraResources 落在 resources/ 下
    process.resourcesPath ? join(process.resourcesPath, 'tray-32.png') : null,
    process.resourcesPath ? join(process.resourcesPath, 'tray-16.png') : null,
    // 开发态：仓库 build/ 目录
    join(APP_ROOT, 'build', 'tray-32.png'),
    join(APP_ROOT, 'build', 'tray-16.png')
  ].filter((p): p is string => Boolean(p))

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

function createTray (url: string): void {
  try {
    // 先用空图标同步构造，避免 await 期间托盘项缺失；随后替换为真实图标。
    tray = new Tray(nativeImage.createEmpty())
    tray.setToolTip(`DSH-PX ${appVersion()}`)
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
 * @param url 兜底打开地址（无窗口时用）
 */
function buildTrayMenu (url: string): MenuItemConstructorOptions[] {
  const readyToInstall = updateState.version && updateState.status.includes('待重启安装')
  const items: MenuItemConstructorOptions[] = [
    { label: `DSH-PX ${appVersion()}`, enabled: false },
    { label: updateState.status, enabled: false }
  ]

  // 下载完成后，把"重启并安装"提到最显眼的位置 —— 这是用户此刻唯一要做的事。
  if (readyToInstall) {
    items.push({ type: 'separator' })
    items.push({
      label: `重启并安装 ${updateState.version}`,
      click: () => { installUpdateNow() }
    })
  }

  items.push(
    { label: '手动检查更新', click: () => void checkUpdatesManually() },
    { type: 'separator' },
    { label: '打开 DSH-PX', click: () => { if (win) { win.show(); win.focus() } else { void createShellWindow(); void loadHarnessUrl(url) } } },
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
function refreshTray (url?: string): void {
  try {
    tray?.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(url ?? currentCleanUrl ?? '')))
  } catch { /* 托盘可能尚未创建或已销毁 */ }
}

/**
 * 触发"重启并安装更新"。
 *
 * 独立成函数是因为有**两个**入口：托盘菜单，以及界面（经 update-bridge 的
 * 请求文件）。两条路径必须做完全一样的事 —— 尤其别漏掉 `harness.kill()`，
 * 否则安装程序替换文件时会撞上仍在运行的 harness 及其子进程。
 */
function installUpdateNow (): void {
  quitting = true
  if (harness && harness.exitCode === null) harness.kill()
  autoUpdater?.quitAndInstall(false, true)
}

/**
 * 用户主动触发的更新检查。与后台检查的区别只在于反馈方式：
 * 无论结果如何都要给一个明确回执，不能"点了没反应"。
 *
 * 回执走 `update-bridge`：状态会出现在界面设置页里，**不再弹模态框**。
 * 用户主动点击的动作确实需要回执，但托盘菜单的点击本身就是"用户发起"，
 * 让状态出现在他已打开的界面里是更轻的反馈方式，也不会夺走焦点。
 */
async function checkUpdatesManually (): Promise<void> {
  if (!autoUpdater || !app.isPackaged) {
    publishUpdateState({ status: '开发态不支持自动更新', version: null },
      { phase: 'idle', status: '开发态不支持自动更新（仅打包后可用）', version: null, percent: null, error: null })
    process.stdout.write('[dsh-px] 开发态不支持自动更新\n')
    return
  }
  try {
    // 结果由 update-available / update-not-available 事件写入状态；
    // 这里只在抛错时补一条，避免"点了没反应"。
    await autoUpdater.checkForUpdates()
  } catch (err) {
    const detail = errText(err)
    publishUpdateState({ status: '检查更新失败', version: null },
      { phase: 'error', status: '检查更新失败', version: null, percent: null, error: detail })
    process.stderr.write(`[dsh-px] 检查更新失败：${detail}\n`)
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
 * @returns 是否重启成功
 */
async function restartHarness (): Promise<boolean> {
  if (!ctxState) return false
  const { runtime, home } = ctxState

  process.stdout.write('[dsh-px] 正在重启 harness\n')
  if (harness && harness.exitCode === null) {
    const dying = harness
    dying.removeAllListeners('exit')
    dying.kill()
    // 给旧进程一点时间释放句柄，避免新旧实例互相干扰。
    await new Promise<void>((res) => {
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
      new Promise<null>((res) => setTimeout(() => res(null), 20_000))
    ])
    if (!authUrl) {
      process.stdout.write('[dsh-px] 警告：未捕获到宣告的 URL；加载干净 URL（预期会撞 401 围栏）\n')
      return false
    }
    if (win) {
      await loadHarnessUrl(authUrl)
    }
    createTray(cleanUrl)
    return true
  } catch (err) {
    dialog.showErrorBox('dsh-px —— 重启 harness 失败', errText(err))
    return false
  }
}

async function main (): Promise<void> {
  const runtime = resolveRuntime()
  if (!runtime) {
    dialog.showErrorBox(
      'dsh-px —— 缺少运行时',
      '没有找到随附的运行时。\n\n请先执行 `npm run stage` 装配它，然后重新启动。'
    )
    app.exit(1)
    return
  }

  // 先建窗口并显示进度页：后面的物化在跨卷时是分钟级，必须先有地方显示进度。
  await createShellWindow()

  // 首启物化（同卷硬链接，秒级；跨卷回退复制，分钟级但有进度）。
  const home = await resolveHarnessHome(runtime, reportSeedProgress)

  const port = await findPort(DEFAULT_PORT)
  const cleanUrl = `http://${HOST}:${port}/`
  ctxState = { runtime, home, port }
  currentCleanUrl = cleanUrl

  process.stdout.write(`[dsh-px] node=${runtime.node}\n[dsh-px] dsh=${runtime.dshEntry}\n[dsh-px] DSH_HOME=${home}\n[dsh-px] url=${cleanUrl}\n`)

  reportSeedProgress({ done: 0, total: 0, copied: 0, phase: '正在启动本地服务…' })
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
      new Promise<null>((res) => setTimeout(() => res(null), 20_000))
    ])
    if (authUrl) {
      openUrl = authUrl
      process.stdout.write('[dsh-px] using harness-announced authenticated URL\n')
    } else {
      process.stdout.write('[dsh-px] WARNING: no announced URL captured; loading the clean URL (expect a 401 fence)\n')
    }
  } catch (err) {
    dialog.showErrorBox('dsh-px —— harness 启动失败', errText(err))
    quitting = true
    app.quit()
    return
  }

  await loadHarnessUrl(openUrl)
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
  // 停掉轮询/监视：否则退出过程中它还可能触发一次 quitAndInstall。
  stopInstallWatch?.()
  stopInstallWatch = null
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
