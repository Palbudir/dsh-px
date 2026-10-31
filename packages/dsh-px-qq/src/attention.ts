/** Attention controls delivery and wakeups, never actor authorization or memory visibility. */
export type QqAttentionMode = 'focus' | 'normal' | 'notifications'
export interface QqAttentionSettings {
  mode: QqAttentionMode
  allowAgentChanges: boolean
  focusedChats: string[]
  mutedChats: string[]
  notifyDirect: boolean
  notifyMentions: boolean
  notifyGroups: boolean
  mentionOverridesMute: boolean
}
export type QqAttentionRouting = QqAttentionSettings & { openedChats?: readonly string[] }
export const DEFAULT_ATTENTION: QqAttentionSettings = {
  mode: 'normal',
  allowAgentChanges: true,
  focusedChats: [],
  mutedChats: [],
  notifyDirect: true,
  notifyMentions: true,
  notifyGroups: false,
  mentionOverridesMute: true
}
export function parseAttention(value: unknown): QqAttentionSettings {
  if (value === undefined) value = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('QQ 消息模式设置无效')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !Object.hasOwn(DEFAULT_ATTENTION, key)))
    throw new Error('QQ 消息模式包含未知设置')
  const settings = { ...DEFAULT_ATTENTION, ...input } as QqAttentionSettings
  if (!['focus', 'normal', 'notifications'].includes(settings.mode)) throw new Error('QQ 消息模式无效')
  for (const key of [
    'allowAgentChanges',
    'notifyDirect',
    'notifyMentions',
    'notifyGroups',
    'mentionOverridesMute'
  ] as const)
    if (typeof settings[key] !== 'boolean') throw new Error('QQ 消息开关必须为布尔值')
  for (const key of ['focusedChats', 'mutedChats'] as const) {
    const values = settings[key]
    if (!Array.isArray(values) || values.length > 200 || values.some((id) => !validAttentionChat(id)))
      throw new Error('QQ 关注或免打扰列表无效')
    settings[key] = [...new Set(values)]
  }
  return settings
}
export function validAttentionChat(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(private|group):([1-9]\d{4,19})$/.exec(value)
  return !!match && Number.isSafeInteger(Number(match[2]))
}
export interface AttentionMessage {
  chatId: string
  mentioned: boolean
  self: boolean
}
export interface AttentionDelivery {
  content: 'full' | 'preview' | 'ignore'
  notify: boolean
  reason: 'self' | 'focus' | 'watched' | 'direct' | 'mention' | 'muted' | 'notification' | 'unfocused'
}
export function attentionDelivery(
  settings: QqAttentionRouting,
  message: AttentionMessage
): AttentionDelivery {
  if (!validAttentionChat(message.chatId)) throw new Error('QQ 消息所属聊天无效')
  if (message.self) return { content: 'ignore', notify: false, reason: 'self' }
  const direct = message.chatId.startsWith('private:')
  const muted =
    settings.mutedChats.includes(message.chatId) && !(message.mentioned && settings.mentionOverridesMute)
  const notify =
    !muted &&
    (direct ? settings.notifyDirect : message.mentioned ? settings.notifyMentions : settings.notifyGroups)
  // Explicitly looking at a chat is different from being interrupted by its notification.
  if (settings.mode === 'focus') return { content: 'full', notify: false, reason: 'focus' }
  if (settings.openedChats?.includes(message.chatId))
    return { content: 'full', notify: false, reason: 'watched' }
  if (settings.mode === 'notifications')
    return { content: 'preview', notify, reason: muted ? 'muted' : 'notification' }
  if (settings.focusedChats.includes(message.chatId))
    return { content: 'full', notify: false, reason: 'watched' }
  if (muted) return { content: 'preview', notify: false, reason: 'muted' }
  if (direct) return { content: 'full', notify: false, reason: 'direct' }
  if (message.mentioned) return { content: 'full', notify: false, reason: 'mention' }
  return { content: 'preview', notify, reason: 'unfocused' }
}

