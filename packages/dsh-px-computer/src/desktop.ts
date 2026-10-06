/**
 * Windows desktop tools backed by an in-process Cua Driver. PX exposes a reviewed subset with short
 * descriptions; every call names an exact pid + window, resolves that window's owner, applies the
 * hard deny list and the per-session app grant, then reaches the driver through one serial queue.
 */
import { createHash } from 'node:crypto'
import {
  appLabel,
  deniedKeys,
  deniedWindow,
  downloadFolders,
  FRAME_HOST,
  launchDecision,
  type LaunchRequest,
  type WindowIdentity
} from './policy'
import { ComputerUseRefusal, UNTRUSTED, type Image } from './runtime'

/** The subset of `@trycua/cua-driver` this module uses. */
export interface DriverLike {
  callTool(
    name: string,
    argumentsJson: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ rawJson: string }>
  shutdown(): Promise<void>
}
export type LoadDriver = () => Promise<DriverLike>

/** One MCP-shaped driver result. */
export interface DriverResult {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  structuredContent?: any
  isError?: boolean
}

/** Serializes every driver call; desktop input from two sessions must not interleave. */
export class DesktopDriver {
  private driver: Promise<DriverLike> | undefined
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly load: LoadDriver) {}

  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<DriverResult> {
    const run = this.tail.then(async () => {
      signal.throwIfAborted()
      this.driver ??= this.load().catch((error) => {
        this.driver = undefined
        throw new Error(`无法加载 Cua Driver：${error instanceof Error ? error.message : String(error)}`)
      })
      const driver = await this.driver
      const raw = await driver.callTool(name, JSON.stringify(args), { signal })
      return JSON.parse(raw.rawJson) as DriverResult
    })
    this.tail = run.catch(() => undefined)
    return run
  }

  get loaded(): boolean {
    return this.driver !== undefined
  }

  async close(): Promise<void> {
    const pending = this.driver
    this.driver = undefined
    await this.tail.catch(() => undefined)
    if (pending) await (await pending.catch(() => undefined))?.shutdown().catch(() => undefined)
  }
}

export function textOf(result: DriverResult): string {
  return (result.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}
export function imagesOf(result: DriverResult): Image[] {
  return (result.content ?? [])
    .filter((block) => block.type === 'image' && typeof block.data === 'string' && block.mimeType)
    .map((block) => ({ data: block.data!, mimeType: block.mimeType! }))
}

/** Driver session label derived from the DSH session id. */
export function driverSession(sessionId: string): string {
  return 'px-' + createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
}

const int = (description: string) => ({ type: 'integer', description })
const num = (description: string) => ({ type: 'number', description })
const PID = int('进程 id（来自 computer_list_windows）')
const WINDOW = int('窗口 id（来自 computer_list_windows）')
const ELEMENT = int('最近一次 computer_get_window_state 中的元素编号 [N]')
const DELIVERY = {
  type: 'string',
  enum: ['background', 'foreground'],
  description: '默认 background（不抢焦点）。只有工具返回 background_unavailable 时才改用 foreground 重试'
}

export type DesktopKind = 'discover' | 'read' | 'act' | 'launch'
export interface DesktopTool {
  name: string
  driver: string
  kind: DesktopKind
  description: string
  parameters: Record<string, unknown>
  /** Needs an image-capable model. */
  vision?: boolean
  /** Driver argument names that accept the PX session label. */
  session?: boolean
  /** Arguments copied to the driver; PX-only arguments are handled separately. */
  pass: readonly string[]
  /** Activity-log argument summary. */
  log: readonly string[]
}

const window = (extra: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  required: ['pid', 'window_id', ...required],
  properties: { pid: PID, window_id: WINDOW, ...extra }
})

