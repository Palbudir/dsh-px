import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { ChannelInbox } from '../packages/shared/channel-inbox'
import { startFeishuConsumer, type NativeFeishuIntake } from '../packages/shared/feishu-consumer'

test('native consumer commits before acknowledgment, wakes once and blocks callbacks after cancellation', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-feishu-intake-')),
    account = { botId: 'bot_a', fingerprint: 'a'.repeat(64) },
    inbox = new ChannelInbox(join(root, 'inbox.sqlite'), {
      provider: 'feishu',
      accountId: account.botId,
      fingerprint: account.fingerprint
    })
  t.after(() => {
    inbox.close()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  let callback!: Parameters<NativeFeishuIntake['consumeInbound']>[1]['onEvent'],
    released = 0,
    notified = 0
  const native: NativeFeishuIntake = {
      contractVersion: 1,
      inboundVersion: 1,
      describeBot: async () => ({
        version: 1,
        botId: account.botId,
        channel: 'feishu',
        connected: true,
        account: { fingerprint: account.fingerprint },
        capabilities: ['exclusive-text-consumer', 'reply-text-checked']
      }),
      consumeInbound: async (_id, options) => {
        callback = options.onEvent
        return () => {
          released++
        }
      }
    },
    abort = new AbortController(),
    errors: unknown[] = []
  const lease = await startFeishuConsumer(native, account, inbox, {
    epoch: 'host1',
    signal: abort.signal,
    authorize: () => true,
    available: async () => {
      notified++
      if (notified === 2) throw Error('asynchronous dispatch observer failed')
    },
    failed: (e) => {
      errors.push(e)
    }
  })
  const event = {
    version: 1,
    channel: 'feishu',
    ...account,
    eventId: 'event1',
    messageId: 'om1',
    actor: { kind: 'user', id: 'ou1' },
    conversation: { kind: 'group', id: 'oc1' },
    mentions: [],
    mentionedAccount: false,
    at: new Date().toISOString(),
    text: 'hello',
    reply: { messageId: 'om1', conversationId: 'oc1', actorId: 'ou1' }
  }
  assert.equal((await callback(event, { signal: new AbortController().signal })).accepted, true)
  assert.equal(inbox.pending().length, 1)
  assert.equal(notified, 2, 'startup and new durable message')
  await callback({ ...event, eventId: 'history:om1' }, { signal: new AbortController().signal })
  assert.equal(notified, 2, 'duplicate cannot schedule a second delivery')
  abort.abort()
  assert.equal(released, 1)
  await assert.rejects(
    callback(
      { ...event, messageId: 'om2', reply: { ...event.reply, messageId: 'om2' } },
      { signal: new AbortController().signal }
    )
  )
  assert.equal(inbox.pending().length, 1)
  lease.dispose()
  assert.equal(released, 1)
  assert.equal(errors.length, 1, 'observer failure does not undo durable acceptance')
  assert.match(String(errors[0]), /dispatch observer failed/)
})

test('cancelled registration releases its late native handle before exposing a live consumer', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-feishu-connect-')),
    account = { botId: 'bot_a', fingerprint: 'a'.repeat(64) },
    inbox = new ChannelInbox(join(root, 'inbox.sqlite'), {
      provider: 'feishu',
      accountId: account.botId,
      fingerprint: account.fingerprint
    })
  t.after(() => {
    inbox.close()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  let finish!: (dispose: () => void) => void,
    entered!: () => void,
    released = 0
  const entering = new Promise<void>((done) => (entered = done)),
    ready = new Promise<() => void>((done) => (finish = done)),
    abort = new AbortController()
  const pending = startFeishuConsumer(
    {
      contractVersion: 1,
      inboundVersion: 1,
      describeBot: async () => ({
        version: 1,
        botId: account.botId,
        channel: 'feishu',
        connected: true,
        account: { fingerprint: account.fingerprint },
        capabilities: ['exclusive-text-consumer', 'reply-text-checked']
      }),
      consumeInbound: async () => {
        entered()
        return ready
      }
    },
    account,
    inbox,
    {
      epoch: 'host2',
      signal: abort.signal,
      authorize: () => true,
      available: () => assert.fail('cancelled start cannot wake'),
      failed: () => {}
    }
  )
  const rejected = assert.rejects(pending)
  await entering
  abort.abort()
  finish(() => {
    released++
  })
  await rejected
  assert.equal(released, 1)
})
