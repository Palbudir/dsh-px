import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { channelFor, conversation, messageSource, taskRequester, QqError, type QqSettings } from './policy'
import type { SessionChannel } from '../../dsh-px-memory/src/store'
import { QqReceipts, QqReceiptStorageError, receiptKey, type AdmissionMetadata } from './receipts'
import { qqMessageOrigin } from '../../shared/channel-source'
import { QqInteractions } from './interactions'
import { QqGroupTasks, installGroupTaskAudience } from './group-tasks'

interface Caller {
  chatId: string
  senderId: string
  messageId: string
  directText?: boolean
  admission?: { sessionId: string; messageId: string }
}
interface BridgePort {
  receive(event: unknown): Promise<void>
  send(chatId: string, text: string): Promise<unknown>
  chat?(chatId: string): any
  reset?(chatId: string): Promise<void>
  adopt?(chatId: string, sessionId: string): Promise<any>
  flush?(): Promise<void>
  message?(input: any): any
  scope?(ctx: any, sessionId: string, chatId: string): void
  model?(ctx: any, sessionId: string): void
  recordedPreset?(sessionId: string): Promise<string | undefined>
  attachWorkspace?(sessionId: string, cwd: string): Promise<void>
}
const get = (ctx: any, name: string): any => ctx.get?.(name) ?? ctx[name]

/** A scoped adapter around native Agent, tool visibility, permissions and memory contracts. */
export class QqSessionPolicy {
  private readonly caller = new AsyncLocalStorage<Caller>()
  private readonly toolCall = new AsyncLocalStorage<any>()
  private readonly interactions: QqInteractions
  private readonly groupTasks: QqGroupTasks
  private bridge?: BridgePort
  private disposed = false
  private writeProblem = false
  private recovering = false
  private recoveryFailed = false
  private deliveryProblem = false
  private connection: any
  private generation = 0
  private healthTimer?: ReturnType<typeof setTimeout>
  private ready: Promise<boolean> = Promise.resolve(false)
  private connectionState: {
    state: 'connecting' | 'online' | 'offline' | 'error'
    message: string
    nickname?: string
  } = {
    state: 'connecting',
    message: '正在连接本机 QQ 桥'
  }
  constructor(
    private readonly host: any,
    readonly settings: QqSettings,
    private readonly receipts: QqReceipts
  ) {
    this.groupTasks = new QqGroupTasks(
      host,
      settings,
      () => this.bridge,
      (id) => this.canRunGroupTask(id),
      () => {
        this.deliveryProblem = true
      }
    )
    this.interactions = new QqInteractions(async (chatId, text) => {
      if (!this.bridge || this.disposed) throw new QqError('QQ 连接已关闭', 409)
      return this.bridge.send(chatId, text)
    })
  }

