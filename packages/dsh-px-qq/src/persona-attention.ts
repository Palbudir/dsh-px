import {
  QqAttentionControl,
  parseAttention,
  type QqAttentionSettings,
  type QqAttentionMode,
  type QqAttentionRouting
} from './attention'

/** Shares account defaults while keeping each persona's temporary chat changes independent. */
export class QqPersonaAttention {
  private settings: QqAttentionSettings
  private readonly owners = new Map<string, QqAttentionControl>()
  constructor(
    settings: QqAttentionSettings,
    private readonly accountOwner: string,
    private readonly now: () => number = Date.now
  ) {
    this.settings = parseAttention(settings)
  }
  private owner(id = this.accountOwner): QqAttentionControl {
    if (typeof id !== 'string' || !id || id.length > 200) throw Error('QQ 注意力人格无效')
    let owner = this.owners.get(id)
    if (!owner) {
      if (this.owners.size >= 30) throw Error('QQ 注意力人格已达到容量限制')
      owner = new QqAttentionControl(this.settings, this.now)
      this.owners.set(id, owner)
    }
    return owner
  }
  userSettings(settings: QqAttentionSettings): void {
    this.settings = parseAttention(settings)
    this.owners.clear()
  }
  effective(): QqAttentionRouting {
    const configured = parseAttention(this.settings)
    const leases = [...this.owners.values()]
      .map((control) => control.snapshot().temporary)
      .filter((lease): lease is NonNullable<typeof lease> => !!lease)
    if (!leases.length || !configured.allowAgentChanges) return configured
    const opened = [...new Set(leases.flatMap((lease) => lease.chats))],
      muted = new Set(configured.mutedChats)
    for (const lease of leases) {
      for (const id of lease.unmuted) muted.delete(id)
      for (const id of lease.muted) muted.add(id)
    }
    return {
      ...configured,
      mode: this.owners.get(this.accountOwner)?.effective().mode ?? configured.mode,
      focusedChats: [...new Set([...configured.focusedChats, ...opened])],
      openedChats: opened,
      mutedChats: [...muted]
    }
  }
  snapshot(ownerId?: string) {
    const leases = [...this.owners.values()]
      .map((control) => control.snapshot().temporary)
      .filter((lease): lease is NonNullable<typeof lease> => !!lease)
    const temporary =
      ownerId !== undefined
        ? (this.owners.get(ownerId)?.snapshot().temporary ?? null)
        : leases.length === 1
          ? leases[0]
          : leases.length
            ? {
                chats: [...new Set(leases.flatMap((lease) => lease.chats))],
                muted: [...new Set(leases.flatMap((lease) => lease.muted))],
                unmuted: [...new Set(leases.flatMap((lease) => lease.unmuted))],
                until: Math.min(...leases.map((lease) => lease.until)),
                reason: '多个人格的临时关注分别生效'
              }
            : null
    return { configured: parseAttention(this.settings), effective: this.effective(), temporary }
  }
  adjust(
    input: { mode?: QqAttentionMode; chatId?: string; minutes: number; reason: string },
    known: readonly string[],
    ownerId = this.accountOwner
  ): void {
    if (input.mode && ownerId !== this.accountOwner)
      throw Error('账号整体消息模式由默认人格管理；你可以调整自己负责的聊天')
    this.owner(ownerId).adjust(input, known)
  }
  groupNotifications(
    chatId: string,
    enabled: boolean,
    minutes: number,
    reason: string,
    known: readonly string[],
    ownerId = this.accountOwner
  ): void {
    this.owner(ownerId).groupNotifications(chatId, enabled, minutes, reason, known)
  }
  reset(ownerId?: string): void {
    if (ownerId === undefined) this.owners.clear()
    else this.owners.delete(ownerId)
  }
  releaseChat(chatId: string): void {
    for (const owner of this.owners.values()) owner.releaseChat(chatId)
  }
}
