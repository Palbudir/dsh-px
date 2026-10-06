/**
 * Hard limits for computer use. These checks run in code before any driver call and cannot be
 * lifted by a confirmation: they cover surfaces where one action can run commands, approve the
 * agent's own requests, expose credentials or hand the machine to someone else.
 */
import { posix, win32 } from 'node:path'

/** Executables whose windows are never read or operated. Keys are lower-case file names. */
const DENIED_PROCESSES: Record<string, string> = {}
const deny = (reason: string, names: string[]): void => {
  for (const name of names) DENIED_PROCESSES[name] = reason
}
deny('终端与命令解释器', [
  'cmd.exe',
  'powershell.exe',
  'powershell_ise.exe',
  'pwsh.exe',
  'windowsterminal.exe',
  'wt.exe',
  'openconsole.exe',
  'conhost.exe',
  'wsl.exe',
  'wslhost.exe',
  'bash.exe',
  'mintty.exe',
  'alacritty.exe',
  'wezterm-gui.exe',
  'tabby.exe',
  'hyper.exe',
  'conemu.exe',
  'conemu64.exe',
  'cmder.exe',
  'putty.exe',
  'mobaxterm.exe',
  'xshell.exe',
  'termius.exe'
])
deny('系统管理与脚本宿主', [
  'regedit.exe',
  'regedt32.exe',
  'mmc.exe',
  'msconfig.exe',
  'taskmgr.exe',
  'useraccountcontrolsettings.exe',
  'systempropertiesadvanced.exe',
  'systempropertiesprotection.exe',
  'rundll32.exe',
  'mshta.exe',
  'wscript.exe',
  'cscript.exe',
  'msiexec.exe',
  'reg.exe',
  'sc.exe',
  'schtasks.exe',
  'certutil.exe',
  'bitsadmin.exe',
  'netsh.exe',
  'diskpart.exe',
  'bcdedit.exe',
  'msra.exe',
  'quickassist.exe'
])
deny('身份验证与安全软件', [
  'consent.exe',
  'credentialuibroker.exe',
  'logonui.exe',
  'lockapp.exe',
  'sechealthui.exe',
  'securityhealthsystray.exe',
  'smartscreen.exe',
  'msmpeng.exe',
  '360tray.exe',
  '360safe.exe',
  '360sd.exe',
  'qqpcmgr.exe',
  'qqpctray.exe',
  'hipstray.exe',
  'hipsmain.exe',
  'kxetray.exe',
  'avp.exe',
  'avastui.exe',
  'avgui.exe',
  'mbam.exe',
  'mcuicnt.exe'
])
deny('密码管理器', [
  '1password.exe',
  'bitwarden.exe',
  'keepass.exe',
  'keepassxc.exe',
  'lastpass.exe',
  'dashlane.exe',
  'enpass.exe',
  'nordpass.exe',
  'roboform.exe',
  'keeperpasswordmanager.exe',
  'proton pass.exe'
])
deny('远程控制软件', [
  'todesk.exe',
  'teamviewer.exe',
  'anydesk.exe',
  'sunloginclient.exe',
  'awesun.exe',
  'rustdesk.exe',
  'parsec.exe',
  'mstsc.exe',
  'msrdc.exe'
])
deny('DSH 与其他 agent 应用', [
  'dsh-px desktop.exe',
  'deepseek harness.exe',
  'dsh.exe',
  'chatgpt.exe',
  'codex.exe',
  'claude.exe'
])
// Start and search accept a typed program name and run it, which is a command line by another name.
deny('开始菜单与系统搜索', [
  'startmenuexperiencehost.exe',
  'searchhost.exe',
  'searchapp.exe',
  'searchui.exe',
  'shellexperiencehost.exe'
])

/** Window titles that identify denied surfaces hosted by shared processes (UWP frames, Explorer). */
const DENIED_TITLES: Array<[RegExp, string]> = [
  [/^(windows\s*安全中心|windows\s*安全性|windows security|windows defender)/i, '身份验证与安全软件'],
  [/^(用户帐户控制|用户账户控制|user account control)$/i, '身份验证与安全软件'],
  [/^(运行|執行|run|ausführen|exécuter|ejecutar|esegui|executar|実行|실행|выполнить)$/i, '运行对话框']
]

/** Explorer windows that are the shell itself (taskbar, desktop) rather than a folder view. */
const SHELL_TITLES = /^(program manager|任务栏|工作列|taskbar)?$/i

