import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { MemoryStore, memoryContext } from '../packages/dsh-px-memory/src/store'
import { HistoryIndex } from '../packages/dsh-px-memory/src/history'
import { HotMemory, type HotMemoryCaller } from '../packages/dsh-px-memory/src/hot-memory'

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'px-hot-memory-')),
    file = join(root, 'memory.json'),
    store = new MemoryStore(file)
  store.bind('a', { locked: true })
  store.bind('b', { personaId: store.createPersona('B').id, locked: true })
  store.bind('public', {
    channel: {
      provider: 'qq',
      accountId: '12001',
      conversationId: 'group:30001',
      access: 'public',
      publicInstructions: '',
      workspace: root
    },
    locked: true
  })
  const events: any[] = [
    {
      seq: 0,
      time: 1000,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Remember the old preference.' }] }
    },
    {
      seq: 1,
      time: 2000,
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Correct it to the new preference.' }]
      }
    },
    { seq: 2, time: 2001, type: 'tool/call', data: { callId: 'verify-1', name: 'verify', arguments: {} } },
    {
      seq: 3,
      time: 2002,
      type: 'tool/result',
      data: {
        message: {
          role: 'tool',
          toolCallId: 'verify-1',
          isError: false,
          content: [{ type: 'text', text: 'Confirmed execution output 731' }]
        }
      }
    }
  ]
  const host = {
    sessions: {
      get: (id: string) => ({ header: { id, cwd: root }, snapshotEvents: (at = 0) => events.slice(at) })
    }
  }
  const history = new HistoryIndex(join(root, 'history.sqlite'), store)
  let beforeRead: (() => Promise<void>) | undefined
  const reader = async (caller: string, source: string, seq: number, signal?: AbortSignal) => {
    await beforeRead?.()
    return history.read(host, caller, source, seq, 0, signal)
  }
  let hot = new HotMemory(store, join(root, 'feedback.sqlite'), reader)
  const human: HotMemoryCaller = { sessionId: 'a', project: root, actor: 'human' },
    model = { ...human, actor: 'model' as const }
  t.after(async () => {
    hot.close()
    await history.close()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    file,
    store,
    human,
    model,
    get hot() {
      return hot
    },
    readHook: (fn: () => Promise<void>) => {
      beforeRead = fn
    },
    reopen: () => {
      hot.close()
      hot = new HotMemory(store, join(root, 'feedback.sqlite'), reader)
    },
    current: () => store.persona(store.read(), 'a'),
    save: (text: string, id?: string) =>
      hot.save(human, store.read().revision, { text, id, scope: 'persona' }, [
        { sessionId: 'a', seq: id ? 1 : 0 }
      ])
  }
}

test('hot memories retain revisioned source pointers; duplicate feedback ranks but cannot confirm or revive old text', async (t) => {
  const f = fixture(t)
  await f.save('OLD_HIGH_PRIORITY')
  const old = f.current().memories[0],
    snapshot = f.current()
  await f.save('NEWER_OTHER_ENTRY')
  const input = { id: old.id, entryRevision: 1, kind: 'confirmed' as const, reason: '用户核对' }
  assert.equal((await f.hot.judge(f.human, input)).duplicate, false)
  assert.equal((await f.hot.judge(f.human, input)).duplicate, true)
  assert.equal(f.hot.project(f.current(), 'model', true).memories[0].id, old.id)
  assert.equal(f.current().memories.find((m) => m.id === old.id)?.provenance?.actor, 'human')
  assert.equal(old.provenance?.events[0].seq, 0)
  f.reopen()
  assert.equal(f.hot.project(f.current(), 'human').memories.find((m) => m.id === old.id)?.feedback?.count, 1)
  await f.hot.judge(f.human, { ...input, kind: 'disputed' })
  assert.ok(!memoryContext(f.hot.project(snapshot, 'model', true), f.root).includes('OLD_HIGH_PRIORITY'))
  await f.save('CORRECT_CURRENT', old.id)
  const current = f.current().memories.find((m) => m.id === old.id)!
  assert.equal(current.entryRevision, 2)
  assert.equal(current.previous?.provenance?.events[0].seq, 0)
  assert.equal(current.provenance?.events[0].seq, 1)
  assert.equal(
    f.hot.project(f.current(), 'model', true).memories.find((m) => m.id === old.id)?.feedback?.count,
    0
  )
  assert.ok(
    !memoryContext(f.hot.project(snapshot, 'model', true), f.root).includes('OLD_HIGH_PRIORITY'),
    'frozen identity cannot re-inject a corrected entry'
  )
  await assert.rejects(f.hot.judge(f.human, input), /已被修改/)
  await f.hot.save(f.human, f.store.read().revision, { id: old.id, text: 'MANUAL_THIRD', scope: 'persona' })
  await f.hot.save(f.human, f.store.read().revision, { id: old.id, text: 'MANUAL_FOURTH', scope: 'persona' })
  f.reopen()
  const later = f.current().memories.find((m) => m.id === old.id)!
  assert.equal(later.entryRevision, 4)
  assert.equal(later.previous?.entryRevision, 3)
  assert.equal(later.previous?.provenance?.events.length, 0)
  assert.equal(later.origin?.entryRevision, 1)
  assert.equal(later.origin?.provenance?.events[0].seq, 0, 'multiple edits retain original source anchor')
})

