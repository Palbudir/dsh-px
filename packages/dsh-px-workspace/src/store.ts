import { mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { diagnostic } from '../../shared/diagnostics'
import {
  nextOccurrence,
  type Annotation,
  type Message,
  type Schedule,
  type Timing,
  type WorkspaceState
} from './model'

export class InputError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new InputError('记录标识无效')
  return value
}
function text(value: unknown, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new InputError(`文本不能为空且不能超过 ${max} 字符`)
  return value
}
export function timing(value: any): Timing {
  if (value?.kind === 'once' && Number.isSafeInteger(value.at) && value.at > 0 && value.at < 8640000000000000)
    return { kind: 'once', at: value.at }
  if (
    value?.kind === 'interval' &&
    Number.isInteger(value.minutes) &&
    value.minutes >= 1 &&
    value.minutes <= 525600
  )
    return { kind: 'interval', minutes: value.minutes }
  if (
    value?.kind === 'daily' &&
    typeof value.time === 'string' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)
  )
    return { kind: 'daily', time: value.time }
  throw new InputError('请选择有效时间；间隔至少 1 分钟')
}
function finite(n: unknown): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
}
function validateState(v: any): asserts v is WorkspaceState {
  if (
    v?.version !== 1 ||
    !Array.isArray(v.annotations) ||
    !Array.isArray(v.schedules) ||
    v.annotations.length > 2000 ||
    v.schedules.length > 100
  )
    throw new Error('工作区数据格式不受支持')
  const ids = new Set<string>()
  for (const a of v.annotations) {
    identifier(a.id)
    identifier(a.sessionId)
    identifier(a.messageId)
    text(a.quote, 8000)
    text(a.note, 4000, false)
    if (
      !Number.isInteger(a.seq) ||
      a.seq < 0 ||
      !['user', 'assistant'].includes(a.role) ||
      !/^[a-f0-9]{64}$/.test(a.sourceHash) ||
      !finite(a.updatedAt) ||
      ids.has(a.id)
    )
      throw new Error('批注数据损坏')
    ids.add(a.id)
  }
  for (const s of v.schedules) {
    identifier(s.id)
    identifier(s.sessionId)
    text(s.title, 100)
    text(s.prompt, 4000)
    timing(s.timing)
    if (
      typeof s.enabled !== 'boolean' ||
      !(s.nextAt === null || finite(s.nextAt)) ||
      (s.enabled && s.nextAt === null) ||
      !finite(s.updatedAt) ||
      !Array.isArray(s.history) ||
      s.history.length > 20 ||
      ids.has(s.id)
    )
      throw new Error('定时任务数据损坏')
    if (typeof s.timeZone !== 'string') throw new Error('任务时区缺失')
    new Intl.DateTimeFormat('en', { timeZone: s.timeZone })
    for (const h of s.history)
      if (
        !finite(h.time) ||
        !['dispatching', 'queued', 'uncertain'].includes(h.status) ||
        typeof h.requestId !== 'string' ||
        (h.detail !== undefined && typeof h.detail !== 'string')
      )
        throw new Error('投递记录损坏')
    ids.add(s.id)
  }
}
export class WorkspaceStore {
  private state: WorkspaceState
  constructor(readonly path: string) {
    try {
      if (statSync(path).size > 32 * 1024 * 1024) throw new Error('工作区数据文件过大')
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      validateState(parsed)
      this.state = parsed
    } catch (error: any) {
      if (error?.code !== 'ENOENT')
        throw new Error('无法读取会话工作区数据，请保留原文件并检查日志。' + String(error))
      this.state = { version: 1, annotations: [], schedules: [] }
    }
  }
  snapshot(): WorkspaceState {
    return structuredClone(this.state)
  }
  schedules(): Schedule[] {
    return structuredClone(this.state.schedules)
  }
  annotations(
    sessionId: string,
    before?: string
  ): { annotations: Annotation[]; total: number; nextBefore: string | null } {
    const all = this.state.annotations
      .filter((a) => a.sessionId === sessionId)
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    let rows = all
    if (before !== undefined) {
      const match = /^(\d{1,15}):([a-zA-Z0-9_-]{1,200})$/.exec(before)
      if (!match) throw new InputError('批注分页参数无效')
      const time = Number(match[1]),
        id = match[2]
      rows = rows.filter((a) => a.updatedAt < time || (a.updatedAt === time && a.id < id))
    }
    const page = rows.slice(0, 20),
      last = page[page.length - 1]
    return {
      annotations: structuredClone(page),
      total: all.length,
      nextBefore: rows.length > 20 ? `${last.updatedAt}:${last.id}` : null
    }
  }
  update(fn: (state: WorkspaceState) => void): void {
    const next = this.snapshot()
    fn(next)
    validateState(next)
    const serialized = JSON.stringify(next)
    if (Buffer.byteLength(serialized) > 32 * 1024 * 1024)
      throw new InputError('工作区记录已达 32 MB 上限，请先清理旧批注或任务')
    mkdirSync(dirname(this.path), { recursive: true })
    // Publish memory only after the atomic replacement succeeds.
    writeFileSync(this.path + '.tmp', serialized, { mode: 0o600 })
    renameSync(this.path + '.tmp', this.path)
    this.state = next
  }
  saveAnnotation(input: any, source: Message, now = Date.now()): Annotation {
    const sessionId = identifier(input.sessionId)
    const quote = text(input.quote, 8000),
      note = text(input.note, 4000, false)
    if (source.id !== input.messageId || !source.text.includes(quote))
      throw new InputError('引用必须是所选消息中的连续原文')
    const id = input.id === undefined ? randomUUID() : identifier(input.id)
    const sourceHash = createHash('sha256').update(source.text).digest('hex')
    let saved!: Annotation
    this.update((state) => {
      const old = state.annotations.find((a) => a.id === id)
      if (input.id !== undefined && !old) throw new InputError('批注已删除', 404)
      if (
        old &&
        (old.sessionId !== sessionId || old.messageId !== source.id || old.updatedAt !== input.updatedAt)
      )
        throw new InputError('批注已变化，请刷新后重试', 409)
      if (!old && state.annotations.length >= 2000) throw new InputError('批注已达上限，请先清理旧批注')
      saved = {
        id,
        sessionId,
        messageId: source.id,
        seq: source.seq,
        role: source.role,
        sourceHash,
        quote,
        note,
        updatedAt: Math.max(now, (old?.updatedAt ?? 0) + 1)
      }
      state.annotations = [...state.annotations.filter((a) => a.id !== id), saved]
    })
    return saved
  }
  deleteAnnotation(input: any): void {
    const id = identifier(input.id)
    this.update((state) => {
      const old = state.annotations.find((a) => a.id === id)
      if (!old) throw new InputError('批注已删除', 404)
      if (old.updatedAt !== input.updatedAt) throw new InputError('批注已变化，请刷新', 409)
      state.annotations = state.annotations.filter((a) => a.id !== id)
    })
  }
}

