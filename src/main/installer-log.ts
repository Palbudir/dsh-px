import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Outcome of the most recent installer run recorded for one target version. */
export type InstallerOutcome =
  | { state: 'none' }
  | { state: 'installed'; pid: string }
  | { state: 'failed'; pid: string; reason: string }
  | { state: 'incomplete'; pid: string; stage: string }

/**
 * Read the stage trace the PX installer overlay appends per run (`pid=… stage=… [reason=…]`).
 * Older traces carry a meaningless `error=` code instead of a reason; it is ignored.
 * @param text - Complete log text; several runs may share one file.
 * @returns The last run's outcome, judged by its last recorded stage.
 */
export function parseInstallerLog(text: string): InstallerOutcome {
  let last: { pid: string; stage: string; reason: string } | undefined
  for (const line of text.split(/\r?\n/)) {
    const match = /^pid=(\d+) stage=([\w-]+)(?: reason=(.*))?(?: error=-?\d+)?$/.exec(line.trim())
    if (!match) continue
    last = { pid: match[1]!, stage: match[2]!, reason: (match[3] ?? '').trim() }
  }
  if (!last) return { state: 'none' }
  if (last.stage === 'installed') return { state: 'installed', pid: last.pid }
  if (last.stage === 'failed' || last.stage === 'relaunch-available')
    return { state: 'failed', pid: last.pid, reason: last.reason }
  return { state: 'incomplete', pid: last.pid, stage: last.stage }
}

/** The log the installer overlay writes for `version`, below the updater cache directory. */
export function installerLogPath(localAppData: string, version: string): string {
  return join(localAppData, 'dsh-px-desktop-updater', 'installer-logs', `install-${version}.log`)
}

/**
 * User-facing note about a failed previous attempt to install `version`, or undefined when there is none.
 * Reading problems are treated as "no record" so the update window never fails because of diagnostics.
 */
export function previousInstallFailure(
  localAppData: string | undefined,
  version: string | undefined
): string | undefined {
  if (!localAppData || !version || !/^[0-9A-Za-z.+-]+$/.test(version)) return undefined
  let text: string
  try {
    text = readFileSync(installerLogPath(localAppData, version), 'utf8')
  } catch {
    return undefined
  }
  const outcome = parseInstallerLog(text)
  if (outcome.state !== 'failed') return undefined
  return (
    `上次安装 ${version} 未完成` +
    (outcome.reason ? `：${outcome.reason}` : '。') +
    `详细记录见 ${installerLogPath('%LOCALAPPDATA%', version)}`
  )
}
