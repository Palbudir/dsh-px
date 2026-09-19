/**
 * dsh-px 更新插件。
 *
 * 存在的理由：把"检查更新"做成 **dsh 生态内的正式组合包**，而不是只藏在外壳里。
 * 这样它天然获得插件该有的一切 —— 可配置、可热重载、可被其他插件消费、
 * 出错时按 dsh 的方式报告，而不是变成只有外壳知道的私有逻辑。
 *
 * 职责边界（刻意划清，避免和外壳重复造轮子）：
 *   - **本插件**：告诉你"现在是什么版本、有没有更新、更新了什么"，
 *     并暴露 HTTP 端点与模型工具供人与智能体查询。
 *   - **外壳**：真正的下载与安装。Electron 侧用 electron-updater，
 *     它自带差分下载（blockmap）、sha512 校验与失败回滚。
 *     本插件**不碰**安装 —— 在一个正在运行的 exe 上做文件替换是外壳的活，
 *     插件去做只会更脆弱。
 *
 * 一句话：插件负责"知情"，外壳负责"动手"。
 *
 * 本文件是**纯 ESM JavaScript**（无 TypeScript 语法），与 dsh 官方随附插件的
 * 交付形态一致 —— 它们同样是直接可 import 的 JS，不需要构建步骤。
 *
 * @module dsh-px-updater
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis 插件名（用于 loader 诊断）。 */
export const name = 'dsh-px-updater'

/**
 * 不声明必需 inject：本插件是**可选增强**，缺少 webServer 时也应当能加载。
 * 真正的依赖用 `ctx.inject([...])` 在用到的地方声明。
 */
export const inject = []

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
export const DEFAULTS = {
  repository: 'Palbudir/dsh-px',
  timeoutMs: 8000,
  registerTool: true,
  routePrefix: '/dsh-px-updater'
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
 * @returns {{appVersion: string|null, dshVersion: string|null, platform: string|null, manifestPath: string|null}}
 */
function readAppInfo () {
  const empty = { appVersion: null, dshVersion: null, platform: null, manifestPath: null }

  const candidates = []
  if (process.env.DSH_PX_RUNTIME_ROOT) candidates.push(process.env.DSH_PX_RUNTIME_ROOT)
  if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'runtime'))

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
      const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
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

