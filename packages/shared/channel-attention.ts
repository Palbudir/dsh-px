/** Content selection only. Adapters retain account routing, actor authorization and delivery receipts. */
export type ChannelAttentionMode = 'focus' | 'normal' | 'notifications'
export interface ChannelAttentionRouting {
  mode: ChannelAttentionMode
  focusedChats: readonly string[]
  mutedChats: readonly string[]
  openedChats?: readonly string[]
  notifyDirect: boolean
  notifyMentions: boolean
  notifyGroups: boolean
  mentionOverridesMute: boolean
}
export const defaultChannelAttention = (): ChannelAttentionRouting => ({
  mode: 'normal',
  focusedChats: [],
  mutedChats: [],
  notifyDirect: true,
  notifyMentions: true,
  notifyGroups: false,
  mentionOverridesMute: true
})
export interface ChannelAttentionMessage {
  conversationId: string
  /** Derived from trusted transport metadata, never inferred from message prose. */
  kind: 'direct' | 'group'
  mentioned: boolean
  self: boolean
}
export interface ChannelAttentionDelivery {
  content: 'full' | 'preview' | 'ignore'
  notify: boolean
  reason: 'self' | 'focus' | 'watched' | 'direct' | 'mention' | 'muted' | 'notification' | 'unfocused'
}
export function decideChannelAttention(
  settings: ChannelAttentionRouting,
  message: ChannelAttentionMessage
): ChannelAttentionDelivery {
  if (
    !['focus', 'normal', 'notifications'].includes(settings.mode) ||
    !['direct', 'group'].includes(message.kind) ||
    typeof message.conversationId !== 'string' ||
    !message.conversationId.trim() ||
    message.conversationId.length > 512 ||
    /[\r\n\0]/.test(message.conversationId)
  )
    throw new Error('渠道消息模式或聊天标识无效')
  if (message.self) return { content: 'ignore', notify: false, reason: 'self' }
  const direct = message.kind === 'direct',
    muted =
      settings.mutedChats.includes(message.conversationId) &&
      !(message.mentioned && settings.mentionOverridesMute),
    notify =
      !muted &&
      (direct ? settings.notifyDirect : message.mentioned ? settings.notifyMentions : settings.notifyGroups)
  if (settings.mode === 'focus') return { content: 'full', notify: false, reason: 'focus' }
  if (settings.openedChats?.includes(message.conversationId))
    return { content: 'full', notify: false, reason: 'watched' }
  if (settings.mode === 'notifications')
    return { content: 'preview', notify, reason: muted ? 'muted' : 'notification' }
  if (settings.focusedChats.includes(message.conversationId))
    return { content: 'full', notify: false, reason: 'watched' }
  if (muted) return { content: 'preview', notify: false, reason: 'muted' }
  if (direct) return { content: 'full', notify: false, reason: 'direct' }
  if (message.mentioned) return { content: 'full', notify: false, reason: 'mention' }
  return { content: 'preview', notify, reason: 'unfocused' }
}
