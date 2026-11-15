import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { FeishuTasks } from '../packages/dsh-px-workbench/src/feishu-tasks'
import { FeishuChannel } from '../packages/dsh-px-workbench/src/feishu-channel'
import {
  defaultChannelAttention,
  type ChannelAccount
} from '../packages/dsh-px-workbench/src/channel-settings'

async function until(check: () => boolean) {
  const end = Date.now() + 5000
  while (!check()) {
    if (Date.now() > end) throw Error('recovery test timeout')
    await delay(10)
  }
}
function setup(t: any) {
  const directory = mkdtempSync(join(tmpdir(), 'px-feishu-recovery-'))
  const beforeClose: Array<() => Promise<void>> = []
  const account: ChannelAccount = {
    provider: 'feishu',
    accountId: 'bot',
    fingerprint: 'a'.repeat(64),
    enabled: true,
    personaId: 'default',
    workspace: directory,
    routeRevision: 1,
    authorizedUsers: ['owner'],
    publicInstructions: '',
    attention: defaultChannelAttention()
  }
  const host: any = {
    agents: { get: () => undefined },
    pxPersonaResources: { allowsChannel: () => true },
    pxMemoryChannels: { channelBindings: () => [], inspect: () => ({}) }
  }
  const tasks = new FeishuTasks(
    host,
    account,
    () => account,
    () => true,
    directory,
    'epoch',
    async () => {}
  )
  const add = (id: string) =>
    tasks.inbox.accept(
      {
        provider: 'feishu',
        accountId: 'bot',
        fingerprint: account.fingerprint,
        eventId: id,
        messageId: id,
        conversationId: 'chat',
        actorId: 'owner',
        kind: 'group',
        mentioned: true,
        at: new Date().toISOString(),
        text: 'test request',
        reply: { messageId: id, conversationId: 'chat', actorId: 'owner' }
      },
      { personaId: 'default', routeRevision: 1, executionSessionId: 'task-' + id }
    )
  t.after(async () => {
    for (const dispose of beforeClose) await dispose()
    await tasks.dispose()
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
    rmSync(directory, { recursive: true, force: true })
  })
  return { directory, account, host, tasks, add, beforeClose }
}

test('explicit task retry recovers a pre-admission failure without retrying uncertain native input', async (t) => {
  const f = setup(t),
    row = f.add('first')
  let attempts = 0,
    admitted = 0
  ;(f.tasks as any).activated = true
  ;(f.tasks as any).prepare = async () => {
    if (++attempts === 1) throw Error('transient model selection failure')
    return {
      agent: {
        session: { id: 'task-first' },
        followup: () => {
          admitted++
        }
      },
      sessions: { flush: async () => true },
      validate: () => true
    }
  }
  f.tasks.dispatch.schedule()
  await until(() => f.tasks.dispatch.blockedIds().includes(row.id))
  assert.equal(f.tasks.inbox.receipt(row.id)?.phase, 'received')
  f.tasks.resumeReception()
  await delay(80)
  assert.equal(attempts, 1)
  const ambiguous = f.add('ambiguous'),
    claim = {
      personaId: 'default',
      routeRevision: 1,
      executionSessionId: 'task-ambiguous',
      sessionId: 'task-ambiguous',
      requestId: 'old-request',
      epoch: 'old-epoch'
    }
  f.tasks.inbox.claim(ambiguous.id, claim)
  f.tasks.inbox.recoverInterrupted('epoch')
  ;(f.tasks.dispatch as any).blocked.add(ambiguous.id)
  f.tasks.retryAdmission()
  await until(() => f.tasks.inbox.receipt(row.id)?.phase === 'admitted')
  assert.equal(attempts, 2)
  assert.equal(admitted, 1)
  assert.equal(f.tasks.inbox.receipt(ambiguous.id)?.phase, 'uncertain')
  assert.ok(f.tasks.dispatch.blockedIds().includes(ambiguous.id))
})

