export interface ChannelNotice {
  chatId: string
  kind?: 'group' | 'direct'
  label?: string
  through: number
  count: number
  preview: string
  mentioned: boolean
  receivedAt: number
}

export interface AttentionDecision {
  open: string[]
  quiet?: string[]
  minutes: number
  reason: string
}
/** Coalesces notifications; it never executes a task or writes an outgoing chat message. */
export class ChannelAttentionObserver<N extends ChannelNotice = ChannelNotice> {
  private timer?: ReturnType<typeof setTimeout>
  private controller?: AbortController
  private running?: Promise<void>
  private disposed = false
  private lastStarted = 0
  private lastChecked = 0
  private state: {
    phase: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'stopped'
    jobId?: string
    reason?: string
    error?: string
  } = { phase: 'idle' }
  constructor(
    private readonly ports: {
      candidates(): N[]
      busy(): boolean
      attempted(rows: N[]): void
      work(rows: N[], signal: AbortSignal, started: (jobId: string) => void): Promise<AttentionDecision>
      apply(value: AttentionDecision, rows: N[]): void
    },
    private readonly intervalMs = 15000
  ) {}
  snapshot() {
    return { ...this.state }
  }
  schedule(): void {
    if (this.disposed || this.timer || this.running) return
    let identified = false
    try {
      // A burst of muted/non-notifying events must not rescan the whole inbox for every message.
      if (Date.now() - this.lastChecked >= 350) {
        this.lastChecked = Date.now()
        if (!this.ports.candidates().length) {
          if (this.state.phase === 'queued') this.state = { phase: 'idle' }
          return
        }
        identified = true
      }
    } catch (error) {
      this.state = { phase: 'failed', error: String(error) }
      return
    }
    if (identified || this.state.phase === 'idle' || this.state.phase === 'queued')
      this.state = { phase: 'queued' }
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        try {
          this.start()
        } catch (error) {
          this.state = { phase: 'failed', error: String(error) }
        }
      },
      Math.max(350, this.lastStarted + this.intervalMs - Date.now())
    )
    this.timer.unref?.()
  }
  private start(): void {
    if (this.disposed || this.running || this.ports.busy()) return
    const rows = this.ports.candidates().slice(0, 8)
    if (!rows.length) {
      if (this.state.phase === 'queued') this.state = { phase: 'idle' }
      return
    }
    this.ports.attempted(rows)
    this.lastStarted = Date.now()
    const controller = new AbortController()
    this.controller = controller
    this.state = { phase: 'running' }
    this.running = Promise.resolve()
      .then(() =>
        this.ports.work(rows, controller.signal, (jobId) => {
          if (!controller.signal.aborted) this.state = { phase: 'running', jobId }
        })
      )
      .then((value) => {
        controller.signal.throwIfAborted()
        if (this.disposed) return
        const known = new Set(rows.map((row) => row.chatId))
        const quiet = value?.quiet ?? []
        if (
          !value ||
          !Array.isArray(value.open) ||
          value.open.length > 2 ||
          new Set(value.open).size !== value.open.length ||
          value.open.some((id) => !known.has(id)) ||
          !Array.isArray(quiet) ||
          quiet.length + value.open.length > 2 ||
          new Set(quiet).size !== quiet.length ||
          quiet.some(
            (id) =>
              typeof id !== 'string' ||
              !rows.some(
                (row) => row.chatId === id && (row.kind === 'group' || (!row.kind && id.startsWith('group:')))
              ) ||
              !known.has(id) ||
              value.open.includes(id)
          ) ||
          !Number.isSafeInteger(value.minutes) ||
          value.minutes < 1 ||
          value.minutes > 15 ||
          typeof value.reason !== 'string' ||
          value.reason.length > 200 ||
          ((value.open.length || quiet.length) && !value.reason.trim())
        )
          throw new Error('通知判断未返回有效的当前聊天选择')
        this.ports.apply(value, rows)
        this.state = { ...this.state, phase: 'completed', reason: value.reason }
      })
      .catch((error) => {
        this.state = {
          ...this.state,
          phase: controller.signal.aborted
            ? controller.signal.reason?.code === 'ATTENTION_CHANGED'
              ? 'idle'
              : 'stopped'
            : 'failed',
          error: controller.signal.aborted
            ? undefined
            : error instanceof Error
              ? error.message
              : String(error)
        }
      })
      .finally(() => {
        this.running = undefined
        this.controller = undefined
        this.schedule()
      })
  }
  cancel(reason: 'user' | 'changed' = 'user'): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.lastChecked = 0
    if (reason === 'user') {
      try {
        this.ports.attempted(this.ports.candidates())
      } catch (error) {
        this.state = { phase: 'failed', error: String(error) }
      }
    }
    if (!this.controller) this.state = { phase: reason === 'changed' ? 'idle' : 'stopped' }
    this.controller?.abort(
      Object.assign(new Error('通知判断已停止'), {
        code: reason === 'changed' ? 'ATTENTION_CHANGED' : 'ATTENTION_STOPPED'
      })
    )
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.cancel('changed')
    await this.running
  }
}
