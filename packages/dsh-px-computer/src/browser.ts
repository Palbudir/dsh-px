/**
 * Browser tools from the pinned Playwright MCP server. Each DSH session gets its own server process,
 * started on the first browser call and closed when the session ends or stays idle. The two modes
 * that carry login state (a PX-owned profile and the user's Edge through the Playwright extension)
 * serve one session at a time and ask before the agent works on each new site.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { McpStdioClient, type McpCallResult, type McpLaunch } from './mcp-stdio'
import { BLOCKED_ORIGINS, deniedUrl, uploadNames } from './policy'
import { ComputerUseRefusal, UNTRUSTED, type Image } from './runtime'
import catalog from './playwright-tools.json'

export type BrowserMode = 'isolated' | 'profile' | 'extension'
export const BROWSER_MODES: readonly BrowserMode[] = ['isolated', 'profile', 'extension']

export interface BrowserLaunchOptions {
  mode: BrowserMode
  headless: boolean
  /** Absolute path of `@playwright/mcp/cli.js`. */
  cli: string
  /** Executable that runs the server: the host's own Node or Electron-as-Node binary. */
  node: string
  /** Whether `node` is Electron and needs `ELECTRON_RUN_AS_NODE`. */
  electron: boolean
  /** PX-owned persistent profile for the `profile` mode. */
  profileDir: string
}

/** Server arguments; output files stay in a PX-owned directory, never in the user's project. */
export function browserArgs(options: BrowserLaunchOptions, outputDir: string): string[] {
  const args = [
    options.cli,
    '--browser',
    'msedge',
    '--codegen',
    'none',
    '--output-dir',
    outputDir,
    '--blocked-origins',
    BLOCKED_ORIGINS.join(';')
  ]
  if (options.mode === 'extension') args.push('--extension')
  else {
    if (options.mode === 'isolated') args.push('--isolated')
    else args.push('--user-data-dir', options.profileDir)
    if (options.headless) args.push('--headless')
  }
  return args
}

const ENV_KEEP = new Set(
  [
    'SystemRoot',
    'windir',
    'Path',
    'PATHEXT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'HOME',
    'LOCALAPPDATA',
    'APPDATA',
    'ProgramData',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramW6432',
    'CommonProgramFiles',
    'CommonProgramFiles(x86)',
    'CommonProgramW6432',
    'COMPUTERNAME',
    'USERNAME',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'OS',
    'LANG',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'ALL_PROXY'
  ].map((key) => key.toLowerCase())
)

/** A scrubbed child environment: no credentials, no PLAYWRIGHT_* overrides of the chosen mode. */
export function childEnv(env: NodeJS.ProcessEnv, electron: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env))
    if (value !== undefined && ENV_KEEP.has(key.toLowerCase())) out[key] = value
  if (electron) out.ELECTRON_RUN_AS_NODE = '1'
  return out
}

export interface BrowserToolSpec {
  name: string
  description: string
  parameters: Record<string, any>
  readOnly: boolean
}

/** Arguments that write files at a caller-chosen path are removed from the model's view. */
const STRIPPED = new Set(['filename'])
const READS = new Set([
  'browser_snapshot',
  'browser_find',
  'browser_take_screenshot',
  'browser_console_messages',
  'browser_wait_for',
  'browser_navigate_back',
  'browser_close'
])

export const BROWSER_TOOLS: readonly BrowserToolSpec[] = (catalog.tools as any[]).map((tool) => {
  const schema = structuredClone(tool.inputSchema)
  for (const key of STRIPPED) delete schema.properties?.[key]
  if (Array.isArray(schema.required))
    schema.required = schema.required.filter((key: string) => !STRIPPED.has(key))
  const note =
    tool.name === 'browser_take_screenshot'
      ? ' 仅支持图片的模型可用；操作网页请用 browser_snapshot 返回的 ref。'
      : tool.name === 'browser_file_upload'
        ? ' 每次上传前都会请用户确认；只能上传当前项目目录内的文件。'
        : ''
  return {
    name: tool.name,
    description: tool.description + note,
    parameters: schema,
    readOnly: READS.has(tool.name) || !!tool.readOnly
  }
})

/** The site a grant covers: the host without a leading `www.`. */
export function siteOf(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return parsed.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return undefined
  }
}

