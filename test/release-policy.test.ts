import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const load = (name: string): Promise<any> => import(pathToFileURL(resolve('scripts', name)).href)
const { assertNewerVersion, assertLegacyLatest, LEGACY_LATEST_TAG } = await load('release-version.mjs')
const { archiveMemberNames, verifyReleaseFiles } = await load('release-assets.mjs')
const { validateCatalog } = await load('release-catalog.mjs')
const head = 'a'.repeat(40),
  base = 'b'.repeat(40)
test('versions are monotonic per product prefix; history tags and drafts are not compared', () => {
  const history = [
    { tag_name: 'v0.1.0-beta.re.0.11', draft: false },
    { tag_name: 'v9.9.9', draft: false },
    { tag_name: 'pack-v0.2.0-alpha.3', draft: false },
    { tag_name: 'desktop-v0.2.0-alpha.1', draft: false },
    { tag_name: 'desktop-v0.2.0-alpha.9', draft: true }
  ]
  assertNewerVersion('desktop', '0.2.0-alpha.2', history)
  assertNewerVersion('pack', '0.2.0-alpha.4', history)
  assert.throws(() => assertNewerVersion('desktop', '0.2.0-alpha.1', history), /not newer/)
  assert.throws(() => assertNewerVersion('pack', '0.2.0-alpha.2', history), /not newer/)
  assert.throws(
    () => assertNewerVersion('pack', '0.2.1', [{ tag_name: 'pack-vbroken', draft: false }]),
    /invalid tag/
  )
})

test('the legacy Latest release must stay the unchanged legacy-shell prerelease-free tag', () => {
  assert.equal(LEGACY_LATEST_TAG, 'v0.1.0-beta.re.0.11')
  assertLegacyLatest({ tag_name: LEGACY_LATEST_TAG, prerelease: false, draft: false })
  for (const latest of [
    null,
    { tag_name: 'desktop-v0.2.0-alpha.1', prerelease: true },
    { tag_name: 'pack-v0.2.0-alpha.1', prerelease: false },
    { tag_name: LEGACY_LATEST_TAG, prerelease: true }
  ])
    assert.throws(() => assertLegacyLatest(latest), /GitHub Latest must remain/)
})

test('release archives reject traversal and payload identities fail before any publication', () => {
  assert.deepEqual(
    archiveMemberNames(
      'Path = archive.zip\nPath = release-manifest.json\nPath = artifact.json',
      'archive.zip'
    ),
    ['release-manifest.json', 'artifact.json']
  )
  assert.throws(
    () => archiveMemberNames('Path = archive.zip\nPath = ../signing-key.pem', 'archive.zip'),
    /unsafe/
  )
  assert.throws(
    () => archiveMemberNames('Path = a.zip\nPath = artifact.json\nSymbolic Link = secret', 'a.zip'),
    /links/
  )
  assert.throws(
    () =>
      verifyReleaseFiles(
        'unused',
        { schemaVersion: 1, head, version: '1.0.0', files: [] },
        { product: 'pack', head, version: '1.0.0', controllerSha: base }
      ),
    /identity/
  )
})
test('roadmap catalog rejects stale status, duplicate IDs and missing dependencies', () => {
  const feature = {
    phase: '短期',
    category: '可靠性',
    name: 'Feature',
    priority: 'P1',
    utility: 5,
    difficulty: 2,
    fit: 5,
    effort: '1d',
    intro: 'Spec',
    subtasks: ['One step'],
    acceptance: 'Result',
    route: 'plugin',
    dependencies: []
  }
  const catalog = {
    schemaVersion: 2,
    purpose: 'Specifications',
    statusAuthority: '../ROADMAP.md',
    scoring: { utility: '1–5', difficulty: '1–5', fit: '1–5' },
    features: Array.from({ length: 100 }, (_, i) => ({ ...feature, id: 'F' + i }))
  }
  assert.equal(validateCatalog(catalog).features, 100)
  const duplicate = structuredClone(catalog)
  duplicate.features[1].id = 'F0'
  assert.throws(() => validateCatalog(duplicate), /Duplicate/)
  const stale: any = structuredClone(catalog)
  stale.features[0].status = 'old'
  assert.throws(() => validateCatalog(stale), /stale/)
  const missing: any = structuredClone(catalog)
  missing.features[0].dependencies = ['absent']
  assert.throws(() => validateCatalog(missing), /dependency/)
})
