import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { retryTransient, writeAtomic } from '../src/main/native-atomic'

test('atomic writes retry transient errors a bounded number of times and never leave temporaries', () => {
  let calls = 0
  assert.equal(
    retryTransient(() => {
      if (++calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      return 'ok'
    }, true),
    'ok'
  )
  assert.equal(calls, 3)
  calls = 0
  assert.throws(
    () =>
      retryTransient(() => {
        calls++
        throw Object.assign(new Error('denied'), { code: 'EPERM' })
      }, true),
    /denied/
  )
  assert.equal(calls, 9)
  calls = 0
  assert.throws(() =>
    retryTransient(() => {
      calls++
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }, true)
  )
  assert.equal(calls, 1)
  const root = mkdtempSync(join(tmpdir(), 'px-atomic-'))
  try {
    const target = join(root, 'dir-target')
    mkdirSync(target)
    assert.throws(() => writeAtomic(target, 'x'), /regular file/)
    writeAtomic(join(root, 'file'), 'content')
    assert.equal(readFileSync(join(root, 'file'), 'utf8'), 'content')
    assert.deepEqual(readdirSync(root).sort(), ['dir-target', 'file'])
    // Cleanup after a completed rename would only fail on the missing temporary (e.g. EBUSY); it is skipped.
    const busyRemove = (): void => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    }
    writeAtomic(join(root, 'file'), 'next', { rename: renameSync, remove: busyRemove })
    assert.equal(readFileSync(join(root, 'file'), 'utf8'), 'next')
    // A failed rename still removes its temporary.
    const removed: string[] = []
    assert.throws(
      () =>
        writeAtomic(join(root, 'file'), 'lost', {
          rename: () => {
            throw Object.assign(new Error('locked'), { code: 'EPERM' })
          },
          remove: (path) => {
            removed.push(path)
            rmSync(path, { force: true })
          }
        }),
      /locked/
    )
    assert.equal(removed.length, 1)
    assert.equal(readFileSync(join(root, 'file'), 'utf8'), 'next')
    assert.deepEqual(readdirSync(root).sort(), ['dir-target', 'file'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
