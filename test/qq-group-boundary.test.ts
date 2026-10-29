import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { KnowledgeBank } from '../packages/dsh-px-memory/src/knowledge'
import { QqSessionPolicy } from '../packages/dsh-px-qq/src/session-policy'
import { DEFAULT_QQ_SETTINGS, channelFor } from '../packages/dsh-px-qq/src/policy'
import { installGroupTaskAudience } from '../packages/dsh-px-qq/src/group-tasks'
import { QqGroupTasks } from '../packages/dsh-px-qq/src/group-tasks'
import { registerSharedQqKnowledge } from '../packages/dsh-px-qq/src/public-agent'
import { createPersonaSession } from '../packages/dsh-px-memory/src/continuation'
import { randomUUID } from 'node:crypto'
import { publicInputBoundary } from '../packages/dsh-px-qq/src/public-input'

test('group task authorization is separate from private memory and stays bound across children', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'px-qq-group-'))
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  const store = new MemoryStore(join(dir, 'memory.json'))
  const persona = store.createPersona('private identity')
  store.bind('owner', { personaId: persona.id })
  store.action(store.read().revision, { type: 'save', scope: 'persona', text: 'PRIVATE_093' }, 'owner', dir)
  const settings = {
    ...DEFAULT_QQ_SETTINGS,
    accountId: '12001',
    authorizedUsers: ['23007'],
    workspace: dir,
    personaId: persona.id
  }
  const channel = {
    ...channelFor(settings, 'group:34007'),
    task: { requesterId: '23007', rootSessionId: 'task-root' }
  }
  store.bind('task-root', { personaId: persona.id, channel, locked: true })
  store.bind('task-child', { parent: 'task-root' })
  store.bind('guest', { personaId: persona.id, channel: channelFor(settings, 'group:34007') })
  const bank = new KnowledgeBank(join(dir, 'knowledge'), store)
  const memory = { version: 1, inspect: (id: string) => ({ binding: store.read().bindings[id] }) }
  const policy = new QqSessionPolicy(
    { get: (key: string) => (key === 'pxMemoryChannels' ? memory : undefined) },
    settings,
    {} as any
  )
  try {
    assert.equal(policy.canRunGroupTask('guest'), false)
    assert.equal(policy.isManagedWorkspace(join(dir, 'groups', '12001', '34007')), true)
    assert.equal(policy.isManagedWorkspace(join(dir, 'visitors', '12001', '45009')), true)
    assert.equal(policy.isManagedWorkspace(join(dir, 'groups', '99999', '34007')), false)
    assert.equal(policy.isManagedWorkspace(join(dir, '..', 'foreign')), false)
    assert.equal(policy.isManagedWorkspace(join(dir, 'arbitrary-project')), false)
    assert.equal(policy.canRunGroupTask('task-root'), true)
    assert.equal(policy.canRunGroupTask('task-child'), true)
    assert.equal(JSON.stringify(store.persona(store.read(), 'task-child')).includes('PRIVATE_093'), false)
    const caller = { sessionId: 'task-child', project: join(dir, 'different-private-project') }
    assert.equal(
      bank.namespace(caller, 'project').project,
      process.platform === 'win32' ? resolve(channel.workspace!).toLowerCase() : resolve(channel.workspace!)
    )
    assert.throws(() => bank.namespace(caller, 'persona'), /私有/)
    const exec = { agent: { session: { id: 'task-child' } }, signal: new AbortController().signal }
    await policy.runTool(exec, async () => {
      policy.beforeConnectionCall('send_msg', { group_id: 34007 })
      assert.throws(() => policy.beforeConnectionCall('send_msg', { user_id: 23007 }), /其他收件人/)
      assert.throws(() => policy.beforeConnectionCall('send_msg', { group_id: 99999 }), /其他收件人/)
    })
    settings.authorizedUsers = []
    assert.equal(policy.canRunGroupTask('task-child'), false)
    await assert.rejects(async () => policy.runTool(exec, async () => {}), /授权/)
  } finally {
    await policy.dispose()
    await bank.dispose()
  }
})

