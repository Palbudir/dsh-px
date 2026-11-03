import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { MemoryStore, MemoryError } from '../packages/dsh-px-memory/src/store'
import { readNativeHandoff } from '../packages/dsh-px-memory/src/native-handoff-read'
import {
  searchNativeHandoff,
  appendNativeHandoffs
} from '../packages/dsh-px-memory/src/native-handoff-search'
import { traceNativeHandoff } from '../packages/dsh-px-memory/src/native-handoff-trace'
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

test('handoff grants stay sequence-bounded and cannot widen native whole-session queries', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-history-grant-')),
    store = new MemoryStore(join(root, 'memory.json')),
    other = store.createPersona('Source'),
    handoff = {
      sessionId: 'source',
      throughSeq: 23,
      summary: 'Visible shared work',
      createdAt: new Date().toISOString()
    }
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  store.bind('source', { personaId: other.id, locked: true })
  store.bind('receiver', { locked: true, handoff })
  const agent = { session: { id: 'receiver', header: { id: 'receiver' } } },
    scope = nativeHistoryScope(store, agent, 'session_event_read')
  assert.ok(!scope.ids.includes('source'), 'full-session search cannot include a bounded source')
  assert.equal(scope.allows('source'), false)
  assert.equal(scope.bounded('source')?.throughSeq, 23)
  assert.equal(scope.allowsEvent('source', 23), true)
  assert.equal(scope.allowsEvent('source', 24), false)
  assert.equal(scope.allowsEvent('source', -1), false)
  assert.equal(scope.allowsEvent('unknown', 0), false)
  store.change(store.read().revision, (state) => {
    state.bindings.receiver.handoff!.throughSeq = 24
  })
  assert.equal(scope.bounded('source'), undefined, 'an in-flight grant cannot acquire a larger range')
  assert.equal(scope.allowsEvent('source', 23), false)
  const renewed = nativeHistoryScope(store, agent, 'session_event_read')
  assert.equal(renewed.allowsEvent('source', 24), true)
  store.change(store.read().revision, (state) => {
    delete state.bindings.receiver.handoff
  })
  assert.equal(renewed.allowsEvent('source', 0), false)
})

test('native handoff reads export visible evidence, clamp neighbors and recheck grants after awaits', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-history-visible-')),
    store = new MemoryStore(join(root, 'memory.json')),
    other = store.createPersona('Source'),
    grant = { sessionId: 'source', throughSeq: 23, summary: 'Work', createdAt: new Date().toISOString() }
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  store.bind('source', { personaId: other.id, locked: true })
  store.bind('receiver', { locked: true, handoff: grant })
  const scope = nativeHistoryScope(
      store,
      { session: { id: 'receiver', header: { id: 'receiver' } } },
      'session_event_read'
    ),
    observed: number[] = []
  let revoke = false
  const history = {
    read: async (_host: any, _caller: string, _source: string, seq: number) => {
      observed.push(seq)
      if (revoke)
        store.change(store.read().revision, (state) => {
          delete state.bindings.receiver.handoff
        })
      if (seq === 21) throw new MemoryError('该事件不是可共享的对话、执行结果或原生状态', 403)
      return { seq, kind: 'user', text: 'VISIBLE_' + seq, totalCharacters: 10, nextOffset: null }
    }
  }
  const text = await readNativeHandoff({}, history, scope, 'receiver', {
    session_id: 'source',
    seq: 22,
    before: 2,
    after: 3
  })
  const value = JSON.parse(text!)
  assert.equal(value.throughSeq, 23)
  assert.deepEqual(
    value.neighbors.map((r: any) => r.seq),
    [20, 23]
  )
  assert.ok(!observed.includes(24))
  await assert.rejects(
    readNativeHandoff({}, history, scope, 'receiver', { session_id: 'source', seq: 24 }),
    /超出/
  )
  await assert.rejects(
    readNativeHandoff({}, history, scope, 'receiver', { session_id: 'source', seq: 21 }),
    /不是可共享/
  )
  revoke = true
  await assert.rejects(
    readNativeHandoff({}, history, scope, 'receiver', { session_id: 'source', seq: 22 }),
    /超出/
  )
})

