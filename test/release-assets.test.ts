import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  realpathSync
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import products from '../config/products.json'
import nativePack from '../config/native-pack.json'
import nativeDesktop from '../config/native-desktop.json'

const load = (name: string): Promise<any> => import(pathToFileURL(resolve('scripts', name)).href)
const versionModule = await load('release-version.mjs')
const {
  releaseAssetNames,
  releaseTag,
  parseReleaseTag,
  assertNotLegacyClientTag,
  assertPublishableAssetName
} = versionModule
const {
  writeReleaseDirectory,
  selectInstaller,
  desktopArtifact,
  releaseIdentity,
  packArtifact,
  asarEntries
} = await load('release-package.mjs')
const { verifyReleaseFiles, releaseCreateBody, releasePublishBody } = await load('release-assets.mjs')
const { verifyPackOutput } = await load('release-quality.mjs')
const head = 'a'.repeat(40),
  controllerSha = 'b'.repeat(40)
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function temp(t: any, label: string) {
  const parent = realpathSync(tmpdir()),
    root = realpathSync(mkdtempSync(join(parent, `dshpx-${label}-`)))
  t.after(() => {
    assert.ok(root.startsWith(parent + sep))
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

test('release tags are product-prefixed and never look like a legacy v* client release', () => {
  assert.equal(releaseTag('desktop', '0.2.0-alpha.1'), 'desktop-v0.2.0-alpha.1')
  assert.equal(releaseTag('pack', '0.2.3'), 'pack-v0.2.3')
  assert.deepEqual(parseReleaseTag('pack-v0.2.0-alpha.1'), { product: 'pack', version: '0.2.0-alpha.1' })
  assert.equal(parseReleaseTag('v0.1.0-beta.re.0.11'), null)
  for (const tag of ['v0.2.0', 'v0.2.0-beta.1', 'refs/tags/v0.2.0-rc.1', '0.2.0', 'v0.1.0-beta.re.0.12'])
    assert.throws(() => assertNotLegacyClientTag(tag), /legacy/)
  for (const tag of ['desktop-v0.2.0', 'refs/tags/pack-v0.2.0-alpha.2']) assertNotLegacyClientTag(tag)
  assert.throws(() => assertNotLegacyClientTag('shell-v0.2.0'), /desktop-v/)
  assert.throws(() => releaseTag('shell', '0.2.0'), /Unknown/)
  assert.throws(() => releaseTag('pack', '../0.2.0'), /Invalid/)
})

test('asset names are fixed per product and feeds, YAML and blockmaps are never publishable', () => {
  assert.deepEqual(releaseAssetNames('desktop', '0.2.0-alpha.1'), {
    installer: 'DSH-PX-Desktop-0.2.0-alpha.1-win-x64.exe',
    artifact: 'artifact.json'
  })
  assert.deepEqual(releaseAssetNames('pack', '0.2.0-alpha.1'), {
    pack: 'dsh-px-pack-0.2.0-alpha.1.tgz',
    artifact: 'artifact.json'
  })
  assert.equal(releaseAssetNames('pack', '1.2.3+build.1').pack, 'dsh-px-pack-1.2.3_build.1.tgz')
  for (const name of ['latest.yml', 'preview.yml', 'beta.YAML', 'DSH-PX-Desktop-0.2.0-win-x64.exe.blockmap'])
    assert.throws(() => assertPublishableAssetName(name), /not publishable/)
  for (const name of ['a b.exe', '../x.tgz', 'x\n.tgz']) assert.throws(() => assertPublishableAssetName(name))
  for (const invalid of ['../1.0.0', '1.0.0 bad', '01.0.0', '1.0.0-01', '1.0.0+'])
    assert.throws(() => releaseAssetNames('pack', invalid), /Invalid/)
})

test('release input must name the reviewed version of exactly one product', () => {
  assert.deepEqual(releaseIdentity(`desktop-v${products.desktop.version}`, products), {
    product: 'desktop',
    version: products.desktop.version
  })
  assert.deepEqual(releaseIdentity(`pack-v${products.pack.version}`, products), {
    product: 'pack',
    version: products.pack.version
  })
  for (const bad of [
    'desktop-v0.2.99',
    'pack-v0.2.99',
    `v${products.desktop.version}`,
    products.pack.version
  ])
    assert.throws(() => releaseIdentity(bad, products))
})

test('publication is always a prerelease that never becomes GitHub Latest', () => {
  const create = releaseCreateBody({ product: 'pack', version: '0.2.0-alpha.1', head, notes: 'Notes' })
  assert.equal(create.tag_name, 'pack-v0.2.0-alpha.1')
  assert.equal(create.prerelease, true)
  assert.equal(create.make_latest, 'false')
  assert.equal(create.draft, true)
  const publish = releasePublishBody({ product: 'desktop', version: '0.2.0-alpha.1', notes: 'Notes' })
  assert.deepEqual(
    { prerelease: publish.prerelease, make_latest: publish.make_latest, draft: publish.draft },
    { prerelease: true, make_latest: 'false', draft: false }
  )
  assert.match(publish.name, /DSH-PX Desktop/)
})

function packFixture(t: any, mutate: (manifest: any, artifact: any, distribution: any) => void = () => {}) {
  const root = temp(t, 'pack-output')
  const version = products.pack.version
  const pkg = join(root, 'package')
  mkdirSync(join(pkg, 'node_modules', 'member'), { recursive: true })
  writeFileSync(join(pkg, 'node_modules', 'member', 'package.json'), '{"name":"member"}')
  writeFileSync(join(pkg, 'cordis.patch.yml'), '- insert: []\n')
  writeFileSync(join(pkg, 'index.js'), 'export function apply() {}\n')
  const components = [
    'dsh-px-core',
    'dsh-px-files',
    'dsh-px-taskflow',
    'dsh-px-artifacts',
    'dsh-px-annotations',
    'dsh-px-schedules'
  ]
  mkdirSync(join(pkg, 'distribution'))
  const members = components.map((name) => {
    const dir = join(root, name)
    mkdirSync(join(dir, 'package'), { recursive: true })
    writeFileSync(join(dir, 'package/package.json'), JSON.stringify({ name, version }))
    const file = `distribution/${name}-${version}.tgz`
    execFileSync('tar', ['-czf', '../package/' + file, 'package'], { cwd: dir, windowsHide: true })
    return { name, version, file, sha256: hash(readFileSync(join(pkg, file))) }
  })
  const distribution = { schemaVersion: 1, version, foundation: members[0], features: members.slice(1) }
  const manifest = {
    name: 'dsh-px-pack',
    version,
    bundledDependencies: ['member'],
    dshPx: {
      candidate: false,
      sourceCommit: head,
      sourceDirty: false,
      hostVersion: nativePack.hostVersion,
      upstreamCommit: nativePack.upstreamCommit,
      protocolGeneration: products.protocolGeneration
    }
  }
  const artifact: any = {
    version,
    candidate: false,
    sourceCommit: head,
    sourceDirty: false,
    hostVersion: nativePack.hostVersion,
    upstreamCommit: nativePack.upstreamCommit,
    protocolGeneration: products.protocolGeneration,
    artifact: `dsh-px-pack-${version}.tgz`
  }
  mutate(manifest, artifact, distribution)
  writeFileSync(join(pkg, 'distribution.json'), JSON.stringify(distribution))
  writeFileSync(join(pkg, 'package.json'), JSON.stringify(manifest))
  execFileSync('tar', ['-czf', `dsh-px-pack-${version}.tgz`, 'package'], { cwd: root, windowsHide: true })
  rmSync(pkg, { recursive: true, force: true })
  const bytes = readFileSync(join(root, `dsh-px-pack-${version}.tgz`))
  artifact.size ??= bytes.length
  artifact.sha256 ??= hash(bytes)
  artifact.sha512 ??= createHash('sha512').update(bytes).digest('base64')
  writeFileSync(join(root, 'artifact.json'), JSON.stringify(artifact))
  return root
}

test('Pack verification binds artifact.json, archive bytes and the embedded manifest', (t) => {
  const expected = { products, nativePack, head, candidate: false }
  const verified = verifyPackOutput(packFixture(t), expected)
  assert.equal(verified.file, `dsh-px-pack-${products.pack.version}.tgz`)
  assert.throws(
    () =>
      verifyPackOutput(
        packFixture(t, (_m, _a, d) => {
          d.features[0].sha256 = '0'.repeat(64)
        }),
        expected
      ),
    /member digest/
  )
  assert.throws(
    () =>
      verifyPackOutput(
        packFixture(t, (_m, _a, d) => {
          d.features.pop()
        }),
        expected
      ),
    /five feature bundles/
  )
  assert.throws(() => verifyPackOutput(packFixture(t), { ...expected, candidate: true }), /artifact\.json/)
  assert.throws(
    () => verifyPackOutput(packFixture(t), { ...expected, head: 'c'.repeat(40) }),
    /artifact\.json/
  )
  const cases: Array<[string, (m: any, a: any) => void, RegExp]> = [
    ['wrong digest', (_m, a) => (a.sha256 = '0'.repeat(64)), /artifact\.json/],
    ['absolute path', (_m, a) => (a.artifact = 'C:\\build\\pack.tgz'), /artifact\.json/],
    ['wrong host', (m) => (m.dshPx.hostVersion = '0.2.0-rc.9'), /product contract/],
    ['wrong upstream', (m) => (m.dshPx.upstreamCommit = 'f'.repeat(40)), /product contract/],
    ['missing member', (m) => m.bundledDependencies.push('absent'), /bundled member/],
    [
      'dirty release',
      (m, a) => {
        m.dshPx.sourceDirty = true
        a.sourceDirty = true
      },
      /clean checkout/
    ]
  ]
  for (const [label, mutate, pattern] of cases)
    assert.throws(() => verifyPackOutput(packFixture(t, mutate), expected), pattern, label)
})

test('release directories are flat, manifested and verified by the controller before upload', (t) => {
  const root = temp(t, 'release-dir')
  const version = products.pack.version
  const primary = Buffer.from('synthetic pack archive')
  const artifact = {
    product: 'pack',
    version,
    file: `dsh-px-pack-${version}.tgz`,
    size: primary.length,
    sha256: hash(primary),
    sourceCommit: head,
    sourceDirty: false,
    candidate: false
  }
  const output = join(root, 'out')
  const manifest = writeReleaseDirectory(output, {
    product: 'pack',
    version,
    head,
    controllerSha,
    primary,
    artifact
  })
  assert.deepEqual(
    new Set(readdirSync(output)),
    new Set([artifact.file, 'artifact.json', 'release-manifest.json'])
  )
  assert.equal(manifest.release, `pack-v${version}`)
  const expected = { product: 'pack', head, version, controllerSha }
  assert.equal(verifyReleaseFiles(output, manifest, expected).length, 2)
  assert.throws(
    () => writeReleaseDirectory(output, { product: 'pack', version, head, controllerSha, primary, artifact }),
    /not be overwritten/
  )
  assert.throws(() => verifyReleaseFiles(output, manifest, { ...expected, product: 'desktop' }), /identity/)
  const yml = structuredClone(manifest)
  yml.files[1].name = 'latest.yml'
  assert.throws(() => verifyReleaseFiles(output, yml, expected), /not publishable/)
  const blockmap = structuredClone(manifest)
  blockmap.files[0].name = 'dsh-px-pack.tgz.blockmap'
  assert.throws(() => verifyReleaseFiles(output, blockmap, expected), /not publishable/)
  const legacy = structuredClone(manifest)
  legacy.release = `v${version}`
  assert.throws(() => verifyReleaseFiles(output, legacy, expected), /identity/)
  writeFileSync(join(output, 'artifact.json'), JSON.stringify({ ...artifact, candidate: true }))
  const recomputed = structuredClone(manifest)
  const changed = readFileSync(join(output, 'artifact.json'))
  recomputed.files[1].size = changed.length
  recomputed.files[1].sha256 = hash(changed)
  assert.throws(() => verifyReleaseFiles(output, recomputed, expected), /artifact\.json/)
})

test('Desktop inspection accepts exactly one full installer and a clean overlay of this commit', (t) => {
  const root = temp(t, 'desktop-dist')
  const version = products.desktop.version
  const exe = releaseAssetNames('desktop', version).installer
  writeFileSync(join(root, exe), Buffer.from([0x4d, 0x5a, 1, 2]))
  writeFileSync(join(root, 'preview.yml'), 'version: x\n')
  assert.equal(selectInstaller(root, version), join(root, exe))
  writeFileSync(join(root, exe + '.blockmap'), 'delta')
  assert.throws(() => selectInstaller(root, version), /blockmap/)
  rmSync(join(root, exe + '.blockmap'))
  writeFileSync(join(root, 'DSH-PX-Desktop-0.2.0-other-win-x64.exe'), 'x')
  assert.throws(() => selectInstaller(root, version), /exactly one installer/)
  rmSync(join(root, 'DSH-PX-Desktop-0.2.0-other-win-x64.exe'))
  const overlay = {
    upstream: nativeDesktop.commit,
    sourceCommit: head,
    sourceDirty: false,
    version,
    originalMainSha256: 'c'.repeat(64),
    mainSha256: 'd'.repeat(64),
    packSha256: 'f'.repeat(64)
  }
  const input = {
    installer: join(root, exe),
    overlay,
    products,
    nativeDesktop,
    head,
    authenticode: 'NotSigned'
  }
  const artifact = desktopArtifact(input)
  assert.equal(artifact.file, exe)
  assert.equal(artifact.upstreamCommit, nativeDesktop.commit)
  assert.equal(artifact.sha512.length, 88)
  // The Desktop record names the exact embedded Pack bytes.
  assert.equal(artifact.packSha256, 'f'.repeat(64))
  assert.throws(
    () => desktopArtifact({ ...input, overlay: { ...overlay, packSha256: undefined } }),
    /clean release/
  )
  assert.throws(
    () => desktopArtifact({ ...input, overlay: { ...overlay, sourceDirty: true } }),
    /clean release/
  )
  assert.throws(() => desktopArtifact({ ...input, overlay: { ...overlay, sourceCommit: 'e'.repeat(40) } }))
  assert.throws(() => desktopArtifact({ ...input, authenticode: 'HashMismatch' }), /Authenticode/)
})

test('a build-metadata version uses one encoded asset name for builder, selection and records', (t) => {
  const version = '1.2.3+build.1',
    encoded = releaseAssetNames('desktop', version).installer
  assert.equal(encoded, 'DSH-PX-Desktop-1.2.3_build.1-win-x64.exe')
  // The generated electron-builder config names the installer with the same helper.
  const source = readFileSync('scripts/prepare-native-desktop.mjs', 'utf8')
  assert.match(
    source,
    /config\.artifactName=\$\{JSON\.stringify\(releaseAssetNames\('desktop', products\.desktop\.version\)\.installer\)\}/
  )
  const root = mkdtempSync(join(tmpdir(), 'px-meta-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, encoded), Buffer.from([0x4d, 0x5a]))
  assert.equal(selectInstaller(root, version), join(root, encoded))
  // The Pack record names the published file, not the raw build output.
  const pack = join(root, 'dsh-px-pack-1.2.3+build.1.tgz')
  writeFileSync(pack, 'pack')
  const record = packArtifact(
    { file: 'dsh-px-pack-1.2.3+build.1.tgz', path: pack, manifest: { dshPx: { sourceCommit: head } } },
    { pack: { version }, protocolGeneration: 2 },
    { hostVersion: '0.2.0-rc.1', upstreamCommit: 'c'.repeat(40) }
  )
  assert.equal(record.file, releaseAssetNames('pack', version).pack)
})

test('the packaged app.asar inventory is read from its header', (t) => {
  // An asar archive: a pickle of the size words, then the length-prefixed JSON directory tree.
  const tree = {
    files: {
      lib: { files: { 'px-updates.mjs': { size: 1, offset: '0' } } },
      node_modules: { files: { 'electron-updater': { files: { 'package.json': { size: 2, offset: '1' } } } } }
    }
  }
  const json = Buffer.from(JSON.stringify(tree))
  const padded = Math.ceil(json.length / 4) * 4
  const header = Buffer.alloc(16 + padded)
  header.writeUInt32LE(4, 0)
  header.writeUInt32LE(8 + padded, 4)
  header.writeUInt32LE(4 + padded, 8)
  header.writeUInt32LE(json.length, 12)
  json.copy(header, 16)
  const root = mkdtempSync(join(tmpdir(), 'px-asar-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const archive = join(root, 'app.asar')
  writeFileSync(archive, Buffer.concat([header, Buffer.from('xyz')]))
  assert.deepEqual([...asarEntries(archive)].sort(), [
    'lib/px-updates.mjs',
    'node_modules/electron-updater/package.json'
  ])
  writeFileSync(archive, Buffer.alloc(8))
  assert.throws(() => asarEntries(archive), /too short/)
})