/** Remove links to the server's local output files and mark page content as untrusted data. */
export function shapeBrowserText(text: string): string {
  const shaped = text
    .replace(/^- \[Snapshot\]\([^)]*\)\s*$/gm, '- 页面结构已变化；需要时调用 browser_snapshot 获取最新结构')
    .replace(/^- \[Screenshot of [^\]]*\]\([^)]*\)\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return /### (Page|Snapshot|Result)|\[ref=/.test(shaped) ? `${UNTRUSTED}\n${shaped}` : shaped
}

export function pageUrlOf(text: string): string | undefined {
  return text.match(/Page URL:\s*(\S+)/)?.[1]
}

/** The current tab's URL from a `browser_tabs` list result: `- 0: (current) [Title](url)`. */
export function currentTabUrl(text: string): string | undefined {
  return text.match(/^- \d+: \(current\) \[.*\]\((\S+)\)\s*$/m)?.[1]
}

/**
 * Hide what tabs on ungranted sites show: the title and everything in the URL past the origin. The
 * origin stays so the agent can name the site when it asks for access.
 */
export function redactTabTitles(text: string, granted: (site: string) => boolean): string {
  return text.replace(
    /^(- \d+: (?:\(current\) )?)\[.*\]\((\S+)\)\s*$/gm,
    (line, head: string, url: string) => {
      const site = siteOf(url)
      return site && !granted(site) ? `${head}[（未获准的网站）](${new URL(url).origin}/…)` : line
    }
  )
}

/**
 * Tools that never move the page. Every other tool whose result lacks a page URL (typing, key presses,
 * dialogs, tab switches) may have navigated, so the page becomes unknown until it is probed.
 */
export function keepsPage(name: string, args: Record<string, unknown>): boolean {
  return (
    ['browser_find', 'browser_console_messages', 'browser_take_screenshot', 'browser_snapshot'].includes(
      name
    ) ||
    (name === 'browser_tabs' && args.action === 'list')
  )
}

interface Session {
  client: BrowserClient
  ready: Promise<void>
  outputDir: string
  mode: BrowserMode
  startedAt: number
  generation: string
  calls: number
  phase: 'opening' | 'ready' | 'closing' | 'close-failed'
  closing?: Promise<void>
  closeError?: string
  idle?: ReturnType<typeof setTimeout>
  url?: string
  /** The last action may have navigated without reporting where. */
  unknown?: boolean
}

const IDLE_MS = 20 * 60_000
export type BrowserClient = Pick<McpStdioClient, 'alive' | 'start' | 'callTool' | 'close'>

