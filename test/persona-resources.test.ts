import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { TurnIdentity } from '../packages/dsh-px-memory/src/identity'
import {
  PersonaResourceAccess,
  installPersonaResourceAccess
} from '../packages/dsh-px-memory/src/persona-resources'
import { parsePersonaResources, personaToolAllowed } from '../packages/shared/persona-resources'

const rule = (names: string[]) => ({
  tools: { mode: 'selected', names },
  channels: { mode: 'native', accounts: [] }
})
function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'px-persona-resources-')),
    store = new MemoryStore(join(root, 'memory.json'))
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  const agents = new Map<string, any>(),
    turns = new Map<string, number>()
  const identity = new TurnIdentity(store, (agent) => ({ lastTurn: turns.get(agent.session.id) ?? 1 })),
    access = new PersonaResourceAccess(
      store,
      identity,
      (id) => agents.get(id),
      (child, parent) =>
        agents.get(child.session.id) === child && child.session.header.parentSession === parent.session.id
    )
  const a = store.createPersona('A'),
    b = store.createPersona('B')
  const agent = (id: string, personaId: string, parentSession?: string) => {
    store.bind(id, { personaId, parent: parentSession, locked: true })
    const value: any = { session: { id, header: { id, parentSession } } }
    agents.set(id, value)
    return value
  }
  return { root, store, identity, access, a, b, agent, turns }
}

test('resource grants are independent from expression revisions and cannot expand an in-flight turn or its children', (t) => {
  const f = fixture(t),
    a = f.agent('a', f.a.id),
    b = f.agent('b', f.b.id)
  f.access.save(f.a.id, 0, rule(['read']))
  assert.equal(f.access.tool(a, 'read'), undefined)
  assert.match(f.access.tool(a, 'write')!, /未获准/)
  assert.equal(f.access.tool(b, 'write'), undefined)
  f.access.save(f.a.id, 1, rule(['read', 'write']))
  assert.match(f.access.tool(a, 'write')!, /未获准/)
  const child = f.agent('child', f.a.id, 'a')
  assert.match(f.access.tool(child, 'write')!, /未获准/)
  f.turns.set('a', 2)
  assert.equal(f.access.tool(a, 'write'), undefined)
  assert.match(f.access.tool(child, 'write')!, /未获准/)
  f.turns.set('child', 2)
  assert.equal(f.access.tool(child, 'write'), undefined)
  f.access.save(f.a.id, 2, rule([]))
  assert.match(f.access.tool(a, 'read')!, /未获准/)
  assert.match(f.access.tool(child, 'read')!, /未获准/)
  assert.equal(
    f.access.tool(child, 'structured_output'),
    undefined,
    'native child can still settle its result after action revocation'
  )
  assert.match(
    f.access.tool(a, 'structured_output')!,
    /未获准/,
    'a root cannot impersonate native child result submission'
  )
  assert.throws(() => f.access.save(f.a.id, 2, rule(['read'])), /已变化/)
  assert.equal(f.store.read().personas.find((p) => p.id === f.a.id)!.revision, 1)
  const reopened = new MemoryStore(join(f.root, 'memory.json'))
  assert.deepEqual(reopened.read().personas.find((p) => p.id === f.a.id)!.resources?.tools.names, [])
})

