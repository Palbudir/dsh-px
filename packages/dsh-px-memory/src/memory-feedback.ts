import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MemoryError } from './store'

export type FeedbackKind = 'confirmed' | 'useful' | 'not-applicable' | 'disputed'
export interface FeedbackEvidence {
  sessionId: string
  seq: number
  kind: string
  hash: string
}
export interface FeedbackEntry {
  kind: FeedbackKind
  actor: 'human' | 'model'
  reason: string
  evidence?: FeedbackEvidence
  at: string
}
export interface FeedbackInput {
  kind: FeedbackKind
  reason: string
  evidence?: { sessionId: string; seq: number }
}
/** Both hot memories and Documents use the same evidence/confirmation boundary. */
export async function prepareFeedback(
  input: FeedbackInput,
  actor: 'human' | 'model',
  read?: (source: string, seq: number, signal?: AbortSignal) => Promise<any>,
  signal?: AbortSignal
) {
  if (
    !input ||
    !['confirmed', 'useful', 'not-applicable', 'disputed'].includes(input.kind) ||
    typeof input.reason !== 'string' ||
    !input.reason.trim() ||
    input.reason.length > 1000
  )
    throw new MemoryError('反馈类型或理由无效')
  if (actor === 'model' && !['useful', 'not-applicable'].includes(input.kind))
    throw new MemoryError('确认与判定不正确需由用户操作；模型只能记录有依据的应用反馈', 403)
  let evidence: FeedbackEvidence | undefined
  if (input.evidence !== undefined) {
    const ref = input.evidence
    if (!ref || typeof ref.sessionId !== 'string' || !Number.isSafeInteger(ref.seq) || ref.seq < 0 || !read)
      throw new MemoryError('反馈需要可读取的原始事件依据')
    const record = await read(ref.sessionId, ref.seq, signal)
    if (
      !['user', 'tool-result'].includes(record?.kind) ||
      typeof record.text !== 'string' ||
      !record.text.trim()
    )
      throw new MemoryError('模型复述或记忆检索不是独立反馈依据', 403)
    if (
      actor === 'model' &&
      input.kind === 'useful' &&
      (record.kind !== 'tool-result' || record.failed !== false)
    )
      throw new MemoryError('成功应用需要原生工具的成功回执；交流陈述不等于任务成功', 403)
    evidence = {
      sessionId: ref.sessionId,
      seq: ref.seq,
      kind: record.kind,
      hash: feedbackHash([record.kind, record.tool ?? null, record.text.trim()])
    }
  } else if (actor === 'model')
    throw new MemoryError('模型应用反馈必须引用原始事件，不能通过重复检索自我加权', 403)
  signal?.throwIfAborted()
  return {
    origin: feedbackHash(actor === 'human' ? ['human'] : ['native-evidence', evidence!.hash]),
    entry: {
      actor,
      kind: input.kind,
      reason: input.reason.trim(),
      ...(evidence ? { evidence } : {}),
      at: new Date().toISOString()
    } as FeedbackEntry
  }
}
export interface FeedbackView {
  confirmed: boolean
  disputed: boolean
  strength: number
  count: number
  entries: FeedbackEntry[]
}
export function presentFeedback(view: FeedbackView, actor?: 'human' | 'model') {
  if (actor === 'human') return view
  const { entries: _, ...summary } = view
  return summary
}
export const feedbackHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Auxiliary judgments are revision-bound. This store never replaces native document content or revives archives. */
export class MemoryFeedback {
  private db: DatabaseSync
  private closed = false
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;')
      const version = (this.db.prepare('PRAGMA user_version').get() as any).user_version
      if (version > 1 || (this.db.prepare('PRAGMA quick_check').get() as any).quick_check !== 'ok')
        throw new MemoryError('记忆反馈存储版本或完整性需要检查，未清空原记录', 503)
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS feedback(target TEXT NOT NULL, origin TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(target,origin,kind)); PRAGMA user_version=1;`
      )
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  view(target: string): FeedbackView {
    const entries = this.db
      .prepare('SELECT body FROM feedback WHERE target=? ORDER BY rowid')
      .all(target)
      .map((row) => JSON.parse(String(row.body)) as FeedbackEntry)
    const human = (kind: FeedbackKind) =>
      entries.some((entry) => entry.actor === 'human' && entry.kind === kind)
    const useful = entries.filter((entry) => entry.kind === 'useful').length
    const negative = entries.filter((entry) => entry.kind === 'not-applicable').length
    return {
      confirmed: human('confirmed') && !human('disputed'),
      disputed: human('disputed'),
      strength: Math.max(
        -4,
        Math.min(4, (human('confirmed') ? 2 : 0) + Math.min(2, useful) - Math.min(4, negative * 2))
      ),
      count: entries.length,
      entries
    }
  }
  record(
    target: string,
    origin: string,
    entry: FeedbackEntry
  ): { duplicate: boolean; feedback: FeedbackView } {
    if (!/^[a-f0-9]{64}$/.test(target) || !/^[a-f0-9]{64}$/.test(origin))
      throw new MemoryError('反馈目标无效')
    if (
      this.db
        .prepare('SELECT 1 FROM feedback WHERE target=? AND origin=? AND kind=?')
        .get(target, origin, entry.kind)
    )
      return { duplicate: true, feedback: this.view(target) }
    const current = this.view(target)
    if (
      current.count >= 128 ||
      Number((this.db.prepare('SELECT count(*) n FROM feedback').get() as any).n) >= 100000
    )
      throw new MemoryError('反馈记录已达到容量限制，请先整理；未删除原记录', 409)
    const result = this.db
      .prepare('INSERT OR IGNORE INTO feedback VALUES(?,?,?,?)')
      .run(target, origin, entry.kind, JSON.stringify(entry))
    return { duplicate: result.changes === 0, feedback: this.view(target) }
  }
  close(): void {
    if (!this.closed) {
      this.closed = true
      this.db.close()
    }
  }
}

/** Native lexical relevance remains dominant; bounded feedback changes ordering among comparable matches. */
export function rankMemoryMatch(score: number, feedback: FeedbackView): number {
  return score + feedback.strength * 0.5
}
