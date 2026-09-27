import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const load = (name: string): Promise<any> => import(pathToFileURL(resolve('scripts', name)).href)
const { releaseAssetNames } = await load('release-version.mjs')
const { prepareReleaseArtifacts } = await load('release-package.mjs')
const { verifyReleaseFiles } = await load('release-controller.mjs')
const head = 'a'.repeat(40),
  controllerSha = 'b'.repeat(40),
  date = '2026-09-28T00:00:00.000Z'
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function fixture(t: any, version: string) {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-release-assets-'))
  const dist = join(root, 'dist'),
    installer = `DSH-PX Setup ${version}.exe`,
    zip = `DSH-PX-${version}-win.zip`
  mkdirSync(dist)
  const setup = Buffer.from([0x4d, 0x5a, 0, 0xff, 0x31]),
    blockmap = Buffer.from('synthetic blockmap'),
    zipped = Buffer.from('PK synthetic zip')
  const digest = createHash('sha512').update(setup).digest('base64')
  const rawFeed = `version: ${JSON.stringify(version)}\nfiles:\n  - url: ${JSON.stringify(installer)}\n    sha512: ${digest}\n    size: ${setup.length}\npath: ${JSON.stringify(installer)}\nsha512: ${digest}\nreleaseDate: ${JSON.stringify(date)}\n`
  for (const [name, bytes] of [
    [installer, setup],
    [installer + '.blockmap', blockmap],
    [zip, zipped],
    ['latest.yml', Buffer.from(rawFeed)]
  ] as const)
    writeFileSync(join(dist, name), bytes)
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  return { root, dist, installer, zip, setup, blockmap, zipped, rawFeed }
}

test('release asset names use only stable GitHub-safe characters and preserve SemVer build metadata without collisions', () => {
  const versions = [
    '1.2.3',
    '0.1.0-beta.re.0.11',
    '1.2.3+build.001',
    '1.2.3-build.1',
    '1.2.3-alpha+build.1',
    '1.2.3-alpha.build.1',
    '1.2.3-alpha-build.1'
  ]
  const installers = new Set<string>()
  for (const version of versions) {
    const names = releaseAssetNames(version)
    assert.deepEqual(names, {
      installer: `DSH-PX-Setup-${version.replace('+', '_')}.exe`,
      blockmap: `DSH-PX-Setup-${version.replace('+', '_')}.exe.blockmap`,
      zip: `DSH-PX-${version.replace('+', '_')}-win.zip`,
      metadata: 'latest.yml'
    })
    for (const name of Object.values(names)) assert.doesNotMatch(String(name), /[^0-9A-Za-z._-]/)
    installers.add(names.installer)
  }
  assert.equal(installers.size, versions.length)
  for (const invalid of [
    '../1.0.0',
    '1.0.0 bad',
    '1.0.0\n',
    '1.0.0\r',
    '1.0.0_build',
    '01.0.0',
    '1.0.0-01',
    '1.0.0+'
  ])
    assert.throws(() => releaseAssetNames(invalid), /Invalid/)
})

for (const version of ['0.1.0-beta.re.0.11', '1.2.3-rc.2+win.001']) {
  test(`artifact copy, manifest and update feed share canonical names while raw dist remains intact: ${version}`, (t) => {
    const f = fixture(t, version),
      names = releaseAssetNames(version)
    const original = new Map(readdirSync(f.dist).map((name) => [name, readFileSync(join(f.dist, name))]))
    const manifest = prepareReleaseArtifacts(f.dist, { head, version, controllerSha }, date)
    const output = join(f.dist, 'release-artifacts')
    assert.deepEqual(
      new Set(readdirSync(output)),
      new Set([...Object.values(names), 'release-manifest.json'])
    )
    assert.deepEqual(
      manifest.files.map((file: any) => file.name),
      Object.values(names)
    )
    assert.deepEqual(JSON.parse(readFileSync(join(output, 'release-manifest.json'), 'utf8')), manifest)
    assert.deepEqual(readFileSync(join(output, names.installer)), f.setup)
    assert.deepEqual(readFileSync(join(output, names.blockmap)), f.blockmap)
    assert.deepEqual(readFileSync(join(output, names.zip)), f.zipped)
    assert.equal(verifyReleaseFiles(output, manifest, { head, version, controllerSha }).length, 4)
    const feed = readFileSync(join(output, names.metadata), 'utf8')
    assert.ok(
      feed.includes(`version: ${JSON.stringify(version)}\n`),
      'metadata keeps the original SemVer including build metadata'
    )
    assert.ok(feed.includes(`url: ${JSON.stringify(names.installer)}\n`))
    assert.ok(feed.includes(`path: ${JSON.stringify(names.installer)}\n`))
    for (const [name, bytes] of original)
      assert.deepEqual(readFileSync(join(f.dist, name)), bytes, 'raw build output must not be rewritten')
    assert.equal(readFileSync(join(f.dist, 'latest.yml'), 'utf8'), f.rawFeed)
    assert.equal(readFileSync(join(f.dist, f.installer)).length, f.setup.length)
    const preparedHashes = readdirSync(output).map((name) => [name, hash(readFileSync(join(output, name)))])
    assert.throws(
      () => prepareReleaseArtifacts(f.dist, { head, version, controllerSha }, date),
      /not be overwritten/
    )
    assert.deepEqual(
      readdirSync(output).map((name) => [name, hash(readFileSync(join(output, name)))]),
      preparedHashes
    )
  })
}

test('strict release verification rejects unsafe old names, GitHub-rewritten names and inconsistent companion names', (t) => {
  const version = '1.0.0+build.1',
    f = fixture(t, version),
    names = releaseAssetNames(version)
  const manifest = prepareReleaseArtifacts(f.dist, { head, version, controllerSha }, date)
  const output = join(f.dist, 'release-artifacts')
  for (const unsafe of [
    `DSH-PX Setup ${version}.exe`,
    `DSH-PX.Setup.${version}.exe`,
    `DSH-PX-Setup-${version}.exe`,
    'DSH-PX-Setup-1.0.0.exe'
  ]) {
    const changed = structuredClone(manifest)
    changed.files.find((file: any) => file.name === names.installer).name = unsafe
    assert.throws(() => verifyReleaseFiles(output, changed, { head, version, controllerSha }), /inventory/)
  }
  const wrongBlockmap = structuredClone(manifest)
  wrongBlockmap.files.find((file: any) => file.name === names.blockmap).name = 'other.exe.blockmap'
  assert.throws(
    () => verifyReleaseFiles(output, wrongBlockmap, { head, version, controllerSha }),
    /inventory/
  )
  const rawZip = structuredClone(manifest)
  rawZip.files.find((file: any) => file.name === names.zip).name = f.zip
  assert.throws(() => verifyReleaseFiles(output, rawZip, { head, version, controllerSha }), /inventory/)
})

test('a feed pointing to the raw installer is rejected even with a recomputed manifest digest', (t) => {
  const version = '1.0.0',
    f = fixture(t, version)
  const manifest = prepareReleaseArtifacts(f.dist, { head, version, controllerSha }, date)
  const output = join(f.dist, 'release-artifacts')
  writeFileSync(join(output, 'latest.yml'), f.rawFeed)
  const metadata = manifest.files.find((file: any) => file.name === 'latest.yml')
  const bytes = readFileSync(join(output, 'latest.yml'))
  metadata.size = bytes.length
  metadata.sha256 = hash(bytes)
  assert.throws(() => verifyReleaseFiles(output, manifest, { head, version, controllerSha }), /metadata/)
})
