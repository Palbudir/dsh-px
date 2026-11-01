import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Script } from 'node:vm'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { PersonaNavigation } from '../packages/dsh-px-memory/src/persona-navigation'
import { personaNavigationClient } from '../packages/dsh-px-memory/src/persona-navigation-client'
import {
  patchNativePersonaController,
  patchNativePersonaWorkspaceClient,
  patchNativePersonaSessionClient
} from '../src/shared/native-persona-navigation'
import { patchNativeModelGuard } from '../src/shared/native-model-guard'

const original = readFileSync('node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js', 'utf8')
const client = readFileSync('node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js', 'utf8')
const workspaceClient = readFileSync(
  'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js',
  'utf8'
)
class RemoteError extends Error {
  isDSHRemoteError = true
  constructor(
    public code: string,
    message: string,
    public details: unknown = {}
  ) {
    super(message)
  }
}
class SessionQueryError extends Error {
  code = 'SESSION_QUERY_SESSION_NOT_FOUND'
}
const remoteErrorOf = (error: any) => (error?.isDSHRemoteError ? error : undefined)
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'px-persona-native-new-')),
    store = new MemoryStore(join(dir, 'memory.json')),
    a = store.createPersona('A'),
    b = store.createPersona('B'),
    path = join(dir, 'navigation.sqlite')
  let navigation = new PersonaNavigation(store, path)
  t.after(() => {
    navigation.close()
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  const source = patchNativePersonaController(patchNativeModelGuard(original))
  const code =
    source.slice(
      source.indexOf('//#region lib/types/agent.js'),
      source.indexOf('//#region lib/types/catalog.js')
    ) +
    source.slice(
      source.indexOf('var SessionCommandController = class'),
      source.indexOf('//#region lib/types/control.js')
    ) +
    ';({ApiSessionAgentController,SessionCommandController})'
  const classes = new Script(code).runInNewContext({
    Symbol,
    Error,
    RemoteError,
    remoteErrorOf,
    SessionQueryError,
    randomUUID,
    brandString: (s: string) => s,
    mkdir: async () => {}
  })
  const live = new Map<string, any>(),
    cold = new Map<string, any>(),
    calls: any[] = [],
    workspace: any = {
      id: 'workspace-a',
      path: dir,
      sessionIds: [],
      attachSession: async (id: string) => {
        if (flags.attachFailure) throw Error('injected attach failure')
        if (!workspace.sessionIds.includes(id)) workspace.sessionIds.push(id)
      }
    },
    flags: any = {
      attachFailure: false,
      busyOnResume: false,
      staleList: false,
      createFailure: false,
      beforeCompose: undefined
    }
  const make = (id: string, preset = 'standard') => {
    const session: any = {
      id,
      header: { id, cwd: dir, agentPreset: preset },
      events: [],
      blank: true,
      preset,
      append(type: string, data: any) {
        this.events.push({ type, data })
        if (type === 'agent-preset/selected') this.preset = data.agentPreset
      }
    }
    return { id, session, ctx: {} }
  }
  const ctx: any = {
    typert: { lookups: { configure() {} }, contexts: { configureHost() {} } },
    sessions: { get: (id: string) => live.get(id)?.session },
    agents: {
      get: (id: string) => live.get(id),
      isOwnedBy: () => false,
      create: async ({ sessionId, meta, setup }: any) => {
        calls.push({ kind: 'factory', id: sessionId, binding: store.read().bindings[sessionId] })
        if (flags.createFailure) {
          if (flags.persistBeforeFailure) cold.set(sessionId, make(sessionId, meta.agentPreset))
          throw Error('injected factory failure')
        }
        const agent = make(sessionId, meta.agentPreset)
        await setup(agent.ctx, agent)
        live.set(sessionId, agent)
        return { agent }
      },
      resume: async ({ resumeSessionId, setup }: any) => {
        const agent = cold.get(resumeSessionId)
        if (flags.busyOnResume) {
          const error = Error('writer owned')
          error.name = 'SessionAlreadyOwnedError'
          throw error
        }
        await setup(agent.ctx, agent)
        cold.delete(resumeSessionId)
        live.set(resumeSessionId, agent)
        return { agent }
      }
    },
    sessionQuery: {
      observeSession: async (id: string) => {
        const session = (cold.get(id) ?? live.get(id))?.session
        if (!session) throw new SessionQueryError('missing')
        return { header: session.header, events: session.events, [Symbol.dispose]() {} }
      }
    },
    sessionProjections: {
      stateOf: (s: any, key: string) =>
        key === 'turnBoundary' ? { openTurnStartSeq: null, lastTurn: s.blank ? 0 : 1 } : s.preset
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) },
    workspaceRegistry: {
      get: (id: string) => (id === workspace.id ? workspace : undefined),
      archivedSessionIds: []
    },
    get: (name: string) =>
      name === 'agentPresets'
        ? {
            select: async (agent: any, target: string) => {
              if (!agent.session.blank) throw new RemoteError('agent-preset/locked', 'locked')
              agent.session.append('agent-preset/selected', { agentPreset: target })
            }
          }
        : ctx[name]
  }
  const agents = new classes.ApiSessionAgentController(ctx)
  agents.composeAgent = async (preset = 'standard') => {
    await flags.beforeCompose?.()
    if (preset === 'missing')
      throw new RemoteError('agent-preset/not-found', 'preset missing', { agentPreset: preset })
    return { agentPreset: preset, setup: async () => {} }
  }
  const commands = new classes.SessionCommandController(ctx, agents, dir)
  ctx.sessionController = {
    pxPersonaCreationVersion: 1,
    list: async () => ({
      items: [...live.values(), ...cold.values()].map(({ session }: any) => ({
        sessionId: session.id,
        cwd: dir,
        blank: flags.staleList || session.blank,
        projectionValues: { agentPreset: session.preset }
      }))
    }),
    inspect: async (id: string) => {
      const s = (live.get(id) ?? cold.get(id))?.session
      if (!s) throw new RemoteError('session/not-found', 'not found')
      return { meta: s.header, events: s.events }
    },
    createForPersona: async (request: any, hooks: any) => {
      try {
        return { ok: true, value: await commands.create(request, hooks) }
      } catch (error: any) {
        return { ok: false, error: { code: error.code, message: error.message, details: error.details } }
      }
    }
  }
  const add = (id: string, personaId: string, isCold = false) => {
    store.bind(id, { personaId })
    const agent = make(id)
    ;(isCold ? cold : live).set(id, agent)
    workspace.sessionIds.push(id)
    return agent
  }
  return {
    ctx,
    store,
    a,
    b,
    live,
    cold,
    flags,
    calls,
    add,
    workspace,
    reopen: () => {
      navigation.close()
      navigation = new PersonaNavigation(store, path)
    },
    create: (input: any) =>
      navigation.create(ctx, { workspaceId: workspace.id, requestId: randomUUID(), ...input })
  }
}

