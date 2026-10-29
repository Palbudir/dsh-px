/** Metadata is attached by the local transport, never parsed from the message text. */
export interface QqMessageOrigin {
  version: 1
  accountId: string
  conversationId: string
  senderId: string
  messageId?: string
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
        ...(typeof value.messageId === 'string' && /^[A-Za-z0-9:_.-]{1,120}$/.test(value.messageId)
          ? { messageId: value.messageId }
          : {})
      }
    : undefined
}
export function conversationalSource(source: any): boolean {
  return source?.kind === 'user' || qqMessageOrigin(source) !== undefined
}
export const QQ_CONVERSATION_TOOLS: readonly string[] = [
  'qq_context',
  'qq_expression',
  'qq_document',
  'qq_memory',
  'persona_history'
]
