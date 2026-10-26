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
      tools: {
        guard: (value: any) => {
          guard = value
        }
      },
      systemPrompt: {
        section: (value: any) => {
          section = value
        }
      },
      on: (_event: string, value: any) => {
        transform = value
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
