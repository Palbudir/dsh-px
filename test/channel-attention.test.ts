import test from 'node:test'
import assert from 'node:assert/strict'
import { decideChannelAttention, type ChannelAttentionRouting } from '../packages/shared/channel-attention'

const normal: ChannelAttentionRouting = {
  mode: 'normal',
  focusedChats: [],
  mutedChats: [],
  notifyDirect: true,
  notifyMentions: true,
  notifyGroups: false,
  mentionOverridesMute: true
}

test('common attention uses adapter conversation kinds and opaque IDs instead of QQ naming conventions', () => {
  const opaque = {
    conversationId: 'oc_external-conversation',
    kind: 'direct' as const,
    mentioned: false,
    self: false
  }
  assert.equal(decideChannelAttention(normal, opaque).reason, 'direct')
  const resemblesQq = { ...opaque, conversationId: 'private:123456', kind: 'group' as const }
  assert.deepEqual(decideChannelAttention(normal, resemblesQq), {
    content: 'preview',
    notify: false,
    reason: 'unfocused'
  })
  assert.equal(
    decideChannelAttention({ ...normal, focusedChats: [opaque.conversationId] }, { ...opaque, kind: 'group' })
      .reason,
    'watched'
  )
  assert.equal(
    decideChannelAttention({ ...normal, mode: 'focus' }, { ...opaque, self: true }).content,
    'ignore'
  )
})

test('notification-only and mute rules keep explicit viewing separate from interruption', () => {
  const message = { conversationId: 'chat:opaque', kind: 'group' as const, mentioned: true, self: false },
    muted = {
      ...normal,
      mode: 'notifications' as const,
      mutedChats: ['chat:opaque'],
      mentionOverridesMute: false
    }
  assert.deepEqual(decideChannelAttention(muted, message), {
    content: 'preview',
    notify: false,
    reason: 'muted'
  })
  assert.equal(decideChannelAttention({ ...muted, mentionOverridesMute: true }, message).notify, true)
  assert.deepEqual(decideChannelAttention({ ...muted, openedChats: ['chat:opaque'] }, message), {
    content: 'full',
    notify: false,
    reason: 'watched'
  })
  assert.throws(() => decideChannelAttention(normal, { ...message, kind: 'unknown' as any }), /无效/)
  assert.throws(() => decideChannelAttention(normal, { ...message, conversationId: 'bad\nidentity' }), /无效/)
})
