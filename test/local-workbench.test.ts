import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HarnessOutput } from '../src/main/harness-output'
import { createServiceState } from '../src/main/service-state'
import { localStatus, readServiceState } from '../packages/dsh-px-workbench/src/status'

test('服务输出：跨分块令牌不落日志，诊断长度有界', () => {
  let log = ''
  const output = new HarnessOutput(text => { log += text })
  assert.equal(output.push('dsh web: http://127.0.0.1:3099/?tok'), null)
  assert.equal(output.push('en=secret-value\n'), 'http://127.0.0.1:3099/?token=secret-value')
  assert.doesNotMatch(log, /secret-value/)
  assert.match(log, /redacted/)
  output.push('a'.repeat(100_000))
  output.flush()
  assert.ok(output.diagnostic.length <= 4000)
})

test('工作台：诊断不读取密钥内容；过期心跳不可重启，路由可卸载', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-workbench-'))
  const beforeHome = process.env.DSH_HOME
  const beforeData = process.env.DSH_PX_USER_DATA
  process.env.DSH_HOME = join(root, 'home')
  process.env.DSH_PX_USER_DATA = root
  t.after(() => {
    if (beforeHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = beforeHome
    if (beforeData === undefined) delete process.env.DSH_PX_USER_DATA; else process.env.DSH_PX_USER_DATA = beforeData
    rmSync(root, { recursive: true, force: true })
  })
  const profile = join(process.env.DSH_HOME, 'profiles', 'web')
  mkdirSync(join(profile, 'node_modules', 'demo'), { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { demo: '1', missing: '2' }, dsh: { profile: { bundles: ['demo'] } } }))
  writeFileSync(join(profile, 'node_modules', 'demo', 'package.json'), '{"version":"1.2.3"}')
  writeFileSync(join(process.env.DSH_HOME, '.credentials.yaml'), 'API_SECRET_SHOULD_NOT_APPEAR')
  const bridge = createServiceState(root)
  t.after(() => bridge.dispose())
  bridge.set('running', '运行中', 123)
  const status = localStatus()
  assert.equal(status.canRestart, true)
  assert.equal(status.plugins[0].version, '1.2.3')
  assert.equal(status.plugins[1].version, null)
  assert.doesNotMatch(JSON.stringify(status), /API_SECRET_SHOULD_NOT_APPEAR/)
  const routes = new Map<string, (req: unknown, res: unknown) => void>()
  let dispose: (() => void) | undefined
  const created: string[] = []
  const mod = await import(pathToFileURL(resolve('packages/dsh-px-workbench/lib/index.js')).href)
  mod.apply({ inject: (_: unknown, callback: (ctx: unknown) => void) => callback({
    webServer: { register: (r: { path: string, handler: (req: unknown, res: unknown) => void }) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } },
    workspaceController: { create: async ({ path }: { path: string }) => { created.push(path); return { created: true } } },
    effect: (fn: () => () => void) => { dispose = fn() }
  }) })
  function request (method: string): number {
    let code = 0
    routes.get('/dsh-px-workbench/restart')!({ method, headers: { 'x-dsh-px-request': '1' } }, { writeHead: (n: number) => { code = n }, end: () => {} })
    return code
  }
  assert.equal(request('GET'), 405)
  assert.equal(request('POST'), 202)
  assert.ok(existsSync(join(root, 'update-bridge', 'restart.req')))
  let code = 0
  const res = { writeHead: (value: number) => { code = value }, end: () => {} }
  await routes.get('/dsh-px-workbench/workspace')!({ method: 'POST', url: '/workspace?path=relative', headers: { 'x-dsh-px-request': '1' } }, res)
  assert.equal(code, 400)
  await routes.get('/dsh-px-workbench/workspace')!({ method: 'POST', url: `/workspace?path=${encodeURIComponent(root)}` }, res)
  assert.equal(code, 403, '跨站简单 POST 不可创建工作区')
  assert.equal(created.length, 0)
  await routes.get('/dsh-px-workbench/workspace')!({ method: 'POST', url: `/workspace?path=${encodeURIComponent(root)}`, headers: { 'x-dsh-px-request': '1' } }, res)
  assert.equal(code, 200)
  assert.deepEqual(created, [root], '通过 DSH 官方控制器创建，不复制会话存储逻辑')
  const stale = JSON.parse(readFileSync(join(root, 'service-state.json'), 'utf8'))
  stale.updatedAt = '2000-01-01T00:00:00.000Z'
  writeFileSync(join(root, 'service-state.json'), JSON.stringify(stale))
  assert.equal(readServiceState(), null)
  assert.equal(request('POST'), 409)
  dispose?.()
  assert.equal(routes.size, 0)
})
