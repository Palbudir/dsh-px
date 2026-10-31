import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  audienceOf,
  sameConversationAudience,
  validateSessionChannel,
  type SessionChannel
} from '../packages/shared/subject-context'
import { MemoryStore, publicSession } from '../packages/dsh-px-memory/src/store'

const group: SessionChannel = {
  provider: 'qq',
  accountId: '123456',
  conversationId: 'group:789012',
  access: 'public',
  publicInstructions: 'Use a natural voice.'
}

test('audience keeps expression and execution authority separate and fails closed on invalid metadata', () => {
  assert.equal(audienceOf().kind, 'personal')
  assert.equal(audienceOf({ channel: group }).kind, 'conversation')
  assert.equal(
    audienceOf({ channel: { ...group, task: { requesterId: '123456', rootSessionId: 'task' } } }).kind,
    'conversation'
  )
  assert.equal(
    sameConversationAudience({ channel: group }, { channel: { ...group, publicInstructions: 'Be formal.' } }),
    true
  )
  for (const change of [
    { provider: 'feishu' },
    { accountId: '654321' },
    { conversationId: 'group:999999' },
    { access: 'owner' as const }
  ])
    assert.equal(sameConversationAudience({ channel: group }, { channel: { ...group, ...change } }), false)
  assert.throws(() => audienceOf({ channel: { ...group, access: 'unknown' } as any }), /边界无效/)
  assert.throws(() => validateSessionChannel({ ...group, provider: '../qq' }), /边界无效/)
  assert.throws(
    () =>
      validateSessionChannel({
        ...group,
        conversationId: 'private:789012',
        task: { requesterId: '123456', rootSessionId: 'task' }
      }),
    /群任务/
  )
})

test('native identity persistence carries generic audiences through descendants without reclassifying old QQ data', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'px-subject-context-'))
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  const path = join(dir, 'memory.json'),
    store = new MemoryStore(path)
  store.bind('qq', { channel: group, locked: true })
  store.bind('qq-child', { parent: 'qq', locked: true })
  const feishu: SessionChannel = { ...group, provider: 'feishu', conversationId: 'opaque-conversation' }
  store.bind('feishu', { channel: feishu, locked: true })
  store.bind('feishu-child', { parent: 'feishu', locked: true })
  const restored = new MemoryStore(path).read()
  assert.deepEqual(restored.bindings['qq-child'].channel, group)
  assert.deepEqual(restored.bindings['feishu-child'].channel, feishu)
  assert.ok(publicSession(restored.bindings['feishu-child']))
  assert.throws(
    () =>
      store.bind('bad-handoff', {
        parent: 'qq',
        channel: feishu,
        handoff: {
          sessionId: 'qq',
          throughSeq: 10,
          summary: 'must stay private',
          createdAt: new Date().toISOString()
        }
      }),
    (error: any) => error.status === 409
  )
  assert.equal(store.read().bindings['bad-handoff'], undefined)
})
