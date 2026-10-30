import type { QqNotice } from './attention-inbox'

export interface AttentionDecision {
  open: string[]
  minutes: number
  reason: string
}
/** Coalesces notifications; it never executes a task or writes an outgoing chat message. */
export class QqAttentionObserver {
  private timer?: ReturnType<typeof setTimeout>
  private controller?: AbortController
  private running?: Promise<void>
  private disposed = false
  private lastStarted = 0
  private state: {
    phase: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'stopped'
    jobId?: string
    reason?: string
    error?: string
  } = { phase: 'idle' }
  constructor(
    private readonly ports: {
      candidates(): QqNotice[]
      busy(): boolean
      attempted(rows: QqNotice[]): void
      work(
        rows: QqNotice[],
        signal: AbortSignal,
        started: (jobId: string) => void
      ): Promise<AttentionDecision>
      apply(value: AttentionDecision, rows: QqNotice[]): void
    },
    private readonly intervalMs = 15000
  ) {}
  snapshot() {
    return { ...this.state }
  }
  schedule(): void {
    if (this.disposed || this.timer || this.running) return
    try {
      if (!this.ports.candidates().length) {
        if (this.state.phase === 'queued') this.state = { phase: 'idle' }
        return
      }
    } catch (error) {
      this.state = { phase: 'failed', error: String(error) }
      return
    }
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
      this.state = { phase: 'idle' }
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
        if (
          !value ||
          !Array.isArray(value.open) ||
          value.open.length > 2 ||
          new Set(value.open).size !== value.open.length ||
          value.open.some((id) => !known.has(id)) ||
          !Number.isSafeInteger(value.minutes) ||
          value.minutes < 1 ||
          value.minutes > 15 ||
          typeof value.reason !== 'string' ||
          value.reason.length > 200
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
