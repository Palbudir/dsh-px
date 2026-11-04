import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ChannelInbox, type PendingChannelMessage } from '../../shared/channel-inbox'
import { ChannelDispatch } from '../../shared/channel-dispatch'
import { recoverStoredAdmission } from '../../shared/channel-recovery'
import { nativeModelSelection } from '../../shared/native-model-selection'
import { stopNativeTaskActors } from '../../shared/native-task-stop'
import { installChannelTaskAudience } from './channel-task-audience'
import { ChannelError, type ChannelAccount } from './channel-settings'
import { ChannelInteractions } from '../../shared/channel-interactions'
import { reconcileChannelAdmission } from '../../shared/channel-admission'
import { channelTaskOutput } from './channel-task-output'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const get = (ctx: any, key: string) => (ctx.get ? ctx.get(key) : ctx[key])
type Receipt = NonNullable<ReturnType<ChannelInbox['receipt']>>
export interface TaskRequest {
  id: string
  receipt: Receipt
  text: string
}

/** Channel adapter over native roots/queues/Goal/Team. The inbox contains admission receipts, not task status. */
export class FeishuTasks {
  readonly inbox: ChannelInbox
  readonly dispatch: ChannelDispatch
  readonly interactions: ChannelInteractions
  private readonly handles = new Map<string, any>()
  private readonly actors = new Map<string, any>()
  private readonly opening = new Map<string, Promise<any>>()
  private readonly creation = new Map<string, AbortController>()
  private readonly stoppingRoots = new Set<string>()
  private readonly outputControllers = new Map<string, AbortController>()
  private readonly prepared = new Map<string, PendingChannelMessage>()
  private readonly stopping = new Map<string, number>()
  private readonly sends = new Map<string, Promise<void>>()
  private readonly errors = new Map<string, string>()
  private readonly stop = new AbortController()
  private closed = false
  private disposal?: Promise<void>
  private recovery?: Promise<void>
  private activated = false
  private outputFlush?: Promise<void>
  private flushAgain = false
  private receptionPaused = false
  private readonly outputScans = new Map<string, Promise<void>>()
  constructor(
    private readonly host: any,
    private readonly account: ChannelAccount,
    private readonly current: () => ChannelAccount | undefined,
    private readonly leaseActive: () => boolean,
    directory: string,
    private readonly epoch: string,
    private readonly deliver: (
      inbox: ChannelInbox,
      origin: { id: string; receipt: Receipt },
      sessionId: string,
      key: string,
      text: string,
      signal: AbortSignal
    ) => Promise<unknown>
  ) {
    this.inbox = new ChannelInbox(
      join(directory, hash([account.accountId, account.fingerprint]) + '-tasks.sqlite'),
      { provider: 'feishu', accountId: account.accountId, fingerprint: account.fingerprint }
    )
    this.dispatch = new ChannelDispatch(this.inbox, epoch, {
      selection: (row) =>
        this.activated && this.leaseActive() && !this.receptionPaused && this.authorized(row)
          ? 'wake'
          : 'hold',
      prepare: (row, signal) => this.prepare(row, signal),
      failed: (row, error) => this.errors.set(row?.id ?? 'storage', String(error))
    })
    this.interactions = new ChannelInteractions(
      async (_chat, text, source) => {
        if (!source) throw new ChannelError('请求交付缺少原生会话', 409)
        const origin = this.origin(get(this.host, 'agents').get(source.sessionId), true),
          signal = source.signal ? AbortSignal.any([source.signal, this.stop.signal]) : this.stop.signal
        const key = 'interaction:' + source.sessionId + ':' + source.interactionId
        if (origin.receipt.phase !== 'admitted')
          await reconcileChannelAdmission(
            this.inbox,
            origin.id,
            {
              agent: get(this.host, 'agents').get(origin.receipt.claim!.sessionId),
              sessions: get(this.host, 'sessions')
            },
            signal
          )
        this.inbox.queueReply(key, origin.id, origin.receipt.claim!.sessionId, text)
        const cancel = () => this.inbox.cancelQueuedReply(origin.receipt.claim!.sessionId, origin.id, key)
        signal.addEventListener('abort', cancel, { once: true })
        if (signal.aborted) cancel()
        void this.flushOutputs().catch((error) => this.errors.set(source.sessionId, String(error)))
        return { queued: true }
      },
      10 * 60_000,
      {
        label: '飞书',
        maxCharacters: 4000,
        remoteAnswers: true,
        plainAnswers: false,
        error: (message, status) => new ChannelError(message, status)
      }
    )
  }
  matches(account: ChannelAccount): boolean {
    return (
      !this.closed &&
      !this.stop.signal.aborted &&
      account.fingerprint === this.account.fingerprint &&
      account.routeRevision === this.account.routeRevision &&
      account.personaId === this.account.personaId
    )
  }
  interaction(kind: 'approval' | 'question', request: any, next: () => Promise<unknown>) {
    if (!this.owns(request.agent)) return next()
    const channel = this.memory().inspect(request.agent.id).binding.channel
    return this.interactions.request(kind, request, channel.conversationId, next, {
      requesterId: channel.task.requesterId,
      allowed: () => this.owns(request.agent)
    })
  }
  answerInteraction(input: any) {
    const pending = this.interactions.list().find((row) => row.id === input.id)
    if (!pending) throw new ChannelError('请求已处理或取消', 409)
    return this.interactions.respond(pending.chatId, input, pending.requesterId)
  }
  async pause(): Promise<void> {
    this.receptionPaused = true
    for (const controller of this.creation.values()) controller.abort(Error('渠道处理已停止'))
    let cursor = 0
    for (;;) {
      const rows = this.inbox.pending(100, cursor)
      if (!rows.length) break
      for (const row of rows) {
        cursor = row.seq
        this.inbox.cancelPending(row.id)
      }
    }
    await Promise.allSettled([...this.opening.values()])
    await Promise.all(
      [...this.actors.values()]
        .filter((agent) => this.memory().inspect(agent.id).binding?.channel?.task?.rootSessionId === agent.id)
        .map((agent) => this.stopTask(agent.id))
    )
  }
  resumeReception(): void {
    this.receptionPaused = false
    this.dispatch.schedule()
    void this.flushOutputs()
  }
  private memory() {
    return get(this.host, 'pxMemoryChannels')
  }
  /** Called only after exclusive transport ownership. Read native receipts without waking old tasks. */
  activate(): Promise<void> {
    if (this.recovery) return this.recovery
    if (this.activated) {
      this.dispatch.schedule()
      return this.flushOutputs()
    }
    if (!this.leaseActive() || this.stop.signal.aborted) throw new ChannelError('渠道接收租约未就绪', 409)
    this.inbox.recoverInterrupted(this.epoch)
    this.inbox.retireQueuedInteractions()
    const work = (async () => {
      let after = 0
      for (;;) {
        this.stop.signal.throwIfAborted()
        const batch = this.inbox.uncertainInputs(20, after)
        if (!batch.length) break
        for (const first of batch) {
          let row = first
          try {
            for (;;) {
              const outcome = await recoverStoredAdmission(this.host, this.inbox, row, this.stop.signal)
              if (outcome !== 'partial') {
                if (outcome === 'missing') this.errors.set(row.id, '没有找到原生收件依据，未重新执行任务')
                else this.errors.delete(row.id)
                break
              }
              const next = this.inbox.uncertainInputs(1, row.seq - 1)[0]
              if (next?.id !== row.id) break
              row = next
              await new Promise((done) => setTimeout(done, 0))
            }
          } catch (error) {
            this.stop.signal.throwIfAborted()
            this.errors.set(row.id, String(error))
          }
          after = first.seq
        }
      }
      this.stop.signal.throwIfAborted()
      for (const row of this.memory().channelBindings(this.account.accountId, 'feishu')) {
        if (row.channel.task?.rootSessionId === row.sessionId)
          await this.recoverOutputs(row.sessionId).catch((error) =>
            this.errors.set('output-scan:' + row.sessionId, String(error))
          )
      }
      this.activated = true
      this.dispatch.schedule()
      await this.flushOutputs()
    })().finally(() => {
      if (this.recovery === work) this.recovery = undefined
    })
    this.recovery = work
    return work
  }
  private authorized(
    row: Pick<PendingChannelMessage, 'recipient'> & { event: { actorId: string } }
  ): boolean {
    const c = this.current()
    return (
      !this.stop.signal.aborted &&
      !!c?.enabled &&
      c.fingerprint === this.account.fingerprint &&
      c.personaId === row.recipient.personaId &&
      c.routeRevision === row.recipient.routeRevision &&
      c.authorizedUsers.includes(row.event.actorId) &&
      get(this.host, 'pxPersonaResources')?.allowsChannel(c.personaId, 'feishu', c.accountId) === true
    )
  }
  private rootSource(id: string): { id: string; receipt: Receipt } | undefined {
    return this.inbox.firstForSession(id)
  }
  owns(agent: any, ignorePause = false): boolean {
    try {
      const info = this.memory().inspect(agent?.session.id),
        channel = info.binding?.channel,
        rootId = channel?.task?.rootSessionId
      if (
        !rootId ||
        channel.provider !== 'feishu' ||
        channel.accountId !== this.account.accountId ||
        channel.access !== 'public'
      )
        return false
      if (
        !ignorePause &&
        (this.outputControllers.get(rootId)?.signal.aborted || this.inbox.outputScan(rootId).paused)
      )
        return false
      const row = this.rootSource(rootId),
        preparation = this.prepared.get(rootId)
      const source = row ? { event: row.receipt.source, recipient: row.receipt.recipient } : preparation
      if (
        !source ||
        !this.authorized(source) ||
        channel.task.requesterId !== source.event.actorId ||
        channel.conversationId !== source.event.conversationId ||
        info.binding.personaId !== source.recipient.personaId
      )
        return false
      const root = this.memory().inspect(rootId).binding
      return (
        root?.channel?.task?.rootSessionId === rootId &&
        root.personaId === info.binding.personaId &&
        root.channel.task.requesterId === channel.task.requesterId
      )
    } catch {
      return false
    }
  }
  created(agent: any): void {
    const agents = get(this.host, 'agents')
    const parent = agents
      .list()
      .find(
        (candidate: any) =>
          candidate !== agent && agents.isOwnedBy(agent.id, candidate) && this.owns(candidate)
      )
    if (parent) {
      const info = this.memory().inspect(parent.id)
      this.memory().bind(agent.id, info.binding.personaId, info.binding.channel, parent.id)
    }
    const channel = this.memory().inspect(agent.id)?.binding?.channel
    if (channel?.provider !== 'feishu' || channel.accountId !== this.account.accountId || !channel.task)
      return
    if (!this.owns(agent, true) && !this.stoppingRoots.has(channel.task.rootSessionId))
      throw new ChannelError('此飞书任务授权已失效', 403)
    this.actors.set(agent.id, agent)
    installChannelTaskAudience(agent.ctx)
  }
  submit(origin: TaskRequest, options: { action: 'start' | 'continue'; taskId?: string }) {
    const row = {
      event: { ...origin.receipt.source, text: origin.text },
      recipient: origin.receipt.recipient
    }
    if (this.receptionPaused || !this.leaseActive() || !this.authorized(row))
      throw new ChannelError('此飞书成员没有当前任务权限或渠道已停止接收', 403)
    const rootId =
      options.action === 'continue' ? options.taskId : 'px-channel-task-' + hash([origin.id, row.recipient])
    if (!rootId) throw new ChannelError('继续任务需要任务编号')
    if (this.stoppingRoots.has(rootId)) throw new ChannelError('此任务正在停止，请稍后再继续', 409)
    if (options.action === 'continue') {
      const first = this.rootSource(rootId)
      if (
        !first ||
        first.receipt.source.actorId !== row.event.actorId ||
        first.receipt.source.conversationId !== row.event.conversationId ||
        first.receipt.recipient.personaId !== row.recipient.personaId ||
        first.receipt.recipient.routeRevision !== row.recipient.routeRevision
      )
        throw new ChannelError('该任务不属于当前成员、聊天或人格', 403)
    }
    const accepted = this.inbox.accept(row.event, { ...row.recipient, executionSessionId: rootId })
    if (accepted.recipient.executionSessionId !== rootId)
      throw new ChannelError('这条原始消息已交给另一任务，未重复受理', 409)
    if (!accepted.duplicate && this.outputControllers.get(rootId)?.signal.aborted)
      this.outputControllers.set(rootId, new AbortController())
    this.dispatch.schedule()
    const receipt = this.inbox.receipt(accepted.id)!
    return {
      taskId: rootId,
      admission: receipt.phase,
      duplicate: accepted.duplicate,
      note: '原生任务已受理或排队，不表示执行完成；结果交付到任务原始消息。'
    }
  }
  private async prepare(row: PendingChannelMessage, signal: AbortSignal) {
    if (this.receptionPaused || !this.authorized(row))
      throw new ChannelError('任务授权已撤销或接收已停止', 403)
    const id = row.recipient.executionSessionId
    if (!id) throw new ChannelError('任务缺少原生接收会话')
    let pending = this.opening.get(id)
    if (!pending) {
      const controller = new AbortController()
      this.creation.set(id, controller)
      pending = this.open(row, AbortSignal.any([signal, this.stop.signal, controller.signal])).finally(() => {
        this.opening.delete(id)
        this.creation.delete(id)
      })
      this.opening.set(id, pending)
    }
    const agent = await pending
    return {
      agent,
      sessions: get(this.host, 'sessions'),
      validate: () =>
        !this.receptionPaused && this.authorized(row) && this.owns(agent) && this.matchesInput(agent, row)
    }
  }
  private matchesInput(agent: any, row: PendingChannelMessage): boolean {
    const binding = this.memory().inspect(agent.id)?.binding,
      channel = binding?.channel
    return (
      agent.id === row.recipient.executionSessionId &&
      binding?.personaId === row.recipient.personaId &&
      channel?.provider === 'feishu' &&
      channel.accountId === this.account.accountId &&
      channel.conversationId === row.event.conversationId &&
      channel.task?.rootSessionId === agent.id &&
      channel.task.requesterId === row.event.actorId
    )
  }
  private async open(row: PendingChannelMessage, signal: AbortSignal) {
    const id = row.recipient.executionSessionId!,
      agents = get(this.host, 'agents'),
      memory = this.memory()
    this.prepared.set(id, row)
    if (this.inbox.outputScan(id).paused) {
      await this.recoverOutputs(id)
      signal.throwIfAborted()
      this.inbox.resumeOutputs(id)
      this.outputControllers.set(id, new AbortController())
    }
    if (!this.outputControllers.has(id)) this.outputControllers.set(id, new AbortController())
    const live = agents.get(id)
    if (live) {
      if (!this.owns(live) || !this.matchesInput(live, row))
        throw new ChannelError('已有任务会话归属不同', 409)
      this.created(live)
      return live
    }
    const chatWorkspace = join(
        this.account.workspace,
        'feishu',
        hash([this.account.accountId, this.account.fingerprint, row.event.conversationId])
      ),
      cwd = join(chatWorkspace, 'tasks', id),
      channel = {
        provider: 'feishu',
        accountId: this.account.accountId,
        conversationId: row.event.conversationId,
        access: 'public',
        publicInstructions: this.account.publicInstructions,
        workspace: chatWorkspace,
        task: { requesterId: row.event.actorId, rootSessionId: id }
      }
    let existing: any
    try {
      existing = await get(this.host, 'sessionController').inspect(id)
    } catch (error: any) {
      if (error?.code !== 'session/not-found' && error?.constructor?.name !== 'ApiSessionNotFound')
        throw error
    }
    if (existing && resolve(existing.meta.cwd) !== resolve(cwd))
      throw new ChannelError('原任务工作区归属不同', 409)
    memory.bind(id, row.recipient.personaId, channel)
    mkdirSync(cwd, { recursive: true })
    const presets = get(this.host, 'agentPresets'),
      route = get(this.host, 'agentDefaultModel').currentSelection()
    if (!route?.provider || !route?.model) throw new ChannelError('请先选择原生默认模型', 409)
    const setup = async (ctx: any, agent: any) => {
      const recorded = existing
        ? get(this.host, 'sessionProjections').stateOf(agent.session, 'agentPreset')
        : presets.defaultId
      if (typeof recorded !== 'string' || !recorded)
        throw new ChannelError('原任务的预设无法确认，未替换成默认预设', 409)
      await presets.mount(ctx, recorded)
      const { installModelSelection } = await import('@deepseek-ai/dsh-agent')
      ctx.effect(
        () => installModelSelection(ctx, nativeModelSelection(this.host, id, route)),
        'channels: task model selection'
      )
      installChannelTaskAudience(ctx)
      return {
        commit: () => {
          signal.throwIfAborted()
          if (!this.authorized(row)) throw new ChannelError('任务授权已变化', 403)
        }
      }
    }
    const handle = await agents.withoutInitiator(() =>
      existing
        ? agents.resume({ resumeSessionId: id, agentOptions: route, signal, setup })
        : agents.create({
            sessionId: id,
            meta: { cwd, agentPreset: presets.defaultId },
            agentOptions: route,
            signal,
            setup
          })
    )
    this.handles.set(id, handle)
    signal.throwIfAborted()
    memory.bind(id, row.recipient.personaId, channel)
    this.created(handle.agent)
    // Native ordinary sessions can own a cwd without a Workspace row. Keep file isolation
    // without creating a sidebar workspace for every task; native title generation remains available.
    return handle.agent
  }
  event(session: any, event: any): void {
    const agent = this.actors.get(session.id)
    if (!agent || this.stopping.has(session.id) || !this.owns(agent)) return
    const channel = this.memory().inspect(session.id).binding.channel
    if (channel.task.rootSessionId !== session.id || !['assistant/message', 'turn/end'].includes(event.type))
      return
    void this.recoverOutputs(session.id, event.seq)
      .catch((error) => this.errors.set('output-scan:' + session.id, String(error)))
      .finally(() => {
        void this.flushOutputs().catch((error) => this.errors.set(session.id, String(error)))
      })
  }
  /** Recover transport drafts from native committed output; never start an Agent or rerun its work. */
  recoverOutputs(sessionId: string, throughSeq?: number): Promise<void> {
    const pending = this.outputScans.get(sessionId)
    if (pending)
      return pending.then(() =>
        throughSeq !== undefined && this.inbox.outputScan(sessionId).nextSeq <= throughSeq
          ? this.recoverOutputs(sessionId, throughSeq)
          : undefined
      )
    if (this.closed || this.stop.signal.aborted) return Promise.resolve()
    const source = this.rootSource(sessionId),
      paused = this.inbox.outputScan(sessionId).paused
    if (!source || (!paused && !this.owns({ id: sessionId, session: { id: sessionId } }, true)))
      return Promise.resolve()
    const work = (async () => {
      const live = get(this.host, 'sessions').get(sessionId)
      if (live && !(await get(this.host, 'sessions').flush(live)))
        throw new ChannelError('原生输出未确认保存', 503)
      if (source.receipt.phase !== 'admitted') {
        const agent = get(this.host, 'agents').get(sessionId)
        if (!agent) return
        await reconcileChannelAdmission(
          this.inbox,
          source.id,
          { agent, sessions: get(this.host, 'sessions') },
          this.stop.signal
        )
      }
      const reader = await get(this.host, 'sessionPersistence').open(sessionId, 'read', {
        signal: this.stop.signal
      })
      try {
        if (reader.header.id !== sessionId || reader.access !== 'read')
          throw new ChannelError('原生输出读取归属不匹配', 409)
        let cursor = Math.max(this.inbox.outputScan(sessionId).nextSeq, reader.inheritedEventCount ?? 0)
        for (;;) {
          this.stop.signal.throwIfAborted()
          const page = await reader.read(cursor, 256, { signal: this.stop.signal })
          const paused = this.inbox.outputScan(sessionId).paused
          for (const event of page.events) {
            if (!paused) {
              const outputs = channelTaskOutput(event)
              if (outputs.length && !this.owns({ id: sessionId, session: { id: sessionId } }, true)) return
              for (const output of outputs)
                this.inbox.queueReply(output.key, source.id, sessionId, output.body)
            }
            cursor = event.seq + 1
          }
          // A crash before this checkpoint re-reads the page; stable part keys deduplicate it.
          this.inbox.advanceOutputScan(sessionId, cursor)
          if (page.events.length < 256) {
            this.errors.delete('output-scan:' + sessionId)
            return
          }
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
      } finally {
        await reader.close()
      }
    })().finally(() => {
      if (this.outputScans.get(sessionId) === work) this.outputScans.delete(sessionId)
    })
    this.outputScans.set(sessionId, work)
    return work
  }
  flushOutputs(): Promise<void> {
    if (this.outputFlush) {
      this.flushAgain = true
      return this.outputFlush
    }
    if (this.closed || this.stop.signal.aborted || !this.leaseActive()) return Promise.resolve()
    const work = (async () => {
      this.flushAgain = false
      let cursor = 0
      for (;;) {
        const rows = this.inbox.queuedReplies(100, cursor)
        if (!rows.length) return
        const groups = new Map<string, typeof rows>()
        for (const row of rows) {
          cursor = row.seq
          const group = groups.get(row.sessionId) ?? []
          group.push(row)
          groups.set(row.sessionId, group)
        }
        await Promise.all(
          [...groups].map(async ([sessionId, group]) => {
            const previous = this.sends.get(sessionId) ?? Promise.resolve()
            const pending = previous
              .catch(() => {})
              .then(async () => {
                for (const row of group) {
                  if (!this.leaseActive() || !this.owns({ id: sessionId, session: { id: sessionId } })) return
                  const receipt = this.inbox.receipt(row.sourceId)
                  if (!receipt || !row.draft) continue
                  try {
                    await this.deliver(
                      this.inbox,
                      { id: row.sourceId, receipt },
                      sessionId,
                      row.callId,
                      row.draft,
                      this.signalFor(sessionId)
                    )
                    this.errors.delete(sessionId)
                  } catch (error) {
                    this.errors.set(sessionId, String(error))
                    return
                  }
                }
              })
            this.sends.set(sessionId, pending)
            try {
              await pending
            } finally {
              if (this.sends.get(sessionId) === pending) this.sends.delete(sessionId)
            }
          })
        )
        if (rows.length < 100) return
      }
    })().finally(() => {
      if (this.outputFlush === work) this.outputFlush = undefined
      if (this.flushAgain && !this.closed && !this.stop.signal.aborted)
        void this.flushOutputs().catch((error) => this.errors.set('delivery', String(error)))
    })
    this.outputFlush = work
    return work
  }
  resolveReply(id: string, revision: string, decision: 'sent' | 'release'): void {
    const reply = this.inbox.pendingReply(id)
    if (!reply) throw new ChannelError('回复已结算，请刷新查看', 409)
    if (this.sends.has(reply.sessionId)) throw new ChannelError('此任务仍在交付，请等待真实发送结束', 409)
    this.inbox.resolveReply(id, revision, decision)
    void this.flushOutputs().catch((error) => this.errors.set(reply.sessionId, String(error)))
  }
  origin(agent: any, allowChild = false) {
    if (!this.owns(agent)) throw new ChannelError('任务授权已失效', 403)
    const rootId = this.memory().inspect(agent.id).binding.channel.task.rootSessionId
    if (!allowChild && agent.id !== rootId) throw new ChannelError('子智能体请将结果交给任务主会话', 403)
    const source = this.rootSource(rootId)
    if (!source) throw new ChannelError('任务原始请求未确认', 409)
    return source
  }
  async stopTask(taskId: string): Promise<void> {
    if (!this.rootSource(taskId) && !this.prepared.has(taskId)) throw new ChannelError('任务不存在', 404)
    this.stoppingRoots.add(taskId)
    if (!this.outputControllers.has(taskId)) this.outputControllers.set(taskId, new AbortController())
    this.outputControllers.get(taskId)!.abort(Error('任务交付已停止'))
    this.inbox.pauseOutputs(taskId)
    this.inbox.cancelTarget(taskId)
    this.inbox.cancelQueuedReplies(taskId)
    this.creation.get(taskId)?.abort(Error('任务已停止'))
    try {
      await this.opening.get(taskId)?.catch(() => undefined)
      // Restore native state for cancellation only. The task pre-step fence blocks any restored wake.
      if (this.rootSource(taskId) && !get(this.host, 'agents').get(taskId)) {
        const restored = await get(this.host, 'sessionController').resolveAgent(taskId)
        if (restored.error) throw new ChannelError('无法载入原任务以确认停止：' + restored.error.message, 409)
        this.created(restored.agent)
      }
      const actors = [...this.actors.values()].filter(
        (agent) =>
          get(this.host, 'agents').get(agent.id) === agent &&
          this.memory().inspect(agent.id).binding?.channel?.task?.rootSessionId === taskId
      )
      await stopNativeTaskActors(this.host, actors, this.stopping)
      await this.sends.get(taskId)?.catch(() => undefined)
      for (const agent of actors)
        if (!(await get(this.host, 'sessions').flush(agent.session)))
          throw new ChannelError('原生停止记录未确认保存', 503)
      await this.recoverOutputs(taskId)
      this.errors.delete('stop:' + taskId)
    } catch (error) {
      this.errors.set('stop:' + taskId, error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      this.stoppingRoots.delete(taskId)
    }
  }
  signalFor(taskId: string): AbortSignal {
    const controller = this.outputControllers.get(taskId)
    return controller ? AbortSignal.any([this.stop.signal, controller.signal]) : this.stop.signal
  }
  async prepareStep(agent: any, messages: any[]): Promise<boolean> {
    const rootId = this.memory().inspect(agent.id)?.binding?.channel?.task?.rootSessionId
    if (!rootId || this.stoppingRoots.has(rootId) || !this.owns(agent, true)) return false
    if (this.inbox.outputScan(rootId).paused || this.outputControllers.get(rootId)?.signal.aborted) {
      if (
        agent.id !== rootId ||
        !messages.some((message) => ['user', 'user-rpc'].includes(message.source?.kind))
      )
        return false
      await this.recoverOutputs(rootId)
      if (this.stoppingRoots.has(rootId) || !this.owns(agent, true)) return false
      this.inbox.resumeOutputs(rootId)
      this.outputControllers.set(rootId, new AbortController())
    }
    return this.owns(agent)
  }
  disposed(agent: any): void {
    if (this.actors.get(agent.id) === agent) this.actors.delete(agent.id)
  }
  async stopForRequester(taskId: string, conversationId: string, requesterId: string): Promise<void> {
    const source = typeof taskId === 'string' ? this.rootSource(taskId) : undefined
    if (
      !source ||
      source.receipt.source.conversationId !== conversationId ||
      source.receipt.source.actorId !== requesterId ||
      !this.authorized({ event: source.receipt.source, recipient: source.receipt.recipient })
    )
      throw new ChannelError('任务不属于当前成员和聊天，或原任务授权已变化', 403)
    await this.stopTask(taskId)
  }
  refreshAuthorization(): void {
    for (const agent of this.actors.values()) {
      const channel = this.memory().inspect(agent.id).binding?.channel
      if (
        channel?.task?.rootSessionId !== agent.id ||
        this.stoppingRoots.has(agent.id) ||
        this.outputControllers.get(agent.id)?.signal.aborted ||
        this.owns(agent)
      )
        continue
      void this.stopTask(agent.id).catch((error) => this.errors.set(agent.id, String(error)))
    }
    this.dispatch.schedule()
  }
  status(filter?: { conversationId: string; requesterId: string }) {
    const records = this.memory()
      .channelBindings(this.account.accountId, 'feishu')
      .filter(
        (r: any) =>
          r.channel.task?.rootSessionId === r.sessionId &&
          (!filter ||
            (r.channel.conversationId === filter.conversationId &&
              r.channel.task.requesterId === filter.requesterId))
      )
    return {
      total: records.length,
      partial: records.length > 100,
      records: records
        .slice(-100)
        .reverse()
        .map((r: any) => ({
          taskId: r.sessionId,
          requesterId: r.channel.task.requesterId,
          conversationId: r.channel.conversationId,
          personaId: r.personaId,
          state: get(this.host, 'agents').get(r.sessionId)?.status ?? 'stored',
          paused:
            this.outputControllers.get(r.sessionId)?.signal.aborted === true ||
            this.inbox.outputScan(r.sessionId).paused,
          stopping: this.stoppingRoots.has(r.sessionId),
          authorized: this.owns({ id: r.sessionId, session: { id: r.sessionId } })
        })),
      // Account-wide diagnostics are local UI data, never exported to a channel participant.
      ...(!filter
        ? {
            errors: [...this.errors].map(([id, error]) => ({ id, error })),
            receipts: this.inbox.counts(),
            queuedReplies: this.inbox.queuedReplies(20),
            replies: this.inbox.pendingReplies(20),
            connected: this.leaseActive(),
            receptionPaused: this.receptionPaused,
            pendingInteractions: this.interactions.list()
          }
        : {})
    }
  }
  dispose(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.disposal) return this.disposal
    const work = this.finishDispose().finally(() => {
      if (this.disposal === work) this.disposal = undefined
    })
    this.disposal = work
    return work
  }
  private async finishDispose(): Promise<void> {
    this.stop.abort(Error('渠道任务接入已停止'))
    this.interactions.dispose()
    await this.recovery?.catch(() => undefined)
    await Promise.allSettled([...this.outputScans.values()])
    await this.dispatch.dispose()
    await Promise.allSettled([...this.opening.values()])
    await stopNativeTaskActors(this.host, [...this.actors.values()], this.stopping)
    const settled = await Promise.allSettled([...this.handles.values()].map((h) => h.dispose()))
    await Promise.allSettled([...this.sends.values()])
    if (settled.some((r) => r.status === 'rejected')) throw new ChannelError('部分任务未完成停止', 503)
    this.inbox.close()
    this.closed = true
  }
}
