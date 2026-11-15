import { ComputerUseRefusal, type SessionStates } from './runtime'
import type { BrowserSessions } from './browser'
import type { ForegroundResource } from './foreground-resource'

/** Native Job owns waiting, cancellation and notification; this producer never retries an action. */
class NativeResourceWaits {
  private readonly waits = new Map<string, { id: string; stop: AbortController; done: Promise<any> }>()
  private closed = false
  constructor(
    private readonly resource: {
      waitAvailable(owner: string, signal: AbortSignal, timeoutMs: number): Promise<{ available: boolean }>
    },
    private readonly states: SessionStates,
    private readonly capability: 'browser' | 'desktop',
    private readonly resourceName: string,
    private readonly label: string
  ) {}
  start(agent: any, timeoutMs: number, signal: AbortSignal) {
    signal.throwIfAborted()
    if (this.closed) throw new ComputerUseRefusal('浏览器资源等待已停止')
    const owner = agent?.session?.id,
      ctx = agent?.ctx,
      jobs = ctx?.get ? ctx.get('jobs') : ctx?.jobs
    if (!owner || !jobs?.start) throw new ComputerUseRefusal('当前会话缺少原生作业服务')
    const previous = this.waits.get(owner)
    if (previous) return { jobId: previous.id, existing: true }
    if (this.waits.size >= 32) throw new ComputerUseRefusal('等待资源的会话较多，请先处理已有作业')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000)
      throw new ComputerUseRefusal('等待时限需为 1～60 秒')
    const stop = new AbortController()
    const sourceSeq = agent.session.seq
    const jobId = jobs.start({
      kind: 'px-resource-wait',
      label: `等待${this.label}可用`,
      owner,
      outputLimitBytes: 2000,
      run: (job: any) => {
        let waitingSignal: AbortSignal | undefined
        const done = Promise.resolve()
          .then(() =>
            this.states.track(owner, this.capability, stop.signal, (input) => {
              waitingSignal = input
              return this.resource.waitAvailable(owner, input, timeoutMs)
            })
          )
          .then((value) => ({
            status: 'completed',
            result: JSON.stringify({
              resource: this.resourceName,
              sourceSessionId: owner,
              sourceSeq,
              ...value,
              reserved: false,
              instruction: value.available
                ? `${this.label}当前可用。重新观察并通过正常工具权限检查后操作；此通知不是资源占用或任务完成回执。`
                : `等待期限已到，${this.label}仍被占用。可以继续其他工作，未执行或重放动作。`
            })
          }))
          .catch((error) => ({
            status:
              stop.signal.aborted || waitingSignal?.aborted || this.states.isPaused(owner)
                ? 'killed'
                : 'failed',
            detail: error instanceof Error ? error.message : '资源等待失败'
          }))
          .finally(() => {
            if (this.waits.get(owner)?.id === job.id) this.waits.delete(owner)
          })
        this.waits.set(owner, { id: job.id, stop, done })
        return { done, cancel: (reason?: string) => stop.abort(Error(reason ?? '资源等待已取消')) }
      }
    })
    return { jobId, existing: false }
  }
  async dispose() {
    this.closed = true
    for (const wait of this.waits.values()) wait.stop.abort(Error('电脑操作插件已停止'))
    await Promise.allSettled([...this.waits.values()].map((wait) => wait.done))
  }
}

export class BrowserResourceWaits extends NativeResourceWaits {
  constructor(browsers: BrowserSessions, states: SessionStates) {
    super(browsers, states, 'browser', 'browser', '浏览器')
  }
}
export class ForegroundResourceWaits extends NativeResourceWaits {
  constructor(resource: ForegroundResource, states: SessionStates) {
    super(resource, states, 'desktop', 'desktop-foreground', '前台键鼠')
  }
}