test('group prompt keeps native tools but removes unrelated channel and scheduling capabilities', async () => {
  let guard: any, transform: any, section: any
  installGroupTaskAudience(
    {
      effect: (run: any) => run(),
      tools: {
        register: () => () => {},
        guard: (value: any) => {
          guard = value
        }
      },
      systemPrompt: {
        section: (value: any) => {
          section = value
        }
      },
      on: (event: string, value: any) => {
        if (event === 'system-prompt/assemble') transform = value
        return () => {}
      }
    },
    {
      provider: 'qq',
      accountId: '12001',
      conversationId: 'group:34007',
      access: 'public',
      publicInstructions: 'Public',
      task: { requesterId: '23007', rootSessionId: 'root' }
    },
    'Persona'
  )
  assert.equal(section.complete, true)
  assert.equal(section.interpolate, false)
  const assembly = await transform({}, {}, async () => ({
    sections: [],
    contexts: [{ name: 'private', text: 'SECRET' }],
    tools: [
      'write',
      'ask_user_question',
      'create_goal',
      'spawn_teammate',
      'dsh_im_return_file',
      'schedule_create',
      'qq_napcat_api',
      'mnemon_view_action',
      'mnemon_view_route',
      'session_query'
    ].map((name) => ({ name }))
  }))
  assert.deepEqual(assembly.contexts, [])
  assert.deepEqual(
    assembly.tools.map((tool: any) => tool.name),
    ['write', 'ask_user_question', 'create_goal', 'spawn_teammate']
  )
  assert.match(guard({ name: 'dsh_im_return_file' }), /群任务/)
  assert.equal(guard({ name: 'write' }), undefined)
})

test('public admission strips native private snapshots even when their hook was registered after setup', async () => {
  const hooks: any[] = [],
    cleanups: any[] = []
  const ctx = {
    effect: (run: any) => {
      cleanups.push(run())
    },
    on: (event: string, hook: any, options: any) => {
      if (event !== 'agent/pre-step') return () => {}
      if (options?.prepend) hooks.unshift(hook)
      else hooks.push(hook)
      return () => {
        const index = hooks.indexOf(hook)
        if (index >= 0) hooks.splice(index, 1)
      }
    }
  }
  const refresh = publicInputBoundary(ctx)
  refresh()
  ctx.on(
    'agent/pre-step',
    async (_payload: any, next: any) => ({
      ...(await next()),
      messages: [
        { source: { kind: 'dsh-mnemon' }, content: 'PRIVATE_PROVIDER' },
        { source: { kind: 'agent-instructions' }, content: 'PRIVATE_GLOBAL_INSTRUCTIONS' },
        { source: { kind: 'user' }, content: 'HUMAN_REQUEST' },
        { source: { kind: 'goal' }, content: 'NATIVE_CONTINUATION' }
      ]
    }),
    { prepend: true }
  )
  refresh() // after the native assembly waterfall, immediately before native admission
  const call = (index: number): Promise<any> =>
    index < hooks.length
      ? hooks[index]({}, () => call(index + 1))
      : Promise.resolve({ kind: 'accept', messages: [] })
  assert.deepEqual(
    (await call(0)).messages.map((message: any) => message.content),
    ['HUMAN_REQUEST', 'NATIVE_CONTINUATION']
  )
  refresh()
  assert.equal(hooks.length, 2, 'one current filter, no growth across long sessions')
  for (const cleanup of cleanups) cleanup?.()
  assert.equal(hooks.length, 1)
})

test('stopping a group during cold resume cancels admission even when the factory resolves late', async () => {
  const settings = {
    ...DEFAULT_QQ_SETTINGS,
    accountId: '12001',
    authorizedUsers: ['23007'],
    personaId: 'default',
    workspace: tmpdir()
  }
  const channel = {
    ...channelFor(settings, 'group:34007'),
    workspace: tmpdir(),
    task: { requesterId: '23007', rootSessionId: 'old' }
  }
  let release!: () => void,
    entered!: () => void,
    follows = 0,
    disposed = 0
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const resumed = new Promise<void>((resolve) => {
    entered = resolve
  })
  const agent = {
    session: { id: 'old', header: { cwd: tmpdir() } },
    followup: () => {
      follows++
    }
  }
  const memory = { channelBindings: () => [{ sessionId: 'old', channel, createdAt: '2026-10-26' }] }
  const services: any = {
    pxMemoryChannels: memory,
    agents: {
      get: () => undefined,
      withoutInitiator: (run: any) => run(),
      resume: async () => {
        entered()
        await waiting
        return {
          agent,
          dispose: async () => {
            disposed++
          }
        }
      }
    },
    agentPresets: { defaultId: 'standard' }
  }
  const tasks = new QqGroupTasks(
    { get: (name: string) => services[name] },
    settings,
    () => ({ recordedPreset: async () => 'standard' }),
    () => true,
    () => {}
  )
  const work = tasks.submit('group:34007', '23007', 'should not start', 'm1', new AbortController().signal)
  const rejected = assert.rejects(work, /授权已撤销|已停止/)
  await resumed
  await tasks.stop('group:34007')
  release()
  await rejected
  assert.equal(follows, 0)
  assert.equal(disposed, 1)
  await tasks.dispose()
})

