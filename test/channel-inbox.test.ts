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
test('control receipts survive restart without re-entering model input or applying the decision again', (t) => {
  const f = fixture(t),
    accepted = f.inbox.accept({ ...message(), text: '/approve A1234567890' }, recipient)
  assert.equal(f.inbox.claimControl(accepted.id, 'approve', 'epoch-one'), true)
  assert.equal(f.inbox.claimControl(accepted.id, 'approve', 'epoch-one'), false)
  f.reopen()
  f.inbox.recoverInterrupted('epoch-two')
  assert.equal(f.inbox.controls()[0].status, 'uncertain')
  assert.deepEqual(f.inbox.pending(), [])
  assert.equal(
    f.inbox.accept({ ...message(), text: '/approve A1234567890', eventId: 'redelivery' }, recipient)
      .duplicate,
    true
  )
  assert.equal(f.inbox.claimControl(accepted.id, 'approve', 'epoch-two'), false)
})

test('unknown output from one task does not block another task in the same conversation', (t) => {
  const f = fixture(t)
  for (const task of ['a', 'b']) {
    const target = { ...recipient, executionSessionId: 'task-' + task },
      row = f.inbox.accept(message('om_' + task), target),
      claim = { ...target, sessionId: target.executionSessionId, epoch: 'e', requestId: 'req-' + task }
    assert.equal(f.inbox.claim(row.id, claim), true)
    f.inbox.admit(row.id, claim, 'native-' + task)
    const reply = f.inbox.beginReply('call', row.id, claim.sessionId, 'result ' + task, 'e')
    assert.equal(reply.phase, 'new')
    f.inbox.finishReply(reply.id, task === 'a' ? 'uncertain' : 'sent', { sent: task === 'b' })
  }
  assert.equal(f.inbox.firstForSession('task-a')?.receipt.recipient.executionSessionId, 'task-a')
  assert.equal(f.inbox.pendingReplies().length, 1)
})

test('never-attempted task output survives restart, while unknown sends are never retried automatically', (t) => {
  const f = fixture(t),
    target = { ...recipient, executionSessionId: 'task' },
    row = f.inbox.accept(message(), target),
    claim = { ...target, sessionId: 'task', epoch: 'one', requestId: 'request' }
  f.inbox.claim(row.id, claim)
  f.inbox.admit(row.id, claim, 'native')
  const queued = f.inbox.queueReply('output-1', row.id, 'task', 'first')
  assert.equal(queued.phase, 'queued')
  assert.equal(f.inbox.pendingReplies().length, 0)
  f.reopen()
  f.inbox.recoverInterrupted('two')
  assert.equal(f.inbox.queuedReplies()[0].draft, 'first')
  assert.equal(f.inbox.beginReply('output-1', row.id, 'task', 'first', 'two').phase, 'new')
  f.inbox.finishReply(queued.id, 'uncertain', { reason: 'receipt-lost' })
  assert.equal(f.inbox.queueReply('output-1', row.id, 'task', 'first').phase, 'uncertain')
  f.inbox.queueReply('output-2', row.id, 'task', 'second')
  assert.equal(f.inbox.queuedReplies().length, 1)
  assert.throws(() => f.inbox.beginReply('output-2', row.id, 'task', 'second', 'two'), /尚未确认/)
  const unknown = f.inbox.pendingReply(queued.id)!
  f.inbox.resolveReply(queued.id, unknown.revision, 'release')
  assert.equal(f.inbox.beginReply('output-2', row.id, 'task', 'second', 'two').phase, 'new')
  assert.equal(f.inbox.beginReply('output-1', row.id, 'task', 'first', 'two').phase, 'released')
})