test('pinned native factory binds the actual selected identity; own cold/live blanks reuse without crossing personas', async (t) => {
  const f = fixture(t)
  const oldA = f.add('old-a', f.a.id),
    oldB = f.add('old-b', f.b.id, true)
  const one = await f.create({ personaId: f.b.id })
  assert.equal(one.value.sessionId, oldB.id)
  assert.equal(f.store.read().bindings[oldA.id].locked, false, 'foreign blank unchanged')
  assert.equal(f.store.read().bindings[oldB.id].locked, true)
  const two = await f.create({ personaId: f.b.id })
  assert.equal(two.value.sessionId, oldB.id)
  assert.equal(f.calls.length, 0)
  const fresh = await f.create({ personaId: f.a.id, agentPreset: 'special' })
  assert.equal(fresh.value.agentPreset, 'special')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].id, fresh.value.sessionId)
  assert.equal(f.calls[0].binding.personaId, f.a.id)
  assert.equal(f.calls[0].binding.locked, true)
})

test('native stale blank and competing cold writer fall back with identity set before the actual factory', async (t) => {
  const f = fixture(t),
    old = f.add('started', f.a.id)
  old.session.blank = false
  f.flags.staleList = true
  const one = await f.create({ personaId: f.a.id })
  assert.notEqual(one.value.sessionId, old.id)
  assert.equal(f.calls[0].binding.personaId, f.a.id)
  f.flags.staleList = false
  const cold = f.add('cold-writer', f.b.id, true)
  f.flags.busyOnResume = true
  const two = await f.create({ personaId: f.b.id })
  assert.notEqual(two.value.sessionId, cold.id)
  assert.equal(f.calls[1].binding.personaId, f.b.id)
})

