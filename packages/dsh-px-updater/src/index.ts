/**
 * dsh-px 更新插件（宿主半边）。
 *
 * 存在的理由：把"检查更新"做成 **dsh 生态内的正式组合包**，而不是只藏在外壳里。
 * 这样它天然获得插件该有的一切 —— 可配置、可热重载、可被其他插件消费、
 * 出错时按 dsh 的方式报告，而不是变成只有外壳知道的私有逻辑。
 *
 * 职责边界（刻意划清，避免和外壳重复造轮子）：
 *   - **本插件**：告诉你"现在是什么版本、有没有更新、更新了什么"，
 *     并把外壳的更新状态转给界面；同时暴露 HTTP 端点与模型工具供人与智能体查询。
 *   - **外壳**：真正的下载与安装。Electron 侧用 electron-updater，
 *     它自带差分下载（blockmap）、sha512 校验与失败回滚。
 *     本插件**不碰**安装 —— 在一个正在运行的 exe 上做文件替换是外壳的活，
 *     插件去做只会更脆弱。
 *
 * 一句话：插件负责"知情"，外壳负责"动手"。
 *
 * ## 本文件是**源码**，不是交付物
 *
 * 交付物是 `lib/index.js`，由 `scripts/build-host.mjs` 用 esbuild 从本文件产出。
 * 这么做是因为：交付形态必须与 dsh 官方随附插件一致（可直接 import 的纯 ESM JS，
 * 用户机不需要构建步骤），而**写作**形态用 TypeScript 才能在改动时得到类型检查。
 * 客户端半边（`src/client.tsx` → `lib/client.js`）走的是同一套模式。
 *
 * 关键约束：**产物里不能有任何 import**。见 `DEFAULTS` 上方的说明。
 *
 * @module dsh-px-updater
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HostPluginContext, HostRequest, HostResponse } from '@deepseek-ai/cordis'
import { isNewer, isValidVersion } from './version'

/** Cordis 插件名（用于 loader 诊断）。 */
export const name = 'dsh-px-updater'

/**
 * 不声明必需 inject：本插件是**可选增强**，缺少 webServer 时也应当能加载。
 * 真正的依赖用 `ctx.inject([...])` 在用到的地方声明。
 */
export const inject: string[] = []

/** 运行时配置。 */
export interface UpdaterConfig {
  repository: string
  timeoutMs: number
  registerTool: boolean
  routePrefix: string
}

/**
 * 默认配置。
 *
 * **刻意不使用 schemastery 定义 Schema**（虽然官方教程推荐）：
 * 本插件是仓库自带的本地插件，通过 `link:`/`file:` 安装，而 pnpm 的这两种协议
 * **不会安装 peerDependencies**；`link:` 下 Node 又按真实路径（仓库外）解析模块，
 * 于是 `import Schema from '@deepseek-ai/schemastery'` 会直接
 * `ERR_MODULE_NOT_FOUND`，整棵插件树随之启动失败（实测踩到）。
 *
 * 结论：**自研插件应当零运行时依赖**，默认值自己合并即可。
 * 官方教程里的 Schema 写法适用于发布到 npm、由 pnpm 正常解析依赖的包。
 */
export const DEFAULTS: UpdaterConfig = {
  repository: 'Palbudir/dsh-px',
  timeoutMs: 8000,
  registerTool: true,
  routePrefix: '/dsh-px-updater'
}

/** `readAppInfo()` 的结果。 */
interface AppInfo {
  appVersion: string | null
  dshVersion: string | null
  platform: string | null
  manifestPath: string | null
}

/**
 * `process.resourcesPath` 的值（打包后的 Electron 才有）。
 *
 * 它是 **Electron 扩展**，不在 `@types/node` 的 `Process` 里，直接访问过不了
 * 严格类型检查。这里用一次显式读取把类型收窄，而不是把它标成 `any` ——
 * 那样会让后续对这个值的所有使用都失去检查。
 */
