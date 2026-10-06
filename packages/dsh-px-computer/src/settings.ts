/** Computer-use settings, persisted under the DSH home. Everything starts disabled. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { BROWSER_MODES, type BrowserMode } from './browser'

export interface AllowedApp {
  key: string
  label: string
}
export interface ComputerSettings {
  schemaVersion: 1
  revision: number
  desktop: boolean
  browser: 'off' | BrowserMode
  headless: boolean
  alwaysAllowApps: AllowedApp[]
  alwaysAllowSites: string[]
}

export const DEFAULT_SETTINGS: ComputerSettings = {
  schemaVersion: 1,
  revision: 0,
  desktop: false,
  browser: 'off',
  headless: false,
  alwaysAllowApps: [],
  alwaysAllowSites: []
}

export class SettingsError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

function valid(value: any): value is ComputerSettings {
  return (
    value?.schemaVersion === 1 &&
    Number.isInteger(value.revision) &&
    value.revision >= 0 &&
    typeof value.desktop === 'boolean' &&
    (value.browser === 'off' || BROWSER_MODES.includes(value.browser)) &&
    typeof value.headless === 'boolean' &&
    Array.isArray(value.alwaysAllowApps) &&
    value.alwaysAllowApps.length <= 200 &&
    value.alwaysAllowApps.every((app: any) => text(app?.key, 300) && text(app?.label, 300)) &&
    Array.isArray(value.alwaysAllowSites) &&
    value.alwaysAllowSites.length <= 200 &&
    value.alwaysAllowSites.every((site: unknown) => text(site, 253))
  )
}

export class SettingsStore {
  private current: ComputerSettings | undefined
  private readonly listeners = new Set<(settings: ComputerSettings) => void>()

  constructor(private readonly file: string) {}

  read(): ComputerSettings {
    if (this.current) return this.current
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (error: any) {
      // A missing file is the normal first run; a corrupt one also falls back to everything off.
      parsed = error?.code === 'ENOENT' ? DEFAULT_SETTINGS : undefined
    }
    this.current = valid(parsed) ? parsed : { ...DEFAULT_SETTINGS }
    return this.current
  }

  /** Apply one change against the revision the caller saw. */
  change(revision: unknown, edit: (next: ComputerSettings) => void): ComputerSettings {
    const current = this.read()
    if (revision !== current.revision) throw new SettingsError('设置已在其他窗口修改，请刷新后再试', 409)
    const next: ComputerSettings = structuredClone(current)
    edit(next)
    next.revision = current.revision + 1
    if (!valid(next)) throw new SettingsError('设置无效')
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n')
    renameSync(temporary, this.file)
    this.current = next
    for (const listener of this.listeners) listener(next)
    return next
  }

  subscribe(listener: (settings: ComputerSettings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  alwaysAllowsApp(key: string): boolean {
    return this.read().alwaysAllowApps.some((app) => app.key === key)
  }

  alwaysAllowsSite(site: string): boolean {
    return this.read().alwaysAllowSites.includes(site)
  }
}
