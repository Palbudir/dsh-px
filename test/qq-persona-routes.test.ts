import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { QqAttentionInbox } from '../packages/dsh-px-qq/src/attention-inbox'
import { QqPersonaRoutes, parsePersonaRoutes } from '../packages/dsh-px-qq/src/persona-routes'
import { QqPersonaRouting, type QqRoutingPorts } from '../packages/dsh-px-qq/src/persona-routing'
import { QqPersonaAttention } from '../packages/dsh-px-qq/src/persona-attention'
import { parseAttention } from '../packages/dsh-px-qq/src/attention'
import { QqSessionPolicy } from '../packages/dsh-px-qq/src/session-policy'
import { channelFor, DEFAULT_QQ_SETTINGS } from '../packages/dsh-px-qq/src/policy'

test('QQ persona switch intent survives restart, preserves independent sessions and rejects stale commits', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'px-qq-routes-'))
  const file = join(dir, 'inbox.sqlite')
  let inbox = new QqAttentionInbox(file, '12001')
  t.after(() => {
    inbox.close()
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  const open = () =>
    new QqPersonaRoutes({
      read: () => inbox.personaRoutes(),
      write: (revision, state) => inbox.savePersonaRoutes(revision, state)
    })
  let routes = open()
  const first = routes.begin('group:34011', 0, 'persona-b', {
    personaId: 'persona-a',
    sessionId: 'original-a'
  })
  assert.equal(routes.route('group:34011')?.personaId, 'persona-a')
  assert.throws(() => routes.assertSettled('group:34011'), /尚未完成/)
  assert.throws(() => routes.begin('group:34011', 1, 'persona-c', { personaId: 'persona-a' }), /未完成/)
  inbox.close()
  inbox = new QqAttentionInbox(file, '12001')
  routes = open()
  assert.deepEqual(routes.route('group:34011')?.pending, first)
  assert.throws(() => routes.finish('group:34011', 'wrong-intent', 'commit'), /已经改变/)
  routes.finish('group:34011', first.id, 'commit')
  assert.equal(routes.route('group:34011')?.personaId, 'persona-b')
  assert.equal(routes.route('group:34011')?.sessions['persona-a'], 'original-a')
  assert.equal(routes.route('group:34011')?.sessions['persona-b'], first.targetSessionId)
  const second = routes.begin('group:34011', routes.snapshot().revision, 'persona-a', {
    personaId: 'persona-b',
    sessionId: first.targetSessionId
  })
  assert.equal(second.targetSessionId, 'original-a')
  routes.finish('group:34011', second.id, 'abort')
  assert.equal(routes.route('group:34011')?.personaId, 'persona-b')
  assert.equal(routes.route('group:34011')?.pending, undefined)
  assert.throws(() => routes.begin('group:34011', 0, 'persona-c', { personaId: 'persona-b' }), /已变化/)
})

test('QQ route failures preserve the previous record and unrelated chats remain independent', () => {
  let state = parsePersonaRoutes(undefined),
    fail = false
  const routes = new QqPersonaRoutes({
    read: () => state,
    write: (revision, next) => {
      assert.equal(revision, state.revision)
      if (fail) throw Error('storage failed')
      state = next
    }
  })
  const first = routes.begin('private:23007', 0, 'b', { personaId: 'a', sessionId: 'a-one' })
  const snapshot = routes.snapshot()
  fail = true
  assert.throws(() => routes.finish('private:23007', first.id, 'commit'), /storage failed/)
  assert.deepEqual(routes.snapshot(), snapshot)
  routes.assertSettled('group:34011')
  fail = false
  const other = routes.begin('group:34011', state.revision, 'c', { personaId: 'a' })
  routes.finish('group:34011', other.id, 'commit')
  assert.equal(routes.route('private:23007')?.pending?.id, first.id)
  assert.throws(
    () =>
      parsePersonaRoutes({
        schema: 1,
        revision: 0,
        chats: { 'group:34011': { personaId: 'x', revision: 1, sessions: [], pending: first } }
      }),
    /条目无效/
  )
})