function resourcesPath (): string | null {
  const v = (process as unknown as { resourcesPath?: unknown }).resourcesPath
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * 定位并读取装配时写下的 `runtime-manifest.json`。
 *
 * 路径推导（按可靠性排序）：
 *   1. `DSH_PX_RUNTIME_ROOT` —— 外壳可显式注入，最可靠
 *   2. 从本插件自身位置向上找：插件位于
 *      `<runtime>/dsh-home/profiles/<name>/node_modules/<pkg>`，
 *      逐级上溯即可命中含 manifest 的那层
 *   3. `process.resourcesPath/runtime` —— 打包后的 Electron
 *
 * 刻意都做成"找不到就返回 null"：版本信息缺失不该让整个插件加载失败。
 */
function readAppInfo (): AppInfo {
  const empty: AppInfo = { appVersion: null, dshVersion: null, platform: null, manifestPath: null }

  const candidates: string[] = []
  if (process.env.DSH_PX_RUNTIME_ROOT) candidates.push(process.env.DSH_PX_RUNTIME_ROOT)
  const res = resourcesPath()
  if (res !== null) candidates.push(join(res, 'runtime'))

  let here = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i += 1) {
    candidates.push(here)
    const parent = dirname(here)
    if (parent === here) break
    here = parent
  }

  for (const root of candidates) {
    const manifestPath = join(root, 'runtime-manifest.json')
    if (!existsSync(manifestPath)) continue
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        app?: { version?: string }
        dsh?: { version?: string }
        platform?: string
      }
      return {
        // 应用版本来自装配时写入的 manifest —— 这是唯一可靠的来源。
        // 不用 `app.getVersion()`（那是外壳的事，且开发态会返回 Electron 版本）。
        appVersion: m.app?.version ?? null,
        dshVersion: m.dsh?.version ?? null,
        platform: m.platform ?? null,
        manifestPath
      }
    } catch {
      // manifest 存在但读坏了：继续试下一个候选，不要因此让插件加载失败。
    }
  }
  return empty
}

/**
 * 外壳数据目录（`<userData>`）。
 *
 * 只能由外壳告知：插件在 harness 进程里跑，拿不到 Electron 的 `app.getPath()`。
 * 拿不到就返回 null —— 更新状态缺失不该让插件加载失败，更不该抛错。
 */
function shellUserData (): string | null {
  const fromEnv = process.env.DSH_PX_USER_DATA
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null
}

/** 外壳写下的更新状态（字段由外壳的 update-bridge 决定）。 */
interface ShellState {
  phase: string
  status: string
  version: string | null
  percent: number | null
  error: string | null
  available: boolean
}

/**
 * 读外壳写下的更新状态。
 *
 * 文件由外壳**原子写**（先写 .tmp 再 rename），所以这里正常不会读到半截 JSON。
 * 但读到任何异常都返回 null：状态文件是"锦上添花"，不该影响插件可用性。
 */
function readShellState (): ShellState | null {
  const dir = shellUserData()
  if (dir === null) return null
  try {
    const raw = readFileSync(join(dir, 'update-bridge', 'state.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null) return null
    return { ...(parsed as unknown as ShellState), available: true }
  } catch {
    return null
  }
}

/**
 * 向外壳投递一个**动作请求**（写一个文件，外壳轮询并执行）。
 *
 * 界面跑在 harness 的浏览器里，够不到 Electron，因此"重启并安装"、
 * "打开数据目录"、"打开日志目录"这类事只能这样转达。
 *
 * 这里刻意**不**等待外壳的回应（安装会让外壳退出，回应不可能到达），
 * 返回 true 只表示"请求已写入"。
 *
 * @param action 动作名，必须是外壳认识的白名单值
 */
function requestShellAction (action: 'install' | 'check' | 'open-data' | 'open-log'): boolean {
  const dir = shellUserData()
  if (dir === null) return false
  try {
    const bridgeDir = join(dir, 'update-bridge')
    mkdirSync(bridgeDir, { recursive: true })
    writeFileSync(join(bridgeDir, `${action}.req`), `${new Date().toISOString()}\n`)
    return true
  } catch {
    return false
  }
}

/** 带超时的 fetch，避免更新检查把宿主拖住。 */
async function fetchJson (url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { accept: 'application/json', 'user-agent': 'dsh-px-updater' }
    })
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
    return await res.json() as Record<string, unknown>
  } finally {
    clearTimeout(timer)
  }
}