/** Names accepted by `launch_app` that resolve to denied programs without a path. */
const DENIED_LAUNCH_NAMES: Record<string, string> = {
  cmd: '终端与命令解释器',
  powershell: '终端与命令解释器',
  pwsh: '终端与命令解释器',
  terminal: '终端与命令解释器',
  'windows terminal': '终端与命令解释器',
  wt: '终端与命令解释器',
  命令提示符: '终端与命令解释器',
  终端: '终端与命令解释器',
  regedit: '系统管理与脚本宿主',
  注册表编辑器: '系统管理与脚本宿主',
  'task manager': '系统管理与脚本宿主',
  任务管理器: '系统管理与脚本宿主',
  'windows security': '身份验证与安全软件',
  windows安全中心: '身份验证与安全软件',
  'windows 安全中心': '身份验证与安全软件'
}

/** Files that run as scripts or change system state when opened. */
const SCRIPT_EXTENSIONS = new Set([
  '.bat',
  '.cmd',
  '.ps1',
  '.psm1',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.hta',
  '.msc',
  '.reg',
  '.scr',
  '.lnk',
  '.url',
  '.cpl',
  '.inf'
])
const INSTALLER_EXTENSIONS = new Set(['.msi', '.msix', '.msixbundle', '.appx', '.appxbundle'])

/** The shared UWP frame host owns windows of many unrelated packaged apps. */
export const FRAME_HOST = 'applicationframehost.exe'

export interface WindowIdentity {
  /** Owning process file name as reported by the driver, for example `notepad.exe`. */
  appName: string
  /** Window title, needed to tell UWP apps apart inside the shared frame host. */
  title?: string
}

const fileName = (value: string): string => win32.basename(value.trim().replace(/^"|"$/g, '')).toLowerCase()

/**
 * A stable grant key: the executable name, or the frame host plus the window title for UWP apps,
 * so allowing Calculator never allows Settings.
 */
export function appKey(window: WindowIdentity): string {
  const name = fileName(window.appName)
  return name === FRAME_HOST ? `${name}|${(window.title ?? '').trim().toLowerCase()}` : name
}

/** User-facing app name for confirmations and the activity log. */
export function appLabel(window: WindowIdentity): string {
  const name = fileName(window.appName)
  if (name === FRAME_HOST) return window.title?.trim() || '应用框架窗口'
  return window.title?.trim() ? `${window.title.trim()}（${window.appName}）` : window.appName
}

/** Why a window must not be read or operated, or undefined when it is not on the hard deny list. */
export function deniedWindow(window: WindowIdentity): string | undefined {
  const name = fileName(window.appName)
  const byProcess = DENIED_PROCESSES[name]
  if (byProcess) return byProcess
  const title = window.title?.trim() ?? ''
  if (name === 'explorer.exe' && SHELL_TITLES.test(title)) return '任务栏与桌面'
  for (const [pattern, reason] of DENIED_TITLES) if (pattern.test(title)) return reason
  return undefined
}

const WINDOWS_KEYS = new Set([
  'win',
  'windows',
  'meta',
  'super',
  'cmd',
  'command',
  'os',
  'lwin',
  'rwin',
  'start',
  'windows_l',
  'windows_r',
  'super_l',
  'super_r',
  'meta_l',
  'meta_r'
])

/** Reject chords that reach the shell (Windows key) or the secure attention sequence. */
export function deniedKeys(keys: readonly string[]): string | undefined {
  const normal = keys.flatMap((key) =>
    String(key)
      .split('+')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  )
  if (normal.some((key) => WINDOWS_KEYS.has(key))) return '不允许使用 Windows 键或包含它的组合键'
  const has = (...names: string[]): boolean => names.some((name) => normal.includes(name))
  if (
    has('ctrl', 'control', 'control_l', 'control_r') &&
    has('alt', 'alt_l', 'alt_r') &&
    has('delete', 'del')
  )
    return '不允许发送 Ctrl+Alt+Delete'
  return undefined
}

export interface LaunchRequest {
  name?: string
  aumid?: string
  bundle_id?: string
  launch_path?: string
  path?: string
}
export type LaunchDecision =
  { kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'confirm'; reason: string }

/** The program part of a shortcut command line such as `"C:\Apps\x.exe" --flag`. */
export function commandProgram(commandLine: string): string {
  const text = commandLine.trim()
  if (text.startsWith('"')) return text.slice(1, text.indexOf('"', 1) > 0 ? text.indexOf('"', 1) : undefined)
  const exe = text.search(/\.exe(\s|$)/i)
  return exe >= 0 ? text.slice(0, exe + 4) : (text.split(/\s+/)[0] ?? '')
}

