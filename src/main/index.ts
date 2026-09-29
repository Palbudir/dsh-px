/** Desktop process ownership, update coordination and local recovery. DSH owns Agent execution. */
import { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage, Notification, ipcMain } from 'electron'
import { PACK_VERSION } from '../shared/plugin-catalog'

import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { dirname, join, resolve, delimiter, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import type { NativeImage, MenuItemConstructorOptions, Event as ElectronEvent, WebContents } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { assertNoPendingMaintenance, prepareHarnessHome } from './prepare-home'
import type { SeedProgress } from './materialize'
import { setUpdateState, resetUpdateBridge, getUpdateState } from './update-bridge'
import { serveShellActions } from './shell-actions'
import { createRotatingLog } from './rotating-log'
import { classifyNavigation, openExternalSafely } from './navigation'
import {
  prepareAfterServiceStops,
  stopUnreadyChild,
  waitForGracefulStop,
  type ShutdownAcknowledgement
} from './graceful-stop'
import { isIdle, waitUntilIdle, activityMessage, type Activity } from './lifecycle'
import { verifyRuntimeIntegrity } from '../shared/runtime-integrity'
import { runtimeContentIdentity } from '../shared/runtime-identity'
import { UpdateController, createManualUpdateCheck } from './update-controller'
import { createServiceState } from './service-state'
import { HarnessOutput } from './harness-output'
import { ensureManagedPlugins } from './managed-plugins'
import { resolveHarnessProxy } from './network-proxy'
import type { UpdateBridgeState } from './update-bridge'

function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

// Explicit local QA profile; set before logs, single-instance lock and any service state are created.
// Normal installed launches continue to use the existing userData directory.
if (process.env.DSH_PX_USER_DATA_DIR) {
  if (!isAbsolute(process.env.DSH_PX_USER_DATA_DIR)) throw new Error('DSH_PX_USER_DATA_DIR 必须是绝对路径')
  mkdirSync(process.env.DSH_PX_USER_DATA_DIR, { recursive: true })
  app.setPath('userData', process.env.DSH_PX_USER_DATA_DIR)
}

// The installer updates the desktop/runtime; managed plugins migrate transactionally at startup.
const require = createRequire(import.meta.url)
let autoUpdater: AppUpdater | null = null
try {
  ;({ autoUpdater } = require('electron-updater'))
} catch (err) {
  // 开发态（未打包）下通常拿不到 app-update.yml，属正常，不应致命。
  process.stdout.write(`[dsh-px] electron-updater 不可用（开发态正常）：${errText(err)}\n`)
}

// Buffer startup diagnostics until userData is ready, then rotate desktop logs by size.
const LOG_BUFFER: string[] = []
let LOG_STREAM: ReturnType<typeof createRotatingLog> | null = null
let LOG_PATH: string | null = null

/** 追加文本到日志缓冲或文件。 */
function appendLog(text: string): void {
  const line = text.endsWith('\n') ? text : text + '\n'
  if (LOG_STREAM) {
    try {
      LOG_STREAM.write(line)
    } catch {
      /* 日志写入失败不该影响应用 */
    }
  } else if (LOG_BUFFER.length < 5000) {
    LOG_BUFFER.push(line) // 缓冲上限，避免 ready 之前无限增长
  }
}

/** 劫持标准输出/错误，使所有既有输出自动进日志。 */
function teeStdio(): void {
  // 写入回调的窄化别名：只需保留"可选的错误回调"这一位置，不复制 node 的整组重载。
  type WriteCallback = (err?: Error | null) => void
  for (const [stream, tag] of [
    [process.stdout, 'out'],
    [process.stderr, 'err']
  ] as const) {
    const original = stream.write.bind(stream)
    // A detached launcher can close its pipe while the desktop remains alive.
    // Keep diagnostic stream failures from opening Electron's blocking uncaught-error dialog.
    stream.on('error', (error) => appendLog(`[${tag} stream] ${errText(error)}`))
    stream.write = ((
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | WriteCallback,
      cb?: WriteCallback
    ): boolean => {
      try {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        appendLog(
          tag === 'err'
            ? text
                .split('\n')
                .map((l) => (l ? `[stderr] ${l}` : l))
                .join('\n')
            : text
        )
      } catch {
        /* 忽略 */
      }
      // Preserve Node's original stream callback behavior.
      return (
        original as (chunk: string | Uint8Array, encoding?: BufferEncoding, cb?: WriteCallback) => boolean
      )(chunk, encoding as BufferEncoding, cb)
    }) as typeof stream.write
  }
}

function appVersion(): string {
  if (app.isPackaged) return app.getVersion()
  try {
    return (
      (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version?: string }).version ??
      app.getVersion()
    )
  } catch {
    return app.getVersion()
  }
}

/** app ready 后打开日志文件，并把缓冲刷进去。 */
function openLogFile(): void {
  try {
    LOG_PATH = join(app.getPath('userData'), 'dsh-px.log')
    mkdirSync(dirname(LOG_PATH), { recursive: true })
    LOG_STREAM = createRotatingLog(LOG_PATH)
    LOG_STREAM.write(`\n${'='.repeat(70)}\n`)
    LOG_STREAM.write(
      `[dsh-px] 启动 ${new Date().toISOString()}  版本 ${appVersion()}  平台 ${process.platform}\n`
    )
    LOG_STREAM.write(
      `[dsh-px] electron=${process.versions.electron ?? '(非 Electron)'} node=${process.versions.node} packaged=${app.isPackaged}\n`
    )
    for (const line of LOG_BUFFER) LOG_STREAM.write(line)
    LOG_BUFFER.length = 0
  } catch {
    LOG_STREAM = null // 日志失败绝不阻断启动
  }
}

