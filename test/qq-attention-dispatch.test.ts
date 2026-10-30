import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { QqAttentionInbox } from '../packages/dsh-px-qq/src/attention-inbox'
import { QqAttentionDispatch } from '../packages/dsh-px-qq/src/attention-dispatch'
import { parseAttention } from '../packages/dsh-px-qq/src/attention'

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'px-attention-dispatch-'))
  const inbox = new QqAttentionInbox(join(dir, 'inbox.sqlite'), '12001')
  t.after(() => {
    inbox.close()
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  let seq = 0
  const receive = (group = 34007, mentioned = false) =>
    inbox.receive({
      post_type: 'message',
      message_type: 'group',
      self_id: 12001,
      user_id: 45009,
      group_id: group,
      message_id: ++seq,
      message: [
        ...(mentioned ? [{ type: 'at', data: { qq: '12001' } }] : []),
        { type: 'text', data: { text: '消息' + seq } }
      ]
    })
  return { inbox, receive }
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await delay(10)
  }
  throw Error('dispatch did not converge')
}
test('normal mode finds a mention beyond the first page of preview-only traffic', async (t) => {
  const { inbox, receive } = fixture(t)
  for (let i = 0; i < 60; i++) receive()
  const request = receive(34007, true)!.message
  const delivered: string[] = [],
    failures: unknown[] = []
  const pump = new QqAttentionDispatch(
    inbox,
    () => parseAttention({}),
    {
      busy: () => false,
      deliver: async (row, ambient) => {
        assert.equal(ambient, false)
        delivered.push(row.id)
        inbox.claim(row.id)
        inbox.consumed(row.id)
      },
      wake: () => assert.fail('direct request should use native followup'),
      failed: (error) => failures.push(error)
    },
    1
  )
  try {
    pump.schedule()
    await until(() => delivered.length === 1)
    assert.deepEqual(delivered, [request.id])
    assert.equal(inbox.pending('group:34007', 100).length, 60)
    assert.deepEqual(failures, [])
  } finally {
    await pump.dispose()
  }
})
test('a slow chat does not serialize another and each burst wakes after its ordered batch', async (t) => {
  const { inbox, receive } = fixture(t)
  for (let i = 0; i < 8; i++) receive(34007)
  for (let i = 0; i < 6; i++) receive(34008)
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const delivered: string[] = [],
    wakes: string[] = [],
    failures: unknown[] = []
  const pump = new QqAttentionDispatch(
    inbox,
    () => parseAttention({ mode: 'focus' }),
    {
      busy: () => false,
      deliver: async (row, ambient) => {
        assert.equal(ambient, true)
        if (row.chatId === 'group:34007') await blocked
        delivered.push(row.chatId)
        inbox.claim(row.id)
        inbox.consumed(row.id)
      },
      wake: (chat) => {
        wakes.push(chat)
      },
      failed: (error) => failures.push(error)
    },
    1
  )
  try {
    pump.schedule()
    await until(() => wakes.includes('group:34008'))
    assert.equal(delivered.filter((x) => x === 'group:34007').length, 0)
    assert.equal(delivered.filter((x) => x === 'group:34008').length, 6)
    release()
    await until(() => wakes.length === 2)
    assert.equal(delivered.filter((x) => x === 'group:34007').length, 8)
    assert.deepEqual(failures, [])
  } finally {
    release()
    await pump.dispose()
  }
})
test('a mode change while awaiting delivery leaves the remaining messages parked', async (t) => {
  const { inbox, receive } = fixture(t)
  receive()
  receive()
  let config = parseAttention({ mode: 'focus' }),
    release!: () => void
  const blocked = new Promise<void>((resolve) => {
      release = resolve
    }),
    delivered: string[] = [],
    wakes: string[] = []
  const pump = new QqAttentionDispatch(
    inbox,
    () => config,
    {
      busy: () => false,
      deliver: async (row) => {
        delivered.push(row.id)
        await blocked
        inbox.claim(row.id)
        inbox.consumed(row.id)
      },
      wake: (chat) => {
        wakes.push(chat)
      },
      failed: (error) => {
        throw error
      }
    },
    1
  )
  try {
    pump.schedule()
    await until(() => delivered.length === 1)
    config = parseAttention({ mode: 'notifications' })
    release()
    await delay(30)
    assert.equal(delivered.length, 1)
    assert.deepEqual(wakes, [])
    assert.equal(inbox.pending('group:34007').length, 1)
  } finally {
    release()
    await pump.dispose()
  }
})
