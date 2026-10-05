import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { PackDeployment, type PackReceipt } from '../src/main/pack-deployment'
import { FOUNDATION_PLUGINS, FEATURE_BUNDLES, LEGACY_FEATURE_BUNDLES } from '../src/shared/distribution'
import { signRelease } from '../src/shared/signed-release'
import { unpackFiles, sha256 } from '../src/main/pack-archive'
import { managedRuntimePath } from '../src/main/runtime-cache'

function tar(files: Record<string, Buffer | string>): Buffer {
  const chunks: Buffer[] = []
  for (const [path, content] of Object.entries(files)) {
    const bytes = Buffer.from(content),
      header = Buffer.alloc(512)
    const full = 'package/' + path
    const slash = full.lastIndexOf('/')
    if (Buffer.byteLength(full) > 100) {
      header.write(full.slice(slash + 1))
      header.write(full.slice(0, slash), 345)
    } else header.write(full)
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124)
    header[156] = 48
    header.fill(32, 148, 156)
    header.write(
      [...header]
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
      148
    )
    chunks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512))
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]))
}
function fixture(t: any, initialFeatures: readonly string[] = FEATURE_BUNDLES) {
  const root = mkdtempSync(join(tmpdir(), 'px-deployment-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const profile = join(root, 'profile'),
    runtime = join(root, 'runtime')
  const put = (file: string, value: string) => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, value)
  }
  put(
    join(profile, 'package.json'),
    JSON.stringify({
      name: 'profile',
      dependencies: { custom: '1.0.0' },
      dsh: { profile: { bundles: ['base', 'custom'] } }
    })
  )
  put(join(profile, 'cordis.patch.yml'), '# user-owned\n')
  for (const file of ['package.json', 'desktop-runtime.json', 'node_modules/@deepseek-ai/dsh/package.json'])
    put(join(runtime, file), '{}')
  put(join(runtime, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'), 'export const host = true')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
  const keyId = createHash('sha256').update(pem).digest('hex').slice(0, 24)
  const keys = { [keyId]: pem }
  function pack(version: string, names: readonly string[] = FEATURE_BUNDLES, generation = 3) {
    const meta = {
      sourceCommit: 'a'.repeat(40),
      hostVersion: '0.2.0-rc.2',
      upstreamCommit: 'b'.repeat(40),
      protocolGeneration: generation
    }
    const record = { ...meta, candidate: false, sourceDirty: false }
    const members = Object.fromEntries(FOUNDATION_PLUGINS.map((n) => [n, version]))
    const foundation = tar({
      'package.json': JSON.stringify({ name: 'dsh-px-core', version, dependencies: members, dshPx: record }),
      ...Object.fromEntries(
        FOUNDATION_PLUGINS.flatMap((name) => [
          [`node_modules/${name}/package.json`, JSON.stringify({ name, version })],
          [`node_modules/${name}/lib/index.js`, `export const version = '${version}'`]
        ])
      )
    })
    const files: Record<string, Buffer | string> = {
      'package.json': JSON.stringify({ name: 'dsh-px-pack', version, dshPx: record })
    }
    const component = (name: string, bytes: Buffer) => {
      const file = `distribution/${name}-${version}.tgz`
      files[file] = bytes
      return { name, version, file, sha256: sha256(bytes) }
    }
    const core = component('dsh-px-core', foundation)
    const features = names.map((name) =>
      component(name, tar({ 'package.json': JSON.stringify({ name, version }) }))
    )
    files['distribution.json'] = JSON.stringify({ schemaVersion: 1, version, foundation: core, features })
    const bytes = tar(files),
      digest = sha256(bytes),
      name = `dsh-px-pack-${version}.tgz`
    const signed = JSON.stringify(
      signRelease(
        {
          schemaVersion: 1,
          product: 'pack',
          channel: 'preview',
          platform: 'any',
          version,
          packVersion: version,
          ...meta,
          upgradeFromGenerations: [],
          issuedAt: '2026-10-04T00:00:00.000Z',
          files: [
            {
              role: 'pack',
              name,
              url: `https://github.com/Palbudir/dsh-px/releases/download/pack-v${version}/${name}`,
              size: bytes.length,
              sha256: digest,
              sha512: createHash('sha512').update(bytes).digest('base64')
            }
          ]
        },
        keyId,
        privateKey.export({ type: 'pkcs8', format: 'pem' })
      )
    )
    return { bytes, signed, receipt: { ...meta, version, sha256: digest } as PackReceipt }
  }
  const baseline = pack('0.3.2-alpha.1', initialFeatures),
    next = pack('0.3.3-alpha.1')
  const bundledArchive = join(root, 'bundled.tgz')
  writeFileSync(bundledArchive, baseline.bytes)
  let failingVersion = ''
  const deployment = new PackDeployment({
    profile,
    bundledRuntime: runtime,
    bundledArchive,
    bundled: baseline.receipt,
    keys,
    hostKey: 'native-test',
    install: async (anchor) => {
      const version = JSON.parse(
        readFileSync(join(anchor, 'node_modules/dsh-px-core/package.json'), 'utf8')
      ).version
      const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
      for (const name of Object.keys(manifest.dependencies).filter((n) => n.startsWith('dsh-px-')))
        if (manifest.dependencies[name]) {
          // A real native install follows each archive, including rollback's prior lock/dependencies.
          const archive = readFileSync(manifest.dependencies[name].slice(5))
          const component = JSON.parse(unpackFiles(archive).get('package.json')!.toString())
          if (component.version === failingVersion) {
            failingVersion = ''
            throw Error('Injected native install failure')
          }
          put(join(profile, 'node_modules', name, 'package.json'), JSON.stringify(component))
        }
      assert.ok(version)
    }
  })
  return {
    root,
    profile,
    runtime,
    baseline,
    next,
    deployment,
    pack,
    failNext: () => {
      failingVersion = next.receipt.version
    }
  }
}
test('Desktop generation 4 activates its six-feature Pack over a generation 3 receipt without changing business data', async (t) => {
  const f = fixture(t, LEGACY_FEATURE_BUNDLES)
  await f.deployment.activate()
  f.deployment.confirm()
  const file = join(f.profile, 'package.json'),
    manifest = JSON.parse(readFileSync(file, 'utf8'))
  delete manifest.dependencies['dsh-px-annotations']
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(
    (n: string) => n !== 'dsh-px-annotations'
  )
  writeFileSync(file, JSON.stringify(manifest))
  const dataFile = join(f.root, 'user-memory.json')
  writeFileSync(dataFile, '{"keep":"personal configuration"}')
  const next = f.pack('0.4.0-alpha.1', FEATURE_BUNDLES, 4),
    archive = join(f.root, 'new-desktop-pack.tgz')
  writeFileSync(archive, next.bytes)
  const upgraded = new PackDeployment({
    ...f.deployment.options,
    bundled: next.receipt,
    bundledArchive: archive
  })
  await upgraded.activate()
  upgraded.confirm()
  assert.equal(upgraded.read().active?.protocolGeneration, 4)
  const result = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(result.dependencies['dsh-px-memory'])
  assert.equal(result.dependencies['dsh-px-annotations'], undefined)
  assert.equal(readFileSync(dataFile, 'utf8'), '{"keep":"personal configuration"}')
})
test('a signed Pack adds a feature not compiled into Desktop without restoring a removed feature', async (t) => {
  const f = fixture(t)
  await f.deployment.activate()
  f.deployment.confirm()
  const file = join(f.profile, 'package.json'),
    manifest = JSON.parse(readFileSync(file, 'utf8'))
  delete manifest.dependencies['dsh-px-schedules']
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((n: string) => n !== 'dsh-px-schedules')
  writeFileSync(file, JSON.stringify(manifest))
  const future = f.pack('0.3.9-alpha.1', [...FEATURE_BUNDLES, 'dsh-px-future'])
  f.deployment.queue(f.deployment.stage(future.signed, future.bytes))
  await f.deployment.activate()
  f.deployment.confirm()
  const result = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(result.dependencies['dsh-px-future'])
  assert.equal(result.dependencies['dsh-px-schedules'], undefined)
  assert.equal(
    JSON.parse(readFileSync(join(f.profile, 'node_modules/dsh-px-future/package.json'), 'utf8')).version,
    future.receipt.version
  )
})

test('corrupt composition receipt still upgrades previously installed dynamic features', async (t) => {
  const f = fixture(t)
  await f.deployment.activate()
  f.deployment.confirm()
  const future = f.pack('0.3.9-alpha.1', [...FEATURE_BUNDLES, 'dsh-px-future'])
  f.deployment.queue(f.deployment.stage(future.signed, future.bytes))
  await f.deployment.activate()
  f.deployment.confirm()
  writeFileSync(join(f.profile, '.dsh-px/composition-state.json'), '{broken')
  const next = f.pack('0.3.10-alpha.1', [...FEATURE_BUNDLES, 'dsh-px-future'])
  f.deployment.queue(f.deployment.stage(next.signed, next.bytes))
  await f.deployment.activate()
  f.deployment.confirm()
  assert.equal(
    JSON.parse(readFileSync(join(f.profile, 'node_modules/dsh-px-future/package.json'), 'utf8')).version,
    next.receipt.version
  )
  const file = join(f.profile, 'package.json'),
    manifest = JSON.parse(readFileSync(file, 'utf8'))
  delete manifest.dependencies['dsh-px-future']
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((n: string) => n !== 'dsh-px-future')
  writeFileSync(file, JSON.stringify(manifest))
  writeFileSync(join(f.profile, '.dsh-px/composition-state.json'), '{broken again')
  const later = f.pack('0.3.11-alpha.1', [...FEATURE_BUNDLES, 'dsh-px-future', 'dsh-px-new-after-recovery'])
  f.deployment.queue(f.deployment.stage(later.signed, later.bytes))
  await f.deployment.activate()
  f.deployment.confirm()
  const preserved = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(preserved.dependencies['dsh-px-future'], undefined)
  assert.equal(preserved.dependencies['dsh-px-new-after-recovery'], undefined)
})
test('entire Pack switches native foundation and features; immutable host files are reused', async (t) => {
  const f = fixture(t),
    old = await f.deployment.activate()
  f.deployment.confirm()
  const manifestFile = join(f.profile, 'package.json'),
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  delete manifest.dependencies['dsh-px-schedules']
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((n: string) => n !== 'dsh-px-schedules')
  writeFileSync(manifestFile, JSON.stringify(manifest))
  const receipt = f.deployment.stage(f.next.signed, f.next.bytes)
  assert.equal(f.deployment.read().active?.version, f.baseline.receipt.version)
  f.deployment.queue(receipt)
  const current = await f.deployment.activate()
  f.deployment.confirm()
  assert.notEqual(current, old)
  assert.equal(
    JSON.parse(readFileSync(join(current, 'node_modules/dsh-px-updater/package.json'), 'utf8')).version,
    f.next.receipt.version
  )
  const updated = JSON.parse(readFileSync(manifestFile, 'utf8'))
  assert.equal(updated.dependencies.custom, '1.0.0')
  assert.equal(updated.dependencies['dsh-px-schedules'], undefined)
  assert.equal(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8'), '# user-owned\n')
  assert.equal(await f.deployment.activate(), current) // older embedded Pack must not overwrite newer independent Pack
  assert.throws(
    () => f.deployment.queue(receipt),
    /不再新于/,
    'stale restart confirmation must not queue an installed target'
  )
  const relative = 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'
  assert.equal(statSync(join(old, relative)).ino, statSync(join(current, relative)).ino)
  assert.equal(managedRuntimePath(f.profile, current), current)
  assert.throws(() => managedRuntimePath(f.profile, f.runtime))
})
test('interrupted Pack startup rolls foundation and features back as one cohort', async (t) => {
  const f = fixture(t)
  await f.deployment.activate()
  f.deployment.confirm()
  f.deployment.queue(f.deployment.stage(f.next.signed, f.next.bytes))
  await f.deployment.activate() // no host-ready acknowledgement: simulate crash
  const rollback = await f.deployment.activate()
  f.deployment.confirm()
  assert.equal(f.deployment.read().active?.version, f.baseline.receipt.version)
  assert.match(f.deployment.read().error!, /回退/)
  assert.equal(
    JSON.parse(readFileSync(join(rollback, 'node_modules/dsh-px-core/package.json'), 'utf8')).version,
    f.baseline.receipt.version
  )
  assert.equal(
    JSON.parse(readFileSync(join(f.profile, 'node_modules/dsh-px-annotations/package.json'), 'utf8')).version,
    f.baseline.receipt.version
  )
})
test('native install failure retains a usable old cohort; bad download never becomes pending', async (t) => {
  const f = fixture(t)
  await f.deployment.activate()
  f.deployment.confirm()
  assert.throws(() => f.deployment.stage(f.next.signed, Buffer.from('broken')))
  assert.equal(f.deployment.read().pending, undefined)
  f.deployment.queue(f.deployment.stage(f.next.signed, f.next.bytes))
  f.failNext()
  await f.deployment.activate()
  f.deployment.confirm()
  assert.equal(f.deployment.read().active?.version, f.baseline.receipt.version)
  assert.equal(f.deployment.read().pending, undefined)
  assert.ok(existsSync(join(f.profile, '.dsh-px/runtime.json')))
})
test('archive rejects traversal, Windows path aliases and duplicate-case entries', () => {
  for (const path of ['../escape', 'a/../../escape', 'c:/foo', 'a\\foo', 'a/CON.txt', 'a/aux', 'trailing.'])
    assert.throws(() => unpackFiles(tar({ [path]: 'bad' })))
  assert.throws(() => unpackFiles(tar({ 'File.txt': '1', 'file.txt': '2' })))
})

test('a user-managed aggregate remains runnable and is not reported as upgraded', async (t) => {
  const f = fixture(t),
    file = join(f.profile, 'package.json')
  const profile = JSON.parse(readFileSync(file, 'utf8'))
  profile.dependencies['dsh-px-pack'] = 'file:./custom-pack.tgz'
  writeFileSync(file, JSON.stringify(profile))
  assert.equal(await f.deployment.activate(), f.runtime)
  assert.equal(f.deployment.read().userManaged, true)
  assert.equal(f.deployment.read().active, undefined)
  assert.throws(() => f.deployment.stage(f.next.signed, f.next.bytes), /自行安装/)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).dependencies['dsh-px-pack'], 'file:./custom-pack.tgz')
})

test('bundled receipts accept beta and stable product versions, not malformed ones', (t) => {
  for (const [version, valid] of [
    ['0.4.0-alpha.1', true],
    ['0.5.0-beta.1', true],
    ['0.5.0', true],
    ['1.0.0', false],
    ['0.5', false]
  ] as const) {
    const profile = mkdtempSync(join(tmpdir(), 'dshpx-receipt-'))
    t.after(() => rmSync(profile, { recursive: true, force: true }))
    const receipt: PackReceipt = {
      version,
      sha256: 'a'.repeat(64),
      sourceCommit: 'b'.repeat(40),
      hostVersion: '0.2.0-rc.2',
      upstreamCommit: 'c'.repeat(40),
      protocolGeneration: 5
    }
    mkdirSync(join(profile, '.dsh-px'))
    writeFileSync(
      join(profile, '.dsh-px/deployment.json'),
      JSON.stringify({ schemaVersion: 1, active: receipt })
    )
    const deployment = new PackDeployment({
      profile,
      bundledRuntime: profile,
      bundledArchive: join(profile, 'pack.tgz'),
      bundled: receipt,
      hostKey: 'test',
      keys: {},
      install: async () => {}
    })
    if (valid) assert.equal(deployment.read().active?.version, version)
    else assert.throws(() => deployment.read(), /Invalid bundled Pack receipt/)
  }
})
