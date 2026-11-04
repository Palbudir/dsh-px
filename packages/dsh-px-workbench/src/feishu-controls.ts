import { channelControl, type ChannelControlAudit } from '../../shared/channel-control'
import { questionAnswer, type ChannelInteractions } from '../../shared/channel-interactions'
import type { ChannelInbox, ChannelInboxEvent } from '../../shared/channel-inbox'
import { ChannelError, type ChannelAccount } from './channel-settings'
import type { FeishuTasks } from './feishu-tasks'

const get = (ctx: any, key: string) => (ctx.get ? ctx.get(key) : ctx[key])
/** Durable intake plus an exact, live native waiter. Commands are never interpreted by a model. */
export class FeishuControls {
  private readonly pending = new Set<Promise<unknown>>()
  constructor(
    private readonly host: any,
    private readonly inbox: ChannelInbox,
    private readonly interactions: ChannelInteractions,
    private readonly tasks: FeishuTasks,
    private readonly current: () => ChannelAccount | undefined,
    private readonly active: () => boolean,
    private readonly epoch: string,
    private readonly failed: (id: string, text: string) => void,
    private readonly send: (
      conversation: string,
      signal: AbortSignal,
      work: () => Promise<void>
    ) => Promise<void>
  ) {}
  receive(id: string, event: ChannelInboxEvent, signal: AbortSignal): Promise<boolean> {
    const work = this.handle(id, event, signal)
    this.pending.add(work)
    void work.finally(() => this.pending.delete(work)).catch(() => {})
    return work
  }
  /** A previous process's confirmation IDs cannot authorize a new process's requests. */
  async retirePrevious(signal: AbortSignal) {
    let cursor = 0
    for (;;) {
      signal.throwIfAborted()
      const batch = this.inbox.pending(100, cursor)
      if (!batch.length) return
      for (const row of batch) {
        cursor = row.seq
        const command = channelControl(row.event.text)
        if (command && this.inbox.claimControl(row.id, command.kind, this.epoch))
          this.inbox.finishControl(row.id, 'refused', { reason: '原接收方已结束，旧确认不会自动提交' })
      }
      if (batch.length < 100) return
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
  private async handle(id: string, event: ChannelInboxEvent, signal: AbortSignal): Promise<boolean> {
    const command = channelControl(event.text)
    if (!command) return false
    if (!this.active()) return true
    if (!this.inbox.claimControl(id, command.kind, this.epoch)) return true
    let reply = '',
      forwarded = false
    let response: ChannelControlAudit['response']
    try {
      signal.throwIfAborted()
      if (!this.current()?.authorizedUsers.includes(event.actorId))
        throw new ChannelError('此成员没有处理任务请求的权限', 403)
      const waiting = this.interactions
        .list()
        .find(
          (p) => p.id === command.id && p.chatId === event.conversationId && p.requesterId === event.actorId
        )
      if (!waiting) throw new ChannelError('请求已处理、已取消或不属于你的当前任务', 403)
      if (command.kind === 'answer') {
        if (
          waiting.kind !== 'question' ||
          !Number.isSafeInteger(command.question) ||
          command.question! < 1 ||
          command.question! > waiting.questions!.length ||
          typeof command.answer !== 'string'
        )
          throw new ChannelError('用法：/answer 请求编号 题号 回答')
        try {
          const question = waiting.questions![command.question! - 1],
            parsed = questionAnswer(question, command.answer)
          response = {
            question: command.question!,
            questionText: question.question,
            selected: parsed.selected,
            ...('custom' in parsed ? { custom: parsed.custom } : {})
          }
        } catch (error) {
          throw new ChannelError(error instanceof Error ? error.message : '回答无效')
        }
      } else if (waiting.kind !== 'approval') throw new ChannelError('此编号不是工具审批请求')
      const agent = get(this.host, 'agents').get(waiting.sessionId)
      if (!this.tasks.owns(agent)) throw new ChannelError('任务当前授权已失效', 403)
      const audit: ChannelControlAudit = {
        version: 1,
        provider: 'feishu',
        accountId: event.accountId,
        conversationId: event.conversationId,
        actorId: event.actorId,
        messageId: event.messageId,
        requestId: waiting.id,
        sessionId: waiting.sessionId,
        control: command.kind,
        text: event.text,
        meaning: 'authenticated-control-attempt-not-task-completion',
        ...(response ? { response } : {})
      }
      const { appendPluginRecord } = await import('@deepseek-ai/dsh-session')
      signal.throwIfAborted()
      const recorded = appendPluginRecord(agent.session, 'plugin:dsh-px/channel-control', audit)
      if (!(await get(this.host, 'sessions').flush(agent.session)))
        throw new ChannelError('控制请求的原生记录未确认保存', 503)
      signal.throwIfAborted()
      reply = this.interactions.respond(
        event.conversationId,
        {
          id: command.id,
          ...(command.kind === 'answer'
            ? { question: command.question, answer: command.answer }
            : { decision: command.kind === 'approve' ? 'allowed-once' : 'rejected' })
        },
        event.actorId
      )
      forwarded = true
      this.inbox.finishControl(id, 'accepted', {
        sessionId: agent.id,
        seq: recorded,
        requestId: waiting.id,
        meaning: 'native-waiter-accepted-not-task-completion'
      })
    } catch (error) {
      try {
        this.inbox.finishControl(id, forwarded ? 'uncertain' : 'refused', {
          error: error instanceof Error ? error.message : '控制请求未确认'
        })
      } catch {}
      reply =
        error instanceof ChannelError ? error.message : '控制请求未能确认提交，请在客户端查看；未自动重试。'
    }
    try {
      await this.send(event.conversationId, signal, async () => {
        const intent = this.inbox.beginControlReply(id, reply, this.epoch)
        if (intent.phase === 'new') {
          try {
            signal.throwIfAborted()
            if (!this.active()) throw new ChannelError('渠道接收已停止', 409)
            const sent = await get(this.host, 'dshIm').replyChecked(event.accountId, event.reply, reply, {
              expectedFingerprint: event.fingerprint,
              signal
            })
            if (sent?.sent !== true || typeof sent.messageId !== 'string' || !sent.messageId)
              throw Error('控制回执未确认')
            this.inbox.finishReply(intent.id, 'sent', { sent: true, messageId: sent.messageId })
          } catch (error: any) {
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
            this.failed(id, '控制请求的回应未确认送达；未自动重复发送')
          }
        }
      })
    } catch {
      this.failed(id, '控制请求的回应未确认送达；未自动重复发送')
    }
    return true
  }
  async drain() {
    await Promise.allSettled([...this.pending])
  }
}
