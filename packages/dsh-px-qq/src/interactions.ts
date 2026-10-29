import { randomBytes } from 'node:crypto'
import { QqError } from './policy'

export interface Question {
  id: string
  question: string
  header?: string
  detail?: string
  multiSelect?: boolean
  options?: Array<{ label: string; description?: string }>
  intent?: { kind: string; approve: string }
}
export interface PendingInteraction {
  id: string
  sessionId: string
  chatId: string
  kind: 'approval' | 'question'
  text: string
  questions?: Question[]
  answered: number[]
}
interface Active {
  view: PendingInteraction
  answers: Map<number, { id: string; selected: string[]; custom?: string }>
  settle(value: unknown, error?: Error): void
}
const plain = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')

export function approvalText(request: any): string | undefined {
  if (!request.callId || typeof request.toolName !== 'string') return undefined
  const events = request.agent?.session.snapshotEvents() ?? []
  // Exact native call identity; never approve an operation reconstructed from model prose.
  const event = events.findLast(
    (e: any) =>
      (e.type === 'tool/call' && e.data.callId === request.callId) ||
      (e.type === 'tool/code-dispatch-start' && e.data.subCallId === request.callId)
  )
  if (!event || event.data.name !== request.toolName) return undefined
  const args =
    typeof event.data.arguments === 'string' ? event.data.arguments : JSON.stringify(event.data.arguments)
  if (typeof args !== 'string' || args.length > 6000) return undefined
  const text =
    '需要确认本次操作\n工具：' +
    request.toolName +
    '\n完整参数：\n' +
    args +
    (request.reason ? '\n原因：' + String(request.reason) : '')
  return text.length <= 8000 ? plain(text) : undefined
}
function questionText(questions: Question[]): string | undefined {
  if (!Array.isArray(questions) || !questions.length || questions.length > 12) return undefined
  const lines = ['需要你的回答：']
  for (const [index, q] of questions.entries()) {
    if (!q || typeof q.id !== 'string' || typeof q.question !== 'string') return undefined
    lines.push(`${index + 1}. ${q.header ? q.header + ' · ' : ''}${q.question}`)
    if (q.detail) lines.push(q.detail)
    for (const [i, option] of (q.options ?? []).entries()) {
      if (typeof option.label !== 'string') return undefined
      lines.push(`  ${i + 1}) ${option.label}${option.description ? ' — ' + option.description : ''}`)
    }
    if (q.multiSelect) lines.push('可多选，选项序号用逗号分隔。')
  }
  const text = lines.join('\n')
  return text.length <= 8000 ? plain(text) : undefined
}
export function questionAnswer(question: Question, text: string) {
  const value = text.trim(),
    options = question.options ?? []
  if (!value || value.length > 8000) throw new QqError('请填写回答（最多 8000 字符）')
  const numbers = value.split(/[,，]/).map((v) => v.trim())
  const indices = numbers.every((v) => /^[1-9]\d*$/.test(v)) ? numbers.map(Number) : []
  if (
    indices.length &&
    indices.every((i) => i <= options.length) &&
    (question.multiSelect || indices.length === 1)
  )
    return { id: question.id, selected: [...new Set(indices.map((i) => options[i - 1].label))] }
  const label = options.find((o) => o.label === value)?.label
  if (label) return { id: question.id, selected: [label] }
  // Plan approval requires the explicit offered option, never a guessed free-text yes.
  if (question.intent?.kind === 'plan-review') throw new QqError('请使用计划卡片中的选项序号或完整选项文字')
  return { id: question.id, selected: [], custom: value }
}

