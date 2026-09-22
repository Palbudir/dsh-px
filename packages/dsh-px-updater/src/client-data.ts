export class RequestError extends Error {
  constructor (message: string, readonly status: number, readonly code?: string, readonly retryable = true) { super(message); this.name = 'RequestError' }
}
/** 保留端点返回的具体错误，不把 409/503 当作安装成功。 */
export async function requestJson<T> (path: string, init: RequestInit = {}, allowCheckFailure = false): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(path, { ...init, signal: controller.signal,
      headers: { accept: 'application/json', 'x-dsh-px-request': '1', ...init.headers } })
    const body = await response.json()
    if (!response.ok && !(allowCheckFailure && response.status === 502 && Array.isArray(body?.errors))) {
      throw new RequestError(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`, response.status,
        typeof body?.code === 'string' ? body.code : undefined, typeof body?.retryable === 'boolean' ? body.retryable : response.status >= 500)
    }
    return body as T
  } catch (error) {
    if (controller.signal.aborted) throw new Error('请求超时，请重试')
    if (error instanceof TypeError && /fetch|network/i.test(error.message)) throw new Error('无法连接服务，请检查网络后重试')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function checkLabel (check: {
  errors: string[]
  latest: { app: string | null, dsh: string | null }
  current: { app: string, dsh: string }
  updateAvailable: { app: boolean, dsh: boolean }
} | null, failed: boolean): string {
  if (failed) return 'checkFailed'
  if (!check) return 'notChecked'
  if (check.errors.length && !check.latest.app && !check.latest.dsh) return 'checkFailed'
  if (check.updateAvailable.app) return 'available'
  if (check.errors.length || !check.latest.app || !check.latest.dsh ||
    check.current.app === '未知' || check.current.dsh === '未知') return 'checkIncomplete'
  return 'upToDate'
}

/** 桌面更新结果是整合包能否安装更新的依据，不能被独立的上游查询覆盖。 */
export function desktopCheckLabel (shell: { phase: string, version: string | null, lastCheckedAt?: string | null }, disconnected: boolean): string {
  if (disconnected) return 'shellDisconnected'
  if (shell.phase === 'error') return 'checkFailed'
  if (shell.phase === 'checking') return 'checking'
  if (['ready', 'downloading', 'installing'].includes(shell.phase)) return 'available'
  // 上次检查时间可能是上次进程保存的记录；必须同时有本次检查返回的版本。
  if (shell.phase === 'idle' && shell.version && shell.lastCheckedAt) return 'upToDate'
  return 'notChecked'
}