export interface LaunchFolders {
  /** Programs here count as newly acquired software, which Codex requires to be confirmed. */
  downloads: readonly string[]
  /** System and standard install locations; other absolute paths are confirmed with their path. */
  trusted: readonly string[]
}

const inside = (target: string, folders: readonly string[]): boolean =>
  folders.some((folder) => {
    const root = win32.resolve(folder).toLowerCase()
    return target.startsWith(root.endsWith('\\') ? root : root + '\\')
  })

/** Check one `launch_app` target. */
export function launchDecision(request: LaunchRequest, folders: LaunchFolders): LaunchDecision {
  const named = (request.name ?? '').trim().toLowerCase()
  if (named && DENIED_LAUNCH_NAMES[named]) return { kind: 'deny', reason: DENIED_LAUNCH_NAMES[named] }
  const candidates = [request.path, request.launch_path && commandProgram(request.launch_path), request.name]
  for (const value of candidates) {
    if (!value) continue
    const lower = value.toLowerCase()
    if (lower.startsWith('shell:appsfolder\\') || lower.startsWith('shell:appsfolder/')) continue
    const file = fileName(value)
    const withExe = file.endsWith('.exe') ? file : `${file}.exe`
    const reason = DENIED_PROCESSES[file] ?? DENIED_PROCESSES[withExe]
    if (reason) return { kind: 'deny', reason }
    const extension = win32.extname(file)
    if (SCRIPT_EXTENSIONS.has(extension))
      return { kind: 'deny', reason: '不能直接打开脚本、快捷方式或系统配置文件' }
    if (INSTALLER_EXTENSIONS.has(extension)) return { kind: 'confirm', reason: '安装软件' }
  }
  const program = request.path ?? (request.launch_path ? commandProgram(request.launch_path) : '')
  if (program && win32.isAbsolute(program)) {
    const target = win32.resolve(program).toLowerCase()
    if (inside(target, folders.downloads)) return { kind: 'confirm', reason: '运行新下载的程序' }
    // A copied or renamed binary outside install locations is not recognizable by its name.
    if (!inside(target, folders.trusted)) return { kind: 'confirm', reason: '运行不在常用程序目录中的程序' }
  }
  return { kind: 'allow' }
}

/** Download and trusted install folders for this machine. */
export function launchFolders(env: NodeJS.ProcessEnv): LaunchFolders {
  const unique = (values: Array<string | undefined | false>): string[] => [
    ...new Set(values.filter((value): value is string => !!value))
  ]
  const home = env.USERPROFILE,
    local = env.LOCALAPPDATA
  return {
    downloads: unique([
      home && win32.join(home, 'Downloads'),
      home && win32.join(home, 'Desktop'),
      env.TEMP,
      env.TMP
    ]),
    trusted: unique([
      env.SystemRoot ?? env.windir,
      env.ProgramFiles,
      env['ProgramFiles(x86)'],
      env.ProgramW6432,
      local && win32.join(local, 'Programs'),
      local && win32.join(local, 'Microsoft', 'WindowsApps')
    ])
  }
}

/** Sites whose pages hold saved credentials; navigation there is refused in every browser mode. */
const DENIED_HOSTS = [
  'passwords.google.com',
  'vault.bitwarden.com',
  'vault.bitwarden.eu',
  '1password.com',
  '1password.eu',
  '1password.ca',
  'lastpass.com',
  'app.dashlane.com',
  'keepersecurity.com',
  'keepersecurity.eu',
  'app.nordpass.com',
  'pass.proton.me'
]

/** The same hosts as Playwright `--blocked-origins` entries, a second fence for link clicks. */
export const BLOCKED_ORIGINS = DENIED_HOSTS.flatMap((host) =>
  host === '1password.com' || host === '1password.eu' || host === '1password.ca'
    ? [`https://my.${host}`, `https://start.${host}`]
    : [`https://${host}`]
)

/** Check a URL the agent asks the browser to open. */
export function deniedUrl(raw: string): string | undefined {
  if (raw.trim() === 'about:blank') return undefined
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return '网址无效'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '只能打开 http 或 https 网址'
  if (url.username || url.password) return '网址中不能包含账号或密码'
  const host = url.hostname.toLowerCase()
  if (DENIED_HOSTS.some((denied) => host === denied || host.endsWith('.' + denied)))
    return '不能操作密码管理器网站'
  return undefined
}

/** Paths on uploads must stay absolute local files; the browser enforces workspace roots itself. */
export function uploadNames(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  return paths
    .filter((p): p is string => typeof p === 'string')
    .map((p) => (p.includes('\\') ? win32 : posix).basename(p))
}
