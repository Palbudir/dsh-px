import type { ChannelAttentionMessage } from './channel-attention'

export interface FeishuAccountBinding {
  botId: string
  fingerprint: string
}
export interface FeishuReplyRoute {
  messageId: string
  conversationId: string
  actorId: string
  threadId?: string
  rootId?: string
  parentId?: string
}
export interface FeishuTextEvidence {
  version: 1
  channel: 'feishu'
  botId: string
  fingerprint: string
  eventId: string
  messageId: string
  actor: { kind: 'user'; id: string; name?: string }
  conversation: { kind: 'group' | 'dm'; id: string }
  mentions: Array<{ id: string; key: string; name?: string }>
  mentionedAccount: boolean
  at: string
  text: string
  reply: FeishuReplyRoute
}
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value)

/** Validate events delivered by a registered same-Host consumer. Arbitrary JSON is not authenticated here. */
export function feishuEvidence(
  value: unknown,
  account: FeishuAccountBinding
): {
  event: FeishuTextEvidence
  attention: ChannelAttentionMessage
  messageKey: string
} {
  const e = value as FeishuTextEvidence
  if (
    !account ||
    !identifier(account.botId) ||
    !/^[a-f0-9]{64}$/.test(account.fingerprint) ||
    !e ||
    e.version !== 1 ||
    e.channel !== 'feishu' ||
    e.botId !== account.botId ||
    e.fingerprint !== account.fingerprint
  )
    throw Error('飞书收件账号身份不匹配')
  if (
    !identifier(e.eventId) ||
    !identifier(e.messageId) ||
    e.actor?.kind !== 'user' ||
    !identifier(e.actor.id) ||
    !['group', 'dm'].includes(e.conversation?.kind) ||
    !identifier(e.conversation?.id) ||
    typeof e.mentionedAccount !== 'boolean' ||
    typeof e.text !== 'string' ||
    !e.text.trim() ||
    e.text.length > 16000 ||
    typeof e.at !== 'string' ||
    !Number.isFinite(Date.parse(e.at)) ||
    !Array.isArray(e.mentions) ||
    e.mentions.length > 100 ||
    e.mentions.some((m) => !identifier(m?.id) || !identifier(m?.key))
  )
    throw Error('飞书收件证据格式无效')
  if (
    !e.reply ||
    e.reply.messageId !== e.messageId ||
    e.reply.conversationId !== e.conversation.id ||
    e.reply.actorId !== e.actor.id ||
    [e.reply.threadId, e.reply.rootId, e.reply.parentId].some((id) => id !== undefined && !identifier(id))
  )
    throw Error('飞书原消息回复路由不匹配')
  const event: FeishuTextEvidence = {
    version: 1,
    channel: 'feishu',
    botId: e.botId,
    fingerprint: e.fingerprint,
    eventId: e.eventId,
    messageId: e.messageId,
    actor: { kind: 'user', id: e.actor.id, ...(identifier(e.actor.name) ? { name: e.actor.name } : {}) },
    conversation: { kind: e.conversation.kind, id: e.conversation.id },
    mentions: e.mentions.map((m) => ({
      id: m.id,
      key: m.key,
      ...(identifier(m.name) ? { name: m.name } : {})
    })),
    mentionedAccount: e.mentionedAccount,
    at: e.at,
    text: e.text,
    reply: {
      messageId: e.reply.messageId,
      conversationId: e.reply.conversationId,
      actorId: e.reply.actorId,
      ...(e.reply.threadId === undefined ? {} : { threadId: e.reply.threadId }),
      ...(e.reply.rootId === undefined ? {} : { rootId: e.reply.rootId }),
      ...(e.reply.parentId === undefined ? {} : { parentId: e.reply.parentId })
    }
  }
  return {
    event,
    attention: {
      conversationId: event.conversation.id,
      kind: event.conversation.kind === 'dm' ? 'direct' : 'group',
      mentioned: event.mentionedAccount,
      self: false
    },
    // Provider redelivery and history:<id> observations share one message identity.
    messageKey: JSON.stringify([
      'feishu',
      account.botId,
      account.fingerprint,
      event.conversation.id,
      event.messageId
    ])
  }
}
