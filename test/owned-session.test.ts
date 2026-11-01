import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { createHubSession } from '../packages/dsh-px-memory/src/persona-hub'
import { createPersonaSession } from '../packages/dsh-px-memory/src/continuation'
import { catalogueCreatedSession } from '../packages/dsh-px-memory/src/created-session-client'

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'px-owned-create-')),
    file = join(dir, 'memory.json'),
    store = new MemoryStore(file),
    persona = store.createPersona('A'),
    native = new Map<string, any>()
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  let creates = 0,
    failAttach = false,
    failRead = false
  const workspace = {
    id: 'workspace',
    path: dir,
    sessionIds: [] as string[],
    attachSession: async (id: string) => {
      if (failAttach) throw Error('native attachment failed')
      if (!workspace.sessionIds.includes(id)) workspace.sessionIds.push(id)
    }
  }
  const host: any = {
    workspaceRegistry: { list: () => [workspace], get: () => workspace },
    sessionQuery: {
      observeSession: async (id: string) => {
        if (failRead) throw Error('native log unreadable')
        const record = native.get(id)
        if (!record) throw Object.assign(Error('missing'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
        return { header: record.meta, events: record.events, [Symbol.dispose]() {} }
      }
    },
    sessionController: {
      inspect: async (id: string) => {
        const r = native.get(id)
        if (!r) throw Error('missing source')
        return r
      },
      create: async ({ sessionId, agentPreset }: any) => {
        creates++
        // Native create may mint another id when a named session is no longer reusable.
        const old = native.get(sessionId),
          id =
            old && (!workspace.sessionIds.includes(sessionId) || old.events.length)
              ? 'session-' + randomUUID()
              : sessionId
        if (!native.has(id))
          native.set(id, { meta: { id, cwd: dir, agentPreset: agentPreset ?? 'standard' }, events: [] })
        store.bind(id, { locked: true }) // Native identity assembly clears pending independently of attachment.
        await workspace.attachSession(id)
        return { sessionId: id }
      }
    }
  }
  return {
    dir,
    file,
    store,
    persona,
    native,
    workspace,
    host,
    get creates() {
      return creates
    },
    set failAttach(value: boolean) {
      failAttach = value
    },
    set failRead(value: boolean) {
      failRead = value
    }
  }
}

test('a cold retry repairs native attachment even when runtime assembly cleared pending; acknowledged retry is read-only', async (t) => {
  const f = fixture(t),
    args = { requestId: randomUUID(), workspaceId: 'workspace', personaId: f.persona.id },
    id = 'session-' + args.requestId
  f.failAttach = true
  await assert.rejects(createHubSession(f.host, f.store, args), /attachment failed/)
  assert.equal(f.store.read().bindings[id].pending, false)
  assert.equal(f.store.read().bindings[id].creation?.complete, false)
  f.failAttach = false
  const reopened = new MemoryStore(f.file)
  assert.equal(await createHubSession(f.host, reopened, args), id)
  assert.ok(f.workspace.sessionIds.includes(id))
  assert.equal(f.creates, 1)
  const revision = reopened.read().revision
  assert.equal(await createHubSession(f.host, reopened, args), id)
  assert.equal(reopened.read().revision, revision, 'retry must not invalidate unrelated edit revisions')
  f.workspace.sessionIds = []
  await assert.rejects(createHubSession(f.host, reopened, args), /未自动移回/)
  assert.deepEqual(f.workspace.sessionIds, [])
})

test('native ids already belonging to unbound history cannot be claimed, and unknown read errors cannot trigger creation', async (t) => {
  const f = fixture(t),
    requestId = randomUUID(),
    id = 'session-' + requestId,
    args = { requestId, workspaceId: 'workspace', personaId: f.persona.id }
  f.native.set(id, { meta: { cwd: f.dir }, events: [{ type: 'user/message', data: 'legacy' }] })
  const before = f.store.read()
  await assert.rejects(createHubSession(f.host, f.store, args), /已有原生会话/)
  assert.deepEqual(f.store.read(), before)
  f.failRead = true
  await assert.rejects(createHubSession(f.host, f.store, { ...args, requestId: randomUUID() }), /unreadable/)
  assert.equal(f.creates, 0)
})

test('continuation retries after work has started return the same identity without minting another native session', async (t) => {
  const f = fixture(t)
  f.store.bind('source', { locked: true })
  f.native.set('source', { meta: { id: 'source', cwd: f.dir, agentPreset: 'standard' }, events: [] })
  f.workspace.sessionIds.push('source')
  const args = { requestId: randomUUID(), personaId: f.persona.id, handoff: false }
  const first = await createPersonaSession(f.host, f.store, 'source', args)
  f.native.get(first).events.push({ type: 'turn/start', data: { turn: 1 } })
  const revision = f.store.read().revision
  const [a, b] = await Promise.all([
    createPersonaSession(f.host, f.store, 'source', args),
    createPersonaSession(f.host, f.store, 'source', args)
  ])
  assert.equal(a, first)
  assert.equal(b, first)
  assert.equal(f.creates, 1)
  assert.equal(f.native.size, 2)
  assert.equal(f.store.read().revision, revision)
  assert.equal(f.store.read().bindings[first].locked, true)
})

test('completed native deletion is not silently recreated; malformed creation metadata fails closed', async (t) => {
  const f = fixture(t),
    args = { requestId: randomUUID(), workspaceId: 'workspace', personaId: f.persona.id }
  const id = await createHubSession(f.host, f.store, args)
  f.native.delete(id)
  await assert.rejects(createHubSession(f.host, f.store, args), /原会话已不存在/)
  assert.equal(f.creates, 1)
  assert.throws(
    () =>
      f.store.change(f.store.read().revision, (s) => {
        s.bindings[id].creation!.kind = 'continuation'
      }),
    /回执与归属/
  )
})

test('successful custom create responses use native client catalog bookkeeping without a second Host RPC', async () => {
  let called = 0
  await catalogueCreatedSession(
    {
      pxPersonaTransportVersion: 1,
      create: async (_opts: unknown, transport: any) => {
        called++
        assert.deepEqual(await transport(), { ok: true, value: { sessionId: 'existing-created-id' } })
      }
    },
    'existing-created-id'
  )
  assert.equal(called, 1)
  let refreshes = 0
  const byId: Record<string, unknown> = {}
  await catalogueCreatedSession(
    {
      list: { getSnapshot: () => ({ byId }) },
      refresh: async () => {
        if (++refreshes === 2) byId['created'] = {}
      }
    },
    'created'
  )
  assert.equal(refreshes, 2, 'first refresh can be an older in-flight baseline')
  let failures = 0
  await assert.rejects(
    catalogueCreatedSession(
      {
        list: { getSnapshot: () => ({ byId: {} }) },
        refresh: async () => {
          failures++
        }
      },
      'constructor'
    ),
    /未重复创建/
  )
  assert.equal(failures, 2)
})
