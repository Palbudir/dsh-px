import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

test('真实宿主产物路由：检查请求、安装状态门禁、打开目标精确匹配与清理', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpx-routes-'))
  const previous = process.env.DSH_PX_USER_DATA
  const previousRuntime = process.env.DSH_PX_RUNTIME_ROOT
  process.env.DSH_PX_USER_DATA = dir
  process.env.DSH_PX_RUNTIME_ROOT = dir
  writeFileSync(join(dir, 'runtime-manifest.json'), JSON.stringify({ app: { version: '0.1.0-beta.re.0.5' }, dsh: { version: '0.1.5-rc.2' } }))
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_PX_USER_DATA
    else process.env.DSH_PX_USER_DATA = previous
    if (previousRuntime === undefined) delete process.env.DSH_PX_RUNTIME_ROOT
    else process.env.DSH_PX_RUNTIME_ROOT = previousRuntime
    rmSync(dir, { recursive: true, force: true })
  })
  type Handler = (req: { method: string, url: string }, res: { writeHead: (code: number) => void, end: (body: string) => void }) => Promise<void> | void
  const routes = new Map<string, Handler>()
  let dispose: (() => void) | undefined
  const mod = await import(pathToFileURL(resolve('packages/dsh-px-updater/lib/index.js')).href)
  mod.apply({
    logger: { info: () => {} },
    inject: (_: string[], callback: (ctx: unknown) => void) => callback({
      webServer: { register: (route: { path: string, handler: Handler }) => {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      } },
      effect: (fn: () => () => void) => { dispose = fn() }
    })
  }, { registerTool: false })
  async function request (path: string, method = 'POST') {
    let status = 0
    let body: Record<string, unknown> = {}
    await routes.get(`/dsh-px-updater/${path.split('?')[0]}`)?.({ method, url: `/dsh-px-updater/${path}` }, {
      writeHead: (code) => { status = code }, end: (value) => { body = JSON.parse(value) }
    })
    return { status, body }
  }
  assert.equal((await request('check-shell', 'GET')).status, 405)
  assert.equal((await request('check-shell')).status, 202)
  assert.ok(existsSync(join(dir, 'update-bridge/check.req')))
  assert.equal((await request('install')).status, 409)
  assert.equal(existsSync(join(dir, 'update-bridge/install.req')), false)
  mkdirSync(join(dir, 'update-bridge'), { recursive: true })
  writeFileSync(join(dir, 'update-bridge/state.json'), JSON.stringify({ phase: 'ready' }))
  assert.equal((await request('install')).status, 202)
  assert.ok(existsSync(join(dir, 'update-bridge/install.req')))
  writeFileSync(join(dir, 'update-bridge/state.json'), JSON.stringify({ phase: 'installing' }))
  assert.equal((await request('install')).status, 409)
  for (const value of ['open-data/extra', 'open-log.bad', '../file', 'open-data&what=open-log']) {
    assert.equal((await request(`open?what=${value}`)).status, 400, value)
  }
  assert.equal((await request('open?what=open-data')).status, 202)
  assert.equal((await request('open?what=open-log')).status, 202)
  t.mock.method(globalThis, 'fetch', async (url: string) => new Response(JSON.stringify(url.includes('github')
    ? { tag_name: 'v0.1.0-beta.re.0.6' } : { 'dist-tags': { latest: '0.1.5-rc.3' } })))
  const complete = await request('check', 'GET')
  assert.equal(complete.status, 200)
  assert.deepEqual(complete.body.updateAvailable, { app: true, dsh: true })
  t.mock.method(globalThis, 'fetch', async (url: string) => new Response(JSON.stringify(url.includes('github')
    ? { tag_name: 'v0.1.0-beta.re.0.6' } : { 'dist-tags': { latest: 'invalid' } })))
  const partial = await request('check', 'GET')
  assert.equal(partial.status, 200)
  assert.match(String(partial.body.errors), /npm 未返回有效版本号/)
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  const failed = await request('check', 'GET')
  assert.equal(failed.status, 502)
  assert.match(String(failed.body.errors), /GitHub Releases/)
  assert.match(String(failed.body.errors), /npm/)
  delete process.env.DSH_PX_USER_DATA
  assert.equal((await request('check-shell')).status, 503)
  dispose?.()
  assert.equal(routes.size, 0)
})
