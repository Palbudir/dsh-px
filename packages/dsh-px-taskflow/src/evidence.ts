/** Fold persisted DSH facts; never execute a command or infer test success from a tool return. */
export interface Event {
  seq: number
  time: number
  type: string
  data: any
}
export interface Checkpoint {
  goal: string
  summary: string
  nextStep: string
  state: 'working' | 'blocked' | 'ready_for_review'
  evidence: string[]
}
export type Outcome = 'returned' | 'error' | 'cancelled' | 'interrupted' | 'running'
export interface Execution {
  id: string
  seq: number
  tool: string
  input: string
  file: string | null
  effect: 'read' | 'write' | 'unknown'
  outcome: Outcome
  outcomeSource: 'tool' | 'command_marker' | 'turn' | 'pending'
  output: string
  outputLength: number
  outputTruncated: boolean
  time: number
  durationMs: number | null
}
export interface ReviewOptions {
  beforeSeq?: number
  limit?: number
}
export interface EvidenceOptions {
  offset?: number
  maxChars?: number
}
export interface TaskReview {
  checkpoint: (Checkpoint & { seq: number; time: number }) | null
  executions: Execution[]
  referencedExecutions: Execution[]
  total: number
  truncated: boolean
  nextBeforeSeq: number | null
  changedFiles: string[]
  checkpointStale: boolean
}
export interface EvidenceDetail extends Execution {
  outputOffset: number
  nextOutputOffset: number | null
}
const reads = new Set([
  'read',
  'ls',
  'list',
  'glob',
  'grep',
  'search',
  'web_search',
  'web_fetch',
  'present',
  'job_output',
  'job_list',
  'task_review',
  'task_evidence'
])
const writes = new Set(['write', 'edit'])
const commands = new Set(['pwsh', 'bash', 'shell'])
const internal = new Set(['task_review', 'task_evidence', 'task_checkpoint'])
const clip = (value: unknown, length: number): string =>
  typeof value === 'string' ? value.slice(0, length) : ''
