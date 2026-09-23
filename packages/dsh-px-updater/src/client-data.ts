export { RequestError, requestJson } from '../../shared/client-http'
export function checkLabel(
  check: {
    errors: string[]
    latest: { app: string | null; dsh: string | null }
    current: { app: string; dsh: string }
    updateAvailable: { app: boolean; dsh: boolean }
  } | null,
  failed: boolean
): string {
  if (failed) return 'checkFailed'
  if (!check) return 'notChecked'
  if (check.errors.length && !check.latest.app && !check.latest.dsh) return 'checkFailed'
  if (check.updateAvailable.app) return 'available'
  if (
    check.errors.length ||
    !check.latest.app ||
    !check.latest.dsh ||
    check.current.app === '未知' ||
    check.current.dsh === '未知'
  )
    return 'checkIncomplete'
  return 'upToDate'
}

/** 桌面更新结果是整合包能否安装更新的依据，不能被独立的上游查询覆盖。 */
export function desktopCheckLabel(
  shell: { phase: string; version: string | null; lastCheckedAt?: string | null },
  disconnected: boolean
): string {
  if (disconnected) return 'shellDisconnected'
  if (shell.phase === 'error') return 'checkFailed'
  if (shell.phase === 'checking') return 'checking'
  if (['ready', 'downloading', 'installing'].includes(shell.phase)) return 'available'
  // 上次检查时间可能是上次进程保存的记录；必须同时有本次检查返回的版本。
  if (shell.phase === 'idle' && shell.version && shell.lastCheckedAt) return 'upToDate'
  return 'notChecked'
}
