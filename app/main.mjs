/**
 * dsh-px — Electron main process.
 *
 * Responsibility split (deliberate, keep it this way):
 *   - Electron owns ONLY the desktop shell: window, tray, menus, lifecycle.
 *   - The bundled `dsh` CLI owns ALL harness capability: agent, tools, sessions,
 *     plugin composition, settings. We never reimplement harness behaviour here.
 *
 * That is what makes "at least official dsh capability" reachable: the packaged
 * runtime IS the official dsh install, launched unmodified, with the same
 * profile composition a `dsh --profile web` invocation would build.
 *
 * @module dsh-px/main
 */
import { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))          // <app>/app
const APP_ROOT = resolve(HERE, '..')                          // <app>
const PROFILE_NAME = process.env.DSH_PX_PROFILE ?? 'web'
const HOST = '127.0.0.1'
const DEFAULT_PORT = Number(process.env.DSH_PX_PORT ?? 3080)
/** How long to wait for the harness HTTP surface to answer before giving up. */
const READY_TIMEOUT_MS = Number(process.env.DSH_PX_READY_TIMEOUT_MS ?? 180_000)

/** @type {import('node:child_process').ChildProcess | null} */
let harness = null
/** @type {BrowserWindow | null} */
let win = null
/** @type {Tray | null} */
let tray = null
let quitting = false

/**
 * Resolve the staged runtime. Supports two layouts so the same code runs in
 * development and inside an installed app:
 *   packaged:  <resources>/runtime/{node,dsh,dsh-home}
 *   dev:       <repo>/runtime/{node,dsh,dsh-home}
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
 * Pick the harness home. Precedence:
 *   1. DSH_PX_HOME   — explicit override (also how you point the shell at an
 *                      existing ~/.dsh during plugin development).
 *   2. <userData>/dsh-home — the app's own home, seeded from the bundled tree
 *                      on first run and thereafter owned by the user.
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
 * Find a free TCP port, preferring `preferred` so an already-running harness on
 * the default port is reused rather than duplicated.
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
 * Poll the harness HTTP surface until it answers. Any HTTP status (including
 * 401 from the browser-trust fence) proves the server is listening; a connection
 * refusal is what we are waiting out.
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
 * The harness fences its browser surface with a per-process launch token: the
 * plain `http://127.0.0.1:<port>/` answers 401, and only the URL `dsh web`
 * announces (`authenticatedUrl()` = clean URL + process token) exchanges that
 * token for the signed browser-session cookie.
 *
 * So the shell must not guess the URL — it reads the one the harness prints.
 * The clean URL stays the readiness probe; the announced URL is what we load.
 * @param {string} text
 * @returns {string | null}
 */
function extractAuthenticatedUrl (text) {
  const match = text.match(/dsh web:\s*(http:\/\/\S+)/)
  return match ? match[1] : null
}

/**
 * Spawn the bundled harness and resolve once it announces its authenticated URL.
 * @param {{runtime:any, home:string, port:number}} opts
 * @returns {{child: import('node:child_process').ChildProcess, authUrl: Promise<string|null>}}
 */
function startHarness ({ runtime, home, port }) {
  const args = [runtime.dshEntry, '--profile', PROFILE_NAME, '--host', HOST, '--port', String(port), '--no-open']
  const env = {
    ...process.env,
    DSH_HOME: home,
    DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE ?? 'workspace-write',
    // Electron ships its own Node; the harness must run on the bundled runtime.
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
    // Unblock a pending URL wait so the caller reports "exited early" rather
    // than hanging until the readiness timeout.
    if (settle) { const done = settle; settle = null; done(null) }
    if (!quitting) {
      dialog.showErrorBox('dsh-px',
        `The harness process exited unexpectedly (code ${code}).\n\nLast output:\n${announced.slice(-1500)}`)
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
      // The harness frontend is a trusted local origin; keep Node out of it.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => { win = null })

  // External links open in the real browser, never inside the shell.
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
      { label: 'Open dsh-px', click: () => { if (win) { win.show(); win.focus() } else { createWindow(url) } } },
      { type: 'separator' },
      { label: 'Open in browser', click: () => void shell.openExternal(url) },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit() } }
    ]))
    tray.on('double-click', () => { win?.show(); win?.focus() })
  } catch {
    // Tray is best-effort; headless/CI environments have no notification area.
  }
}

async function main () {
  const runtime = resolveRuntime()
  if (!runtime) {
    dialog.showErrorBox(
      'dsh-px — runtime missing',
      'The bundled runtime was not found.\n\nRun `npm run stage` to assemble it, then start again.'
    )
    app.exit(1)
    return
  }

  const home = resolveHarnessHome(runtime)
  const port = await findPort(DEFAULT_PORT)
  const cleanUrl = `http://${HOST}:${port}/`

  process.stdout.write(`[dsh-px] node=${runtime.node}\n[dsh-px] dsh=${runtime.dshEntry}\n[dsh-px] DSH_HOME=${home}\n[dsh-px] url=${cleanUrl}\n`)

  const started = startHarness({ runtime, home, port })
  harness = started.child

  let openUrl = cleanUrl
  try {
    const status = await waitForReady(cleanUrl, READY_TIMEOUT_MS)
    process.stdout.write(`[dsh-px] harness listening (HTTP ${status}) at ${cleanUrl}\n`)
    // Prefer the URL the harness announced: it carries the per-process launch
    // token, and loading the clean URL would just 401 at the browser fence.
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
    dialog.showErrorBox('dsh-px — harness failed to start', String(err?.message ?? err))
    quitting = true
    app.quit()
    return
  }

  createWindow(openUrl)
  createTray(cleanUrl)
}

app.on('window-all-closed', () => {
  // A desktop client that keeps running with no window is a support burden;
  // quit with the window on every platform.
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

app.whenReady().then(main).catch((err) => {
  dialog.showErrorBox('dsh-px — startup error', String(err?.stack ?? err))
  app.exit(1)
})
