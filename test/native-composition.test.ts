import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { provisionNativeComposition } from '../src/main/native-composition'
import { FEATURE_BUNDLES } from '../src/shared/distribution'
import { projectKnowledgeDefaults, scopedKnowledgeDefaults } from '../src/main/community-defaults'

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

function withCommunity(f: ReturnType<typeof fixture>, version = '0.5.29') {
  const file = `distribution/dsh-mnemon-${version}.tgz`,
    bytes = Buffer.from('original-community-' + version)
  writeFileSync(join(f.directory, file), bytes)
  const distribution = JSON.parse(readFileSync(join(f.directory, 'distribution.json'), 'utf8'))
  distribution.schemaVersion = 2
  distribution.community = [
    {
      name: 'dsh-mnemon',
      version,
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
      defaults: 'project-documents-v1'
    }
  ]
  writeFileSync(join(f.directory, 'distribution.json'), JSON.stringify(distribution))
  return {
    ...f,
    knowledgeDirectory: join(f.profile, 'knowledge'),
    install: async (args: string[]) => {
      await f.install()
      if (f.manifest().dependencies['dsh-mnemon']?.startsWith('file:')) {
        mkdirSync(join(f.profile, 'node_modules/dsh-mnemon'), { recursive: true })
        writeFileSync(
          join(f.profile, 'node_modules/dsh-mnemon/package.json'),
          JSON.stringify({ name: 'dsh-mnemon', version })
        )
      }
    }
  }
}

test('community members keep original versions and get project defaults once; user changes survive upgrade and removal', async (t) => {
  const f = fixture(t),
    first = withCommunity(f)
  assert.equal(await provisionNativeComposition(first), 'installed')
  assert.ok(f.manifest().dsh.profile.bundles.includes('dsh-mnemon'))
  const patch = join(f.profile, 'cordis.patch.yml')
  assert.match(readFileSync(patch, 'utf8'), /storageScope: workspaces/)
  const custom = readFileSync(patch, 'utf8').replace('lifecycleEnabled: false', 'lifecycleEnabled: true')
  writeFileSync(patch, custom)
  assert.equal(await provisionNativeComposition(withCommunity(f, '0.5.30')), 'installed')
  assert.equal(readFileSync(patch, 'utf8'), custom)
  const manifest = f.manifest()
  delete manifest.dependencies['dsh-mnemon']
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((n: string) => n !== 'dsh-mnemon')
  f.save(manifest)
  await provisionNativeComposition(withCommunity(f, '0.5.31'))
  assert.equal(f.manifest().dependencies['dsh-mnemon'], undefined)
})

test('user-installed community version, disabled selection and configuration are never taken over', async (t) => {
  const f = fixture(t),
    options = withCommunity(f),
    manifest = f.manifest()
  manifest.dependencies['dsh-mnemon'] = '0.5.20'
  f.save(manifest)
  const patch = join(f.profile, 'cordis.patch.yml'),
    original = readFileSync(patch, 'utf8')
  assert.equal(await provisionNativeComposition(options), 'installed')
  assert.equal(f.manifest().dependencies['dsh-mnemon'], '0.5.20')
  assert.ok(!f.manifest().dsh.profile.bundles.includes('dsh-mnemon'))
  assert.equal(readFileSync(patch, 'utf8'), original)
})

test('a failed native community installation restores both manifest and default configuration', async (t) => {
  const f = fixture(t),
    options = withCommunity(f),
    original = f.manifest()
  const patch = join(f.profile, 'cordis.patch.yml'),
    text = readFileSync(patch, 'utf8')
  let first = true
  const install = async (args: string[]) => {
    if (first) {
      first = false
      throw Error('dependency install failed')
    }
    await options.install(args)
  }
  assert.equal(await provisionNativeComposition({ ...options, install }), 'failed')
  assert.deepEqual(f.manifest(), original)
  assert.equal(readFileSync(patch, 'utf8'), text)
})

