import { reviewEvents, validateCheckpoint, type Event } from './evidence'

export const name = 'dsh-px-taskflow'
export const inject: string[] = []
export const DEFAULTS = { routePrefix: '/dsh-px-taskflow' }
interface Session { header: { cwd?: string }, snapshotEvents: () => readonly Event[] }
interface Run { signal: AbortSignal, agent?: { session: Session } }
interface Context {
  inject: (names: string[], callback: (ctx: any) => void) => unknown
  effect: (fn: () => (() => void) | void, name?: string) => unknown
}
const POLICY = `You are working inside DSH-PX, a local agent product. Respond in the user's language; for Chinese requests, write progress and final delivery in Chinese. For non-trivial implementation tasks, carry the work through inspection, implementation, relevant validation, and a reviewable delivery. Read repository instructions, inspect existing changes, and preserve unrelated work. Use the host's todo, file, shell, permission, and delivery tools; obey plan mode and user instructions. Do not invent a separate execution or approval mechanism.
For a multi-step implementation task, record the goal and next action with task_checkpoint. On resuming or being asked for progress, call task_review to recover the latest checkpoint and actual execution evidence. Before final delivery, inspect the changes with the existing Git/file tools, run the relevant checks, then call task_review and record a ready_for_review checkpoint referencing actual call ids. Tool return success does not prove tests passed: read the output and state what was and was not verified. If blocked, record the concrete blocker and next action. Never retry a possibly mutating interrupted call blindly; reconcile its effect first. Skip checkpoints for simple questions or trivial edits. A checkpoint is a work note, not user approval or permission to continue autonomously in the background.`
export function apply (ctx: Context): void {
  ctx.inject(['systemPrompt'], host => {
    host.effect(() => host.systemPrompt.section({ name: 'dsh-px-delivery-workflow', order: 9900, text: POLICY }), 'taskflow: workflow')
  })
  ctx.inject(['tools'], host => {
    const output = { schema: { type: 'string' }, render: (_: unknown, value: string) => [{ type: 'text', text: value }] }
    const session = (exec: Run): Session => { exec.signal.throwIfAborted(); if (!exec.agent) throw new Error('此工具需要当前会话'); return exec.agent.session }
    host.tools.register({ name: 'task_review', description: '读取当前任务的持久工作记录与真实工具执行证据。恢复工作、核对进度或交付前使用。returned 只表示工具正常返回，不代表测试或任务通过。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }, output,
      execute: async (_: unknown, exec: Run) => JSON.stringify(reviewEvents(session(exec).snapshotEvents())) })
    host.tools.register({ name: 'task_checkpoint', description: '保存多步骤任务的目标、进展、下一步和执行证据引用到当前会话。不能替代测试或批准；引用 task_review 返回的实际 call id，可引用成功或失败的已结算记录（例如复现失败的测试），但不能引用进行中或结果未知的调用。',
      parameters: { type: 'object', additionalProperties: false, required: ['goal', 'summary', 'nextStep', 'state', 'evidence'], properties: {
        goal: { type: 'string' }, summary: { type: 'string' }, nextStep: { type: 'string' },
        state: { type: 'string', enum: ['working', 'blocked', 'ready_for_review'] }, evidence: { type: 'array', items: { type: 'string' } }
      } }, output,
      execute: async (args: unknown, exec: Run) => JSON.stringify({ checkpoint: validateCheckpoint(args, session(exec).snapshotEvents()) }) })
  })
  ctx.inject(['webServer', 'sessions', 'sessionPersistence'], host => {
    host.effect(() => host.webServer.register({ kind: 'exact', path: `${DEFAULTS.routePrefix}/review`, handler: async (req: any, res: any) => {
      const send = (status: number, data: unknown): void => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)) }
      if (req.method !== 'GET') return send(405, { error: '请使用 GET' })
      const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
      const id = params.get('sessionId')
      if (!id || id.length > 200 || params.getAll('sessionId').length !== 1 || !/^[a-zA-Z0-9_-]+$/.test(id)) return send(400, { error: '会话标识无效' })
      try {
        const live = host.sessions.get(id) as Session | undefined
        if (live) return send(200, reviewEvents(live.snapshotEvents()))
        const handle = await host.sessionPersistence.open(id, 'read')
        try { const { events } = await handle.read(); send(200, reviewEvents(events, false)) } finally { await handle.close() }
      } catch { send(404, { error: '无法读取此会话，稍后重试。' }) }
    } }), 'taskflow: review route')
  })
}
