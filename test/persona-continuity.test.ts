import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { TurnIdentity } from '../packages/dsh-px-memory/src/identity'
import { HistoryIndex, historyRecord, type HistoryEvent } from '../packages/dsh-px-memory/src/history'
import {
  handoffFrom,
  createPersonaSession,
  continuationRequests
} from '../packages/dsh-px-memory/src/continuation'

test('model continuation coalesces concurrent retries and rejects a changed target before mutation', async () => {
  const once = continuationRequests()
  let release!: () => void,
    calls = 0
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const run = async () => {
    calls++
    await pending
    return 'new-session'
  }
  const a = once('request', 'model-a', run),
    b = once('request', 'model-a', run)
  await assert.rejects(once('request', 'model-b', run), /另一项操作/)
  release()
  assert.deepEqual(await Promise.all([a, b]), ['new-session', 'new-session'])
  assert.equal(calls, 1)
})

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'px-persona-ab-')),
    store = new MemoryStore(join(dir, 'memory.json')),
    indexes: HistoryIndex[] = []
  t.after(async () => {
    for (const i of indexes) await i.close()
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  const histories = new Map<string, HistoryEvent[]>()
  const agent = (id: string) => ({
    session: {
      id,
      header: { id, cwd: 'C:/project' },
      snapshotEvents: (offset = 0) => histories.get(id)!.slice(offset)
    }
  })
  const host: any = {
    sessions: { get: (id: string) => (histories.has(id) ? agent(id).session : undefined) },
    agents: { get: () => undefined }
  }
  host.sessionController = {
    inspect: async (id: string) => {
      if (!histories.has(id)) throw Error('missing native session')
      return { meta: agent(id).session.header, events: histories.get(id) }
    },
    create: async ({ sessionId }: any) => {
      if (!histories.has(sessionId)) histories.set(sessionId, [])
      return { sessionId }
    }
  }
  const index = () => {
    const i = new HistoryIndex(join(dir, `history-${indexes.length}.sqlite`), store)
    indexes.push(i)
    return i
  }
  return { dir, store, histories, agent, host, index }
}
function event(seq: number, type: string, data: any): HistoryEvent {
  return { seq, type, data, time: 1000 + seq }
}
const user = (seq: number, text: string) =>
  event(seq, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text }] })
const reply = (seq: number, text: string) =>
  event(seq, 'assistant/message', { message: { content: [{ type: 'text', text }] } })

test('experience task descendants retain source identity but do not pollute human history retrieval', async (t) => {
  const f = fixture(t)
  f.store.bind('human', { locked: true })
  f.store.bind('analysis', { parent: 'human', purpose: 'experience', locked: true })
  f.store.bind('analysis-child', { parent: 'analysis', locked: true })
  assert.equal(f.store.read().bindings['analysis-child'].purpose, 'experience')
  assert.equal(f.store.read().bindings.analysis.personaId, f.store.read().bindings.human.personaId)
  f.histories.set('human', [user(0, 'REAL_WORK_EVIDENCE')])
  f.histories.set('analysis', [reply(0, 'INTERNAL_GENERATED_SUGGESTION')])
  f.histories.set('analysis-child', [reply(0, 'INTERNAL_GENERATED_SUGGESTION')])
  const index = f.index()
  await index.refresh(f.host, 'human')
  assert.equal((index.search('human', 'INTERNAL_GENERATED_SUGGESTION') as any[]).length, 0)
  assert.equal((index.search('human', 'REAL_WORK_EVIDENCE') as any[]).length, 1)
  assert.equal((index.search('analysis', 'REAL_WORK_EVIDENCE') as any[]).length, 0)
})
function other(store: MemoryStore, id = 'other-session'): string {
  const s = store.action(store.read().revision, { type: 'create', name: 'Other' }, id, null)
  return store.persona(s, id).id
}