export class BrowserSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly changes = new Set<() => void>()

  constructor(
    /** Current launch options; `undefined` while browser use is turned off, so nothing can start one. */
    private readonly options: () => BrowserLaunchOptions | undefined,
    private readonly outputRoot: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly createClient: (launch: McpLaunch) => BrowserClient = (launch) =>
      new McpStdioClient(launch)
  ) {}

  /** The session holding the single shared browser in the login-carrying modes. */
  holder(): string | undefined {
    return [...this.sessions].find(([, session]) => session.mode !== 'isolated')?.[0]
  }

  ownership() {
    return [...this.sessions].map(([sessionId, session]) => ({
      sessionId,
      generation: session.generation,
      mode: session.mode,
      phase: session.phase,
      startedAt: session.startedAt,
      activeCalls: session.calls,
      ...(session.closeError ? { error: session.closeError } : {})
    }))
  }

  availability(sessionId: string) {
    const options = this.options(),
      own = this.sessions.get(sessionId),
      holder = this.holder()
    return {
      mode: options?.mode ?? 'off',
      available:
        !!options &&
        (own
          ? own.mode === options.mode && ['opening', 'ready'].includes(own.phase)
          : options.mode === 'isolated' || !holder),
      ownPhase: own?.phase,
      heldElsewhere: !!holder && holder !== sessionId
    }
  }

  /** Notification only: observing availability never reserves or grants access to a browser. */
  waitAvailable(
    sessionId: string,
    signal: AbortSignal,
    timeoutMs: number
  ): Promise<ReturnType<BrowserSessions['availability']>> {
    signal.throwIfAborted()
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000)
      throw Error('浏览器等待时限无效')
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.changes.delete(check)
        signal.removeEventListener('abort', abort)
        if (error) reject(error)
        else {
          try {
            resolve(this.availability(sessionId))
          } catch (error) {
            reject(error)
          }
        }
      }
      const abort = () => finish(signal.reason ?? Error('等待已取消'))
      const check = () => {
        try {
          const state = this.availability(sessionId)
          if (state.mode === 'off') finish(Error('浏览器能力已关闭'))
          else if (state.available) finish()
        } catch (error) {
          finish(error)
        }
      }
      const timer = setTimeout(() => finish(), timeoutMs)
      this.changes.add(check)
      signal.addEventListener('abort', abort, { once: true })
      check()
    })
  }
  private changed() {
    for (const notify of [...this.changes]) notify()
  }

  currentUrl(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.url
  }

  /** Whether the current page must be probed before the next site check. */
  pageUnknown(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.unknown === true
  }

  setUrl(sessionId: string, url: string | undefined): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.url = url
    session.unknown = false
  }

  private open(sessionId: string, cwd: string | undefined, label: string, signal: AbortSignal): Session {
    signal.throwIfAborted()
    const options = this.options()
    if (!options) throw new ComputerUseRefusal('浏览器操作已关闭')
    const existing = this.sessions.get(sessionId)
    if (existing) {
      if (['closing', 'close-failed'].includes(existing.phase))
        throw new ComputerUseRefusal(
          existing.closeError ?? '本会话的浏览器正在释放，请等待释放完成后重新观察'
        )
      if ((existing.phase === 'opening' || existing.client.alive) && existing.mode === options.mode)
        return existing
      void this.closeOwned(sessionId, existing).catch(() => undefined)
      throw new ComputerUseRefusal('原浏览器连接已失效或模式已改变，正在释放；请稍后重新观察，不重放旧动作')
    }
    const holder = this.holder()
    if (options.mode !== 'isolated' && holder && holder !== sessionId)
      throw new ComputerUseRefusal(
        options.mode === 'extension'
          ? 'Edge 正在被另一个会话接管。可用 computer_browser_resource 创建后台等待并继续其他工作；用户也可在「电脑操作」面板核对并释放具体连接。'
          : 'PX 专用浏览器正在被另一个会话使用。可用 computer_browser_resource 创建后台等待并继续其他工作；用户也可在「电脑操作」面板核对并释放具体连接。'
      )
    const outputDir = join(this.outputRoot, label)
    mkdirSync(outputDir, { recursive: true })
    const client = this.createClient({
      command: options.node,
      args: browserArgs(options, outputDir),
      // Browser processes inherit this directory; keeping it outside the per-session folder lets that
      // folder be removed while a browser is still exiting.
      cwd: this.outputRoot,
      env: childEnv(this.env, options.electron),
      roots: cwd ? [cwd] : []
    })
    const session: Session = {
      client,
      outputDir,
      mode: options.mode,
      generation: randomUUID(),
      startedAt: Date.now(),
      calls: 0,
      phase: 'opening',
      ready: Promise.resolve()
    }
    this.sessions.set(sessionId, session)
    this.changed()
    session.ready = Promise.resolve()
      .then(() => client.start(signal))
      .then(() => {
        if (session.phase === 'opening') session.phase = 'ready'
        this.changed()
      })
    void session.ready.catch(() => this.closeOwned(sessionId, session)).catch(() => undefined)
    return session
  }

  async call(
    sessionId: string,
    cwd: string | undefined,
    label: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<McpCallResult> {
    const session = this.open(sessionId, cwd, label, signal)
    clearTimeout(session.idle)
    session.calls++
    try {
      await session.ready
      signal.throwIfAborted()
      if (session.phase !== 'ready' || this.sessions.get(sessionId) !== session)
        throw new ComputerUseRefusal('浏览器的原连接已结束，动作未发送')
      const result = await session.client.callTool(name, args, signal)
      signal.throwIfAborted()
      const url = pageUrlOf(
        (result.content ?? [])
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n')
      )
      if (url) {
        session.url = url
        session.unknown = false
      } else if (!keepsPage(name, args)) session.unknown = true
      if (name === 'browser_close') {
        session.url = undefined
        session.unknown = false
      }
      return result
    } catch (error) {
      if (
        signal.aborted ||
        !session.client.alive ||
        (error as any)?.code === 'mcp_timeout' ||
        session.phase !== 'ready'
      )
        await this.closeOwned(sessionId, session)
      throw error
    } finally {
      session.calls--
      if (this.sessions.get(sessionId) === session && session.phase === 'ready' && session.calls === 0)
        session.idle = setTimeout(
          () => void this.closeOwned(sessionId, session).catch(() => undefined),
          IDLE_MS
        )
    }
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    return this.closeOwned(sessionId, session)
  }

  async release(sessionId: string, generation: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.generation !== generation)
      throw new ComputerUseRefusal('浏览器占用已变化，请刷新后核对；没有停止新的占用者')
    await this.closeOwned(sessionId, session)
  }

  private closeOwned(sessionId: string, session: Session): Promise<void> {
    if (this.sessions.get(sessionId) !== session) return Promise.resolve()
    if (session.closing) return session.closing
    session.phase = 'closing'
    this.changed()
    clearTimeout(session.idle)
    const closing = Promise.resolve()
      .then(() => session.client.close())
      .then(() => {
        if (this.sessions.get(sessionId) !== session) return
        removeQuietly(session.outputDir)
        this.sessions.delete(sessionId)
        this.changed()
      })
      .catch((error) => {
        session.phase = 'close-failed'
        session.closeError = error instanceof Error ? error.message : '浏览器释放未完成'
        this.changed()
        throw error
      })
      .finally(() => {
        if (session.closing === closing) session.closing = undefined
      })
    session.closing = closing
    return closing
  }

  async closeAll(): Promise<void> {
    const results = await Promise.allSettled([...this.sessions.keys()].map((id) => this.close(id)))
    const failures = results.filter((row): row is PromiseRejectedResult => row.status === 'rejected')
    if (failures.length)
      throw new AggregateError(
        failures.map((row) => row.reason),
        '部分浏览器连接未确认释放'
      )
  }

  get active(): string[] {
    return [...this.sessions.keys()]
  }
}

