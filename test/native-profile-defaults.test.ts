import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { prepareNativeProfileDefaults } from '../src/main/native-profile-defaults'

test('native profile defaults provide a complete loopback config and isolated document path', () => {
  const profile = mkdtempSync(join(tmpdir(), 'px-native-defaults-'))
  try {
    const documents = join(profile, 'documents with spaces')
    assert.equal(prepareNativeProfileDefaults(profile, documents), true)
    const content = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.match(content, /host: 127\.0\.0\.1\n    port: 0/)
    assert.ok(content.includes('documentsDirectory: ' + JSON.stringify(documents)))
    assert.equal(prepareNativeProfileDefaults(profile, join(profile, 'other')), false)
    assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), content)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('native defaults preserve existing profiles and reject relative paths before writing', () => {
  const profile = mkdtempSync(join(tmpdir(), 'px-native-preserve-'))
  try {
    assert.throws(() => prepareNativeProfileDefaults(profile, 'relative'), /absolute/)
    writeFileSync(join(profile, 'package.json'), '{"private":true}')
    assert.equal(prepareNativeProfileDefaults(profile, join(profile, 'documents')), false)
    assert.throws(() => readFileSync(join(profile, 'cordis.patch.yml')), /ENOENT/)
    writeFileSync(join(profile, 'cordis.patch.yml'), '# user-owned\n')
    assert.equal(prepareNativeProfileDefaults(profile, join(profile, 'documents')), false)
    assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), '# user-owned\n')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})
