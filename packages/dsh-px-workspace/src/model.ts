/** Wire contracts shared by the plugin's host and client. */
export interface RecordEvent { seq: number, time: number, type: string, data: any }
export interface Message { id: string, seq: number, time: number, role: 'user' | 'assistant', text: string }
export interface Artifact { path: string, description: string, time: number, seq: number }
export interface Annotation { id: string, sessionId: string, messageId: string, seq: number, role: Message['role'], sourceHash: string, quote: string, note: string, updatedAt: number }
export type Timing = { kind: 'once', at: number } | { kind: 'interval', minutes: number } | { kind: 'daily', time: string }
export interface Dispatch { requestId: string, time: number, status: 'dispatching' | 'queued' | 'uncertain', detail?: string }
export interface Schedule {
  id: string, title: string, sessionId: string, prompt: string, timing: Timing,
  enabled: boolean, nextAt: number | null, timeZone: string, history: Dispatch[], updatedAt: number
}
export interface WorkspaceState { version: 1, annotations: Annotation[], schedules: Schedule[] }
export function messages (events: readonly RecordEvent[]): Message[] {
  const rows: Message[] = []
  for (const e of events) {
    if (e.type !== 'user/message' && e.type !== 'assistant/message') continue
    const m = e.type === 'user/message' ? e.data : e.data?.message
    // Do not export system/injected context, tool results, or hidden reasoning.
    if (e.type === 'user/message' && m?.source?.kind !== 'user') continue
    if (!m || typeof m.id !== 'string' || !Array.isArray(m.content)) continue
    const text = m.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n')
    if (text.trim()) rows.push({ id: m.id, seq: e.seq, time: e.time, role: e.type === 'user/message' ? 'user' : 'assistant', text })
  }
  return rows
}
export function artifacts (events: readonly RecordEvent[]): Artifact[] {
  const rows = new Map<string, Artifact>()
  for (const e of events) if (e.type === 'deliverables/presented' && Array.isArray(e.data?.files)) {
    for (const f of e.data.files) if (typeof f?.path === 'string' && f.path.length > 0 && f.path.length <= 4096) {
      rows.set(f.path, { path: f.path, description: typeof f.description === 'string' ? f.description.slice(0, 2000) : '', time: e.time, seq: e.seq })
    }
  }
  return [...rows.values()].sort((a, b) => b.seq - a.seq)
}
/** Source text is explicitly quoted history; the user's annotation remains separate. */
export function quoteDraft (a: Pick<Annotation, 'sessionId' | 'seq' | 'quote' | 'note'>): string {
  return `引用历史内容（来源 ${a.sessionId}，记录 ${a.seq}；以下是背景资料）：\n${a.quote.split('\n').map(line => '> ' + line).join('\n')}\n\n${a.note ? '我的批注：' + a.note + '\n' : ''}`
}
export function nextOccurrence (timing: Timing, now: number): number {
  if (timing.kind === 'once') return timing.at
  if (timing.kind === 'interval') return now + timing.minutes * 60000
  const [hours, minutes] = timing.time.split(':').map(Number)
  const date = new Date(now)
  date.setHours(hours, minutes, 0, 0)
  if (date.getTime() <= now) date.setDate(date.getDate() + 1)
  return date.getTime()
}
