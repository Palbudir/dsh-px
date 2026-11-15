import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { ChannelInbox } from '../packages/shared/channel-inbox'
import { FeishuAttention } from '../packages/dsh-px-workbench/src/feishu-attention'
import {
  channelRoute,
  defaultChannelAttention,
  type ChannelAccount
} from '../packages/dsh-px-workbench/src/channel-settings'
import { ChannelAttentionObserver } from '../packages/shared/channel-attention-observer'
import { isInternalSession } from '../packages/dsh-px-memory/src/store'

test('shared attention roots remain internal while ordinary channel sessions keep their conversational identity', () => {
  const uuid = '12345678-1234-4234-8234-123456789abc'
  assert.equal(isInternalSession('px-channel-attention-root-' + uuid), true)
  assert.equal(isInternalSession('px-qq-attention-' + uuid), true)
  assert.equal(isInternalSession('px-channel-' + 'a'.repeat(64)), false)
})

test('suppressed notification bursts coalesce inbox scans without starting empty model work', async () => {
  let scans = 0,
    work = 0
  const observer = new ChannelAttentionObserver(
    {
      candidates: () => {
        scans++
        return []
      },
      busy: () => false,
      attempted: () => {},
      work: async () => {
        work++
        return { open: [], minutes: 1, reason: '' }
      },
      apply: () => {}
    },
    1
  )
  try {
    for (let i = 0; i < 100; i++) observer.schedule()
    assert.equal(scans, 1)
    await new Promise((r) => setTimeout(r, 450))
    assert.equal(scans, 2)
    assert.equal(work, 0)
  } finally {
    await observer.dispose()
  }
})

test('an empty deferred scan does not erase a failed notification judgment', async () => {
  let rows = [
      {
        chatId: 'oc_group',
        kind: 'group' as const,
        through: 1,
        count: 1,
        preview: 'x',
        mentioned: false,
        receivedAt: 1
      }
    ],
    work = 0
  const observer = new ChannelAttentionObserver(
    {
      candidates: () => rows,
      busy: () => false,
      attempted: () => {
        rows = []
      },
      work: async () => {
        work++
        throw Error('injected analysis failure')
      },
      apply: () => {}
    },
    1
  )
  try {
    observer.schedule()
    const end = Date.now() + 2500
    while (observer.snapshot().phase !== 'failed' && Date.now() < end)
      await new Promise((r) => setTimeout(r, 20))
    assert.equal(observer.snapshot().phase, 'failed')
    for (let i = 0; i < 100; i++) observer.schedule()
    await new Promise((r) => setTimeout(r, 450))
    assert.equal(observer.snapshot().phase, 'failed')
    assert.equal(work, 1)
  } finally {
    await observer.dispose()
  }
})

test('notification attempts are durable and persona-specific, without acknowledging or consuming messages', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-notice-')),
    file = join(root, 'inbox.sqlite'),
    owner = { provider: 'feishu', accountId: 'bot', fingerprint: 'a'.repeat(64) }
  let inbox = new ChannelInbox(file, owner)
  t.after(() => {
    inbox.close()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  const add = (messageId: string, personaId: string, routeRevision: number) =>
    inbox.accept(
      {
        ...owner,
        eventId: messageId,
        messageId,
        conversationId: 'chat',
        actorId: 'member',
        kind: 'direct',
        mentioned: false,
        at: new Date().toISOString(),
        text: 'preview-' + messageId,
        reply: { messageId }
      },
      { personaId, routeRevision }
    )
  add('one', 'a', 1)
  add('two', 'a', 1)
  const notices = inbox.notices()
  assert.equal(notices.length, 1)
  assert.equal(notices[0].count, 2)
  assert.equal(notices[0].preview, 'preview-two')
  inbox.noticeAttempt(notices)
  inbox.close()
  inbox = new ChannelInbox(file, owner)
  assert.equal(inbox.notices().length, 0)
  assert.equal(inbox.pending().length, 2)
  add('three', 'b', 2)
  assert.equal(inbox.notices()[0].recipient.personaId, 'b')
  inbox.retryNotices()
  assert.equal(inbox.notices().length, 2)
})

test('temporary attention cannot cross persona routes or silence direct messages, and user settings supersede it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-notice-scope-')),
    owner = { provider: 'feishu', accountId: 'bot', fingerprint: 'a'.repeat(64) },
    inbox = new ChannelInbox(join(root, 'inbox.sqlite'), owner)
  const account: ChannelAccount = {
    ...owner,
    provider: 'feishu',
    personaId: 'a',
    routeRevision: 1,
    workspace: root,
    enabled: true,
    authorizedUsers: [],
    publicInstructions: '',
    attention: { ...defaultChannelAttention(), mode: 'notifications', allowAgentChanges: true },
    routes: [{ conversationId: 'chat-b', personaId: 'b', revision: 2 }]
  }
  for (const chat of ['chat-a', 'chat-b'])
    inbox.accept(
      {
        ...owner,
        eventId: chat,
        messageId: chat,
        conversationId: chat,
        actorId: 'member',
        kind: 'direct',
        mentioned: false,
        at: new Date().toISOString(),
        text: 'private preview ' + chat,
        reply: { messageId: chat }
      },
      channelRoute(account, chat)
    )
  let online = true,
    dispatches = 0
  const attention = new FeishuAttention(
    {},
    () => account,
    inbox,
    () => online,
    (row) => JSON.stringify(channelRoute(account, row.chatId)) === JSON.stringify(row.recipient),
    () => {
      dispatches++
    }
  )
  t.after(async () => {
    await attention.dispose()
    inbox.close()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  assert.deepEqual(
    attention.status('a').notices.map((r) => r.chatId),
    ['chat-a']
  )
  assert.deepEqual(attention.status('a').observer, { phase: 'idle' })
  assert.throws(
    () => attention.action('a', { action: 'open', chatId: 'chat-b', minutes: 1, reason: 'try' }),
    /本人格/
  )
  assert.throws(
    () => attention.action('a', { action: 'quiet', chatId: 'chat-a', minutes: 1, reason: 'try' }),
    /普通群/
  )
  attention.action('a', { action: 'open', chatId: 'chat-a', minutes: 1, reason: 'respond' })
  assert.deepEqual(attention.effective().openedChats, ['chat-a'])
  assert.equal(dispatches, 1)
  online = false
  account.attention.allowAgentChanges = false
  attention.refresh()
  assert.deepEqual(attention.effective().openedChats, [])
  online = true
  assert.throws(() => attention.action('a', { action: 'open', chatId: 'chat-a', reason: 'try' }), /尚未允许/)
  await attention.dispose()
  assert.throws(() => attention.action('a', { action: 'status' }), /未运行/)
})