  attach(bridge: BridgePort): void {
    this.bridge = bridge
  }
  bindConnection(connection: any): void {
    this.connection = connection
  }
  connectionStatus(connected: boolean): void {
    clearTimeout(this.healthTimer)
    const generation = ++this.generation
    if (!connected || this.disposed) {
      this.connectionState = { state: 'offline', message: 'QQ 桥已断开，正在等待重新连接' }
      this.ready = Promise.resolve(false)
      return
    }
    if (this.connectionState.state !== 'online')
      this.connectionState = { state: 'connecting', message: '正在核对 QQ 登录账号' }
    this.ready = Promise.resolve().then(async () => {
      try {
        const [identity, status] = await Promise.all([
          this.connection.call('get_login_info', {}),
          this.connection.call('get_status', {})
        ])
        if (generation !== this.generation || this.disposed) return false
        if (String(identity?.user_id) !== this.settings.accountId)
          throw new QqError('QQ 桥登录的账号与当前设置不一致，消息未被处理')
        if (status?.online !== true || status?.good === false) throw new QqError('QQ 账号不在线')
        this.connectionState = {
          state: 'online',
          message: '已连接，可接收私聊和群内 @',
          nickname: String(identity.nickname ?? '').slice(0, 100)
        }
        return true
      } catch {
        if (generation === this.generation)
          this.connectionState = {
            state: 'error',
            message: 'QQ 账号未在线或核对未通过，请检查桥接登录及账号设置'
          }
        return false
      } finally {
        if (generation === this.generation && !this.disposed) {
          this.healthTimer = setTimeout(() => this.connectionStatus(true), 30000)
          this.healthTimer.unref?.()
        }
      }
    })
  }
  snapshot() {
    return this.writeProblem
      ? {
          state: 'error',
          message: 'QQ 接续记录未能保存，新请求已暂停。请重试保存后重新发送未受理的消息。',
          persistenceBlocked: true
        }
      : this.deliveryProblem
        ? {
            state: 'error',
            message: '上次群任务结果未确认送达。原生记录保留，请核对原群与客户端中的任务记录；未自动重发。',
            persistenceBlocked: false
          }
        : { ...this.connectionState, persistenceBlocked: false }
  }
  persistenceError(_error: unknown): void {
    const first = !this.writeProblem
    this.writeProblem = true
    if (this.recovering) this.recoveryFailed = true
    if (first && !this.disposed && this.bridge)
      void this.bridge
        .send(
          'private:' + this.settings.authorizedUsers[0],
          'QQ 接续记录保存失败，新的请求已暂停。请在 DSH-PX 的“QQ 账号”设置中重试保存；不要重复执行结果不明确的任务。'
        )
        .catch(() => {})
  }
  async retryPersistence(): Promise<void> {
    if (this.disposed || !this.bridge?.flush) throw new QqError('QQ 接入未就绪', 409)
    if (this.recovering) throw new QqError('正在重试保存，请稍候', 409)
    this.recovering = true
    this.recoveryFailed = false
    try {
      await this.bridge.flush()
      await this.receipts.repair()
      if (this.recoveryFailed) throw new QqError('接续记录仍未保存，请检查磁盘与目录是否可写', 503)
      this.writeProblem = false
    } finally {
      this.recovering = false
    }
  }
  async sendTest(): Promise<void> {
    this.assertActive()
    if (!(await this.ready) || !this.bridge) throw new QqError('QQ 尚未连接，未发送测试消息', 409)
    await this.bridge.send(
      'private:' + this.settings.authorizedUsers[0],
      'DSH-PX 连接测试：普通 QQ 账号已连接。请回复一句话，以确认模型也能正常回答。'
    )
  }
  dispose(): Promise<void> {
    this.disposed = true
    this.generation++
    clearTimeout(this.healthTimer)
    this.interactions.dispose()
    const done = this.groupTasks.dispose()
    this.bridge = undefined
    return done
  }
  pendingInteractions() {
    return this.interactions.list()
  }
  runTool(exec: any, next: () => Promise<unknown>): Promise<any> {
    this.assertActive()
    if (!this.isExecutionSession(exec.agent?.session.id))
      throw new QqError('QQ 工具调用缺少有效的授权私聊身份', 403)
    return this.toolCall.run(exec, next)
  }
  beforeConnectionCall(action?: string, params?: any, chatId?: string): void {
    const exec = this.toolCall.getStore()
    if (!exec) return
    exec.signal.throwIfAborted()
    this.assertActive()
    if (!this.isExecutionSession(exec.agent?.session.id))
      throw new QqError('QQ 工具的调用身份已失效，未发送请求', 403)
    const origin = this.chatForSession(exec.agent?.session.id)
    if (
      (chatId && chatId !== origin) ||
      (params?.group_id !== undefined && 'group:' + String(params.group_id) !== origin) ||
      (params?.user_id !== undefined &&
        'private:' + String(params.user_id) !== origin &&
        !(
          action === 'get_group_member_info' &&
          params?.group_id !== undefined &&
          'group:' + String(params.group_id) === origin
        ))
    )
      throw new QqError('QQ 工具只能访问或交付当前聊天，不能指定其他收件人', 403)
    if (action && !params?.group_id && !params?.user_id && action.startsWith('send_') && !chatId)
      throw new QqError('无法确认 QQ 发送目标，未发送', 403)
  }
  connectionSignal(): AbortSignal | undefined {
    return this.toolCall.getStore()?.signal
  }
  answerInteraction(input: any): string {
    this.assertActive()
    const pending = this.interactions.list().find((p) => p.id === input.id)
    if (!pending || !this.isExecutionSession(pending.sessionId))
      throw new QqError('请求已失效或已撤销授权', 409)
    return this.interactions.respond(pending.chatId, input)
  }
  interaction(kind: 'approval' | 'question', request: any, next: () => Promise<unknown>): Promise<any> {
    const sessionId = request.agent?.session.id
    if (!sessionId || !this.isExecutionSession(sessionId) || this.connectionState.state !== 'online')
      return next()
    const channel = this.memory().inspect(sessionId).binding.channel
    return this.interactions.request(kind, request, channel.conversationId, next)
  }
  private assertActive(): void {
    if (this.disposed) throw new QqError('QQ 连接已停止，请重新发送请求', 409)
    if (this.writeProblem || this.recovering) throw new QqError('QQ 接续存储未就绪，未受理新的请求', 503)
  }
  private memory(): any {
    const service = get(this.host, 'pxMemoryChannels')
    if (service?.version !== 1) throw new QqError('当前 Pack 缺少配套的 QQ 人格与权限接口', 503)
    return service
  }
  async receive(event: any, next: () => Promise<void>): Promise<void> {
    this.assertActive()
    if (!(await this.ready)) throw new QqError('QQ 登录账号尚未核对，未处理此消息', 503)
    if (String(event?.self_id) !== this.settings.accountId)
      throw new QqError('OneBot 登录账号与设置不一致，未处理消息', 403)
    if (event.post_type !== 'message' || !['private', 'group'].includes(event.message_type)) return
    if (JSON.stringify(event).length > 256000) throw new QqError('QQ 消息过大，请拆分文字或使用文件', 413)
    if (event.message_type === 'group') {
      const mentioned = Array.isArray(event.message)
        ? event.message.some(
            (segment: any) => segment?.type === 'at' && String(segment.data?.qq) === this.settings.accountId
          )
        : typeof event.message === 'string' &&
          event.message.includes('[CQ:at,qq=' + this.settings.accountId + ']')
      if (!mentioned) return
    }
    const chatId =
      event.message_type === 'group' ? 'group:' + String(event.group_id) : 'private:' + String(event.user_id)
    const senderId = String(event.user_id)
    const messageId =
      typeof event.message_id === 'string' || typeof event.message_id === 'number'
        ? String(event.message_id)
        : ''
    if (!/^[A-Za-z0-9:_.-]{1,120}$/.test(messageId)) throw new QqError('QQ 消息缺少稳定标识，未受理请求', 400)
    messageSource(this.settings, chatId, senderId, messageId)
    try {
      await this.receipts.once(receiptKey('inbound', [this.settings.accountId, chatId, messageId]), () =>
        this.caller.run(
          {
            chatId,
            senderId,
            messageId,
            directText: Array.isArray(event.message)
              ? event.message.every((part: any) => ['text', 'reply', 'at'].includes(part?.type))
              : typeof event.message === 'string' && !event.message.includes('[CQ:')
          },
          async () => {
            await next()
            const admitted = this.caller.getStore()?.admission
            if (admitted) await this.flushAdmission(admitted)
            return admitted
          }
        )
      )
    } catch (error) {
      if (error instanceof QqReceiptStorageError) this.persistenceError(error)
      if (this.bridge && !this.disposed)
        await this.bridge
          .send(
            chatId,
            error instanceof QqError
              ? error.message
              : '这条 QQ 消息未能确认处理完成，请在客户端查看任务状态；不要重复执行结果不明确的任务。'
          )
          .catch(() => {})
      throw error
    }
  }
  source(chatId: string): unknown {
    this.assertActive()
    const caller = this.caller.getStore()
    if (!caller || caller.chatId !== chatId) throw new QqError('缺少可信 QQ 发送者，未投递消息', 403)
    return messageSource(this.settings, chatId, caller.senderId, caller.messageId)
  }
  admitted(chatId: string, sessionId: string, messageId: string): void {
    const caller = this.caller.getStore()
    if (caller?.chatId === chatId) caller.admission = { sessionId, messageId }
  }
  prepareSession(sessionId: string, chatId: string): void {
    this.assertActive()
    const expected = channelFor(this.settings, chatId),
      memory = this.memory()
    const existing = memory.inspect(sessionId).binding
    if (existing) {
      const channel: SessionChannel | undefined = existing.channel
      if (
        !channel ||
        channel.provider !== 'qq' ||
        channel.accountId !== expected.accountId ||
        channel.conversationId !== chatId ||
        channel.access !== expected.access
      )
        throw new QqError('会话的 QQ 身份或授权已变化，需要新建会话', 409)
      // A changed default persona or public introduction applies only to future conversations.
      memory.bind(sessionId, existing.personaId, channel)
    } else memory.bind(sessionId, this.settings.personaId, expected)
  }
  labelSession(agent: any, chatId: string, nickname: string): void {
    const titles = get(this.host, 'sessionTitle')
    if (!titles) return
    try {
      if (titles.get(agent.session)) return
      const chat = conversation(chatId)
      const label = String(nickname ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, 40)
      titles.rename(
        agent.session,
        chat.kind === 'group' ? 'QQ 群 ' + chat.peer : 'QQ 私聊 ' + chat.peer + (label ? ' · ' + label : '')
      )
    } catch {
      get(this.host, 'logger')?.warn?.('QQ 会话名称暂未更新；原生会话与消息保留。')
    }
  }
  preset(chatId: string): string | undefined {
    return channelFor(this.settings, chatId).access === 'public' ? 'px-qq-public' : undefined
  }
  isOwnerSession(sessionId: string | undefined): boolean {
    if (this.disposed || typeof sessionId !== 'string' || !sessionId) return false
    const channel = this.memory().inspect(sessionId).binding?.channel
    return (
      channel?.provider === 'qq' &&
      channel.accountId === this.settings.accountId &&
      channel.access === 'owner' &&
      channelFor(this.settings, channel.conversationId).access === 'owner'
    )
  }
  canRunGroupTask(sessionId: string | undefined): boolean {
    if (this.disposed || this.writeProblem || typeof sessionId !== 'string') return false
    const binding = this.memory().inspect(sessionId).binding,
      channel = binding?.channel
    if (
      !channel?.task ||
      channel.accountId !== this.settings.accountId ||
      channel.access !== 'public' ||
      !channel.conversationId.startsWith('group:') ||
      !this.settings.authorizedUsers.includes(channel.task.requesterId)
    )
      return false
    const root = this.memory().inspect(channel.task.rootSessionId).binding?.channel
    return (
      root?.task?.rootSessionId === channel.task.rootSessionId &&
      root.task.requesterId === channel.task.requesterId &&
      root.accountId === channel.accountId &&
      root.conversationId === channel.conversationId
    )
  }
  isExecutionSession(sessionId: string | undefined): boolean {
    return this.isOwnerSession(sessionId) || this.canRunGroupTask(sessionId)
  }
  chatForSession(sessionId: string): string | undefined {
    return this.isExecutionSession(sessionId)
      ? this.memory().inspect(sessionId).binding.channel.conversationId
      : undefined
  }
  workspace(chatId: string): string {
    const path = channelFor(this.settings, chatId).workspace ?? this.settings.workspace
    mkdirSync(path, { recursive: true })
    return path
  }
  created(agent: any): void {
    this.memory().inherit?.(agent.session.id, agent.session.header.parentSession)
    const { binding, persona } = this.memory().inspect(agent.session.id)
    if (!binding?.channel?.task) return
    if (!this.canRunGroupTask(agent.session.id)) throw new QqError('此群任务的授权已撤销', 403)
    this.memory().bind(agent.session.id, binding.personaId, binding.channel)
    this.groupTasks.created(agent)
    installGroupTaskAudience(agent.ctx, binding.channel, persona.name)
    this.bridge?.scope?.(agent.ctx, agent.session.id, binding.channel.conversationId)
  }
  event(session: any, event: any): void {
    this.groupTasks.event(session, event)
  }
  async borrow(agent: any, setup: (ctx: any) => void): Promise<{ agent: any; dispose(): Promise<void> }> {
    this.assertActive()
    const binding = this.memory().inspect(agent.session.id).binding
    if (binding?.channel?.provider !== 'qq' || binding.channel.accountId !== this.settings.accountId)
      throw new QqError('不能接管其他渠道的会话', 403)
    if (
      binding.channel.access === 'public' &&
      get(this.host, 'agentPresets').composedPreset(agent.ctx) !== 'px-qq-public'
    )
      throw new QqError('目标公共会话未使用配套权限预设，请新建会话', 409)
    const overlay = agent.ctx.plugin({
      name: 'px-qq-session-overlay',
      inject: ['tools', 'systemPrompt'],
      apply: setup
    })
    await overlay
    // The native controller keeps its writer. QQ owns only this disposable capability overlay.
    return {
      agent,
      dispose: async () => {
        await overlay.dispose()
      }
    }
  }
  async selectModel(agent: any, route: any): Promise<void> {
    this.assertActive()
    const policy = get(this.host, 'pxContextPolicy')
    if (!policy?.select) throw new QqError('模型分档校验不可用，请检查配套 Pack', 503)
    const controller = get(this.host, 'sessionController')
    if (typeof controller?.selectModelForSession !== 'function')
      throw new QqError('此客户端尚不支持仅切换 QQ 会话模型，请先更新客户端；全局默认模型未改变', 409)
    await policy.select(agent, route)
    await controller.selectModelForSession({ sessionId: agent.session.id, ...route })
  }
  modelSelection(sessionId: string, fallback: any): any {
    const host = this.host
    return {
      assembled: undefined,
      get current() {
        const session = get(host, 'sessions')?.get(sessionId)
        const pending =
          session && get(host, 'sessionProjections')?.stateOf(session, 'modelSelection')?.pending
        if (pending) return { ...pending }
        const header = session?.requestHeader?.()
        if (header)
          return {
            provider: header.config.provider,
            model: header.config.model,
            ...(header.config.reasoningEffort !== undefined &&
            header.adapterDefaults?.reasoningEffort !== true
              ? { reasoningEffort: header.config.reasoningEffort }
              : {})
          }
        return fallback
      },
      set current(value: any) {
        fallback = value
      }
    }
  }
  defaultModel(fallback: any): any {
    return this.settings.model ? { ...this.settings.model } : fallback
  }
  async command(chatId: string, raw: string, sender: string): Promise<boolean> {
    this.assertActive()
    const text = raw.replace(new RegExp('^@' + this.settings.accountId + '\\s*'), '').trim()
    const match = /^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i.exec(text)
    if (!this.bridge) return false
    if (!match) {
      if (
        chatId.startsWith('group:') &&
        this.caller.getStore()?.directText &&
        this.settings.authorizedUsers.includes(sender)
      ) {
        const pending = this.interactions
          .list()
          .filter(
            (p) =>
              p.chatId === chatId &&
              this.memory().inspect(p.sessionId).binding?.channel?.task?.requesterId === sender &&
              this.canRunGroupTask(p.sessionId)
          )
        const sessions = [...new Set(pending.map((p) => p.sessionId))]
        if (sessions.length === 1) {
          const answer = this.interactions.answerPlain(chatId, sessions[0], text)
          if (answer !== undefined) {
            await this.bridge.send(chatId, answer)
            return true
          }
        }
      }
      const current = this.bridge.chat?.(chatId)
      if (
        this.caller.getStore()?.directText &&
        this.settings.authorizedUsers.includes(sender) &&
        channelFor(this.settings, chatId).access === 'owner' &&
        current &&
        this.isOwnerSession(current.sessionId)
      ) {
        const answer = this.interactions.answerPlain(chatId, current.sessionId, text)
        if (answer !== undefined) {
          await this.bridge.send(chatId, answer)
          return true
        }
      }
      return false
    }
    const command = match[1].toLowerCase(),
      args = (match[2] ?? '').trim()
    const owner = this.settings.authorizedUsers.includes(sender)
    const channel = channelFor(this.settings, chatId)
    if (['approve', 'reject', 'answer'].includes(command)) {
      if (!owner) {
        await this.bridge.send(chatId, '确认和回答只接受已授权成员操作。')
        return true
      }
      const match = command === 'answer' ? /^(Q[a-f0-9]{10})\s+([1-9]\d*)\s+([\s\S]+)$/.exec(args) : null
      const input =
        command === 'answer'
          ? { id: match?.[1] ?? '', question: Number(match?.[2]), answer: match?.[3] }
          : { id: args, decision: command === 'approve' ? 'allowed-once' : 'rejected' }
      const pending = this.interactions.list().find((p) => p.id === input.id && p.chatId === chatId)
      const audience = pending && this.memory().inspect(pending.sessionId).binding?.channel
      if (
        !pending ||
        !this.isExecutionSession(pending.sessionId) ||
        (audience?.task && audience.task.requesterId !== sender)
      )
        throw new QqError('此请求已失效或不属于你的授权任务', 403)
      await this.bridge.send(chatId, this.interactions.respond(chatId, input))
      return true
    }
    if (command === 'model' && /(?:^|\s)--default(?:\s|$)/.test(args)) {
      await this.bridge.send(
        chatId,
        'QQ 命令不会修改 DSH 的全局默认模型。请在“设置 → QQ 账号”选择 QQ 默认模型；当前配置未改变。'
      )
      return true
    }
    if (command === 'help') {
      const modelHelp =
        typeof get(this.host, 'sessionController')?.selectModelForSession === 'function'
          ? '/model 选择同档模型、/continue 提供商 模型 新建接续会话、'
          : '本会话模型切换需要更新配套客户端；'
      await this.bridge.send(
        chatId,
        '可以私聊或在群里 @ 我。普通交流只使用公开介绍、当前聊天和共享知识。\n' +
          '获授权成员可在私聊安排任务，或在群里使用 /task 内容；任务结果留在发起的聊天。群任务只使用本群和共享资料，私有资料需明确分享。\n' +
          '群内 @ 后可用 /task 继续任务、/newtask 新建任务会话、/status 看群任务、/stop 停止；原生问题和审批也在原群处理。\n' +
          '负责人私聊命令：/new 新会话、/stop 停止、' +
          modelHelp +
          '/status 查看状态。\n' +
          '单个问题可以直接回复选项或文字；工具审批或多个问题按 /approve、/reject、/answer 编号操作。普通“好的”不会被当成工具审批。'
      )
      return true
    }
    if (command === 'task') {
      if (!owner) await this.bridge.send(chatId, '你可以与我交流；本机任务和私有资料仅向已授权成员提供。')
      else if (!args)
        await this.bridge.send(
          chatId,
          '用法：/task 要完成的事情。结果留在当前聊天；群任务不会自动读取私有资料。'
        )
      else {
        const caller = this.caller.getStore()
        if (!caller || caller.senderId !== sender || caller.chatId !== chatId)
          throw new QqError('缺少原始 QQ 请求身份', 403)
        await this.transfer(
          receiptKey('direct-task', [this.settings.accountId, chatId, caller.messageId]),
          sender,
          args,
          new AbortController().signal,
          chatId
        )
        await this.bridge.send(
          chatId,
          '已交给本聊天的原生任务会话，结果留在这里。用 /stop 停止；重复投递不会重跑。'
        )
      }
      return true
    }
    if (channel.access === 'public') {
      if (command === 'newtask' && owner && chatId.startsWith('group:')) {
        await this.groupTasks.newSession(chatId, sender)
        await this.bridge.send(
          chatId,
          '已新建你的群任务会话，采用当前默认人格与模型。旧记录保留；用 /task 发送新要求。'
        )
        return true
      }
      if (command === 'stop' && owner && chatId.startsWith('group:')) {
        await this.groupTasks.stop(chatId)
        await this.bridge.send(chatId, '已请求停止本群的任务和排队请求。')
        return false
      }
      if (command === 'status')
        await this.bridge.send(
          chatId,
          owner && chatId.startsWith('group:')
            ? this.groupTasks.status(chatId)
            : '当前为公共交流会话；本机任务需由授权成员发起。'
        )
      else if (['new', 'stop'].includes(command) && owner) return false
      else
        await this.bridge.send(
          chatId,
          owner
            ? '请在与你的私聊中使用此管理命令；群聊不会显示私有工作区或任务信息。'
            : '此管理命令仅向已授权成员提供；普通交流可以直接发送。'
        )
      return true
    }
    if (command === 'continue') {
      const controller = get(this.host, 'sessionController')
      if (typeof controller?.selectModelForSession !== 'function')
        throw new QqError('请先更新客户端以使用 QQ 模型接续；原会话与默认模型均未改变', 409)
      const [provider, model, extra] = args.split(/\s+/)
      const chat = this.bridge.chat?.(chatId)
      if (!provider || !model || extra || !chat) {
        await this.bridge.send(chatId, '用法：/continue 提供商ID 模型ID。先在本会话完成至少一轮交流。')
        return true
      }
      if (chat.agent.status === 'running')
        throw new QqError('请先等待当前任务结束，或用 /stop 停止后再接续', 409)
      await get(this.host, 'llm').resolveModelInfo(provider, model)
      const persona = this.memory().inspect(chat.sessionId).persona
      const sessionId = await this.memory().continue(chat.sessionId, {
        requestId: randomUUID(),
        personaId: persona.id,
        handoff: true
      })
      this.assertActive()
      await controller.selectModelForSession({ sessionId, provider, model })
      this.assertActive()
      const adopted = await this.bridge.adopt?.(chatId, sessionId)
      if (!adopted?.ok) throw new QqError('接续会话已保存但尚未绑定 QQ，请在客户端查看，未发送新消息', 409)
      await this.bridge.send(
        chatId,
        '已新建接续会话并选择 ' + provider + '/' + model + '。原会话保留，接下来可继续发送消息。'
      )
      return true
    }
    return false
  }
  /** Public restrictions are owned by the native preset, including GUI-created Agents. */
  installScope(ctx: any, sessionId: string, chatId: string): boolean {
    this.prepareSession(sessionId, chatId)
    const channel = this.memory().inspect(sessionId).binding.channel
    if (channel.access === 'public' && !channel.task) return true
    ctx.tools.guard((exec: any) => {
      if (!String(exec.name).startsWith('qq_')) return undefined
      if (!this.isExecutionSession(exec.agent?.session.id)) return 'QQ 工具仅供该账号的授权私聊或群任务使用'
      const origin = this.chatForSession(exec.agent?.session.id)
      if (exec.arguments?.chat_id && exec.arguments.chat_id !== origin)
        return '只能交付当前聊天，不能指定其他收件人'
      if (this.canRunGroupTask(exec.agent?.session.id) && exec.name === 'qq_napcat_api')
        return '群任务不开放跨聊天原始 API；请使用当前群的历史、图片或文件工具。'
      if (
        exec.name === 'qq_napcat_api' &&
        ['upload_group_file', 'upload_private_file'].includes(exec.arguments?.action)
      )
        return '请使用 qq_send_file；它会核对文件是否位于当前工作区或媒体目录。'
      return undefined
    })
    return false
  }
  canDelegate(exec: any, channel: SessionChannel): boolean {
    return (
      !this.disposed &&
      !this.writeProblem &&
      !this.recovering &&
      this.connectionState.state === 'online' &&
      !!taskRequester(this.settings, channel, exec.agent?.session.snapshotEvents() ?? [])
    )
  }
  delegate(exec: any, channel: SessionChannel): Promise<unknown> {
    if (!this.canDelegate(exec, channel)) throw new QqError('当前轮没有任务授权，未投递任务', 403)
    return this.requestTask(exec, channel)
  }
  private async requestTask(exec: any, channel: SessionChannel): Promise<unknown> {
    this.assertActive()
    exec.signal.throwIfAborted()
    const events = exec.agent?.session.snapshotEvents() ?? []
    const sender = taskRequester(this.settings, channel, events)
    if (!sender || !this.bridge) throw new QqError('此请求没有任务授权', 403)
    let start = events.length - 1
    while (start >= 0 && events[start].type !== 'turn/start') start--
    const text = events
      .slice(start + 1)
      .filter((e: any) => e.type === 'user/message' && e.data?.source?.kind === 'plugin:dsh-onebot')
      .flatMap((e: any) => e.data.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    if (!text.trim() || text.length > 16000) throw new QqError('请求过长，请在私聊中重新发送')
    const inputs = events
      .slice(start + 1)
      .filter((e: any) => e.type === 'user/message' && e.data?.source?.kind === 'plugin:dsh-onebot')
      .map((e: any) => qqMessageOrigin(e.data.source)?.messageId ?? e.data.id)
    if (!inputs.length || inputs.some((id: unknown) => typeof id !== 'string' || !id))
      throw new QqError('缺少原始请求标识，未投递任务', 403)
    await this.transfer(
      receiptKey('transfer', [this.settings.accountId, channel.conversationId, sender, inputs]),
      sender,
      text,
      exec.signal,
      channel.conversationId
    )
    return {
      accepted: true,
      delivery: channel.conversationId,
      message:
        '已交给本聊天的原生任务会话，结果留在这里；用 /stop 停止。群任务不会自动读取私有资料。重复调用不会重跑。'
    }
  }
  private async transfer(
    key: string,
    sender: string,
    text: string,
    signal: AbortSignal,
    chatId: string
  ): Promise<void> {
    try {
      await this.receipts.once(key, () =>
        chatId.startsWith('group:')
          ? this.groupTasks.submit(chatId, sender, text, 'px-task-' + key, signal)
          : this.deliverPrivateTask(sender, text, signal, key)
      )
    } catch (error) {
      if (error instanceof QqReceiptStorageError) this.persistenceError(error)
      throw error
    }
  }
  private async flushAdmission(admission: AdmissionMetadata): Promise<void> {
    const sessions = get(this.host, 'sessions'),
      session = sessions?.get(admission.sessionId)
    if (!session) throw new QqError('会话已关闭，投递状态需在客户端核对；未自动重新发送', 409)
    try {
      await sessions.flush(session)
    } catch {
      throw new QqReceiptStorageError('原生会话尚未确认保存，未自动重跑请求')
    }
  }
  private async deliverPrivateTask(
    sender: string,
    text: string,
    signal: AbortSignal,
    key: string
  ): Promise<AdmissionMetadata> {
    const port = this.bridge!
    const event = {
      post_type: 'message',
      message_type: 'private',
      self_id: this.settings.accountId,
      user_id: sender,
      message_id: 'px-task-' + key,
      time: Math.floor(Date.now() / 1000),
      message: [
        {
          type: 'text',
          data: {
            text: '以下是你通过 QQ 提交的原始请求，已加入与你的私有任务会话；结果只在本私聊交付。\n' + text
          }
        }
      ],
      sender: { user_id: sender, nickname: '已授权 QQ 成员' }
    }
    signal.throwIfAborted()
    let admission: AdmissionMetadata | undefined
    await this.caller.run(
      { chatId: 'private:' + sender, senderId: sender, messageId: event.message_id },
      async () => {
        await port.receive(event)
        admission = this.caller.getStore()?.admission
      }
    )
    if (!admission) throw new QqError('原生任务尚未确认入队，请在私聊检查状态；未自动重复投递', 409)
    await this.flushAdmission(admission)
    return admission
  }
}
