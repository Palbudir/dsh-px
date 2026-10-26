import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { MemoryStore, type SessionChannel } from '../packages/dsh-px-memory/src/store'
import { HistoryIndex } from '../packages/dsh-px-memory/src/history'
import { KnowledgeBank } from '../packages/dsh-px-memory/src/knowledge'

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'px-channel-memory-'))
  const store = new MemoryStore(join(dir, 'memory.json'))
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  let state = store.action(0, { type: 'create', name: 'Channel persona' }, 'owner', dir)
  state = store.action(
    state.revision,
    {
      type: 'configure',
      name: 'Channel persona',
      instructions: 'PRIVATE_INSTRUCTIONS',
      memoryEnabled: true
    },
    'owner',
    dir
  )
  state = store.action(
    state.revision,
    {
      type: 'save',
      scope: 'persona',
      text: 'PRIVATE_MEMORY'
    },
    'owner',
    dir
  )
  const personaId = state.bindings.owner.personaId
  const channel: SessionChannel = {
    provider: 'qq',
    accountId: 'account-a',
    conversationId: 'group-a',
    access: 'public',
    publicInstructions: 'PUBLIC_INTRODUCTION'
  }
  store.bind('group-a', { personaId, channel, locked: true })
  store.bind('group-a-old', { personaId, channel, locked: true })
  store.bind('group-b', { personaId, channel: { ...channel, conversationId: 'group-b' }, locked: true })
  return { dir, store, personaId, channel }
}

test('creating a channel persona does not create a phantom native session or silently reuse a name', (t) => {
  const { store } = fixture(t),
    before = store.read()
  const created = store.createPersona('A new QQ identity')
  assert.equal(store.read().personas.find((p) => p.id === created.id)?.name, 'A new QQ identity')
  assert.deepEqual(Object.keys(store.read().bindings), Object.keys(before.bindings))
  const revision = store.read().revision
  assert.throws(() => store.createPersona('A new QQ identity'), /同名/)
  assert.equal(store.read().revision, revision)
})

test('public channel projection omits private instructions, memories and prior persona revisions', (t) => {
  const { store } = fixture(t)
  const publicPersona = store.persona(store.read(), 'group-a')
  assert.equal(publicPersona.instructions, 'PUBLIC_INTRODUCTION')
  assert.equal(publicPersona.memoryEnabled, false)
  assert.equal(JSON.stringify(publicPersona).includes('PRIVATE_'), false)
  assert.deepEqual(publicPersona.memories, [])
  assert.deepEqual(publicPersona.versions, [])
  const ownerPersona = store.persona(store.read(), 'owner')
  assert.equal(ownerPersona.instructions, 'PRIVATE_INSTRUCTIONS')
  assert.equal(ownerPersona.memories[0].text, 'PRIVATE_MEMORY')
})

test('public recall never reads another group or private native session, including a cached owner index', async (t) => {
  const { dir, store } = fixture(t)
  const index = new HistoryIndex(join(dir, 'history.sqlite'), store)
  const reads: string[] = []
  const host = {
    sessions: {
      get(id: string) {
        reads.push(id)
        return { header: { id, cwd: dir }, snapshotEvents: () => [] }
      }
    }
  }
  try {
    await index.refresh(host, 'owner')
    assert.ok(reads.includes('owner') && reads.includes('group-b'))
    reads.length = 0
    const coverage: any = await index.refresh(host, 'group-a')
    assert.equal(coverage.totalSessions, 2)
    assert.deepEqual(new Set(reads), new Set(['group-a', 'group-a-old']))
    await assert.rejects(index.read(host, 'group-a', 'owner', 0), /范围|授权|人格|读取|可见/)
  } finally {
    await index.close()
  }
})

test('public knowledge access permits shared scopes and rejects private scopes even if actor is forged', async (t) => {
  const { dir, store } = fixture(t)
  const bank = new KnowledgeBank(join(dir, 'knowledge'), store)
  try {
    for (const actor of ['model', 'human'] as const) {
      const caller = { sessionId: 'group-a', project: dir, actor }
      assert.throws(() => bank.namespace(caller, 'persona'), /私有知识/)
      assert.throws(() => bank.namespace(caller, 'persona-project'), /私有知识/)
      assert.equal(bank.namespace(caller, 'project').scope, 'project')
      assert.equal(bank.namespace(caller, 'global').scope, 'global')
    }
  } finally {
    await bank.dispose()
  }
})

test('audience survives native child binding and cannot be upgraded or handed private history', (t) => {
  const { store, channel, personaId } = fixture(t)
  store.bind('child', { parent: 'group-a' })
  assert.deepEqual(store.read().bindings.child.channel, channel)
  assert.throws(() => store.bind('child', { channel: { ...channel, access: 'owner' } }), /范围已变化/)
  assert.throws(
    () => store.bind('new-child', { parent: 'group-a', channel: { ...channel, access: 'owner' } }),
    /不能提升/
  )
  const handoff = {
    sessionId: 'owner',
    throughSeq: 2,
    summary: 'PRIVATE_HANDOFF',
    createdAt: new Date().toISOString()
  }
  assert.throws(() => store.bind('bad-handoff', { personaId, channel, handoff }), /不能接续/)
  assert.equal(store.read().bindings['bad-handoff'], undefined)
})
