/** Trusted transport metadata. Never construct an audience by interpreting message prose. */
export interface SessionChannel {
  provider: string
  accountId: string
  conversationId: string
  /** Compatibility field: access describes the data audience, not the style or task authorization. */
  access: 'owner' | 'public'
  publicInstructions: string
  workspace?: string
  task?: { requesterId: string; rootSessionId: string }
}

export interface SubjectAudience {
  kind: 'personal' | 'conversation'
  channel?: Pick<SessionChannel, 'provider' | 'accountId' | 'conversationId'>
}

export class SubjectContextError extends Error {}

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= 200 && !/[\r\n\0]/.test(value)

/** Validate persisted channel boundaries before any caller can treat them as personal. */
export function validateSessionChannel(value: unknown): asserts value is SessionChannel {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SubjectContextError('会话渠道边界无效')
  const channel = value as SessionChannel
  if (
    !identifier(channel.provider) ||
    !/^[a-z][a-z0-9.-]{0,79}$/.test(channel.provider) ||
    !identifier(channel.accountId) ||
    !identifier(channel.conversationId) ||
    !['owner', 'public'].includes(channel.access) ||
    typeof channel.publicInstructions !== 'string' ||
    channel.publicInstructions.length > 2000 ||
    (channel.workspace !== undefined &&
      (typeof channel.workspace !== 'string' ||
        channel.workspace.length > 4000 ||
        channel.workspace.includes('\0')))
  )
    throw new SubjectContextError('会话渠道边界无效')
  if (
    channel.task !== undefined &&
    (!channel.task ||
      typeof channel.task !== 'object' ||
      Array.isArray(channel.task) ||
      channel.access !== 'public' ||
      !identifier(channel.task.requesterId) ||
      !identifier(channel.task.rootSessionId))
  )
    throw new SubjectContextError('任务受众无效')
  // Preserve the established QQ group-task boundary while allowing other adapters to use
  // their own opaque conversation IDs. Registering a provider does not enable its transport.
  if (channel.provider === 'qq' && channel.task && !/^group:\d+$/.test(channel.conversationId))
    throw new SubjectContextError('群任务受众无效')
}

export function audienceOf(binding?: { channel?: SessionChannel }): SubjectAudience {
  const channel = binding?.channel
  if (!channel) return { kind: 'personal' }
  validateSessionChannel(channel)
  return {
    kind: channel.access === 'public' ? 'conversation' : 'personal',
    channel: {
      provider: channel.provider,
      accountId: channel.accountId,
      conversationId: channel.conversationId
    }
  }
}

export function sameConversationAudience(
  a?: { channel?: SessionChannel },
  b?: { channel?: SessionChannel }
): boolean {
  const first = audienceOf(a),
    second = audienceOf(b)
  return (
    first.kind === 'conversation' &&
    second.kind === 'conversation' &&
    first.channel?.provider === second.channel?.provider &&
    first.channel?.accountId === second.channel?.accountId &&
    first.channel?.conversationId === second.channel?.conversationId
  )
}
