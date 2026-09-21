import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureManagedPlugins } from '../src/main/managed-plugins'

test('旧 profile 通过官方安装回调接入新插件：备份、幂等、版本迁移与失败重试', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-migrate-'))
  const home = join(root, 'home'), seedHome = join(root, 'seed')
  const profile = join(home, 'profiles/web')
  const source = join(seedHome, 'profiles/web/node_modules/dsh-px-workbench')
  mkdirSync(profile, { recursive: true }); mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'package.json'), '{"name":"dsh-px-workbench"}')
  const initial = { dependencies: { thirdparty: '1.2.3' }, dsh: { profile: { bundles: ['thirdparty'] } } }
  writeFileSync(join(profile, 'package.json'), JSON.stringify(initial))
  writeFileSync(join(profile, 'cordis.patch.yml'), 'USER PATCH')
  let calls = 0
  const install = async (specs: string[]): Promise<void> => {
    calls++
    assert.ok(specs[0].startsWith('file:'))
    const next = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    next.dependencies['dsh-px-workbench'] = specs[0]
    if (!next.dsh.profile.bundles.includes('dsh-px-workbench')) next.dsh.profile.bundles.push('dsh-px-workbench')
    writeFileSync(join(profile, 'package.json'), JSON.stringify(next))
    mkdirSync(join(profile, 'node_modules/dsh-px-workbench/lib'), { recursive: true })
    writeFileSync(join(profile, 'node_modules/dsh-px-workbench/lib/client.js'), 'plugin')
  }
  try {
    const options = { home, seedHome, profileName: 'web', identity: 'v6', install }
    assert.equal(await ensureManagedPlugins(options), true)
    assert.equal(await ensureManagedPlugins(options), false)
    assert.equal(calls, 1)
    const pkg = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(pkg.dependencies.thirdparty, '1.2.3')
    assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), 'USER PATCH')
    const backups = readdirSync(join(home, 'backups'))
    assert.deepEqual(JSON.parse(readFileSync(join(home, 'backups', backups[0], 'package.json'), 'utf8')), initial)
    await assert.rejects(ensureManagedPlugins({ ...options, identity: 'v7', install: async () => { throw new Error('offline store missing') } }), /原配置备份/)
    assert.equal(JSON.parse(readFileSync(join(home, '.dsh-px-managed-plugins.json'), 'utf8')).identity, 'v6')
    assert.equal(await ensureManagedPlugins({ ...options, identity: 'v7' }), true)
    assert.equal(calls, 2)
    assert.ok(existsSync(join(home, '.dsh-px-managed-plugins.json')))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