test('settled or previous-process questions cannot publish queued stale notices', (t) => {
  const f = fixture(t),
    target = { ...recipient, executionSessionId: 'task' },
    row = f.inbox.accept(message(), target),
    claim = { ...target, sessionId: 'task', epoch: 'one', requestId: 'request' }
  f.inbox.claim(row.id, claim)
  f.inbox.admit(row.id, claim, 'native')
  f.inbox.queueReply('interaction:task:one', row.id, 'task', 'question one')
  f.inbox.cancelQueuedReply('task', row.id, 'interaction:task:one')
  assert.equal(
    f.inbox.beginReply('interaction:task:one', row.id, 'task', 'question one', 'one').phase,
    'cancelled'
  )
  f.inbox.queueReply('interaction:task:two', row.id, 'task', 'question two')
  f.inbox.queueReply('output', row.id, 'task', 'result')
  f.reopen()
  f.inbox.retireQueuedInteractions()
  assert.deepEqual(
    f.inbox.queuedReplies().map((r) => r.draft),
    ['result']
  )
  f.inbox.cancelQueuedReplies('task')
  assert.equal(f.inbox.queuedReplies().length, 0)
})

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

test('reply intents survive restart, deduplicate exact native calls and block an uncertain conversation only', (t) => {
  const f = fixture(t),
    a = f.inbox.accept(message(), recipient),
    claim = { ...recipient, epoch: 'run', sessionId: 'session', requestId: 'request' }
  assert.throws(() => f.inbox.beginReply('call', a.id, 'session', 'reply'), /持久接收/)
  f.inbox.claim(a.id, claim)
  f.inbox.admit(a.id, claim, 'native-message')
  const intent = f.inbox.beginReply('call', a.id, 'session', 'reply')
  assert.equal(intent.phase, 'new')
  assert.equal(f.inbox.beginReply('call', a.id, 'session', 'reply').phase, 'sending')
  assert.throws(() => f.inbox.beginReply('call', a.id, 'session', 'different'), /内容已变化/)
  f.reopen()
  assert.throws(() => f.inbox.beginReply('new-call', a.id, 'session', 'reply'), /尚未确认/)
  f.inbox.finishReply(intent.id, 'sent', { sent: true, messageId: 'external-reply' })
  assert.deepEqual(f.inbox.beginReply('call', a.id, 'session', 'reply').result, {
    sent: true,
    messageId: 'external-reply'
  })
  const next = f.inbox.beginReply('new-call', a.id, 'session', 'another reply')
  f.inbox.finishReply(next.id, 'uncertain', { code: 'reply-result-unknown' })
  f.reopen()
  assert.throws(() => f.inbox.beginReply('third-call', a.id, 'session', 'another'), /尚未确认/)
})

test('human reply resolution is versioned, labels its evidence, and never replays the old call', (t) => {
  const f = fixture(t),
    source = f.inbox.accept(message(), recipient),
    claim = { ...recipient, epoch: 'run1', sessionId: 'native', requestId: 'request' }
  f.inbox.claim(source.id, claim)
  f.inbox.admit(source.id, claim, 'native-message')
  const sending = f.inbox.beginReply('call', source.id, 'native', 'pending text', 'run1'),
    old = f.inbox.pendingReplies()[0]
  assert.equal(old.draft, 'pending text')
  f.reopen()
  f.inbox.recoverInterrupted('run2')
  const uncertain = f.inbox.pendingReplies()[0]
  assert.equal(uncertain.phase, 'uncertain')
  assert.throws(() => f.inbox.resolveReply(sending.id, old.revision, 'sent'), /已变化/)
  f.inbox.resolveReply(sending.id, uncertain.revision, 'release')
  assert.equal(f.inbox.pendingReplies().length, 0)
  assert.equal(f.inbox.beginReply('call', source.id, 'native', 'pending text', 'run2').phase, 'released')
  const next = f.inbox.beginReply('new-call', source.id, 'native', 'next text', 'run2')
  f.inbox.finishReply(next.id, 'uncertain', { code: 'unknown' })
  const pending = f.inbox.pendingReplies()[0]
  f.inbox.resolveReply(next.id, pending.revision, 'sent')
  assert.deepEqual(f.inbox.beginReply('new-call', source.id, 'native', 'next text', 'run2').result, {
    sent: true,
    confirmedBy: 'human'
  })
})
