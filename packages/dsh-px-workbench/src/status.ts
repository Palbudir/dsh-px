import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { NetworkStatus } from '../../../src/shared/network-status'

export interface ServiceState {
  phase: 'starting' | 'running' | 'restarting' | 'error' | 'stopped'
  message: string
  updatedAt: string
  pid: number | null
}
export interface LocalStatus {
  checkedAt: string
  startedAt: string
  node: { version: string; path: string }
  home: string | null
  writable: boolean
  tools: { name: string; path: string | null }[]
  plugins: { name: string; requested: string; version: string | null; enabled: boolean }[]
  profileError: string | null
  credentialsFile: boolean
  service: ServiceState | null
  canRestart: boolean
  network: NetworkStatus | null
}

const startedAt = new Date().toISOString()
export function findCommand(name: string, path = process.env.PATH ?? ''): string | null {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']) {
      const candidate = join(dir.replace(/^"|"$/g, ''), name + ext)
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        /* next */
      }
    }
  }
  return null
}

export function readServiceState(userData = process.env.DSH_PX_USER_DATA): ServiceState | null {
  if (!userData) return null
  try {
    const value = JSON.parse(readFileSync(join(userData, 'service-state.json'), 'utf8')) as ServiceState
    if (
      !['starting', 'running', 'restarting', 'error', 'stopped'].includes(value.phase) ||
      typeof value.message !== 'string' ||
      !Number.isFinite(Date.parse(value.updatedAt))
    )
      return null
    // 心跳过期不能继续显示为“运行正常”。
    if (Date.now() - Date.parse(value.updatedAt) > 15_000) return null
    return value
  } catch {
    return null
  }
}

export function localStatus(): LocalStatus {
  const home = process.env.DSH_HOME ?? null
  const profile = home ? join(home, 'profiles', process.env.DSH_PX_PROFILE ?? 'web') : null
  const plugins: LocalStatus['plugins'] = []
  let profileError: string | null = null
  let writable = false
  if (home) {
    try {
      accessSync(home, constants.W_OK)
      writable = true
    } catch {
      /* reported */
    }
  }
  try {
    if (!profile) throw new Error('未提供 DSH_HOME')
    const pkg = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    for (const [name, requested] of Object.entries(pkg.dependencies ?? {})) {
      // 包名来自本机清单；限制为标准包名，避免将诊断读取扩展到任意路径。
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) continue
      let version: string | null = null
      try {
        version =
          JSON.parse(readFileSync(join(profile, 'node_modules', name, 'package.json'), 'utf8')).version ??
          null
      } catch {
        /* missing */
      }
      plugins.push({
        name,
        requested: String(requested),
        version,
        enabled: pkg.dsh?.profile?.bundles?.includes(name) === true
      })
    }
    readdirSync(profile) // 报告不可读 profile，而不是展示空清单。
  } catch (err) {
    profileError = err instanceof Error ? err.message : String(err)
  }
  const service = readServiceState()
  let network: NetworkStatus | null = null
  try {
    const state = JSON.parse(
      readFileSync(join(process.env.DSH_PX_USER_DATA ?? '', 'network-state.json'), 'utf8')
    )
    if (
      process.env.DSH_PX_USER_DATA &&
      typeof state.message === 'string' &&
      typeof state.source === 'string' &&
      Number.isFinite(Date.parse(state.checkedAt))
    ) {
      network = {
        source: state.source,
        message: state.message,
        checkedAt: state.checkedAt,
        protocols: Array.isArray(state.protocols) ? state.protocols : []
      }
    }
  } catch {
    /* browser-only / old shell */
  }
  return {
    checkedAt: new Date().toISOString(),
    startedAt,
    node: { version: process.version, path: process.execPath },
    home,
    writable,
    tools: ['git', 'pnpm'].map((name) => ({ name, path: findCommand(name) })),
    plugins,
    profileError,
    credentialsFile: Boolean(home && existsSync(join(home, '.credentials.yaml'))),
    service,
    canRestart: service?.phase === 'running',
    network
  }
}
