import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { ChannelInbox, type ChannelInboxEvent } from '../packages/shared/channel-inbox'
import { DatabaseSync } from 'node:sqlite'
const owner = { provider: 'feishu', accountId: 'bot_a', fingerprint: 'a'.repeat(64) }
const recipient = { personaId: 'persona-a', routeRevision: 1 }
const message = (id = 'om_1'): ChannelInboxEvent => ({
  ...owner,
  eventId: 'event_' + id,
  messageId: id,
  conversationId: 'oc_group',
  actorId: 'ou_owner',
  kind: 'group',
  mentioned: true,
  at: '2026-11-03T00:00:00Z',
  text: '合成内容',
  reply: { messageId: id, conversationId: 'oc_group', actorId: 'ou_owner', threadId: 'thread' }
})
function fixture(t: any, bounds?: { records: number; pendingBytes: number; eventBytes: number }) {
  const root = mkdtempSync(join(tmpdir(), 'px-channel-inbox-')),
    path = join(root, 'inbox.sqlite')
  let inbox = new ChannelInbox(path, owner, bounds)
  t.after(() => {
    inbox.close()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  return {
    path,
    get inbox() {
      return inbox
    },
    reopen: () => {
      inbox.close()
      inbox = new ChannelInbox(
        path,
        { fingerprint: owner.fingerprint, accountId: owner.accountId, provider: owner.provider },
        bounds
      )
    }
  }
}
test('durable intake deduplicates live/history evidence, preserves admission receipts and rejects changed identity', (t) => {
  const f = fixture(t),
    accepted = f.inbox.accept(message(), recipient),
    claim = { epoch: 'run1', ...recipient, sessionId: 'native-a', requestId: 'request-a' }
  assert.equal(f.inbox.accept({ ...message(), eventId: 'history:om_1' }, recipient).duplicate, true)
  assert.throws(() => f.inbox.accept({ ...message(), text: 'different' }, recipient), /已变化/)
  assert.throws(() => f.inbox.accept({ ...message(), fingerprint: 'b'.repeat(64) }, recipient), /无效/)
  assert.equal(f.inbox.claim(accepted.id, claim), true)
  assert.equal(f.inbox.claim(accepted.id, { ...claim, sessionId: 'native-b' }), false)
  f.reopen()
  assert.equal(
    f.inbox.receipt(accepted.id)?.phase,
    'dispatching',
    'opening alone cannot rewrite a live admission'
  )
  assert.equal(f.inbox.recoverInterrupted('run2'), 1)
  assert.equal(f.inbox.pending().length, 0, 'uncertain native admission must not replay')
  assert.equal(f.inbox.admit(accepted.id, { ...claim, epoch: 'wrong' }, 'native-msg'), false)
  assert.equal(
    f.inbox.admit(
      accepted.id,
      {
        requestId: claim.requestId,
        sessionId: claim.sessionId,
        personaId: claim.personaId,
        routeRevision: claim.routeRevision,
        epoch: claim.epoch
      },
      'native-msg'
    ),
    true
  )
  assert.equal(f.inbox.receipt(accepted.id)?.source.reply.threadId, 'thread')
  assert.equal('text' in f.inbox.receipt(accepted.id)!.source, false)
  f.reopen()
  assert.equal(f.inbox.accept(message(), recipient).duplicate, true)
  assert.equal(f.inbox.receipt(accepted.id)?.nativeMessageId, 'native-msg')
  assert.throws(() => new ChannelInbox(f.path, { ...owner, accountId: 'bot_b' }), /不匹配/)
})
test('capacity and cancellation preserve existing intake and cancelled messages stay deduplicated', (t) => {
  const f = fixture(t, { records: 2, pendingBytes: 4096, eventBytes: 2048 }),
    first = f.inbox.accept(message(), recipient),
    abort = new AbortController()
  abort.abort()
  assert.throws(() => f.inbox.accept(message('om_abort'), recipient, abort.signal))
  assert.equal(f.inbox.pending().length, 1)
  assert.throws(() => f.inbox.accept({ ...message('large'), text: 'x'.repeat(4096) }, recipient), /超出/)
  assert.equal(f.inbox.cancelPending(first.id), true)
  assert.equal(f.inbox.accept(message(), recipient).duplicate, true)
  f.inbox.accept(message('second'), recipient)
  assert.throws(() => f.inbox.accept(message('third'), recipient), /容量已满/)
  assert.equal(f.inbox.pending().length, 1)
  f.reopen()
  assert.equal(f.inbox.receipt(first.id)?.phase, 'cancelled')
})

test('destination is frozen when received; route changes and redelivery cannot move old work', (t) => {
  const f = fixture(t),
    first = f.inbox.accept(message(), recipient),
    next = { personaId: 'persona-b', routeRevision: 2 }
  const duplicate = f.inbox.accept({ ...message(), eventId: 'redelivered' }, next)
  assert.equal(duplicate.duplicate, true)
  assert.deepEqual(duplicate.recipient, recipient)
  const base = { epoch: 'host', sessionId: 'session', requestId: 'request' }
  assert.equal(f.inbox.claim(first.id, { ...base, ...next }), false)
  assert.equal(f.inbox.claim(first.id, { ...base, ...recipient, routeRevision: 2 }), false)
  assert.equal(f.inbox.claim(first.id, { ...base, ...recipient }), true)
  const fresh = f.inbox.accept(message('om_new'), next)
  f.reopen()
  assert.deepEqual(f.inbox.receipt(first.id)?.recipient, recipient)
  assert.deepEqual(f.inbox.pending().find((x) => x.id === fresh.id)?.recipient, next)
  assert.equal(f.inbox.admit(first.id, { ...base, ...next }, 'wrong-receipt'), false)
})

test('an uncertain conversation does not block independent conversations or reorder its next message', (t) => {
  const f = fixture(t),
    a = f.inbox.accept(message(), recipient)
  f.inbox.accept(message('second'), recipient)
  const b = f.inbox.accept(
    { ...message('third'), conversationId: 'another', reply: { conversationId: 'another' } },
    recipient
  )
  assert.deepEqual(
    f.inbox.heads().map((x) => x.id),
    [a.id, b.id]
  )
  const claim = { ...recipient, epoch: 'run1', sessionId: 'native-a', requestId: 'a' }
  f.inbox.claim(a.id, claim)
  f.inbox.recoverInterrupted('run2')
  assert.deepEqual(
    f.inbox.heads().map((x) => x.id),
    [b.id]
  )
  f.inbox.admit(a.id, claim, 'native-message')
  assert.equal(f.inbox.heads().length, 2)
})

test('legacy prototype schema is rejected without assigning existing messages a new persona', (t) => {
  const f = fixture(t)
  f.inbox.accept(message(), recipient)
  const db = new DatabaseSync(f.path)
  try {
    db.prepare("UPDATE channel_meta SET value='1' WHERE key='schema'").run()
    assert.throws(() => new ChannelInbox(f.path, owner), /格式不匹配/)
    assert.equal(db.prepare("SELECT value FROM channel_meta WHERE key='schema'").get()?.value, '1')
    assert.equal(db.prepare('SELECT count(*) n FROM channel_messages').get()?.n, 1)
  } finally {
    db.close()
  }
})