/** 日志文件路径（错误弹窗里告知用户）。 */
function logPath(): string {
  return LOG_PATH ?? '(尚未初始化)'
}

teeStdio()

const HERE = dirname(fileURLToPath(import.meta.url))

/** Resolve the package boundary independently of the build output directory depth. */
function findAppRoot(from: string): string {
  let dir = from
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return resolve(from, '..') // 兜底：维持旧行为，不外抛
}

const APP_ROOT = findAppRoot(HERE)
const PROFILE_NAME = process.env.DSH_PX_PROFILE ?? 'web'
const HOST = '127.0.0.1'
const DEFAULT_PORT = Number(process.env.DSH_PX_PORT ?? 3080)
/** 等待 harness 的 HTTP 面给出应答的上限；超时即判定启动失败。 */
const READY_TIMEOUT_MS = Number(process.env.DSH_PX_READY_TIMEOUT_MS ?? 180_000)

let harness: ChildProcess | null = null
let serviceState: ReturnType<typeof createServiceState> | null = null
let restartPending: Promise<boolean> | null = null
let currentAuthenticatedUrl: string | null = null
const instanceId = randomUUID()
let preparing: Promise<void> | null = null
interface LifecycleOperation {
  action: 'quit' | 'restart' | 'install'
  controller: AbortController
  stopping: boolean
  finished: Promise<void>
}
let lifecycleOperation: LifecycleOperation | null = null
let closePromptOpen = false
let recoveryBusy = false
let shutdownComplete = false
const expectedStops = new WeakSet<ChildProcess>()
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
 * 找不到时记录候选路径，由本机恢复页显示下一步操作。
 */