test('first assembled request uses chosen identity; used sessions reject in-place switching', (t) => {
  const f = fixture(t),
    id = 'session-中文.1'
  f.histories.set(id, [])
  const p = other(f.store)
  f.store.bind(id)
  f.store.action(f.store.read().revision, { type: 'select', personaId: p }, id, null)
  const identity = new TurnIdentity(f.store),
    a = f.agent(id)
  f.histories.get(id)!.push(event(0, 'turn/start', { turn: 1 }))
  assert.equal(identity.current(a).id, p)
  assert.equal(f.store.read().bindings[id].locked, true)
  assert.throws(
    () => f.store.action(f.store.read().revision, { type: 'select', personaId: 'default' }, id, null),
    /固定人格/
  )
})
test('persona configurations are pinned; current-turn memory is frozen and next first request sees edits', (t) => {
  const f = fixture(t),
    id = 's'
  f.histories.set(id, [event(0, 'turn/start', { turn: 1 })])
  const a = f.agent(id),
    identity = new TurnIdentity(f.store)
  assert.equal(identity.current(a).instructions, '')
  f.store.action(
    f.store.read().revision,
    { type: 'configure', name: '新名称', instructions: '新职责', memoryEnabled: true },
    id,
    null
  )
  f.store.action(
    f.store.read().revision,
    { type: 'save', text: '新的跨会话约定', scope: 'persona' },
    id,
    null
  )
  assert.equal(identity.current(a).memories.length, 0)
  f.histories.get(id)!.push(event(1, 'turn/end', {}), event(2, 'turn/start', { turn: 2 }))
  assert.equal(identity.current(a).memories[0].text, '新的跨会话约定')
  assert.equal(identity.current(a).instructions, '', 'old session pins its original config version')
  f.store.action(f.store.read().revision, { type: 'adopt-version' }, id, null)
  assert.equal(
    identity.current(a).instructions,
    '',
    'explicit adoption still cannot rewrite an executing turn'
  )
  f.histories.get(id)!.push(event(3, 'turn/end', {}), event(4, 'turn/start', { turn: 3 }))
  assert.equal(identity.current(a).instructions, '新职责')
  f.store.bind('fresh')
  assert.equal(f.store.persona(f.store.read(), 'fresh').instructions, '新职责')
})
test('forks inherit fixed identity and version; archived persona never silently becomes default', (t) => {
  const { store } = fixture(t),
    id = other(store, 'parent')
  store.bind('parent', { locked: true })
  store.bind('child', { parent: 'parent' })
  assert.equal(store.read().bindings.child.personaId, id)
  store.action(store.read().revision, { type: 'archive-persona' }, 'parent', null)
  assert.equal(store.persona(store.read(), 'child').id, id)
  assert.throws(() => store.bind('new', { personaId: id }), /归档/)
})
test('history indexes native states and long-output middles; excludes runtime snapshots and private memory tools', async (t) => {
  const f = fixture(t),
    index = f.index()
  f.store.bind('a')
  f.histories.set('a', [
    event(0, 'turn/start', { turn: 1 }),
    user(1, '项目更新失败，已经处理'),
    event(2, 'user/message', {
      source: { kind: 'runtime-context' },
      content: [{ type: 'text', text: 'PRIVATE_SECRET' }]
    }),
    reply(3, 'x'.repeat(10000) + 'MIDDLE_NEEDLE' + 'x'.repeat(10000)),
    event(4, 'tool/call', { callId: 'c1', name: 'pwsh', arguments: { command: 'npm test' } }),
    event(5, 'tool/result', {
      message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'PASSED_RECEIPT' }] }
    }),
    event(6, 'goal/change', { phase: 'paused', revision: 3 }),
    event(7, 'tool/call', { callId: 'm', name: 'persona_memory', arguments: { action: 'read' } }),
    event(8, 'tool/result', {
      message: { role: 'tool', toolCallId: 'm', content: [{ type: 'text', text: 'PRIVATE_SECRET' }] }
    }),
    event(9, 'turn/end', { reason: { kind: 'completed' } })
  ])
  assert.equal(((await index.refresh(f.host, 'a')) as any).partial, false)
  assert.equal((index.search('a', 'PRIVATE_SECRET') as any[]).length, 0)
  assert.ok((index.search('a', '更新失败') as any[]).some((r) => r.kind === 'user'))
  assert.ok((index.search('a', '更新') as any[]).length, 'two-character Chinese fallback')
  const match = (index.search('a', 'MIDDLE_NEEDLE') as any[])[0]
  assert.ok(
    ((await index.read(f.host, 'a', 'a', match.seq, match.readOffset)) as any).text.includes('MIDDLE_NEEDLE')
  )
  assert.equal((index.search('a', 'paused') as any[])[0].kind, 'native-state')
  assert.equal(((await index.read(f.host, 'a', 'a', 5)) as any).text, 'pwsh\nPASSED_RECEIPT')
})
test('same-persona history is shared; handoff grants one source cut, including after another caller indexed later events', async (t) => {
  const f = fixture(t),
    index = f.index()
  f.store.bind('a')
  f.store.bind('a2')
  const p = other(f.store, 'b')
  f.histories.set('a', [
    user(0, 'ALPHA_PAST'),
    reply(1, 'EARLY_REPLY'),
    event(2, 'turn/end', {}),
    user(3, 'ALPHA_FUTURE'),
    reply(4, 'FUTURE_REPLY')
  ])
  f.histories.set('a2', [])
  f.histories.set('b', [])
  await index.refresh(f.host, 'a2')
  assert.ok((index.search('a2', 'ALPHA_PAST') as any[]).length)
  await index.refresh(f.host, 'b')
  assert.equal((index.search('b', 'ALPHA_PAST') as any[]).length, 0)
  await assert.rejects(() => index.read(f.host, 'b', 'a', 0), /允许读取/)
  f.store.bind('target', {
    personaId: p,
    locked: true,
    handoff: { sessionId: 'a', throughSeq: 2, summary: 'handoff', createdAt: new Date().toISOString() }
  })
  f.histories.set('target', [])
  assert.ok((index.search('target', 'ALPHA_PAST') as any[]).length)
  assert.equal((index.search('target', 'ALPHA_FUTURE') as any[]).length, 0)
  assert.equal((index.list('target') as any[]).find((r) => r.sessionId === 'a').lastReply, 'EARLY_REPLY')
  await assert.rejects(() => index.read(f.host, 'target', 'a', 3), /允许读取/)
  await index.refresh(f.host, 'b')
  assert.equal(
    (index.search('b', 'ALPHA_PAST') as any[]).length,
    0,
    'handoff grant belongs to one target session, not its whole persona'
  )
})
test('cold indexing uses only native read handles; cache rebuild and stale-log replacement retain provenance', async (t) => {
  const f = fixture(t)
  f.store.bind('cold')
  let rows = [user(0, 'OLD_VALUE')],
    opens = 0,
    closes = 0
  const host = {
    sessionPersistence: {
      open: async (id: string, access: string) => {
        assert.equal(id, 'cold')
        assert.equal(access, 'read')
        opens++
        return {
          header: { id, cwd: 'C:/cold' },
          read: async (offset = 0, length?: number) => ({
            events: rows.slice(offset, length === undefined ? undefined : offset + length)
          }),
          close: async () => {
            closes++
          }
        }
      }
    }
  }
  const index = f.index()
  await index.refresh(host, 'cold')
  assert.ok((index.search('cold', 'OLD_VALUE') as any[]).length)
  rows = [user(0, 'NEW_VALUE')]
  await index.refresh(host, 'cold')
  assert.equal((index.search('cold', 'OLD_VALUE') as any[]).length, 0)
  assert.ok((index.search('cold', 'NEW_VALUE') as any[]).length)
  const rebuilt = f.index()
  await rebuilt.refresh(host, 'cold')
  assert.equal((rebuilt.search('cold', 'NEW_VALUE') as any[])[0].seq, 0)
  assert.equal(opens, closes)
})
test('large native histories report bounded progress instead of claiming full coverage', async (t) => {
  const f = fixture(t)
  f.store.bind('large')
  f.histories.set(
    'large',
    Array.from({ length: 3000 }, (_, i) => user(i, '工作记录 ' + i))
  )
  const index = f.index()
  assert.equal(((await index.refresh(f.host, 'large')) as any).partial, true)
  assert.equal(((await index.refresh(f.host, 'large')) as any).partial, false)
  assert.ok((index.search('large', '2999') as any[]).length)
})
test('mixed tool-result blocks cannot expose private memory by using a public first block', () => {
  const e = event(3, 'tool/result', {
    message: {
      content: [
        { type: 'tool-result', toolCallId: 'public', content: [{ type: 'text', text: 'PUBLIC' }] },
        { type: 'tool-result', toolCallId: 'private', content: [{ type: 'text', text: 'PRIVATE' }] }
      ]
    }
  })
  const row = historyRecord(e, (id) => (id === 'public' ? 'pwsh' : 'persona_memory'))!
  assert.ok(row.text.includes('PUBLIC'))
  assert.ok(!row.text.includes('PRIVATE'))
})

