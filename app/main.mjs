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
import { existsSync, mkdirSync, cpSync, writeFileSync, readdirSync, realpathSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve, sep } from 'node:path'
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
 * 判定某个目录项是否是"dsh 自己管理的 fallback 链接"，这类链接**绝不能复制**。
 *
 * 实测背景：开发机上 `profiles/node_modules` 有 **164 个 Junction 全部指向
 * `runtime/dsh/node_modules`**（dsh 自己的包树），另有 23 个实体目录才是真三方依赖。
 * dsh 启动时会断言这些 fallback 必须是链接或它自己管理的 proxy，
 * 一旦被解引用成真目录就拒绝启动：
 *
 *   dsh: <home>/profiles/node_modules/commander exists and is not a symlink or
 *        dsh-managed module proxy
 *
 * 不能只按名字猜（`@deepseek-ai` 只是其中一部分，`commander`、`accepts` 等同样是），
 * 要按**链接目标**判断。也正因如此不能笼统地"排除所有 node_modules" ——
 * pnpm 的 `.pnpm` 内部链接指向 profile 自己的 store，那是真依赖，必须复制。
 * @param {string|null} dshDir 随附的 dsh 安装目录
 * @returns {(entry: import('node:fs').Dirent, fullPath: string) => boolean}
 */
function makeDshFallbackFilter (dshDir) {
  if (!dshDir) return () => false
  const prefix = (join(dshDir, 'node_modules') + sep).toLowerCase()
  return (entry, fullPath) => {
    // dsh / 插件自己的状态目录一律不复制。它们都是生成物，首次启动会自行重建，
    // 而复制它们会把 Junction 解引用成真目录，从而让 dsh 拒绝启动：
    //   .dsh-module-fallback —— profile 内的 module fallback 树，其 Junction 指向
    //     profile 自己的 node_modules；
    //   .dsh-market —— 插件市场状态。
    if (entry.name.startsWith('.dsh-')) return true

    if (!entry.isSymbolicLink()) return false
    let target
    try { target = realpathSync(fullPath) } catch { return true } // 悬空链接一律跳过
    return (target + sep).toLowerCase().startsWith(prefix)
  }
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
        // profiles/ 下混着两种东西：三方插件依赖（要复制）与 dsh 自己管理的
        // fallback 链接（绝不能复制，解引用后 dsh 会拒绝启动）。
        // 见 makeDshFallbackFilter。
        const isDshFallback = makeDshFallbackFilter(join(runtime.root, 'dsh'))
        copyProfileTree(from, to, { skip: SKIP_IN_PROFILE_TREE, skipEntry: isDshFallback })
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
