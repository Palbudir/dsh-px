/// <reference path="./modules.d.ts" />
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rejectUnauthenticatedRequest } from '../../shared/request-trust'
import {
  BrowserSessions,
  BROWSER_TOOLS,
  browserImages,
  browserText,
  checkBrowserArgs,
  currentTabUrl,
  pageUrlOf,
  processAlive,
  redactTabTitles,
  sweepOutput,
  siteOf,
  targetSite,
  uploadSummary,
  type BrowserLaunchOptions
} from './browser'
import { DESKTOP_TOOLS, DesktopDriver, driverSession, runDesktopTool, type DesktopTool } from './desktop'
import { DriverProcess } from './driver-process'
import computerDriver from '../../../config/computer-driver.json'
import { guidance } from './guidance'
import { accessPolicy } from './authorization'
import { enforceToolBounds, nativeToolParameters } from './tool-schema'
import { appKey, appLabel, type WindowIdentity } from './policy'
import {
  askUser,
  ComputerUseRefusal,
  imageContent,
  modelSeesImages,
  refusalText,
  SessionStates,
  summarize,
  TOOL_OUTPUT_SCHEMA,
  type Agent,
  type Capability,
  type ContentBlock,
  type Image,
  type ToolRun,
  type ToolValue
} from './runtime'
import { SettingsError, SettingsStore, type ComputerSettings } from './settings'

export const name = 'dsh-px-computer'
export const inject: string[] = []

/** A refusal caused by a user's answer; logged separately from policy denials. */
class AnswerRefusal extends ComputerUseRefusal {}

const PLAYWRIGHT_EXTENSION = 'mmlmfjhmonkocbjadbfplnigmagldckm'
const LAUNCH_REASON_EN: Record<string, string> = {
  安装软件: 'install software',
  运行新下载的程序: 'run a newly downloaded program',
  运行不在常用程序目录中的程序: 'run a program outside the usual install folders'
}
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,160}$/

/** Whether the Playwright extension is present in any local Edge profile (folder check only). */
function edgeExtensionInstalled(env: NodeJS.ProcessEnv): boolean {
  const root = env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data')
  if (!root || !existsSync(root)) return false
  try {
    return readdirSync(root)
      .filter((entry) => entry === 'Default' || /^Profile \d+$/.test(entry))
      .some((profile) => existsSync(join(root, profile, 'Extensions', PLAYWRIGHT_EXTENSION)))
  } catch {
    return false
  }
}