test('explicit group continuation becomes a new channel task root and delivers to the same group', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'px-qq-handoff-'))
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  const store = new MemoryStore(join(dir, 'memory.json'))
  const settings = {
    ...DEFAULT_QQ_SETTINGS,
    accountId: '12001',
    authorizedUsers: ['23007'],
    personaId: 'default',
    workspace: dir
  }
  const channel = {
    ...channelFor(settings, 'group:34007'),
    task: { requesterId: '23007', rootSessionId: 'source' }
  }
  store.bind('source', { personaId: 'default', channel })
  const events = [
    { seq: 0, time: 1, type: 'turn/start', data: { turn: 1 } },
    {
      seq: 1,
      time: 2,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'PUBLIC_TASK_732' }] }
    },
    { seq: 2, time: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }
  ]
  const host: any = {
    sessionController: {
      inspect: async () => ({ meta: { cwd: dir, agentPreset: 'standard' }, events }),
      create: async () => {}
    }
  }
  const id = await createPersonaSession(host, store, 'source', {
    requestId: randomUUID(),
    personaId: 'default',
    handoff: true
  })
  assert.equal(store.read().bindings[id].channel!.task!.rootSessionId, id)
  assert.equal(store.read().bindings.source.channel!.task!.rootSessionId, 'source')
  assert.match(store.read().bindings[id].handoff!.summary, /PUBLIC_TASK_732/)
  const sent: any[] = [],
    memory = {
      inspect: (sid: string) => ({ binding: store.read().bindings[sid] }),
      channelBindings: () =>
        Object.entries(store.read().bindings).map(([sessionId, b]) => ({ sessionId, ...b }))
    }
  const titles = new Map<string, string>()
  const tasks = new QqGroupTasks(
    {
      get: (name: string) =>
        name === 'pxMemoryChannels'
          ? memory
          : name === 'sessionTitle'
            ? {
                get: (session: any) => titles.get(session.id),
                rename: (session: any, value: string) => titles.set(session.id, value)
              }
            : undefined
    },
    settings,
    () => ({
      send: async (...args: any[]) => {
        sent.push(args)
      }
    }),
    () => true,
    () => {}
  )
  const session = { id },
    agent = { session, cancel: () => {} }
  tasks.created(agent)
  assert.equal(titles.get(id), 'QQ 群任务 34007 · 23007')
  titles.set(id, '用户手动设置的任务名称')
  tasks.created(agent)
  assert.equal(titles.get(id), '用户手动设置的任务名称')
  tasks.event(session, {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: 'new-root-answer' }] } }
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(tasks.entries('group:34007').some((row: any) => row.sessionId === id))
  assert.deepEqual(sent, [['group:34007', 'new-root-answer']])
  await tasks.dispose()
})

test('group shared knowledge uses the bound namespace without enabling private persona memory', async () => {
  let tool: any, called: any
  const memory = {
    version: 1,
    inspect: () => ({ binding: { channel: { provider: 'qq', access: 'public', workspace: 'GROUP_ONLY' } } }),
    sharedKnowledge: async (...args: any[]) => {
      called = args
      return { documents: [{ body: 'SHARED_829' }] }
    }
  }
  registerSharedQqKnowledge({
    get: (name: string) => (name === 'pxMemoryChannels' ? memory : undefined),
    tools: {
      register: (value: any) => {
        tool = value
        return () => {}
      }
    }
  })
  const result = await tool.execute(
    { scope: 'project', query: 'shared' },
    {
      signal: new AbortController().signal,
      agent: { session: { id: 'group-root', header: { cwd: 'PRIVATE_WORKSPACE' } } }
    }
  )
  assert.equal(called[1], 'GROUP_ONLY')
  assert.match(result, /SHARED_829/)
})