test('community defaults reject malformed patches and respect any existing Mnemon configuration', () => {
  const directory = join(tmpdir(), 'px-knowledge-test')
  const explicit = '# user scope\n- id: mnemon\n  config:\n    storageScope: global\n'
  assert.equal(projectKnowledgeDefaults(explicit, directory), explicit)
  const disabled = '- id: mnemon-source-runtime\n  disabled: false\n'
  assert.equal(projectKnowledgeDefaults(disabled, directory), disabled)
  assert.throws(() => projectKnowledgeDefaults('not: a sequence', directory), /Invalid profile/)
  assert.throws(() => projectKnowledgeDefaults('', 'relative'), /absolute/)
})
test('0.6 switches managed knowledge participation once without overwriting later operator choices', async (t) => {
  const f = fixture(t),
    old = withCommunity(f)
  await provisionNativeComposition(old)
  const distributionPath = join(f.directory, 'distribution.json'),
    distribution = JSON.parse(readFileSync(distributionPath, 'utf8'))
  distribution.community[0].defaults = 'px-knowledge-v2'
  writeFileSync(distributionPath, JSON.stringify(distribution))
  assert.equal(await provisionNativeComposition(old), 'installed')
  const patch = join(f.profile, 'cordis.patch.yml'),
    text = readFileSync(patch, 'utf8')
  assert.match(text, /px-knowledge:/)
  assert.match(text, /recall: manual/)
  assert.match(text, /lifecycleEnabled: true/)
  const user = text.replace('lifecycleEnabled: true', 'lifecycleEnabled: false')
  writeFileSync(patch, user)
  assert.equal(await provisionNativeComposition(old), 'unchanged')
  assert.equal(readFileSync(patch, 'utf8'), user)
  const parsed = scopedKnowledgeDefaults(
    '- id: mnemon\n  config:\n    timeoutMs: 1234\n',
    join(tmpdir(), 'px-knowledge')
  )
  assert.match(parsed, /timeoutMs: 1234/)
  assert.match(parsed, /strategyId: general/)
})
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

test('upgrade offers a new memory bundle once without restoring previously removed features', async (t) => {
  const f = fixture(t)
  await provisionNativeComposition(f)
  const receipt = join(f.profile, '.dsh-px/composition-state.json')
  const state = JSON.parse(readFileSync(receipt, 'utf8'))
  delete state.seenFeatures
  delete state.specs['dsh-px-memory']
  state.version = '0.3.3-alpha.1'
  writeFileSync(receipt, JSON.stringify(state))
  const manifest = f.manifest()
  delete manifest.dependencies['dsh-px-memory']
  delete manifest.dependencies['dsh-px-annotations']
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(
    (n: string) => !['dsh-px-memory', 'dsh-px-annotations'].includes(n)
  )
  f.save(manifest)
  assert.equal(await provisionNativeComposition(f), 'installed')
  assert.ok(f.manifest().dependencies['dsh-px-memory'])
  assert.equal(f.manifest().dependencies['dsh-px-annotations'], undefined)
  const next = f.manifest()
  delete next.dependencies['dsh-px-memory']
  next.dsh.profile.bundles = next.dsh.profile.bundles.filter((n: string) => n !== 'dsh-px-memory')
  f.save(next)
  await provisionNativeComposition(f)
  await provisionNativeComposition(f)
  assert.equal(f.manifest().dependencies['dsh-px-memory'], undefined)
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

test('missing composition receipt recovers managed declarations without reviving removed features', async (t) => {
  const f = fixture(t)
  await provisionNativeComposition(f)
  const m = f.manifest()
  delete m.dependencies['dsh-px-schedules']
  m.dsh.profile.bundles = m.dsh.profile.bundles.filter((n: string) => n !== 'dsh-px-schedules')
  f.save(m)
  rmSync(join(f.profile, '.dsh-px/composition-state.json'))
  writeFileSync(join(f.profile, '.dsh-px/pack-state.json'), JSON.stringify({ phase: 'installed' }))
  assert.equal(await provisionNativeComposition(f), 'installed')
  assert.equal(f.manifest().dependencies['dsh-px-schedules'], undefined)
  assert.ok(f.manifest().dependencies['dsh-px-annotations'])
})