test('handoff search constrains native pages and never returns private match snippets or titles', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-handoff-search-')),
    store = new MemoryStore(join(root, 'memory.json')),
    other = store.createPersona('Source')
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  store.bind('source', { personaId: other.id, locked: true })
  store.bind('receiver', {
    locked: true,
    handoff: {
      sessionId: 'source',
      throughSeq: 23,
      summary: 'Shared work',
      createdAt: new Date().toISOString()
    }
  })
  const scope = nativeHistoryScope(
    store,
    { session: { id: 'receiver', header: { id: 'receiver' } } },
    'session_event_search'
  )
  let revoke = false,
    requests = 0
  const native = {
    filterSessions: async (filters: any[]) => {
      assert.deepEqual(filters.at(-1), { kind: 'id', values: ['source'] })
      return [{ header: { id: 'source', title: 'PRIVATE_LATE_TITLE' } }]
    },
    searchEvents: async (request: any) => {
      requests++
      assert.equal(request.sessionId, 'source')
      assert.deepEqual(request.filters.at(-1), { kind: 'seq', from: 0, to: 23 })
      if (revoke)
        store.change(store.read().revision, (state) => {
          delete state.bindings.receiver.handoff
        })
      return {
        session: { id: 'source', title: 'LATE_PRIVATE_TITLE' },
        items: request.cursor
          ? [{ seq: 22, snippet: 'UNSAFE_NATIVE_SNIPPET' }]
          : [
              { seq: 20, snippet: 'HIDDEN_REASONING_NEEDLE' },
              { seq: 21, snippet: 'PRIVATE_SKILL_NEEDLE' }
            ],
        ...(request.cursor ? {} : { nextCursor: 'next' })
      }
    }
  }
  const history = {
    read: async (_host: any, _caller: string, _target: string, seq: number) => {
      if (seq === 21) throw new MemoryError('该事件不是可共享的对话、执行结果或原生状态', 403)
      return {
        seq,
        kind: 'user',
        time: 10,
        text: seq === 22 ? 'visible needle evidence' : 'unrelated public text',
        nextOffset: null
      }
    }
  }
  const host = { get: (key: string) => (key === 'sessionQuery' ? native : undefined) },
    result = JSON.parse(
      await searchNativeHandoff(
        host,
        history,
        scope,
        'receiver',
        'source',
        'needle',
        [],
        20,
        new AbortController().signal
      )
    )
  assert.equal(requests, 2)
  assert.deepEqual(
    result.items.map((item: any) => item.seq),
    [22]
  )
  assert.equal(result.partial, false)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|REASONING|UNSAFE_NATIVE/)
  const combined = JSON.parse(
    await appendNativeHandoffs(
      host,
      history,
      scope,
      'receiver',
      {},
      'needle',
      [],
      [],
      'OWN_NATIVE_RESULTS',
      20,
      new AbortController().signal
    )
  )
  assert.equal(combined.samePersonaResults, 'OWN_NATIVE_RESULTS')
  assert.deepEqual(
    combined.handoffMatches[0].items.map((item: any) => item.seq),
    [22]
  )
  assert.doesNotMatch(JSON.stringify(combined), /PRIVATE_LATE_TITLE/)
  const count = requests
  assert.equal(
    await appendNativeHandoffs(
      host,
      history,
      scope,
      'receiver',
      { session_ids: ['unrelated'] },
      'needle',
      [],
      [],
      'OWN',
      20,
      new AbortController().signal
    ),
    'OWN'
  )
  const unsupported = JSON.parse(
    await appendNativeHandoffs(
      host,
      history,
      scope,
      'receiver',
      {},
      'needle',
      [{ kind: 'availability', values: ['live'] }],
      [],
      'OWN',
      20,
      new AbortController().signal
    )
  )
  assert.match(unsupported.handoffNotice, /未检索/)
  assert.equal(requests, count)
  revoke = true
  await assert.rejects(
    searchNativeHandoff(
      host,
      history,
      scope,
      'receiver',
      'source',
      'needle',
      [],
      20,
      new AbortController().signal
    ),
    /授权已变化/
  )
})

test('handoff traces filter private and later edges and do not expose source session lineage', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-handoff-trace-')),
    store = new MemoryStore(join(root, 'memory.json')),
    other = store.createPersona('Source')
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  store.bind('source', { personaId: other.id, locked: true })
  store.bind('receiver', {
    locked: true,
    handoff: {
      sessionId: 'source',
      throughSeq: 23,
      summary: 'Shared work',
      createdAt: new Date().toISOString()
    }
  })
  const scope = nativeHistoryScope(
    store,
    { session: { id: 'receiver', header: { id: 'receiver' } } },
    'session_event_trace'
  )
  let revokeOnClose = false
  const native = {
      traceEvent: async () => ({
        session: { id: 'source', title: 'LATE_TITLE' },
        target: { seq: 20, text: 'PRIVATE_RAW_BODY' },
        replacedBy: 24,
        replacementChain: [21, 22, 24],
        replacedEventSeqs: [],
        sourceEventSeqs: [21, 22],
        derivedEventSeqs: [23, 24]
      })
    },
    persistence = {
      open: async () => ({
        header: { id: 'source', parentSession: 'PRIVATE_PARENT' },
        close: async () => {
          if (revokeOnClose)
            store.change(store.read().revision, (s) => {
              delete s.bindings.receiver.handoff
            })
        }
      })
    },
    host = {
      get: (key: string) =>
        key === 'sessionQuery' ? native : key === 'sessionPersistence' ? persistence : undefined
    },
    history = {
      read: async (_h: any, _c: string, _t: string, seq: number) => {
        if (seq === 21) throw new MemoryError('Private', 403)
        return { seq, kind: 'assistant', text: 'Visible', time: 1 }
      }
    }
  const result = JSON.parse(
    await traceNativeHandoff(host, history, scope, 'receiver', 'source', 20, new AbortController().signal)
  )
  assert.deepEqual(result.replacementChain, [22])
  assert.deepEqual(result.sourceEventSeqs, [22])
  assert.deepEqual(result.derivedEventSeqs, [23])
  assert.equal(result.replacedBy, undefined)
  assert.doesNotMatch(JSON.stringify(result), /LATE_TITLE|PRIVATE_RAW_BODY/)
  const lineage = await traceNativeHandoff(
    host,
    history,
    scope,
    'receiver',
    'source',
    undefined,
    new AbortController().signal
  )
  assert.doesNotMatch(lineage, /PRIVATE_PARENT/)
  assert.equal(JSON.parse(lineage).lineageBoundary, true)
  revokeOnClose = true
  await assert.rejects(
    traceNativeHandoff(host, history, scope, 'receiver', 'source', undefined, new AbortController().signal),
    /授权已变化/
  )
})