test('lost reply and workspace attach failures recover the same actual native id after reopening receipts', async (t) => {
  const f = fixture(t),
    request = { requestId: randomUUID(), personaId: f.a.id, agentPreset: 'special' }
  f.flags.attachFailure = true
  const failed = await f.create(request)
  assert.equal(failed.error.code, 'session/workspace-attach-failed')
  const id = failed.error.details.sessionId
  f.reopen()
  f.flags.attachFailure = false
  const recovered = await f.create(request)
  assert.equal(recovered.value.sessionId, id)
  assert.equal(recovered.value.agentPreset, 'special')
  f.live.get(id).session.blank = false
  f.reopen()
  assert.equal(
    (await f.create(request)).value.sessionId,
    id,
    'retry never starts another blank after the result began work'
  )
  assert.equal(f.calls.length, 1)
  await assert.rejects(f.create({ ...request, personaId: f.b.id }), /改变/)
})

test('native factory failure retries only a definite absent id; concurrent requests preserve one result', async (t) => {
  const f = fixture(t),
    request = { requestId: randomUUID(), personaId: f.b.id }
  f.flags.createFailure = true
  assert.equal((await f.create(request)).ok, false)
  f.reopen()
  f.flags.createFailure = false
  const both = await Promise.all([f.create(request), f.create(request)])
  assert.equal(both[0].value.sessionId, both[1].value.sessionId)
  assert.equal(f.calls.length, 2, 'failed factory plus one admitted retry')
  assert.equal(f.calls[0].id, f.calls[1].id)
  assert.equal(f.store.read().bindings[both[0].value.sessionId].pending, false)
  const missing = await f.create({ personaId: f.a.id, agentPreset: 'missing' })
  assert.equal(missing.error.code, 'agent-preset/not-found')
  assert.equal(missing.error.message, 'preset missing')
})

test('a persisted factory prefix recovers its pending identity without starting another session', async (t) => {
  const f = fixture(t),
    request = { requestId: randomUUID(), personaId: f.a.id }
  f.flags.createFailure = true
  f.flags.persistBeforeFailure = true
  assert.equal((await f.create(request)).ok, false)
  const id = f.calls[0].id
  assert.equal(f.store.read().bindings[id].pending, true)
  f.reopen()
  f.flags.createFailure = false
  const result = await f.create(request)
  assert.equal(result.value.sessionId, id)
  assert.equal(f.calls.length, 1)
  assert.equal(f.store.read().bindings[id].pending, false)
  f.workspace.sessionIds = []
  await assert.rejects(f.create(request), /移出/)
  assert.deepEqual(f.workspace.sessionIds, [])
})

test('unknown native read failures never authorize another factory attempt', async (t) => {
  const f = fixture(t),
    request = { requestId: randomUUID(), personaId: f.a.id }
  f.flags.createFailure = true
  await f.create(request)
  f.flags.createFailure = false
  f.ctx.sessionQuery.observeSession = async () => {
    throw Error('unreadable native log')
  }
  await assert.rejects(f.create(request), /unreadable/)
  assert.equal(f.calls.length, 1)
})

test('persona changes before native admission cannot rebind the old blank', async (t) => {
  const f = fixture(t),
    old = f.add('racing-blank', f.a.id)
  let once = true
  f.flags.beforeCompose = () => {
    if (!once) return
    once = false
    f.store.change(f.store.read().revision, (s) => {
      s.bindings[old.id].personaId = f.b.id
    })
  }
  const result = await f.create({ personaId: f.a.id })
  assert.notEqual(result.value.sessionId, old.id)
  assert.equal(f.store.read().bindings[old.id].personaId, f.b.id)
  assert.equal(f.calls[0].binding.personaId, f.a.id)
})

