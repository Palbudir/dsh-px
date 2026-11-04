import { ChannelAttentionObserver } from '../../shared/channel-attention-observer'
import { analyzeChannelNotices } from '../../shared/channel-attention-analysis'
import { decideChannelAttention } from '../../shared/channel-attention'
import type { ChannelInbox } from '../../shared/channel-inbox'
import { ChannelError, channelRoute, type ChannelAccount } from './channel-settings'

type Notice = ReturnType<ChannelInbox['notices']>[number]
type Lease = {
  chatId: string
  personaId: string
  routeRevision: number
  until: number
  quiet: boolean
  reason: string
}
/** Attention chooses bounded reception; native original-message admission still owns task authority. */
export class FeishuAttention {
  readonly observer: ChannelAttentionObserver<Notice>
  private readonly leases = new Map<string, Lease>()
  private settingsSignature: string
  private analysisPersona?: string
  private closed = false
  constructor(
    private readonly host: any,
    private readonly current: () => ChannelAccount | undefined,
    private readonly inbox: ChannelInbox,
    private readonly active: () => boolean,
    private readonly allowed: (row: Notice) => boolean,
    private readonly dispatch: () => void
  ) {
    this.settingsSignature = JSON.stringify(current()?.attention)
    this.observer = new ChannelAttentionObserver({
      busy: () => !this.active(),
      candidates: () => this.candidates(),
      attempted: (rows) => this.inbox.noticeAttempt(rows),
      work: (rows, signal, started) => {
        this.analysisPersona = rows[0].recipient.personaId
        const c = this.current()!
        return analyzeChannelNotices(
          this.host,
          {
            provider: 'feishu',
            label: '飞书',
            personaId: rows[0].recipient.personaId,
            workspace: c.workspace,
            attention: c.attention
          },
          rows,
          signal,
          started
        )
      },
      apply: (decision, rows) => {
        if (!this.active() || this.current()?.attention.allowAgentChanges !== true) return
        for (const chat of decision.open) {
          const row = rows.find((r) => r.chatId === chat)
          if (row && this.allowed(row)) this.adjust(row, false, decision.minutes, decision.reason)
        }
        for (const chat of decision.quiet ?? []) {
          const row = rows.find((r) => r.chatId === chat)
          if (row && row.kind === 'group' && this.allowed(row))
            this.adjust(row, true, decision.minutes, decision.reason)
        }
        this.dispatch()
      }
    })
  }
  private liveLeases(): Lease[] {
    const c = this.current()
    for (const [chat, lease] of this.leases) {
      const route = c && channelRoute(c, chat)
      if (
        !route ||
        lease.until <= Date.now() ||
        route.personaId !== lease.personaId ||
        route.routeRevision !== lease.routeRevision
      )
        this.leases.delete(chat)
    }
    return [...this.leases.values()]
  }
  effective() {
    const c = this.current()
    if (!c) throw new ChannelError('渠道配置不可用', 409)
    const leases = this.liveLeases()
    return {
      ...c.attention,
      openedChats: [
        ...(c.attention.openedChats ?? []),
        ...leases.filter((l) => !l.quiet).map((l) => l.chatId)
      ],
      mutedChats: [
        ...new Set([...c.attention.mutedChats, ...leases.filter((l) => l.quiet).map((l) => l.chatId)])
      ]
    }
  }
  private candidates(): Notice[] {
    const c = this.current()
    if (
      this.closed ||
      !this.active() ||
      c?.attention.allowAgentChanges !== true ||
      c.attention.mode === 'focus'
    )
      return []
    return this.eligible(false)
  }
  private eligible(includeAttempted: boolean, personaId?: string): Notice[] {
    const attention = this.effective()
    let cursor = 0
    for (;;) {
      const batch = this.inbox.notices(500, includeAttempted, { afterSeq: cursor, personaId })
      const rows = batch.filter((row) => {
        if (!this.allowed(row)) return false
        const choice = decideChannelAttention(attention, {
          conversationId: row.chatId,
          kind: row.kind,
          mentioned: row.mentioned,
          self: false
        })
        return (
          choice.content === 'preview' &&
          (attention.mode === 'normal' ? choice.reason !== 'muted' : choice.notify)
        )
      })
      const persona = personaId ?? rows[0]?.recipient.personaId
      if (rows.length) return rows.filter((row) => row.recipient.personaId === persona).slice(0, 8)
      if (batch.length < 500) return []
      cursor = batch.at(-1)!.firstSeq
    }
  }
  private adjust(row: Notice, quiet: boolean, minutes: number, reason: string) {
    if (
      !Number.isSafeInteger(minutes) ||
      minutes < 1 ||
      minutes > 15 ||
      typeof reason !== 'string' ||
      !reason.trim() ||
      reason.length > 200
    )
      throw new ChannelError('临时关注时长或原因无效')
    if (this.leases.size >= 200 && !this.leases.has(row.chatId))
      throw new ChannelError('临时关注已达到上限', 409)
    this.leases.set(row.chatId, {
      chatId: row.chatId,
      ...row.recipient,
      until: Date.now() + minutes * 60000,
      quiet,
      reason
    })
  }
  refresh() {
    if (this.closed) return
    const signature = JSON.stringify(this.current()?.attention)
    if (signature !== this.settingsSignature) {
      this.settingsSignature = signature
      this.leases.clear()
      this.observer.cancel('changed')
      this.inbox.retryNotices()
    }
    this.observer.schedule()
  }
  schedule() {
    this.observer.schedule()
  }
  status(personaId?: string) {
    const notices =
      !this.closed && this.active()
        ? this.inbox
            .notices(100, true, { personaId })
            .filter((row) => this.allowed(row) && (!personaId || row.recipient.personaId === personaId))
        : []
    const temporary = this.liveLeases().filter((row) => !personaId || row.personaId === personaId)
    const observer: ReturnType<ChannelAttentionObserver<Notice>['snapshot']> =
      !personaId || personaId === this.analysisPersona ? this.observer.snapshot() : { phase: 'idle' }
    return {
      enabled: this.current()?.attention.allowAgentChanges === true,
      mode: this.current()?.attention.mode,
      observer,
      temporary,
      notices
    }
  }
  previews(personaId: string) {
    if (this.closed || !this.active()) return []
    return this.eligible(true, personaId)
  }
  action(personaId: string, args: any) {
    if (this.closed || !this.active()) throw new ChannelError('渠道接收未运行', 409)
    if (args.action === 'status') return this.status(personaId)
    if (this.current()?.attention.allowAgentChanges !== true)
      throw new ChannelError('尚未允许人格调整通知关注，请在账号设置中开启', 403)
    if (args.action === 'restore') {
      if (this.analysisPersona === personaId) this.observer.cancel('changed')
      for (const [id, lease] of this.leases) if (lease.personaId === personaId) this.leases.delete(id)
      this.dispatch()
      this.observer.schedule()
      return this.status(personaId)
    }
    if (!['open', 'quiet'].includes(args.action)) throw new ChannelError('注意力操作无效')
    const row = this.inbox
      .notices(500, true, { personaId, chatId: args.chatId })
      .find((row) => row.chatId === args.chatId && row.recipient.personaId === personaId && this.allowed(row))
    if (!row) throw new ChannelError('此聊天没有属于本人格的当前待处理消息', 403)
    if (args.action === 'quiet' && row.kind !== 'group') throw new ChannelError('只能临时关闭普通群提醒')
    if (this.analysisPersona === personaId) this.observer.cancel('changed')
    this.adjust(row, args.action === 'quiet', args.minutes ?? 10, args.reason)
    this.dispatch()
    this.observer.schedule()
    return this.status(personaId)
  }
  retry() {
    this.inbox.retryNotices()
    this.observer.schedule()
  }
  stop() {
    this.observer.cancel('user')
  }
  dispose() {
    this.closed = true
    this.leases.clear()
    return this.observer.dispose()
  }
}
