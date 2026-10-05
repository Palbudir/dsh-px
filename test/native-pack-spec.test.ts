import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { sameArchiveSpec } = await import(pathToFileURL(resolve('scripts/native-pack-spec.mjs')).href)

test('the aggregate Pack install check accepts only file: specs naming the installed archive', (t) => {
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
})
