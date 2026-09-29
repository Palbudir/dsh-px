export { RequestError, requestJson } from '../../shared/client-http'

/** A failed or unverified check never displays "up to date". */
export function checkLabel(
  check: { error: string | null; latest: { pack: string | null }; updateAvailable: boolean } | null,
  failed: boolean
): 'checkFailed' | 'notChecked' | 'available' | 'upToDate' {
  if (failed) return 'checkFailed'
  if (!check) return 'notChecked'
  if (check.error !== null || !check.latest.pack) return 'checkFailed'
  return check.updateAvailable ? 'available' : 'upToDate'
}

/** Only this repository's Pack release pages are actionable links. */
export function safeReleaseUrl(value: string, repository?: string): boolean {
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname.startsWith(`/${repository}/releases/tag/pack-v`)
    )
  } catch {
    return false
  }
}