test('native New does not recycle a blank carrying an explicit handoff or unfinished creation acknowledgement', async (t) => {
  const f = fixture(t),
    handed = f.add('with-handoff', f.a.id),
    pending = f.add('incomplete-create', f.a.id)
  f.store.change(f.store.read().revision, (s) => {
    s.bindings[handed.id].handoff = {
      sessionId: 'source',
      throughSeq: 0,
      summary: 'finite source',
      createdAt: new Date().toISOString()
    }
    s.bindings[pending.id].creationWorkspaceId = f.workspace.id
    s.bindings[pending.id].creation = {
      kind: 'hub',
      cwd: f.workspace.path,
      workspaceId: f.workspace.id,
      complete: false
    }
  })
  const result = await f.create({ personaId: f.a.id })
  assert.notEqual(result.value.sessionId, handed.id)
  assert.notEqual(result.value.sessionId, pending.id)
  assert.equal(f.store.read().bindings[handed.id].handoff?.summary, 'finite source')
})

test('window selection is captured before asynchronous work; lost transport keeps a retry id across remount', async () => {
  let personaId = 'A',
    stored: Record<string, string> = {},
    fail = true
  const requests: any[] = [],
    ports = {
      selection: () => ({ personaId }),
      uuid: randomUUID,
      load: () => structuredClone(stored),
      save: (value: Record<string, string>) => {
        stored = structuredClone(value)
      },
      post: async (body: any) => {
        requests.push(body)
        if (fail) throw Error('lost reply')
        return { ok: true, value: { sessionId: 'same' } }
      }
    }
  const captured = personaNavigationClient(ports).capture()
  personaId = 'B'
  await assert.rejects(
    captured.transport({ workspaceId: 'w', sessionId: 'foreign', agentPreset: 'p' }),
    /lost reply/
  )
  assert.equal(requests[0].personaId, 'A')
  assert.equal(requests[0].sessionId, undefined)
  fail = false
  personaId = 'A'
  await personaNavigationClient(ports).capture().transport({ workspaceId: 'w', agentPreset: 'p' })
  assert.equal(requests[0].requestId, requests[1].requestId)
  assert.deepEqual(stored, {})
})

test('native overlay rejects drift and double patch, preserves the model companion and exposes no new RPC', () => {
  assert.throws(() => patchNativePersonaController(original + ' '), /differs/)
  const host = patchNativePersonaController(patchNativeModelGuard(original))
  assert.ok(host.includes('selectModelForSession(request)'))
  assert.throws(() => patchNativePersonaController(host), /differs/)
  for (const [source, patch] of [
    [client, patchNativePersonaSessionClient],
    [workspaceClient, patchNativePersonaWorkspaceClient]
  ] as const)
    assert.throws(() => patch(patch(source)), /differs/)
})

