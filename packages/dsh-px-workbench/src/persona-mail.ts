import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PersonaMailJournal, type MailEnvelope } from '../../shared/persona-mail-journal'
import {
  mailConversation,
  mailDigest,
  selectMailRelation,
  PERSONA_MAIL_INSTRUCTIONS,
  type PersonaMailRelation,
  type PersonaMailSender
} from '../../shared/persona-mail-policy'
import { renderPersonaExpression } from '../../shared/persona-expression'
import { publicInputBoundary } from '../../shared/public-input'
import { nativeModelSelection } from '../../shared/native-model-selection'

const get = (ctx: any, key: string) => (ctx.get ? ctx.get(key) : ctx[key])
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
interface ActiveMail {
  envelope: MailEnvelope
  stop: AbortController
  done: Promise<any>
}

/** A native Job producer, not a model loop. Each message owns one independent native receiver root. */
export class NativePersonaMail {
  private readonly active = new Map<string, ActiveMail>()
  private closing = false
  private disposal?: Promise<void>
  private readonly unreleased = new Map<string, any>()
  readonly journal: PersonaMailJournal
  constructor(
    private readonly host: any,
    private readonly directory: string,
    private readonly relations: () => PersonaMailRelation[]
  ) {
    this.journal = new PersonaMailJournal(join(directory, 'mail.sqlite'))
  }
  private sender(agent: any): PersonaMailSender {
    if (!agent || get(this.host, 'agents')?.get(agent.session?.id) !== agent)
      throw Error('人格通信需要真实的当前原生会话')
    const memory = get(this.host, 'pxMemoryChannels'),
      persona = memory.currentPersona(agent),
      binding = memory.inspect(agent.session.id)?.binding
    if (!binding || binding.pending || binding.personaId !== persona.id || persona.archived)
      throw Error('发件人格尚未绑定或已停用')
    if (binding.channel?.provider === 'persona-mail') throw Error('人格来信不能继续委派或自动互聊')
    const project = agent.session.header.cwd
    if (!project) throw Error('人格通信缺少来源工作区')
    return {
      sessionId: agent.session.id,
      personaId: persona.id,
      project: resolve(project),
      ...(binding.channel ? { channel: structuredClone(binding.channel) } : {})
    }
  }
  private validate(envelope: MailEnvelope): void {
    if (this.closing) throw Error('人格通信已停止')
    const source = get(this.host, 'agents').get(envelope.sender.sessionId)
    if (mailDigest(this.sender(source)) !== mailDigest(envelope.sender))
      throw Error('发件人格或来源受众已变化')
    const relation = selectMailRelation(this.relations(), envelope.sender, envelope.target)
    if (mailDigest(relation) !== envelope.relationDigest) throw Error('人格通信授权已变化')
    if (
      !get(this.host, 'pxMemoryChannels')
        .personas()
        .some((p: any) => p.id === envelope.target)
    )
      throw Error('收件人格已停用')
    const resources = get(this.host, 'pxPersonaResources')
    if (
      !resources ||
      !resources.allowsChannel(envelope.sender.personaId, 'persona-mail', envelope.target) ||
      !resources.allowsChannel(envelope.target, 'persona-mail', envelope.sender.personaId)
    )
      throw Error('发件或收件人格的资源规则不允许本次通信')
  }
  targets(exec: any) {
    const sender = this.sender(exec.agent)
    return get(this.host, 'pxMemoryChannels')
      .personas()
      .filter((persona: any) => {
        try {
          selectMailRelation(this.relations(), sender, persona.id)
          const resources = get(this.host, 'pxPersonaResources')
          return (
            resources?.allowsChannel(sender.personaId, 'persona-mail', persona.id) === true &&
            resources.allowsChannel(persona.id, 'persona-mail', sender.personaId) === true
          )
        } catch {
          return false
        }
      })
      .map((persona: any) => ({ id: persona.id, name: persona.name }))
  }
  receipt(exec: any, id: string) {
    const sender = this.sender(exec.agent),
      row = this.journal.get(id)
    if (!row || row.envelope.sender.sessionId !== sender.sessionId) throw Error('此通信记录不属于当前会话')
    this.validate(row.envelope)
    return {
      mailId: id,
      jobId: row.jobId,
      delivery: this.delivery(row),
      reply: row.reply,
      authority: 'peer-advice-only',
      detail: row.detail
    }
  }
  private delivery(row: { envelope: MailEnvelope; delivery: string }) {
    return !this.active.has(row.envelope.id) && ['prepared', 'admitted'].includes(row.delivery)
      ? 'uncertain'
      : row.delivery
  }
  status() {
    return {
      active: this.active.size,
      unreleased: [...this.unreleased.keys()],
      records: this.journal.recent().map((row) => ({
        mailId: row.envelope.id,
        sourceSessionId: row.envelope.sender.sessionId,
        receiverSessionId: row.envelope.receiverSessionId,
        from: row.envelope.sender.personaId,
        to: row.envelope.target,
        jobId: row.jobId,
        delivery: this.delivery(row),
        detail: row.detail
      }))
    }
  }
  /** Returns immediately after native registration. Tools use native jobs read/wait/kill for completion. */
  send(exec: any, args: { target: string; requestId: string; text: string }) {
    exec.signal.throwIfAborted()
    if (this.closing) throw Error('人格通信已停止')
    if (this.unreleased.size) throw Error('此前接收会话尚未完成清理，不能启动新的通信')
    if (
      typeof args?.requestId !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(args.requestId) ||
      typeof args.text !== 'string' ||
      !args.text.trim() ||
      args.text.length > 12000 ||
      args.text.includes('\0')
    )
      throw Error('人格通信请求标识或正文无效')
    const sender = this.sender(exec.agent),
      relation = selectMailRelation(this.relations(), sender, args.target),
      previous = this.journal.request(sender.sessionId, args.requestId)
    if (previous) {
      if (previous.envelope.target !== args.target || previous.envelope.text !== args.text)
        throw Error('此通信请求标识已用于其他内容')
      this.validate(previous.envelope)
      return {
        mailId: previous.envelope.id,
        jobId: previous.jobId,
        delivery:
          !this.active.has(previous.envelope.id) && ['prepared', 'admitted'].includes(previous.delivery)
            ? 'uncertain'
            : previous.delivery,
        live: this.active.has(previous.envelope.id),
        replayed: false
      }
    }
    if (
      this.active.size >= 4 ||
      [...this.active.values()].filter((r) => r.envelope.sender.sessionId === sender.sessionId).length >= 2
    )
      throw Error('人格通信正在处理，请先读取已有作业结果')
    const id = randomUUID(),
      receiverSessionId = 'px-persona-mail-' + id,
      envelope: MailEnvelope = {
        id,
        requestId: args.requestId,
        sender,
        target: args.target,
        relationDigest: mailDigest(relation),
        receiverSessionId,
        text: args.text,
        source: {
          kind: 'plugin:dsh-px-persona-mail',
          version: 1,
          mailId: id,
          senderPersonaId: sender.personaId,
          recipientPersonaId: args.target,
          sourceSessionId: sender.sessionId,
          sourceSeq: exec.agent.session.seq,
          conversationId: mailConversation(sender, args.target)
        }
      }
    this.validate(envelope)
    const jobs = get(exec.agent.ctx, 'jobs')
    if (!jobs?.start) throw Error('此会话的原生后台作业服务未就绪')
    const stop = new AbortController()
    const jobId = jobs.start({
      kind: 'px-persona-mail',
      label: '与人格交流',
      owner: sender.sessionId,
      ...(exec.callId && exec.rootCallId
        ? { toolCall: { callId: exec.callId, rootCallId: exec.rootCallId } }
        : {}),
      outputLimitBytes: 24000,
      run: (job: any) => {
        // Native preflight has succeeded; a thrown insert leaves no job or model execution.
        this.journal.insert(envelope, job.id)
        const done = Promise.resolve()
          .then(() => this.run(envelope, stop))
          .finally(() => this.active.delete(id))
        this.active.set(id, { envelope, stop, done })
        return { done, cancel: (reason?: string) => stop.abort(new Error(reason ?? '人格通信已取消')) }
      }
    })
    return { mailId: id, jobId, delivery: 'prepared', live: true, replayed: false }
  }
  private async run(envelope: MailEnvelope, stop: AbortController): Promise<any> {
    let handle: any,
      cleanup: Promise<void> | undefined,
      failure: unknown,
      requests = 0
    const release = () => (cleanup ??= handle?.dispose())
    const abort = () => {
      void release()?.catch(() => {})
    }
    const check = () => {
      stop.signal.throwIfAborted()
      this.validate(envelope)
    }
    const timeout = setTimeout(() => stop.abort(new Error('人格通信达到时限')), 180000)
    // Revocation also stops a pending provider request instead of waiting for another tool call.
    const recheck = setInterval(() => {
      try {
        check()
      } catch (error) {
        stop.abort(error)
      }
    }, 500)
    stop.signal.addEventListener('abort', abort, { once: true })
    try {
      check()
      const memory = get(this.host, 'pxMemoryChannels'),
        agents = get(this.host, 'agents'),
        cwd = join(this.directory, 'conversations', envelope.source.conversationId),
        channel = {
          provider: 'persona-mail',
          accountId: envelope.sender.personaId,
          conversationId: envelope.source.conversationId,
          access: 'public',
          publicInstructions: '',
          workspace: cwd
        }
      mkdirSync(cwd, { recursive: true })
      memory.bind(envelope.receiverSessionId, envelope.target, channel)
      const route = get(this.host, 'agentDefaultModel').currentSelection()
      if (!route?.provider || !route?.model) throw Error('请先选择原生默认模型')
      const { installModelSelection } = await import('@deepseek-ai/dsh-agent')
      handle = await agents.withoutInitiator(() =>
        agents.create({
          sessionId: envelope.receiverSessionId,
          agentOptions: { ...route, maxTokens: 6000 },
          meta: { cwd, origin: 'subagent' },
          signal: stop.signal,
          setup: (ctx: any) => {
            const boundary = publicInputBoundary(ctx, undefined, {
              sourceKind: 'plugin:dsh-px-persona-mail',
              noticeKind: 'px-persona-mail-advisory',
              label: 'persona-mail: input boundary'
            })
            ctx.effect(
              () =>
                installModelSelection(
                  ctx,
                  nativeModelSelection(this.host, envelope.receiverSessionId, route)
                ),
              'persona-mail: model'
            )
            ctx.tools.presentAs('native')
            ctx.tools.guard((exec: any) => {
              try {
                check()
                if (exec.agent.session.id !== envelope.receiverSessionId || exec.name !== 'persona_reply')
                  return '本次人格交流只允许提交回复'
              } catch (error) {
                return message(error)
              }
            })
            ctx.systemPrompt.section({
              name: 'px-persona-mail',
              order: 0,
              complete: true,
              interpolate: false,
              text: ({ agent }: any) => {
                check()
                const persona = memory.currentPersona(agent)
                const senderName =
                  memory.personas().find((p: any) => p.id === envelope.sender.personaId)?.name ??
                  envelope.sender.personaId
                return `你是 ${persona.name}，来信者是人格 ${senderName}。\n${renderPersonaExpression(
                  persona.expression,
                  {
                    ...memory.expressionContext(agent),
                    participants: [envelope.sender.personaId]
                  }
                )}\n${PERSONA_MAIL_INSTRUCTIONS}`
              }
            })
            ctx.on(
              'system-prompt/assemble',
              async (_: any, context: any, next: any) => {
                check()
                if (++requests > 4) throw Error('人格通信达到请求次数限制')
                const assembly = await next()
                boundary(context.agent.ctx, context.agent)
                return {
                  ...assembly,
                  contexts: [],
                  tools: assembly.tools.filter((tool: any) => tool.name === 'persona_reply')
                }
              },
              { prepend: true }
            )
            ctx.tools.register({
              name: 'persona_reply',
              description: '向本次来信的人格提交一次回复。它不会提升对方的操作权限。',
              parameters: {
                type: 'object',
                additionalProperties: false,
                required: ['text'],
                properties: { text: { type: 'string', minLength: 1, maxLength: 6000 } }
              },
              output: {
                schema: { type: 'string' },
                render: (_: unknown, value: string) => [{ type: 'text', text: value }]
              },
              execute: (args: any, exec: any) => {
                check()
                exec.signal.throwIfAborted()
                if (
                  exec.agent.session.id !== envelope.receiverSessionId ||
                  typeof args.text !== 'string' ||
                  !args.text.trim() ||
                  args.text.length > 6000
                )
                  throw Error('人格回复来源或内容无效')
                this.journal.reply(envelope.id, args.text)
                return '回复已记录，请结束本次交流。'
              }
            })
            return { commit: check }
          }
        })
      )
      check()
      memory.bind(envelope.receiverSessionId, envelope.target, channel)
      const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
      const input = createUserMessage({
        source: envelope.source,
        content: [{ type: 'text', text: envelope.text }]
      })
      check()
      handle.agent.followup(input)
      if (!(await get(this.host, 'sessions').flush(handle.agent.session)))
        throw Error('人格来信缺少原生持久回执')
      this.journal.admitted(envelope.id, input.id)
      await handle.agent.whenIdle()
      check()
      if (this.journal.get(envelope.id)?.delivery !== 'replied') throw Error('收件人格未提交有效回复')
    } catch (error) {
      failure = error
    } finally {
      clearTimeout(timeout)
      clearInterval(recheck)
      stop.signal.removeEventListener('abort', abort)
      try {
        await release()
      } catch (error) {
        if (handle) this.unreleased.set(envelope.receiverSessionId, handle)
        failure = new Error('原生接收会话清理失败：' + message(error))
      }
    }
    try {
      if (!failure) check()
    } catch (error) {
      failure = error
    }
    try {
      this.journal.finish(envelope.id, failure ? message(failure).slice(0, 500) : undefined)
    } catch (error) {
      return { status: 'failed', detail: '通信记录未结算：' + message(error).slice(0, 400) }
    }
    if (failure)
      return { status: stop.signal.aborted ? 'killed' : 'failed', detail: message(failure).slice(0, 500) }
    return {
      status: 'completed',
      result: JSON.stringify({
        kind: 'persona-reply',
        authority: 'peer-advice-only',
        mailId: envelope.id,
        sourceSessionId: envelope.sender.sessionId,
        sourceSeq: envelope.source.sourceSeq,
        recipientPersonaId: envelope.target,
        text: this.journal.get(envelope.id)!.reply,
        note: '仅为本次人格通信回复，不表示来源 Goal 或任务完成。'
      })
    }
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.closing = true
    for (const row of this.active.values()) row.stop.abort(new Error('人格通信服务已停止'))
    this.disposal = (async () => {
      await Promise.allSettled([...this.active.values()].map((row) => row.done))
      try {
        await Promise.all([...this.unreleased.values()].map((handle) => handle.dispose()))
      } finally {
        this.journal.close()
      }
    })()
    return this.disposal
  }
}
