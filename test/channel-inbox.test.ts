import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { ChannelInbox, type ChannelInboxEvent } from '../packages/shared/channel-inbox'
const owner = { provider: 'feishu', accountId: 'bot_a', fingerprint: 'a'.repeat(64) }
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
    accepted = f.inbox.accept(message()),
    claim = { epoch: 'run1', personaId: 'persona-a', sessionId: 'native-a', requestId: 'request-a' }
  assert.equal(f.inbox.accept({ ...message(), eventId: 'history:om_1' }).duplicate, true)
  assert.throws(() => f.inbox.accept({ ...message(), text: 'different' }), /已变化/)
  assert.throws(() => f.inbox.accept({ ...message(), fingerprint: 'b'.repeat(64) }), /无效/)
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
        epoch: claim.epoch
      },
      'native-msg'
    ),
    true
  )
  assert.equal(f.inbox.receipt(accepted.id)?.source.reply.threadId, 'thread')
  assert.equal('text' in f.inbox.receipt(accepted.id)!.source, false)
  f.reopen()
  assert.equal(f.inbox.accept(message()).duplicate, true)
  assert.equal(f.inbox.receipt(accepted.id)?.nativeMessageId, 'native-msg')
  assert.throws(() => new ChannelInbox(f.path, { ...owner, accountId: 'bot_b' }), /不匹配/)
})
test('capacity and cancellation preserve existing intake and cancelled messages stay deduplicated', (t) => {
  const f = fixture(t, { records: 2, pendingBytes: 4096, eventBytes: 2048 }),
    first = f.inbox.accept(message()),
    abort = new AbortController()
  abort.abort()
  assert.throws(() => f.inbox.accept(message('om_abort'), abort.signal))
  assert.equal(f.inbox.pending().length, 1)
  assert.throws(() => f.inbox.accept({ ...message('large'), text: 'x'.repeat(4096) }), /超出/)
  assert.equal(f.inbox.cancelPending(first.id), true)
  assert.equal(f.inbox.accept(message()).duplicate, true)
  f.inbox.accept(message('second'))
  assert.throws(() => f.inbox.accept(message('third')), /容量已满/)
  assert.equal(f.inbox.pending().length, 1)
  f.reopen()
  assert.equal(f.inbox.receipt(first.id)?.phase, 'cancelled')
})
