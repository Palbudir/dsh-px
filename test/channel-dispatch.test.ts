import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ChannelInbox } from '../packages/shared/channel-inbox'
import { ChannelDispatch, type ChannelDispatchPorts } from '../packages/shared/channel-dispatch'

async function until(check: () => boolean) {
  const end = Date.now() + 4000
  while (!check()) {
    if (Date.now() > end) assert.fail('channel dispatch timeout')
    await delay(5)
  }
}
function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'px-channel-dispatch-')),
    owner = { provider: 'feishu', accountId: 'bot', fingerprint: 'a'.repeat(64) },
    inbox = new ChannelInbox(join(root, 'inbox.sqlite'), owner),
    sent: string[] = [],
    failures: Array<{ id: string | undefined; error: unknown }> = []
  let dispatch: ChannelDispatch | undefined,
    sequence = 0
  const ports: ChannelDispatchPorts = {
    selection: () => 'wake',
    prepare: async (row) => ({
      agent: {
        session: { id: row.event.conversationId },
        followup() {
          sent.push(row.event.messageId)
        },
        inject() {
          sent.push(row.event.messageId)
        }
      } as any,
      sessions: { flush: async () => true },
      validate: () => true
    }),
    failed: (row, error) => {
      failures.push({ id: row?.id, error })
    }
  }
  t.after(async () => {
    await dispatch?.dispose()
    inbox.close()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  return {
    inbox,
    ports,
    sent,
    failures,
    add(chat: string) {
      const messageId = 'message-' + ++sequence
      return {
        ...inbox.accept(
          {
            ...owner,
            eventId: messageId,
            messageId,
            conversationId: chat,
            actorId: 'actor',
            kind: 'group',
            mentioned: true,
            at: new Date().toISOString(),
            text: messageId,
            reply: { messageId }
          },
          { personaId: 'persona-a', routeRevision: 1 }
        ),
        messageId
      }
    },
    start(concurrency = 2) {
      dispatch = new ChannelDispatch(inbox, 'epoch', ports, concurrency, 0)
      dispatch.schedule()
      return dispatch
    }
  }
}

test('a slow conversation does not block others; earlier sequence becoming ready is revisited', async (t) => {
  const f = fixture(t),
    a = f.add('slow'),
    a2 = f.add('slow'),
    b = f.add('fast'),
    c = f.add('third'),
    prepare = f.ports.prepare
  let release!: () => void
  const gate = new Promise<void>((done) => {
    release = done
  })
  f.ports.prepare = async (row, signal) => {
    if (row.event.messageId === a.messageId)
      await new Promise<void>((done, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        void gate.then(() => {
          signal.removeEventListener('abort', abort)
          done()
        })
      })
    return prepare(row, signal)
  }
  t.after(() => release())
  f.start()
  await until(() => f.sent.includes(c.messageId))
  assert.deepEqual(f.sent, [b.messageId, c.messageId])
  release()
  await until(() => f.sent.length === 4)
  assert.deepEqual(f.sent, [b.messageId, c.messageId, a.messageId, a2.messageId])
  assert.equal(f.failures.length, 0)
})

test('failed preparation requires an explicit retry and does not hold other chats', async (t) => {
  const f = fixture(t),
    a = f.add('bad'),
    b = f.add('good'),
    prepare = f.ports.prepare
  let broken = true,
    attempts = 0
  f.ports.prepare = async (row, signal) => {
    if (row.event.conversationId === 'bad') {
      attempts++
      if (broken) throw Error('prepare failed')
    }
    return prepare(row, signal)
  }
  const dispatch = f.start()
  await until(() => f.sent.includes(b.messageId))
  for (let i = 0; i < 4; i++) dispatch.schedule()
  await delay(30)
  assert.equal(attempts, 1)
  assert.deepEqual(dispatch.blockedIds(), [a.id])
  broken = false
  dispatch.retry(a.id)
  await until(() => f.sent.includes(a.messageId))
  assert.equal(attempts, 2)
})

test('a large set of held notifications cannot starve a later eligible conversation', async (t) => {
  const f = fixture(t)
  for (let i = 0; i < 300; i++) f.add('held-' + i)
  const eligible = f.add('ready')
  f.ports.selection = (row) => (row.event.conversationId.startsWith('held-') ? 'hold' : 'wake')
  f.start()
  await until(() => f.sent.includes(eligible.messageId))
  assert.equal(f.sent.length, 1)
  assert.equal(f.inbox.pending(100).length, 100)
})

test('stopping during preparation preserves unsubmitted input and does not send later', async (t) => {
  const f = fixture(t),
    row = f.add('cancel'),
    prepare = f.ports.prepare
  let entered = false
  f.ports.prepare = async (row, signal) => {
    entered = true
    await new Promise<void>((_done, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    return prepare(row, signal)
  }
  const dispatch = f.start()
  await until(() => entered)
  await dispatch.dispose()
  assert.equal(f.sent.length, 0)
  assert.equal(f.inbox.receipt(row.id)?.phase, 'received')
})

test('storage failure suspends dispatch until explicit recovery without crashing the Host', async (t) => {
  const f = fixture(t),
    row = f.add('recover'),
    heads = f.inbox.heads.bind(f.inbox)
  let broken = true
  f.inbox.heads = (...args) => {
    if (broken) throw Error('injected read failure')
    return heads(...args)
  }
  const dispatch = f.start()
  await until(() => dispatch.unavailable())
  assert.equal(f.sent.length, 0)
  assert.equal(f.failures.length, 1)
  assert.equal(f.failures[0].id, undefined)
  broken = false
  dispatch.retry()
  await until(() => f.sent.includes(row.messageId))
  assert.equal(dispatch.unavailable(), false)
})