export const DESKTOP_TOOLS: readonly DesktopTool[] = [
  {
    name: 'computer_list_apps',
    driver: 'list_apps',
    kind: 'discover',
    description:
      '列出本机应用。默认只列出正在运行的应用；提供 query 时按名称搜索已安装应用。返回的 launch_path 可直接交给 computer_launch_app。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string', description: '按应用名称搜索（不区分大小写）' } }
    },
    pass: [],
    log: ['query']
  },
  {
    name: 'computer_list_windows',
    driver: 'list_windows',
    kind: 'discover',
    description: '列出可操作的顶层窗口及其 pid 和 window_id。受保护的应用不会出现在结果中。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        pid: int('只列出这个进程的窗口'),
        on_screen_only: { type: 'boolean', description: '只列出当前在屏幕上的窗口' }
      }
    },
    pass: ['pid', 'on_screen_only'],
    log: ['pid']
  },
  {
    name: 'computer_get_window_state',
    driver: 'get_window_state',
    kind: 'read',
    session: true,
    description:
      '观察一个窗口：返回带编号 [N] 的界面元素树；当前模型支持图片时附带截图。每次动作前后都要重新观察，编号只对最近一次观察有效。界面复杂时用 query 过滤。最小化的窗口无法截图。',
    parameters: window({
      query: { type: 'string', description: '只返回标签或值包含该文字的元素（及其上级）' },
      max_elements: { type: 'integer', minimum: 20, maximum: 600, description: '最多返回的元素数，默认 200' },
      include_screenshot: { type: 'boolean', description: '是否附截图，默认在支持图片的模型上附带' }
    }),
    pass: ['pid', 'window_id', 'query', 'max_elements', 'include_screenshot'],
    log: ['query']
  },
  {
    name: 'computer_zoom',
    driver: 'zoom',
    kind: 'read',
    vision: true,
    description:
      '放大最近一次窗口截图中的矩形区域（宽不超过 500 像素）以看清小字或图标。仅支持图片的模型可用。',
    parameters: window({ x1: num('左'), y1: num('上'), x2: num('右'), y2: num('下') }, [
      'x1',
      'y1',
      'x2',
      'y2'
    ]),
    pass: ['pid', 'window_id', 'x1', 'y1', 'x2', 'y2'],
    log: []
  },
  {
    name: 'computer_click',
    driver: 'click',
    kind: 'act',
    session: true,
    description:
      '点击窗口中的元素。优先用 element_index；只有元素树里没有目标（画布、视频、自绘界面）时才用截图像素坐标 x、y。',
    parameters: window({
      element_index: ELEMENT,
      x: num('截图中的 X 像素（左上角为原点）'),
      y: num('截图中的 Y 像素'),
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: '默认 left' },
      count: { type: 'integer', minimum: 1, maximum: 3, description: '点击次数，默认 1' },
      delivery_mode: DELIVERY
    }),
    pass: ['pid', 'window_id', 'element_index', 'x', 'y', 'button', 'count', 'delivery_mode'],
    log: ['element_index', 'x', 'y', 'button', 'count']
  },
  {
    name: 'computer_type_text',
    driver: 'type_text',
    kind: 'act',
    session: true,
    description:
      '向窗口当前焦点输入文字（不含 Enter、Tab 等按键，按键请用 computer_press_key）。输入前先观察确认焦点；新式 Windows 应用需要提供 element_index。',
    parameters: window(
      {
        text: { type: 'string', description: '要输入的文字' },
        element_index: ELEMENT,
        delivery_mode: DELIVERY
      },
      ['text']
    ),
    pass: ['pid', 'window_id', 'text', 'element_index', 'delivery_mode'],
    log: ['text', 'element_index']
  },
  {
    name: 'computer_press_key',
    driver: 'press_key',
    kind: 'act',
    session: true,
    description:
      '按一个键，可带修饰键。键名：return、tab、escape、up、down、left、right、space、delete、home、end、pageup、pagedown、f1–f12、字母或数字。不允许 Windows 键。',
    parameters: window(
      {
        key: { type: 'string', description: '键名' },
        modifiers: { type: 'array', items: { type: 'string' }, description: 'ctrl、shift、alt' },
        element_index: ELEMENT,
        delivery_mode: DELIVERY
      },
      ['key']
    ),
    pass: ['pid', 'window_id', 'key', 'modifiers', 'element_index', 'delivery_mode'],
    log: ['key', 'modifiers']
  },
  {
    name: 'computer_hotkey',
    driver: 'hotkey',
    kind: 'act',
    session: true,
    description: '按组合键，例如 ["ctrl","s"]。不允许 Windows 键。',
    parameters: window(
      {
        keys: { type: 'array', items: { type: 'string' }, minItems: 2, description: '修饰键加一个普通键' },
        delivery_mode: DELIVERY
      },
      ['keys']
    ),
    pass: ['pid', 'window_id', 'keys', 'delivery_mode'],
    log: ['keys']
  },
  {
    name: 'computer_set_value',
    driver: 'set_value',
    kind: 'act',
    session: true,
    description: '直接设置可编辑元素（文本框、滑块等）的值，替换原有内容。',
    parameters: window({ element_index: ELEMENT, value: { type: 'string', description: '新值' } }, [
      'element_index',
      'value'
    ]),
    pass: ['pid', 'window_id', 'element_index', 'value'],
    log: ['element_index', 'value']
  },
  {
    name: 'computer_scroll',
    driver: 'scroll',
    kind: 'act',
    session: true,
    description: '滚动窗口。需要滚动嵌套区域时给出该区域内的截图坐标 x、y。',
    parameters: window(
      {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'integer', minimum: 1, maximum: 50, description: '滚动格数，默认 3' },
        by: { type: 'string', enum: ['line', 'page'], description: '默认 line' },
        x: num('截图中的 X 像素'),
        y: num('截图中的 Y 像素'),
        delivery_mode: DELIVERY
      },
      ['direction']
    ),
    pass: ['pid', 'window_id', 'direction', 'amount', 'by', 'x', 'y', 'delivery_mode'],
    log: ['direction', 'amount', 'by']
  },
  {
    name: 'computer_drag',
    driver: 'drag',
    kind: 'act',
    session: true,
    description: '在窗口内按住拖动，坐标为截图像素。',
    parameters: window(
      {
        from_x: num('起点 X'),
        from_y: num('起点 Y'),
        to_x: num('终点 X'),
        to_y: num('终点 Y'),
        delivery_mode: DELIVERY
      },
      ['from_x', 'from_y', 'to_x', 'to_y']
    ),
    pass: ['pid', 'window_id', 'from_x', 'from_y', 'to_x', 'to_y', 'delivery_mode'],
    log: ['from_x', 'from_y', 'to_x', 'to_y']
  },
  {
    name: 'computer_launch_app',
    driver: 'launch_app',
    kind: 'launch',
    description:
      '在后台启动应用（不抢焦点）。优先使用 computer_list_apps 返回的 launch_path，或商店应用的 aumid；也可给出名称或 .exe 完整路径。不能附带命令行参数。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        launch_path: { type: 'string', description: 'computer_list_apps 返回的 launch_path' },
        aumid: { type: 'string', description: '商店应用的 AUMID' },
        name: { type: 'string', description: '应用名称' },
        path: { type: 'string', description: '.exe 的完整路径' }
      }
    },
    pass: ['launch_path', 'aumid', 'name', 'path'],
    log: ['name', 'aumid', 'launch_path', 'path']
  },
  {
    name: 'computer_bring_to_front',
    driver: 'bring_to_front',
    kind: 'act',
    description: '把窗口切到前台。一般不需要：动作会自动处理；只有远程桌面等必须保持前台的界面才使用。',
    parameters: window({}),
    pass: ['pid', 'window_id'],
    log: []
  },
  {
    name: 'computer_invoke_menu',
    driver: 'invoke_menu',
    kind: 'act',
    session: true,
    description:
      '按菜单路径逐级打开并执行菜单项，例如 ["文件","另存为…"]。路径不明确时失败，不会退回按坐标点击。',
    parameters: window(
      {
        path: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 16, description: '菜单路径' }
      },
      ['path']
    ),
    pass: ['pid', 'window_id', 'path'],
    log: ['path']
  }
]