function parse(value: string): any {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}
export function integerOption(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error('分页参数无效')
  return value
}
export function readCheckpoint(value: unknown): Checkpoint | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Checkpoint
  if (
    ![v.goal, v.summary, v.nextStep].every((x) => typeof x === 'string' && x.length <= 4000) ||
    !v.goal.trim() ||
    !v.summary.trim() ||
    !['working', 'blocked', 'ready_for_review'].includes(v.state) ||
    !Array.isArray(v.evidence) ||
    v.evidence.length > 20 ||
    !v.evidence.every((x) => typeof x === 'string' && x.length <= 200)
  )
    return null
  if (v.state !== 'ready_for_review' && !v.nextStep.trim()) return null
  return {
    goal: v.goal,
    summary: v.summary,
    nextStep: v.nextStep,
    state: v.state,
    evidence: [...new Set(v.evidence)]
  }
}
function effectOf(tool: string, args: any): Execution['effect'] {
  if (reads.has(tool) || (tool === 'str_replace_editor' && args.command === 'view')) return 'read'
  if (
    writes.has(tool) ||
    (tool === 'str_replace_editor' && ['create', 'str_replace', 'insert', 'undo_edit'].includes(args.command))
  )
    return 'write'
  return 'unknown'
}
function resultStatus(
  tool: string,
  text: string,
  isError: boolean
): Pick<Execution, 'outcome' | 'outcomeSource'> {
  // The host renders TOOL_ABORTED errors using this exact message. A successful read of that text is not a cancellation.
  if (isError && /^(?:Error:\s*)?tool call aborted\s*$/i.test(text))
    return { outcome: 'cancelled', outcomeSource: 'tool' }
  if (isError) return { outcome: 'error', outcomeSource: 'tool' }
  if (commands.has(tool)) {
    // Only the terminal marker block of command tools is interpreted. Persisted text cannot authenticate a marker printed by the command itself.
    const markers = text.trimEnd().split(/\r?\n/).reverse()
    for (const line of markers) {
      if (!/^\[(?:exit code: -?\d+|timed out[^\]]*|killed by signal:[^\]]*|sandbox:[^\]]*)\]$/i.test(line))
        break
      const exit = /^\[exit code: (-?\d+)\]$/i.exec(line)
      if (
        exit
          ? Number(exit[1]) !== 0
          : /^\[(?:timed out|killed by signal|sandbox: file access denied)/i.test(line)
      ) {
        return { outcome: 'error', outcomeSource: 'command_marker' }
      }
    }
  }
  return { outcome: 'returned', outcomeSource: 'tool' }
}
interface Folded {
  calls: Map<string, Execution>
  relevant: Execution[]
  checkpoint: TaskReview['checkpoint']
}
function foldEvents(events: readonly Event[], live: boolean): Folded {
  const calls = new Map<string, Execution>()
  const pending = new Set<Execution>()
  let checkpoint: TaskReview['checkpoint'] = null
  let activeTurn = false
  for (const event of events) {
    const data = event.data ?? {}
    if (['turn/start', 'turn/end', 'session/end-seed'].includes(event.type)) {
      const cancelled =
        event.type === 'turn/end' && data.reason?.kind === 'aborted' && data.reason?.reason?.kind === 'user'
      for (const call of pending) {
        call.outcome = cancelled ? 'cancelled' : 'interrupted'
        call.outcomeSource = 'turn'
      }
      pending.clear()
      activeTurn = event.type === 'turn/start'
    }
    if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
      const raw = typeof data.arguments === 'string' ? parse(data.arguments) : data.arguments
      const args = raw && typeof raw === 'object' ? raw : {}
      const id = data.callId ?? data.subCallId
      if (typeof id !== 'string' || typeof data.name !== 'string') continue
      const effect = effectOf(data.name, args)
      const previous = calls.get(id)
      if (previous) pending.delete(previous)
      const call: Execution = {
        id,
        seq: event.seq,
        tool: data.name,
        input: clip(args.command ?? args.description ?? args.path ?? args.file_path ?? '', 1200),
        file: effect === 'write' ? clip(args.path ?? args.file_path, 1000) || null : null,
        effect,
        outcome: 'running',
        outcomeSource: 'pending',
        output: '',
        outputLength: 0,
        outputTruncated: false,
        time: event.time,
        durationMs: null
      }
      calls.set(id, call)
      pending.add(call)
    }
    if (event.type === 'tool/result' || event.type === 'tool/ptc-dispatch') {
      const blocks =
        event.type === 'tool/result'
          ? (data.message?.content ?? []).filter((b: any) => b.type === 'tool-result')
          : [data]
      for (const block of blocks) {
        const call = calls.get(block.toolCallId ?? data.subCallId)
        if (!call) continue
        const text = (block.content ?? [])
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n')
        Object.assign(call, resultStatus(call.tool, text, block.isError === true))
        pending.delete(call)
        call.output = text
        call.outputLength = text.length
        call.durationMs = Math.max(0, event.time - call.time)
        if (call.tool === 'task_checkpoint' && call.outcome === 'returned') {
          const value = readCheckpoint(parse(text).checkpoint)
          if (value) checkpoint = { ...value, seq: event.seq, time: event.time }
        }
      }
    }
  }
  if (!activeTurn || !live)
    for (const call of pending) {
      call.outcome = 'interrupted'
      call.outcomeSource = 'turn'
    }
  return { calls, relevant: [...calls.values()].filter((call) => !internal.has(call.tool)), checkpoint }
}
function summary(call: Execution): Execution {
  return {
    ...call,
    input: clip(call.input, 180),
    output: clip(call.output, 240),
    outputTruncated: call.outputLength > 240
  }
}
export function reviewEvents(events: readonly Event[], live = true, options: ReviewOptions = {}): TaskReview {
  const limit = integerOption(options.limit, 20, 1, 50)
  const before = integerOption(options.beforeSeq, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER)
  const { relevant, checkpoint } = foldEvents(events, live)
  const eligible = relevant.filter((call) => call.seq < before)
  const page = eligible.slice(-limit)
  return {
    checkpoint,
    executions: page.map(summary),
    referencedExecutions: checkpoint
      ? relevant.filter((call) => checkpoint.evidence.includes(call.id)).map(summary)
      : [],
    total: relevant.length,
    truncated: eligible.length > page.length,
    nextBeforeSeq: eligible.length > page.length ? page[0].seq : null,
    changedFiles: [
      ...new Set(
        relevant.filter((call) => call.file && call.outcome === 'returned').map((call) => call.file!)
      )
    ].slice(-200),
    checkpointStale: Boolean(
      checkpoint && relevant.some((call) => call.seq > checkpoint.seq && call.effect !== 'read')
    )
  }
}
export function evidenceDetail(
  events: readonly Event[],
  id: string,
  live = true,
  options: EvidenceOptions = {}
): EvidenceDetail | null {
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('执行编号无效')
  const offset = integerOption(options.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const size = integerOption(options.maxChars, 4000, 1, 8000)
  const call = foldEvents(events, live).relevant.find((call) => call.id === id)
  if (!call) return null
  const next = offset + size < call.outputLength ? offset + size : null
  return {
    ...call,
    output: call.output.slice(offset, offset + size),
    outputOffset: offset,
    outputTruncated: offset > 0 || next !== null,
    nextOutputOffset: next
  }
}
export function validateCheckpoint(args: unknown, events: readonly Event[]): Checkpoint {
  const checkpoint = readCheckpoint(args)
  if (!checkpoint) throw new Error('任务记录格式无效；进行中或阻塞时必须填写下一步。')
  const { calls } = foldEvents(events, true)
  for (const id of checkpoint.evidence) {
    const call = calls.get(id)
    if (!call || internal.has(call.tool) || !['returned', 'error'].includes(call.outcome))
      throw new Error(`证据 ${id} 不存在，或没有已结算结果；请先 task_review / task_evidence 核对。`)
  }
  if (checkpoint.state === 'ready_for_review' && checkpoint.evidence.length === 0)
    throw new Error('交付前至少引用一条实际执行记录；这不是测试覆盖率或代码正确性的保证。')
  return checkpoint
}