test('QQ routing fences live operations, keeps pending switch recoverable and never reconnects the account', async () => {
  let state = parsePersonaRoutes(undefined),
    current = { personaId: 'a', sessionId: 'session-a' }
  const routes = new QqPersonaRoutes({
    read: () => state,
    write: (_revision, next) => {
      state = next
    }
  })
  let failFlush = true,
    pending = true,
    busy = false,
    creations = 0,
    cancellations = 0
  const created = new Set<string>()
  const ports: QqRoutingPorts = {
    known: () => true,
    available: () => true,
    current: () => current,
    busy: () => (busy ? ['原生任务仍在运行'] : []),
    hasPending: () => pending,
    cancelPending: () => {
      cancellations++
      pending = false
    },
    create: async (_chat, _persona, id) => {
      if (!created.has(id)) {
        creations++
        created.add(id)
      }
    },
    adopt: async (_chat, id) => {
      current = { personaId: id === 'session-a' ? 'a' : 'b', sessionId: id }
    },
    reset: async () => {},
    flush: async () => {
      if (failFlush) throw Error('native mapping persistence failed')
    },
    retireDelivery: () => {}
  }
  const routing = new QqPersonaRouting(routes, ports)
  const input = { chatId: 'group:34011', revision: 0, personaId: 'b', stopPending: false }
  const lease = routing.enter(input.chatId)
  await assert.rejects(routing.change(input), /正在受理或发送/)
  assert.equal(routes.snapshot().revision, 0)
  lease.release()
  lease.release()
  await assert.rejects(routing.change(input), /未处理消息/)
  busy = true
  await assert.rejects(routing.change({ ...input, stopPending: true }), /仍在运行/)
  busy = false
  await assert.rejects(routing.change({ ...input, stopPending: true }), /persistence failed/)
  assert.equal(cancellations, 1)
  assert.equal(routing.blocked(input.chatId), true)
  assert.throws(() => routing.enter(input.chatId), /切换人格/)
  const transition = routes.route(input.chatId)!.pending!
  assert.equal(current.sessionId, transition.targetSessionId)
  failFlush = false
  await routing.recover(input.chatId, transition.id, 'retry')
  assert.equal(creations, 1)
  assert.equal(routes.route(input.chatId)?.personaId, 'b')
  assert.equal(routing.blocked(input.chatId), false)
  const currentLease = routing.enter(input.chatId)
  currentLease.assert()
  currentLease.release()
  routing.dispose()
  assert.throws(() => routing.enter(input.chatId), /切换人格/)
})

test('personas expire and restore only their own temporary chat attention; user settings still override all', () => {
  let now = 1000
  const base = parseAttention({ mode: 'notifications' }),
    attention = new QqPersonaAttention(base, 'a', () => now)
  const known = ['group:34011', 'group:34012']
  attention.adjust({ chatId: known[0], minutes: 1, reason: 'A only' }, known, 'a')
  attention.adjust({ chatId: known[1], minutes: 10, reason: 'B only' }, known, 'b')
  assert.deepEqual(attention.effective().openedChats, known)
  assert.equal(attention.snapshot('a').temporary?.reason, 'A only')
  assert.equal(attention.snapshot('b').temporary?.reason, 'B only')
  now += 61000
  assert.deepEqual(attention.effective().openedChats, [known[1]])
  assert.throws(
    () => attention.adjust({ mode: 'focus', minutes: 1, reason: 'change all' }, known, 'b'),
    /默认人格/
  )
  attention.reset('a')
  assert.deepEqual(attention.effective().openedChats, [known[1]])
  attention.releaseChat(known[1])
  assert.equal(attention.snapshot('b').temporary, null)
  attention.adjust({ chatId: known[1], minutes: 10, reason: 'B again' }, known, 'b')
  attention.userSettings(parseAttention({ allowAgentChanges: false }))
  assert.equal(attention.snapshot().temporary, null)
  assert.throws(
    () => attention.adjust({ chatId: known[1], minutes: 10, reason: 'late' }, known, 'b'),
    /用户已固定/
  )
})

