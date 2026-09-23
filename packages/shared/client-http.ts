export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryable = true
  ) {
    super(message)
    this.name = 'RequestError'
  }
}
/** 保留端点返回的具体错误，不把 409/503 当作安装成功。 */
export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  allowCheckFailure = false
): Promise<T> {
  const controller = new AbortController()
  const caller = init.signal
  const cancel = (): void => controller.abort(caller?.reason)
  if (caller?.aborted) cancel()
  else caller?.addEventListener('abort', cancel, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 20000)
  try {
    const headers = new Headers(init.headers)
    if (!headers.has('accept')) headers.set('accept', 'application/json')
    headers.set('x-dsh-px-request', '1')
    const response = await fetch(path, { ...init, signal: controller.signal, headers })
    let body: any
    try {
      body = await response.json()
    } catch {
      throw new RequestError(
        `服务返回了无法读取的响应（HTTP ${response.status}），请重新连接或检查日志。`,
        response.status || 502,
        'INVALID_RESPONSE',
        response.status >= 500 || response.ok
      )
    }
    if (!response.ok && !(allowCheckFailure && response.status === 502 && Array.isArray(body?.errors))) {
      throw new RequestError(
        typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`,
        response.status,
        typeof body?.code === 'string' ? body.code : undefined,
        typeof body?.retryable === 'boolean' ? body.retryable : response.status >= 500
      )
    }
    return body as T
  } catch (error) {
    if (timedOut)
      throw new Error(
        init.method && init.method !== 'GET'
          ? '请求超时，请先刷新记录确认结果，避免重复操作。'
          : '请求超时，请重试'
      )
    if (caller?.aborted) throw caller.reason ?? new DOMException('请求已取消', 'AbortError')
    if (error instanceof TypeError && /fetch|network/i.test(error.message))
      throw new Error('无法连接服务，请检查网络后重试')
    throw error
  } finally {
    clearTimeout(timer)
    caller?.removeEventListener('abort', cancel)
  }
}
