import { localHandler } from './http-fixture'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { localStatus } from '../packages/dsh-px-workbench/src/status'

test('workbench diagnostics never read secrets and never claim host lifecycle control', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-workbench-'))
  const beforeHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, 'home')
  t.after(() => {
    if (beforeHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = beforeHome
    rmSync(root, { recursive: true, force: true })
  })
  // Native Desktop profiles are named "desktop"; diagnostics read that profile when present.
  const profile = join(process.env.DSH_HOME, 'profiles', 'desktop')
  mkdirSync(join(profile, 'node_modules', 'demo'), { recursive: true })
  writeFileSync(
    join(profile, 'package.json'),
    JSON.stringify({ dependencies: { demo: '1', missing: '2' }, dsh: { profile: { bundles: ['demo'] } } })
  )
  writeFileSync(join(profile, 'node_modules', 'demo', 'package.json'), '{"version":"1.2.3"}')
  writeFileSync(join(process.env.DSH_HOME, '.credentials.yaml'), 'API_SECRET_SHOULD_NOT_APPEAR')
  const status = localStatus()
  assert.equal(status.plugins[0].version, '1.2.3')
  assert.equal(status.plugins[1].version, null)
  assert.equal(status.credentialsFile, true)
  assert.deepEqual(status.runtime, {
    mode: 'native',
    owner: 'native-host',
    shared: true,
    capabilities: { restart: false, install: false }
  })
  assert.doesNotMatch(JSON.stringify(status), /API_SECRET_SHOULD_NOT_APPEAR/)
  assert.equal('service' in status || 'pendingOperation' in status || 'lastAction' in status, false)
  assert.equal(status.profileError, null, 'the only installed profile is used')

  // A second profile makes the guess ambiguous: without the host's profileContext the status is unknown.
  const web = join(process.env.DSH_HOME, 'profiles', 'web')
  mkdirSync(web, { recursive: true })
  writeFileSync(join(web, 'package.json'), JSON.stringify({ dependencies: { other: '3' } }))
  const unknown = localStatus()
  assert.deepEqual(unknown.plugins, [])
  assert.match(unknown.profileError ?? '', /无法确定/)
  // The host-reported running profile is authoritative.
  const reported = localStatus(undefined, { name: 'web', dir: web })
  assert.equal(reported.profileError, null)
  assert.deepEqual(
    reported.plugins.map((plugin) => plugin.name),
    ['other']
  )

  const routes = new Map<string, (req: unknown, res: unknown) => void>()
  const disposers: Array<() => void> = []
  const created: string[] = []
  const mod = await import(pathToFileURL(resolve('packages/dsh-px-workbench/lib/index.js')).href)
  mod.apply({
    inject: (_: unknown, callback: (ctx: unknown) => void) =>
      callback({
        connection: { requestRejection: () => undefined },
        webServer: {
          register: (r: { path: string; handler: (req: unknown, res: unknown) => void }) => {
            routes.set(r.path, localHandler(r.handler))
            return () => routes.delete(r.path)
          }
        },
        profileContext: { name: 'web', dir: web },
        workspaceController: {
          create: async ({ path }: { path: string }) => {
            created.push(path)
            return { created: true }
          }
        },
        effect: (fn: () => () => void) => {
          disposers.push(fn())
        }
      })
  })
  // No shell bridge in this generation: restart, cancel and shutdown routes do not exist.
  for (const path of ['restart', 'cancel-pending', 'shutdown'])
    assert.equal(routes.has(`/dsh-px-workbench/${path}`), false, path)
  let code = 0
  let body = ''
  const res = {
    writeHead: (value: number) => {
      code = value
    },
    end: (value = '') => {
      body = value
    }
  }
  await routes.get('/dsh-px-workbench/status')!({ method: 'GET', url: '/status', headers: {} }, res)
  assert.equal(code, 200)
  assert.deepEqual(
    JSON.parse(body).plugins.map((plugin: { name: string }) => plugin.name),
    ['other'],
    'the status route reports the host-provided running profile'
  )
  await routes.get('/dsh-px-workbench/workspace')!(
    { method: 'POST', url: '/workspace?path=relative', headers: { 'x-dsh-px-request': '1' } },
    res
  )
  assert.equal(code, 400)
  await routes.get('/dsh-px-workbench/workspace')!(
    { method: 'POST', url: `/workspace?path=${encodeURIComponent(root)}` },
    res
  )
  assert.equal(code, 403, '跨站简单 POST 不可创建工作区')
  assert.equal(created.length, 0)
  await routes.get('/dsh-px-workbench/workspace')!(
    {
      method: 'POST',
      url: `/workspace?path=${encodeURIComponent(root)}`,
      headers: { 'x-dsh-px-request': '1' }
    },
    res
  )
  assert.equal(code, 200)
  assert.deepEqual(created, [root], '通过 DSH 官方控制器创建，不复制会话存储逻辑')
  disposers.reverse().forEach((dispose) => dispose())
  assert.equal(routes.size, 0)
})
