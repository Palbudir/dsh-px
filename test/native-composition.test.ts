import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { provisionNativeComposition } from '../src/main/native-composition'
import { FEATURE_BUNDLES } from '../src/shared/distribution'

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'px-composition-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const profile = join(root, 'profile'),
    directory = join(root, 'payload')
  mkdirSync(profile)
  mkdirSync(join(directory, 'distribution'), { recursive: true })
  const version = '0.3.0-alpha.1'
  const features = FEATURE_BUNDLES.map((name) => {
    const file = `distribution/${name}-${version}.tgz`,
      bytes = Buffer.from(name)
    writeFileSync(join(directory, file), bytes)
    return { name, version, file, sha256: createHash('sha256').update(bytes).digest('hex') }
  })
  writeFileSync(
    join(directory, 'distribution.json'),
    JSON.stringify({ schemaVersion: 1, version, foundation: { name: 'dsh-px-core' }, features })
  )
  writeFileSync(
    join(profile, 'package.json'),
    JSON.stringify({
      name: 'profile',
      dependencies: { custom: '1.0.0' },
      dsh: { profile: { bundles: ['base', 'custom'] } }
    })
  )
  writeFileSync(
    join(profile, 'cordis.patch.yml'),
    '# user choices\n- id: dsh-px-annotations\n  disabled: true\n'
  )
  const manifest = () => JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  const save = (value: any) => writeFileSync(join(profile, 'package.json'), JSON.stringify(value))
  let calls = 0
  const install = async () => {
    calls++
    for (const name of FEATURE_BUNDLES)
      if (manifest().dependencies[name]) {
        mkdirSync(join(profile, 'node_modules', name), { recursive: true })
        writeFileSync(join(profile, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }))
      }
  }
  return { profile, directory, version, install, manifest, save, calls: () => calls, log: () => {} }
}
test('composition installs once, preserves disabled features and never restores user removals', async (t) => {
  const f = fixture(t)
  assert.equal(await provisionNativeComposition(f), 'installed')
  assert.equal(f.calls(), 1)
  assert.ok(f.manifest().dsh.profile.bundles.includes('dsh-px-core'))
  assert.equal(f.manifest().dependencies.custom, '1.0.0')
  assert.match(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8'), /disabled: true/)
  assert.equal(await provisionNativeComposition(f), 'unchanged')
  const m = f.manifest()
  delete m.dependencies['dsh-px-schedules']
  m.dsh.profile.bundles = m.dsh.profile.bundles.filter((n: string) => n !== 'dsh-px-schedules')
  f.save(m)
  await provisionNativeComposition(f)
  assert.equal(f.manifest().dependencies['dsh-px-schedules'], undefined)
})
test('legacy managed bundle migrates without duplicate registration or dropping row overrides', async (t) => {
  const f = fixture(t),
    m = f.manifest()
  mkdirSync(join(f.profile, '.dsh-px'))
  m.dependencies['dsh-px-pack'] =
    'file:' + join(f.profile, '.dsh-px', 'pack-' + 'a'.repeat(64) + '.tgz').replaceAll('\\', '/')
  m.dsh.profile.bundles.push('dsh-px-pack')
  f.save(m)
  writeFileSync(
    join(f.profile, 'cordis.patch.yml'),
    '- id: dsh-px-annotations\n  name: file:///old/node_modules/dsh-px-annotations/lib/index.js\n  disabled: true\n'
  )
  assert.equal(await provisionNativeComposition(f), 'installed')
  assert.equal(f.manifest().dependencies['dsh-px-pack'], undefined)
  assert.ok(!f.manifest().dsh.profile.bundles.includes('dsh-px-pack'))
  assert.match(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8'), /name: dsh-px-annotations/)
  assert.ok(!f.manifest().dsh.profile.bundles.includes('dsh-px-annotations'))
  assert.doesNotMatch(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8'), /disabled: true/)
})
test('failed install restores the old profile, invokes native repair, then permits a clean retry', async (t) => {
  const f = fixture(t),
    before = readFileSync(join(f.profile, 'package.json'), 'utf8')
  let fail = true,
    repairs = 0
  const install = async (args: string[]) => {
    if (fail) {
      fail = false
      throw Error('failure injection')
    }
    repairs++
    await f.install()
  }
  assert.equal(await provisionNativeComposition({ ...f, install }), 'failed')
  assert.equal(readFileSync(join(f.profile, 'package.json'), 'utf8'), before)
  assert.equal(repairs, 1)
  assert.ok(!existsSync(join(f.profile, '.dsh-px/composition-state.json')))
  assert.equal(await provisionNativeComposition({ ...f, install }), 'installed')
})
test('custom legacy Pack is not taken over', async (t) => {
  const f = fixture(t),
    m = f.manifest()
  m.dependencies['dsh-px-pack'] = 'file:./my-pack.tgz'
  f.save(m)
  assert.equal(await provisionNativeComposition(f), 'user-managed')
  assert.equal(f.calls(), 0)
})

test('damaged composition receipt is preserved and recovery does not reinstall a removed feature', async (t) => {
  const f = fixture(t)
  await provisionNativeComposition(f)
  const m = f.manifest()
  delete m.dependencies['dsh-px-schedules']
  m.dsh.profile.bundles = m.dsh.profile.bundles.filter((n: string) => n !== 'dsh-px-schedules')
  f.save(m)
  writeFileSync(join(f.profile, '.dsh-px/composition-state.json'), 'broken receipt')
  assert.equal(await provisionNativeComposition(f), 'installed')
  assert.equal(f.manifest().dependencies['dsh-px-schedules'], undefined)
  assert.equal(
    readdirSync(join(f.profile, '.dsh-px')).filter((n) => n.startsWith('composition-state.json.corrupt-'))
      .length,
    1
  )
})

test('interrupted composition restores its journal before retrying', async (t) => {
  const f = fixture(t)
  await provisionNativeComposition(f)
  const before = readFileSync(join(f.profile, 'package.json'), 'utf8')
  const state = JSON.parse(readFileSync(join(f.profile, '.dsh-px/composition-state.json'), 'utf8'))
  const files = Object.fromEntries(
    ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', 'cordis.yml'].map((name) => [
      name,
      existsSync(join(f.profile, name)) ? readFileSync(join(f.profile, name)).toString('base64') : null
    ])
  )
  writeFileSync(
    join(f.profile, '.dsh-px/composition-rollback.json'),
    JSON.stringify({ files, previousState: state })
  )
  writeFileSync(
    join(f.profile, '.dsh-px/composition-state.json'),
    JSON.stringify({ ...state, phase: 'pending' })
  )
  writeFileSync(join(f.profile, 'package.json'), 'interrupted write')
  assert.equal(await provisionNativeComposition(f), 'unchanged')
  assert.equal(readFileSync(join(f.profile, 'package.json'), 'utf8'), before)
  assert.equal(f.calls(), 2)
})
