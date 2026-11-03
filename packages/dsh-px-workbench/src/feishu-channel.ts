import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ChannelInbox, type PendingChannelMessage } from '../../shared/channel-inbox'
import { ChannelDispatch } from '../../shared/channel-dispatch'
import { startFeishuConsumer } from '../../shared/feishu-consumer'
import { decideChannelAttention } from '../../shared/channel-attention'
import { ChannelError, type ChannelAccount } from './channel-settings'
import { nativeModelSelection } from '../../shared/native-model-selection'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const get = (ctx: any, key: string) => (ctx.get ? ctx.get(key) : ctx[key])
const pathKey = (value: string) => resolve(value).replaceAll('\\', '/').toLowerCase()

/** One account's native consumer and its owned native roots. It owns no model loop or task state. */
export class FeishuChannel {
  get accountId(): string {
    return this.account.accountId
  }
  readonly inbox: ChannelInbox
  readonly epoch = randomUUID()
  readonly dispatch: ChannelDispatch
  private readonly stop = new AbortController()
  private readonly consumerStop = new AbortController()
  private readonly borrowed = new Map<string, any>()
  private readonly tools = new Set<Promise<unknown>>()
  private closed = false
  private lease?: { dispose(): void }
  private readonly handles = new Map<string, any>()
  private readonly opening = new Map<string, Promise<any>>()
  private readonly failures = new Map<string, string>()
  constructor(
    private readonly host: any,
    private readonly account: ChannelAccount,
    private readonly current: () => ChannelAccount | undefined,
    directory: string
  ) {
    this.account = structuredClone(account)
    this.inbox = new ChannelInbox(
      join(directory, hash([account.accountId, account.fingerprint]) + '.sqlite'),
      {
        provider: 'feishu',
        accountId: account.accountId,
        fingerprint: account.fingerprint
      }
    )
    this.dispatch = new ChannelDispatch(this.inbox, this.epoch, {
      selection: (row) => this.selection(row),
      prepare: (row, signal) => this.prepare(row, signal),
      failed: (row, error) =>
        this.failures.set(row?.id ?? 'storage', error instanceof Error ? error.message : '投递失败')
    })
  }
  private memory() {
    return get(this.host, 'pxMemoryChannels')
  }
  private allowed(row?: PendingChannelMessage): boolean {
    const current = this.current()
    return (
      !this.stop.signal.aborted &&
      current?.enabled === true &&
      current.fingerprint === this.account.fingerprint &&
      current.personaId === this.account.personaId &&
      current.routeRevision === this.account.routeRevision &&
      (!row ||
        (row.recipient.personaId === current.personaId &&
          row.recipient.routeRevision === current.routeRevision)) &&
      get(this.host, 'pxPersonaResources')?.allowsChannel(current.personaId, 'feishu', current.accountId) ===
        true
    )
  }
  async start(): Promise<void> {
    if (!this.allowed()) throw new ChannelError('人格或渠道接收权限不可用', 403)
    this.lease = await startFeishuConsumer(
      get(this.host, 'dshIm'),
      { botId: this.account.accountId, fingerprint: this.account.fingerprint },
      this.inbox,
      {
        epoch: this.epoch,
        signal: this.consumerStop.signal,
        authorize: () => this.allowed(),
        destination: () => ({ personaId: this.account.personaId, routeRevision: this.account.routeRevision }),
        available: () => this.dispatch.schedule(),
        failed: (error) => {
          this.failures.set('consumer', String(error))
        }
      }
    )
  }
  private selection(row: PendingChannelMessage): 'wake' | 'context' | 'hold' {
    if (!this.allowed(row)) return 'hold'
    const attention = this.current()!.attention,
      choice = decideChannelAttention(attention, {
        conversationId: row.event.conversationId,
        kind: row.event.kind,
        mentioned: row.event.mentioned,
        self: false
      })
    if (choice.content === 'full') return 'wake'
    if (
      attention.mode === 'normal' &&
      this.inbox.hasPendingMention(row.event.conversationId) &&
      (!attention.mutedChats.includes(row.event.conversationId) || attention.mentionOverridesMute)
    )
      return 'context'
    return 'hold'
  }
  private sessionId(row: PendingChannelMessage): string {
    return (
      'px-channel-' +
      hash([this.account.accountId, this.account.fingerprint, row.event.conversationId, row.recipient])
    )
  }
  private async prepare(row: PendingChannelMessage, signal: AbortSignal) {
    if (!this.allowed(row)) throw new ChannelError('渠道路由已变化，旧消息没有转交新人格', 409)
    const id = this.sessionId(row)
    let pending = this.opening.get(id)
    if (!pending) {
      pending = this.open(row, signal).finally(() => this.opening.delete(id))
      this.opening.set(id, pending)
    }
    const agent = await pending
    await this.attachWorkspace(agent)
    return {
      agent,
      sessions: get(this.host, 'sessions'),
      validate: () => this.allowed(row) && this.owns(agent)
    }
  }
  private async open(row: PendingChannelMessage, signal: AbortSignal): Promise<any> {
    const id = this.sessionId(row),
      agents = get(this.host, 'agents'),
      memory = this.memory(),
      cwd = join(
        this.account.workspace,
        'feishu',
        hash([this.account.accountId, this.account.fingerprint, row.event.conversationId])
      ),
      channel = {
        provider: 'feishu',
        accountId: this.account.accountId,
        conversationId: row.event.conversationId,
        access: 'public',
        publicInstructions: this.account.publicInstructions,
        workspace: cwd
      }
    const live = agents.get(id)
    if (live) {
      if (!this.owns(live)) throw new ChannelError('原生会话归属不匹配', 409)
      this.borrowed.set(id, live)
      return live
    }
    const binding = memory.inspect(id)?.binding
    let existing: any
    try {
      existing = await get(this.host, 'sessionController').inspect(id)
    } catch (error: any) {
      if (error?.code !== 'session/not-found' && error?.constructor?.name !== 'ApiSessionNotFound')
        throw error
    }
    signal.throwIfAborted()
    if (
      existing &&
      (!binding ||
        binding.personaId !== row.recipient.personaId ||
        JSON.stringify(binding.channel) !== JSON.stringify(channel) ||
        pathKey(existing.meta.cwd ?? '') !== pathKey(cwd))
    )
      throw new ChannelError('已有原生会话与渠道归属不同，未重新绑定', 409)
    if (binding && !binding.pending && !existing)
      throw new ChannelError('原生会话已不存在，需要明确新建接续会话', 409)
    memory.bind(id, row.recipient.personaId, channel)
    mkdirSync(cwd, { recursive: true })
    const route = get(this.host, 'agentDefaultModel').currentSelection()
    if (!route?.provider || !route?.model) throw new ChannelError('请先在原生设置中选择默认模型', 409)
    const setup = async (ctx: any) => {
      await get(this.host, 'agentPresets').mount(ctx, 'px-channel-public')
      const { installModelSelection } = await import('@deepseek-ai/dsh-agent')
      ctx.effect(
        () => installModelSelection(ctx, nativeModelSelection(this.host, id, route)),
        'channels: native model selection'
      )
      return {
        commit: () => {
          signal.throwIfAborted()
          if (!this.allowed(row)) throw new ChannelError('创建期间渠道授权已变化', 409)
        }
      }
    }
    const handle = await agents.withoutInitiator(() =>
      existing
        ? agents.resume({ resumeSessionId: id, agentOptions: route, signal, setup })
        : agents.create({
            sessionId: id,
            agentOptions: route,
            meta: { cwd, agentPreset: 'px-channel-public' },
            signal,
            setup
          })
    )
    this.handles.set(id, handle)
    if (signal.aborted || !this.allowed(row)) {
      await handle.dispose()
      this.handles.delete(id)
      signal.throwIfAborted()
      throw new ChannelError('渠道已停止', 409)
    }
    memory.bind(id, row.recipient.personaId, channel)
    if (!(await get(this.host, 'sessions').flush(handle.agent.session)))
      throw new ChannelError('原生会话未持久保存', 503)
    const titles = get(this.host, 'sessionTitle')
    if (!existing && titles && !titles.get(handle.agent.session))
      titles.rename(handle.agent.session, '飞书 · ' + row.event.conversationId)
    return handle.agent
  }
  private async attachWorkspace(agent: any): Promise<void> {
    const registry = get(this.host, 'workspaceRegistry')
    // Respect an existing native workspace association, including one the user moved manually.
    if (registry.list().some((workspace: any) => workspace.sessionIds?.includes(agent.session.id))) return
    const cwd = agent.session.header.cwd
    await get(this.host, 'workspaceController').create({ path: cwd })
    const workspace = registry.list().find((row: any) => pathKey(row.path) === pathKey(cwd))
    if (!workspace?.attachSession) throw new ChannelError('原生工作区挂接不可用', 503)
    await workspace.attachSession(agent.session.id)
  }
  owns(agent: any): boolean {
    const binding = this.memory().inspect(agent?.session.id)?.binding,
      channel = binding?.channel
    return (
      !!binding &&
      !binding.pending &&
      binding.personaId === this.account.personaId &&
      channel?.provider === 'feishu' &&
      channel.accountId === this.account.accountId &&
      channel.access === 'public' &&
      !channel.task &&
      agent.session.id ===
        this.sessionId({
          event: { conversationId: channel.conversationId },
          recipient: { personaId: binding.personaId, routeRevision: this.account.routeRevision }
        } as PendingChannelMessage)
    )
  }
  private origin(agent: any) {
    if (!this.allowed() || !this.owns(agent)) throw new ChannelError('渠道会话已停止或归属变化', 403)
    const events = agent.session.snapshotEvents()
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event.type === 'turn/start') break
      if (event.type !== 'user/message' || event.data.source?.kind !== 'plugin:dsh-px-channel') continue
      const receipt = this.inbox.receipt(event.data.source.ingressId)
      if (
        receipt?.phase === 'admitted' &&
        receipt.claim?.sessionId === agent.session.id &&
        receipt.nativeMessageId === event.data.id
      )
        return { id: event.data.source.ingressId, receipt }
    }
    throw new ChannelError('当前轮没有已验证的渠道消息，未执行跨渠道操作', 403)
  }
  tool(name: string, args: any, exec: any): Promise<unknown> {
    const work = this.performTool(name, args, exec)
    this.tools.add(work)
    void work.finally(() => this.tools.delete(work)).catch(() => {})
    return work
  }
  private async performTool(name: string, args: any, exec: any): Promise<unknown> {
    const { id, receipt } = this.origin(exec.agent),
      signal = AbortSignal.any([exec.signal, this.stop.signal]),
      native = get(this.host, 'dshIm'),
      options = { expectedFingerprint: this.account.fingerprint, signal }
    signal.throwIfAborted()
    if (name === 'channel_memory') return this.memory().conversationNotes(exec.agent.session.id, args, signal)
    if (name === 'channel_knowledge')
      return this.memory().sharedKnowledge(exec.agent.session.id, exec.agent.session.header.cwd, args)
    if (name === 'channel_history')
      return native.historyChecked(
        this.account.accountId,
        receipt.source.reply,
        { ...args, limit: args.limit ?? 10 },
        options
      )
    if (name !== 'channel_reply') throw new ChannelError('未知渠道工具')
    if (args.action === 'silent') {
      if (args.text !== undefined) throw new ChannelError('旁听不发送正文')
      return { sent: false, decision: 'silent' }
    }
    if (
      args.action !== 'text' ||
      typeof args.text !== 'string' ||
      !args.text.trim() ||
      args.text.length > 2000
    )
      throw new ChannelError('请提供简短回复正文')
    const call = exec.agent.session
      .snapshotEvents()
      .findLast(
        (event: any) => event.type === 'tool/call' && event.data.callId === (exec.rootCallId ?? exec.callId)
      )
    if (!call || !Number.isSafeInteger(call.seq)) throw new ChannelError('回复缺少原生工具调用依据', 403)
    // Provider call IDs can be reused in another model request; native event sequence scopes this invocation.
    const intent = this.inbox.beginReply(
      JSON.stringify([call.seq, exec.callId]),
      id,
      exec.agent.session.id,
      args.text
    )
    if (intent.phase === 'sent') return intent.result
    if (intent.phase !== 'new') throw new ChannelError('此前回复未确认，不会自动重复发送', 409)
    try {
      const result = await native.replyChecked(
        this.account.accountId,
        receipt.source.reply,
        args.text,
        options
      )
      if (result?.sent !== true || typeof result.messageId !== 'string' || !result.messageId)
        throw new ChannelError('原生回复未返回明确回执', 503)
      this.inbox.finishReply(intent.id, 'sent', { sent: true, messageId: result.messageId })
      return { sent: true, messageId: result.messageId }
    } catch (error: any) {
      try {
        this.inbox.finishReply(
          intent.id,
          [
            'stale-route',
            'bad-request',
            'account-changed',
            'bot-not-connected',
            'capability-unavailable'
          ].includes(error?.code)
            ? 'refused'
            : 'uncertain',
          { code: error?.code ?? 'unknown' }
        )
      } catch {}
      throw error
    }
  }
  status() {
    return {
      accountId: this.account.accountId,
      accepting: !!this.lease && !this.stop.signal.aborted,
      leaseHeld: !!this.lease,
      pending: this.inbox.pending(20).map((row) => ({
        id: row.id,
        conversationId: row.event.conversationId,
        personaId: row.recipient.personaId,
        preview: row.event.text.slice(0, 160)
      })),
      failures: [...this.failures].map(([id, error]) => ({ id, error })),
      blocked: this.dispatch.blockedIds()
    }
  }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.stop.abort(Error('渠道接收已停止'))
    await this.dispatch.dispose()
    await Promise.allSettled([...this.opening.values()])
    for (const agent of this.borrowed.values()) agent.cancel({ kind: 'user' })
    const results = await Promise.allSettled(
      [...this.handles.values()]
        .map((handle) => handle.dispose())
        .concat([...this.borrowed.values()].map((agent) => agent.whenIdle()))
    )
    await Promise.allSettled([...this.tools])
    if (results.some((result) => result.status === 'rejected'))
      throw new ChannelError('部分原生渠道会话尚未完成停止，请检查宿主状态', 503)
    this.consumerStop.abort()
    this.lease?.dispose()
    this.lease = undefined
    this.handles.clear()
    this.borrowed.clear()
    this.inbox.close()
    this.closed = true
  }
}
