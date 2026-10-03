/** Fold persisted DSH facts; never execute a command or infer test success from a tool return. */
import { CommandGuidanceIndex, type CommandGuidance } from './command-guidance'
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
  changedFilesTotal: number
  changedFilesTruncated: boolean
  checkpointStale: boolean
}
export interface EvidenceDetail extends Execution {
  outputOffset: number
  nextOutputOffset: number | null
  commandGuidance?: CommandGuidance
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
  commands: CommandGuidanceIndex
  calls: Map<string, Execution>
  relevant: Execution[]
  checkpoint: TaskReview['checkpoint']
  pending: Set<Execution>
  activeTurn: boolean
  changedFiles: Map<string, number>
  changedFileSet: Set<string>
  lastNonReadSeq: number
}
function emptyFold(): Folded {
  return {
    commands: new CommandGuidanceIndex(),
    calls: new Map(),
    relevant: [],
    checkpoint: null,
    pending: new Set(),
    activeTurn: false,
    changedFiles: new Map(),
    changedFileSet: new Set(),
    lastNonReadSeq: -1
  }
}
/** Retains only execution evidence. An unchanged native snapshot costs no event replay. */
export class EvidenceIndex {
  private folded = emptyFold()
  private count = 0
  private first: Event | undefined
  private last: Event | undefined
  retainedChars = 0
  processedEvents = 0
  get cacheCost(): number {
    return this.retainedChars * 2 + this.folded.calls.size * 256 + this.folded.commands.cacheCost
  }
  update(events: readonly Event[]): this {
    if (
      events.length < this.count ||
      (this.count > 0 && (events[0] !== this.first || events[this.count - 1] !== this.last))
    ) {
      this.folded = emptyFold()
      this.count = 0
      this.retainedChars = 0
    }
    const { calls, pending, relevant } = this.folded
    for (let i = this.count; i < events.length; i++) {
      const event = events[i]
      this.processedEvents++
      const data = event.data ?? {}
      this.folded.commands.observe(event.type, data)
      if (['turn/start', 'turn/end', 'session/end-seed'].includes(event.type)) {
        const cancelled =
          event.type === 'turn/end' && data.reason?.kind === 'aborted' && data.reason?.reason?.kind === 'user'
        for (const call of pending) {
          call.outcome = cancelled ? 'cancelled' : 'interrupted'
          call.outcomeSource = 'turn'
        }
        pending.clear()
        this.folded.activeTurn = event.type === 'turn/start'
      }
      if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
        const raw = typeof data.arguments === 'string' ? parse(data.arguments) : data.arguments
        const args = raw && typeof raw === 'object' ? raw : {}
        const id = data.callId ?? data.subCallId
        if (typeof id !== 'string' || typeof data.name !== 'string') continue
        const effect = effectOf(data.name, args)
        this.folded.commands.start(id, data.name, args, event.seq)
        const previous = calls.get(id)
        if (previous) {
          pending.delete(previous)
          this.retainedChars -= previous.input.length + previous.outputLength
          const oldIndex = relevant.indexOf(previous)
          if (oldIndex >= 0) relevant.splice(oldIndex, 1)
        }
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
        if (!internal.has(call.tool)) {
          relevant.push(call)
          if (call.effect !== 'read') this.folded.lastNonReadSeq = call.seq
        }
        this.retainedChars += call.input.length
        pending.add(call)
      }
      if (event.type === 'tool/result' || event.type === 'tool/ptc-dispatch') {
        const blocks =
          event.type === 'tool/result'
            ? data.message?.role === 'tool' && typeof data.message.toolCallId === 'string'
              ? [data.message]
              : (data.message?.content ?? []).filter((b: any) => b.type === 'tool-result')
            : [data]
        for (const block of blocks) {
          const call = calls.get(block.toolCallId ?? data.subCallId)
          if (!call) continue
          const text = (block.content ?? [])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n')
          Object.assign(call, resultStatus(call.tool, text, block.isError === true))
          this.folded.commands.finish(call.id, call.outcome, text)
          pending.delete(call)
          this.retainedChars += text.length - call.outputLength
          call.output = text
          call.outputLength = text.length
          call.durationMs = Math.max(0, event.time - call.time)
          if (call.file && call.outcome === 'returned') {
            this.folded.changedFileSet.add(call.file)
            this.folded.changedFiles.delete(call.file)
            this.folded.changedFiles.set(call.file, call.seq)
            if (this.folded.changedFiles.size > 200)
              this.folded.changedFiles.delete(this.folded.changedFiles.keys().next().value!)
          }
          if (call.tool === 'task_checkpoint' && call.outcome === 'returned') {
            const value = readCheckpoint(parse(text).checkpoint)
            if (value) this.folded.checkpoint = { ...value, seq: event.seq, time: event.time }
          }
        }
      }
    }
    this.count = events.length
    this.first = events[0]
    this.last = events.at(-1)
    return this
  }
  snapshot(): Folded {
    return this.folded
  }
}
const indexes = new WeakMap<readonly Event[], EvidenceIndex>()
function foldEvents(events: readonly Event[] | EvidenceIndex): Folded {
  if (events instanceof EvidenceIndex) return events.snapshot()
  let index = indexes.get(events)
  if (!index) indexes.set(events, (index = new EvidenceIndex()))
  return index.update(events).snapshot()
}
function visibleCall(call: Execution, fold: Folded, live: boolean): Execution {
  return (!fold.activeTurn || !live) && fold.pending.has(call)
    ? { ...call, outcome: 'interrupted', outcomeSource: 'turn' }
    : call
}
function summary(call: Execution): Execution {
  return {
    ...call,
    input: clip(call.input, 180),
    output: clip(call.output, 240),
    outputTruncated: call.outputLength > 240
  }
}
export function reviewEvents(
  events: readonly Event[] | EvidenceIndex,
  live = true,
  options: ReviewOptions = {}
): TaskReview {
  const limit = integerOption(options.limit, 20, 1, 50)
  const before = integerOption(options.beforeSeq, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER)
  const folded = foldEvents(events)
  const { relevant, checkpoint } = folded
  let lo = 0,
    hi = relevant.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (relevant[mid].seq < before) lo = mid + 1
    else hi = mid
  }
  const start = Math.max(0, lo - limit),
    page = relevant.slice(start, lo)
  return {
    checkpoint,
    executions: page.map((call) => summary(visibleCall(call, folded, live))),
    referencedExecutions: checkpoint
      ? checkpoint.evidence.flatMap((id) => {
          const call = folded.calls.get(id)
          return call && !internal.has(call.tool) ? [summary(visibleCall(call, folded, live))] : []
        })
      : [],
    total: relevant.length,
    truncated: start > 0,
    nextBeforeSeq: start > 0 ? page[0].seq : null,
    changedFiles: [...folded.changedFiles.keys()],
    changedFilesTotal: folded.changedFileSet.size,
    changedFilesTruncated: folded.changedFileSet.size > folded.changedFiles.size,
    checkpointStale: Boolean(checkpoint && folded.lastNonReadSeq > checkpoint.seq)
  }
}
export function evidenceDetail(
  events: readonly Event[] | EvidenceIndex,
  id: string,
  live = true,
  options: EvidenceOptions = {}
): EvidenceDetail | null {
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('执行编号无效')
  const offset = integerOption(options.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const size = integerOption(options.maxChars, 4000, 1, 8000)
  const folded = foldEvents(events)
  const source = folded.calls.get(id)
  if (!source || internal.has(source.tool)) return null
  const call = visibleCall(source, folded, live)
  const next = offset + size < call.outputLength ? offset + size : null
  const commandGuidance = folded.commands.guidance(id)
  return {
    ...call,
    output: call.output.slice(offset, offset + size),
    outputOffset: offset,
    outputTruncated: offset > 0 || next !== null,
    nextOutputOffset: next,
    ...(commandGuidance ? { commandGuidance } : {})
  }
}
export function validateCheckpoint(args: unknown, events: readonly Event[] | EvidenceIndex): Checkpoint {
  const checkpoint = readCheckpoint(args)
  if (!checkpoint) throw new Error('任务记录格式无效；进行中或阻塞时必须填写下一步。')
  const { calls } = foldEvents(events)
  for (const id of checkpoint.evidence) {
    const call = calls.get(id)
    if (!call || internal.has(call.tool) || !['returned', 'error'].includes(call.outcome))
      throw new Error(`证据 ${id} 不存在，或没有已结算结果；请先 task_review / task_evidence 核对。`)
  }
  if (checkpoint.state === 'ready_for_review' && checkpoint.evidence.length === 0)
    throw new Error('交付前至少引用一条实际执行记录；这不是测试覆盖率或代码正确性的保证。')
  return checkpoint
}
