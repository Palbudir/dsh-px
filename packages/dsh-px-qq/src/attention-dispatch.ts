import { attentionDelivery, type QqAttentionRouting } from './attention'
import type { InboxMessage, QqAttentionInbox } from './attention-inbox'

/** A bounded delivery pump; model execution and pending context remain owned by the native Agent. */
export class QqAttentionDispatch {
  private timer?: ReturnType<typeof setTimeout>
  private stopped = false
  private readonly running = new Set<string>()
  private readonly pending = new Set<Promise<void>>()
  constructor(
    private readonly inbox: QqAttentionInbox,
    private readonly settings: () => QqAttentionRouting,
    private readonly ports: {
      busy(chatId: string): boolean
      deliver(message: InboxMessage, ambient: boolean): Promise<void>
      wake(chatId: string): void
      failed(error: unknown): void
    },
    private readonly debounceMs = 350
  ) {}
  schedule(): void {
    if (this.stopped || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      try {
        this.pump()
      } catch (error) {
        this.ports.failed(error)
      }
    }, this.debounceMs)
    this.timer.unref?.()
  }
  private pump(): void {
    if (this.stopped) return
    // Older pending conversations receive a slot before the newest active conversation does.
    const candidates = this.inbox.pendingChats()
    for (const chatId of candidates) {
      if (this.running.size >= 4) break
      if (this.running.has(chatId) || this.ports.busy(chatId)) continue
      const config = this.settings()
      if (config.mode === 'notifications' && !config.openedChats?.includes(chatId)) continue
      const mentionsOnly =
        config.mode === 'normal' && chatId.startsWith('group:') && !config.focusedChats.includes(chatId)
      const messages = this.inbox.pending(chatId, 20, mentionsOnly)
      const selected: InboxMessage[] = []
      let bytes = 0
      for (const message of messages) {
        if (attentionDelivery(this.settings(), message).content !== 'full') continue
        const size = JSON.stringify(message.event).length
        if (selected.length && bytes + size > 32000) break
        selected.push(message)
        bytes += size
        // A directly addressed request keeps its native turn; preceding observations are context.
        if (message.chatId.startsWith('private:') || message.mentioned) break
      }
      if (!selected.length) continue
      this.running.add(chatId)
      const task = this.deliver(chatId, selected)
        .catch((error) => this.ports.failed(error))
        .finally(() => {
          this.running.delete(chatId)
          this.pending.delete(task)
          this.schedule()
        })
      this.pending.add(task)
    }
  }
  private async deliver(chatId: string, batch: InboxMessage[]): Promise<void> {
    let ambient = false
    for (const message of batch) {
      if (this.stopped || attentionDelivery(this.settings(), message).content !== 'full') return
      if (!this.inbox.canDispatch(message.id)) continue
      const observing = !message.mentioned && message.chatId.startsWith('group:')
      await this.ports.deliver(message, observing)
      ambient ||= observing
    }
    if (ambient && !this.stopped) this.ports.wake(chatId)
  }
  dispose(): Promise<void> {
    this.stopped = true
    clearTimeout(this.timer)
    return Promise.allSettled([...this.pending]).then(() => {})
  }
}