function resolveRuntime(): RuntimeDescriptor | null {
  const roots: string[] = []
  const override = process.env.DSH_PX_RUNTIME_ROOT
  if (override) roots.push(resolve(override))
  if (process.resourcesPath) roots.push(join(process.resourcesPath, 'runtime'))
  roots.push(join(APP_ROOT, 'runtime'))

  const tried: string[] = []
  for (const root of roots) {
    const node =
      process.platform === 'win32' ? join(root, 'node', 'node.exe') : join(root, 'node', 'bin', 'node')
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

/** Content identity avoids full-profile backups when identical runtime content is restaged. */
function seedIdentity(runtime: RuntimeDescriptor): string {
  return runtimeContentIdentity(JSON.parse(readFileSync(join(runtime.root, 'runtime-manifest.json'), 'utf8')))
}

async function resolveHarnessHome(
  runtime: RuntimeDescriptor,
  onProgress: (p: SeedProgress) => void
): Promise<string> {
  if (process.env.DSH_PX_HOME) return resolve(process.env.DSH_PX_HOME)
  if (!runtime.seedHome) throw new Error('安装缺少默认工作配置，请重新安装；已有用户数据不会删除。')
  const home = join(app.getPath('userData'), 'dsh-home')
  const identity = seedIdentity(runtime)
  await prepareHarnessHome({
    home,
    seedHome: runtime.seedHome,
    profileName: PROFILE_NAME,
    dshDir: join(runtime.root, 'dsh'),
    identity,
    onProgress,
    migrate: (initialSeed) => migrateManagedPlugins(runtime, home, identity, onProgress, initialSeed)
  })
  return home
}

async function migrateManagedPlugins(
  runtime: RuntimeDescriptor,
  home: string,
  identity: string,
  onProgress: (p: SeedProgress) => void,
  initialSeed = false
): Promise<void> {
  if (!runtime.seedHome) return
  await ensureManagedPlugins({
    home,
    seedHome: runtime.seedHome,
    profileName: PROFILE_NAME,
    identity,
    runtimeNode: runtime.node,
    dshEntry: runtime.dshEntry,
    adoptSeed: initialSeed,
    expectedVersion: PACK_VERSION,
    onProgress,
    onPhase: (phase) => onProgress({ done: 0, total: 0, copied: 0, phase: '正在准备插件升级：' + phase })
  })
}

/** Select a free port without attaching to another application's existing service. */
function findPort(preferred: number): Promise<number> {
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
async function waitForReady(url: string, timeoutMs: number, child: ChildProcess): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let lastErr = 'no attempt made'
  while (Date.now() < deadline) {
    if (harness !== child || child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Agent 服务在初始化时退出，请查看日志。')
    }
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
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
/** 拉起 harness 的结果：子进程句柄 + 宣告鉴权 URL 的 Promise。 */
interface HarnessStartResult {
  child: ChildProcess
  authUrl: Promise<string | null>
}

/**
 * 拉起随附的 harness，并在它宣告出自己的鉴权 URL 后兑现 Promise。
 */
async function startHarness({ runtime, home, port }: HarnessContext): Promise<HarnessStartResult> {
  assertNoPendingMaintenance(home)
  const args = [
    runtime.dshEntry,
    '--profile',
    PROFILE_NAME,
    '--host',
    HOST,
    '--port',
    String(port),
    '--no-open'
  ]
  const network = await resolveHarnessProxy(home)
  // Only the sanitized status is written. Proxy URLs (which may carry credentials in explicit settings) never enter logs.
  writeFileSync(join(app.getPath('userData'), 'network-state.json'), JSON.stringify(network.status))
  process.stdout.write(`[dsh-px] 网络配置来源：${network.status.source}\n`)
  const env = {
    ...process.env,
    ...network.additions,
    DSH_HOME: home,
    DSH_PX_PROFILE: PROFILE_NAME,
    PATH: [dirname(runtime.node), process.env.PATH ?? ''].join(delimiter),
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
    DSH_PX_INSTANCE_ID: instanceId,
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
  harness = child

  let settle: ((value: string | null) => void) | null = null
  const authUrl = new Promise<string | null>((res) => {
    settle = res
  })
  const output = new HarnessOutput((text) => process.stdout.write(`[dsh] ${text}`))
  const consume = (chunk: Buffer): void => {
    const url = output.push(chunk.toString())
    if (url && settle) {
      const done = settle
      settle = null
      done(url)
    }
  }
  child.stdout?.on('data', consume)
  child.stderr?.on('data', consume)
  const failed = (message: string): void => {
    output.flush()
    if (harness === child && (!child.pid || child.exitCode !== null || child.signalCode !== null))
      harness = null
    if (settle) {
      const done = settle
      settle = null
      done(null)
    }
    if (!quitting && !expectedStops.has(child)) {
      serviceState?.set('error', message)
      void showRecovery(`${message}\n\n${output.diagnostic}`).catch((err) => {
        process.stderr.write(`[dsh-px] 恢复页加载失败：${errText(err)}\n`)
      })
    }
  }
  child.on('error', (err) => failed(`服务启动失败：${errText(err)}`))
  child.on('exit', (code, signal) => {
    process.stdout.write(`[dsh] harness exited code=${code} signal=${signal}\n`)
    failed(`Agent 服务已停止（code ${code ?? signal}）`)
  })

  if (child.pid) {
    try {
      if (!serviceState) throw new Error('桌面进程记录尚未初始化，不能启动 Agent。')
      serviceState.recordChild(child.pid)
    } catch (error) {
      expectedStops.add(child)
      try {
        await stopUnreadyChild(child)
      } catch (stopError) {
        throw new Error(`无法记录新 Agent 进程：${errText(error)}\n${errText(stopError)}`)
      } finally {
        expectedStops.delete(child)
      }
      throw error
    }
  }

  return { child, authUrl }
}

function findShippedResource(...rel: string[]): string | null {
  const p = findShippedResourceQuiet(...rel)
  if (p === null) {
    const bases = [APP_ROOT, app.getAppPath(), process.resourcesPath ?? null].filter(
      (b): b is string => typeof b === 'string' && b.length > 0
    )
    const tried = bases.flatMap((b) => rel.map((r) => join(b, r)))
    process.stderr.write(
      `[dsh-px] 未找到随附资源 ${rel.join(' / ')}。已试：\n${tried.map((t) => `  - ${t}`).join('\n')}\n`
    )
  }
  return p
}

/** 同 `findShippedResource`，但找不到时不打日志（用于"缺了也无所谓"的资源）。 */
function findShippedResourceQuiet(...rel: string[]): string | null {
  const bases = [
    APP_ROOT, // 开发态 / 解包目录
    app.getAppPath(), // 打包后（asar 内）
    process.resourcesPath ?? null // extraResources 落点
  ].filter((b): b is string => typeof b === 'string' && b.length > 0)

  for (const base of bases) {
    for (const r of rel) {
      const p = join(base, r)
      if (existsSync(p)) return p
    }
  }
  return null
}

/**
 * 首启/重启进度页的路径。
 *
 * 由 electron-vite 的 renderer 目标构建（源在 `src/renderer/index.html`）。
 * 之所以做成真入口而不是主进程里的 HTML 模板字符串，见 `src/renderer/splash.ts`
 * 头部说明：一是页面可维护，二是 electron-vite 的
 * "renderer and preload config is missing" 警告无法在配置里关掉。
 */
function splashPagePath(): string | null {
  return findShippedResource(join('out', 'renderer', 'index.html'))
}

/** 向进度页推送状态（页面可能已经切走，失败一律忽略）。 */
function reportSeedProgress(p: SeedProgress): void {
  if (!win || win.isDestroyed()) return
  const now = Date.now()
  // 节流：跨卷复制时进度会很密集，没必要每次都跨进程发。
  if (p.done < p.total && now - lastSeedPushAt < 120) return
  lastSeedPushAt = now
  const percent = p.total > 0 ? Math.min(99, Math.round((p.done / p.total) * 100)) : 0
  const detail = p.total > 0 ? `${p.done} / ${p.total} 项（${percent}%）` : ''
  // 调页面里那个唯一的入口（见 src/renderer/splash.ts）。
  void win.webContents
    .executeJavaScript(`window.__dshPxProgress?.(${JSON.stringify(p.phase)}, ${JSON.stringify(detail)})`)
    .catch(() => {
      /* 页面已切到 harness，正常 */
    })
}

/** 进度推送节流时间戳。 */
let lastSeedPushAt = 0

/** Preload exposes surface identity and the allowlisted recovery bridge. */
function preloadPath(): string | null {
  const p = findShippedResourceQuiet(join('out', 'preload', 'index.cjs'))
  if (p === null) process.stderr.write('[dsh-px] 未找到进度页 preload，跳过（不影响启动）\n')
  return p
}

async function createShellWindow(): Promise<BrowserWindow> {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#111318',
    title: `DSH-PX ${appVersion()}`,
    autoHideMenuBar: true,
    webPreferences: {
      // harness 前端是一个可信的本地源；别把 Node 暴露进去。
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Required for recovery actions and desktop surface identity.
      preload: preloadPath() ?? undefined
    }
  })

  // 阻止页面改写窗口标题（dsh 的 UI 会把它设成会话名）。
  // 这是桌面客户端该有的行为：窗口标题标识**应用**，不是标识当前文档。
  //
  // 但只对 **harness 的页面**这样做。进度页是我们自己的本地页面，
  // 它的 `<title>` 就该是应用名；无条件覆盖会让进度页的标题也变成
  // `DSH-PX <版本>`，看着像"外壳盖住了页面自己的标题"。
  // 判据用 URL：进度页是 file://，harness 是 http://127.0.0.1:<port>/。
  win.on('page-title-updated', (event: ElectronEvent) => {
    const url = win?.webContents.getURL() ?? ''
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      event.preventDefault()
      win?.setTitle(`DSH-PX ${appVersion()}`)
    }
  })

  win.once('ready-to-show', () => win?.show())
  win.on('close', (event) => {
    if (!shutdownComplete) {
      event.preventDefault()
      void requestClose()
    }
  })
  win.on('closed', () => {
    win = null
  })

  // 加载进度页。用 loadFile 从磁盘读（打包后在 app.asar 里），
  // 而不是 data: URL —— 这样页面是构建产物，可维护、可检查。
  const page = splashPagePath()
  if (page !== null) {
    // Record loading failures and verify the progress entry point to diagnose blank startup windows.
    win.webContents.once('did-fail-load', (_e, code, desc, url) => {
      process.stderr.write(`[dsh-px] 进度页加载失败（${String(code)} ${desc}）：${url}\n`)
    })
    await win.loadFile(page)
    try {
      const ready = (await win.webContents.executeJavaScript(
        "typeof window.__dshPxProgress === 'function'"
      )) as boolean
      process.stdout.write(
        ready
          ? '[dsh-px] 进度页已就绪（含进度推送入口）\n'
          : '[dsh-px] 警告：进度页已加载但缺少 __dshPxProgress 入口，进度将无法显示\n'
      )
    } catch (err) {
      process.stderr.write(`[dsh-px] 核对进度页入口失败：${errText(err)}\n`)
    }
  } else {
    await win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<body style="background:#111318;color:#e6e8ee;font-family:sans-serif;' +
            'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
            '正在启动 DSH-PX…</body>'
        )
    )
  }
  return win
}

