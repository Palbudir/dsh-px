import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { QqAttentionInbox } from '../packages/dsh-px-qq/src/attention-inbox'

function fixture(t: any, bounds?: any) {
  const dir = mkdtempSync(join(tmpdir(), 'px-attention-inbox-')),
    file = join(dir, 'inbox.sqlite')
  const db = new QqAttentionInbox(file, '12001', bounds)
  t.after(() => {
    try {
      db.close()
    } catch {}
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  return { db, file }
}
const frame = (id: number, group = 34007) => ({
  post_type: 'message',
  self_id: 12001,
  message_type: 'group',
  group_id: group,
  user_id: 45009,
  message_id: id,
  message: [{ type: 'text', data: { text: '不是@的普通消息 ' + id } }]
})

test('inbox keeps every pending event, separates chats, deduplicates before changing payload and survives reopening', (t) => {
  const { db, file } = fixture(t)
  for (let i = 1; i <= 20; i++) db.receive(frame(i, i % 2 ? 34007 : 34008))
  assert.equal(db.pending('group:34007').length, 10)
  const duplicate = db.receive({
    ...frame(1),
    message: [{ type: 'text', data: { text: 'forged replacement' } }]
  })!
  assert.equal(duplicate.duplicate, true)
  assert.ok(!JSON.stringify(duplicate).includes('forged replacement'))
  const first = db.pending('group:34007')[0]
  db.claim(first.id)
  db.admitted(first.id, 'native-session', 'native-message')
  assert.equal(db.summaries().items.find((x) => x.chatId === 'group:34007')?.queued, 1)
  db.presented('wrong-session', 'native-message')
  assert.equal(db.summaries().items.find((x) => x.chatId === 'group:34007')?.queued, 1)
  db.presented('native-session', 'native-message')
  assert.equal(db.summaries().items.find((x) => x.chatId === 'group:34007')?.queued, 0)
  db.close()
  const restart = new QqAttentionInbox(file, '12001')
  try {
    assert.equal(restart.pending('group:34007').length, 9)
    assert.equal(restart.pending('group:34008').length, 10)
  } finally {
    restart.close()
  }
})
test('an interrupted dispatch becomes uncertain instead of being replayed, and account mismatches preserve records', (t) => {
  const { db, file } = fixture(t)
  const row = db.receive(frame(1))!.message
  db.claim(row.id)
  db.close()
  assert.throws(() => new QqAttentionInbox(file, '99999'), /账号/)
  const restart = new QqAttentionInbox(file, '12001')
  try {
    assert.equal(restart.pending('group:34007').length, 0)
    assert.equal(restart.summaries().items[0].uncertain, 1)
    assert.throws(() => restart.claim(row.id), /重复/)
  } finally {
    restart.close()
  }
})
test('capacity failure does not overwrite unread messages and finished context can release capacity', (t) => {
  const { db } = fixture(t, { messages: 2, pendingBytes: 10000, eventBytes: 2000 })
  const first = db.receive(frame(1))!.message
  db.receive(frame(2))
  assert.throws(() => db.receive(frame(3)), /积压/)
  assert.equal(db.pending('group:34007').length, 2)
  db.claim(first.id)
  db.consumed(first.id)
  db.receive(frame(3))
  assert.deepEqual(
    db.pending('group:34007').map((x) => x.messageId),
    ['2', '3']
  )
  assert.equal(db.receive({ ...frame(4), user_id: 12001 }), undefined)
  assert.throws(() => db.receive({ ...frame(4), self_id: 99999 }), /账号/)
})

test('notification attempts retain pending messages without repeatedly presenting unchanged previews', (t) => {
  const { db } = fixture(t)
  db.receive(frame(1))
  const notices = db.notifications()
  assert.equal(notices.length, 1)
  db.noticeAttempt(notices)
  assert.equal(db.pending('group:34007').length, 1)
  assert.deepEqual(db.notifications(), [])
  db.receive(frame(2))
  assert.equal(db.notifications()[0].count, 2)
  db.noticeAttempt(notices) // A late old cursor must not roll forward past new messages.
  assert.equal(db.notifications().length, 1)
  db.noticeAttempt(db.notifications())
  assert.deepEqual(db.notifications(), [])
  db.retryNotifications()
  assert.equal(db.notifications()[0].count, 2)
})

test('stop cancels old queued inputs durably, excludes its own command, and accepts later distinct inputs', (t) => {
  const { db, file } = fixture(t)
  const queued = db.receive(frame(1))!.message
  const other = db.receive(frame(2, 34008))!.message
  const command = db.receive(frame(3))!.message
  db.claim(command.id)
  db.cancelPending('group:34007', '3')
  assert.equal(db.canDispatch(queued.id), false)
  assert.equal(db.canDispatch(other.id), true)
  db.consumed(command.id)
  assert.equal(db.summaries().items.find((x) => x.chatId === 'group:34007')?.cancelled, 1)
  db.close()
  const restart = new QqAttentionInbox(file, '12001')
  try {
    assert.equal(restart.receive(frame(1))!.message.phase, 'cancelled')
    const later = restart.receive(frame(4))!.message
    assert.equal(restart.canDispatch(later.id), true)
    restart.cancelPending()
    assert.deepEqual(restart.pendingChats(), [])
    assert.equal(restart.receive(frame(5))!.message.phase, 'received')
  } finally {
    restart.close()
  }
})