test('interrupted assistant prefixes are labelled unfinished and never expose reasoning blocks', () => {
  const r = historyRecord(
    event(1, 'assistant/message', {
      interrupted: true,
      message: {
        content: [
          { type: 'text', text: 'visible prefix' },
          { type: 'reasoning', text: 'hidden reasoning' }
        ]
      }
    })
  )!
  assert.equal(r.kind, 'assistant-interrupted')
  assert.equal(r.text, 'visible prefix')
})
test('continuation uses a new native session and finite shared history, with idempotent retries and no inherited persona context', async (t) => {
  const f = fixture(t),
    p = other(f.store)
  f.store.bind('source')
  f.histories.set('source', [
    event(0, 'turn/start', {}),
    user(1, '原任务'),
    event(2, 'user/message', {
      source: { kind: 'runtime-context' },
      content: [{ type: 'text', text: 'SECRET_IDENTITY' }]
    }),
    reply(3, '已有进展'),
    event(4, 'turn/end', {}),
    event(5, 'goal/change', { phase: 'paused' })
  ])
  const args = { requestId: randomUUID(), personaId: p, handoff: true }
  f.host.workspaceRegistry = { list: () => [{ id: 'native-workspace', sessionIds: ['source'] }] }
  const create = f.host.sessionController.create
  f.host.sessionController.create = async (request: any) => {
    assert.equal(request.workspaceId, 'native-workspace')
    assert.equal(request.cwd, undefined)
    return create(request)
  }
  const id = await createPersonaSession(f.host, f.store, 'source', args)
  assert.equal(await createPersonaSession(f.host, f.store, 'source', args), id)
  const b = f.store.read().bindings[id]
  assert.equal(b.personaId, p)
  assert.equal(b.handoff!.throughSeq, 5)
  assert.equal(f.histories.get(id)!.length, 0)
  assert.ok(!b.handoff!.summary.includes('SECRET_IDENTITY'))
  assert.ok(b.handoff!.summary.includes('paused'))
  assert.equal(f.store.read().bindings.source.personaId, 'default')
  await assert.rejects(
    () => createPersonaSession(f.host, f.store, 'source', { ...args, personaId: 'default' }),
    /其他操作/
  )
})
test('handoff does not include an unfinished turn, and an empty source has no transferable history', () => {
  assert.equal(
    handoffFrom(
      [
        event(0, 'turn/start', {}),
        user(1, 'done'),
        event(2, 'turn/end', {}),
        event(3, 'turn/start', {}),
        user(4, 'pending')
      ],
      'source'
    ).throughSeq,
    2
  )
  assert.throws(() => handoffFrom([], 'source'), /可交接/)
})

