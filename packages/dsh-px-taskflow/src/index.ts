import { readFailure } from '../../shared/session-errors'
export { readFailure } from '../../shared/session-errors'
import { rejectUntrustedRequest } from '../../shared/request-trust'
import {
  evidenceDetail,
  integerOption,
  reviewEvents,
  validateCheckpoint,
  type Event,
  type ReviewOptions,
  type EvidenceOptions
} from './evidence'

export const name = 'dsh-px-taskflow'
export const inject: string[] = []
export const DEFAULTS = { routePrefix: '/dsh-px-taskflow' }
interface Session {
  header: { cwd?: string }
  snapshotEvents: () => readonly Event[]
}
interface Run {
  signal: AbortSignal
  agent?: { session: Session }
}
interface Context {
  inject: (names: string[], callback: (ctx: any) => void) => unknown
  effect: (fn: () => (() => void) | void, name?: string) => unknown
}
const POLICY = `You are working inside DSH-PX, a local agent product. Respond in the user's language; for Chinese requests, write progress and final delivery in Chinese. For non-trivial implementation tasks, carry the work through inspection, implementation, relevant validation, and a reviewable delivery. Read repository instructions, inspect existing changes, and preserve unrelated work. Use the host's todo, file, shell, permission, and delivery tools; obey plan mode and user instructions. Do not invent a separate execution or approval mechanism.
For a multi-step implementation task, record the goal and next action with task_checkpoint. On resuming or being asked for progress, call task_review to recover the latest checkpoint and compact execution summaries. Follow nextBeforeSeq to page older calls. Use task_evidence with a callId to read its recorded output in bounded pages; a summary may omit essential test output. Before final delivery, inspect the changes with the existing Git/file tools, run the relevant checks, then call task_review and record a ready_for_review checkpoint referencing actual call ids. Any settled non-internal call in this session may be cited, including older pages. Tool return success does not prove tests passed: read the output and state what was and was not verified. If blocked, record the concrete blocker and next action. Never retry a possibly mutating interrupted call blindly; reconcile its effect first. Skip checkpoints for simple questions or trivial edits. A checkpoint is a work note, not user approval or permission to continue autonomously in the background.`