const ELEMENT_ADDRESSED = new Set(['click', 'type_text', 'press_key', 'set_value'])

export interface DesktopContext {
  driver: DesktopDriver
  sessionId: string
  signal: AbortSignal
  seesImages: boolean
  /** Latest snapshot id per `pid:window`, owned by this DSH session. */
  snapshots: Map<string, string>
  /** Resolve and authorize a window before reading or acting on it. */
  authorize: (window: WindowIdentity, label: string) => Promise<void>
  /** Authorize starting a program before it exists. */
  authorizeLaunch: (label: string, confirm?: string) => Promise<void>
  /** Called after a launch with the windows it produced. */
  grantLaunched: (windows: WindowIdentity[]) => void
  /** Called before the first input action of a driver session (agent cursor). */
  beginSession: () => Promise<void>
  env: NodeJS.ProcessEnv
}

export interface DesktopOutcome {
  text: string
  images: Image[]
  target: string
}

function argsFor(tool: DesktopTool, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of tool.pass) if (args[key] !== undefined) out[key] = args[key]
  for (const key of Object.keys(args))
    if (!tool.pass.includes(key) && !(tool.name === 'computer_list_apps' && key === 'query'))
      throw new ComputerUseRefusal(`${tool.name} 不接受参数 ${key}`)
  return out
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw new ComputerUseRefusal(`${name} 必须是非负整数`)
  return value
}