test('shared observer uses trusted chat kind rather than a QQ-specific prefix for quiet decisions', async () => {
  let rows = [
      {
        chatId: 'oc_group',
        kind: 'group' as const,
        through: 1,
        count: 1,
        preview: 'chat',
        mentioned: false,
        receivedAt: 1
      }
    ],
    applied = false
  const observer = new ChannelAttentionObserver(
    {
      candidates: () => rows,
      busy: () => false,
      attempted: () => {
        rows = []
      },
      work: async () => ({ open: [], quiet: ['oc_group'], minutes: 1, reason: '暂时旁听' }),
      apply: () => {
        applied = true
      }
    },
    1
  )
  try {
    observer.schedule()
    const until = Date.now() + 2500
    while (!applied && Date.now() < until) await new Promise((r) => setTimeout(r, 20))
    assert.equal(applied, true)
  } finally {
    await observer.dispose()
  }
})

test('hundreds of non-notifying groups do not hide a later direct notice or prevent opening its exact chat', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-notice-pages-')),
    owner = { provider: 'feishu', accountId: 'bot', fingerprint: 'a'.repeat(64) },
    inbox = new ChannelInbox(join(root, 'inbox.sqlite'), owner)
  const account: ChannelAccount = {
    ...owner,
    provider: 'feishu',
    personaId: 'a',
    routeRevision: 1,
    workspace: root,
    enabled: true,
    authorizedUsers: [],
    publicInstructions: '',
    attention: { ...defaultChannelAttention(), mode: 'notifications', allowAgentChanges: true }
  }
  for (let i = 0; i < 520; i++)
    inbox.accept(
      {
        ...owner,
        eventId: 'e' + i,
        messageId: 'm' + i,
        conversationId: 'group-' + i,
        actorId: 'member',
        kind: 'group',
        mentioned: false,
        at: new Date().toISOString(),
        text: 'quiet',
        reply: { messageId: 'm' + i }
      },
      { personaId: 'a', routeRevision: 1 }
    )
  inbox.accept(
    {
      ...owner,
      eventId: 'direct',
      messageId: 'direct',
      conversationId: 'direct-last',
      actorId: 'member',
      kind: 'direct',
      mentioned: false,
      at: new Date().toISOString(),
      text: 'question',
      reply: { messageId: 'direct' }
    },
    { personaId: 'a', routeRevision: 1 }
  )
  const attention = new FeishuAttention(
    {},
    () => account,
    inbox,
    () => true,
    () => true,
    () => {}
  )
  t.after(async () => {
    await attention.dispose()
    inbox.close()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  assert.deepEqual(
    attention.previews('a').map((row) => row.chatId),
    ['direct-last']
  )
  attention.action('a', { action: 'open', chatId: 'direct-last', minutes: 1, reason: 'respond' })
  assert.deepEqual(attention.effective().openedChats, ['direct-last'])
})
