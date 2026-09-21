/** 保留端点返回的具体错误，不把 409/503 当作安装成功。 */
export async function requestJson<T> (path: string, init: RequestInit = {}, allowCheckFailure = false): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(path, { ...init, signal: controller.signal,
      headers: { accept: 'application/json', 'x-dsh-px-request': '1', ...init.headers } })
    const body = await response.json()
    if (!response.ok && !(allowCheckFailure && response.status === 502 && Array.isArray(body?.errors))) {
      throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
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
  if (check.updateAvailable.app || check.updateAvailable.dsh) return 'available'
  if (check.errors.length || !check.latest.app || !check.latest.dsh ||
    check.current.app === '未知' || check.current.dsh === '未知') return 'checkIncomplete'
  return 'upToDate'
}