test('native boundary projection supplies turn identity without rescanning long live history', (t) => {
  const f = fixture(t)
  let turn = 1
  const a = {
    session: {
      id: 'projected',
      header: { id: 'projected' },
      snapshotEvents: () => {
        throw Error('full scan not expected')
      }
    }
  }
  const identity = new TurnIdentity(f.store, () => ({ lastTurn: turn }))
  assert.equal(identity.current(a).id, 'default')
  f.store.action(
    f.store.read().revision,
    { type: 'save', scope: 'persona', text: 'next-turn' },
    'projected',
    null
  )
  assert.equal(identity.current(a).memories.length, 0)
  turn++
  assert.equal(identity.current(a).memories[0].text, 'next-turn')
})
test('a corrupt derived index rebuilds without changing native history or persona identities', async (t) => {
  const f = fixture(t)
  f.store.bind('s')
  f.histories.set('s', [user(0, '原始记录仍存在')])
  writeFileSync(join(f.dir, 'history-0.sqlite'), 'not a database')
  const index = f.index()
  await index.refresh(f.host, 's')
  assert.ok((index.search('s', '原始记录') as any[]).length)
  assert.equal(f.store.read().bindings.s.personaId, 'default')
})
test('failed native creation reservations do not pollute persona history and retry reuses the identity', async (t) => {
  const f = fixture(t)
  f.store.bind('source')
  f.histories.set('source', [user(0, 'test')])
  const requestId = randomUUID(),
    create = f.host.sessionController.create
  f.host.sessionController.create = async () => {
    throw Error('temporary create failure')
  }
  await assert.rejects(
    () =>
      createPersonaSession(f.host, f.store, 'source', { requestId, personaId: 'default', handoff: false }),
    /temporary/
  )
  const index = f.index()
  assert.equal(((await index.refresh(f.host, 'source')) as any).totalSessions, 1)
  f.host.sessionController.create = create
  const id = await createPersonaSession(f.host, f.store, 'source', {
    requestId,
    personaId: 'default',
    handoff: false
  })
  assert.equal(id, 'session-' + requestId)
  assert.equal(f.store.read().bindings[id].pending, false)
  assert.equal(((await index.refresh(f.host, 'source')) as any).totalSessions, 2)
  f.histories.set('other-source', [user(0, 'another')])
  f.store.bind('other-source')
  await assert.rejects(
    () =>
      createPersonaSession(f.host, f.store, 'other-source', {
        requestId,
        personaId: 'default',
        handoff: false
      }),
    /其他操作/
  )
})

