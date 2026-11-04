/** Metadata is attached by the local transport, never parsed from the message text. */
export interface QqMessageOrigin {
  version: 1
  accountId: string
  conversationId: string
  senderId: string
  messageId?: string
  delivery?: 'context'
  routeRevision?: number
}
const qqId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{4,19}$/.test(value) && Number.isSafeInteger(Number(value))
export function qqMessageOrigin(source: any): QqMessageOrigin | undefined {
  const value = source?.pxQq
  return source?.kind === 'plugin:dsh-onebot' &&
    value?.version === 1 &&
    qqId(value.accountId) &&
    qqId(value.senderId) &&
    typeof value.conversationId === 'string' &&
    /^(private|group):[1-9]\d{4,19}$/.test(value.conversationId)
    ? {
        version: 1,
        accountId: value.accountId,
        conversationId: value.conversationId,
        senderId: value.senderId,
        ...(value.delivery === 'context' ? { delivery: 'context' as const } : {}),
        ...(Number.isSafeInteger(value.routeRevision) && value.routeRevision >= 0
          ? { routeRevision: value.routeRevision }
          : {}),
        ...(typeof value.messageId === 'string' && /^[A-Za-z0-9:_.-]{1,120}$/.test(value.messageId)
          ? { messageId: value.messageId }
          : {})
      }
    : undefined
}
export function conversationalSource(source: any): boolean {
  return source?.kind === 'user' || channelMessageOrigin(source) !== undefined
}

export interface ChannelMessageOrigin extends QqMessageOrigin {
  provider: string
}
/** Provenance, not authorization. Only a registered Host adapter may create this source object. */
export function channelMessageOrigin(source: any): ChannelMessageOrigin | undefined {
  const qq = qqMessageOrigin(source)
  if (qq) return { ...qq, provider: 'qq' }
  const identifier = (value: unknown): value is string =>
    typeof value === 'string' && !!value.trim() && value.length <= 512 && !/[\r\n\0]/.test(value)
  if (
    source?.kind !== 'plugin:dsh-px-channel' ||
    source.version !== 1 ||
    typeof source.provider !== 'string' ||
    !/^[a-z][a-z0-9.-]{0,79}$/.test(source.provider) ||
    ![
      source.accountId,
      source.conversationId,
      source.actorId,
      source.messageId,
      source.personaId,
      source.epoch,
      source.requestId
    ].every(identifier) ||
    !/^[a-f0-9]{64}$/.test(source.fingerprint ?? '') ||
    !/^[a-f0-9]{64}$/.test(source.ingressId ?? '') ||
    !Number.isSafeInteger(source.routeRevision) ||
    source.routeRevision < 0 ||
    (source.delivery !== undefined && source.delivery !== 'context')
  )
    return
  return {
    version: 1,
    provider: source.provider,
    accountId: source.accountId,
    conversationId: source.conversationId,
    senderId: source.actorId,
    messageId: source.messageId,
    routeRevision: source.routeRevision,
    ...(source.delivery === 'context' ? { delivery: 'context' as const } : {})
  }
}
export const QQ_CONVERSATION_TOOLS: readonly string[] = [
  'persona_mail',
  'job_output',
  'job_kill',
  'qq_context',
  'qq_expression',
  'qq_document',
  'qq_memory',
  'qq_reply',
  'persona_history'
]
export const CHANNEL_CONVERSATION_TOOLS: readonly string[] = [
  'channel_task',
  'persona_mail',
  'job_output',
  'job_kill',
  'channel_reply',
  'channel_history',
  'channel_memory',
  'channel_knowledge',
  'persona_history'
]