/** 把窗口切到 harness 的真实地址。 */
async function loadHarnessUrl(url: string): Promise<void> {
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
let updateController: UpdateController | null = null
let startupUpdateTimer: ReturnType<typeof setTimeout> | undefined

function publishUpdateState(next: UpdateState, bridge: Partial<Omit<UpdateBridgeState, 'updatedAt'>>): void {
  updateState = next
  setUpdateState(bridge)
  refreshTray()
}

function setupAutoUpdate(): void {
  stopInstallWatch?.()
  stopInstallWatch = null
  updateController?.dispose()
  updateController = null
  clearTimeout(startupUpdateTimer)
  resetUpdateBridge(instanceId)
  setUpdateState({ supported: app.isPackaged && autoUpdater !== null })
  if (autoUpdater && app.isPackaged) {
    updateController = new UpdateController(autoUpdater, {
      installDelayMs: 0,
      lastCheckedAt: getUpdateState().lastCheckedAt,
      publish: (state) => {
        publishUpdateState({ status: state.status, version: state.version }, state)
        if (state.error) process.stderr.write(`[dsh-px] ${state.status}：${state.error}\n`)
        if (state.phase === 'error' && shutdownComplete && !quitting) {
          shutdownComplete = false
          void showRecovery('安装未能启动。可以重新连接服务或查看日志。')
        }
      },
      ready: (version) => {
        if (process.env.DSH_PX_AUTO_UPDATE === '1') return
        notifyUpdate(
          'DSH-PX 更新已就绪',
          `新版本 ${version} 已下载。可在设置或托盘中安装；有任务运行时会等待任务结束。`
        )
      },
      installing: (version) => notifyUpdate('DSH-PX 正在更新', `正在安装 ${version}，完成后将自动重启。`)
    })
    // 保留延后检查，避免启动阶段争抢资源；手动检查与此计时器共用并发保护。
    startupUpdateTimer = setTimeout(() => {
      void updateController?.check()
    }, 8000)
  } else {
    publishUpdateState(
      { status: '自动更新不可用', version: null },
      {
        phase: 'idle',
        status: app.isPackaged ? '更新器不可用，请打开日志排查' : '开发态不支持自动更新（仅打包后可用）',
        version: null,
        percent: null,
        error: null,
        supported: false
      }
    )
  }

  stopInstallWatch = serveShellActions({
    dir: app.getPath('userData'),
    instanceId,
    onReceipt: (lastAction) => setUpdateState({ lastAction }),
    onAction: async (request) => {
      switch (request.action) {
        case 'check':
          void checkUpdatesManually()
          return { message: '已开始检查更新。' }
        case 'restart': {
          const operation = beginLifecycle('restart', 'wait')
          if (!operation) throw new Error('已有服务操作正在处理。')
          await operation.finished
          return { message: '服务已重新连接。' }
        }
        case 'install': {
          if (updateController?.getState().phase !== 'ready') throw new Error('更新尚未准备完成。')
          const operation = beginLifecycle('install', 'wait')
          if (!operation) throw new Error('已有服务操作正在处理。')
          await operation.finished
          return { message: '安装已开始，等待完成后自动重启。' }
        }
        case 'cancel-pending':
          if (lifecycleOperation?.stopping) throw new Error('服务已开始停止，无法取消；完成后可重新连接。')
          lifecycleOperation?.controller.abort(new DOMException('已取消等待。', 'AbortError'))
          return { message: '已取消等待操作。' }
        case 'open-data': {
          const error = await shell.openPath(app.getPath('userData'))
          if (error) throw new Error(error)
          return { message: '已打开数据目录。' }
        }
        case 'open-log':
          shell.showItemInFolder(logPath())
          return { message: '已定位日志文件。' }
      }
    }
  })
}

function notifyUpdate(title: string, body: string): void {
  try {
    const notification = new Notification({ title, body })
    notification.on('click', () => {
      win?.show()
      win?.focus()
    })
    notification.show()
  } catch {
    /* 通知不可用时仍有设置页与托盘反馈 */
  }
}

function openBrowser(target: string): Promise<boolean> {
  return openExternalSafely(
    target,
    (url) => shell.openExternal(url),
    (message) => {
      process.stderr.write('[dsh-px] 默认浏览器未能打开：' + message + '\n')
      notifyUpdate('无法打开浏览器', '请检查系统默认浏览器设置。DSH-PX 中的任务仍可继续。')
    }
  )
}

async function trayImage(): Promise<NativeImage> {
  // Packaged icons live in resources; development icons live in build.
  const candidates = [
    findShippedResourceQuiet('tray-32.png'),
    findShippedResourceQuiet('tray-16.png'),
    findShippedResourceQuiet(join('build', 'tray-32.png')),
    findShippedResourceQuiet(join('build', 'tray-16.png'))
  ].filter((p): p is string => p !== null)

  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) {
          process.stdout.write(`[dsh-px] 托盘图标：${p}\n`)
          return img
        }
      }
    } catch {
      /* 试下一个 */
    }
  }

  // 兜底 1：从可执行文件提取（打包态通常就是应用自己的图标）
  try {
    const exeIcon = await app.getFileIcon(process.execPath, { size: 'small' })
    if (exeIcon && !exeIcon.isEmpty()) {
      process.stdout.write('[dsh-px] 托盘图标：从可执行文件提取（兜底）\n')
      return exeIcon
    }
  } catch {
    /* 继续 */
  }

  // 兜底 2：在内存里画一个 16×16 蓝色方块，保证托盘项至少可见可点。
  process.stdout.write('[dsh-px] 托盘图标：使用内存绘制兜底\n')
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i += 1) {
    buf[i * 4 + 0] = 0x2e // B
    buf[i * 4 + 1] = 0x6b // G
    buf[i * 4 + 2] = 0xe6 // R
    buf[i * 4 + 3] = 0xff // A
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

function createTray(url: string): void {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(url)))
    return
  }
  try {
    // 先用空图标同步构造，避免 await 期间托盘项缺失；随后替换为真实图标。
    tray = new Tray(nativeImage.createEmpty())
    tray.setToolTip(`DSH-PX ${appVersion()}`)
    void trayImage().then((img) => {
      try {
        tray?.setImage(img)
      } catch {
        /* 托盘可能已销毁 */
      }
    })
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(url)))
    tray.on('double-click', () => {
      win?.show()
      win?.focus()
    })
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
function buildTrayMenu(url: string): MenuItemConstructorOptions[] {
  const readyToInstall = getUpdateState().phase === 'ready'
  const items: MenuItemConstructorOptions[] = [
    { label: `DSH-PX ${appVersion()}`, enabled: false },
    { label: updateState.status, enabled: false }
  ]

  // 下载完成后，把"重启并安装"提到最显眼的位置 —— 这是用户此刻唯一要做的事。
  if (readyToInstall) {
    items.push({ type: 'separator' })
    items.push({
      label: `重启并安装 ${updateState.version}`,
      click: () => {
        installUpdateNow()
      }
    })
  }

  items.push(
    {
      label: '手动检查更新',
      enabled: !['checking', 'downloading', 'ready', 'installing'].includes(getUpdateState().phase),
      click: () => void checkUpdatesManually()
    },
    { type: 'separator' },
    {
      label: '打开 DSH-PX',
      click: () => {
        if (win) {
          win.show()
          win.focus()
        } else {
          void createShellWindow()
          void loadHarnessUrl(url)
        }
      }
    },
    { label: '重启本机服务', click: () => beginLifecycle('restart', 'wait') },
    { type: 'separator' },
    { label: '打开日志文件', click: () => void shell.openPath(logPath()) },
    { label: '打开数据目录', click: () => void shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    {
      label: '在浏览器中打开',
      click: () => void openBrowser(currentAuthenticatedUrl ?? currentCleanUrl ?? url)
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        void requestClose()
      }
    }
  )
  if (lifecycleOperation)
    items.unshift({
      label: '取消等待操作',
      enabled: !lifecycleOperation.stopping,
      click: () => lifecycleOperation?.controller.abort(new DOMException('已取消等待。', 'AbortError'))
    })
  items.push({
    label: '故障恢复…',
    click: () => {
      void showRecovery('可尝试重新连接。强制中止仅用于正常停止不可用的故障情况。')
    }
  })
  return items
}