test('late hot-memory writes and feedback cannot resurrect a forgotten entry; persona and public scopes hold', async (t) => {
  const f = fixture(t)
  await f.save('FORGET_ME')
  const old = f.current().memories[0],
    revision = f.store.read().revision
  let release!: () => void
  f.readHook(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const pending = f.hot.judge(f.model, {
    id: old.id,
    entryRevision: 1,
    kind: 'useful',
    reason: '应用反馈',
    evidence: { sessionId: 'a', seq: 3 }
  })
  f.store.action(revision, { type: 'forget', id: old.id }, 'a', f.root)
  release()
  await assert.rejects(pending, /不属于/)
  await assert.rejects(
    f.hot.save(f.human, revision, { id: old.id, text: 'late rewrite', scope: 'persona' }),
    /已变化/
  )
  assert.deepEqual(f.current().memories, [])
  await assert.rejects(
    f.hot.judge(
      { ...f.human, sessionId: 'b' },
      { id: old.id, entryRevision: 1, kind: 'confirmed', reason: 'wrong owner' }
    ),
    /不属于/
  )
  await assert.rejects(
    f.hot.save({ ...f.human, sessionId: 'public' }, f.store.read().revision, {
      text: 'private leak',
      scope: 'persona'
    }),
    /私有约定/
  )
})

test('human management while memory is off does not enable model reads or writes; legacy provenance stays unknown', async (t) => {
  const f = fixture(t)
  await f.save('LEGACY')
  const json = JSON.parse(readFileSync(f.file, 'utf8')),
    old = json.personas[0].memories[0]
  delete old.entryRevision
  delete old.provenance
  old.feedback = { confirmed: true, strength: 999, count: 999, disputed: false }
  writeFileSync(f.file, JSON.stringify(json))
  const projected = f.hot.project(f.current(), 'human').memories[0]
  assert.equal(projected.provenance?.actor, 'unknown')
  assert.equal(projected.feedback?.strength, 0)
  const snapshot = f.current()
  f.store.action(
    f.store.read().revision,
    { type: 'configure', name: '默认助手', instructions: '', memoryEnabled: false },
    'a',
    f.root
  )
  await f.save('HUMAN_MANAGED_WHILE_OFF', old.id)
  assert.equal(f.current().memoryEnabled, false)
  assert.deepEqual(f.hot.project(snapshot, 'model', true).memories, [])
  await assert.rejects(
    f.hot.save(f.model, f.store.read().revision, { text: 'not allowed', scope: 'persona', actor: 'human' }),
    /已关闭/
  )
  await assert.rejects(
    f.hot.judge(f.model, { id: old.id, entryRevision: 2, kind: 'confirmed', reason: 'self confirmation' }),
    /已关闭/
  )
})
