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
import { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage, Notification, ipcMain } from 'electron'

/** 从 unknown 的 catch 变量里安全取出可读消息（strict 下 catch 变量是 unknown）。 */
function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}
import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, createWriteStream } from 'node:fs'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { dirname, join, resolve, delimiter, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import type { WriteStream } from 'node:fs'
import type { NativeImage, MenuItemConstructorOptions, Event as ElectronEvent } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { materializeSeedHome, repairPnpmMetadata } from './materialize'
import type { SeedProgress } from './materialize'
import { setUpdateState, watchShellActions, resetUpdateBridge, getUpdateState } from './update-bridge'
import { UpdateController } from './update-controller'
import { createServiceState } from './service-state'
import { HarnessOutput } from './harness-output'
import { ensureManagedPlugins } from './managed-plugins'
import { resolveHarnessProxy } from './network-proxy'
import type { UpdateBridgeState } from './update-bridge'

// Explicit local QA profile; set before logs, single-instance lock and any service state are created.
// Normal installed launches continue to use the existing userData directory.
if (process.env.DSH_PX_USER_DATA_DIR) {
  if (!isAbsolute(process.env.DSH_PX_USER_DATA_DIR)) throw new Error('DSH_PX_USER_DATA_DIR 必须是绝对路径')
  mkdirSync(process.env.DSH_PX_USER_DATA_DIR, { recursive: true })
  app.setPath('userData', process.env.DSH_PX_USER_DATA_DIR)
}

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
let serviceState: ReturnType<typeof createServiceState> | null = null
let restartPending: Promise<boolean> | null = null
let currentAuthenticatedUrl: string | null = null
let shutdownPending = false
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
 * 随附运行时的身份标识：用来判断"种子换了没有"。
 *
 * 取值优先用装配时写下的 `stagedAt`（内容指纹），退化到种子目录路径。
 *
 * **不能用种子目录路径单独判断**：`stagedAt` 在每次装配时都会变，而路径在
 * 用户机器上从 CI 的 `D:\a\...` 变成安装目录 —— 两者各有用途，所以合起来取。
 */
function seedIdentity (runtime: RuntimeDescriptor): string {
  try {
    const m = JSON.parse(readFileSync(join(runtime.root, 'runtime-manifest.json'), 'utf8')) as { stagedAt?: string }
    if (typeof m.stagedAt === 'string' && m.stagedAt.length > 0) return m.stagedAt
  } catch { /* manifest 读不到：退化到路径 */ }
  return runtime.seedHome ?? '(none)'
}

/**
 * 选定并准备 harness home。优先级：
 *   1. DSH_PX_HOME —— 显式覆盖（也是在开发插件时，把外壳指向你现有 ~/.dsh 的方式）。
 *   2. <userData>/dsh-home —— 应用自己的 home：首次运行从随附的树物化，
 *      此后归用户所有。
 *
 * 物化用**硬链接**（见 materialize.ts）：同卷首启实测 5.7 秒，跨卷自动回退到
 * 逐文件复制并给出进度。旧实现是同步整树复制，实测 4–5 分钟且界面冻结。
 *
 * ## 完成判据必须包含"种子是否换了"（一次真实事故）
 *
 * 早期只检查 `.dsh-px-materialized` 与 profile 清单是否存在，于是**外壳升级后
 * 用户的 home 永远停在首次安装那一版的插件树**。实测后果：`beta.re.0.2` 装好后
 * 设置页里没有「DSH-PX」分区 —— 因为物化出来的自研插件还是 `re.0.1` 时代的
 * `package.json`（那时还没有 `exports["./client"]` 与 `dsh.client` 声明），
 * 客户端半边根本不会被加载。而日志里一切正常，只有一行
 * `跳过 12129` 在悄悄说明整棵树都没被更新。
 *
 * 修法：标记里记下种子身份，身份变了就**只刷新自管插件**（`refresh: true`）。
 */
async function resolveHarnessHome (
  runtime: RuntimeDescriptor,
  onProgress: (p: SeedProgress) => void
): Promise<string> {
  if (process.env.DSH_PX_HOME) return resolve(process.env.DSH_PX_HOME)

  const home = join(app.getPath('userData'), 'dsh-home')
  const doneMarker = join(home, '.dsh-px-materialized')
  const profileManifest = join(home, 'profiles', PROFILE_NAME, 'package.json')
  const identity = seedIdentity(runtime)

  // 读上次物化时记录的种子身份。老版本标记里没有这行 —— 那是 `undefined`，
  // 与任何真实身份都不相等，因此升级过来的用户会被正确地重新物化一次。
  let lastIdentity: string | null = null
  try {
    const prev = readFileSync(doneMarker, 'utf8')
    lastIdentity = /^seedIdentity=(.+)$/m.exec(prev)?.[1] ?? null
  } catch { /* 标记不存在 */ }

  const seeded = existsSync(doneMarker) && existsSync(profileManifest)
  const refresh = seeded && lastIdentity !== identity

  // 已经物化完整、且种子没变：直接用（二次启动零开销）。
  if (seeded && !refresh) {
    if (runtime.seedHome) repairPnpmMetadata({ seedHome: runtime.seedHome, home, profileName: PROFILE_NAME })
    await migrateManagedPlugins(runtime, home, identity, onProgress)
    return home
  }

  // 认领这次物化。先落盘，这样即便中途被打断也能看出这是哪一次尝试。
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, '.dsh-px-seed-claimed'),
    `claimed at ${new Date().toISOString()}\nseedSource=${runtime.seedHome ?? '(none)'}\nidentity=${identity}\n`)

  if (!runtime.seedHome) {
    mkdirSync(join(home, 'profiles'), { recursive: true })
    process.stdout.write('[dsh-px] 警告：随附运行时里没有种子 home，profile 需要自行初始化\n')
    return home
  }

  if (refresh) {
    process.stdout.write(
      `[dsh-px] 随附运行时已更新（种子 ${String(lastIdentity)} → ${identity}），` +
      '正在刷新本地数据目录…\n'
    )
  } else {
    process.stdout.write('[dsh-px] 首次运行：正在从随附运行时准备本地数据目录…\n')
  }
  try {
    const r = await materializeSeedHome({
      seedHome: runtime.seedHome,
      home,
      profileName: PROFILE_NAME,
      dshDir: join(runtime.root, 'dsh'),
      onProgress,
      refresh,
      seedIdentity: identity
    })
    process.stdout.write(
      `[dsh-px] ${refresh ? '刷新' : '首次运行'}完成：硬链接 ${r.linked}、复制 ${r.copied}、` +
      `跳过 ${r.skipped}、共 ${r.total} 项，耗时 ${(r.ms / 1000).toFixed(1)} 秒\n`
    )
  } catch (err) {
    // 不吞掉：把真实原因告诉用户，否则应用会以一个空壳 profile 启动。
    const detail = errText(err)
    process.stderr.write(`[dsh-px] 首次运行准备失败：${detail}\n`)
    dialog.showErrorBox(
      'dsh-px —— 首次运行准备失败',
      `无法把随附的运行时准备到：\n${home}\n\n原因：${detail}\n\n` +
      '请保留数据目录，检查磁盘空间与目录权限后重试。不要删除配置或会话。'
    )
    throw err
  }

  await migrateManagedPlugins(runtime, home, identity, onProgress)
  return home
}

