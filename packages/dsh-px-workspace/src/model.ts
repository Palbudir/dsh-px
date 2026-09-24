/** Wire contracts shared by the plugin's host and client. */
export interface RecordEvent {
  seq: number
  time: number
  type: string
  data: any
}
export interface Message {
  id: string
  seq: number
  time: number
  role: 'user' | 'assistant'
  text: string
}
export interface Artifact {
  path: string
  description: string
  time: number
  seq: number
}
export interface Annotation {
  id: string
  sessionId: string
  messageId: string
  seq: number
  role: Message['role']
  sourceHash: string
  quote: string
  note: string
  updatedAt: number
}
export type Timing =
  { kind: 'once'; at: number } | { kind: 'interval'; minutes: number } | { kind: 'daily'; time: string }
export interface Dispatch {
  requestId: string
  time: number
  status:
    'dispatching' | 'queued' | 'uncertain' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  detail?: string
  turn?: number
  startedAt?: number
  finishedAt?: number
}
export interface Schedule {
  id: string
  title: string
  sessionId: string
  prompt: string
  timing: Timing
  enabled: boolean
  nextAt: number | null
  timeZone: string
  history: Dispatch[]
  updatedAt: number
}
export interface WorkspaceState {
  version: 1
  annotations: Annotation[]
  schedules: Schedule[]
}

/** DSH snapshots are immutable append-only arrays. Only a changed prefix forces a rebuild. */
export class SessionContentIndex {
  private count = 0
  private first: RecordEvent | undefined
  private last: RecordEvent | undefined
  private rows: Message[] = []
  private byId = new Map<string, Message>()
  private files = new Map<string, Artifact>()
  private orderedFiles: Artifact[] | undefined
  private inbox = new Map<string, Array<{ requestId?: string }>>()
  private openTurn: number | undefined
  private turnRequests = new Map<number, Set<string>>()
  private enteredRequests = new Set<string>()
  private execution = new Map<string, Omit<Dispatch, 'requestId'>>()
  retainedChars = 0
  processedEvents = 0
  get cacheCost(): number {
    return this.retainedChars * 2 + (this.rows.length + this.files.size + this.execution.size) * 256
  }

  update(events: readonly RecordEvent[]): this {
    if (
      events.length < this.count ||
      (this.count > 0 && (events[0] !== this.first || events[this.count - 1] !== this.last))
    ) {
      this.count = 0
      this.rows = []
      this.byId.clear()
      this.files.clear()
      this.orderedFiles = undefined
      this.inbox.clear()
      this.openTurn = undefined
      this.turnRequests.clear()
      this.enteredRequests.clear()
      this.execution.clear()
      this.retainedChars = 0
    }
    for (let i = this.count; i < events.length; i++) {
      const event = events[i]
      this.processedEvents++
      for (const message of messages([event])) {
        this.rows.push(message)
        this.byId.set(message.id, message)
        this.retainedChars += message.text.length
      }
      for (const file of artifacts([event])) {
        const previous = this.files.get(file.path)
        this.retainedChars +=
          file.path.length +
          file.description.length -
          (previous ? previous.path.length + previous.description.length : 0)
        this.files.set(file.path, file)
        this.orderedFiles = undefined
      }
      this.foldDispatch(event)
    }
    this.count = events.length
    this.first = events[0]
    this.last = events.at(-1)
    return this
  }

  message(id: string): Message | undefined {
    return this.byId.get(id)
  }