/** Temporary attention is local to one account, bounded, and superseded by every explicit user setting. */
export class QqAttentionControl {
  private temporary?: {
    mode?: QqAttentionMode
    chats: string[]
    muted: string[]
    unmuted: string[]
    until: number
    reason: string
  }
  constructor(
    private settings: QqAttentionSettings,
    private readonly now: () => number = Date.now
  ) {
    this.settings = parseAttention(settings)
  }
  userSettings(value: QqAttentionSettings): void {
    this.settings = parseAttention(value)
    this.temporary = undefined
  }
  effective(): QqAttentionRouting {
    const settings = parseAttention(this.settings)
    if (this.temporary && this.temporary.until <= this.now()) this.temporary = undefined
    if (!this.temporary || !settings.allowAgentChanges) return settings
    return {
      ...settings,
      mode: this.temporary.mode ?? settings.mode,
      focusedChats: [...new Set([...settings.focusedChats, ...this.temporary.chats])],
      openedChats: [...this.temporary.chats],
      mutedChats: [
        ...new Set([
          ...settings.mutedChats.filter((id) => !this.temporary!.unmuted.includes(id)),
          ...this.temporary.muted
        ])
      ]
    }
  }
  snapshot() {
    const effective = this.effective()
    return {
      configured: parseAttention(this.settings),
      effective,
      temporary: this.temporary ? structuredClone(this.temporary) : null
    }
  }
  adjust(
    input: { mode?: QqAttentionMode; chatId?: string; minutes: number; reason: string },
    knownChats: readonly string[]
  ): void {
    this.effective()
    if (!this.settings.allowAgentChanges) throw new Error('用户已固定 QQ 消息模式')
    if (!input || Object.keys(input).some((key) => !['mode', 'chatId', 'minutes', 'reason'].includes(key)))
      throw new Error('QQ 注意力调整参数无效')
    if (input.mode !== undefined && !['focus', 'normal', 'notifications'].includes(input.mode))
      throw new Error('QQ 消息模式无效')
    if (
      input.chatId !== undefined &&
      (!validAttentionChat(input.chatId) || !knownChats.includes(input.chatId))
    )
      throw new Error('只能打开本账号已收到消息的聊天')
    if (!input.mode && !input.chatId) throw new Error('请选择需要打开的聊天或消息模式')
    this.validateLease(input.minutes, input.reason)
    this.temporary = {
      ...((input.mode ?? this.temporary?.mode) ? { mode: input.mode ?? this.temporary?.mode } : {}),
      chats: input.chatId ? [...new Set([...(this.temporary?.chats ?? []), input.chatId])].slice(-200) : [],
      muted: this.temporary?.muted ?? [],
      unmuted: this.temporary?.unmuted ?? [],
      until: this.now() + input.minutes * 60000,
      reason: input.reason.trim()
    }
  }
  private validateLease(minutes: number, reason: string): void {
    if (
      !Number.isSafeInteger(minutes) ||
      minutes < 1 ||
      minutes > 30 ||
      typeof reason !== 'string' ||
      !reason.trim() ||
      reason.length > 200
    )
      throw new Error('临时调整需要简短原因和一到三十分钟有效期')
  }
  groupNotifications(
    chatId: string,
    enabled: boolean,
    minutes: number,
    reason: string,
    knownChats: readonly string[]
  ): void {
    this.effective()
    if (!this.settings.allowAgentChanges) throw new Error('用户已固定 QQ 消息模式')
    if (!validAttentionChat(chatId) || !chatId.startsWith('group:') || !knownChats.includes(chatId))
      throw new Error('只能临时调整本账号已收到消息的群提醒')
    if (typeof enabled !== 'boolean') throw new Error('群提醒开关无效')
    this.validateLease(minutes, reason)
    const prior = this.temporary
    this.temporary = {
      ...(prior?.mode ? { mode: prior.mode } : {}),
      chats: prior?.chats ?? [],
      muted: enabled
        ? (prior?.muted ?? []).filter((id) => id !== chatId)
        : [...new Set([...(prior?.muted ?? []), chatId])].slice(-200),
      unmuted: enabled
        ? [...new Set([...(prior?.unmuted ?? []), chatId])].slice(-200)
        : (prior?.unmuted ?? []).filter((id) => id !== chatId),
      until: this.now() + minutes * 60000,
      reason: reason.trim()
    }
  }
  reset(): void {
    this.temporary = undefined
  }
}