/** Temporary browser output is disposable; a file still held by an exiting browser is left for the sweep. */
export function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch {
    // Swept on a later start once no process holds it.
  }
}

/** Remove output folders of host processes that have exited. */
export function sweepOutput(parent: string, alive: (pid: number) => boolean): void {
  let entries: string[]
  try {
    entries = readdirSync(parent)
  } catch {
    return
  }
  for (const entry of entries)
    if (/^\d+$/.test(entry) && !alive(Number(entry))) removeQuietly(join(parent, entry))
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    return error?.code === 'EPERM'
  }
}

/** Policy checks that depend only on the arguments. */
export function checkBrowserArgs(name: string, args: Record<string, unknown>): void {
  for (const key of STRIPPED) if (args[key] !== undefined) throw new ComputerUseRefusal(`不支持参数 ${key}`)
  if (name === 'browser_navigate') {
    const reason = deniedUrl(String(args.url ?? ''))
    if (reason) throw new ComputerUseRefusal(`不能打开该网址：${reason}。`)
  }
  if (name === 'browser_tabs' && args.action === 'new' && typeof args.url === 'string' && args.url) {
    const reason = deniedUrl(args.url)
    if (reason) throw new ComputerUseRefusal(`不能打开该网址：${reason}。`)
  }
}

/** The site an action or navigation will touch, for per-site grants in login-carrying modes. */
export function targetSite(
  name: string,
  args: Record<string, unknown>,
  current: string | undefined
): string | undefined {
  if (name === 'browser_navigate') return siteOf(String(args.url ?? ''))
  if (name === 'browser_tabs')
    return args.action === 'new' && typeof args.url === 'string' ? siteOf(args.url) : undefined
  return current ? siteOf(current) : undefined
}

export function uploadSummary(args: Record<string, unknown>): string[] {
  return uploadNames(args.paths)
}

export function browserImages(result: McpCallResult): Image[] {
  return (result.content ?? [])
    .filter((c) => c.type === 'image' && typeof c.data === 'string' && c.mimeType)
    .map((c) => ({ data: c.data!, mimeType: c.mimeType! }))
}

export function browserText(result: McpCallResult): string {
  return shapeBrowserText(
    (result.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
  )
}
