import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { serviceIdentity } from './layout'
import type { Activity } from './activity'

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
  serviceId: string | null
  runtime: {
    /** The native host owns process lifecycle, restarts and updates; the Pack never controls them. */
    mode: 'native'
    owner: 'native-host'
    shared: true
    capabilities: { restart: false; install: false }
  }
  activity: Activity
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

/** Native profiles are named after the host surface; read the installed Pack's profile when known. */
function profileDirectory(home: string): string {
  const requested = process.env.DSH_PX_PROFILE
  if (requested && /^[\w.-]+$/.test(requested)) return join(home, 'profiles', requested)
  for (const name of ['desktop', 'web']) {
    const candidate = join(home, 'profiles', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return join(home, 'profiles', 'web')
}

export function localStatus(
  activity: Activity = { known: false, runningAgents: 0, queuedInputs: 0, runningJobs: 0, openTerminals: 0 }
): LocalStatus {
  const home = process.env.DSH_HOME ?? null
  const profile = home ? profileDirectory(home) : null
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
    serviceId: home ? serviceIdentity(home) : null,
    runtime: {
      mode: 'native',
      owner: 'native-host',
      shared: true,
      capabilities: { restart: false, install: false }
    },
    activity
  }
}