export function apply(ctx: any): void {
  const home = process.env.DSH_HOME
  if (!home) throw new Error('DSH_HOME 未设置，无法保存电脑操作设置')
  const storage = join(home, 'storages', name)
  const settings = new SettingsStore(join(storage, 'settings.json'))
  const states = new SessionStates()
  const observedAgents = new Map<string, Agent>()
  const snapshots = new Map<string, Map<string, string>>()
  const cursors = new Set<string>()
  const projections = new WeakMap<object, ContentBlock[]>()
  const driver = new DesktopDriver(async () => {
    // Resolve in the profile, load only in the disposable child process. No native code in DSH.
    const nativeDirectory = fileURLToPath(new URL('../native/win32-x64/', import.meta.url))
    const manifest = JSON.parse(readFileSync(join(nativeDirectory, 'manifest.json'), 'utf8'))
    if (!/^[a-f0-9]{64}$/.test(manifest.input?.sha256 ?? ''))
      throw Error('电脑操作执行器清单不完整，请更新插件包')
    return new DriverProcess(
      import.meta.resolve('@trycua/cua-driver'),
      () => {
        for (const observed of snapshots.values()) observed.clear()
        snapshots.clear()
        cursors.clear()
        states.clearForeground()
        states.stop(
          'desktop',
          new ComputerUseRefusal('电脑驱动已重置，待执行的桌面操作已中止。请重新观察并取得窗口控制授权。')
        )
      },
      45000,
      {
        binaryPath: join(nativeDirectory, 'cua-driver.exe'),
        version: computerDriver.version,
        files: computerDriver.files,
        input: { binaryPath: join(nativeDirectory, 'px-windows-input.exe'), sha256: manifest.input.sha256 }
      }
    )
  })
  const launchOptions = (): BrowserLaunchOptions | undefined => {
    const current = settings.read()
    if (current.browser === 'off') return undefined
    return {
      mode: current.browser,
      headless: current.headless,
      // Resolved only when a browser starts, so a missing optional install never breaks the panel.
      get cli(): string {
        try {
          return join(dirname(fileURLToPath(import.meta.resolve('@playwright/mcp/package.json'))), 'cli.js')
        } catch {
          throw new Error('浏览器组件 @playwright/mcp 未安装。请在插件管理中重新安装「电脑操作」后再试。')
        }
      },
      node: process.execPath,
      electron: !!process.versions.electron,
      profileDir: join(storage, 'edge-profile')
    }
  }
  const browsers = new BrowserSessions(
    launchOptions,
    join(tmpdir(), 'dsh-px-computer', String(process.pid)),
    process.env
  )
  sweepOutput(join(tmpdir(), 'dsh-px-computer'), (pid) => pid === process.pid || processAlive(pid))
  const approval = (): any => ctx.get?.('approval') ?? ctx.approval

  const sessionOf = (run: ToolRun): { agent: Agent; id: string } => {
    if (!run.agent) throw new ComputerUseRefusal('电脑操作只能在会话中使用')
    observedAgents.set(run.agent.session.id, run.agent)
    return { agent: run.agent, id: run.agent.session.id }
  }

  /** Ask on the call's combined signal; an answer that arrives after a pause or setting change is void. */
  const askOrRefuse = async (
    run: ToolRun,
    signal: AbortSignal,
    subject: string,
    zh: string,
    en: string,
    reason: string,
    ordinary = false
  ) => {
    signal.throwIfAborted()
    const policy = accessPolicy(ctx, run.agent)
    // Full access is the user's native session choice. It grants ordinary use only while the
    // corresponding capability/delivery mode is enabled; never persist it across preset changes.
    if (ordinary && policy === 'full') return
    if (policy === 'never' || policy === 'full')
      throw new AnswerRefusal(
        ordinary
          ? `${subject}尚未授权，且本会话关闭了确认提示。请用户在「电脑操作 → 应用与网站授权」中允许该应用或网站；前台窗口需切换到可询问的会话权限后重试。未执行，不要反复申请。`
          : `${subject}需要单独确认，但本会话关闭了确认提示。请用户切换到可询问的会话权限后重新申请，或亲自完成这一步。未执行，不要反复申请。`
      )
    const outcome = await askUser(approval(), run, signal, { toolName: run.name ?? name, reason, zh, en })
    signal.throwIfAborted()
    if (outcome !== 'allowed-once') throw new AnswerRefusal(refusalText(outcome, subject))
  }

  // The policy, drivers and browser channel are Windows-specific; other hosts keep the panel only.
  const windows = process.platform === 'win32'
  const enabled = (current: ComputerSettings) => windows && (current.desktop || current.browser !== 'off')
  const available = (capability: Capability, current: ComputerSettings): boolean =>
    capability === 'desktop'
      ? windows && current.desktop
      : capability === 'browser'
        ? windows && current.browser !== 'off'
        : enabled(current)
  const CLOSED: Record<Capability, string> = {
    desktop: '桌面应用操作已在「电脑操作」面板关闭，本次调用已中止。',
    browser: '浏览器操作已在「电脑操作」面板关闭，本次调用已中止。',
    confirm: '电脑操作已在「电脑操作」面板关闭，本次调用已中止。'
  }

  /** Wrap one provider call with its capability, the pause switch, the activity log and image projection. */
  const tool = (
    capability: Capability,
    definition: { name: string; description: string; parameters: Record<string, unknown> },
    target: (args: Record<string, unknown>) => string,
    detail: readonly string[],
    body: (
      args: Record<string, unknown>,
      run: ToolRun,
      session: { agent: Agent; id: string },
      signal: AbortSignal
    ) => Promise<{ text: string; images: Image[]; target?: string; receipt?: string }>
  ) => ({
    ...definition,
    parameters: nativeToolParameters(definition.parameters),
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: (_args: unknown, value: ToolValue) => [{ type: 'text', text: value.text }]
    },
    execute: async (raw: unknown, run: ToolRun): Promise<ToolValue> => {
      const args = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const session = sessionOf(run)
      let label = target(args)
      try {
        // A call the host dispatched before the setting changed still finds the capability off.
        if (!available(capability, settings.read())) throw new ComputerUseRefusal(CLOSED[capability])
        enforceToolBounds(definition.parameters, args)
        const result = await states.track(session.id, capability, run.signal, (signal) =>
          body(args, run, session, signal)
        )
        label = result.target ?? label
        if (result.images.length) {
          const images = await imageContent(ctx, result.images, run.signal)
          projections.set(run, [{ type: 'text', text: result.text }, ...images])
        }
        states.record(session.id, {
          at: Date.now(),
          tool: definition.name,
          target: label,
          detail: summarize(args, detail),
          outcome: 'ok',
          message: result.receipt
        })
        return { text: result.text }
      } catch (error) {
        if (
          capability === 'desktop' &&
          ['driver_session_ended', 'driver_unexpected_foreground'].includes((error as any)?.code)
        ) {
          states.pause(session.id)
          snapshots.delete(session.id)
          cursors.delete(driverSession(session.id))
          ctx.logger?.warn?.('dsh-px-computer: session ended: %s', (error as any).nativeDetail)
        }
        const message = error instanceof Error ? error.message : String(error)
        states.record(session.id, {
          at: Date.now(),
          tool: definition.name,
          target: label,
          detail: summarize(args, detail),
          outcome:
            error instanceof AnswerRefusal
              ? 'rejected'
              : error instanceof ComputerUseRefusal
                ? 'denied'
                : 'error',
          message: message.slice(0, 300)
        })
        throw error
      }
    },
    projectContent: (exec: object, result: { isError?: boolean }) => {
      const blocks = projections.get(exec)
      projections.delete(exec)
      return blocks && !result.isError ? blocks : undefined
    }
  })

  const desktopTool = (spec: DesktopTool) =>
    tool(
      'desktop',
      spec,
      (args) => (args.pid !== undefined ? `pid=${args.pid}` : spec.name),
      spec.log,
      async (args, run, s, signal) => {
        const label = driverSession(s.id)
        const sessionSnapshots = snapshots.get(s.id) ?? new Map<string, string>()
        snapshots.set(s.id, sessionSnapshots)
        return runDesktopTool(spec, args, {
          driver: driver.forSession(s.id),
          sessionId: s.id,
          signal,
          seesImages: await modelSeesImages(ctx, s.agent, signal),
          foregroundAllowed: settings.read().desktopForeground === true,
          onUnexpectedForeground: () => states.pause(s.id),
          onWindowGone: (pid, windowId) => states.forgetForegroundWindow(s.id, pid, windowId),
          authorizeForeground: async (display, target) => {
            if (accessPolicy(ctx, s.agent) === 'full') return
            const app = appKey(target.identity)
            const key = `window|${target.pid}|${target.windowId}|${app}`
            await states.authorizeForeground(s.id, key, app, display, signal, () =>
              askOrRefuse(
                run,
                signal,
                `在本会话中控制「${display}」`,
                `允许本会话连续读取和操作「${display}」这个窗口，并按任务需要占用前台鼠标和键盘吗？普通动作不再逐次询问；暂停、撤销或关闭桌面能力后结束授权。删除、发送、付款等敏感动作仍单独确认。`,
                `Allow this session to read, operate and focus this exact "${display}" window? Ordinary actions will not ask again. Pause, revoke or disable desktop control to end the grant. Sensitive actions still need confirmation.`,
                'computer use: session window control',
                true
              )
            )
          },
          snapshots: sessionSnapshots,
          env: process.env,
          authorize: async (window: WindowIdentity, display: string, target) => {
            const key = appKey(window)
            states.observe(s.id, key, display)
            if (states.granted(s.id, key) || settings.alwaysAllowsApp(key)) return
            if (accessPolicy(ctx, s.agent) === 'full') return
            await askOrRefuse(
              run,
              signal,
              `操作「${display}」`,
              `允许 DSH 在本会话中读取和操作「${display}」吗？${settings.read().desktopForeground ? '包括按任务需要占用这个窗口的前台鼠标和键盘。' : ''}之后普通操作不再逐次询问；删除、发送、付款等敏感动作仍会单独确认。`,
              `Allow DSH to read and operate "${display}" in this session? ${settings.read().desktopForeground ? 'This includes focusing this window for mouse and keyboard actions. ' : ''}Ordinary operations will not ask again; sensitive actions still ask separately.`,
              `computer use: app access ${window.appName}`,
              true
            )
            states.grant(s.id, key, display)
            if (settings.read().desktopForeground && target)
              states.grantForeground(s.id, `window|${target.pid}|${target.windowId}|${key}`, key, display)
          },
          authorizeLaunch: async (display: string, confirm?: string) => {
            const key = `launch|${display.toLowerCase()}`
            await askOrRefuse(
              run,
              signal,
              `启动「${display}」`,
              confirm
                ? `即将${confirm}：${display}。允许吗？`
                : `允许 DSH 启动「${display}」并在本会话中连续操作它创建的窗口吗？这可能占用前台鼠标和键盘，普通操作不再逐次询问。`,
              confirm
                ? `About to ${LAUNCH_REASON_EN[confirm] ?? 'run a program'}: ${display}. Allow?`
                : `Allow DSH to launch "${display}" and control its new windows in this session, including foreground mouse and keyboard actions?`,
              `computer use: launch ${display}`,
              !confirm
            )
            states.grant(s.id, key)
          },
          grantLaunched: (windows, allowForeground) => {
            for (const window of windows) {
              const key = appKey(window),
                label = appLabel(window)
              states.observe(s.id, key, label)
              if (accessPolicy(ctx, s.agent) === 'full') continue
              states.grant(s.id, key, label)
              if (allowForeground)
                states.grantForeground(s.id, `window|${window.pid}|${window.windowId}|${key}`, key, label)
            }
          },
          beginSession: async () => {
            if (cursors.has(label)) return
            cursors.add(label)
            try {
              await driver.call('start_session', { session: label }, signal, s.id)
              await driver.call('set_agent_cursor_enabled', { session: label, enabled: true }, signal, s.id)
            } catch (error) {
              ctx.logger?.warn?.('dsh-px-computer: agent cursor unavailable: %s', String(error))
            }
          }
        })
      }
    )

  const browserTool = (spec: (typeof BROWSER_TOOLS)[number]) =>
    tool(
      'browser',
      spec,
      (args) => String(args.url ?? spec.name),
      ['url', 'action', 'element', 'text', 'key'],
      async (args, run, s, signal) => {
        const current = settings.read()
        checkBrowserArgs(spec.name, args)
        if (spec.name === 'browser_take_screenshot' && !(await modelSeesImages(ctx, s.agent, signal)))
          throw new ComputerUseRefusal('当前模型不支持图片，请改用 browser_snapshot。')
        // Profiles that carry sign-in state need a grant before any read or action on a site.
        const signedIn = current.browser !== 'isolated'
        const cwd = s.agent.session.header.cwd,
          label = driverSession(s.id)
        // Typing or a key press can navigate without reporting where; find out before the next site check.
        if (signedIn && browsers.pageUnknown(s.id)) {
          const listed = await browsers.call(s.id, cwd, label, 'browser_tabs', { action: 'list' }, signal)
          browsers.setUrl(s.id, currentTabUrl(browserText(listed)))
        }
        const site = targetSite(spec.name, args, browsers.currentUrl(s.id))
        const where =
          current.browser === 'extension'
            ? ['你的 Edge', 'your Edge']
            : ['PX 专用浏览器', 'the PX browser profile']
        const siteGranted = (target: string): boolean =>
          states.granted(s.id, `site|${target}`) || settings.alwaysAllowsSite(target)
        const grantSite = async (target: string, landed: boolean): Promise<void> => {
          states.observe(s.id, `site|${target}`, target)
          if (siteGranted(target)) return
          if (accessPolicy(ctx, s.agent) === 'full') return
          await askOrRefuse(
            run,
            signal,
            `访问 ${target}`,
            landed
              ? `页面已跳转到 ${target}。允许 DSH 在本会话中使用${where[0]}读取并操作这个网站吗？该浏览器可能保留你的登录状态。`
              : `允许 DSH 在本会话中使用${where[0]}访问并操作 ${target} 吗？该浏览器可能保留你的登录状态。`,
            `${landed ? `The page moved to ${target}. ` : ''}Allow DSH to open and operate ${target} in ${where[1]} for this session? It may hold your signed-in state.`,
            `browser use: site access ${target}`,
            true
          )
          states.grant(s.id, `site|${target}`, target)
        }
        if (signedIn && site) await grantSite(site, false)
        if (spec.name === 'browser_file_upload') {
          const files = uploadSummary(args)
          if (files.length)
            await askOrRefuse(
              run,
              signal,
              '上传文件',
              `即将向 ${site ?? '当前网页'} 上传：${files.join('、')}。允许吗？`,
              `About to upload ${files.join(', ')} to ${site ?? 'the current page'}. Allow?`,
              `browser use: upload ${files.length} file(s)`
            )
        }
        const result = await browsers.call(s.id, cwd, label, spec.name, args, signal)
        let text = browserText(result)
        if (result.isError) throw new Error(text || `${spec.name} 失败`)
        // A click or redirect can land on another site; its content is withheld until that site is granted.
        const landed = siteOf(pageUrlOf(text) ?? '')
        if (signedIn && landed && landed !== site) await grantSite(landed, true)
        if (signedIn && spec.name === 'browser_tabs' && accessPolicy(ctx, s.agent) !== 'full')
          text = redactTabTitles(text, siteGranted)
        const sees = browserImages(result).length > 0 && (await modelSeesImages(ctx, s.agent, signal))
        return {
          text: text || '完成。',
          images: sees ? browserImages(result) : [],
          target: landed ?? site ?? spec.name
        }
      }
    )

  const confirmTool = tool(
    'confirm',
    {
      name: 'computer_confirm',
      description:
        '在执行需要用户确认的电脑或浏览器动作之前调用（删除、对外发送或提交、付款、修改账号权限、安装软件等）。用户批准后只对描述的那一步有效；未获批准时不要执行，并在回复中说明。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'category'],
        properties: {
          action: {
            type: 'string',
            maxLength: 300,
            description:
              '即将执行的具体动作，写清对象和内容，例如“在 Outlook 中把草稿《周报》发送给 li@example.com”'
          },
          category: {
            type: 'string',
            enum: ['delete', 'send', 'submit', 'purchase', 'account', 'install', 'settings', 'other'],
            description: '动作类别'
          }
        }
      }
    },
    (args) => String(args.category ?? 'confirm'),
    ['category', 'action'],
    async (args, run, _session, signal) => {
      const action = String(args.action ?? '').trim()
      if (!action) throw new ComputerUseRefusal('请写明要确认的具体动作')
      await askOrRefuse(
        run,
        signal,
        '这一步',
        `即将执行：${action}。允许吗？`,
        `About to: ${action}. Allow?`,
        `computer use: confirm ${String(args.category)}: ${action}`
      )
      return {
        text: '用户已批准这一步。只执行刚才描述的动作；若对象或内容有变化，需要重新确认。',
        images: []
      }
    }
  )

  ctx.inject(['tools'], (host: any) => {
    let registered: Array<() => void> = []
    let shape = ''
    const sync = (current: ComputerSettings): void => {
      const next = `${windows && current.desktop}|${windows && current.browser !== 'off'}`
      if (next === shape) return
      for (const dispose of registered) dispose()
      registered = []
      shape = next
      if (windows && current.desktop)
        for (const spec of DESKTOP_TOOLS) registered.push(host.tools.register(desktopTool(spec)))
      if (windows && current.browser !== 'off')
        for (const spec of BROWSER_TOOLS) registered.push(host.tools.register(browserTool(spec)))
      if (enabled(current)) registered.push(host.tools.register(confirmTool))
    }
    sync(settings.read())
    const off = settings.subscribe(sync)
    host.effect(
      () => () => {
        off()
        for (const dispose of registered) dispose()
        registered = []
      },
      'computer: tools'
    )
  })

  ctx.inject(['systemPrompt'], (host: any) =>
    host.effect(
      () =>
        host.systemPrompt.section({
          name: 'dsh-px-computer-use',
          order: 9800,
          interpolate: false,
          text: () => {
            const current = settings.read()
            return enabled(current) ? guidance(current) : ''
          }
        }),
      'computer: guidance'
    )
  )

  // A setting change ends what the old setting allowed: in-flight calls (including their pending
  // confirmation cards) stop, the browser closes, and session grants made under the old mode lapse.
  // Grants name the browser or the enabled capability they were asked for, so they never carry over.
  let previous = settings.read()
  settings.subscribe((current) => {
    const before = previous
    previous = current
    if (current.browser !== before.browser || current.headless !== before.headless) {
      states.stop(
        'browser',
        new ComputerUseRefusal(
          current.browser === 'off'
            ? CLOSED.browser
            : '浏览器模式已在「电脑操作」面板更改，本次调用已中止；如仍需要，请重新发起。'
        )
      )
      void browsers.closeAll().catch(() => undefined)
    }
    if (current.browser !== before.browser) states.revokeAll((key) => key.startsWith('site|'))
    if ((before.desktop && !current.desktop) || before.desktopForeground !== current.desktopForeground) {
      states.clearForeground()
      states.stop(
        'desktop',
        new ComputerUseRefusal(current.desktop ? '桌面操作模式已更改，本次调用已停止。' : CLOSED.desktop)
      )
    }
    // Read access may remain when delivery mode changes; window control must be authorized again.
    if (before.desktop && !current.desktop) states.revokeAll((key) => !key.startsWith('site|'))
    if (!enabled(current)) states.stop('confirm', new ComputerUseRefusal(CLOSED.confirm))
    if (!current.desktop) void driver.close().catch(() => undefined)
  })

  ctx.on('agent/created', ({ agent }: { agent: any }) => {
    agent?.ctx?.effect?.(
      () => async () => {
        const id = agent.session.id
        await browsers.close(id).catch(() => undefined)
        const label = driverSession(id)
        if (cursors.delete(label) && driver.loaded)
          await driver
            .call('end_session', { session: label }, AbortSignal.timeout(5000), id)
            .catch(() => undefined)
        await driver.releaseSession(id).catch(() => undefined)
        snapshots.delete(id)
        states.forget(id)
        observedAgents.delete(id)
      },
      'computer: session'
    )
  })

  ctx.effect(
    () => async () => {
      await browsers.closeAll()
      await driver.close()
    },
    'computer: shutdown'
  )

  ctx.inject(['connection', 'webServer'], (host: any) =>
    host.effect(
      () =>
        host.webServer.register({
          kind: 'exact',
          path: '/dsh-px-computer',
          handler: async (req: any, res: any) => {
            if (rejectUnauthenticatedRequest(req, res, host.connection)) return
            const send = (status: number, data: unknown) => {
              res.writeHead(status, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
              })
              res.end(JSON.stringify(data))
            }
            try {
              const sessionId = new URL(req.url, 'http://127.0.0.1').searchParams.get('sessionId') ?? ''
              if (!SESSION_ID.test(sessionId)) throw new SettingsError('会话无效')
              if (req.method === 'POST') {
                if (!String(req.headers['content-type']).startsWith('application/json'))
                  throw new SettingsError('请使用 JSON', 415)
                let size = 0
                const chunks: Buffer[] = []
                for await (const chunk of req) {
                  size += Buffer.byteLength(chunk)
                  if (size > 16000) throw new SettingsError('请求过大', 413)
                  chunks.push(Buffer.from(chunk))
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
                await act(sessionId, body)
              } else if (req.method !== 'GET') throw new SettingsError('请使用 GET 或 POST', 405)
              send(200, view(sessionId))
            } catch (error) {
              send(error instanceof SettingsError ? error.status : 400, {
                error: error instanceof Error ? error.message : String(error)
              })
            }
          }
        }),
      'computer: panel route'
    )
  )

  async function act(sessionId: string, body: any): Promise<void> {
    switch (body?.action) {
      case 'settings':
        settings.change(body.revision, (next) => {
          if (typeof body.desktop === 'boolean') next.desktop = body.desktop
          if (typeof body.desktopForeground === 'boolean') next.desktopForeground = body.desktopForeground
          if (typeof body.browser === 'string') next.browser = body.browser
          if (typeof body.headless === 'boolean') next.headless = body.headless
        })
        return
      case 'allow-app':
      case 'always-allow-app': {
        const key = String(body.key ?? '')
        const observed = states.observedApps(sessionId).find((app) => app.key === key)
        if (!observed || key.startsWith('launch|') || key.startsWith('site|'))
          throw new SettingsError('只能允许本会话已识别且可操作的应用')
        if (body.action === 'allow-app') {
          states.grant(sessionId, key, observed.label)
          return
        }
        settings.change(body.revision, (next) => {
          if (!next.alwaysAllowApps.some((app) => app.key === key))
            next.alwaysAllowApps.push({ key, label: observed.label.slice(0, 300) })
        })
        return
      }
      case 'forget-app':
        settings.change(body.revision, (next) => {
          next.alwaysAllowApps = next.alwaysAllowApps.filter((app) => app.key !== body.key)
        })
        states.revoke(sessionId, String(body.key ?? ''))
        return
      case 'revoke-window-control':
        states.pause(sessionId)
        await driver.releaseSession(sessionId)
        return
      case 'allow-site':
      case 'always-allow-site': {
        const site = String(body.site ?? '')
        if (!states.observedApps(sessionId).some((app) => app.key === `site|${site}`))
          throw new SettingsError('只能允许本会话已识别的网站')
        if (body.action === 'allow-site') {
          states.grant(sessionId, `site|${site}`, site)
          return
        }
        settings.change(body.revision, (next) => {
          if (!next.alwaysAllowSites.includes(site)) next.alwaysAllowSites.push(site)
        })
        return
      }
      case 'forget-site':
        settings.change(body.revision, (next) => {
          next.alwaysAllowSites = next.alwaysAllowSites.filter((site) => site !== body.site)
        })
        states.revoke(sessionId, `site|${String(body.site ?? '')}`)
        return
      case 'pause':
        states.pause(sessionId)
        void browsers.close(sessionId).catch(() => undefined)
        await driver.releaseSession(sessionId)
        return
      case 'resume':
        await driver.releaseSession(sessionId)
        snapshots.delete(sessionId)
        cursors.delete(driverSession(sessionId))
        states.resume(sessionId)
        return
      case 'release-browser': {
        const holder = browsers.holder()
        if (holder) void browsers.close(holder).catch(() => undefined)
        return
      }
      default:
        throw new SettingsError('操作无效')
    }
  }

  function view(sessionId: string) {
    const current = settings.read()
    const granted = states.grantedApps(sessionId)
    const holder = browsers.holder()
    return {
      settings: current,
      session: {
        policy: accessPolicy(ctx, observedAgents.get(sessionId)),
        observedApps: states.observedApps(sessionId).filter((app) => !app.key.startsWith('site|')),
        observedSites: states
          .observedApps(sessionId)
          .filter((app) => app.key.startsWith('site|'))
          .map((app) => app.label),
        paused: states.isPaused(sessionId),
        apps: granted.filter((app) => !app.key.startsWith('launch|') && !app.key.startsWith('site|')),
        foreground: states.foregroundWindows(sessionId),
        sites: granted.filter((app) => app.key.startsWith('site|')).map((app) => app.key.slice(5)),
        log: states.log(sessionId).slice(-80).reverse()
      },
      status: {
        driverLoaded: driver.loaded,
        browserOpen: browsers.active.includes(sessionId),
        browserHeldElsewhere: !!holder && holder !== sessionId,
        edgeExtension: edgeExtensionInstalled(process.env),
        platform: process.platform
      }
    }
  }
}
