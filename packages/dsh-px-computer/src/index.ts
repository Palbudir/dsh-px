/// <reference path="./modules.d.ts" />
import { existsSync, readdirSync } from 'node:fs'
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
import { guidance } from './guidance'
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
  const snapshots = new Map<string, Map<string, string>>()
  const cursors = new Set<string>()
  const projections = new WeakMap<object, ContentBlock[]>()
  const driver = new DesktopDriver(async () => {
    // Resolved from the profile's installed dependencies; the bundle inlines nothing native.
    const module: any = await import('@trycua/cua-driver')
    return module.CuaDriver.create(undefined)
  })
  const launchOptions = (): BrowserLaunchOptions => {
    const current = settings.read()
    return {
      mode: current.browser === 'off' ? 'isolated' : current.browser,
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
    return { agent: run.agent, id: run.agent.session.id }
  }

  const askOrRefuse = async (run: ToolRun, subject: string, zh: string, en: string, reason: string) => {
    const outcome = await askUser(approval(), run, { toolName: run.name ?? name, reason, zh, en })
    if (outcome !== 'allowed-once') throw new AnswerRefusal(refusalText(outcome, subject))
  }

  /** Wrap one provider call with the pause switch, the activity log and image projection. */
  const tool = (
    definition: { name: string; description: string; parameters: Record<string, unknown> },
    target: (args: Record<string, unknown>) => string,
    detail: readonly string[],
    body: (
      args: Record<string, unknown>,
      run: ToolRun,
      session: { agent: Agent; id: string },
      signal: AbortSignal
    ) => Promise<{ text: string; images: Image[]; target?: string }>
  ) => ({
    ...definition,
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: (_args: unknown, value: ToolValue) => [{ type: 'text', text: value.text }]
    },
    execute: async (raw: unknown, run: ToolRun): Promise<ToolValue> => {
      const args = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const session = sessionOf(run)
      let label = target(args)
      try {
        const result = await states.track(session.id, run.signal, (signal) =>
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
          outcome: 'ok'
        })
        return { text: result.text }
      } catch (error) {
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
      spec,
      (args) => (args.pid !== undefined ? `pid=${args.pid}` : spec.name),
      spec.log,
      async (args, run, s, signal) => {
        const label = driverSession(s.id)
        const sessionSnapshots = snapshots.get(s.id) ?? new Map<string, string>()
        snapshots.set(s.id, sessionSnapshots)
        return runDesktopTool(spec, args, {
          driver,
          sessionId: s.id,
          signal,
          seesImages: await modelSeesImages(ctx, s.agent, signal),
          snapshots: sessionSnapshots,
          env: process.env,
          authorize: async (window: WindowIdentity, display: string) => {
            const key = appKey(window)
            if (states.granted(s.id, key) || settings.alwaysAllowsApp(key)) return
            await askOrRefuse(
              run,
              `操作「${display}」`,
              `允许 DSH 在本会话中读取和操作「${display}」吗？之后本会话对它的查看、点击和输入不再逐次询问；删除、发送、付款等敏感动作仍会单独确认。`,
              `Allow DSH to read and operate "${display}" in this session? Later views, clicks and typing in this app will not ask again; deleting, sending or paying still asks separately.`,
              `computer use: app access ${window.appName}`
            )
            states.grant(s.id, key, display)
          },
          authorizeLaunch: async (display: string, confirm?: string) => {
            const key = `launch|${display.toLowerCase()}`
            if (!confirm && states.granted(s.id, key)) return
            await askOrRefuse(
              run,
              `启动「${display}」`,
              confirm
                ? `即将${confirm}：${display}。允许吗？`
                : `允许 DSH 启动「${display}」并在本会话中操作它吗？`,
              confirm
                ? `About to ${LAUNCH_REASON_EN[confirm] ?? 'run a program'}: ${display}. Allow?`
                : `Allow DSH to start "${display}" and operate it in this session?`,
              `computer use: launch ${display}`
            )
            states.grant(s.id, key)
          },
          grantLaunched: (windows) => {
            for (const window of windows) states.grant(s.id, appKey(window), appLabel(window))
          },
          beginSession: async () => {
            if (cursors.has(label)) return
            cursors.add(label)
            try {
              await driver.call('start_session', { session: label }, signal)
              await driver.call('set_agent_cursor_enabled', { session: label, enabled: true }, signal)
            } catch (error) {
              ctx.logger?.warn?.('dsh-px-computer: agent cursor unavailable: %s', String(error))
            }
          }
        })
      }
    )

  const browserTool = (spec: (typeof BROWSER_TOOLS)[number]) =>
    tool(
      spec,
      (args) => String(args.url ?? spec.name),
      ['url', 'action', 'element', 'text', 'key'],
      async (args, run, s, signal) => {
        const current = settings.read()
        if (current.browser === 'off') throw new ComputerUseRefusal('浏览器操作已关闭')
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
          if (siteGranted(target)) return
          await askOrRefuse(
            run,
            `访问 ${target}`,
            landed
              ? `页面已跳转到 ${target}。允许 DSH 在本会话中使用${where[0]}读取并操作这个网站吗？该浏览器可能保留你的登录状态。`
              : `允许 DSH 在本会话中使用${where[0]}访问并操作 ${target} 吗？该浏览器可能保留你的登录状态。`,
            `${landed ? `The page moved to ${target}. ` : ''}Allow DSH to open and operate ${target} in ${where[1]} for this session? It may hold your signed-in state.`,
            `browser use: site access ${target}`
          )
          states.grant(s.id, `site|${target}`, target)
        }
        if (signedIn && site) await grantSite(site, false)
        if (spec.name === 'browser_file_upload') {
          const files = uploadSummary(args)
          if (files.length)
            await askOrRefuse(
              run,
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
        if (signedIn && spec.name === 'browser_tabs') text = redactTabTitles(text, siteGranted)
        const sees = browserImages(result).length > 0 && (await modelSeesImages(ctx, s.agent, signal))
        return {
          text: text || '完成。',
          images: sees ? browserImages(result) : [],
          target: landed ?? site ?? spec.name
        }
      }
    )

  const confirmTool = tool(
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
    async (args, run) => {
      const action = String(args.action ?? '').trim()
      if (!action) throw new ComputerUseRefusal('请写明要确认的具体动作')
      await askOrRefuse(
        run,
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

  // The policy, drivers and browser channel are Windows-specific; other hosts keep the panel only.
  const windows = process.platform === 'win32'
  const enabled = (current: ComputerSettings) => windows && (current.desktop || current.browser !== 'off')

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

  // Closing the browser when the browser setting changes keeps a running server from outliving its mode.
  let browserShape = `${settings.read().browser}|${settings.read().headless}`
  settings.subscribe((current) => {
    const next = `${current.browser}|${current.headless}`
    if (next !== browserShape) void browsers.closeAll().catch(() => undefined)
    browserShape = next
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
            .call('end_session', { session: label }, AbortSignal.timeout(5000))
            .catch(() => undefined)
        snapshots.delete(id)
        states.forget(id)
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
                act(sessionId, body)
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

  function act(sessionId: string, body: any): void {
    switch (body?.action) {
      case 'settings':
        settings.change(body.revision, (next) => {
          if (typeof body.desktop === 'boolean') next.desktop = body.desktop
          if (typeof body.browser === 'string') next.browser = body.browser
          if (typeof body.headless === 'boolean') next.headless = body.headless
        })
        return
      case 'always-allow-app': {
        const key = String(body.key ?? '')
        if (
          !states.grantedApps(sessionId).some((app) => app.key === key) ||
          key.startsWith('launch|') ||
          key.startsWith('site|')
        )
          throw new SettingsError('只能把本会话已允许的应用设为始终允许')
        settings.change(body.revision, (next) => {
          if (!next.alwaysAllowApps.some((app) => app.key === key))
            next.alwaysAllowApps.push({ key, label: String(body.label ?? key).slice(0, 300) })
        })
        return
      }
      case 'forget-app':
        settings.change(body.revision, (next) => {
          next.alwaysAllowApps = next.alwaysAllowApps.filter((app) => app.key !== body.key)
        })
        states.revoke(sessionId, String(body.key ?? ''))
        return
      case 'always-allow-site': {
        const site = String(body.site ?? '')
        if (!states.grantedApps(sessionId).some((app) => app.key === `site|${site}`))
          throw new SettingsError('只能把本会话已允许的网站设为始终允许')
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
        return
      case 'resume':
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
        paused: states.isPaused(sessionId),
        apps: granted.filter((app) => !app.key.startsWith('launch|') && !app.key.startsWith('site|')),
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