function browserFixture() {
  const patched = patchNativePersonaSessionClient(client),
    ws = patchNativePersonaWorkspaceClient(workspaceClient)
  const native =
    patched.slice(
      patched.indexOf('\t\tvar SessionManager = class'),
      patched.indexOf('\t\t//#region lib/types/client/index.js')
    ) +
    ws.slice(
      ws.indexOf('\t\tvar UiWorkspaceService = class'),
      ws.indexOf('\t\t/**\n\t\t* `error` as the Session')
    )
  const snapshot = (initial: any) => {
    let value = initial
    return {
      getSnapshot: () => value,
      set: (next: any) => {
        value = next
      },
      subscribe: () => () => {}
    }
  }
  const classes = new Script(
    native + ';({SessionManager,ClientSessions,UiWorkspaceService})'
  ).runInNewContext({
    AbortController,
    AbortSignal,
    Error,
    console,
    Notifier: class {
      constructor(private publish: () => void) {}
      markDirty() {
        this.publish()
      }
      subscribe() {
        return () => {}
      }
    },
    flattenLineage: (rows: any[]) => rows,
    _deepseek_ai_dsh_client_store: { createSnapshotStore: snapshot },
    _deepseek_ai_cordis: {
      Service: class {
        constructor(public ctx: any) {}
      }
    },
    creationFailureMessage: (error: Error) => error.message,
    sessionCreateErrorOf: (error: Error) => (error.name === 'SessionCreateError' ? error : undefined)
  })
  let selection = 'A',
    pending: Array<{ payload: any; resolve: (v: any) => void }> = [],
    ordinary = 0,
    controller = new AbortController()
  const manager = new classes.SessionManager({
    session: {
      create: async (payload: any) => {
        ordinary++
        return { ok: true, value: { sessionId: payload.sessionId ?? 'ordinary' } }
      }
    }
  })
  const sessions = Object.create(classes.ClientSessions.prototype)
  sessions.manager = manager
  sessions.list = snapshot({ ids: [], byId: {}, phase: 'ready' })
  sessions.projectList = () =>
    sessions.list.set({
      ids: manager.summaries.map((s: any) => s.sessionId),
      byId: Object.fromEntries(manager.summaries.map((s: any) => [s.sessionId, { ...s, id: s.sessionId }])),
      phase: 'ready'
    })
  sessions.refreshProjections = async () => {}
  sessions.retain = (id: string) => {
    manager.resolveTarget(id)
    return { sessionId: id, release() {} }
  }
  sessions.subagentAddress = () => undefined
  const notices: any[] = [],
    ui = new classes.UiWorkspaceService(
      {
        get: () => ({
          capture: () => ({
            key: selection,
            transport: (payload: any) =>
              new Promise((resolve) => pending.push({ payload: { ...payload, persona: selection }, resolve }))
          })
        }),
        effect() {},
        layout: {
          beginNavigation: () => {
            controller.abort()
            controller = new AbortController()
            return controller.signal
          },
          selectPanel() {}
        }
      },
      {},
      {
        list: snapshot({
          phase: 'ready',
          items: [{ workspaceId: 'w', path: '/project', sessionIds: [] }],
          archivedSessionIds: []
        })
      },
      sessions,
      {},
      (n: any) => notices.push(n)
    )
  return {
    ui,
    sessions,
    manager,
    pending,
    notices,
    choose: (p: string) => {
      selection = p
    },
    cancel: () => controller.abort(),
    get ordinary() {
      return ordinary
    }
  }
}

test('native New keeps same-persona admission coalesced, separates changed selection and retains before draft preparation', async () => {
  const f = browserFixture(),
    drafts: string[] = []
  const one = f.ui.connectWorkspace('w', { agentPreset: 'preset' }),
    same = f.ui.connectWorkspace('w', { agentPreset: 'preset' })
  assert.equal(f.pending.length, 1)
  f.choose('B')
  const other = f.ui.openWorkspace(
    'w',
    (id: string) => {
      assert.ok(
        f.manager.summaries.some((s: any) => s.sessionId === id),
        'native placeholder exists synchronously'
      )
      drafts.push(id)
    },
    { agentPreset: 'preset' }
  )
  assert.equal(f.pending.length, 2)
  assert.equal(f.pending[0].payload.persona, 'A')
  assert.equal(f.pending[1].payload.persona, 'B')
  assert.equal(f.pending[1].payload.agentPreset, 'preset')
  f.pending[1].resolve({ ok: true, value: { sessionId: 'B-blank' } })
  await other
  assert.deepEqual(drafts, ['B-blank'])
  f.pending[0].resolve({ ok: true, value: { sessionId: 'A-blank' } })
  assert.equal(await one, await same)
  assert.equal(f.ui.mainReference.sessionId, 'B-blank')
  await f.ui.restoreBlank('w', 'A-blank')
  assert.equal(f.ordinary, 1, 'restore bypasses current New persona transport')
})

test('cancelled native navigation still records a created id but never replaces the view or initializes a draft', async () => {
  const f = browserFixture(),
    drafts: string[] = []
  const open = f.ui.openWorkspace('w', (id: string) => drafts.push(id))
  f.cancel()
  f.pending[0].resolve({ ok: true, value: { sessionId: 'cancelled-blank' } })
  await open
  assert.ok(f.manager.summaries.some((s: any) => s.sessionId === 'cancelled-blank'))
  assert.equal(f.ui.mainReference, undefined)
  assert.deepEqual(drafts, [])
  const failed = f.ui.openWorkspace('w')
  f.pending[1].resolve({
    ok: false,
    error: {
      code: 'session/workspace-attach-failed',
      message: 'attach failed',
      details: { sessionId: 'published' }
    }
  })
  await assert.rejects(failed, /attach failed/)
  assert.ok(f.manager.summaries.some((s: any) => s.sessionId === 'published'))
  assert.equal(f.notices.length, 1)
})
