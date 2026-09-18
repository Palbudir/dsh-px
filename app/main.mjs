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
import { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, cpSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
 * 选定 harness home。优先级：
 *   1. DSH_PX_HOME —— 显式覆盖（也是在开发插件时，把外壳指向你现有 ~/.dsh 的方式）。
 *   2. <userData>/dsh-home —— 应用自己的 home：首次运行从随附的树播种，
 *      此后归用户所有。
 * @returns {string}
 */
function resolveHarnessHome (runtime) {
  if (process.env.DSH_PX_HOME) return resolve(process.env.DSH_PX_HOME)

  const home = join(app.getPath('userData'), 'dsh-home')
  const seeded = join(home, '.dsh-px-seeded')
  if (!existsSync(seeded)) {
    if (runtime.seedHome) {
      mkdirSync(home, { recursive: true })
      cpSync(runtime.seedHome, home, { recursive: true, dereference: true, force: false, errorOnExist: false })
    } else {
      mkdirSync(join(home, 'profiles'), { recursive: true })
    }
    writeFileSync(seeded, `seeded from ${runtime.seedHome ?? '(empty)'} at ${new Date().toISOString()}\n`)
  }
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
    title: 'dsh-px',
    autoHideMenuBar: true,
    webPreferences: {
      // harness 前端是一个可信的本地源；别把 Node 暴露进去。
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
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

  void win.loadURL(url)
  return win
}

function createTray (url) {
  try {
    tray = new Tray(nativeImage.createEmpty())
    tray.setToolTip('dsh-px')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 dsh-px', click: () => { if (win) { win.show(); win.focus() } else { createWindow(url) } } },
      { type: 'separator' },
      { label: '重启 harness', click: () => void restartHarness() },
      { type: 'separator' },
      { label: '在浏览器中打开', click: () => void shell.openExternal(currentCleanUrl ?? url) },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit() } }
    ]))
    tray.on('double-click', () => { win?.show(); win?.focus() })
  } catch {
    // 托盘是尽力而为的；无头/CI 环境没有通知区域。
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

  app.whenReady().then(main).catch((err) => {
    dialog.showErrorBox('dsh-px —— 启动异常', String(err?.stack ?? err))
    app.exit(1)
  })
}