test('channel constraints and expiration do not become broader permissions on missing or malformed configuration', (t) => {
  const f = fixture(t),
    a = f.agent('a', f.a.id)
  f.access.save(f.a.id, 0, {
    ...rule(['read']),
    channels: { mode: 'selected', accounts: [{ provider: 'qq', accountId: '10001' }] }
  })
  assert.equal(f.access.channel(f.a.id, 'qq', '10001'), true)
  assert.equal(f.access.channel(f.a.id, 'qq', '10002'), false)
  assert.equal(f.access.channel('missing', 'qq', '10001'), false)
  assert.throws(() => f.access.save(f.a.id, 1, rule(['read', 'read'])), /无效/)
  assert.throws(() => parsePersonaResources({ ...rule([]), revision: 1, expiresAt: 'later' }), /无效/)
  assert.equal(
    personaToolAllowed(
      { ...rule(['read']), revision: 1, expiresAt: new Date(10).toISOString() } as any,
      'read',
      10
    ),
    false
  )
  f.access.save(f.a.id, 1, { ...rule(['read']), expiresAt: new Date(0).toISOString() })
  assert.match(f.access.tool(a, 'read')!, /未获准/)
  assert.equal(f.access.channel(f.a.id, 'qq', '10001'), false)
})

test('real native final guards constrain scoped and nested tools and cannot override native denials', async (t) => {
  const f = fixture(t),
    a = f.agent('a', f.a.id),
    b = f.agent('b', f.b.id)
  f.access.save(f.a.id, 0, rule(['read', 'delegate']))
  const app = new Context()
  app.provide('systemPrompt', { tools: () => () => {} })
  const runtime = app.plugin(ToolRuntime)
  await runtime.await()
  let completed!: () => void, failed!: (e: unknown) => void
  const done = new Promise<void>((resolve, reject) => {
    completed = resolve
    failed = reject
  })
  const mounted = app.inject(['tools'], (host: any) => {
    const sa = createScope(host, a),
      sb = createScope(host, b)
    a.ctx = sa.ctx
    b.ctx = sb.ctx
    let writes = 0
    const definition = (name: string, execute: any): any => ({
      name,
      description: name,
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (value: string) => [{ type: 'text', text: value }] },
      execute
    })
    const stop = installPersonaResourceAccess(host, f.access)
    const run = async () => {
      try {
        host.tools.register(definition('read', async () => 'READ'))
        sa.ctx.tools.register(
          definition('write', async () => {
            writes++
            return 'WROTE'
          })
        )
        sb.ctx.tools.register(
          definition('write', async () => {
            writes++
            return 'WROTE'
          })
        )
        host.tools.register(
          definition('delegate', async (_: any, exec: any) => {
            const result = await host.tools.execute({
              name: 'write',
              callId: exec.callId + ':nested',
              arguments: {},
              agent: exec.agent,
              parent: exec.token,
              signal: exec.signal
            })
            return result.isError ? 'NESTED_DENIED' : 'NESTED_ALLOWED'
          })
        )
        await Promise.resolve()
        const invoke = (agent: any, name: string) =>
          host.tools.execute({
            name,
            callId: 'test-' + Math.random(),
            arguments: {},
            agent,
            signal: new AbortController().signal
          })
        host.on('tools/pre-execute', () => ({ kind: 'allow' }))
        assert.equal((await invoke(a, 'read')).isError, false)
        assert.equal((await invoke(a, 'write')).isError, true)
        assert.equal(writes, 0)
        assert.equal((await invoke(a, 'delegate')).value, 'NESTED_DENIED')
        assert.equal(writes, 0)
        assert.equal((await invoke(b, 'write')).isError, false)
        assert.equal(writes, 1)
        const deny = host.tools.guard((exec: any) => (exec.name === 'read' ? 'NATIVE_DENIED' : undefined))
        assert.match((await invoke(a, 'read')).error.message, /NATIVE_DENIED/)
        deny()
        f.access.save(f.a.id, 1, rule([]))
        assert.equal((await invoke(a, 'delegate')).isError, true)
        const assembled = await host.waterfall('system-prompt/assemble', {}, { agent: a }, () => ({
          tools: [{ name: 'read' }, { name: 'write' }],
          sections: []
        }))
        assert.deepEqual(assembled.tools, [])
      } finally {
        await stop()
        await sa.dispose()
        await sb.dispose()
      }
    }
    void run().then(completed, failed)
  })
  try {
    await done
  } finally {
    await mounted.dispose()
    await runtime.dispose()
  }
})
