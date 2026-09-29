/** Authenticate only to the exact owned Host; never follow a token-bearing redirect elsewhere. */
export async function harnessFetch(
  cleanUrl: string,
  authenticatedUrl: string,
  path: string,
  init: RequestInit = {},
  request: typeof fetch = fetch
): Promise<Response> {
  const clean = new URL(cleanUrl),
    authenticated = new URL(authenticatedUrl),
    target = new URL(path, clean)
  if (
    clean.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(clean.hostname) ||
    authenticated.origin !== clean.origin ||
    target.origin !== clean.origin ||
    authenticated.username ||
    authenticated.password ||
    target.username ||
    target.password
  )
    throw new Error('拒绝向非归属服务发送认证信息。')
  const login = await request(authenticated, { redirect: 'manual', signal: init.signal })
  if (![302, 303].includes(login.status)) throw new Error('无法取得归属服务的登录会话。')
  const location = login.headers.get('location')
  if (!location || new URL(location, authenticated).origin !== clean.origin)
    throw new Error('服务登录返回了不可信的跳转地址。')
  const cookies = login.headers.getSetCookie().map((cookie) => cookie.split(';', 1)[0])
  if (!cookies.length || cookies.some((cookie) => !/^[^=\s;,]+=[^\r\n;]*$/.test(cookie)))
    throw new Error('服务未返回有效的登录会话。')
  const headers = new Headers(init.headers)
  headers.set('cookie', cookies.join('; '))
  return request(target, { ...init, headers, redirect: 'manual' })
}