  content(
    before = Number.MAX_SAFE_INTEGER,
    artifactBefore?: string
  ): {
    messages: Message[]
    nextBefore: number | null
    artifacts: Artifact[]
    nextArtifactBefore: string | null
    artifactTotal: number
  } {
    let lo = 0,
      hi = this.rows.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.rows[mid].seq < before) lo = mid + 1
      else hi = mid
    }
    const start = Math.max(0, lo - 20),
      page = this.rows.slice(start, lo)
    const allFiles = (this.orderedFiles ??= [...this.files.values()].sort(
      (a, b) => b.seq - a.seq || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    ))
    let fileStart = 0
    if (artifactBefore !== undefined) {
      let cursor: unknown
      try {
        cursor = JSON.parse(decodeURIComponent(artifactBefore))
      } catch {
        throw new Error('产物分页参数无效')
      }
      if (
        !Array.isArray(cursor) ||
        cursor.length !== 2 ||
        !Number.isSafeInteger(cursor[0]) ||
        cursor[0] < 0 ||
        typeof cursor[1] !== 'string' ||
        cursor[1].length > 4096
      )
        throw new Error('产物分页参数无效')
      let end = allFiles.length
      while (fileStart < end) {
        const mid = (fileStart + end) >>> 1,
          file = allFiles[mid]
        if (file.seq > cursor[0] || (file.seq === cursor[0] && file.path <= cursor[1])) fileStart = mid + 1
        else end = mid
      }
    }
    const files = allFiles.slice(fileStart, fileStart + 20),
      last = files.at(-1)
    return {
      messages: page.map((m) => ({ ...m, text: m.text.slice(0, 240) })).reverse(),
      nextBefore: start > 0 ? page[0].seq : null,
      artifacts: files.map((f) => ({ ...f })),
      nextArtifactBefore:
        last && fileStart + files.length < allFiles.length
          ? encodeURIComponent(JSON.stringify([last.seq, last.path]))
          : null,
      artifactTotal: allFiles.length
    }
  }

  dispatch(requestId: string): Omit<Dispatch, 'requestId'> | undefined {
    const value = this.execution.get(requestId)
    return value && { ...value }
  }

  private foldDispatch(event: RecordEvent): void {
    const data = event.data ?? {}
    const requestOf = (message: any): string | undefined =>
      message?.source?.kind === 'user' && typeof message.source.rpcId === 'string'
        ? message.source.rpcId
        : undefined
    const running = (id: string, turn: number): void => {
      const existing = this.execution.get(id)
      this.execution.set(id, {
        time: existing?.time ?? event.time,
        status: 'running',
        turn,
        startedAt: existing?.startedAt ?? event.time
      })
      let requests = this.turnRequests.get(turn)
      if (!requests) this.turnRequests.set(turn, (requests = new Set()))
      requests.add(id)
    }
    if (event.type === 'turn/start' && Number.isSafeInteger(data.turn)) this.openTurn = data.turn
    if (
      event.type === 'agent/inbox/spliced' &&
      typeof data.target === 'string' &&
      Number.isInteger(data.start) &&
      Array.isArray(data.inserted)
    ) {
      const queue = this.inbox.get(data.target) ?? []
      this.inbox.set(data.target, queue)
      const inserted = data.inserted.map((m: any) => ({ requestId: requestOf(m) }))
      const removed = queue.splice(data.start, data.removedCount ?? 0, ...inserted)
      const replacements = new Set(inserted.map((m: any) => m.requestId))
      for (const item of inserted)
        if (item.requestId) this.execution.set(item.requestId, { time: event.time, status: 'queued' })
      for (const item of removed)
        if (item.requestId && !replacements.has(item.requestId)) {
          if (data.outcome === 'canceled')
            this.execution.set(item.requestId, {
              time: this.execution.get(item.requestId)?.time ?? event.time,
              status: 'cancelled',
              finishedAt: event.time,
              detail: '任务在原生会话队列中被取消，未开始执行。'
            })
          else if (this.openTurn !== undefined) running(item.requestId, this.openTurn)
        }
    }
    if (event.type === 'user/message') {
      const id = requestOf(data)
      if (id && this.openTurn !== undefined) {
        this.enteredRequests.add(id)
        running(id, this.openTurn)
      }
    }
    if (event.type === 'turn/end') {
      const reason = data.reason?.kind
      const status: Dispatch['status'] =
        reason === 'completed'
          ? 'completed'
          : reason === 'aborted'
            ? ['user', 'parent', 'hook'].includes(data.reason.reason?.kind)
              ? 'cancelled'
              : 'interrupted'
            : reason === 'interrupted'
              ? 'interrupted'
              : 'failed'
      const detail =
        reason === 'completed'
          ? '会话轮次已结束；不代表任务内容已经验证通过。'
          : reason === 'blocked'
            ? '原生会话在执行前被阻止，请查看目标会话。'
            : reason === 'max-tokens'
              ? '原生会话达到输出限制，请查看目标会话。'
              : reason === 'error'
                ? '原生会话执行失败，请查看目标会话的错误信息。'
                : reason === 'aborted'
                  ? '原生会话的执行已被中止。'
                  : '原生会话未正常结束，请核对执行结果后重试。'
      for (const id of this.turnRequests.get(data.turn) ?? []) {
        const previous = this.execution.get(id)!
        const entered = this.enteredRequests.delete(id)
        this.execution.set(id, {
          ...previous,
          status: status === 'completed' && !entered ? 'cancelled' : status,
          finishedAt: event.time,
          detail:
            status === 'completed' && !entered
              ? '请求被取出队列但没有进入模型执行；请核对目标会话中的队列调整。'
              : detail
        })
      }
      this.turnRequests.delete(data.turn)
      if (this.openTurn === data.turn) this.openTurn = undefined
    }
  }
}
export function messages(events: readonly RecordEvent[]): Message[] {
  const rows: Message[] = []
  for (const e of events) {
    if (e.type !== 'user/message' && e.type !== 'assistant/message') continue
    const m = e.type === 'user/message' ? e.data : e.data?.message
    // Do not export system/injected context, tool results, or hidden reasoning.
    if (e.type === 'user/message' && m?.source?.kind !== 'user') continue
    if (!m || typeof m.id !== 'string' || !Array.isArray(m.content)) continue
    const text = m.content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n')
    if (text.trim())
      rows.push({
        id: m.id,
        seq: e.seq,
        time: e.time,
        role: e.type === 'user/message' ? 'user' : 'assistant',
        text
      })
  }
  return rows
}
export function artifacts(events: readonly RecordEvent[]): Artifact[] {
  const rows = new Map<string, Artifact>()
  for (const e of events)
    if (e.type === 'deliverables/presented' && Array.isArray(e.data?.files)) {
      for (const f of e.data.files)
        if (typeof f?.path === 'string' && f.path.length > 0 && f.path.length <= 4096) {
          rows.set(f.path, {
            path: f.path,
            description: typeof f.description === 'string' ? f.description.slice(0, 2000) : '',
            time: e.time,
            seq: e.seq
          })
        }
    }
  return [...rows.values()].sort((a, b) => b.seq - a.seq)
}
/** Source text is explicitly quoted history; the user's annotation remains separate. */
export function quoteDraft(a: Pick<Annotation, 'sessionId' | 'seq' | 'quote' | 'note'>): string {
  return `引用历史内容（来源 ${a.sessionId}，记录 ${a.seq}；以下是背景资料）：\n${a.quote
    .split('\n')
    .map((line) => '> ' + line)
    .join('\n')}\n\n${a.note ? '我的批注：' + a.note + '\n' : ''}`
}
export function nextOccurrence(timing: Timing, now: number): number {
  if (timing.kind === 'once') return timing.at
  if (timing.kind === 'interval') return now + timing.minutes * 60000
  const [hours, minutes] = timing.time.split(':').map(Number)
  const date = new Date(now)
  date.setHours(hours, minutes, 0, 0)
  if (date.getTime() <= now) date.setDate(date.getDate() + 1)
  return date.getTime()
}