/** 带超时的 fetch，避免更新检查把宿主拖住。 */
async function fetchJson (url, timeoutMs) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { accept: 'application/json', 'user-agent': 'dsh-px-updater' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 把 'v1.2.3' / '1.2.3' 归一化后做朴素比较；不追求完整 semver 语义。 */
function parseVersion (v) {
  if (!v) return null
  const m = String(v).trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function isNewer (candidate, current) {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}

/**
 * 执行一次更新检查：同时看外壳版本（GitHub Releases）与 dsh 版本（npm）。
 *
 * 为什么两个来源都要看：这个应用有两层独立更新的东西 ——
 * 外壳二进制（GitHub Releases）与随附的 dsh 核心（npm）。
 * 只报其中一个，会让用户以为"已是最新"，而另一层其实落后。
 * @param {{repository: string, timeoutMs: number}} config
 * @returns {Promise<object>} 结构化结果；失败信息放进 errors，不抛错
 */
async function checkUpdates (config) {
  const info = readAppInfo()
  const result = {
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
    result.latest.app = rel?.tag_name ?? null
    result.releaseUrl = rel?.html_url ?? null
    result.releaseNotes = rel?.body ?? null
    result.updateAvailable.app = isNewer(rel?.tag_name ?? null, info.appVersion)
  } catch (err) {
    result.errors.push(`查询 GitHub Releases 失败：${err?.message ?? err}`)
  }

  // dsh 核心：npm
  try {
    const pkg = await fetchJson('https://registry.npmjs.org/@deepseek-ai%2Fdsh', config.timeoutMs)
    const latest = pkg?.['dist-tags']?.latest ?? null
    result.latest.dsh = latest
    result.updateAvailable.dsh = isNewer(latest, info.dshVersion)
  } catch (err) {
    result.errors.push(`查询 npm 上的 dsh 版本失败：${err?.message ?? err}`)
  }

  return result
}

/**
 * 插件入口。
 * @param {any} ctx Cordis 上下文
 * @param {{repository: string, timeoutMs: number, registerTool: boolean, routePrefix: string}} config 已校验的配置
 */
/**
 * 插件入口。
 * @param {any} ctx Cordis 上下文
 * @param {object} rawConfig 用户传入的配置（与 {@link DEFAULTS} 合并）
 */
export function apply (ctx, rawConfig) {
  // 自己合并默认值：见 DEFAULTS 上的说明（不引入 schemastery）。
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const info = readAppInfo()
  /**
   * 插件日志。不假设 logger 的具体形态（不同版本 API 略有差异），
   * 也不让日志失败影响插件加载 —— 但那句"已加载"本身是重要的可观测信号：
   * 没有它就无法区分"插件没加载"和"插件加载了但路由没注册"。
   */
  const say = (msg) => {
    try {
      const sink = ctx.logger?.info ?? ctx.logger?.debug ?? console.log
      sink.call(ctx.logger ?? console, `[dsh-px-updater] ${msg}`)
    } catch { /* 日志失败不该致命 */ }
  }
  say(`已加载（dsh ${info.dshVersion ?? '未知'}，${info.platform ?? process.platform}）`)

  // ── HTTP 端点：`<prefix>/status` 与 `<prefix>/check` ──────────────────────
  // webServer 用 **inject** 而不是 ctx.get()。
  //
  // 这是本次踩到的坑：在插件 apply 期间 webServer 可能尚未提供，
  // `ctx.get('webServer')` 会静默拿到 undefined，于是整个路由注册被跳过 ——
  // 而插件本身加载成功、组合树里也有它，表现为"装了但端点 404"，且没有任何报错。
  // `inject` 会等到服务就绪后再执行回调，这才是正确的依赖方式
  // （生态内其他插件如 dshmarket 也是这么写的）。
  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.webServer
    if (!webServer?.register) {
      say('webServer 已注入但没有 register 方法，跳过 HTTP 端点')
      return
    }

    const sendJson = (res, code, body) => {
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      })
      res.end(JSON.stringify(body, null, 2))
    }

    const disposeStatus = webServer.register({
      kind: 'exact',
      path: `${config.routePrefix}/status`,
      handler: (_req, res) => {
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
      handler: async (_req, res) => {
        const outcome = await checkUpdates(config)
        // 只有"两个来源都拿不到"才算网关故障；单一来源失败仍返回 200 并附 errors。
        const bothFailed = outcome.errors.length >= 2
        sendJson(res, bothFailed ? 502 : 200, outcome)
      }
    })

    say(`已注册 HTTP 端点 ${config.routePrefix}/status 与 ${config.routePrefix}/check`)

    // 路由注册属于 effect，插件卸载时自动清理 —— 这是 dsh 的约定，
    // 不需要手写 removeRoute。
    hostCtx.effect?.(() => () => {
      disposeStatus()
      disposeCheck()
    }, 'dsh-px-updater: http routes')
  })

  // ── 模型可见的工具 ────────────────────────────────────────────────────────
  // 让智能体能自己回答"我是什么版本、有没有新版"，不必让用户去翻界面。
  if (config.registerTool) {
    ctx.inject(['tools'], (toolCtx) => {
      toolCtx.tools.register({
        name: 'dsh_px_version',
        description:
          '查询当前 DSH-PX 桌面客户端的版本信息，并检查是否有新版本可用（同时检查外壳与随附的 dsh 核心）。',
        parameters: {
          checkRemote: {
            type: 'boolean',
            required: false,
            description: '是否联网查询最新版本。传 false 时只返回本地版本信息。'
          }
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }]
        },
        async execute (args) {
          if (args?.checkRemote === false) {
            return `本地版本：dsh ${info.dshVersion ?? '未知'}（${info.platform ?? process.platform}）`
          }
          const r = await checkUpdates(config)
          const lines = [
            `当前：dsh 核心 ${r.current.dsh}`,
            `最新：外壳 ${r.latest.app ?? '未知'}，dsh ${r.latest.dsh ?? '未知'}`,
            `可更新：外壳 ${r.updateAvailable.app ? '是' : '否'}，dsh 核心 ${r.updateAvailable.dsh ? '是' : '否'}`
          ]
          if (r.releaseUrl) lines.push(`发布页：${r.releaseUrl}`)
          if (r.errors.length) lines.push(`注意：${r.errors.join('；')}`)
          return lines.join('\n')
        }
      })
    })
  }
}
