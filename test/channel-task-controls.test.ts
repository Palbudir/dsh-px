import test from 'node:test'
import assert from 'node:assert/strict'
import { ChannelInteractions, approvalText } from '../packages/shared/channel-interactions'
import { ChannelSendQueue } from '../packages/shared/channel-send-queue'
import { channelControl, type ChannelControlAudit } from '../packages/shared/channel-control'
import { Session, SessionId, appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session'
import { historyRecord } from '../packages/dsh-px-memory/src/history'
import { stopNativeTaskActors } from '../packages/shared/native-task-stop'

test('control audit uses native ignorable plugin records and survives a restored session without becoming a user command', () => {
  const session = Session.create(SessionId('control-audit')),
    audit: ChannelControlAudit = {
      version: 1,
      provider: 'feishu',
      accountId: 'bot',
      conversationId: 'chat',
      actorId: 'owner',
      messageId: 'message',
      requestId: 'Q1234567890',
      sessionId: session.id,
      control: 'answer',
      text: '/answer Q1234567890 1 蓝色',
      meaning: 'authenticated-control-attempt-not-task-completion',
      response: { question: 1, questionText: '颜色', selected: ['蓝色'] }
    }
  const seq = appendPluginRecord(session, 'plugin:dsh-px/channel-control', audit)
  const restored = Session.create(SessionId('control-restored'), session.snapshotEvents())
  const event = restored.snapshotEvents().find((e) => e.seq === seq)!
  assert.equal(event.ignorable, true)
  assert.deepEqual(pluginRecordOf(event)?.data, audit)
  assert.equal(historyRecord(event)?.kind, 'coordination')
  assert.equal(historyRecord({ ...event, ignorable: undefined }), undefined)
})

test('channel approvals bind an exact requester, reject expired grants and retain native PTC identity', async () => {
  let allowed = true
  const request: any = {
    agent: {
      session: {
        id: 'task',
        snapshotEvents: () => [
          {
            type: 'tool/ptc-dispatch-start',
            data: { subCallId: 'native-call', name: 'write', arguments: { path: 'file.txt' } }
          }
        ]
      }
    },
    callId: 'native-call',
    toolName: 'write',
    signal: new AbortController().signal
  }
  assert.match(approvalText(request)!, /file.txt/)
  const interactions = new ChannelInteractions(async () => {}, 60000, { label: '飞书', plainAnswers: false })
  const pending = interactions.request(
    'approval',
    request,
    'chat',
    async () => {
      throw Error('unexpected fallback')
    },
    { requesterId: 'ou_owner', allowed: () => allowed }
  )
  const id = interactions.list()[0].id
  assert.throws(() => interactions.respond('chat', { id, decision: 'allowed-once' }, 'ou_guest'), /发起成员/)
  assert.equal(interactions.list().length, 1)
  allowed = false
  assert.throws(() => interactions.respond('chat', { id, decision: 'allowed-once' }, 'ou_owner'), /撤销/)
  assert.equal(await pending, 'cancelled')
  assert.throws(() => interactions.respond('chat', { id, decision: 'allowed-once' }, 'ou_owner'), /已处理/)
  assert.equal(interactions.answerPlain('chat', 'task', '1', 'ou_owner'), undefined)
  interactions.dispose()
})

test('control parsing does not turn quoted prose into approvals or guess malformed request IDs', () => {
  assert.equal(channelControl('他让我说 /approve A1234567890'), undefined)
  assert.deepEqual(channelControl('/approve A1234567890'), { kind: 'approve', id: 'A1234567890' })
  assert.equal(channelControl('/approve please')?.id, '')
  assert.deepEqual(channelControl('/answer Q1234567890 2 蓝色'), {
    kind: 'answer',
    id: 'Q1234567890',
    question: 2,
    answer: '蓝色'
  })
})

test('queued channel sends cancel promptly while other conversations continue and draining waits for real release', async () => {
  const queue = new ChannelSendQueue(),
    controller = new AbortController(),
    log: string[] = []
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const a = queue.run('a', new AbortController().signal, async () => {
    log.push('a')
    await held
  })
  await new Promise((resolve) => setImmediate(resolve))
  const cancelled = queue.run('a', controller.signal, async () => {
    log.push('should-not-send')
  })
  const rejection = assert.rejects(cancelled, /stop/)
  controller.abort(Error('stop'))
  await rejection
  await queue.run('b', new AbortController().signal, async () => {
    log.push('b')
  })
  let drained = false
  const drain = queue.drain().then(() => {
    drained = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(drained, false)
  assert.deepEqual(log, ['a', 'b'])
  release()
  await a
  await drain
})

test('stopping native task actors cancels only their jobs and refuses to claim unfinished cancellation', async () => {
  const killed: string[] = [],
    paused: string[] = [],
    cancelled: string[] = []
  let terminal = true
  const jobs = {
    list: () => [
      { id: 'owned', owner: 'task', status: 'running' },
      { id: 'host', status: 'running' },
      { id: 'foreign', owner: 'other', status: 'running' }
    ],
    kill: (id: string, owner: string) => {
      assert.equal(owner, 'task')
      killed.push(id)
    },
    wait: async () => ({ status: terminal ? 'killed' : 'stopping' })
  }
  const actor: any = {
    id: 'task',
    session: { id: 'task' },
    ctx: {
      goals: { get: () => ({ id: 'g', revision: 1, phase: 'active' }), pause: () => paused.push('g') },
      jobs
    },
    cancel: () => cancelled.push('task'),
    whenIdle: async () => {}
  }
  const host: any = { agents: { get: () => actor, isOwnedBy: () => false }, on: () => () => {} }
  await stopNativeTaskActors(host, [actor], new Map())
  assert.deepEqual(killed, ['owned'])
  assert.deepEqual(paused, ['g'])
  assert.deepEqual(cancelled, ['task'])
  terminal = false
  await assert.rejects(stopNativeTaskActors(host, [actor], new Map()), /尚未确认停止/)
})