async function migrateManagedPlugins (runtime: RuntimeDescriptor, home: string, identity: string,
  onProgress: (p: SeedProgress) => void): Promise<void> {
  // 开发态可以保持源码链接；安装版必须从安装资源加载插件，不能依赖源码仓库。
  if (!app.isPackaged || !runtime.seedHome) return
  await ensureManagedPlugins({ home, seedHome: runtime.seedHome, profileName: PROFILE_NAME, identity,
    install: specs => new Promise<void>((resolveInstall, reject) => {
      onProgress({ done: 0, total: 0, copied: 0, phase: '正在接入新版自管插件，保留现有配置…' })
      // dsh 的 Windows pnpm 转发使用 shell；这些路径全来自本地安装目录，显式引用空格。
      const safeSpecs = process.platform === 'win32' ? specs.map(spec => `"${spec}"`) : specs
      const child = spawn(runtime.node, [runtime.dshEntry, 'plugin', '--profile', PROFILE_NAME,
        'add', ...safeSpecs, '--offline', '--ignore-scripts'], {
        env: { ...process.env, DSH_HOME: home, PATH: [dirname(runtime.node), process.env.PATH ?? ''].join(delimiter), NODE_OPTIONS: '' },
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
      })
      let tail = ''
      const consume = (chunk: Buffer): void => { tail = (tail + chunk.toString()).slice(-6000) }
      child.stdout?.on('data', consume); child.stderr?.on('data', consume)
      const timer = setTimeout(() => {
        if (process.platform === 'win32' && child.pid) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
        else child.kill()
        reject(new Error('本机插件安装超时，请检查 pnpm 与日志后重试。'))
      }, 120_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => {
        clearTimeout(timer)
        if (code === 0) { process.stdout.write('[dsh-px] 自管插件安装与组合包协调完成\n'); resolveInstall() }
        else reject(new Error(`dsh plugin 退出码 ${code}：${tail}`))
      })
    })
  })
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
async function waitForReady (url: string, timeoutMs: number, child: ChildProcess): Promise<number> {
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
async function startHarness ({ runtime, home, port }: HarnessContext): Promise<HarnessStartResult> {
  const args = [runtime.dshEntry, '--profile', PROFILE_NAME, '--host', HOST, '--port', String(port), '--no-open']
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

  let settle: ((value: string | null) => void) | null = null
  const authUrl = new Promise<string | null>((res) => { settle = res })
  const output = new HarnessOutput(text => process.stdout.write(`[dsh] ${text}`))
  const consume = (chunk: Buffer): void => {
    const url = output.push(chunk.toString())
    if (url && settle) { const done = settle; settle = null; done(url) }
  }
  child.stdout?.on('data', consume)
  child.stderr?.on('data', consume)
  const failed = (message: string): void => {
    output.flush()
    if (harness === child) harness = null
    if (settle) { const done = settle; settle = null; done(null) }
    if (!quitting && !expectedStops.has(child)) {
      serviceState?.set('error', message)
      void showRecovery(`${message}\n\n${output.diagnostic}`).catch(err => {
        process.stderr.write(`[dsh-px] 恢复页加载失败：${errText(err)}\n`)
      })
    }
  }
  child.on('error', err => failed(`服务启动失败：${errText(err)}`))
  child.on('exit', (code, signal) => {
    process.stdout.write(`[dsh] harness exited code=${code} signal=${signal}\n`)
    failed(`Agent 服务已停止（code ${code ?? signal}）`)
  })

  return { child, authUrl }
}

/**
 * 在**若干已知布局**里定位一个随应用分发的资源。
 *
 * 为什么要收敛成一个函数：此前进度页、preload、托盘图标各自手写一份候选列表，
 * 于是同一个布局知识散在三处 —— 改一处漏两处正是本项目反复出问题的方式
 * （真实事故：`APP_ROOT` 算错导致找不到运行时；`out/renderer` 落到错误目录）。
 *
 * 覆盖的两种布局：
 *   开发态 / win-unpacked：`<仓库或 app 根>/<相对路径>`
 *   打包后（app.asar 内）  ：`<app.getAppPath()>/<相对路径>`
 *
 * 另外也试 `process.resourcesPath`：`extraResources` 放进去的资源
 * （如 `tray-32.png`）在那里，而不是在 asar 里。
 *
 * @param rel 相对路径，用 POSIX 写法（如 `out/renderer/index.html`）
 * @returns 第一个存在的绝对路径；都不存在返回 null
 */
function findShippedResource (...rel: string[]): string | null {
  const p = findShippedResourceQuiet(...rel)
  if (p === null) {
    const bases = [APP_ROOT, app.getAppPath(), process.resourcesPath ?? null]
      .filter((b): b is string => typeof b === 'string' && b.length > 0)
    const tried = bases.flatMap((b) => rel.map((r) => join(b, r)))
    process.stderr.write(
      `[dsh-px] 未找到随附资源 ${rel.join(' / ')}。已试：\n${tried.map((t) => `  - ${t}`).join('\n')}\n`
    )
  }
  return p
}

/** 同 `findShippedResource`，但找不到时不打日志（用于"缺了也无所谓"的资源）。 */
function findShippedResourceQuiet (...rel: string[]): string | null {
  const bases = [
    APP_ROOT,                                   // 开发态 / 解包目录
    app.getAppPath(),                           // 打包后（asar 内）
    process.resourcesPath ?? null               // extraResources 落点
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
function splashPagePath (): string | null {
  return findShippedResource(join('out', 'renderer', 'index.html'))
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
 * 进度页 preload 的路径。
 *
 * 找不到不算错：进度页没有 preload 也能正常显示，只是少了渲染进程侧的
 * 标题看守。因此这里**不抛错**，只如实说明 —— 所以不用 `findShippedResource`
 * 的告警路径，自己静默返回 null。
 */
function preloadPath (): string | null {
  const p = findShippedResourceQuiet(join('out', 'preload', 'index.cjs'))
  if (p === null) process.stderr.write('[dsh-px] 未找到进度页 preload，跳过（不影响启动）\n')
  return p
}

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
      spellcheck: false,
      // 进度页的 preload：只做窗口标题看守 + 暴露两个只读字符串。
      // 见 src/preload/index.ts。缺了它进度页仍能显示，只是少一层标题保护，
      // 所以这里不因为文件不存在就失败。
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
    // 页面加载失败（打包漏了资源、CSP 挡了脚本等）默认是**静默**的：
    // 窗口会停在一片空白或卡在初始文案上，而日志里什么都没有。
    // 这里显式接住 did-fail-load，并在加载后核对进度页的入口函数确实挂上了 ——
    // 这条可观测性直接对应"首启几秒到几分钟内屏幕上有没有反馈"，
    // 是本项目最难远程排查的一类问题。
    win.webContents.once('did-fail-load', (_e, code, desc, url) => {
      process.stderr.write(`[dsh-px] 进度页加载失败（${String(code)} ${desc}）：${url}\n`)
    })
    await win.loadFile(page)
    try {
      const ready = await win.webContents.executeJavaScript(
        "typeof window.__dshPxProgress === 'function'"
      ) as boolean
      process.stdout.write(ready
        ? '[dsh-px] 进度页已就绪（含进度推送入口）\n'
        : '[dsh-px] 警告：进度页已加载但缺少 __dshPxProgress 入口，进度将无法显示\n')
    } catch (err) {
      process.stderr.write(`[dsh-px] 核对进度页入口失败：${errText(err)}\n`)
    }
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
let updateController: UpdateController | null = null
let startupUpdateTimer: ReturnType<typeof setTimeout> | undefined

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
  setUpdateState({ supported: app.isPackaged && autoUpdater !== null })
  resetUpdateBridge()
  if (autoUpdater && app.isPackaged) {
    updateController = new UpdateController(autoUpdater, {
      lastCheckedAt: getUpdateState().lastCheckedAt,
      publish: (state) => {
        publishUpdateState({ status: state.status, version: state.version }, state)
        if (state.error) process.stderr.write(`[dsh-px] ${state.status}：${state.error}\n`)
      },
      ready: (version) => {
        if (process.env.DSH_PX_AUTO_UPDATE === '1') return
        notifyUpdate('DSH-PX 更新已就绪', `新版本 ${version} 已下载。可在设置或托盘中重启并安装，也会在退出时自动安装。`)
      },
      installing: (version) => notifyUpdate('DSH-PX 正在更新',
        `将在约 9 秒后退出并安装 ${version}。安装通常需要 1–4 分钟，完成后自动重启。`)
    })
    // 保留延后检查，避免启动阶段争抢资源；手动检查与此计时器共用并发保护。
    startupUpdateTimer = setTimeout(() => { void updateController?.check() }, 8000)
  } else {
    publishUpdateState({ status: '自动更新不可用', version: null }, {
      phase: 'idle', status: app.isPackaged ? '更新器不可用，请打开日志排查' : '开发态不支持自动更新（仅打包后可用）',
      version: null, percent: null, error: null, supported: false
    })
  }

  stopInstallWatch = watchShellActions((action) => {
    process.stdout.write(`[dsh-px] 处理界面请求：${action}\n`)
    switch (action) {
      case 'restart':
        // 先让 HTTP 202 响应返回浏览器，再关闭服务。
        setTimeout(() => { void restartHarness() }, 500)
        break
      case 'check':
        void checkUpdatesManually()
        break
      case 'install':
        installUpdateNow()
        break
      case 'open-data':
        void shell.openPath(app.getPath('userData'))
        break
      case 'open-log':
        shell.showItemInFolder(logPath())
        break
    }
  })
}

function notifyUpdate (title: string, body: string): void {
  try {
    const notification = new Notification({ title, body })
    notification.on('click', () => { win?.show(); win?.focus() })
    notification.show()
  } catch { /* 通知不可用时仍有设置页与托盘反馈 */ }
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
  // 用统一的资源定位：`tray-32.png` 在打包后由 extraResources 落在 resources/，
  // 开发态在仓库 build/。此前这里手写三份候选，与进度页/preload 的候选各写一份 ——
  // 同一个布局知识散在多处，正是本项目反复出问题的方式。
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
  if (tray && !tray.isDestroyed()) { tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(url))); return }
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
      click: () => { installUpdateNow() }
    })
  }

  items.push(
    { label: '手动检查更新', enabled: !['checking', 'downloading', 'ready', 'installing'].includes(getUpdateState().phase), click: () => void checkUpdatesManually() },
    { type: 'separator' },
    { label: '打开 DSH-PX', click: () => { if (win) { win.show(); win.focus() } else { void createShellWindow(); void loadHarnessUrl(url) } } },
    { label: '重启 harness', click: () => void restartHarness() },
    { type: 'separator' },
    { label: '打开日志文件', click: () => void shell.openPath(logPath()) },
    { label: '打开数据目录', click: () => void shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: '在浏览器中打开', click: () => void shell.openExternal(currentAuthenticatedUrl ?? currentCleanUrl ?? url) },
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

/** 两个入口共用状态检查；未下载/重复点击不会关闭当前会话。 */
function installUpdateNow (): void {
  if (quitting) return
  updateController?.install()
}

async function checkUpdatesManually (): Promise<void> {
  serviceState?.dispose()
  clearTimeout(startupUpdateTimer)
  if (updateController) await updateController.check()
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
function restartHarness (): Promise<boolean> {
  if (restartPending) return restartPending
  restartPending = restartHarnessOnce().finally(() => { restartPending = null })
  return restartPending
}

async function stopHarness (child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  expectedStops.add(child)
  await new Promise<void>((res, reject) => {
    const done = (): void => { clearTimeout(timer); res() }
    const timer = setTimeout(() => {
      child.removeListener('exit', done)
      expectedStops.delete(child)
      reject(new Error('旧服务尚未退出，未启动第二个服务；请打开日志排查。'))
    }, 8000)
    child.once('exit', done)
    if (process.platform === 'win32' && child.pid) {
      // PID 来自本外壳持有的活进程；同时清理该服务的工具子进程。
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
    } else child.kill()
  })
}

async function showRecovery (message: string): Promise<void> {
  if (!win || win.isDestroyed() || quitting) return
  const page = splashPagePath()
  if (!page) return
  await win.loadFile(page)
  await win.webContents.executeJavaScript(`window.__dshPxRecovery?.(${JSON.stringify(message)})`)
}

async function restartHarnessOnce (): Promise<boolean> {
  if (!ctxState || quitting) return false
  const { runtime, home, port: previousPort } = ctxState
  serviceState?.set('restarting', '正在重启服务')
  try {
    if (harness) await stopHarness(harness)
    const port = await findPort(previousPort)
    ctxState = { runtime, home, port }
    const cleanUrl = `http://${HOST}:${port}/`
    currentCleanUrl = cleanUrl
    const page = splashPagePath()
    if (win && page) await win.loadFile(page)
    reportSeedProgress({ done: 0, total: 0, copied: 0, phase: '正在重新连接 Agent 服务…' })
    const started = await startHarness(ctxState)
    harness = started.child
    await waitForReady(cleanUrl, READY_TIMEOUT_MS, started.child)
    const authUrl = await Promise.race([
      started.authUrl,
      new Promise<null>(res => setTimeout(() => res(null), 20_000))
    ])
    if (!authUrl || harness !== started.child) throw new Error('服务未完成鉴权初始化，请重试并查看日志。')
    currentAuthenticatedUrl = authUrl
    await loadHarnessUrl(authUrl)
    if (process.argv.includes('--open-browser')) await shell.openExternal(authUrl)
    serviceState?.set('running', '桌面服务运行中', started.child.pid)
    createTray(cleanUrl)
    return true
  } catch (err) {
    serviceState?.set('error', errText(err))
    await showRecovery(errText(err))
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

  serviceState = createServiceState(app.getPath('userData'))
  serviceState.set('starting', '正在准备本机服务')

  // 首启物化（同卷硬链接，秒级；跨卷回退复制，分钟级但有进度）。
  const home = await resolveHarnessHome(runtime, reportSeedProgress)

  const port = await findPort(DEFAULT_PORT)
  const cleanUrl = `http://${HOST}:${port}/`
  ctxState = { runtime, home, port }
  currentCleanUrl = cleanUrl

  process.stdout.write(`[dsh-px] node=${runtime.node}\n[dsh-px] dsh=${runtime.dshEntry}\n[dsh-px] DSH_HOME=${home}\n[dsh-px] url=${cleanUrl}\n`)

  createTray(cleanUrl)
  setupAutoUpdate()
  await restartHarness()

}

ipcMain.handle('dsh-px:recover', async (event, action: unknown) => {
  const page = splashPagePath()
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
      !page || event.senderFrame.url !== pathToFileURL(page).href) throw new Error('无效的恢复页面')
  if (action === 'retry') return restartHarness()
  if (action === 'log') { shell.showItemInFolder(logPath()); return true }
  if (action === 'data') { return (await shell.openPath(app.getPath('userData'))) === '' }
  throw new Error('未知操作')
})

app.on('window-all-closed', () => {
  // 一个没有窗口却还在运行的桌面客户端是维护负担；
  // 因此在所有平台上都随窗口一起退出。
  quitting = true
  app.quit()
})

app.on('before-quit', (event) => {
  quitting = true
  // 等待服务及其工具子进程结束。退出期间的重复 app.quit() 也必须等待同一轮清理。
  if (shutdownComplete) return
  if (shutdownPending) { event.preventDefault(); return }
  if (harness && harness.exitCode === null && harness.signalCode === null) {
    event.preventDefault()
    shutdownPending = true
    void stopHarness(harness).catch(err => {
      process.stderr.write(`[dsh-px] 停止服务失败：${errText(err)}\n`)
    }).finally(() => { shutdownComplete = true; app.quit() })
  }
})

app.on('will-quit', () => {
  // 停掉轮询/监视：否则退出过程中它还可能触发一次 quitAndInstall。
  serviceState?.dispose()
  clearTimeout(startupUpdateTimer)
  updateController?.dispose()
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
      process.stderr.write(`[dsh-px] 启动异常：${errText(err)}\n`)
      serviceState?.set('error', errText(err))
      dialog.showErrorBox(
        'DSH-PX —— 启动异常',
        `${String(err?.stack ?? err)}\n\n日志文件：${logPath()}`
      )
      app.exit(1)
    })
}
