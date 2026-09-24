import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { NetworkStatus } from '../../../src/shared/network-status'
import { serviceIdentity } from './layout'
import type { Activity } from './activity'
import { freshHeartbeat, type ShellReceipt } from '../../shared/shell-protocol'

export interface ServiceState {
  phase: 'starting' | 'running' | 'restarting' | 'draining' | 'error' | 'stopped'
  message: string
  updatedAt: string
  pid: number | null
  instanceId?: string
  runtimeMode?: 'packaged' | 'development'
  appVersion?: string
  currentOrigin?: string
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
  serviceId: string | null
  runtime: {
    mode: 'packaged' | 'development' | 'standalone' | 'disconnected'
    owner: 'desktop' | 'standalone'
    shared: true
    capabilities: { restart: boolean; install: boolean }
  }
  activity: Activity
  lastAction: ShellReceipt | null
  pendingOperation: { action: 'quit' | 'restart' | 'install'; message: string; canCancel: boolean } | null
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
  return freshHeartbeat(userData)
}

export function localStatus(
  activity: Activity = { known: false, runningAgents: 0, queuedInputs: 0, runningJobs: 0, openTerminals: 0 }
): LocalStatus {
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
  let lastAction: LocalStatus['lastAction'] = null
  let pendingOperation: LocalStatus['pendingOperation'] = null
  if (service?.instanceId && process.env.DSH_PX_USER_DATA) {
    try {
      const bridge = JSON.parse(
        readFileSync(join(process.env.DSH_PX_USER_DATA, 'update-bridge', 'state.json'), 'utf8')
      )
      if (bridge.instanceId === service.instanceId) {
        if (
          bridge.lastAction?.instanceId === service.instanceId &&
          typeof bridge.lastAction.message === 'string'
        )
          lastAction = bridge.lastAction
        if (
          ['quit', 'restart', 'install'].includes(bridge.pendingOperation?.action) &&
          typeof bridge.pendingOperation.message === 'string'
        )
          pendingOperation = {
            ...bridge.pendingOperation,
            canCancel: bridge.pendingOperation.canCancel === true
          }
      }
    } catch {
      /* Not every standalone or old service has a desktop action bridge. */
    }
  }
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
    network,
    serviceId: home ? serviceIdentity(home) : null,
    runtime: {
      mode: service?.runtimeMode ?? (process.env.DSH_PX_USER_DATA ? 'disconnected' : 'standalone'),
      owner: process.env.DSH_PX_USER_DATA ? 'desktop' : 'standalone',
      shared: true,
      capabilities: {
        restart: service?.phase === 'running',
        install: service?.phase === 'running' && service.runtimeMode === 'packaged'
      }
    },
    activity,
    lastAction,
    pendingOperation
  }
}
