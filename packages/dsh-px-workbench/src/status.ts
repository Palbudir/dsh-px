import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
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

/** The running profile as reported by the host's `profileContext` service (present in dsh-launched profiles). */
export interface RunningProfile {
  name: string
  dir: string
}

/**
 * Resolve the profile this host runs. The host's `profileContext` is authoritative; without it the only
 * safe inference is a home with exactly one installed profile. Otherwise the profile is unknown.
 */
function profileDirectory(home: string, running: RunningProfile | undefined): string | null {
  if (running && isAbsolute(running.dir)) return running.dir
  const profiles = join(home, 'profiles')
  let names: string[] = []
  try {
    names = readdirSync(profiles).filter((name) => existsSync(join(profiles, name, 'package.json')))
  } catch {
    /* no profiles directory */
  }
  return names.length === 1 ? join(profiles, names[0]) : null
}

export function localStatus(
  activity: Activity = { known: false, runningAgents: 0, queuedInputs: 0, runningJobs: 0, openTerminals: 0 },
  running?: RunningProfile
): LocalStatus {
  const home = process.env.DSH_HOME ?? null
  const profile = home ? profileDirectory(home, running) : null
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
    if (!home) throw new Error('未提供 DSH_HOME')
    if (!profile) throw new Error('宿主未提供当前 Profile，且数据目录中不止一个 Profile，无法确定插件清单')
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
