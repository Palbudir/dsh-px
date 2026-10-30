import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { QqAttentionInbox } from '../packages/dsh-px-qq/src/attention-inbox'
import { QqSessionPolicy } from '../packages/dsh-px-qq/src/session-policy'
import { DEFAULT_QQ_SETTINGS } from '../packages/dsh-px-qq/src/policy'
import { parseAttention } from '../packages/dsh-px-qq/src/attention'

test('rejected direct inputs receive bounded feedback without executing or flooding passive chats', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'px-capacity-notice-'))
  const inbox = new QqAttentionInbox(join(dir, 'inbox.sqlite'), '12001', {
    messages: 1,
    pendingBytes: 5000,
    eventBytes: 4000
  })
  const settings = {
    ...DEFAULT_QQ_SETTINGS,
    accountId: '12001',
    authorizedUsers: ['23007'],
    personaId: 'default',
    attention: parseAttention({ mode: 'notifications', allowAgentChanges: false })
  }
  const sent: Array<{ chatId: string; text: string }> = []
  const policy = new QqSessionPolicy({}, settings, {} as any, inbox)
  // DSH rejects undefined anywhere in a structured tool result, even optional fields.
  assert.deepEqual(JSON.parse(JSON.stringify(policy.attentionSnapshot())), policy.attentionSnapshot())
  policy.attach({
    receive: async () => assert.fail('must not deliver'),
    send: async (chatId, text) => {
      sent.push({ chatId, text })
    }
  })
  policy.bindConnection({
    call: async (action: string) =>
      action === 'get_login_info'
        ? { user_id: 12001 }
        : action === 'get_status'
          ? { online: true, good: true }
          : []
  })
  policy.connectionStatus(true)
  t.after(async () => {
    await policy.dispose()
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  const frame = (id: number, text = 'hello', who = 23007) => ({
    self_id: 12001,
    post_type: 'message',
    message_type: 'private',
    user_id: who,
    message_id: id,
    message: [{ type: 'text', data: { text } }]
  })
  await policy.receive(frame(1), async () => assert.fail('must not execute'))
  await assert.rejects(
    policy.receive(frame(2), async () => assert.fail('must not execute')),
    /积压/
  )
  await assert.rejects(
    policy.receive(frame(3), async () => assert.fail('must not execute')),
    /积压/
  )
  assert.equal(sent.length, 1)
  assert.equal(sent[0].chatId, 'private:23007')
  assert.match(sent[0].text, /尚未受理/)
  await assert.rejects(
    policy.receive(frame(4, 'x'.repeat(260000), 45009), async () => {}),
    /过大/
  )
  assert.equal(sent.length, 2)
  assert.equal(sent[1].chatId, 'private:45009')
  assert.ok(sent[1].text.length < 100)
  await policy.receive(frame(5, 'x'.repeat(260000), 12001), async () => {})
  await assert.rejects(
    policy.receive({ ...frame(6), self_id: 99999 }, async () => {}),
    /账号/
  )
  await assert.rejects(
    policy.receive(
      { ...frame(7, 'x'.repeat(260000), 45009), message_type: 'group', group_id: 34007 },
      async () => {}
    ),
    /过大/
  )
  assert.equal(sent.length, 2)
})