/** `checkUpdates()` 的结构化结果；失败信息放进 `errors`，不抛错。 */
export interface UpdateCheckResult {
  checkedAt: string
  current: { app: string, dsh: string, platform: string }
  latest: { app: string | null, dsh: string | null }
  updateAvailable: { app: boolean, dsh: boolean }
  releaseUrl: string | null
  releaseNotes: string | null
  errors: string[]
}

/**
 * 执行一次更新检查：同时看外壳版本（GitHub Releases）与 dsh 版本（npm）。
 *
 * 为什么两个来源都要看：这个应用有两层独立更新的东西 ——
 * 外壳二进制（GitHub Releases）与随附的 dsh 核心（npm）。
 * 只报其中一个，会让用户以为"已是最新"，而另一层其实落后。
 */
async function checkUpdates (config: UpdaterConfig): Promise<UpdateCheckResult> {
  const info = readAppInfo()
  const result: UpdateCheckResult = {
    checkedAt: new Date().toISOString(),
    current: {
      app: info.appVersion ?? '未知',
      dsh: info.dshVersion ?? '未知',
      platform: info.platform ?? process.platform
    },
    latest: { app: null, dsh: null },
    updateAvailable: { app: false, dsh: false },
    releaseUrl: null,
    releaseNotes: null,
    errors: []
  }

  // 外壳：GitHub Releases
  try {
    const rel = await fetchJson(`https://api.github.com/repos/${config.repository}/releases/latest`, config.timeoutMs)
    if (!isValidVersion(rel.tag_name)) throw new Error('发布页未返回有效版本号')
    result.latest.app = typeof rel.tag_name === 'string' ? rel.tag_name : null
    result.releaseUrl = typeof rel.html_url === 'string' ? rel.html_url : null
    result.releaseNotes = typeof rel.body === 'string' ? rel.body : null
    result.updateAvailable.app = isNewer(rel.tag_name ?? null, info.appVersion)
  } catch (err) {
    result.errors.push(`查询 GitHub Releases 失败：${errText(err)}`)
  }

  // dsh 核心：npm
  try {
    const pkg = await fetchJson('https://registry.npmjs.org/@deepseek-ai%2Fdsh', config.timeoutMs)
    const distTags = pkg['dist-tags'] as Record<string, string> | undefined
    const latest = distTags?.latest ?? null
    if (!isValidVersion(latest)) throw new Error('npm 未返回有效版本号')
    result.latest.dsh = latest
    result.updateAvailable.dsh = isNewer(latest, info.dshVersion)
  } catch (err) {
    result.errors.push(`查询 npm 上的 dsh 版本失败：${errText(err)}`)
  }

  return result
}

