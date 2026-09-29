import { localHandler } from './http-fixture'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkWebAccess } from '../packages/dsh-px-workbench/src/network'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

test('网页检查使用固定公开目标、传递取消信号、不把 HTTP 失败或空正文算作成功', async () => {
  const urls: string[] = []
  const checked = await checkWebAccess(async (request, signal) => {
    urls.push(request.url)
    assert.ok(signal instanceof AbortSignal)
    return { statusCode: urls.length === 1 ? 200 : 403, body: { content: 'text' }, truncated: false }
  })
  assert.deepEqual(urls, ['https://nodejs.org/api/test.html', 'https://www.typescriptlang.org/docs/'])
  assert.deepEqual(
    checked.checks.map((c) => c.ok),
    [true, false]
  )
  const empty = await checkWebAccess(async () => ({
    statusCode: 200,
    body: { content: '' },
    truncated: false
  }))
  assert.ok(empty.checks.every((c) => !c.ok))
  const blocked = await checkWebAccess(async () => {
    throw Object.assign(new Error('private SECRET'), { code: 'WEB_BLOCKED_URL' })
  })
  assert.ok(blocked.checks.every((c) => !c.ok && c.message.includes('网络策略')))
  assert.doesNotMatch(JSON.stringify(blocked), /SECRET/)
})

test('网页检查路由拒绝外部简单 POST 和自定目标；并发点击合并为同一次检查', async () => {
  const { apply } = await import(pathToFileURL(resolve('packages/dsh-px-workbench/lib/index.js')).href)
  const routes = new Map<string, any>(),
    cleanups: Array<() => void> = []
  let calls = 0,
    release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  const host: any = {
    effect: (fn: any) => {
      cleanups.push(fn())
    },
    connection: { requestRejection: () => undefined },
    webServer: {
      register: (r: any) => {
        routes.set(r.path, localHandler(r.handler))
        return () => routes.delete(r.path)
      }
    },
    web: {
      fetch: async () => {
        calls++
        await ready
        return { statusCode: 200, body: { content: 'ok' }, truncated: false }
      }
    }
  }
  apply({ inject: (_: unknown, fn: any) => fn(host) })
  const handler = routes.get('/dsh-px-workbench/network-check')
  async function request(
    method: string,
    headers: Record<string, string> = {},
    query = ''
  ): Promise<{ status: number; body: any }> {
    let status = 0,
      body: any
    await handler(
      { method, headers, url: '/dsh-px-workbench/network-check' + query },
      {
        writeHead: (s: number) => {
          status = s
        },
        end: (text: string) => {
          body = JSON.parse(text)
        }
      }
    )
    return { status, body }
  }
  assert.equal((await request('GET')).status, 405)
  assert.equal((await request('POST')).status, 403)
  assert.equal((await request('POST', { 'x-dsh-px-request': '1' }, '?url=http://private')).status, 400)
  assert.equal(calls, 0)
  const first = request('POST', { 'x-dsh-px-request': '1' }),
    second = request('POST', { 'x-dsh-px-request': '1' })
  assert.equal(calls, 2, '两次 UI 请求只读取固定的两个目标一次')
  release()
  for (const response of await Promise.all([first, second])) {
    assert.equal(response.status, 200)
    assert.equal(response.body.checks.length, 2)
  }
  cleanups.forEach((fn) => fn())
  assert.equal(routes.size, 0)
})
