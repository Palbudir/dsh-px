import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { nativeHistoryGuard, nativeHistoryScope } from '../packages/dsh-px-memory/src/native-history-policy'

test('native raw event tools cannot bypass persona, conversation and history-off boundaries', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-native-history-')),
    store = new MemoryStore(join(root, 'memory.json'))
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  const b = store.createPersona('B')
  store.bind('a', { locked: true })
  store.bind('a-old', { locked: true })
  store.bind('b', { personaId: b.id, locked: true })
  store.bind('blank')
  const agent = { session: { id: 'a', header: { id: 'a' } } },
    guard = (name: string, args: any) => nativeHistoryGuard(store, { agent, name, arguments: args })
  for (const name of ['session_event_read', 'session_event_search', 'session_event_trace']) {
    assert.equal(guard(name, {}), undefined)
    assert.equal(guard(name, { session_id: 'a-old' }), undefined)
    assert.match(guard(name, { session_id: 'b' })!, /不属于/)
    assert.match(guard(name, { session_id: 'blank' })!, /不属于/)
    assert.match(guard(name, { session_id: 'unknown' })!, /不属于/)
  }
  assert.match(guard('session_search', { query: 'private' })!, /限定/)
  assert.match(guard('session_search', { query: 'private', session_ids: ['a-old', 'b'] })!, /限定/)
  assert.equal(guard('session_search', { query: 'own', session_ids: ['a-old'] }), undefined)
  const captured = nativeHistoryScope(store, agent, 'session_event_read')
  assert.ok(captured.ids.includes('a-old'))
  assert.ok(!captured.ids.includes('b'))
  assert.equal(captured.allows('b'), false)
  store.bind('new-own', { locked: true })
  assert.equal(captured.allows('new-own'), false, 'new ids cannot silently widen a cursor query')
  let state = store.read()
  store.action(
    state.revision,
    { type: 'configure', name: '默认助手', instructions: '', memoryEnabled: false },
    'a',
    root
  )
  await Promise.resolve()
  assert.equal(captured.allows('a-old'), false, 'revocation is checked after asynchronous reads')
  assert.equal(captured.allows('a'), true)
  assert.equal(guard('session_event_read', {}), undefined)
  assert.match(guard('session_event_read', { session_id: 'a-old' })!, /不属于/)
  const channel = {
    provider: 'qq',
    accountId: '12001',
    conversationId: 'group:30001',
    access: 'public' as const,
    publicInstructions: ''
  }
  store.bind('public', { channel, locked: true })
  store.bind('other-group', { channel: { ...channel, conversationId: 'group:30002' }, locked: true })
  assert.match(
    nativeHistoryGuard(store, {
      name: 'session_event_read',
      agent: { session: { id: 'public', header: { id: 'public' } } },
      arguments: { session_id: 'other-group' }
    })!,
    /不属于/
  )
})
