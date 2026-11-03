import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { nativeHistoryScope } from '../packages/dsh-px-memory/src/native-history-policy'

test('authorization snapshots are immutable and invalidate on same-tick writes and external replacement', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-auth-snapshot-')),
    path = join(root, 'memory.json'),
    store = new MemoryStore(path)
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  store.bind('a', { locked: true })
  store.bind('prior', { locked: true })
  const scope = nativeHistoryScope(store, { session: { id: 'a', header: { id: 'a' } } }, 'session_event_read')
  const first = store.authorizationSnapshot()
  assert.equal(store.authorizationSnapshot(), first)
  assert.ok(Object.isFrozen(first.bindings.a))
  assert.throws(() => {
    first.bindings.a.locked = false
  }, TypeError)
  const editable = store.read()
  editable.bindings.a.locked = false
  assert.equal(store.authorizationSnapshot().bindings.a.locked, true)
  assert.equal(scope.allows('prior'), true)
  store.change(store.read().revision, (s) => {
    s.personas[0].memoryEnabled = false
  })
  assert.equal(scope.allows('prior'), false, 'no microtask delay after revocation')
  assert.notEqual(store.authorizationSnapshot(), first)
  const external = store.read()
  external.personas[0].memoryEnabled = true
  writeFileSync(path + '.external', JSON.stringify(external))
  renameSync(path + '.external', path)
  assert.equal(scope.allows('prior'), true, 'replacement invalidates cached file identity')
  writeFileSync(path + '.external', 'invalid json')
  renameSync(path + '.external', path)
  assert.throws(() => store.authorizationSnapshot())
  assert.equal(scope.allows('prior'), false, 'corruption cannot return the old allowed state')
})