/** 重建托盘菜单以反映最新状态（下载进度、更新就绪等）。 */
function refreshTray(url?: string): void {
  try {
    tray?.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(url ?? currentCleanUrl ?? '')))
  } catch {
    /* 托盘可能尚未创建或已销毁 */
  }
}

/** 两个入口共用状态检查；未下载/重复点击不会关闭当前会话。 */
function installUpdateNow(): void {
  if (quitting) return
  if (updateController?.getState().phase === 'ready') beginLifecycle('install', 'wait')
}

const checkUpdatesManually = createManualUpdateCheck(
  () => updateController,
  () => {
    clearTimeout(startupUpdateTimer)
  }
)

/** Restart the owned service, preferring its previous port and using a new authentication URL. */
function restartHarness(): Promise<boolean> {
  if (restartPending) return restartPending
  restartPending = restartHarnessOnce().finally(() => {
    restartPending = null
  })
  return restartPending
}

async function getActivity(): Promise<Activity> {
  if (preparing) return { known: true, runningAgents: 0, runningJobs: 1, queuedInputs: 0, openTerminals: 0 }
  if (!harness || harness.exitCode !== null || harness.signalCode !== null)
    return { known: true, runningAgents: 0, runningJobs: 0, queuedInputs: 0, openTerminals: 0 }
  if (!currentCleanUrl) throw new Error('服务地址尚未就绪。')
  const response = await fetch(new URL('dsh-px-workbench/activity', currentCleanUrl), {
    signal: AbortSignal.timeout(4000)
  })
  if (!response.ok) throw new Error('暂不能确认活动任务。')
  const value = (await response.json()) as Activity & { instanceId?: string }
  if (value.instanceId !== instanceId) throw new Error('服务身份不匹配。')
  return value
}