/** Look up one exact window of a process. */
export async function identify(
  driver: DesktopDriver,
  pid: number,
  windowId: number,
  signal: AbortSignal
): Promise<WindowIdentity & { minimized?: boolean }> {
  const listed = await driver.call('list_windows', { pid }, signal)
  const windows: any[] = listed.structuredContent?.windows ?? []
  const found = windows.find((w) => w.window_id === windowId)
  if (!found)
    throw new ComputerUseRefusal(
      `找不到 pid=${pid} 的窗口 window_id=${windowId}；窗口可能已关闭，请先调用 computer_list_windows。`
    )
  return { appName: String(found.app_name ?? ''), title: found.title, minimized: found.minimized }
}

function windowsLine(w: any): string {
  const state = w.minimized ? '最小化' : w.is_on_screen === false ? '不在屏幕上' : '可见'
  return `- pid=${w.pid} window_id=${w.window_id} | ${w.app_name} | ${JSON.stringify(w.title ?? '')} | ${state}`
}

/** Run one desktop tool after policy checks. */
export async function runDesktopTool(
  tool: DesktopTool,
  rawArgs: unknown,
  c: DesktopContext
): Promise<DesktopOutcome> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
  const driverArgs = argsFor(tool, args)
  if (tool.vision && !c.seesImages)
    throw new ComputerUseRefusal(
      '当前模型不支持图片，无法使用这个工具；请改用元素树，或请用户切换到支持图片的模型。'
    )

  if (tool.kind === 'discover') {
    if (tool.driver === 'list_windows') {
      const result = await c.driver.call('list_windows', driverArgs, c.signal)
      const windows: any[] = result.structuredContent?.windows ?? []
      const visible = windows.filter(
        (w) => !deniedWindow({ appName: String(w.app_name ?? ''), title: w.title })
      )
      const hidden = windows.length - visible.length
      const lines = visible.slice(0, 80).map(windowsLine)
      if (visible.length > 80) lines.push(`…另有 ${visible.length - 80} 个窗口，用 pid 过滤`)
      if (hidden) lines.push(`另有 ${hidden} 个受保护的窗口未列出（终端、安全软件、密码管理器等不能操作）。`)
      return { text: lines.join('\n') || '没有可操作的窗口。', images: [], target: '窗口列表' }
    }
    const result = await c.driver.call('list_apps', {}, c.signal)
    const apps: any[] = result.structuredContent?.apps ?? []
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
    const allowed = apps.filter((app) => {
      const exe = app.bundle_id && /\.exe$/i.test(app.bundle_id) ? app.bundle_id : app.name
      return (
        !deniedWindow({ appName: String(exe ?? '') }) &&
        launchDecision({ name: app.name }, []).kind !== 'deny'
      )
    })
    const picked = query
      ? allowed
          .filter((app) =>
            String(app.name ?? '')
              .toLowerCase()
              .includes(query)
          )
          .slice(0, 40)
      : allowed.filter((app) => app.running).slice(0, 60)
    const lines = picked.map((app) => {
      const state = app.running ? `运行中 pid=${app.pid}` : '未运行'
      return `- ${app.name} | ${state} | launch_path=${JSON.stringify(app.launch_path ?? app.bundle_id ?? '')}`
    })
    return {
      text:
        lines.join('\n') || (query ? `没有找到名称包含「${args.query}」的应用。` : '没有正在运行的应用。'),
      images: [],
      target: '应用列表'
    }
  }

  if (tool.kind === 'launch') {
    const request = driverArgs as LaunchRequest
    if (!request.launch_path && !request.aumid && !request.name && !request.path)
      throw new ComputerUseRefusal('需要 launch_path、aumid、name 或 path 之一')
    const decision = launchDecision(request, downloadFolders(c.env))
    if (decision.kind === 'deny') throw new ComputerUseRefusal(`不能启动该程序：${decision.reason}。`)
    const label = String(request.name ?? request.aumid ?? request.path ?? request.launch_path)
    await c.authorizeLaunch(label, decision.kind === 'confirm' ? decision.reason : undefined)
    const result = await c.driver.call('launch_app', driverArgs, c.signal)
    if (result.isError) throw new Error(textOf(result) || '启动失败')
    const pid = result.structuredContent?.pid
    const launched: any[] = result.structuredContent?.windows ?? []
    // Grant only the windows this launch reported: a UWP launch returns the shared frame host's pid,
    // whose other windows (Settings, other store apps) must still ask on first use.
    const identities: WindowIdentity[] = []
    if (typeof pid === 'number' && launched.length) {
      const listed = await c.driver.call('list_windows', { pid }, c.signal)
      const own = new Set(launched.map((w) => w.window_id))
      for (const w of listed.structuredContent?.windows ?? [])
        if (own.has(w.window_id) && !deniedWindow({ appName: String(w.app_name ?? ''), title: w.title }))
          identities.push({ appName: String(w.app_name ?? ''), title: w.title })
    }
    c.grantLaunched(identities)
    const lines = launched.map((w) => windowsLine({ ...w, pid, app_name: identities[0]?.appName ?? '' }))
    return {
      text: [
        `已在后台启动 ${label}（pid=${pid}）。`,
        ...lines,
        lines.length ? '' : '窗口尚未出现，稍后调用 computer_list_windows。'
      ]
        .join('\n')
        .trim(),
      images: [],
      target: label
    }
  }

  const pid = integer(args.pid, 'pid'),
    windowId = integer(args.window_id, 'window_id')
  if (tool.driver === 'press_key') {
    const reason = deniedKeys([
      String(args.key ?? ''),
      ...(Array.isArray(args.modifiers) ? args.modifiers.map(String) : [])
    ])
    if (reason) throw new ComputerUseRefusal(reason)
  }
  if (tool.driver === 'hotkey') {
    const reason = deniedKeys(Array.isArray(args.keys) ? args.keys.map(String) : [])
    if (reason) throw new ComputerUseRefusal(reason)
  }
  const identity = await identify(c.driver, pid, windowId, c.signal)
  const denied = deniedWindow(identity)
  if (denied) throw new ComputerUseRefusal(`不能读取或操作该窗口：${denied}。`)
  if (identity.appName.toLowerCase() === FRAME_HOST && !identity.title)
    throw new ComputerUseRefusal('无法识别这个商店应用窗口，请重新列出窗口后再试。')
  const label = appLabel(identity)
  await c.authorize(identity, label)

  const key = `${pid}:${windowId}`
  if (ELEMENT_ADDRESSED.has(tool.driver) && args.element_index !== undefined) {
    const snapshot = c.snapshots.get(key)
    if (!snapshot)
      throw new ComputerUseRefusal('请先调用 computer_get_window_state 观察这个窗口，再使用元素编号。')
    driverArgs.snapshot_id = snapshot
  }
  if (tool.session) driverArgs.session = driverSession(c.sessionId)
  if (tool.kind === 'act') await c.beginSession()

  if (tool.driver === 'get_window_state') {
    const screenshot = c.seesImages && args.include_screenshot !== false && !identity.minimized
    driverArgs.include_screenshot = screenshot
    driverArgs.max_elements = args.max_elements ?? 200
    const result = await c.driver.call('get_window_state', driverArgs, c.signal)
    if (result.isError) throw new Error(textOf(result) || '无法读取窗口')
    const s = result.structuredContent ?? {}
    if (typeof s.snapshot_id === 'string') c.snapshots.set(key, s.snapshot_id)
    const head = [
      UNTRUSTED,
      `pid=${pid} window_id=${windowId} snapshot=${s.snapshot_id ?? '-'} 应用=${identity.appName} 标题=${JSON.stringify(identity.title ?? '')}`,
      `元素 ${s.returned_element_count ?? s.element_count ?? 0}/${s.total_element_count ?? s.element_count ?? 0}${args.query ? `（query=${JSON.stringify(args.query)}）` : ''}`
    ]
    const notes: string[] = []
    if (s.degraded && s.degraded_reason) notes.push(`注意：${String(s.degraded_reason).split('.')[0]}`)
    if (identity.minimized)
      notes.push('窗口已最小化，无法截图；需要截图时先用 computer_bring_to_front 恢复。')
    else if (!c.seesImages) notes.push('当前模型不支持图片，只返回元素树。')
    const tree = String(s.tree_markdown ?? '').trim()
    return {
      text: [...head, '', tree || '（没有可识别的元素）', ...(notes.length ? ['', ...notes] : [])].join('\n'),
      images: screenshot ? imagesOf(result) : [],
      target: label
    }
  }

  const result = await c.driver.call(tool.driver, driverArgs, c.signal)
  const text = textOf(result)
  if (result.isError) throw new Error(text || `${tool.name} 失败`)
  if (tool.kind === 'act') c.snapshots.delete(key)
  return {
    text: (text.length > 3000 ? text.slice(0, 3000) + '…' : text) || '完成。',
    images: c.seesImages ? imagesOf(result) : [],
    target: label
  }
}
