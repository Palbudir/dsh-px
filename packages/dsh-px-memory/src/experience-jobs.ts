import { MemoryError, type MemoryStore } from './store'
import { createExperienceParent } from './experience-context'
import type { ExperienceBank, ExperienceCaller } from './experience'
import { service } from './history'

type Phase = 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'killed'
interface Record {
  source: ExperienceCaller
  requestId: string
  fingerprint: string
  phase: Phase
  controller: AbortController
  startedAt: number
  progress: string
  jobId?: string
  ownerId?: string
  jobs?: any
  admission?: Promise<{ requestId: string; jobId: string }>
  settled?: Promise<void>
  result?: unknown
  error?: string
}
const terminal = (phase: string) => ['completed', 'failed', 'killed'].includes(phase)

/** UI producer over native Jobs and task Agents; native lifecycle remains the execution authority. */
export class ExperienceJobs {
  private records = new Map<string, Record>()
  private disposed = false
  constructor(
    private host: any,
    private identities: MemoryStore,
    private bank: ExperienceBank
  ) {}
  private key(caller: ExperienceCaller, requestId: string) {
    if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId))
      throw new MemoryError('经验任务请求标识无效')
    return caller.sessionId + ':' + requestId
  }
  private assertOwner(record: Record, caller: ExperienceCaller) {
    const current = this.bank.identity(caller),
      original = this.bank.identity(record.source)
    if (current.personaId !== original.personaId || current.project !== original.project)
      throw new MemoryError('此任务不属于当前人格与项目', 403)
  }
  reuse(caller: ExperienceCaller, requestId: string, fingerprint: string) {
    const previous = this.records.get(this.key(caller, requestId))
    if (!previous) return undefined
    this.assertOwner(previous, caller)
    if (previous.fingerprint !== fingerprint) throw new MemoryError('此请求标识已用于其他经验操作', 409)
    return previous.admission
  }
  async start(
    caller: ExperienceCaller,
    requestId: string,
    fingerprint: string,
    model: { provider: string; model: string; reasoningEffort?: string },
    label: string,
    work: (
      parent: any,
      source: ExperienceCaller,
      signal: AbortSignal,
      progress: (text: string) => void
    ) => Promise<unknown>
  ): Promise<{ requestId: string; jobId: string }> {
    if (this.disposed) throw new MemoryError('经验服务已停止', 503)
    const identity = this.bank.identity(caller),
      key = this.key(caller, requestId),
      previous = this.reuse(caller, requestId, fingerprint)
    if (!identity.enabled) throw new MemoryError('此人格的记忆已关闭或已归档', 409)
    if (previous) return previous
    if ([...this.records.values()].filter((r) => !terminal(r.phase)).length >= 2)
      throw new MemoryError('已有两个经验任务正在处理，请稍后再试', 429)
    while (this.records.size >= 64) {
      const oldest = [...this.records].find(([, r]) => terminal(r.phase))
      if (!oldest) throw new MemoryError('经验任务较多，请稍后再试', 429)
      this.records.delete(oldest[0])
    }
    const record: Record = {
      source: Object.freeze({ ...caller, personaId: identity.personaId }),
      requestId,
      fingerprint,
      phase: 'starting',
      controller: new AbortController(),
      startedAt: Date.now(),
      progress: label
    }
    this.records.set(key, record)
    record.admission = (async () => {
      let parent: any
      try {
        parent = await createExperienceParent(
          this.host,
          this.identities,
          record.source,
          model,
          record.controller.signal
        )
        const jobs = service(parent.agent.ctx, 'jobs')
        if (!jobs?.start || !jobs.wait || !jobs.attachController)
          throw new MemoryError('原生后台作业服务不可用', 503)
        jobs.attachController('px-experience-ui')
        record.jobs = jobs
        record.ownerId = parent.agent.id
        record.phase = 'running'
        record.jobId = jobs.start({
          kind: 'px-experience',
          label,
          owner: parent.agent.id,
          outputLimitBytes: 2000,
          run: (job: any) => {
            const done = Promise.resolve()
              .then(async () => {
                this.bank.identity(record.source)
                const value = await work(
                  parent.agent,
                  { ...record.source, signal: record.controller.signal },
                  record.controller.signal,
                  (text) => {
                    record.progress = text.slice(0, 160)
                    job.updateProgress(record.progress)
                  }
                )
                // Each work path checks cancellation before its durable writes. Once all work
                // has committed successfully, a late stop must not relabel saved results as killed.
                this.bank.identity(record.source)
                record.result = value
                return {
                  status: 'completed',
                  result: '经验处理完成，结果可在“记忆与知识 → 知识与 Skills”查看。'
                }
              })
              .catch((error) => {
                record.error = error instanceof Error ? error.message.slice(0, 500) : '经验任务失败'
                return {
                  status: record.controller.signal.aborted ? 'killed' : 'failed',
                  detail: record.error
                }
              })
            return {
              done,
              cancel: (reason?: string) => record.controller.abort(new Error(reason ?? '经验任务已取消'))
            }
          }
        })
        const timer = setTimeout(() => this.cancelOwned(record, '经验任务达到时限'), 600_000)
        // This UI consumer immediately awaits settlement. Native tool-jobs therefore treats it as
        // delivered, instead of waking the hidden task root for an unwanted conversation turn.
        record.settled = (async () => {
          try {
            let state
            do {
              state = await jobs.wait(record.jobId, 660_000, record.ownerId)
            } while (!terminal(state.status))
            record.phase = state.status
            if (record.phase === 'completed') record.progress = label
            jobs.read(record.jobId, record.ownerId)
            if (record.phase !== 'completed') record.result = undefined
          } catch (error) {
            record.controller.abort(error)
            record.phase = 'failed'
            record.error = error instanceof Error ? error.message.slice(0, 500) : '无法确认经验任务状态'
          } finally {
            clearTimeout(timer)
            await parent.dispose()
          }
        })()
        // Keep a rejected cleanup observable without creating an unhandled rejection.
        void record.settled.catch((error) => {
          if (!terminal(record.phase)) {
            record.phase = 'failed'
            record.result = undefined
          }
          record.error = [record.error, '后台清理未完成：' + String(error)]
            .filter(Boolean)
            .join('；')
            .slice(0, 500)
        })
        return { requestId, jobId: record.jobId! }
      } catch (error) {
        record.phase = record.controller.signal.aborted ? 'killed' : 'failed'
        record.error = error instanceof Error ? error.message.slice(0, 500) : '经验任务未启动'
        await parent?.dispose()
        throw error
      }
    })()
    return record.admission
  }
  status(caller: ExperienceCaller, requestId: string) {
    const record = this.records.get(this.key(caller, requestId))
    if (!record) throw new MemoryError('此经验任务不在当前服务中，可能已重启；请核对已有候选后再重试', 404)
    this.assertOwner(record, caller)
    return {
      requestId,
      jobId: record.jobId,
      phase: record.phase,
      progress: record.progress,
      startedAt: record.startedAt,
      result: record.result,
      error: record.error
    }
  }
  list(caller: ExperienceCaller) {
    return [...this.records.values()]
      .filter((record) => record.source.sessionId === caller.sessionId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 8)
      .map((record) => {
        const { result, ...summary } = this.status(caller, record.requestId)
        return summary
      })
  }
  async cancel(caller: ExperienceCaller, requestId: string, reason = '用户停止经验任务'): Promise<void> {
    const record = this.records.get(this.key(caller, requestId))
    if (!record) throw new MemoryError('经验任务不存在', 404)
    this.assertOwner(record, caller)
    this.cancelOwned(record, reason)
  }
  private cancelOwned(record: Record, reason: string): void {
    if (terminal(record.phase)) return
    record.phase = 'stopping'
    try {
      if (record.jobId) record.jobs.kill(record.jobId, record.ownerId, reason)
      else record.controller.abort(new Error(reason))
    } catch (error) {
      record.controller.abort(error)
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true
    for (const record of this.records.values()) {
      if (terminal(record.phase)) continue
      record.controller.abort(new Error('经验服务停止'))
    }
    await Promise.allSettled(
      [...this.records.values()].map(async (record) => {
        await record.admission?.catch(() => {})
        await record.settled
      })
    )
    this.records.clear()
  }
}
