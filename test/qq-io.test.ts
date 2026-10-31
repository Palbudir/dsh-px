import test from 'node:test'
import assert from 'node:assert/strict'
import { QqSessionPolicy } from '../packages/dsh-px-qq/src/session-policy'
import { DEFAULT_QQ_SETTINGS, channelFor } from '../packages/dsh-px-qq/src/policy'

function fixture() {
  const settings = { ...DEFAULT_QQ_SETTINGS, accountId: '12001', authorizedUsers: ['23007'], personaId: 'p' }
  const channel = channelFor(settings, 'private:23007'),
    guards: Array<(exec: any) => string | undefined> = []
  const memory = {
    version: 1,
    bind() {},
    inspect: (id: string) => ({ binding: id === 'owner' ? { personaId: 'p', channel } : undefined })
  }
  const policy = new QqSessionPolicy(
    { get: (name: string) => (name === 'pxMemoryChannels' ? memory : undefined) },
    settings,
    {} as any
  )
  policy.installScope(
    {
      effect: (run: any) => run(),
      systemPrompt: { section: () => () => {} },
      tools: {
        register: () => () => {},
        guard: (g: any) => {
          guards.push(g)
        }
      }
    },
    'owner',
    'private:23007'
  )
  return { policy, guard: guards[0] }
}
test('QQ native tool guard rejects unknown callers and raw file-upload bypasses', () => {
  const { policy, guard } = fixture()
  const owner = { session: { id: 'owner' } }
  assert.match(guard({ name: 'qq_send_file' })!, /授权私聊/)
  assert.match(
    guard({ name: 'qq_napcat_api', agent: owner, arguments: { action: 'upload_private_file' } })!,
    /qq_send_file/
  )
  assert.equal(guard({ name: 'qq_send_file', agent: owner, arguments: { path: 'test.txt' } }), undefined)
  assert.equal(guard({ name: 'read', arguments: {} }), undefined)
  policy.dispose()
  assert.match(guard({ name: 'qq_send_file', agent: owner })!, /授权私聊/)
})
test('cancelled QQ tool IO cannot begin after an asynchronous wait', async () => {
  const { policy } = fixture(),
    controller = new AbortController()
  let release!: () => void,
    sent = 0
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const work = policy.runTool(
    { name: 'qq_send_image', agent: { session: { id: 'owner' } }, signal: controller.signal },
    async () => {
      await waiting
      policy.beforeConnectionCall()
      sent++
    }
  )
  controller.abort(new Error('stopped'))
  release()
  await assert.rejects(work, /stopped/)
  assert.equal(sent, 0)
  policy.dispose()
})

function admissionFixture(gateAt: number) {
  const settings = {
    ...DEFAULT_QQ_SETTINGS,
    enabled: true,
    accountId: '12001',
    authorizedUsers: ['23007'],
    personaId: 'p'
  }
  let release!: () => void,
    entered!: () => void,
    calls = 0
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = new Promise<void>((resolve) => {
    entered = resolve
  })
  const memory = { version: 1, channelBindings: () => [] }
  const receipts = {
    once: async (_key: string, work: any) => {
      if (++calls === gateAt) {
        entered()
        await waiting
      }
      return work()
    }
  }
  const policy = new QqSessionPolicy(
    { get: (name: string) => (name === 'pxMemoryChannels' ? memory : undefined) },
    settings,
    receipts as any
  )
  policy.attach({ receive: async () => {}, send: async () => {} })
  policy.bindConnection({
    call: async (action: string) =>
      action === 'get_login_info' ? { user_id: 12001 } : { online: true, good: true }
  })
  policy.connectionStatus(true)
  const event = (id: number, group = false) => ({
    self_id: 12001,
    post_type: 'message',
    message_type: group ? 'group' : 'private',
    user_id: 23007,
    ...(group ? { group_id: 34007 } : {}),
    message_id: id,
    message: [
      ...(group ? [{ type: 'at', data: { qq: '12001' } }] : []),
      { type: 'text', data: { text: 'task' } }
    ]
  })
  return { policy, event, reached, release }
}

test('global UI stop invalidates private input waiting for its durable receipt but accepts later input', async () => {
  const f = admissionFixture(1)
  let admitted = 0
  const work = f.policy.receive(f.event(1), async () => {
    f.policy.source('private:23007')
    admitted++
  })
  const rejected = assert.rejects(work, /已被停止/)
  await f.reached
  f.policy.cancelPendingInputs()
  f.release()
  await rejected
  assert.equal(admitted, 0)
  await f.policy.receive(f.event(2), async () => {
    f.policy.source('private:23007')
    admitted++
  })
  assert.equal(admitted, 1)
  await f.policy.dispose()
})

test('UI stop prevents a direct group task from starting after its transfer receipt finishes', async () => {
  const f = admissionFixture(2)
  let starts = 0
  ;(f.policy as any).groupTasks.submit = async () => {
    starts++
    return { sessionId: 'group-root', messageId: 'task' }
  }
  const work = f.policy.receive(f.event(1, true), async () => {
    await f.policy.command('group:34007', '/task original work', '23007')
  })
  const rejected = assert.rejects(work, /已被停止/)
  await f.reached
  f.policy.cancelPendingInputs()
  f.release()
  await rejected
  assert.equal(starts, 0)
  await f.policy.receive(f.event(2, true), async () => {
    await f.policy.command('group:34007', '/task new work', '23007')
  })
  assert.equal(starts, 1)
  await f.policy.dispose()
})

test('QQ stop invalidates pending input only in its own conversation', async (t) => {
  for (const sameChat of [true, false])
    await t.test(sameChat ? 'same group' : 'other private chat', async () => {
      const f = admissionFixture(1)
      let admitted = 0
      const work = f.policy.receive(f.event(1, true), async () => {
        f.policy.source('group:34007')
        admitted++
      })
      const result = sameChat ? assert.rejects(work, /已被停止/) : work
      await f.reached
      await f.policy.command(sameChat ? 'group:34007' : 'private:23007', '/stop', '23007')
      f.release()
      await result
      assert.equal(admitted, sameChat ? 0 : 1)
      await f.policy.dispose()
    })
})
