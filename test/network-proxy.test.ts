import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homeHasProxy, selectProxy } from '../src/main/network-proxy'
import { checkWebAccess } from '../packages/dsh-px-workbench/src/network'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const system = { enabled: true, server: '127.0.0.1:29940', pac: false }
test('系统本机代理接入与显式环境/.env/禁用优先级；不写配置或泄漏代理凭据', () => {
  const selected = selectProxy({}, '', system, 'win32')
  assert.deepEqual(selected.additions, { HTTP_PROXY: 'http://127.0.0.1:29940', HTTPS_PROXY: 'http://127.0.0.1:29940' })
  assert.equal(selected.status.source, 'system')
  assert.equal(selectProxy({}, '', { ...system, server: '127.0.0.1:80' }, 'win32').additions.HTTP_PROXY, 'http://127.0.0.1')
  assert.equal(selectProxy({ HTTPS_PROXY: 'http://secret:password@example.com:80' }, '', system, 'win32').status.source, 'environment')
  assert.equal(selectProxy({ https_proxy: 'socks5://localhost:1' }, '', system, 'win32').status.source, 'environment', '不静默替换显式但不支持的配置')
  assert.deepEqual(selectProxy({}, 'export HTTPS_PROXY="http://secret:password@example.com:80"', system, 'win32').additions, {})
  assert.equal(selectProxy({ DSH_PX_SYSTEM_PROXY: '0' }, '', system, 'win32').status.source, 'disabled')
  assert.equal(selectProxy({}, '', system, 'linux').status.source, 'direct')
  assert.equal(selectProxy({}, '', { ...system, enabled: false }, 'win32').status.source, 'direct')
  const env = { NO_PROXY: 'example.com', no_proxy: 'localhost' }
  assert.deepEqual({ ...env, ...selectProxy(env, '', system, 'win32').additions }, { ...env, ...selected.additions })
  assert.doesNotMatch(JSON.stringify(selectProxy({ HTTPS_PROXY: 'http://secret:password@example.com' }, '', system, 'win32').status), /secret|password|example/)
  assert.equal(homeHasProxy('# HTTPS_PROXY=bad\nAPI_KEY=SECRET\nHTTP_PROXY=""\nHTTPS_PROXY= # placeholder'), false)
  assert.equal(homeHasProxy('https_proxy = http://127.0.0.1:9 # comment'), true)
})
test('系统 PAC、远程、SOCKS、认证和不完整协议映射不被猜测为本机 HTTP 代理', () => {
  for (const server of ['socks5://127.0.0.1:1', 'remote.example:8080', 'http://u:p@127.0.0.1:8', 'http://127.0.0.1:8/path', 'http=127.0.0.1:8', 'https=127.0.0.1:9', '127.0.0.1:0', 'bad']) {
    assert.equal(selectProxy({}, '', { ...system, server }, 'win32').status.source, 'unsupported', server)
  }
  assert.equal(selectProxy({}, '', { ...system, pac: true }, 'win32').status.source, 'unsupported')
  assert.deepEqual(selectProxy({}, '', { ...system, server: 'http=127.0.0.1:8;https=[::1]:9' }, 'win32').additions, { HTTP_PROXY: 'http://127.0.0.1:8', HTTPS_PROXY: 'http://[::1]:9' })
  assert.equal(selectProxy({}, '', null, 'win32').status.source, 'unavailable')
})
test('网页检查使用固定公开目标、传递取消信号、不把 HTTP 失败或空正文算作成功', async () => {
  const urls: string[] = []
  const checked = await checkWebAccess(async (request, signal) => {
    urls.push(request.url); assert.ok(signal instanceof AbortSignal)
    return { statusCode: urls.length === 1 ? 200 : 403, body: { content: 'text' }, truncated: false }
  })
  assert.deepEqual(urls, ['https://nodejs.org/api/test.html', 'https://www.typescriptlang.org/docs/'])
  assert.deepEqual(checked.checks.map(c => c.ok), [true, false])
  const empty = await checkWebAccess(async () => ({ statusCode: 200, body: { content: '' }, truncated: false }))
  assert.ok(empty.checks.every(c => !c.ok))
  const blocked = await checkWebAccess(async () => { throw Object.assign(new Error('private SECRET'), { code: 'WEB_BLOCKED_URL' }) })
  assert.ok(blocked.checks.every(c => !c.ok && c.message.includes('网络策略')))
  assert.doesNotMatch(JSON.stringify(blocked), /SECRET/)
})

test('网页检查路由拒绝外部简单 POST 和自定目标；并发点击合并为同一次检查', async () => {
  const { apply } = await import(pathToFileURL(resolve('packages/dsh-px-workbench/lib/index.js')).href)
  const routes = new Map<string, any>(), cleanups: Array<() => void> = []
  let calls = 0, release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  const host: any = {
    effect: (fn: any) => { cleanups.push(fn()) },
    webServer: { register: (r: any) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } },
    web: { fetch: async () => { calls++; await ready; return { statusCode: 200, body: { content: 'ok' }, truncated: false } } }
  }
  apply({ inject: (_: unknown, fn: any) => fn(host) })
  const handler = routes.get('/dsh-px-workbench/network-check')
  async function request (method: string, headers: Record<string, string> = {}, query = ''): Promise<{ status: number, body: any }> {
    let status = 0, body: any
    await handler({ method, headers, url: '/dsh-px-workbench/network-check' + query }, { writeHead: (s: number) => { status = s }, end: (text: string) => { body = JSON.parse(text) } })
    return { status, body }
  }
  assert.equal((await request('GET')).status, 405)
  assert.equal((await request('POST')).status, 403)
  assert.equal((await request('POST', { 'x-dsh-px-request': '1' }, '?url=http://private')).status, 400)
  assert.equal(calls, 0)
  const first = request('POST', { 'x-dsh-px-request': '1' }), second = request('POST', { 'x-dsh-px-request': '1' })
  assert.equal(calls, 2, '两次 UI 请求只读取固定的两个目标一次')
  release()
  for (const response of await Promise.all([first, second])) { assert.equal(response.status, 200); assert.equal(response.body.checks.length, 2) }
  cleanups.forEach(fn => fn()); assert.equal(routes.size, 0)
})