test('routing does not commit when the native flush reports failure through its callback instead of rejecting', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'px-qq-flush-state-')),
    inbox = new QqAttentionInbox(join(dir, 'inbox.sqlite'), '12001')
  const settings = {
    ...DEFAULT_QQ_SETTINGS,
    accountId: '12001',
    authorizedUsers: ['23007'],
    personaId: 'a',
    workspace: dir,
    attention: parseAttention({ mode: 'notifications', allowAgentChanges: false })
  }
  const chatId = 'group:34011',
    channel = channelFor(settings, chatId)
  const bindings: Record<string, any> = { 'session-a': { personaId: 'a', channel } },
    agents = new Map<string, any>()
  let activeGoal = false
  const goals = {
    get: () =>
      activeGoal ? { id: 'goal-a', revision: 1, phase: 'active', activation: 'disarmed' } : undefined
  }
  const agent = (id: string) => ({
    id,
    session: { id, header: { cwd: channel.workspace } },
    ctx: { get: (name: string) => (name === 'goals' ? goals : undefined) },
    status: 'idle',
    inbox: { nextTurn: [], nextStep: [] }
  })
  agents.set('session-a', agent('session-a'))
  const memory = {
    version: 1,
    capabilities: { conversationMemoryIsolation: 1 },
    personas: () => [{ id: 'a' }, { id: 'b' }],
    inspect: (id: string) => ({ binding: bindings[id] }),
    bind: (id: string, personaId: string, value: any) => {
      bindings[id] = { personaId, channel: value, pending: !agents.has(id) }
    },
    channelBindings: () => Object.entries(bindings).map(([sessionId, binding]) => ({ sessionId, ...binding }))
  }
  let created = 0,
    fail = true,
    current = { sessionId: 'session-a', agent: agents.get('session-a') }
  const services: any = {
    pxMemoryChannels: memory,
    agents: { get: (id: string) => agents.get(id) },
    sessionController: {
      inspect: async (id: string) => {
        if (!agents.has(id)) throw Object.assign(Error('missing'), { code: 'session/not-found' })
        return { meta: agents.get(id).session.header }
      },
      create: async ({ sessionId }: any) => {
        created++
        agents.set(sessionId, agent(sessionId))
      }
    }
  }
  const policy = new QqSessionPolicy(
    { get: (name: string) => services[name] },
    settings,
    { repair: async () => {} } as any,
    inbox
  )
  policy.attach({
    chat: () => current,
    routeState: () => ({ busy: false, sending: false }),
    receive: async () => {},
    send: async () => {},
    retireDelivery: () => {},
    adopt: async (_chat, id) => {
      current = { sessionId: id, agent: agents.get(id) }
      return { ok: true }
    },
    flush: async () => {
      if (fail) policy.persistenceError(Error('native write failed'))
    }
  })
  t.after(async () => {
    await policy.dispose()
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  inbox.receive({
    self_id: 12001,
    post_type: 'message',
    message_type: 'group',
    group_id: 34011,
    user_id: 45009,
    message_id: 1,
    message: [{ type: 'text', data: { text: 'hello' } }]
  })
  activeGoal = true
  assert.ok(policy.personaRouteStatus(chatId).busy.includes('持续目标仍处于活动状态'))
  await assert.rejects(
    policy.changePersonaRoute({
      operation: 'change',
      accountId: '12001',
      chatId,
      personaId: 'b',
      revision: 0,
      stopPending: true
    }),
    /持续目标/
  )
  assert.equal(created, 0, 'an idle but unfinished native goal must keep its current owner')
  assert.equal(policy.personaRouteStatus(chatId).route, null)
  activeGoal = false
  await assert.rejects(
    policy.changePersonaRoute({
      operation: 'change',
      accountId: '12001',
      chatId,
      personaId: 'b',
      revision: 0,
      stopPending: true
    }),
    /尚未保存/
  )
  const status = policy.personaRouteStatus(chatId)
  assert.equal(status.persistenceBlocked, true)
  assert.equal(status.personaId, 'a')
  assert.ok(status.route?.pending)
  fail = false
  await policy.retryPersistence()
  await policy.changePersonaRoute({
    operation: 'retry',
    accountId: '12001',
    chatId,
    transitionId: status.route!.pending!.id
  })
  assert.equal(created, 1)
  assert.equal(policy.personaRouteStatus(chatId).personaId, 'b')
  assert.equal(policy.personaRouteStatus(chatId).route?.pending, undefined)
})
