import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { provisionNativePack } from '../src/main/native-pack-provision'

const { sameArchiveSpec } = await import(pathToFileURL(resolve('scripts/native-pack-spec.mjs')).href)

test('the CI Pack install check accepts exactly the dependency specs first start accepts', async (t) => {
  const profile = mkdtempSync(join(tmpdir(), 'px-spec-'))
  t.after(() => rmSync(profile, { recursive: true, force: true }))
  const archive = join(profile, '.dsh-px', 'pack-' + 'a'.repeat(64) + '.tgz')
  const forward = archive.replaceAll('\\', '/')
  const relative = 'file:./.dsh-px/pack-' + 'a'.repeat(64) + '.tgz'
  const cases: Array<[unknown, boolean]> = [
    ['file:' + forward, true],
    ['file:' + archive, true],
    [relative, true],
    [forward, false],
    ['link:' + forward, false],
    ['0.2.0-alpha.1', false],
    ['file:' + forward + '.other', false],
    [undefined, false],
    [42, false]
  ]
  for (const [spec, expected] of cases)
    assert.equal(sameArchiveSpec(spec, archive, profile), expected, String(spec))
  assert.equal(sameArchiveSpec('file:' + forward.toUpperCase(), archive, profile, 'win32'), true)
  assert.equal(sameArchiveSpec('file:' + forward.toUpperCase(), archive, profile, 'linux'), false)
  // The same specs, recorded by an install stub, are exactly the ones first start accepts.
  for (const [spec, expected] of cases.filter(([s]) => typeof s === 'string')) {
    const dir = mkdtempSync(join(tmpdir(), 'px-spec-run-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }))
      const bundle = join(dir, 'bundled.tgz')
      writeFileSync(bundle, 'archive')
      const sha256 = (await import('node:crypto')).createHash('sha256').update('archive').digest('hex')
      const cached = join(dir, '.dsh-px', `pack-${sha256}.tgz`)
      const result = await provisionNativePack({
        profile: dir,
        archive: bundle,
        version: '0.2.0',
        sha256,
        log: () => {},
        install: async () => {
          const value = String(spec)
            .replace(
              join(profile, '.dsh-px', 'pack-' + 'a'.repeat(64) + '.tgz').replaceAll('\\', '/'),
              cached.replaceAll('\\', '/')
            )
            .replace(archive, cached)
            .replace('./.dsh-px/pack-' + 'a'.repeat(64) + '.tgz', `./.dsh-px/pack-${sha256}.tgz`)
          writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'dsh-px-pack': value } }))
          mkdirSync(join(dir, 'node_modules/dsh-px-pack'), { recursive: true })
          writeFileSync(
            join(dir, 'node_modules/dsh-px-pack/package.json'),
            JSON.stringify({ name: 'dsh-px-pack', version: '0.2.0' })
          )
          assert.equal(sameArchiveSpec(value, cached, dir), expected, 'gate on ' + value)
        }
      })
      assert.equal(result === 'installed', expected, 'first start on ' + String(spec))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
