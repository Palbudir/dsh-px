import test from 'node:test'
import assert from 'node:assert/strict'
import { saveObservedFile } from '../packages/dsh-px-workbench/src/file-edit'

function fixture() {
  let value: string | undefined = 'base',
    version = 1,
    writes = 0,
    race = false
  const fs = {
    resolve: async (path: string) => path,
    stat: async () =>
      value === undefined
        ? undefined
        : { type: 'file', version: String(version), size: Buffer.byteLength(value) },
    readText: async () => value,
    writeText: async (_path: string, text: string, guard: any) => {
      if (race) version++
      if (guard.kind === 'replaceIfVersion' && (value === undefined || guard.version !== String(version)))
        throw Object.assign(Error('changed'), { code: 'FS_STALE_VERSION' })
      if (guard.kind === 'createIfAbsent' && value !== undefined)
        throw Object.assign(Error('exists'), { code: 'FS_NOT_OBSERVED' })
      value = text
      version++
      writes++
    }
  }
  return {
    fs,
    get value() {
      return value
    },
    get writes() {
      return writes
    },
    external(text: string | undefined) {
      value = text
      version++
    },
    race() {
      race = true
    }
  }
}
test('manual editor rejects a changed or deleted base without writing, then accepts a fresh base', async () => {
  const f = fixture()
  f.external('external')
  await assert.rejects(saveObservedFile(f.fs, '/w', '/w/a', 'mine', 'base'), (e: any) => e.status === 409)
  assert.equal(f.value, 'external')
  assert.equal(f.writes, 0)
  await saveObservedFile(f.fs, '/w', '/w/a', 'merged', 'external')
  assert.equal(f.value, 'merged')
  f.external(undefined)
  await assert.rejects(
    saveObservedFile(f.fs, '/w', '/w/a', 'restore', 'merged'),
    (e: any) => e.status === 409
  )
  assert.equal(f.value, undefined)
})
test('manual editor requires observation for replacement, supports empty files and native version conflicts', async () => {
  const f = fixture()
  await assert.rejects(saveObservedFile(f.fs, '/w', '/w/a', 'blind', undefined), (e: any) => e.status === 409)
  await saveObservedFile(f.fs, '/w', '/w/a', '', 'base')
  assert.equal(f.value, '')
  f.race()
  await assert.rejects(saveObservedFile(f.fs, '/w', '/w/a', 'late', ''), (e: any) => e.status === 409)
  assert.equal(f.value, '')
  const fresh = fixture()
  fresh.external(undefined)
  await saveObservedFile(fresh.fs, '/w', '/w/new', '', undefined)
  assert.equal(fresh.value, '')
})
