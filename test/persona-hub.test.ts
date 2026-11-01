import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { createHubSession, personaHubView } from '../packages/dsh-px-memory/src/persona-hub'

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'px-persona-hub-'))
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  const store = new MemoryStore(join(dir, 'memory.json'))
  const a = store.createPersona('A'),
    b = store.createPersona('B')
  return { store, a, b }
}

test('persona hub reads native summaries without waking agents or exposing another persona conversation', async (t) => {
  const { store, a, b } = fixture(t),
    rows: any[] = []
  for (let index = 0; index < 56; index++) {
    const id = 'a-' + index
    store.bind(id, { personaId: a.id, locked: true })
    rows.push({
      sessionId: id,
      running: index === 0,
      agentAvailable: index === 0,
      cwd: '/project',
      updatedAt: index
    })
  }
  store.bind('b-private', { personaId: b.id, locked: true })
  store.bind('a-pending', { personaId: a.id, pending: true })
  store.bind('analysis', { personaId: a.id, purpose: 'experience' })
  rows.push(
    { sessionId: 'b-private' },
    { sessionId: 'a-pending' },
    { sessionId: 'analysis' },
    { sessionId: 'legacy' }
  )
  const original = store.read()
  const host = {
    sessionController: { list: async () => ({ items: rows }) },
    workspaceRegistry: { list: () => [{ id: 'workspace-a', title: 'Project', path: '/project' }] },
    agents: {
      get: () => {
        throw Error('must not activate or query execution')
      }
    }
  }
  const view = await personaHubView(host, store, a.id)
  assert.equal(view.total, 56)
  assert.equal(view.sessions.length, 50)
  assert.equal(view.nextOffset, 50)
  assert.equal(view.sessions[0].running, true)
  assert.ok(view.sessions.every((row) => row.id.startsWith('a-')))
  assert.equal((await personaHubView(host, store, a.id, 50)).sessions.length, 6)
  assert.deepEqual(
    (await personaHubView(host, store, b.id)).sessions.map((row) => row.id),
    ['b-private']
  )
  assert.deepEqual(
    (await personaHubView(host, store, 'default')).sessions.map((row) => row.id),
    ['legacy']
  )
  assert.equal((await personaHubView(host, store, undefined, 0, 'b-private')).selectedPersonaId, b.id)
  assert.equal((await personaHubView(host, store, a.id, 0, 'b-private')).selectedPersonaId, a.id)
  assert.equal((await personaHubView(host, store, undefined, 0, 'analysis')).selectedPersonaId, 'default')
  assert.deepEqual(store.read(), original)
})

test('persona hub creation binds before the native factory and retry cannot change identity or workspace', async (t) => {
  const { store, a, b } = fixture(t),
    requestId = randomUUID(),
    created: string[] = []
  let fail = true
  const workspaces = [
    { id: 'workspace-a', path: '/project', sessionIds: [] as string[] },
    { id: 'workspace-b', path: '/other', sessionIds: [] as string[] }
  ]
  const host = {
    workspaceRegistry: {
      list: () => workspaces
    },
    sessionController: {
      inspect: async (id: string) => {
        if (!created.includes(id))
          throw Object.assign(Error('missing native session'), { code: 'session/not-found' })
        return { meta: { cwd: '/project' }, events: [] }
      },
      create: async ({ sessionId, workspaceId }: any) => {
        assert.equal(store.read().bindings[sessionId].personaId, a.id)
        assert.equal(store.read().bindings[sessionId].creationWorkspaceId, workspaceId)
        if (fail) throw Error('native create failed')
        if (!created.includes(sessionId)) created.push(sessionId)
        workspaces.find((w) => w.id === workspaceId)!.sessionIds.push(sessionId)
        return { sessionId }
      }
    }
  }
  const args = { requestId, personaId: a.id, workspaceId: 'workspace-a' }
  await assert.rejects(createHubSession(host, store, args), /native create failed/)
  assert.equal(store.read().bindings['session-' + requestId].pending, true)
  await assert.rejects(createHubSession(host, store, { ...args, personaId: b.id }), /另一项/)
  await assert.rejects(createHubSession(host, store, { ...args, workspaceId: 'workspace-b' }), /另一项/)
  fail = false
  const id = await createHubSession(host, store, args)
  assert.equal(id, await createHubSession(host, store, args))
  assert.deepEqual(created, [id])
  assert.equal(store.read().bindings[id].pending, false)
  assert.equal(store.read().bindings[id].handoff, undefined)
  assert.equal(store.read().bindings[id].channel, undefined)
})
