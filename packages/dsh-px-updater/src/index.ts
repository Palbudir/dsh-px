/**
 * Pack version and signed Pack update notice exposed through the native DSH plugin host.
 *
 * The Desktop application (official-derived or the unmodified official client) owns its own
 * updater, windows and data folders. This plugin does not pretend to control them: it reports the
 * Pack it belongs to and checks the signed Pack feed. Installation stays with the native plugin
 * manager; nothing is downloaded or installed here.
 */
import { rejectUnauthenticatedRequest as rejectUntrustedRequest } from '../../shared/request-trust'
import { fetchMetadataText } from './metadata'
import { evaluatePackFeed, PACK_FEED_URL, type PackCheck } from './pack-feed'

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HostPluginContext, HostRequest, HostResponse } from '@deepseek-ai/cordis'
import packageInfo from '../package.json'

/** Cordis 插件名（用于 loader 诊断）。 */
export const name = 'dsh-px-updater'

/** 可选增强：缺少 webServer 时也能加载；依赖在使用处 `ctx.inject` 声明。 */
export const inject: string[] = []

export interface UpdaterConfig {
  repository: string
  timeoutMs: number
  registerTool: boolean
  routePrefix: string
  feedUrl: string
}

export const DEFAULTS: UpdaterConfig = {
  repository: 'Palbudir/dsh-px',
  timeoutMs: 8000,
  registerTool: true,
  routePrefix: '/dsh-px-updater',
  feedUrl: PACK_FEED_URL
}

/** The enclosing native Pack manifest as installed, or null when running outside a Pack. */
export interface PackIdentity {
  version: string | null
  hostVersion: string | null
  upstreamCommit: string | null
  candidate: boolean | null
  manifestPath: string | null
}

/**
 * Find the `dsh-px-pack` package that bundles this plugin by walking up from the plugin file.
 * These values are the Pack's own declaration, not a measurement of the running host.
 */
export function readPackIdentity(start = dirname(fileURLToPath(import.meta.url))): PackIdentity {
  const empty: PackIdentity = {
    version: null,
    hostVersion: null,
    upstreamCommit: null,
    candidate: null,
    manifestPath: null
  }
  let here = start
  for (let i = 0; i < 8; i += 1) {
    const manifestPath = join(here, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          name?: unknown
          version?: unknown
          dshPx?: { hostVersion?: unknown; upstreamCommit?: unknown; candidate?: unknown }
        }
        if (m.name === 'dsh-px-pack')
          return {
            version: typeof m.version === 'string' ? m.version : null,
            hostVersion: typeof m.dshPx?.hostVersion === 'string' ? m.dshPx.hostVersion : null,
            upstreamCommit: typeof m.dshPx?.upstreamCommit === 'string' ? m.dshPx.upstreamCommit : null,
            candidate: typeof m.dshPx?.candidate === 'boolean' ? m.dshPx.candidate : null,
            manifestPath
          }
      } catch {
        /* An unreadable manifest is reported as an unknown Pack, never as a failure to load. */
      }
    }
    const parent = dirname(here)
    if (parent === here) break
    here = parent
  }
  return empty
}

export async function checkPackUpdates(config: UpdaterConfig): Promise<PackCheck> {
  try {
    return evaluatePackFeed(await fetchMetadataText(config.feedUrl, config.timeoutMs), packageInfo.version)
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      current: { pack: packageInfo.version },
      latest: { pack: null, hostVersion: null, issuedAt: null },
      updateAvailable: false,
      releaseUrl: null,
      install: 'manual',
      error: `无法读取 Pack 更新清单：${errText(error)}`
    }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function apply(ctx: HostPluginContext, rawConfig?: Partial<UpdaterConfig>): void {
  const config: UpdaterConfig = { ...DEFAULTS, ...(rawConfig ?? {}) }
  // The signed feed, its release repository and the route the bundled client calls are fixed:
  // a profile setting must not point checks elsewhere or move routes away from the client.
  config.feedUrl = DEFAULTS.feedUrl
  config.repository = DEFAULTS.repository
  config.routePrefix = DEFAULTS.routePrefix
  const pack = readPackIdentity()

  const say = (msg: string): void => {
    try {
      const sink = ctx.logger?.info ?? ctx.logger?.debug ?? console.log
      sink.call(ctx.logger ?? console, `[dsh-px-updater] ${msg}`)
    } catch {
      /* 日志失败不该致命 */
    }
  }
  say(`已加载（Pack ${pack.version ?? packageInfo.version}，${process.platform}）`)

  ctx.inject(['connection', 'webServer'], (hostCtx) => {
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
      handler: (req: HostRequest, res: HostResponse) => {
        if (rejectUntrustedRequest(req, res, hostCtx.connection)) return
        // Only what the client shows; the manifest path is a local machine path and stays private.
        sendJson(res, 200, {
          plugin: name,
          version: packageInfo.version,
          pack: { version: pack.version, hostVersion: pack.hostVersion, candidate: pack.candidate },
          platform: process.platform,
          feed: config.feedUrl,
          repository: config.repository
        })
      }
    })

    const disposeCheck = webServer.register({
      kind: 'exact',
      path: `${config.routePrefix}/check`,
      handler: async (req: HostRequest, res: HostResponse) => {
        if (rejectUntrustedRequest(req, res, hostCtx.connection)) return
        // A failed feed check is a normal result the client displays, not a transport failure.
        sendJson(res, 200, await checkPackUpdates(config))
      }
    })

    say(`已注册 HTTP 端点 ${config.routePrefix}/{status,check}`)
    hostCtx.effect?.(
      () => () => {
        disposeStatus()
        disposeCheck()
      },
      'dsh-px-updater: http routes'
    )
  })

  if (config.registerTool) {
    ctx.inject(['tools'], (toolCtx) => {
      toolCtx.tools?.register({
        name: 'dsh_px_version',
        description:
          '查询当前 DSH-PX Pack 的版本，并通过签名更新清单检查是否有新的 Pack 预览版本（只提示，不自动安装；桌面客户端更新由客户端自身负责）。',
        // Standard JSON Schema: `required` is a root-level array, never a per-property boolean.
        parameters: {
          type: 'object',
          properties: {
            checkRemote: {
              type: 'boolean',
              description: '是否联网查询签名更新清单。传 false 时只返回本地版本信息。'
            }
          },
          additionalProperties: false
        },
        output: {
          schema: { type: 'string' },
          render: (_args: unknown, value: string) => [{ type: 'text', text: value }]
        },
        async execute(args: { checkRemote?: boolean } | undefined) {
          const local = `当前：Pack ${packageInfo.version}（声明宿主 ${pack.hostVersion ?? '未知'}，${process.platform}）`
          if (args?.checkRemote === false) return local
          const r = await checkPackUpdates(config)
          const lines = [local]
          if (r.error !== null) lines.push(`检查失败：${r.error}`)
          else {
            lines.push(`已签名的最新 Pack：${r.latest.pack}`)
            lines.push(`可更新：${r.updateAvailable ? '是（请通过插件管理器手动安装）' : '否'}`)
            if (r.releaseUrl !== null) lines.push(`发布页：${r.releaseUrl}`)
          }
          return lines.join('\n')
        }
      })
    })
  }
}
