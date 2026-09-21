/** 仅折叠 DSH 已持久化的事实；不执行命令，不根据模型总结伪造测试结果。 */
export interface Event { seq: number, time: number, type: string, data: any }
export interface Checkpoint {
  goal: string
  summary: string
  nextStep: string
  state: 'working' | 'blocked' | 'ready_for_review'
  evidence: string[]
}
export interface Execution {
  id: string, seq: number, tool: string, input: string, file: string | null,
  outcome: 'returned' | 'error' | 'interrupted' | 'running',
  output: string, time: number, durationMs: number | null
}
export interface TaskReview {
  checkpoint: (Checkpoint & { seq: number, time: number }) | null
  executions: Execution[]
  total: number
  truncated: boolean
  changedFiles: string[]
  checkpointStale: boolean
}
const clip = (value: unknown, length: number): string => typeof value === 'string' ? value.slice(0, length) : ''
const writes = new Set(['write', 'edit', 'str_replace_editor'])
function parse (value: string): any { try { return JSON.parse(value) } catch { return {} } }
export function readCheckpoint (value: unknown): Checkpoint | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Checkpoint
  if (![v.goal, v.summary, v.nextStep].every(x => typeof x === 'string' && x.length <= 4000) || !v.goal.trim() || !v.summary.trim() ||
    !['working', 'blocked', 'ready_for_review'].includes(v.state) || !Array.isArray(v.evidence) || v.evidence.length > 20 || !v.evidence.every(x => typeof x === 'string' && x.length <= 200)) return null
  if (v.state !== 'ready_for_review' && !v.nextStep.trim()) return null
  return { goal: v.goal, summary: v.summary, nextStep: v.nextStep, state: v.state, evidence: [...new Set(v.evidence)] }
}
export function reviewEvents (events: readonly Event[], live = true): TaskReview {
  const calls = new Map<string, Execution>()
  let checkpoint: TaskReview['checkpoint'] = null
  let activeTurn = false
  for (const event of events) {
    const data = event.data
    if (['turn/start', 'turn/end', 'session/end-seed'].includes(event.type)) {
      for (const call of calls.values()) if (call.outcome === 'running') call.outcome = 'interrupted'
      activeTurn = event.type === 'turn/start'
    }
    if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
      const rawArgs = typeof data.arguments === 'string' ? parse(data.arguments) : data.arguments
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
      const id = data.callId ?? data.subCallId
      if (typeof id !== 'string' || typeof data.name !== 'string') continue
      calls.set(id, { id, seq: event.seq, tool: data.name,
        input: clip(args.command ?? args.description ?? args.path ?? args.file_path ?? '', 1200),
        file: writes.has(data.name) ? clip(args.path ?? args.file_path, 1000) || null : null,
        outcome: 'running', output: '', time: event.time, durationMs: null })
    }
    if (event.type === 'tool/result' || event.type === 'tool/ptc-dispatch') {
      const block = event.type === 'tool/result' ? data.message?.content?.find((b: any) => b.type === 'tool-result') : data
      if (!block) continue
      const call = calls.get(block.toolCallId ?? data.subCallId)
      if (!call) continue
      const text = (block.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      const failedExit = [...text.matchAll(/\[exit code:\s*(-?\d+)\]/gi)].some(match => Number(match[1]) !== 0)
      call.outcome = block.isError || failedExit || /\[sandbox: file access denied|\[timed out/i.test(text) ? 'error' : 'returned'
      call.output = text.length > 2400 ? text.slice(0, 1600) + '\n…输出已截断，完整内容见会话工具记录…\n' + text.slice(-800) : text
      call.durationMs = Math.max(0, event.time - call.time)
      if (call.tool === 'task_checkpoint' && call.outcome === 'returned') {
        const value = readCheckpoint(parse(text).checkpoint)
        if (value) checkpoint = { ...value, seq: event.seq, time: event.time }
      }
    }
  }
  const relevant = [...calls.values()].filter(call => !['task_review', 'task_checkpoint'].includes(call.tool))
  for (const call of relevant) if (call.outcome === 'running' && (!activeTurn || !live)) call.outcome = 'interrupted'
  return {
    checkpoint, executions: relevant.slice(-80), total: relevant.length, truncated: relevant.length > 80,
    changedFiles: [...new Set(relevant.filter(call => call.file && call.outcome === 'returned').map(call => call.file!))].slice(-200),
    checkpointStale: Boolean(checkpoint && relevant.some(call => call.seq > checkpoint!.seq))
  }
}
export function validateCheckpoint (args: unknown, events: readonly Event[]): Checkpoint {
  const checkpoint = readCheckpoint(args)
  if (!checkpoint) throw new Error('任务记录格式无效；进行中或阻塞时必须填写下一步。')
  const review = reviewEvents(events)
  for (const id of checkpoint.evidence) {
    const call = review.executions.find(call => call.id === id)
    if (!call || !['returned', 'error'].includes(call.outcome)) throw new Error(`证据 ${id} 不存在、已超出近期记录，或没有已结算结果；请先 task_review 核对。`)
  }
  if (checkpoint.state === 'ready_for_review' && checkpoint.evidence.length === 0) throw new Error('交付前至少引用一条实际执行记录；这不是测试覆盖率或代码正确性的保证。')
  return checkpoint
}
