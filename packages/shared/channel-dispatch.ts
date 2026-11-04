import { randomUUID } from 'node:crypto'
import { admitChannelMessage, type NativeChannelAdmission } from './channel-admission'
import type { ChannelInbox, PendingChannelMessage } from './channel-inbox'

export interface ChannelDispatchPorts {
  /** Account coordinator owns attention decisions, including earlier context for a later mention. */
  selection(row: PendingChannelMessage): 'wake' | 'context' | 'hold'
  prepare(row: PendingChannelMessage, signal: AbortSignal): Promise<NativeChannelAdmission>
  failed(row: PendingChannelMessage | undefined, error: unknown): void
}

/** Concurrent transport admission only. Native Agents retain input queues, scheduling and task outcomes. */
export class ChannelDispatch {
  private readonly controller = new AbortController()
  private readonly running = new Map<string, Promise<void>>()
  private readonly blocked = new Set<string>()
  private timer?: ReturnType<typeof setTimeout>
  private cursor = 0
  private rescan = false
  private storageBlocked = false
  constructor(
    private readonly inbox: ChannelInbox,
    private readonly epoch: string,
    private readonly ports: ChannelDispatchPorts,
    private readonly concurrency = 4,
    private readonly debounceMs = 50
  ) {
    if (!epoch.trim() || epoch.length > 512 || /[\r\n\0]/.test(epoch)) throw Error('渠道投递生命周期无效')
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 16 ||
      !Number.isSafeInteger(debounceMs) ||
      debounceMs < 0 ||
      debounceMs > 10000
    )
      throw Error('渠道投递并发或批次间隔无效')
  }
  schedule(): void {
    this.rescan = true
    this.queue()
  }
  private queue(): void {
    if (this.controller.signal.aborted || this.timer || this.storageBlocked) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      try {
        this.pump()
      } catch (error) {
        this.storageBlocked = true
        try {
          this.ports.failed(undefined, error)
        } catch {}
      }
    }, this.debounceMs)
    this.timer.unref?.()
  }
  /** Explicit settings/recovery retry. Ambiguous native admissions remain excluded by the durable inbox. */
  retry(id?: string): void {
    if (id) this.blocked.delete(id)
    this.storageBlocked = false
    this.cursor = 0
    this.schedule()
  }
  blockedIds(): string[] {
    return [...this.blocked]
  }
  unavailable(): boolean {
    return this.storageBlocked
  }
  private report(row: PendingChannelMessage, error: unknown): void {
    this.blocked.add(row.id)
    try {
      this.ports.failed(row, error)
    } catch {
      /* An observer cannot turn failure into an automatic retry. */
    }
  }
  private pump(): void {
    if (this.controller.signal.aborted) return
    if (this.cursor === 0) this.rescan = false
    let pages = 0
    while (this.running.size < this.concurrency) {
      if (pages++ >= 8) {
        this.queue()
        return
      }
      const batch = this.inbox.heads(32, this.cursor)
      if (!batch.length) {
        this.cursor = 0
        if (this.rescan) this.queue()
        return
      }
      for (const row of batch) {
        if (this.running.size >= this.concurrency || this.controller.signal.aborted) return
        this.cursor = row.seq
        const lane = JSON.stringify([row.event.conversationId, row.recipient.executionSessionId ?? null])
        if (this.running.has(lane) || this.blocked.has(row.id)) continue
        let selection: ReturnType<ChannelDispatchPorts['selection']>
        try {
          selection = this.ports.selection(row)
        } catch (error) {
          this.report(row, error)
          continue
        }
        if (selection === 'hold') continue
        const task = this.deliver(row)
          .catch((error) => this.report(row, error))
          .finally(() => {
            if (this.running.get(lane) === task) this.running.delete(lane)
            this.schedule()
          })
        this.running.set(lane, task)
      }
    }
  }
  private async deliver(row: PendingChannelMessage): Promise<void> {
    const signal = this.controller.signal,
      native = await this.ports.prepare(row, signal)
    signal.throwIfAborted()
    const selection = this.ports.selection(row)
    if (selection === 'hold') return
    const claim = {
      ...row.recipient,
      epoch: this.epoch,
      sessionId: native.agent.session.id,
      requestId: randomUUID()
    }
    await admitChannelMessage(this.inbox, row, claim, native, signal, selection === 'wake')
  }
  /** Stops new admission and waits for its in-flight durability checks; it does not cancel already accepted native tasks. */
  async dispose(): Promise<void> {
    clearTimeout(this.timer)
    this.controller.abort(Error('渠道投递已停止'))
    await Promise.allSettled([...this.running.values()])
  }
}