/** 把 unknown 的错误变成可读文本（strict 下 catch 变量是 unknown）。 */
function errText (err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 插件入口。
 * @param ctx Cordis 插件上下文
 * @param rawConfig 用户传入的配置（与 {@link DEFAULTS} 合并）
 */
export function apply (ctx: HostPluginContext, rawConfig?: Partial<UpdaterConfig>): void {
  // 自己合并默认值：见 DEFAULTS 上的说明（不引入 schemastery）。
  const config: UpdaterConfig = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const info = readAppInfo()

  /**
   * 插件日志。不假设 logger 的具体形态（不同版本 API 略有差异），
   * 也不让日志失败影响插件加载 —— 但那句"已加载"本身是重要的可观测信号：
   * 没有它就无法区分"插件没加载"和"插件加载了但路由没注册"。
   */
  const say = (msg: string): void => {
    try {
      const sink = ctx.logger?.info ?? ctx.logger?.debug ?? console.log
      sink.call(ctx.logger ?? console, `[dsh-px-updater] ${msg}`)
    } catch { /* 日志失败不该致命 */ }
  }
  say(`已加载（dsh ${info.dshVersion ?? '未知'}，${info.platform ?? process.platform}）`)

  // ── HTTP 端点 ─────────────────────────────────────────────────────────────
  // webServer 用 **inject** 而不是 ctx.get()。
  //
  // 这是踩过的坑：在插件 apply 期间 webServer 可能尚未提供，
  // `ctx.get('webServer')` 会静默拿到 undefined，于是整个路由注册被跳过 ——
  // 而插件本身加载成功、组合树里也有它，表现为"装了但端点 404"，且没有任何报错。
  // `inject` 会等到服务就绪后再执行回调，这才是正确的依赖方式
  // （生态内其他插件如 dshmarket 也是这么写的）。
  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.webServer
    if (webServer?.register === undefined) {
      say('webServer 已注入但没有 register 方法，跳过 HTTP 端点')
      return
    }

    const sendJson = (res: HostResponse, code: number, body: unknown): void => {
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      })
      res.end(JSON.stringify(body, null, 2))
    }

    const disposeStatus = webServer.register({
      kind: 'exact',
      path: `${config.routePrefix}/status`,
      handler: (_req: HostRequest, res: HostResponse) => {
        sendJson(res, 200, {
          plugin: name,
          version: '0.1.0',
          current: { app: info.appVersion, dsh: info.dshVersion, platform: info.platform },
          manifestPath: info.manifestPath,
          repository: config.repository
        })
      }
    })

    const disposeCheck = webServer.register({
      kind: 'exact',
      path: `${config.routePrefix}/check`,
      handler: async (_req: HostRequest, res: HostResponse) => {
        const outcome = await checkUpdates(config)
        // 只有"两个来源都拿不到"才算网关故障；单一来源失败仍返回 200 并附 errors。
        const bothFailed = outcome.errors.length >= 2
        sendJson(res, bothFailed ? 502 : 200, outcome)
      }
    })

    // 版本查询与实际桌面更新是两件事；POST 明确请求外壳检查并重试下载。
    const disposeShellCheck = webServer.register({
      kind: 'exact',
      path: `${config.routePrefix}/check-shell`,
      handler: (req: HostRequest, res: HostResponse) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '只接受 POST' })
          return
        }
        const ok = requestShellAction('check')
        sendJson(res, ok ? 202 : 503, ok
          ? { ok: true, message: '已请求桌面客户端检查更新' }
          : { ok: false, error: '桌面客户端未连接，只能查询版本信息' })
      }
    })

    // ── 外壳状态：更新的真实进度只有外壳知道 ─────────────────────────────────
    //
    // 插件能查"有没有新版"，但**下载进度与"已就绪"只有外壳知道**（下载与安装
    // 必须由 electron-updater 在 Electron 侧做）。外壳把状态写进
    // `<userData>/update-bridge/state.json`，这里读出来转给界面。
    // 界面跑在浏览器里，够不到 Electron，这条路是唯一的通道。
    const disposeShellState = webServer.register({
      kind: 'exact',
      path: `${config.routePrefix}/shell-state`,
      handler: (_req: HostRequest, res: HostResponse) => {
        const bridge = readShellState()
        // 外壳没写（开发态未打包、或应用刚启动）时给一个明确的空状态，
        // 而不是 404：界面只需渲染一次，不必处理两种失败形态。
        sendJson(res, 200, bridge ?? {
          phase: 'idle',
          status: '外壳未提供更新状态（开发态正常）',
          version: null,
          percent: null,
          error: null,
          available: false
        })
      }
    })

    // ── 界面请求"重启并安装" ────────────────────────────────────────────────
    //
    // 界面不能直接替换运行中的 exe，也不该拿到 Electron API。它只表达
    // "用户点了按钮"：这里写一个请求文件，外壳在监听并执行真正的安装。
    // 刻意只接受 POST，且不接受任何参数 —— 减少界面的权限面。
    const disposeInstall = webServer.register({
      kind: 'exact',
      path: `${config.routePrefix}/install`,
      handler: (req: HostRequest, res: HostResponse) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '只接受 POST' })
          return
        }
        const state = readShellState()
        if (state?.phase !== 'ready') {
          sendJson(res, 409, { ok: false, error: '更新尚未下载完成，或安装已在进行中' })
          return
        }
        const ok = requestShellAction('install')
        sendJson(res, ok ? 202 : 503, ok
          ? { ok: true, message: '已请求外壳重启并安装' }
          : { ok: false, error: '找不到外壳数据目录，无法请求安装' })
      }
    })

    // ── 界面请求"打开数据目录 / 日志目录" ───────────────────────────────────
    //
    // 参数是**白名单枚举**，绝不接受任意路径 —— 否则等于把 shell.openPath
    // 暴露给页面，那是不必要的权限面（页面能命令外壳打开任何东西）。
    const disposeOpen = webServer.register({
      kind: 'exact',
      path: `${config.routePrefix}/open`,
      handler: (req: HostRequest, res: HostResponse) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '只接受 POST' })
          return
        }
        // 端点不解析 body（宿主侧给的 req 不一定带 body 读取能力），
        // 因此把目标放在**查询串**里，简单且够用。
        //
        // 显式收窄成字面量联合：正则的捕获组类型是宽松的 `string`，
        // 直接传给只接受白名单枚举的 requestShellAction 过不了严格检查。
        const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
        const raw = params.getAll('what').length === 1 ? params.get('what') : null
        if (raw !== 'open-data' && raw !== 'open-log') {
          sendJson(res, 400, { ok: false, error: 'what 必须是 open-data 或 open-log' })
          return
        }
        const ok = requestShellAction(raw)
        sendJson(res, ok ? 202 : 503, ok
          ? { ok: true, message: `已请求外壳打开${raw === 'open-data' ? '数据目录' : '日志'}` }
          : { ok: false, error: '找不到外壳数据目录' })
      }
    })

    say(`已注册 HTTP 端点 ${config.routePrefix}/{status,check,check-shell,shell-state,install,open}`)

    // 路由注册属于 effect，插件卸载时自动清理 —— 这是 dsh 的约定，
    // 不需要手写 removeRoute。
    hostCtx.effect?.(() => () => {
      disposeStatus()
      disposeCheck()
      disposeShellCheck()
      disposeShellState()
      disposeInstall()
      disposeOpen()
    }, 'dsh-px-updater: http routes')
  })

  // ── 模型可见的工具 ────────────────────────────────────────────────────────
  // 让智能体能自己回答"我是什么版本、有没有新版"，不必让用户去翻界面。
  if (config.registerTool) {
    ctx.inject(['tools'], (toolCtx) => {
      toolCtx.tools?.register({
        name: 'dsh_px_version',
        description:
          '查询当前 DSH-PX 桌面客户端的版本信息，并检查是否有新版本可用（同时检查外壳与随附的 dsh 核心）。',
        // parameters 必须是**标准 JSON Schema**（ToolSchema.parameters 的类型是
        // Record<string, unknown>，由 assertObjectJsonSchema 校验）。
        //
        // 这里曾写错：用了 `{ checkRemote: { type: 'boolean', required: false } }`
        // 这种"属性表"简写 —— 那是 defineTool 的**输入**格式，不是 ToolSchema。
        // JSON Schema 里 `required` 是**根级字符串数组**，不是属性上的布尔值；
        // 传错会让宿主报
        //   Invalid schema for function 'dsh_px_version': schema must be a JSON Schema
        //   of 'type: "object"', got 'type: "null"'
        // 并导致**整轮对话失败**（不只是本工具不可用），代价很大，故把原因写明。
        //
        // 本插件刻意不 import defineTool：见文件顶部说明 —— 自研插件保持零运行时
        // 依赖，避免 pnpm file:/link: 不装 peer 依赖导致的 ERR_MODULE_NOT_FOUND。
        parameters: {
          type: 'object',
          properties: {
            checkRemote: {
              type: 'boolean',
              description: '是否联网查询最新版本。传 false 时只返回本地版本信息。'
            }
          },
          additionalProperties: false
        },
        output: {
          schema: { type: 'string' },
          render: (_args: unknown, value: string) => [{ type: 'text', text: value }]
        },
        async execute (args: { checkRemote?: boolean } | undefined) {
          if (args?.checkRemote === false) {
            return `本地版本：dsh ${info.dshVersion ?? '未知'}（${info.platform ?? process.platform}）`
          }
          const r = await checkUpdates(config)
          const lines = [
            `当前：dsh 核心 ${r.current.dsh}`,
            `最新：外壳 ${r.latest.app ?? '未知'}，dsh ${r.latest.dsh ?? '未知'}`,
            `可更新：外壳 ${r.updateAvailable.app ? '是' : '否'}，dsh 核心 ${r.updateAvailable.dsh ? '是' : '否'}`
          ]
          if (r.releaseUrl !== null) lines.push(`发布页：${r.releaseUrl}`)
          if (r.errors.length > 0) lines.push(`注意：${r.errors.join('；')}`)
          return lines.join('\n')
        }
      })
    })
  }
}