async function stopHarness(child: ChildProcess, mode: 'idle' | 'cancel' = 'idle'): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (!currentCleanUrl) throw new Error('未确定服务地址，保留当前进程。')
  const requestId = randomUUID()
  expectedStops.add(child)
  try {
    await waitForGracefulStop({
      child,
      trigger: async () => {
        const response = await fetch(new URL('dsh-px-workbench/shutdown', currentCleanUrl!), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-dsh-px-request': '1' },
          body: JSON.stringify({ instanceId, requestId, mode }),
          signal: AbortSignal.timeout(6000)
        })
        if (!response.ok)
          throw Object.assign(
            new Error(((await response.json()) as { error?: string }).error ?? '服务拒绝停止请求。'),
            { status: response.status }
          )
      },
      acknowledgement: () => {
        try {
          const ack = JSON.parse(readFileSync(join(app.getPath('userData'), 'shutdown-ack.json'), 'utf8'))
          return ack.instanceId === instanceId && ack.requestId === requestId
            ? (ack as ShutdownAcknowledgement)
            : null
        } catch {
          return null
        }
      }
    })
  } finally {
    expectedStops.delete(child)
  }
}

function beginLifecycle(
  action: 'quit' | 'restart' | 'install',
  mode: 'idle' | 'wait' | 'cancel'
): LifecycleOperation | null {
  if (lifecycleOperation || recoveryBusy || (preparing && action !== 'quit')) return null
  const controller = new AbortController()
  const operation: LifecycleOperation = { action, controller, stopping: false, finished: Promise.resolve() }
  lifecycleOperation = operation
  const update = (message: string): void => {
    setUpdateState({ pendingOperation: { action, message, canCancel: !lifecycleOperation?.stopping } })
    refreshTray()
  }
  update('正在检查活动任务，操作影响所有连接本服务的页面。')
  operation.finished = (async () => {
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    while (true) {
      if (mode !== 'cancel') await waitUntilIdle({ activity: getActivity, signal: controller.signal, update })
      controller.signal.throwIfAborted()
      operation.stopping = true
      update('正在保存会话并停止服务…')
      try {
        if (harness) await stopHarness(harness, mode === 'cancel' ? 'cancel' : 'idle')
        break
      } catch (error) {
        if (mode !== 'cancel' && (error as { status?: number }).status === 409) {
          operation.stopping = false
          update('有新任务开始，继续等待任务结束。')
        } else throw error
      }
    }
    controller.signal.throwIfAborted()
    setUpdateState({ pendingOperation: undefined })
    if (action === 'restart') {
      if (!(await restartHarness())) throw new Error('服务未能重新连接，请使用恢复页查看原因。')
      return
    }
    shutdownComplete = true
    if (action === 'install') {
      if (!updateController?.install()) throw new Error('安装包状态已变化，请重新检查更新。')
    } else {
      quitting = true
      app.quit()
    }
  })()
  void operation.finished
    .catch((error) => {
      if (lifecycleOperation !== operation) return
      lifecycleOperation = null
      setUpdateState({ pendingOperation: undefined })
      if (controller.signal.aborted) return
      shutdownComplete = false
      process.stderr.write('[dsh-px] 服务操作失败：' + errText(error) + '\n')
      setUpdateState({
        lastAction: {
          id: randomUUID(),
          instanceId,
          action: action === 'quit' ? 'restart' : action,
          status: 'failed',
          message: errText(error),
          updatedAt: new Date().toISOString()
        }
      })
      serviceState?.set('error', errText(error), harness?.exitCode === null ? harness.pid : null)
      void showRecovery(errText(error))
    })
    .finally(() => {
      if (lifecycleOperation === operation) lifecycleOperation = null
    })
  return operation
}

