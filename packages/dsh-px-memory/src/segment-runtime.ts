import { randomUUID, createHash } from 'node:crypto'
import { MemoryError, isInternalSession, publicSession, projectKey, type MemoryStore } from './store'
import { service, nativeReader, type HistoryIndex } from './history'
import {
  captureSegment,
  segmentBudget,
  createSegmentCommitter,
  segmentStillVisible,
  type SegmentSource
} from './segment-context'
import { summarizeSegment, SegmentSummaryError } from './segment-summarizer'
import { SegmentStore, type SegmentRecord } from './segment-store'
import type { KnowledgeBank, KnowledgeCaller } from './knowledge'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const finished = (status: string) => ['completed', 'failed', 'killed'].includes(status)
type Running = {
  agent: any
  controller: AbortController
  settled?: Promise<void>
  work?: Promise<unknown>
  jobs?: any
  jobId?: string
}

/** Native Job prepares immutable older evidence; only a native pre-step boundary can commit it. */
export class SegmentRuntime {
  readonly epoch = randomUUID()
  readonly store: SegmentStore
  private stopped = false
  private committer?: Awaited<ReturnType<typeof createSegmentCommitter>>
  private starting?: Promise<void>
  private running = new Map<string, Running>()
  private admissions = new Map<string, Running>()
  private commits = new Map<string, Promise<void>>()
  private shutdown = new AbortController()
  private retry = new Set<string>()
  private problem = new Map<string, string>()
  constructor(
    private host: any,
    private identities: MemoryStore,
    private knowledge: KnowledgeBank,
    private history: HistoryIndex,
    path: string
  ) {
    this.store = new SegmentStore(path)
  }
  ready(): Promise<void> {
    return (this.starting ??= createSegmentCommitter(this.host).then(async (committer) => {
      if (this.stopped) await committer.dispose()
      else this.committer = committer
    }))
  }
  private settings(sessionId: string) {
    const saved = this.store.settings(sessionId)
    const inheritedNativeAutoOff =
      saved.revision === 0 && service(this.host, 'compaction')?.config?.auto === false
    return { ...saved, enabled: saved.enabled && !inheritedNativeAutoOff, inheritedNativeAutoOff }
  }
  private route(agent: any) {
    const pending = service(this.host, 'sessionProjections')?.stateOf(
      agent.session,
      'modelSelection'
    )?.pending
    const header = agent.session.requestHeader?.(),
      value = pending ?? header?.config ?? agent.options
    if (!value?.provider || !value?.model) throw new MemoryError('会话尚未选定模型', 409)
    return {
      provider: String(value.provider),
      model: String(value.model),
      ...(value.reasoningEffort && (pending || header?.adapterDefaults?.reasoningEffort !== true)
        ? { reasoningEffort: String(value.reasoningEffort) }
        : {})
    }
  }
  private identity(sessionId: string) {
    const state = this.identities.read(),
      binding = state.bindings[sessionId],
      persona = state.personas.find((p) => p.id === binding?.personaId)
    if (
      !binding ||
      binding.pending ||
      binding.purpose ||
      !persona ||
      persona.archived ||
      isInternalSession(sessionId)
    )
      throw new MemoryError('此会话当前不能整理上下文', 409)
    if (
      binding.channel &&
      service(this.host, 'pxPersonaResources')?.allowsChannel(
        persona.id,
        binding.channel.provider,
        binding.channel.accountId
      ) === false
    )
      throw new MemoryError('本人格的渠道授权已撤销', 403)
    return {
      binding,
      persona,
      fingerprint: hash([
        binding.personaId,
        binding.personaRevision,
        binding.channel ?? null,
        persona.memoryEnabled,
        persona.resources ?? null
      ])
    }
  }
  private valid(record: SegmentRecord, agent: any): boolean {
    try {
      return (
        !this.stopped &&
        this.settings(record.sessionId).enabled &&
        this.identity(record.sessionId).fingerprint === record.identity &&
        hash(this.route(agent)) === hash(record.route)
      )
    } catch {
      return false
    }
  }
  private scoped(agent: any) {
    return { get: (name: string) => service(agent.ctx, name) ?? service(this.host, name) }
  }
  private async hydrate(agent: any, record: SegmentRecord): Promise<SegmentSource> {
    const reader = await nativeReader(this.host, record.sessionId, this.shutdown.signal),
      messages = []
    try {
      for (let at = 0; at < record.source.seqs.length; at++) {
        const seq = record.source.seqs[at],
          event = (await reader.read(seq, 1, { signal: this.shutdown.signal })).events[0]
        if (!event || event.seq !== seq || hash(event) !== record.source.eventHashes[at])
          throw new MemoryError('片段原始记录已变化，未提交', 409)
        const message = agent.session.deriveEventMessage(event)
        if (!message) throw new MemoryError('片段消息已不可用，未提交', 409)
        messages.push(message)
      }
    } finally {
      await reader.close()
    }
    if (hash(messages) !== record.source.fingerprint) throw new MemoryError('片段消息投影已变化，未提交', 409)
    return { ...record.source, messages }
  }
  private async reconcile(agent: any): Promise<void> {
    for (const record of this.store.unfinished(agent.session.id)) {
      if (
        record.epoch === this.epoch &&
        (record.phase !== 'committing' || this.commits.has(agent.session.id))
      )
        continue
      // A crash may have happened after the native transaction but before our auxiliary receipt.
      let nativeId: string | undefined
      if (record.phase === 'committing') {
        nativeId = await this.findNativeCommit(record)
      }
      this.store.change(record.id, [record.phase], (row) => {
        row.phase = nativeId ? 'committed' : 'discarded'
        if (nativeId) row.nativeCompactionId = nativeId
        else row.error = '上次运行已中断；未自动重放后台调用或提交。原始历史保留，可手动重新整理。'
      })
    }
  }
  private async findNativeCommit(record: SegmentRecord): Promise<string | undefined> {
    const reader = await nativeReader(this.host, record.sessionId)
    try {
      let at = record.source.capturedThrough,
        previous: any
      for (let page = 0; page < 50; page++) {
        const events = (await reader.read(at, 256)).events
        if (!events.length) break
        for (const event of events) {
          if (
            previous?.type === 'compaction/summary' &&
            event.seq === previous.seq + 1 &&
            JSON.stringify(previous.data.summary).includes('【已压缩片段 ' + record.id + '】') &&
            event.type === 'user/message' &&
            event.surfaceOp?.op === 'replace' &&
            event.data.source?.kind === 'compact-checkpoint' &&
            event.data.source.compactionId === previous.data.compactionId &&
            hash(previous.data.shadowedSeqs) === hash(record.source.seqs)
          )
            return previous.data.compactionId
          previous = event
        }
        at = events.at(-1).seq + 1
        if (events.length < 256) break
      }
    } finally {
      await reader.close()
    }
  }
  async boundary(agent: any, signal: AbortSignal): Promise<void> {
    if (this.stopped || !this.committer || isInternalSession(agent.session.id)) return
    try {
      this.identity(agent.session.id)
      await this.reconcile(agent)
      if (!this.settings(agent.session.id).enabled) return
      const ready = this.store.unfinished(agent.session.id).find((row) => row.phase === 'ready')
      if (ready && !this.commits.has(agent.session.id)) {
        const committing = this.commitReady(agent, ready, signal)
        this.commits.set(agent.session.id, committing)
        try {
          await committing
        } finally {
          this.commits.delete(agent.session.id)
        }
      }
      this.schedule(agent)
    } catch (error) {
      this.problem.set(agent.session.id, error instanceof Error ? error.message : '后台整理暂不可用')
    }
  }
  schedule(agent: any): void {
    const id = agent.session.id
    if (
      this.stopped ||
      !this.committer ||
      this.admissions.has(id) ||
      this.running.size + this.admissions.size >= 2 ||
      this.store.unfinished(id).length ||
      !this.settings(id).enabled ||
      isInternalSession(id)
    )
      return
    const owner: Running = { agent, controller: new AbortController() }
    this.admissions.set(id, owner)
    owner.settled = this.prepare(agent, owner)
      .catch((error) => {
        if (!this.stopped) this.problem.set(id, error instanceof Error ? error.message : '后台整理未启动')
      })
      .finally(() => {
        if (this.admissions.get(id) === owner) this.admissions.delete(id)
      })
  }
  private async prepare(agent: any, owner: Running): Promise<void> {
    const signal = AbortSignal.any([
      owner.controller.signal,
      this.shutdown.signal,
      AbortSignal.timeout(15000)
    ])
    const id = agent.session.id,
      identity = this.identity(id),
      route = this.route(agent),
      scoped = this.scoped(agent)
    const description = await service(this.host, 'pxContextPolicy')?.describe(agent, route, signal)
    const capacity =
      Number.isSafeInteger(description?.capacity) && description.capacity > 0 ? description.capacity : 32768
    const source = await captureSegment(
      { get: (name: string) => service(this.host, name) },
      agent,
      segmentBudget(capacity),
      signal
    )
    if (!source) return
    const retryRequested = this.retry.delete(id)
    if (this.store.seen(id, source.fingerprint, identity.fingerprint, route) && !retryRequested) return
    let memoryTarget: SegmentRecord['memoryTarget'],
      allowedSeqs: number[] = []
    if (identity.persona.memoryEnabled) {
      const caller = this.memoryCaller(id, agent.session.header.cwd),
        scope = publicSession(identity.binding)
          ? 'project'
          : projectKey(agent.session.header.cwd)
            ? 'persona-project'
            : 'persona'
      memoryTarget = {
        scope,
        conversation: publicSession(identity.binding),
        revision: (await this.knowledge.catalog(caller, scope)).revision
      }
    }
    source.readableSeqs = []
    for (const seq of source.seqs) {
      try {
        const event: any = await this.history.read(this.host, id, id, seq, 0, signal)
        source.readableSeqs.push(seq)
        if (
          identity.persona.memoryEnabled &&
          ['user', 'tool-result', 'native-state', 'ledger'].includes(event.kind)
        )
          allowedSeqs.push(seq)
      } catch (error: any) {
        if (error?.status !== 403) throw error
      }
    }
    signal.throwIfAborted()
    if (
      this.identity(id).fingerprint !== identity.fingerprint ||
      hash(this.route(agent)) !== hash(route) ||
      !segmentStillVisible(agent.session, source)
    )
      return
    const jobs = scoped.get('jobs')
    if (!jobs?.start || !jobs.wait || !jobs.read || !jobs.attachController)
      throw new MemoryError('原生后台 Job 服务未就绪', 503)
    const now = new Date().toISOString(),
      { messages: _, ...sourceMetadata } = source
    const record: SegmentRecord = {
      id: randomUUID(),
      sessionId: id,
      personaId: identity.persona.id,
      identity: identity.fingerprint,
      epoch: this.epoch,
      phase: 'preparing',
      source: sourceMetadata,
      route,
      capacity,
      createdAt: now,
      updatedAt: now,
      ...(memoryTarget ? { memoryTarget } : {})
    }
    this.store.create(record)
    this.problem.delete(id)
    const running: Running = { agent, controller: new AbortController(), jobs }
    this.running.set(record.id, running)
    const timer = setTimeout(() => running.controller.abort(new Error('后台整理超时，未自动重试')), 180000)
    const abort = AbortSignal.any([running.controller.signal, this.shutdown.signal])
    try {
      running.jobId = jobs.start({
        kind: 'px-context-segments',
        label: '后台整理上下文（主任务无需等待）',
        owner: agent.id,
        outputLimitBytes: 2000,
        run: () => ({
          done: (running.work = (async () => {
            try {
              if (!this.valid(record, agent)) throw new MemoryError('会话配置或受众已变化，取消后台整理', 409)
              const prepared = await summarizeSegment(scoped, record, source, allowedSeqs, abort)
              abort.throwIfAborted()
              if (!this.valid(record, agent) || !segmentStillVisible(agent.session, source))
                throw new MemoryError('后台整理期间上下文或配置已变化，未提交结果', 409)
              const saved = this.store.change(record.id, ['preparing'], (row) => {
                row.phase = 'ready'
                row.prepared = prepared
                if (prepared.usage) row.usage = prepared.usage
              })
              if (!saved) throw new MemoryError('后台片段已取消', 409)
              return {
                status: 'completed',
                result: '摘要已准备，等待会话下一安全步骤提交；记忆建议尚未采纳。'
              }
            } catch (error) {
              this.store.change(record.id, ['preparing', 'stopping'], (row) => {
                row.phase = abort.aborted ? 'cancelled' : 'failed'
                row.error = error instanceof Error ? error.message.slice(0, 400) : '后台整理失败'
                if (error instanceof SegmentSummaryError && error.usage) row.usage = error.usage
              })
              return {
                status: abort.aborted ? 'killed' : 'failed',
                detail: abort.aborted ? '后台整理已停止，原文保留' : '后台整理未完成，原生压力压缩仍可继续'
              }
            }
          })()),
          cancel: (reason?: string) => {
            running.controller.abort(new Error(reason ?? '后台整理已停止'))
            this.store.change(record.id, ['preparing'], (row) => {
              row.phase = 'stopping'
              row.error = reason ?? '正在停止原生后台作业'
            })
          }
        })
      })
      this.store.change(record.id, ['preparing', 'ready'], (row) => {
        row.jobId = running.jobId
      })
      running.settled = (async () => {
        try {
          let result
          do {
            result = await jobs.wait(running.jobId, 190000, agent.id)
          } while (!finished(result.status))
          jobs.read(running.jobId, agent.id)
          if (result.status !== 'completed')
            this.store.change(record.id, ['preparing', 'stopping', 'ready'], (row) => {
              row.phase = result.status === 'killed' ? 'cancelled' : 'failed'
              row.error ??= '原生后台作业未成功结束'
            })
        } catch (error) {
          running.controller.abort(error)
          this.store.change(record.id, ['preparing', 'stopping', 'ready'], (row) => {
            row.phase = 'failed'
            row.error = '无法核对原生 Job 终态，未提交候选'
          })
        } finally {
          await running.work?.catch(() => {})
          clearTimeout(timer)
          this.running.delete(record.id)
        }
      })()
      void running.settled.catch((error) => this.problem.set(id, String(error).slice(0, 400)))
    } catch (error) {
      clearTimeout(timer)
      running.controller.abort(error)
      this.running.delete(record.id)
      this.store.change(record.id, ['preparing'], (row) => {
        row.phase = 'failed'
        row.error = '原生 Job 未启动，原文保留'
      })
      throw error
    }
  }
  private async commitReady(agent: any, record: SegmentRecord, signal: AbortSignal): Promise<void> {
    if (this.running.has(record.id)) return // Native Job settlement is authoritative, not just the saved result.
    if (!this.valid(record, agent) || !record.prepared) {
      this.store.change(record.id, ['ready'], (row) => {
        row.phase = 'discarded'
        row.error = '配置已变化，旧候选未提交'
      })
      return
    }
    const combined = AbortSignal.any([signal, this.shutdown.signal])
    try {
      const source = await this.hydrate(agent, record)
      combined.throwIfAborted()
      if (!this.valid(record, agent)) throw new MemoryError('提交前配置已变化', 409)
      if (
        !this.store.change(record.id, ['ready'], (row) => {
          row.phase = 'committing'
        })
      )
        return
      const result = await this.committer!.commit(
        agent,
        source,
        {
          id: record.id,
          summary: record.prepared.summary,
          provider: record.route.provider,
          model: record.route.model
        },
        combined
      )
      this.store.change(record.id, ['committing'], (row) => {
        row.phase = 'committed'
        row.nativeCompactionId = String(result.compactionId)
      })
      this.problem.delete(record.sessionId)
    } catch (error) {
      const nativeId = await this.findNativeCommit(record)
      this.store.change(record.id, ['ready', 'committing'], (row) => {
        row.phase = nativeId ? 'committed' : combined.aborted ? 'cancelled' : 'discarded'
        if (nativeId) row.nativeCompactionId = nativeId
        row.error = nativeId
          ? '原生替换已核对，提交后的收尾需要检查：' + String(error).slice(0, 250)
          : error instanceof Error
            ? error.message.slice(0, 400)
            : '候选未提交；原文保留'
      })
    }
  }
  cancel(sessionId: string, reason = '用户停止后台整理'): void {
    this.admissions.get(sessionId)?.controller.abort(new Error(reason))
    for (const record of this.store.unfinished(sessionId)) {
      if (record.phase === 'committing') continue // Native transaction owns its short commit boundary.
      const run = this.running.get(record.id)
      let stopping = !!run
      try {
        if (run?.jobId) stopping = run.jobs.kill(run.jobId, run.agent.id, reason) === 'requested'
      } catch {
        /* Owner teardown may already have retired the registry row; still stop our exact producer. */
      }
      run?.controller.abort(new Error(reason))
      this.store.change(record.id, ['preparing', 'stopping', 'ready'], (row) => {
        row.phase = stopping ? 'stopping' : 'cancelled'
        row.error = reason
      })
    }
  }
  changed(): void {
    for (const [id, run] of this.admissions) {
      try {
        this.identity(id)
      } catch {
        run.controller.abort(new Error('人格状态已变化'))
      }
    }
    for (const [id, run] of this.running) {
      const record = this.store.get(id)
      if (record && !this.valid(record, run.agent)) this.cancel(record.sessionId, '人格、模型或受众已变化')
    }
  }
  surfaceChanged(session: any): void {
    if (this.stopped) return
    for (const record of this.store.unfinished(session.id)) {
      if (
        ['preparing', 'ready'].includes(record.phase) &&
        !segmentStillVisible(session, { ...record.source, messages: [] })
      ) {
        this.cancel(session.id, '原生上下文已替换此范围，旧后台候选不再提交')
        break
      }
    }
  }
  snapshot(sessionId: string) {
    const records = this.store.list(sessionId),
      totals: Record<string, number> = {}
    for (const record of records)
      for (const [key, value] of Object.entries(record.usage ?? {}))
        if (Number.isFinite(value)) totals[key] = (totals[key] ?? 0) + value
    return {
      ready: !!this.committer,
      preparingAdmission: this.admissions.has(sessionId),
      settings: this.settings(sessionId),
      problem: this.problem.get(sessionId),
      records: records.map((row) => ({ ...row, nativeJobPending: this.running.has(row.id) })),
      cost: {
        usage: totals,
        measuredJobs: records.filter((row) => row.usage).length,
        unknownJobs: records.filter((row) => row.jobId && !row.usage).length,
        note: '仅统计当前页后台调用；不与原生主请求重复相加，未知用量不是零。'
      }
    }
  }
  modelSnapshot(sessionId: string) {
    return this.store
      .list(sessionId, 20)
      .filter((row) => row.phase === 'committed')
      .map((row) => ({
        id: row.id,
        phase: row.phase,
        sourceSessionId: sessionId,
        sourceEvents: row.source.readableSeqs ?? row.source.seqs,
        summary: row.prepared?.summary
      }))
  }
  configure(sessionId: string, revision: number, enabled: boolean) {
    const before = this.settings(sessionId)
    const value = this.store.configure(sessionId, revision, enabled)
    if (!enabled) this.cancel(sessionId, '本会话已关闭后台整理')
    else if (!before.enabled) this.retry.add(sessionId)
    return value
  }
  requestRetry(sessionId: string) {
    if (this.store.unfinished(sessionId).length) throw new MemoryError('请先结束当前后台整理或等待提交', 409)
    this.retry.add(sessionId)
    const agent = service(this.host, 'agents')?.get(sessionId)
    if (agent) this.schedule(agent)
  }
  private memoryCaller(
    sessionId: string,
    project?: string,
    actor: 'human' | 'model' = 'model'
  ): KnowledgeCaller {
    const binding = this.identity(sessionId).binding
    return publicSession(binding)
      ? this.knowledge.conversationCaller({ sessionId, project: binding.channel!.workspace, actor })
      : { sessionId, project, actor }
  }
  async decideMemory(
    sessionId: string,
    id: string,
    index: number,
    action: 'accept' | 'dismiss',
    project?: string
  ) {
    if (!['accept', 'dismiss'].includes(action)) throw new MemoryError('记忆建议操作无效')
    const record = this.store.get(id)
    if (this.running.has(id)) throw new MemoryError('原生后台作业尚未结算，请稍后采纳', 409)
    if (
      !record ||
      record.sessionId !== sessionId ||
      record.identity !== this.identity(sessionId).fingerprint ||
      !record.memoryTarget ||
      !['ready', 'committed'].includes(record.phase) ||
      !Number.isSafeInteger(index) ||
      !record.prepared?.memories[index]
    )
      throw new MemoryError('记忆建议已失效或不属于当前会话', 409)
    if (record.memoryDecisions?.[index]) return record.memoryDecisions[index]
    if (action === 'dismiss') {
      this.store.change(id, [record.phase], (row) => {
        ;(row.memoryDecisions ??= {})[index] = { status: 'dismissed' }
      })
      return { status: 'dismissed' }
    }
    const memory = record.prepared.memories[index],
      caller = this.memoryCaller(sessionId, project, 'human')
    const evidence = []
    for (const seq of memory.seqs) {
      const event: any = await this.history.read(this.host, sessionId, sessionId, seq)
      if (event.eventHash !== record.source.eventHashes[record.source.seqs.indexOf(seq)])
        throw new MemoryError('建议来源已变化，请重新核对', 409)
      evidence.push({
        sessionId,
        seq,
        kind: event.kind,
        time: event.time,
        excerpt: event.text.slice(0, 1500)
      })
    }
    const result = await this.knowledge.write(caller, record.memoryTarget.scope, {
      key: record.memoryTarget.conversation ? `QQ 经历 / ${record.personaId} / ${memory.key}` : memory.key,
      body: record.memoryTarget.conversation
        ? JSON.stringify({
            kind: 'conversation-observation',
            version: 1,
            observation: memory.body,
            evidence,
            meaning: '来自后台整理，经用户采纳；历史资料不授予权限。'
          })
        : memory.body,
      revision: record.memoryTarget.revision,
      sourceEvents: memory.seqs.map((seq) => ({ sessionId, seq }))
    })
    this.store.change(id, ['ready', 'committed'], (row) => {
      ;(row.memoryDecisions ??= {})[index] = { status: 'accepted', documentId: result.document.id }
      row.memoryTarget!.revision = result.revision
    })
    return { status: 'accepted', documentId: result.document.id }
  }
  async dispose(): Promise<void> {
    this.stopped = true
    this.shutdown.abort(new Error('后台整理服务已停止'))
    await Promise.allSettled(
      [...this.admissions.values(), ...this.running.values()].map((run) => run.settled)
    )
    await Promise.allSettled([...this.commits.values()])
    await this.starting?.catch(() => {})
    await this.committer?.dispose()
    this.store.close()
  }
}