function queryInteger(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  if (!params.has(key)) return fallback
  const value = params.get(key)!
  if (params.getAll(key).length !== 1 || !/^(0|[1-9]\d*)$/.test(value)) throw new Error('分页参数无效')
  return integerOption(Number(value), fallback, min, max)
}
export function apply(ctx: Context): void {
  ctx.inject(['systemPrompt'], (host) => {
    host.effect(
      () => host.systemPrompt.section({ name: 'dsh-px-delivery-workflow', order: 9900, text: POLICY }),
      'taskflow: workflow'
    )
  })
  ctx.inject(['tools'], (host) => {
    const output = {
      schema: { type: 'string' },
      render: (_: unknown, value: string) => [{ type: 'text', text: value }]
    }
    const session = (exec: Run): Session => {
      exec.signal.throwIfAborted()
      if (!exec.agent) throw new Error('此工具需要当前会话')
      return exec.agent.session
    }
    host.tools.register({
      name: 'task_review',
      description:
        '读取当前任务工作记录与执行摘要，默认最近 20 条。用 nextBeforeSeq 作为 beforeSeq 翻阅历史；需输出正文时用 task_evidence。returned 不代表测试通过。',
      parameters: {
        type: 'object',
        properties: {
          beforeSeq: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 50 }
        },
        additionalProperties: false
      },
      output,
      execute: async (args: ReviewOptions, exec: Run) =>
        JSON.stringify(reviewEvents(session(exec).snapshotEvents(), true, args))
    })
    host.tools.register({
      name: 'task_evidence',
      description:
        '按真实 callId 读取当前会话的一条执行及其持久输出，支持历史记录。默认 4000 字符，用 nextOutputOffset 继续读取。只读取日志，不重跑命令；上游已截断或未保存的内容无法恢复。',
      parameters: {
        type: 'object',
        required: ['callId'],
        properties: {
          callId: { type: 'string', minLength: 1, maxLength: 200 },
          offset: { type: 'integer', minimum: 0 },
          maxChars: { type: 'integer', minimum: 1, maximum: 8000 }
        },
        additionalProperties: false
      },
      output,
      execute: async (args: EvidenceOptions & { callId: string }, exec: Run) => {
        const value = evidenceDetail(session(exec).snapshotEvents(), args.callId, true, args)
        if (!value) throw new Error('此会话没有这条执行记录，请先 task_review 核对编号。')
        return JSON.stringify(value)
      }
    })
    host.tools.register({
      name: 'task_checkpoint',
      description:
        '保存多步骤任务的目标、进展、下一步和执行证据引用到当前会话。不能替代测试或批准；引用 task_review 返回的实际 call id，可引用成功或失败的已结算记录（例如复现失败的测试），但不能引用进行中或结果未知的调用。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['goal', 'summary', 'nextStep', 'state', 'evidence'],
        properties: {
          goal: { type: 'string' },
          summary: { type: 'string' },
          nextStep: { type: 'string' },
          state: { type: 'string', enum: ['working', 'blocked', 'ready_for_review'] },
          evidence: { type: 'array', items: { type: 'string' } }
        }
      },
      output,
      execute: async (args: unknown, exec: Run) =>
        JSON.stringify({ checkpoint: validateCheckpoint(args, session(exec).snapshotEvents()) })
    })
  })
  ctx.inject(['webServer', 'sessions', 'sessionPersistence'], (host) => {
    for (const kind of ['review', 'evidence'] as const)
      host.effect(
        () =>
          host.webServer.register({
            kind: 'exact',
            path: `${DEFAULTS.routePrefix}/${kind}`,
            handler: async (req: any, res: any) => {
              if (rejectUntrustedRequest(req, res)) return
              const send = (status: number, data: unknown): void => {
                res.writeHead(status, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Cache-Control': 'no-store'
                })
                res.end(JSON.stringify(data))
              }
              if (req.method !== 'GET') return send(405, { error: '请使用 GET' })
              const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
              const id = params.get('sessionId')
              const invalid = (error: string): void =>
                send(400, { error, code: 'INVALID_REQUEST', retryable: false })
              if (
                !id ||
                id.length > 200 ||
                params.getAll('sessionId').length !== 1 ||
                !/^[a-zA-Z0-9_-]+$/.test(id)
              )
                return invalid('会话标识无效')
              let select: (events: readonly Event[], live: boolean) => unknown
              try {
                const allowed =
                  kind === 'review'
                    ? ['sessionId', 'beforeSeq', 'limit']
                    : ['sessionId', 'callId', 'offset', 'maxChars']
                for (const key of params.keys())
                  if (!allowed.includes(key)) return invalid('存在不支持的查询参数')
                if (kind === 'review') {
                  const options = {
                    beforeSeq: queryInteger(
                      params,
                      'beforeSeq',
                      Number.MAX_SAFE_INTEGER,
                      0,
                      Number.MAX_SAFE_INTEGER
                    ),
                    limit: queryInteger(params, 'limit', 20, 1, 50)
                  }
                  select = (events, live) => reviewEvents(events, live, options)
                } else {
                  const callId = params.get('callId')
                  if (!callId || callId.length > 200 || params.getAll('callId').length !== 1)
                    return invalid('执行编号无效')
                  const options = {
                    offset: queryInteger(params, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
                    maxChars: queryInteger(params, 'maxChars', 4000, 1, 8000)
                  }
                  select = (events, live) => evidenceDetail(events, callId, live, options)
                }
              } catch {
                return invalid('分页参数无效')
              }
              const respond = (events: readonly Event[], live: boolean): void => {
                const value = select(events, live)
                if (value === null)
                  send(404, {
                    code: 'EVIDENCE_NOT_FOUND',
                    error: '此会话没有这条执行记录。',
                    retryable: false
                  })
                else send(200, value)
              }
              try {
                const live = host.sessions.get(id) as Session | undefined
                if (live) return respond(live.snapshotEvents(), true)
                const handle = await host.sessionPersistence.open(id, 'read')
                let events: readonly Event[]
                let readFailed = false
                try {
                  ;({ events } = await handle.read())
                } catch (error) {
                  readFailed = true
                  throw error
                } finally {
                  try {
                    await handle.close()
                  } catch (closeError) {
                    if (!readFailed) throw closeError
                  }
                }
                respond(events, false)
              } catch (error) {
                const failure = readFailure(error)
                send(failure.status, failure)
              }
            }
          }),
        `taskflow: ${kind} route`
      )
  })
}