async function requestClose(): Promise<void> {
  if (lifecycleOperation || closePromptOpen || recoveryBusy) {
    win?.show()
    return
  }
  closePromptOpen = true
  try {
    let activity: Activity
    try {
      activity = await getActivity()
    } catch {
      activity = { known: false, runningAgents: 0, queuedInputs: 0, runningJobs: 0, openTerminals: 0 }
    }
    if (isIdle(activity)) {
      beginLifecycle('quit', 'idle')
      return
    }
    const choice = await dialog.showMessageBox(win!, {
      type: 'question',
      title: '退出 DSH-PX',
      message: '仍有任务或终端未关闭，或暂时无法确认服务是否空闲。',
      detail: activityMessage(activity) + '\n关闭服务也会影响浏览器中连接的会话。',
      buttons: ['继续运行', '等待结束后退出', '中止任务与终端并退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (choice.response === 1) beginLifecycle('quit', 'wait')
    if (choice.response === 2) beginLifecycle('quit', 'cancel')
  } finally {
    closePromptOpen = false
  }
}

async function showRecovery(message: string): Promise<void> {
  if (!win || win.isDestroyed() || quitting) return
  const page = splashPagePath()
  if (!page) return
  await win.loadFile(page)
  await win.webContents.executeJavaScript(`window.__dshPxRecovery?.(${JSON.stringify(message)})`)
}

async function forceLifecycle(action: 'quit' | 'restart' | 'install'): Promise<boolean> {
  if (recoveryBusy || preparing) return false
  if (action === 'install' && updateController?.getState().phase !== 'ready')
    throw new Error('更新尚未下载完成，当前服务未中断。')
  recoveryBusy = true
  try {
    const choice = await dialog.showMessageBox(win!, {
      type: 'warning',
      title: '强制中止本机服务',
      message: '这会强制中断所有连接本服务的任务和工具进程。',
      detail:
        '仅用于正常停止失效的故障恢复。未完成的任务会中断，未写入的输出可能丢失；已保存的配置与会话文件不会删除。',
      buttons: ['继续等待', '强制中止并继续'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (choice.response !== 1) return false
    if (action === 'install' && updateController?.getState().phase !== 'ready')
      throw new Error('安装包状态已变化，当前服务未中断。')
    lifecycleOperation?.controller.abort(new DOMException('已选择故障停机。', 'AbortError'))
    lifecycleOperation = null
    const child = harness
    if (child && child.exitCode === null && child.signalCode === null) {
      expectedStops.add(child)
      await new Promise<void>((resolveStop, reject) => {
        const done = (): void => {
          clearTimeout(timer)
          resolveStop()
        }
        const timer = setTimeout(() => {
          child.removeListener('exit', done)
          expectedStops.delete(child)
          reject(new Error('强制中止未完成，请查看系统进程与日志。'))
        }, 10000)
        child.once('exit', done)
        if (process.platform === 'win32' && child.pid)
          execFile(
            'taskkill.exe',
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true },
            (error) => {
              if (error && child.exitCode === null) {
                clearTimeout(timer)
                child.removeListener('exit', done)
                expectedStops.delete(child)
                reject(error)
              }
            }
          )
        else child.kill('SIGKILL')
      }).finally(() => expectedStops.delete(child))
    }
    setUpdateState({ pendingOperation: undefined })
    if (action === 'restart') {
      await initializeRuntime()
      return true
    }
    shutdownComplete = true
    if (action === 'install') {
      if (!updateController?.install()) {
        shutdownComplete = false
        throw new Error('没有就绪安装包，请重新连接后检查更新。')
      }
    } else {
      quitting = true
      app.quit()
    }
    return true
  } finally {
    recoveryBusy = false
  }
}

async function restartHarnessOnce(): Promise<boolean> {
  if (!ctxState || quitting) return false
  const { runtime, home, port: previousPort } = ctxState
  serviceState?.set('restarting', '正在重启服务')
  try {
    if (harness) await stopHarness(harness)
    const port = await findPort(previousPort)
    ctxState = { runtime, home, port }
    const cleanUrl = `http://${HOST}:${port}/`
    currentCleanUrl = cleanUrl
    serviceState?.origin(cleanUrl)
    const page = splashPagePath()
    if (win && page) await win.loadFile(page)
    reportSeedProgress({ done: 0, total: 0, copied: 0, phase: '正在重新连接 Agent 服务…' })
    const started = await startHarness(ctxState)
    harness = started.child
    await waitForReady(cleanUrl, READY_TIMEOUT_MS, started.child)
    const authUrl = await Promise.race([
      started.authUrl,
      new Promise<null>((res) => setTimeout(() => res(null), 20_000))
    ])
    if (!authUrl || harness !== started.child) throw new Error('服务未完成鉴权初始化，请重试并查看日志。')
    currentAuthenticatedUrl = authUrl
    await loadHarnessUrl(authUrl)
    if (process.argv.includes('--open-browser')) await openBrowser(authUrl)
    serviceState?.set('running', '桌面服务运行中', started.child.pid)
    createTray(cleanUrl)
    return true
  } catch (err) {
    serviceState?.set('error', errText(err))
    await showRecovery(errText(err))
    return false
  }
}

async function initializeRuntime(): Promise<void> {
  if (preparing) return preparing
  preparing = (async () => {
    ensureServiceState()
    const runtime = resolveRuntime()
    if (!runtime)
      throw new Error(
        app.isPackaged
          ? '安装资源不完整，请重新安装 DSH-PX。会话数据仍保留在数据目录。'
          : '开发运行时缺失，请先运行 npm run stage -- --with-plugins。'
      )
    verifyRuntimeIntegrity(runtime.root, { app: appVersion() })
    serviceState?.set('starting', '正在准备本机服务')
    const previous = harness
    const home = await prepareAfterServiceStops(
      previous,
      () => stopHarness(previous!),
      () => resolveHarnessHome(runtime, reportSeedProgress)
    )
    let preferred = DEFAULT_PORT
    if (!process.env.DSH_PX_PORT)
      try {
        const saved = JSON.parse(readFileSync(join(app.getPath('userData'), 'listen-port.json'), 'utf8'))
        if (Number.isInteger(saved.port) && saved.port > 1024 && saved.port < 65535) preferred = saved.port
      } catch {
        /* first boot */
      }
    const port = await findPort(preferred)
    ctxState = { runtime, home, port }
    currentCleanUrl = 'http://' + HOST + ':' + port + '/'
    serviceState?.origin(currentCleanUrl)
    writeFileSync(join(app.getPath('userData'), 'listen-port.json'), JSON.stringify({ port }))
    createTray(currentCleanUrl)
    if (!(await restartHarness())) throw new Error('服务启动失败，请查看当前恢复说明。')
  })().finally(() => {
    preparing = null
  })
  return preparing
}

async function main(): Promise<void> {
  await createShellWindow()
  ensureServiceState()
  await initializeRuntime()
}

function ensureServiceState(): void {
  if (!serviceState)
    serviceState = createServiceState(app.getPath('userData'), {
      instanceId,
      runtimeMode: app.isPackaged ? 'packaged' : 'development',
      appVersion: appVersion()
    })
  if (!stopInstallWatch) setupAutoUpdate()
}

ipcMain.handle('dsh-px:recover', async (event, action: unknown) => {
  const page = splashPagePath()
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    !page ||
    event.senderFrame.url !== pathToFileURL(page).href
  )
    throw new Error('无效的恢复页面')
  if (action === 'retry') {
    if (recoveryBusy || lifecycleOperation || preparing) return false
    recoveryBusy = true
    try {
      await initializeRuntime()
      return true
    } catch (error) {
      await showRecovery(errText(error))
      return false
    } finally {
      recoveryBusy = false
    }
  }
  if (action === 'force-restart' || action === 'force-quit' || action === 'force-install') {
    try {
      return await forceLifecycle(action.slice(6) as 'restart' | 'quit' | 'install')
    } catch (error) {
      await showRecovery(errText(error))
      return false
    }
  }
  if (action === 'cancel-pending') {
    if (lifecycleOperation?.stopping) return false
    lifecycleOperation?.controller.abort(new DOMException('已取消等待。', 'AbortError'))
    return true
  }
  if (action === 'log') {
    shell.showItemInFolder(logPath())
    return true
  }
  if (action === 'data') {
    return (await shell.openPath(app.getPath('userData'))) === ''
  }
  throw new Error('未知操作')
})

app.on('window-all-closed', () => {
  if (shutdownComplete) app.quit()
})
function configureNavigation(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url: target }) => {
    const kind = classifyNavigation(target, currentCleanUrl)
    if (kind === 'internal')
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
        }
      }
    if (kind === 'external') void openBrowser(target)
    return { action: 'deny' }
  })
  const navigate = (event: ElectronEvent, target: string): void => {
    const kind = classifyNavigation(target, currentCleanUrl)
    if (kind !== 'internal') {
      event.preventDefault()
      if (kind === 'external') void openBrowser(target)
    }
  }
  contents.on('will-navigate', navigate)
  contents.on('will-redirect', navigate)
}
app.on('web-contents-created', (_event, contents) => configureNavigation(contents))
app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  void requestClose()
})
app.on('will-quit', () => {
  serviceState?.dispose()
  clearTimeout(startupUpdateTimer)
  updateController?.dispose()
  stopInstallWatch?.()
  stopInstallWatch = null
})

/**
 * 单实例锁：第二次启动时聚焦已有窗口，而不是再起一个 harness。
 * 两个 harness 共享同一份 DSH_HOME 会导致会话互相踩，所以这个必须拦住。
 */
if (!app.requestSingleInstanceLock()) {
  process.stdout.write('[dsh-px] 已经有一个实例在运行，退出本次启动\n')
  shutdownComplete = true
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app
    .whenReady()
    .then(() => {
      // 最先打开日志文件：越早越好，这样连 main() 里的准备工作也被记录。
      openLogFile()
      return main()
    })
    .catch(async (err) => {
      process.stderr.write('[dsh-px] 启动异常：' + errText(err) + '\n')
      serviceState?.set('error', errText(err))
      await showRecovery(errText(err))
    })
}