test('long quoted handoff excerpts remain valid bounded JSON and report truncation', () => {
  const source = [
    event(0, 'turn/start', {}),
    user(1, '"'.repeat(12000)),
    reply(2, '\\'.repeat(12000)),
    event(3, 'turn/end', {})
  ]
  const h = handoffFrom(source, 's')
  assert.ok(h.summary.length <= 12000)
  const parsed = JSON.parse(h.summary)
  assert.equal(parsed.requests[0].truncated, true)
})

test('opaque native session IDs cannot collide with JavaScript dictionary prototype members', async (t) => {
  const f = fixture(t)
  f.store.bind('constructor')
  f.store.bind('__proto__')
  f.histories.set('constructor', [user(0, 'native constructor session')])
  f.histories.set('__proto__', [user(0, 'native prototype session')])
  assert.equal(f.store.persona(f.store.read(), 'constructor').id, 'default')
  assert.ok(Object.hasOwn(f.store.read().bindings, '__proto__'))
  const p = other(f.store, 'other')
  f.histories.set('other', [])
  f.store.bind('target', {
    personaId: p,
    locked: true,
    handoff: { sessionId: 'constructor', throughSeq: 0, summary: 'test', createdAt: new Date().toISOString() }
  })
  f.histories.set('target', [])
  const index = f.index()
  await index.refresh(f.host, 'target')
  assert.ok((index.search('target', 'native constructor') as any[]).length)
  assert.equal((index.search('target', 'native prototype') as any[]).length, 0)
})