test('disconnected task replies stay queued and resume once, while ambiguous sends remain protected', async (t) => {
  const f = setup(t),
    row = f.add('delivery'),
    recipient = { personaId: 'default', routeRevision: 1, executionSessionId: 'task-delivery' },
    claim = { ...recipient, sessionId: 'task-delivery', requestId: 'request', epoch: 'epoch' }
  f.tasks.inbox.claim(row.id, claim)
  f.tasks.inbox.admit(row.id, claim, 'native-message')
  const origin = { id: row.id, receipt: f.tasks.inbox.receipt(row.id)! }
  let connected = false,
    mode = 'online',
    sent = 0,
    attempts = 0
  f.host.dshIm = {
    describeBot: async () => ({ botId: 'bot', account: { fingerprint: f.account.fingerprint }, connected }),
    replyChecked: async () => {
      attempts++
      if (mode === 'race')
        throw Object.assign(Error('offline before send'), { code: 'capability-unavailable' })
      if (mode === 'unknown') throw Object.assign(Error('lost receipt'), { code: 'reply-result-unknown' })
      sent++
      return { sent: true, messageId: 'reply-' + sent }
    }
  }
  const channel = new FeishuChannel(f.host, f.account, () => f.account, f.directory, f.tasks)
  ;(channel as any).lease = { dispose() {} }
  f.tasks.owns = () => true
  const send = (key: string, text: string) =>
    channel.deliverReply(f.tasks.inbox, origin, 'task-delivery', key, text, new AbortController().signal)
  f.beforeClose.push(() => channel.dispose())
  f.tasks.inbox.queueReply('output', row.id, 'task-delivery', 'result')
  await assert.rejects(send('output', 'result'), /暂未连接/)
  assert.equal(attempts, 0)
  assert.equal(f.tasks.inbox.queuedReplies().length, 1)
  connected = true
  mode = 'race'
  await assert.rejects(send('output', 'result'), /offline before send/)
  assert.equal(f.tasks.inbox.queuedReplies().length, 1)
  assert.equal(f.tasks.inbox.pendingReplies().length, 0)
  mode = 'online'
  let recoveryError: unknown
  f.tasks.flushOutputs = async () => {
    try {
      await send('output', 'result')
    } catch (e) {
      recoveryError = e
    }
  }
  await until(() => sent === 1)
  assert.equal(recoveryError, undefined)
  assert.equal(f.tasks.inbox.queuedReplies().length, 0)
  connected = false
  await send('output', 'result') // durable prior success, even while offline
  assert.equal(sent, 1)
  connected = true
  mode = 'unknown'
  f.tasks.inbox.queueReply('unknown', row.id, 'task-delivery', 'unknown result')
  await assert.rejects(send('unknown', 'unknown result'), /lost receipt/)
  const uncertain = f.tasks.inbox.pendingReplies()[0]
  assert.equal(uncertain.phase, 'uncertain')
  assert.equal(f.tasks.inbox.queuedReplies().length, 0)
  assert.throws(
    () => f.tasks.inbox.deferUnsentReply(uncertain.id, (channel as any).epoch, 'bot-not-connected'),
    /状态已变化/
  )
})

test('a transient delivery failure cannot let later pages of the same task overtake its queued head', async (t) => {
  const f = setup(t),
    sent: string[] = []
  for (const name of ['long', 'other']) {
    const row = f.add(name),
      recipient = { personaId: 'default', routeRevision: 1, executionSessionId: 'task-' + name },
      claim = { ...recipient, sessionId: 'task-' + name, requestId: 'request-' + name, epoch: 'epoch' }
    f.tasks.inbox.claim(row.id, claim)
    f.tasks.inbox.admit(row.id, claim, 'native-' + name)
    for (let n = 1; n <= (name === 'long' ? 101 : 1); n++)
      f.tasks.inbox.queueReply(
        'part-' + n,
        row.id,
        'task-' + name,
        name === 'long' ? 'part-' + n : 'other-result'
      )
  }
  f.tasks.owns = () => true
  let failOnce = true
  ;(f.tasks as any).deliver = async (
    inbox: any,
    origin: any,
    sessionId: string,
    key: string,
    body: string
  ) => {
    const intent = inbox.beginReply(key, origin.id, sessionId, body, 'epoch')
    assert.equal(intent.phase, 'new')
    if (body === 'part-1' && failOnce) {
      failOnce = false
      inbox.deferUnsentReply(intent.id, 'epoch', 'bot-not-connected')
      throw Error('connection recovered after this failed attempt')
    }
    sent.push(body)
    inbox.finishReply(intent.id, 'sent', { sent: true, messageId: 'reply-' + sent.length })
  }
  await f.tasks.flushOutputs()
  assert.deepEqual(sent, ['other-result'], 'independent task proceeds, but part101 must not overtake part1')
  assert.equal(f.tasks.inbox.queuedReplies(1)[0].draft, 'part-1')
  await f.tasks.flushOutputs()
  assert.deepEqual(sent, ['other-result', ...Array.from({ length: 101 }, (_, i) => 'part-' + (i + 1))])
  assert.equal(f.tasks.inbox.queuedReplies().length, 0)
})
