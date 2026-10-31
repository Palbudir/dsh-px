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