export interface ScheduleInput {
  id?: string
  updatedAt?: number
  title: string
  sessionId: string
  prompt: string
  timing: Timing
  enabled: boolean
}
export class Scheduler {
  private busy = new Set<string>()
  private stopped = false
  constructor(
    readonly store: WorkspaceStore,
    private readonly deliver: (schedule: Schedule, requestId: string) => Promise<void>,
    private readonly zoneSource: string | (() => string) = () =>
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    private readonly now = Date.now
  ) {
    const interrupted = store.schedules().some((s) => s.history.some((h) => h.status === 'dispatching'))
    if (interrupted)
      store.update((state) => {
        for (const s of state.schedules)
          if (s.history.some((h) => h.status === 'dispatching')) {
            s.enabled = false
            s.nextAt = null
            s.updatedAt = this.now()
            for (const h of s.history)
              if (h.status === 'dispatching') {
                h.status = 'uncertain'
                h.detail = '上次投递期间服务中断；请先检查目标会话，确认后再启用或立即投递。'
              }
          }
      })
  }
  get zone(): string {
    return typeof this.zoneSource === 'function' ? this.zoneSource() : this.zoneSource
  }
  stop(): void {
    this.stopped = true
  }
  save(input: ScheduleInput): Schedule {
    const id = input.id === undefined ? randomUUID() : identifier(input.id)
    this.guard(id)
    const title = text(input.title, 100),
      prompt = text(input.prompt, 4000),
      sessionId = identifier(input.sessionId),
      rule = timing(input.timing)
    if (typeof input.enabled !== 'boolean') throw new InputError('启用状态无效')
    const now = this.now()
    if (input.enabled && rule.kind === 'once' && rule.at <= now)
      throw new InputError('一次性任务请选择将来的时间')
    let saved!: Schedule
    this.store.update((state) => {
      const old = state.schedules.find((s) => s.id === id)
      if (input.id !== undefined && !old) throw new InputError('任务已删除', 404)
      if (old && old.updatedAt !== input.updatedAt) throw new InputError('任务已变化，请刷新后重试', 409)
      if (!old && state.schedules.length >= 100) throw new InputError('任务已达上限，请先清理')
      if (input.enabled && state.schedules.filter((s) => s.id !== id && s.enabled).length >= 20)
        throw new InputError('最多同时启用 20 个定时任务')
      const unchanged =
        old?.enabled && old.timeZone === this.zone && JSON.stringify(old.timing) === JSON.stringify(rule)
      saved = {
        id,
        title,
        sessionId,
        prompt,
        timing: rule,
        enabled: input.enabled,
        nextAt: input.enabled ? (unchanged ? old!.nextAt : nextOccurrence(rule, now)) : null,
        timeZone: this.zone,
        history: old?.history ?? [],
        updatedAt: Math.max(now, (old?.updatedAt ?? 0) + 1)
      }
      state.schedules = [...state.schedules.filter((s) => s.id !== id), saved]
    })
    return saved
  }
  remove(input: { id: string; updatedAt: number }): void {
    this.guard(identifier(input.id))
    this.store.update((state) => {
      const s = state.schedules.find((s) => s.id === input.id)
      if (!s) throw new InputError('任务已删除', 404)
      if (s.updatedAt !== input.updatedAt) throw new InputError('任务已变化，请刷新', 409)
      state.schedules = state.schedules.filter((s) => s.id !== input.id)
    })
  }
  private guard(id: string): void {
    if (this.stopped) throw new InputError('调度服务已停止', 503)
    if (this.busy.has(id)) throw new InputError('任务正在投递，请稍后操作', 409)
  }
  async tick(): Promise<void> {
    if (this.stopped) return
    // Bound one tick and skip already claimed jobs. Recurrences are calculated from now, never replayed in a burst.
    const due = this.store
      .schedules()
      .filter(
        (s) =>
          s.enabled &&
          (s.timeZone !== this.zone || (s.nextAt !== null && s.nextAt <= this.now())) &&
          !this.busy.has(s.id)
      )
      .slice(0, 3)
    for (const s of due) {
      if (this.stopped) return
      if (s.timeZone !== this.zone) {
        this.store.update((state) => {
          const row = state.schedules.find((r) => r.id === s.id)!
          row.enabled = false
          row.nextAt = null
          row.updatedAt = this.now()
          row.history = [
            {
              requestId: randomUUID(),
              time: this.now(),
              status: 'uncertain' as const,
              detail: '本机时区已变化，任务暂停；请编辑确认时间后启用。'
            },
            ...row.history
          ].slice(0, 20)
        })
      } else await this.run(s.id)
    }
  }
  async run(id: string): Promise<Schedule> {
    this.guard(identifier(id))
    const schedule = this.store.schedules().find((s) => s.id === id)
    if (!schedule) throw new InputError('任务不存在', 404)
    const now = this.now(),
      requestId = randomUUID()
    this.busy.add(id)
    try {
      this.store.update((state) => {
        const s = state.schedules.find((s) => s.id === id)!
        s.history = [{ requestId, time: now, status: 'dispatching' as const }, ...s.history].slice(0, 20)
        s.updatedAt = Math.max(now, s.updatedAt + 1)
        if (s.timing.kind === 'once') {
          s.enabled = false
          s.nextAt = null
        } else if (s.enabled && (s.nextAt ?? 0) <= now) s.nextAt = nextOccurrence(s.timing, now)
      })
      diagnostic('schedule.dispatching', { taskId: id, sessionId: schedule.sessionId, requestId })
      let detail: string | undefined
      try {
        await this.deliver(schedule, requestId)
      } catch (error) {
        detail = '投递未确认，请先检查目标会话再重试。' + String(error).slice(0, 500)
      }
      // A reloaded plugin may already have recovered this claim into a new store.
      // Never let the retired instance overwrite that store with stale memory.
      if (this.stopped) throw new InputError('服务在投递期间停止；重启后请先检查目标会话。', 503)
      // If this save fails the durable dispatching claim is recovered as uncertain on restart.
      try {
        this.store.update((state) => {
          const s = state.schedules.find((s) => s.id === id)!
          const h = s.history.find((h) => h.requestId === requestId)!
          h.status = detail ? 'uncertain' : 'queued'
          h.detail = detail
          s.updatedAt = Math.max(this.now(), s.updatedAt + 1)
          if (detail) {
            s.enabled = false
            s.nextAt = null
          }
        })
      } catch {
        this.stop()
        throw new InputError('投递结果无法保存；调度已停止。请检查目标会话与数据目录后重启应用。', 503)
      }
      diagnostic('schedule.settled', {
        taskId: id,
        sessionId: schedule.sessionId,
        requestId,
        status: detail ? 'uncertain' : 'queued'
      })
      return this.store.schedules().find((s) => s.id === id)!
    } finally {
      this.busy.delete(id)
    }
  }
}
