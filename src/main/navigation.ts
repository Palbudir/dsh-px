export type NavigationTarget = 'internal' | 'external' | 'blocked'
export function classifyNavigation(target: string, currentOrigin: string | null): NavigationTarget {
  try {
    const url = new URL(target)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return 'blocked'
    if (currentOrigin && url.origin === new URL(currentOrigin).origin) return 'internal'
    return 'external'
  } catch {
    return 'blocked'
  }
}

/** OS handoff failure is contained; it must not stop the local Agent service. */
export async function openExternalSafely(
  target: string,
  open: (url: string) => Promise<void>,
  report: (message: string) => void
): Promise<boolean> {
  if (classifyNavigation(target, null) === 'blocked') return false
  try {
    await open(target)
    return true
  } catch (error) {
    try {
      report(error instanceof Error ? error.message : String(error))
    } catch {
      /* diagnostic failure is also contained */
    }
    return false
  }
}
