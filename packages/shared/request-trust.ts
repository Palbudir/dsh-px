interface Request {
  headers?: Record<string, string | string[] | undefined>
}
interface Response {
  writeHead: (status: number, headers: Record<string, string>) => unknown
  end: (body: string) => unknown
}
/** Public DSH Connection contract, present in both pinned 0.1 and 0.2 hosts. */
export interface HostAuthentication {
  requestRejection(request: { headers: Record<string, string | string[] | undefined> }): 401 | 403 | undefined
}

/** Keep authentication with the host instead of treating loopback access as a login. */
export function rejectUnauthenticatedRequest(
  req: Request,
  res: Response,
  connection: HostAuthentication | undefined
): boolean {
  const rejection = connection?.requestRejection({ headers: req.headers ?? {} })
  if (!connection || rejection !== undefined) {
    res.writeHead(connection ? rejection! : 503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    res.end(
      JSON.stringify({
        code: connection ? 'HOST_AUTH_REQUIRED' : 'HOST_AUTH_UNAVAILABLE',
        error: '请通过宿主提供的登录入口连接此服务。'
      })
    )
    return true
  }
  return rejectUntrustedRequest(req, res)
}
/** Local browser-origin/DNS-rebinding fence, matching the bundled DSH deployment.
 * This is not account authentication: trusted local non-browser callers remain supported.
 */
export function trustedLocalRequest(req: Request): boolean {
  const headers = req.headers ?? {},
    host = headers.host,
    origin = headers.origin
  if (typeof host !== 'string' || headers['sec-fetch-site'] === 'cross-site') return false
  try {
    const target = new URL('http://' + host)
    if (target.username || target.password || target.pathname !== '/' || target.search || target.hash)
      return false
    const parts = target.hostname.split('.')
    const loopback =
      target.hostname === 'localhost' ||
      target.hostname === '[::1]' ||
      (parts.length === 4 &&
        parts[0] === '127' &&
        parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255))
    if (!loopback) return false
    if (origin === undefined) return true
    if (typeof origin !== 'string') return false
    const source = new URL(origin)
    // Edge may omit the port in Origin. A present, different port is not ours.
    return (
      ['http:', 'https:'].includes(source.protocol) &&
      source.hostname === target.hostname &&
      (!source.port || source.port === target.port)
    )
  } catch {
    return false
  }
}
export function rejectUntrustedRequest(req: Request, res: Response): boolean {
  if (trustedLocalRequest(req)) return false
  res.writeHead(403, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(
    JSON.stringify({
      code: 'UNTRUSTED_REQUEST',
      error: '此请求的来源不受信任，请从本机 DSH-PX 界面重试。',
      retryable: false
    })
  )
  return true
}
