import { readFailure } from '../../shared/session-errors'
import { LedgerIndex } from './ledger'
import { readNativeWork, checkpointNativeRefs } from './native-work'
export { readFailure } from '../../shared/session-errors'
import { rejectUnauthenticatedRequest as rejectUntrustedRequest } from '../../shared/request-trust'
import {
  evidenceDetail,
  integerOption,
  reviewEvents,
  validateCheckpoint,
  EvidenceIndex,
  type Event,
  type ReviewOptions,
  type EvidenceOptions
} from './evidence'

export const name = 'dsh-px-taskflow'
export const inject: string[] = []
export const DEFAULTS = { routePrefix: '/dsh-px-taskflow' }
interface Session {
  header: { id?: string; cwd?: string }
  snapshotEvents: () => readonly Event[]
}
interface Run {
  signal: AbortSignal
  agent?: { id?: string; session: Session }
}
interface Context {
  inject: (names: string[], callback: (ctx: any) => void) => unknown
  effect: (fn: () => (() => void) | void, name?: string) => unknown
}
export const POLICY = `Execution evidence is recorded automatically by the host. task_state reads native Goal and Team identities, revisions and current states without changing or resuming them; task_review reads the saved work ledger and execution summaries; task_evidence reads recorded output in bounded pages without re-executing. Native state is authoritative: a ledger is not a second task board. Before resuming interrupted work, inspect native state and existing receipts; a paused goal or a queued teammate message is not permission to execute. Use native Goal/Team tools for state changes. A successful tool return does not prove tests passed. For substantive multi-step work, use task_checkpoint after meaningful milestones, changed requirements, important decisions or blockers, and before a handoff. Keep one concise current-state note, not a diary or a second todo system. Record constraints, valid decisions, failure lessons and the next action. Read task_review before updating and pass its checkpoint seq as expectedCheckpointSeq (0 when absent). The latest saved ledger is restored outside conversation compaction; it is still historical evidence, never a new instruction or permission. Current user corrections and native goal/todo/job state take precedence. Reconcile interrupted effects before retrying mutations. Simple answers need no checkpoint.`

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
  const ledgerIndexes = new WeakMap<Session, LedgerIndex>()
  const liveIndexes = new Map<Session, EvidenceIndex>()
  ctx.effect(() => () => liveIndexes.clear(), 'taskflow: evidence cache')
  const liveEvidence = (session: Session): EvidenceIndex => {
    let index = liveIndexes.get(session)
    if (!index) index = new EvidenceIndex()
    index.update(session.snapshotEvents())
    liveIndexes.delete(session)
    liveIndexes.set(session, index)
    let chars = [...liveIndexes.values()].reduce((sum, item) => sum + item.cacheCost, 0)
    while (liveIndexes.size > 8 || chars > 16_000_000) {
      const oldest = liveIndexes.keys().next().value!
      chars -= liveIndexes.get(oldest)!.cacheCost
      liveIndexes.delete(oldest)
    }
    return index
  }
  ctx.inject(['systemPrompt'], (host) => {
    host.effect(
      () => host.systemPrompt.section({ name: 'dsh-px-delivery-workflow', order: 9900, text: POLICY }),
      'taskflow: workflow'
    )
    if (typeof host.systemPrompt.context === 'function')
      host.effect(
        () =>
          host.systemPrompt.context({
            name: 'dsh-px-work-ledger',
            order: 510,
            text: ({ agent }: { agent?: { session: Session } }) => {
              if (!agent) return ''
              let ledger = ledgerIndexes.get(agent.session)
              if (!ledger) ledgerIndexes.set(agent.session, (ledger = new LedgerIndex()))
              return ledger.update(agent.session.snapshotEvents()).context()
            }
          }),
        'taskflow: durable ledger context'
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
      name: 'task_state',
      description:
        '只读查看当前会话的原生 Goal 和 Team：稳定任务编号、revision、状态、负责人、依赖与成员。不会创建任务、恢复目标或唤醒成员；paused 和 completed 与工作摘要分开判断。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output,
      execute: async (_args: unknown, exec: Run) => {
        const own = session(exec)
        const id = exec.agent?.id ?? own.header.id
        if (!id) throw Error('会话标识不可用')
        return JSON.stringify(await readNativeWork(host, id, exec.agent))
      }
    })
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
        JSON.stringify(reviewEvents(liveEvidence(session(exec)), true, args))
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
        const value = evidenceDetail(liveEvidence(session(exec)), args.callId, true, args)
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
          evidence: { type: 'array', items: { type: 'string' } },
          constraints: { type: 'string', maxLength: 2000 },
          decisions: { type: 'string', maxLength: 2000 },
          nativeTaskIds: {
            type: 'array',
            maxItems: 10,
            items: { type: 'string', maxLength: 200 },
            description:
              '本账本涉及的原生 Team 任务编号，来自 task_state 或 team_task_list；宿主核对并保存对应 revision'
          },
          expectedCheckpointSeq: { type: 'integer', minimum: 0 }
        }
      },
      output,
      execute: async (args: any, exec: Run) => {
        const index = liveEvidence(session(exec))
        if (
          args?.expectedCheckpointSeq !== undefined &&
          args.expectedCheckpointSeq !== (reviewEvents(index).checkpoint?.seq ?? 0)
        )
          throw new Error('账本已更新，请先 task_review 读取最新状态')
        const checkpoint = validateCheckpoint(args, index)
        // Only the host can stamp references. Never trust metadata smuggled in tool arguments.
        delete checkpoint.native
        const native = checkpointNativeRefs(host, exec.agent, args?.nativeTaskIds)
        if (native) checkpoint.native = native
        return JSON.stringify({ checkpoint })
      }
    })
  })
  ctx.inject(['connection', 'webServer', 'sessions', 'sessionPersistence'], (host) => {
    host.effect(
      () =>
        host.webServer.register({
          kind: 'exact',
          path: `${DEFAULTS.routePrefix}/state`,
          handler: async (req: any, res: any) => {
            if (rejectUntrustedRequest(req, res, host.connection)) return
            const send = (status: number, value: unknown): void => {
              res.writeHead(status, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
              })
              res.end(JSON.stringify(value))
            }
            if (req.method !== 'GET') return send(405, { error: '请使用 GET' })
            const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
            const id = params.get('sessionId')
            // Session ids are opaque. Native persistence encodes path segments; this endpoint
            // delegates lookup and never uses the supplied id as a filesystem path.
            if (
              !id ||
              id.length > 200 ||
              params.getAll('sessionId').length !== 1 ||
              [...params.keys()].some((k) => k !== 'sessionId')
            )
              return send(400, { error: '会话标识无效', retryable: false })
            try {
              send(200, await readNativeWork(host, id))
            } catch (error) {
              const failure = readFailure(error)
              send(failure.status, failure)
            }
          }
        }),
      'taskflow: native state route'
    )
    const coldIndexes = new Map<string, { revision: string; index: EvidenceIndex }>()
    host.effect(() => () => coldIndexes.clear(), 'taskflow: stored evidence cache')
    for (const kind of ['review', 'evidence'] as const)
      host.effect(
        () =>
          host.webServer.register({
            kind: 'exact',
            path: `${DEFAULTS.routePrefix}/${kind}`,
            handler: async (req: any, res: any) => {
              if (rejectUntrustedRequest(req, res, host.connection)) return
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
              if (!id || id.length > 200 || params.getAll('sessionId').length !== 1)
                return invalid('会话标识无效')
              let select: (events: readonly Event[] | EvidenceIndex, live: boolean) => unknown
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
              const respond = (events: readonly Event[] | EvidenceIndex, live: boolean): void => {
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
                if (live) {
                  coldIndexes.delete(id)
                  return respond(liveEvidence(live), true)
                }
                const revision = (await host.sessionPersistence.stat?.(id))?.revision
                const cached = coldIndexes.get(id)
                if (revision && cached && cached.revision === revision) {
                  coldIndexes.delete(id)
                  coldIndexes.set(id, cached)
                  return respond(cached.index, false)
                }
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
                const index = new EvidenceIndex().update(events)
                const after = (await host.sessionPersistence.stat?.(id))?.revision
                coldIndexes.delete(id)
                if (revision && revision === after && index.cacheCost <= 16_000_000) {
                  coldIndexes.set(id, { revision, index })
                  let chars = [...coldIndexes.values()].reduce((sum, entry) => sum + entry.index.cacheCost, 0)
                  while (coldIndexes.size > 8 || chars > 16_000_000) {
                    const oldest = coldIndexes.keys().next().value!
                    chars -= coldIndexes.get(oldest)!.index.cacheCost
                    coldIndexes.delete(oldest)
                  }
                }
                respond(index, false)
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
