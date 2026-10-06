import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import {
  appKey,
  BLOCKED_ORIGINS,
  commandProgram,
  deniedKeys,
  deniedUrl,
  deniedWindow,
  launchDecision,
  launchFolders
} from '../packages/dsh-px-computer/src/policy'
import {
  DESKTOP_TOOLS,
  DesktopDriver,
  runDesktopTool,
  type DesktopContext,
  type DriverLike
} from '../packages/dsh-px-computer/src/desktop'
import {
  BROWSER_TOOLS,
  browserArgs,
  checkBrowserArgs,
  childEnv,
  removeQuietly,
  shapeBrowserText,
  sweepOutput,
  targetSite
} from '../packages/dsh-px-computer/src/browser'
import { McpStdioClient } from '../packages/dsh-px-computer/src/mcp-stdio'
import { SettingsStore } from '../packages/dsh-px-computer/src/settings'
import { SessionStates } from '../packages/dsh-px-computer/src/runtime'
import { apply } from '../packages/dsh-px-computer/src/index'

const contract = JSON.parse(readFileSync('test/fixtures/cua-driver-0.28.0-tools.json', 'utf8'))

function temp(t: any, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

test('hard deny list covers terminals, security, credentials, remote control and agent apps', () => {
  for (const appName of [
    'cmd.exe',
    'WindowsTerminal.exe',
    'pwsh.exe',
    'regedit.exe',
    'KeePassXC.exe',
    'ToDesk.exe',
    'DSH-PX Desktop.exe',
    'ChatGPT.exe',
    'C:\\Windows\\System32\\consent.exe'
  ])
    assert.ok(deniedWindow({ appName }), appName)
  assert.ok(deniedWindow({ appName: 'ApplicationFrameHost.exe', title: 'Windows 安全中心' }))
  assert.ok(deniedWindow({ appName: 'explorer.exe', title: '运行' }))
  assert.equal(deniedWindow({ appName: 'notepad.exe', title: '终端配置说明.txt - 记事本' }), undefined)
  assert.equal(deniedWindow({ appName: 'ApplicationFrameHost.exe', title: '计算器' }), undefined)
})

test('UWP windows are granted per app title, not for the whole frame host', () => {
  const calculator = appKey({ appName: 'ApplicationFrameHost.exe', title: '计算器' })
  const settings = appKey({ appName: 'ApplicationFrameHost.exe', title: '设置' })
  assert.notEqual(calculator, settings)
  assert.equal(
    appKey({ appName: 'Notepad.exe', title: 'a.txt - 记事本' }),
    appKey({ appName: 'notepad.exe' })
  )
})

test('Windows key chords and the secure attention sequence are refused', () => {
  assert.ok(deniedKeys(['win', 'r']))
  assert.ok(deniedKeys(['Super_L+r']))
  assert.ok(deniedKeys(['meta']))
  assert.ok(deniedKeys(['ctrl', 'alt', 'delete']))
  assert.equal(deniedKeys(['ctrl', 's']), undefined)
  assert.equal(deniedKeys(['return']), undefined)
})

test('launch checks deny shells and scripts and confirm installers, fresh downloads and unknown folders', () => {
  const downloads = {
    downloads: ['D:\\Profile\\Downloads'],
    trusted: ['C:\\Windows', 'C:\\Program Files', 'D:\\Profile\\AppData\\Local\\Programs']
  }
  assert.equal(launchDecision({ name: 'cmd' }, downloads).kind, 'deny')
  assert.equal(launchDecision({ name: 'Windows Terminal' }, downloads).kind, 'deny')
  assert.equal(
    launchDecision({ path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }, downloads)
      .kind,
    'deny'
  )
  assert.equal(
    launchDecision({ launch_path: '"C:\\Windows\\System32\\cmd.exe" /c whoami' }, downloads).kind,
    'deny'
  )
  assert.equal(launchDecision({ path: 'D:\\tools\\setup.bat' }, downloads).kind, 'deny')
  assert.equal(launchDecision({ path: 'D:\\tools\\run.lnk' }, downloads).kind, 'deny')
  assert.deepEqual(launchDecision({ path: 'D:\\Profile\\Downloads\\tool.exe' }, downloads), {
    kind: 'confirm',
    reason: '运行新下载的程序'
  })
  assert.equal(launchDecision({ path: 'D:\\pkg\\app.msi' }, downloads).kind, 'confirm')
  // A renamed copy of a denied binary is not recognizable by name, so its location decides.
  assert.deepEqual(launchDecision({ path: 'D:\\Users\\Public\\mytool.exe' }, downloads), {
    kind: 'confirm',
    reason: '运行不在常用程序目录中的程序'
  })
  assert.equal(
    launchDecision({ path: 'D:\\Profile\\AppData\\Local\\Programs\\Editor\\editor.exe' }, downloads).kind,
    'allow'
  )
  assert.equal(
    launchDecision(
      { launch_path: 'shell:appsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
      downloads
    ).kind,
    'allow'
  )
  assert.equal(
    launchDecision({ launch_path: '"C:\\Program Files\\App\\app.exe" --profile x' }, downloads).kind,
    'allow'
  )
  const folders = launchFolders({
    USERPROFILE: 'D:\\Profile',
    LOCALAPPDATA: 'D:\\Profile\\AppData\\Local',
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    TEMP: 'D:\\Profile\\AppData\\Local\\Temp'
  })
  assert.ok(folders.downloads.includes('D:\\Profile\\Desktop'))
  assert.ok(folders.trusted.includes('D:\\Profile\\AppData\\Local\\Programs'))
  assert.equal(commandProgram('"C:\\Program Files\\App\\app.exe" --x'), 'C:\\Program Files\\App\\app.exe')
  assert.equal(commandProgram('C:\\Apps\\tool.exe --x'), 'C:\\Apps\\tool.exe')
})

test('Start, search, the taskbar, the desktop and localized Run dialogs are shell surfaces', () => {
  for (const window of [
    { appName: 'StartMenuExperienceHost.exe', title: '开始' },
    { appName: 'SearchHost.exe', title: '搜索' },
    { appName: 'explorer.exe', title: '' },
    { appName: 'explorer.exe', title: 'Program Manager' },
    { appName: 'explorer.exe', title: 'Ausführen' },
    { appName: 'explorer.exe', title: '実行' }
  ])
    assert.ok(deniedWindow(window), JSON.stringify(window))
  assert.equal(deniedWindow({ appName: 'explorer.exe', title: '下载' }), undefined)
})

test('browser URLs are limited to web pages and never reach password managers', () => {
  assert.equal(deniedUrl('https://example.com/a?b=1'), undefined)
  assert.equal(deniedUrl('about:blank'), undefined)
  for (const url of [
    'file:///C:/Windows/win.ini',
    'javascript:alert(1)',
    'edge://settings/passwords',
    'chrome://extensions',
    'https://user:pass@example.com/',
    'https://vault.bitwarden.com/#/vault',
    'https://my.1password.com/',
    'https://passwords.google.com/',
    'not a url'
  ])
    assert.ok(deniedUrl(url), url)
  assert.ok(BLOCKED_ORIGINS.every((origin) => /^https:\/\/[a-z0-9.-]+$/.test(origin)))
})

test('every curated desktop tool maps onto the pinned Cua Driver contract', () => {
  assert.equal(contract.driverVersion, '0.28.0')
  const pxOnly: Record<string, string[]> = { computer_list_apps: ['query'] }
  for (const tool of DESKTOP_TOOLS) {
    const driver = contract.tools[tool.driver]
    assert.ok(driver, `${tool.name} → ${tool.driver}`)
    const props = (tool.parameters as any).properties ?? {}
    for (const key of Object.keys(props)) {
      if (pxOnly[tool.name]?.includes(key)) continue
      assert.ok(key in driver.properties, `${tool.name}.${key} is not a ${tool.driver} parameter`)
      if (props[key].enum)
        for (const value of props[key].enum)
          assert.ok(driver.properties[key].enum?.includes(value), `${tool.name}.${key}=${value}`)
    }
    for (const key of tool.pass) assert.ok(key in props, `${tool.name} passes undeclared ${key}`)
    const required = new Set([...((tool.parameters as any).required ?? []), 'session', 'snapshot_id'])
    for (const key of driver.required) assert.ok(required.has(key), `${tool.name} leaves ${key} unset`)
    if (tool.session) assert.ok('session' in driver.properties, `${tool.driver} has no session`)
  }
  for (const name of ['click', 'type_text', 'press_key', 'set_value'])
    assert.ok('snapshot_id' in contract.tools[name].properties)
  for (const name of ['start_session', 'set_agent_cursor_enabled', 'end_session'])
    assert.ok('session' in contract.tools[name].properties)
  const exposed = DESKTOP_TOOLS.map((tool) => tool.driver)
  for (const unsafe of [
    'kill_app',
    'get_desktop_state',
    'clipboard_read',
    'replay_trajectory',
    'set_config',
    'browser_navigate'
  ])
    assert.ok(!exposed.includes(unsafe), unsafe)
  const launch = DESKTOP_TOOLS.find((tool) => tool.name === 'computer_launch_app')!
  assert.deepEqual(Object.keys((launch.parameters as any).properties).sort(), [
    'aumid',
    'launch_path',
    'name',
    'path'
  ])
})

/** A scripted stand-in for the in-process driver. */
function fakeDriver(windows: any[], extra: Record<string, (args: any) => any> = {}) {
  const calls: Array<{ name: string; args: any }> = []
  const driver: DriverLike = {
    async callTool(name, json) {
      const args = JSON.parse(json)
      calls.push({ name, args })
      const body =
        extra[name]?.(args) ??
        (name === 'list_windows'
          ? {
              structuredContent: {
                windows: windows.filter((w) => args.pid === undefined || w.pid === args.pid)
              }
            }
          : name === 'get_window_state'
            ? {
                content: [
                  { type: 'text', text: 'tree' },
                  ...(args.include_screenshot ? [{ type: 'image', data: 'AA==', mimeType: 'image/png' }] : [])
                ],
                structuredContent: {
                  snapshot_id: 's00000007',
                  tree_markdown: '- [0] Button "确定"',
                  element_count: 1,
                  total_element_count: 1,
                  returned_element_count: 1
                }
              }
            : { content: [{ type: 'text', text: `${name} ok` }] })
      return { rawJson: JSON.stringify(body) }
    },
    async shutdown() {}
  }
  return { calls, driver: new DesktopDriver(async () => driver) }
}

function context(driver: DesktopDriver, overrides: Partial<DesktopContext> = {}) {
  const authorized: string[] = [],
    launches: Array<[string, string | undefined]> = []
  const c: DesktopContext = {
    driver,
    sessionId: 'session-a',
    signal: new AbortController().signal,
    seesImages: true,
    snapshots: new Map(),
    env: { USERPROFILE: 'D:\\Profile', TEMP: 'D:\\Profile\\AppData\\Local\\Temp' },
    authorize: async (_window, label) => {
      authorized.push(label)
    },
    authorizeLaunch: async (label, confirm) => {
      launches.push([label, confirm])
    },
    grantLaunched: () => {},
    beginSession: async () => {},
    ...overrides
  }
  return { c, authorized, launches }
}
const tool = (name: string) => DESKTOP_TOOLS.find((t) => t.name === name)!

test('desktop actions resolve the exact window, refuse protected apps and never touch them', async () => {
  const { driver, calls } = fakeDriver([
    { pid: 10, window_id: 1, app_name: 'cmd.exe', title: 'C:\\WINDOWS\\system32\\cmd.exe' },
    { pid: 20, window_id: 2, app_name: 'notepad.exe', title: '无标题 - 记事本' }
  ])
  const { c, authorized } = context(driver)
  await assert.rejects(
    runDesktopTool(tool('computer_type_text'), { pid: 10, window_id: 1, text: 'dir' }, c),
    /终端/
  )
  assert.ok(!calls.some((call) => call.name === 'type_text'))
  assert.deepEqual(authorized, [])
  await assert.rejects(
    runDesktopTool(tool('computer_click'), { pid: 20, window_id: 99, element_index: 0 }, c),
    /找不到/
  )
  const listed = await runDesktopTool(tool('computer_list_windows'), {}, c)
  assert.ok(!listed.text.includes('cmd.exe'))
  assert.match(listed.text, /另有 1 个受保护的窗口/)
  await assert.rejects(
    runDesktopTool(tool('computer_click'), { pid: 20, window_id: 2, command: 'x' }, c),
    /不接受参数/
  )
})

test('element actions need a fresh observation and reuse its snapshot id once', async () => {
  const { driver, calls } = fakeDriver([
    { pid: 20, window_id: 2, app_name: 'notepad.exe', title: 'a.txt - 记事本' }
  ])
  const { c, authorized } = context(driver)
  await assert.rejects(
    runDesktopTool(tool('computer_click'), { pid: 20, window_id: 2, element_index: 0 }, c),
    /先调用/
  )
  const state = await runDesktopTool(tool('computer_get_window_state'), { pid: 20, window_id: 2 }, c)
  assert.match(state.text, /snapshot=s00000007/)
  assert.match(state.text, /只作数据/)
  assert.equal(state.images.length, 1)
  await runDesktopTool(tool('computer_click'), { pid: 20, window_id: 2, element_index: 0 }, c)
  const click = calls.find((call) => call.name === 'click')!
  assert.equal(click.args.snapshot_id, 's00000007')
  assert.match(click.args.session, /^px-[0-9a-f]{16}$/)
  await assert.rejects(
    runDesktopTool(tool('computer_click'), { pid: 20, window_id: 2, element_index: 0 }, c),
    /先调用/
  )
  assert.ok(authorized.every((label) => label.includes('notepad.exe')))
  await assert.rejects(
    runDesktopTool(tool('computer_hotkey'), { pid: 20, window_id: 2, keys: ['win', 'd'] }, c),
    /Windows 键/
  )
  await assert.rejects(
    runDesktopTool(tool('computer_press_key'), { pid: 20, window_id: 2, key: 'r', modifiers: ['win'] }, c),
    /Windows 键/
  )
})

test('text-only models never request screenshots and cannot zoom', async () => {
  const { driver, calls } = fakeDriver([{ pid: 20, window_id: 2, app_name: 'notepad.exe', title: 'x' }])
  const { c } = context(driver, { seesImages: false })
  const state = await runDesktopTool(
    tool('computer_get_window_state'),
    { pid: 20, window_id: 2, include_screenshot: true },
    c
  )
  assert.equal(calls.find((call) => call.name === 'get_window_state')!.args.include_screenshot, false)
  assert.equal(state.images.length, 0)
  assert.match(state.text, /不支持图片/)
  await assert.rejects(
    runDesktopTool(tool('computer_zoom'), { pid: 20, window_id: 2, x1: 0, y1: 0, x2: 9, y2: 9 }, c),
    /不支持图片/
  )
})

test('launch refuses shells, confirms fresh downloads and grants only the windows it opened', async () => {
  const { driver, calls } = fakeDriver([{ pid: 30, window_id: 3, app_name: 'tool.exe', title: 'Tool' }], {
    launch_app: () => ({ structuredContent: { pid: 30, windows: [{ window_id: 3, title: 'Tool' }] } })
  })
  const granted: string[][] = []
  const { c, launches } = context(driver, { grantLaunched: (w) => granted.push(w.map((x) => x.appName)) })
  await assert.rejects(runDesktopTool(tool('computer_launch_app'), { name: 'powershell' }, c), /终端/)
  await assert.rejects(runDesktopTool(tool('computer_launch_app'), { path: 'C:\\x\\a.ps1' }, c), /脚本/)
  assert.ok(!calls.some((call) => call.name === 'launch_app'))
  const result = await runDesktopTool(
    tool('computer_launch_app'),
    { path: 'D:\\Profile\\Downloads\\tool.exe' },
    c
  )
  assert.deepEqual(launches, [['D:\\Profile\\Downloads\\tool.exe', '运行新下载的程序']])
  assert.deepEqual(granted, [['tool.exe']])
  assert.match(result.text, /pid=30/)
})

test('a UWP launch grants only its own window, never other apps in the shared frame host', async () => {
  const { driver } = fakeDriver(
    [
      { pid: 7, window_id: 70, app_name: 'ApplicationFrameHost.exe', title: '计算器' },
      { pid: 7, window_id: 71, app_name: 'ApplicationFrameHost.exe', title: '设置' }
    ],
    { launch_app: () => ({ structuredContent: { pid: 7, windows: [{ window_id: 70, title: '计算器' }] } }) }
  )
  const granted: string[] = []
  const { c } = context(driver, { grantLaunched: (w) => granted.push(...w.map((x) => appKey(x))) })
  await runDesktopTool(
    tool('computer_launch_app'),
    { aumid: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
    c
  )
  assert.deepEqual(granted, ['applicationframehost.exe|计算器'])
  const { driver: quiet } = fakeDriver(
    [{ pid: 7, window_id: 71, app_name: 'ApplicationFrameHost.exe', title: '设置' }],
    {
      launch_app: () => ({ structuredContent: { pid: 7, windows: [] } })
    }
  )
  granted.length = 0
  const second = context(quiet, { grantLaunched: (w) => granted.push(...w.map((x) => appKey(x))) })
  await runDesktopTool(tool('computer_launch_app'), { name: 'Calculator' }, second.c)
  assert.deepEqual(granted, [])
})

test('driver calls are serialized and a failed load is retried', async () => {
  let attempts = 0,
    running = 0,
    peak = 0
  const driver = new DesktopDriver(async () => {
    attempts += 1
    if (attempts === 1) throw new Error('missing dll')
    return {
      async callTool() {
        running += 1
        peak = Math.max(peak, running)
        await new Promise((r) => setTimeout(r, 5))
        running -= 1
        return { rawJson: '{"content":[]}' }
      },
      async shutdown() {}
    }
  })
  const signal = new AbortController().signal
  await assert.rejects(driver.call('list_apps', {}, signal), /无法加载 Cua Driver：missing dll/)
  await Promise.all([1, 2, 3].map(() => driver.call('list_apps', {}, signal)))
  assert.equal(attempts, 2)
  assert.equal(peak, 1)
})

test('browser launches keep files out of the project and never skip the extension consent', () => {
  const base = { headless: false, cli: 'C:/m/cli.js', node: 'node.exe', electron: true, profileDir: 'D:/p' }
  const isolated = browserArgs({ ...base, mode: 'isolated' }, 'T:/out')
  assert.deepEqual(isolated.slice(0, 7), [
    'C:/m/cli.js',
    '--browser',
    'msedge',
    '--codegen',
    'none',
    '--output-dir',
    'T:/out'
  ])
  assert.ok(isolated.includes('--isolated') && !isolated.includes('--headless'))
  assert.ok(browserArgs({ ...base, mode: 'isolated', headless: true }, 'T').includes('--headless'))
  const profile = browserArgs({ ...base, mode: 'profile' }, 'T')
  assert.equal(profile[profile.indexOf('--user-data-dir') + 1], 'D:/p')
  const extension = browserArgs({ ...base, mode: 'extension', headless: true }, 'T')
  assert.ok(
    extension.includes('--extension') &&
      !extension.includes('--headless') &&
      !extension.includes('--isolated')
  )
  const env = childEnv(
    {
      Path: 'C:/bin',
      LOCALAPPDATA: 'L',
      DEEPSEEK_API_KEY: 'secret',
      PLAYWRIGHT_MCP_EXTENSION_TOKEN: 'skip-consent',
      PLAYWRIGHT_MCP_CDP_ENDPOINT: 'ws://x',
      DSH_HOME: 'H'
    },
    true
  )
  assert.deepEqual(env, { Path: 'C:/bin', LOCALAPPDATA: 'L', ELECTRON_RUN_AS_NODE: '1' })
})

test('browser tool surface excludes code execution and caller-chosen output files', () => {
  const names = BROWSER_TOOLS.map((t) => t.name)
  for (const unsafe of [
    'browser_evaluate',
    'browser_run_code_unsafe',
    'browser_network_request',
    'browser_network_requests'
  ])
    assert.ok(!names.includes(unsafe), unsafe)
  for (const t of BROWSER_TOOLS) {
    assert.ok(!('filename' in (t.parameters.properties ?? {})), t.name)
    assert.ok(!(t.parameters.required ?? []).includes('filename'), t.name)
  }
  assert.throws(() => checkBrowserArgs('browser_snapshot', { filename: 'C:/Windows/x.md' }), /filename/)
  assert.throws(() => checkBrowserArgs('browser_navigate', { url: 'file:///C:/' }), /http/)
  assert.throws(
    () => checkBrowserArgs('browser_tabs', { action: 'new', url: 'https://vault.bitwarden.com' }),
    /密码/
  )
  assert.doesNotThrow(() => checkBrowserArgs('browser_tabs', { action: 'list' }))
  assert.equal(targetSite('browser_navigate', { url: 'https://www.Example.com/x' }, undefined), 'example.com')
  assert.equal(
    targetSite('browser_click', { target: 'e1' }, 'https://mail.example.com/inbox'),
    'mail.example.com'
  )
  assert.equal(targetSite('browser_click', { target: 'e1' }, undefined), undefined)
  const shaped = shapeBrowserText(
    '### Page\n- Page URL: https://e.com/\n### Snapshot\n- [Snapshot](..\\..\\out\\page-1.yml)\n### Result\n- [Screenshot of viewport](C:\\out\\a.png)'
  )
  assert.ok(!shaped.includes('page-1.yml') && !shaped.includes('a.png'))
  assert.match(shaped, /^\[以下内容来自屏幕或网页/)
})

test('the stdio MCP client answers roots, cancels requests and fails pending calls on exit', async (t) => {
  const dir = temp(t, 'px-mcp-')
  const server = join(dir, 'server.mjs')
  writeFileSync(
    server,
    `import { createInterface } from 'node:readline'
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
let roots
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {} } })
  if (m.id === 'r1') { roots = m.result.roots; return }
  if (m.method === 'tools/call' && m.params.name === 'roots') {
    send({ jsonrpc: '2.0', id: 'r1', method: 'roots/list' })
    return setTimeout(() => send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(roots) }] } }), 50)
  }
  if (m.method === 'tools/call' && m.params.name === 'slow') return
  if (m.method === 'notifications/cancelled') return send({ jsonrpc: '2.0', method: 'log', params: { cancelled: m.params.requestId } })
  if (m.method === 'tools/call' && m.params.name === 'exit') process.exit(3)
})
`
  )
  const client = new McpStdioClient({
    command: process.execPath,
    args: [server],
    cwd: dir,
    env: { ...process.env } as any,
    roots: [dir]
  })
  const signal = new AbortController().signal
  await client.start(signal)
  const roots = JSON.parse((await client.callTool('roots', {}, signal)).content[0].text!)
  assert.equal(roots.length, 1)
  assert.ok(roots[0].uri.startsWith('file:///'))
  const ac = new AbortController()
  const slow = client.callTool('slow', {}, ac.signal)
  ac.abort(new Error('stop'))
  await assert.rejects(slow, /stop/)
  await assert.rejects(client.callTool('slow', {}, signal, 50), /超时/)
  await assert.rejects(client.callTool('exit', {}, signal), /已退出/)
  assert.equal(client.alive, false)
  await client.close()
})

test('settings start disabled, reject stale or invalid edits and survive corruption', (t) => {
  const dir = temp(t, 'px-computer-settings-')
  const file = join(dir, 'settings.json')
  const store = new SettingsStore(file)
  assert.equal(store.read().desktop, false)
  assert.equal(store.read().browser, 'off')
  const next = store.change(0, (s) => {
    s.desktop = true
    s.browser = 'isolated'
  })
  assert.equal(next.revision, 1)
  assert.throws(() => store.change(0, () => {}), /其他窗口/)
  assert.throws(() => store.change(1, (s) => ((s as any).browser = 'cdp')), /无效/)
  assert.equal(new SettingsStore(file).read().browser, 'isolated')
  writeFileSync(file, '{broken')
  assert.equal(new SettingsStore(file).read().desktop, false)
})

test('session state pauses and aborts running calls and forgets a finished session', async () => {
  const states = new SessionStates()
  let aborted = false
  const running = states.track('s', new AbortController().signal, (signal) => {
    return new Promise((_, reject) =>
      signal.addEventListener('abort', () => {
        aborted = true
        reject(signal.reason)
      })
    )
  })
  assert.equal(states.pause('s'), 1)
  await assert.rejects(running, /停止/)
  assert.ok(aborted)
  await assert.rejects(
    states.track('s', new AbortController().signal, async () => 1),
    /暂停/
  )
  states.resume('s')
  assert.equal(await states.track('s', new AbortController().signal, async () => 1), 1)
  states.grant('s', 'notepad.exe', '记事本')
  states.forget('s')
  assert.equal(states.granted('s', 'notepad.exe'), false)
})

function hostFixture(t: any) {
  const dir = temp(t, 'px-computer-host-'),
    old = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(() => {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
  })
  const tools = new Map<string, any>(),
    sections: any[] = []
  let handler: any
  const host: any = {
    on: () => {},
    effect: (fn: any) => fn(),
    get: () => undefined,
    connection: { requestRejection: () => undefined },
    webServer: { register: (route: any) => ((handler = route.handler), () => {}) },
    systemPrompt: { section: (s: any) => (sections.push(s), () => {}) },
    tools: {
      register: (definition: any) => {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      }
    },
    inject: (_names: string[], cb: any) => cb(host)
  }
  apply(host)
  const request = async (method: string, body?: unknown) => {
    const bytes = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req: any = Readable.from(bytes)
    Object.assign(req, {
      method,
      url: '/dsh-px-computer?sessionId=s1',
      headers: { host: '127.0.0.1', 'content-type': 'application/json', 'x-dsh-px-request': '1' }
    })
    let status = 0,
      json: any
    await handler(req, { writeHead: (n: number) => (status = n), end: (v: string) => (json = JSON.parse(v)) })
    return { status, json }
  }
  return { dir, tools, sections, request }
}

test(
  'tools and guidance appear only after the user enables them, on Windows',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { tools, sections, request } = hostFixture(t)
    assert.equal(tools.size, 0)
    assert.equal(sections[0].text(), '')
    let view = (await request('GET')).json
    assert.equal(view.settings.desktop, false)
    view = (await request('POST', { action: 'settings', revision: 0, desktop: true })).json
    assert.ok(tools.has('computer_click') && tools.has('computer_confirm') && !tools.has('browser_navigate'))
    assert.match(sections[0].text(), /computer_\*/)
    view = (
      await request('POST', { action: 'settings', revision: view.settings.revision, browser: 'isolated' })
    ).json
    assert.ok(tools.has('browser_snapshot') && !tools.has('browser_evaluate'))
    await request('POST', {
      action: 'settings',
      revision: view.settings.revision,
      desktop: false,
      browser: 'off'
    })
    assert.equal(tools.size, 0)
    assert.equal(sections[0].text(), '')
  }
)

test(
  'panel actions cannot pre-authorize apps the session never granted, and pause blocks tools',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { tools, request } = hostFixture(t)
    const enabled = (await request('POST', { action: 'settings', revision: 0, desktop: true })).json
    const forged = await request('POST', {
      action: 'always-allow-app',
      revision: enabled.settings.revision,
      key: 'cmd.exe',
      label: 'cmd'
    })
    assert.equal(forged.status, 400)
    assert.equal((await request('POST', { action: 'nope' })).status, 400)
    await request('POST', { action: 'pause' })
    const agent = { session: { id: 's1', header: { id: 's1' } } }
    await assert.rejects(
      tools
        .get('computer_list_windows')
        .execute({}, { agent, signal: new AbortController().signal, name: 'computer_list_windows' }),
      /暂停/
    )
    const log = (await request('GET')).json.session.log
    assert.equal(log[0].outcome, 'denied')
    await request('POST', { action: 'resume' })
    assert.equal((await request('GET')).json.session.paused, false)
  }
)

test(
  'the confirmation tool proceeds only on an explicit one-time grant',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { tools, request } = hostFixture(t)
    await request('POST', { action: 'settings', revision: 0, desktop: true })
    const confirm = tools.get('computer_confirm')
    const agent = { session: { id: 's1', header: { id: 's1' } } }
    const run = { agent, signal: new AbortController().signal, name: 'computer_confirm', callId: 'c1' }
    // No approval service is mounted in this host: the request fails closed.
    await assert.rejects(confirm.execute({ action: '发送邮件', category: 'send' }, run), /无法显示确认/)
    const log = (await request('GET')).json.session.log
    assert.equal(log[0].outcome, 'rejected')
  }
)

test('browser output cleanup never throws and sweeps only folders of exited hosts', (t) => {
  const parent = temp(t, 'px-computer-sweep-')
  for (const name of ['111', '222', 'notes']) mkdirSync(join(parent, name, 'inner'), { recursive: true })
  sweepOutput(parent, (pid) => pid === 222)
  assert.deepEqual(readdirSync(parent).sort(), ['222', 'notes'])
  assert.doesNotThrow(() => removeQuietly(join(parent, 'missing', 'deeper')))
  assert.doesNotThrow(() => sweepOutput(join(parent, 'absent'), () => false))
})