/** One local answerer of DSH's native request waterfall; the Host owns policy and audit. */
export class QqInteractions {
  private readonly active = new Map<string, Active>()
  private closed = false
  constructor(
    private readonly send: (chat: string, text: string) => Promise<unknown>,
    private readonly lifetimeMs = 10 * 60_000
  ) {}
  list(): PendingInteraction[] {
    return [...this.active.values()].map((p) => ({ ...p.view, answered: [...p.answers.keys()] }))
  }
  dispose(): void {
    this.closed = true
    for (const p of this.active.values())
      p.settle(undefined, new QqError('QQ 接入已停止，等待请求已取消', 409))
  }
  async request(
    kind: 'approval' | 'question',
    request: any,
    chatId: string,
    next: () => Promise<unknown>
  ): Promise<any> {
    const text = kind === 'approval' ? approvalText(request) : questionText(request.questions)
    if (!text || this.closed || this.active.size >= 64) {
      if (!this.closed)
        void this.send(
          chatId,
          '此确认内容无法完整显示在 QQ，请在 DSH-PX 客户端中处理，或发送 /stop 停止任务。'
        ).catch(() => {})
      return next()
    }
    if (request.signal?.aborted)
      return kind === 'approval' ? 'cancelled' : Promise.reject(new QqError('问题已取消', 409))
    const id = (kind === 'approval' ? 'A' : 'Q') + randomBytes(5).toString('hex')
    let resolve!: (value: unknown) => void, reject!: (error: Error) => void
    const promise = new Promise<unknown>((yes, no) => {
      resolve = yes
      reject = no
    })
    const pending: Active = {
      view: {
        id,
        sessionId: request.agent.session.id,
        chatId,
        kind,
        text,
        ...(kind === 'question' ? { questions: structuredClone(request.questions) } : {}),
        answered: []
      },
      answers: new Map(),
      settle: (value, error) => {
        if (!this.active.delete(id)) return
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', abort)
        if (error && kind === 'question') reject(error)
        else resolve(error ? 'cancelled' : value)
      }
    }
    const abort = () => pending.settle(undefined, new QqError('该请求已取消或超时', 409))
    const timer = setTimeout(abort, this.lifetimeMs)
    timer.unref?.()
    this.active.set(id, pending)
    request.signal?.addEventListener('abort', abort, { once: true })
    const hint =
      kind === 'approval'
        ? `\n批准一次：/approve ${id}\n拒绝：/reject ${id}`
        : (request.questions.some((q: Question) => q.intent?.kind === 'plan-review')
            ? '\n计划确认请使用本次请求编号，或在客户端选择。'
            : '\n当前只有一个问题卡片时，可直接回复选项序号或文字，多题按顺序回答。') +
          `\n指定回答：/answer ${id} 题号 回答`
    void this.send(
      chatId,
      text + hint + '\n也可在客户端“设置 → QQ 账号 → 待处理请求”操作；取消或超时后的回复不会执行。'
    ).catch(() => pending.settle(undefined, new QqError('QQ 确认消息未能送达，等待已取消', 503)))
    return promise
  }
  answerPlain(chatId: string, sessionId: string, text: string): string | undefined {
    const all = [...this.active.values()].filter(
      (p) => p.view.kind === 'question' && p.view.chatId === chatId
    )
    const pending = all.filter((p) => p.view.sessionId === sessionId)
    if (!pending.length || !text.trim() || text.startsWith('/')) return undefined
    if (pending.length !== 1 || all.length !== 1)
      return '当前有多个待回答的问题，请按卡片编号使用 /answer，避免答错任务。'
    const item = pending[0],
      index = item.view.questions!.findIndex((_, i) => !item.answers.has(i))
    if (index < 0) return undefined
    if (item.view.questions![index].intent?.kind === 'plan-review')
      return '计划确认请使用 /answer 指定本次编号，或在客户端选择；未自动批准。'
    return this.respond(chatId, { id: item.view.id, question: index + 1, answer: text })
  }
  respond(
    chatId: string,
    input: { id: string; decision?: string; question?: number; answer?: string }
  ): string {
    const pending = this.active.get(input.id)
    if (!pending || pending.view.chatId !== chatId)
      throw new QqError('请求已处理、已取消或不属于本私聊；未执行操作', 409)
    if (pending.view.kind === 'approval') {
      if (!['allowed-once', 'rejected'].includes(input.decision ?? ''))
        throw new QqError('请选择批准一次或拒绝')
      pending.settle(input.decision)
      return input.decision === 'allowed-once' ? '已批准本次操作。' : '已拒绝本次操作。'
    }
    if (
      !Number.isInteger(input.question) ||
      !input.question ||
      input.question < 1 ||
      input.question > pending.view.questions!.length ||
      typeof input.answer !== 'string'
    )
      throw new QqError('用法：/answer 请求编号 题号 回答')
    const index = input.question - 1
    pending.answers.set(index, questionAnswer(pending.view.questions![index], input.answer))
    if (pending.answers.size === pending.view.questions!.length) {
      pending.settle({ answers: pending.view.questions!.map((_, i) => pending.answers.get(i)) })
      return '回答已提交，任务将继续。'
    }
    return '已记录第 ' + input.question + ' 题，请继续回答其余题目。'
  }
}
