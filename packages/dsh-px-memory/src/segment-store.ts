import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MemoryError } from './store'
import type { SegmentSource } from './segment-context'

export type SegmentPhase =
  'preparing' | 'stopping' | 'ready' | 'committing' | 'committed' | 'failed' | 'cancelled' | 'discarded'
export interface SegmentRecord {
  id: string
  sessionId: string
  personaId: string
  identity: string
  epoch: string
  phase: SegmentPhase
  source: Omit<SegmentSource, 'messages'>
  route: { provider: string; model: string; reasoningEffort?: string }
  capacity: number
  createdAt: string
  updatedAt: string
  jobId?: string
  error?: string
  prepared?: {
    summary: string
    memories: Array<{ key: string; body: string; seqs: number[] }>
    usage?: Record<string, number>
    durationMs: number
  }
  usage?: Record<string, number>
  memoryTarget?: { scope: 'persona' | 'persona-project' | 'project'; revision: string; conversation: boolean }
  memoryDecisions?: Record<string, { status: 'accepted' | 'dismissed'; documentId?: string }>
  nativeCompactionId?: string
}

/** Stores preparation artifacts, not a second Job lifecycle or a replacement for the native session log. */
export class SegmentStore {
  private db: DatabaseSync
  private closed = false
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;')
      const version = (this.db.prepare('PRAGMA user_version').get() as any).user_version
      if (version > 1 || (this.db.prepare('PRAGMA quick_check').get() as any).quick_check !== 'ok')
        throw new MemoryError('后台片段存储需要检查，未清空原记录', 503)
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS segments(id TEXT PRIMARY KEY, session TEXT NOT NULL, fingerprint TEXT NOT NULL, phase TEXT NOT NULL, body TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS segments_by_session ON segments(session);
        CREATE TABLE IF NOT EXISTS settings(session TEXT PRIMARY KEY, revision INTEGER NOT NULL, enabled INTEGER NOT NULL);
        PRAGMA user_version=1;`)
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  get(id: string): SegmentRecord | undefined {
    const row = this.db.prepare('SELECT body FROM segments WHERE id=?').get(id)
    return row ? JSON.parse(String(row.body)) : undefined
  }
  list(sessionId: string, limit = 100): SegmentRecord[] {
    return this.db
      .prepare('SELECT body FROM segments WHERE session=? ORDER BY rowid DESC LIMIT ?')
      .all(sessionId, Math.min(2000, Math.max(1, limit)))
      .map((row) => JSON.parse(String(row.body)))
  }
  unfinished(sessionId: string): SegmentRecord[] {
    return this.db
      .prepare(
        "SELECT body FROM segments WHERE session=? AND phase IN ('preparing','stopping','ready','committing') ORDER BY rowid"
      )
      .all(sessionId)
      .map((row) => JSON.parse(String(row.body)))
  }
  seen(sessionId: string, fingerprint: string, identity: string, route: SegmentRecord['route']): boolean {
    return this.db
      .prepare('SELECT body FROM segments WHERE session=? AND fingerprint=?')
      .all(sessionId, fingerprint)
      .some((row) => {
        const prior: SegmentRecord = JSON.parse(String(row.body))
        return prior.identity === identity && JSON.stringify(prior.route) === JSON.stringify(route)
      })
  }
  create(record: SegmentRecord): void {
    if (this.list(record.sessionId, 2000).length >= 2000)
      throw new MemoryError('本会话的片段目录达到上限，原生压力压缩仍可继续', 409)
    const body = JSON.stringify(record)
    if (body.length > 250000) throw new MemoryError('后台片段记录超过大小限制')
    this.db
      .prepare('INSERT INTO segments VALUES(?,?,?,?,?)')
      .run(record.id, record.sessionId, record.source.fingerprint, record.phase, body)
  }
  change(
    id: string,
    expected: SegmentPhase[],
    update: (record: SegmentRecord) => void
  ): SegmentRecord | undefined {
    const before = this.get(id)
    if (!before || !expected.includes(before.phase)) return
    const prior = JSON.stringify(before)
    update(before)
    before.updatedAt = new Date().toISOString()
    const body = JSON.stringify(before)
    if (body.length > 250000) throw new MemoryError('后台片段记录超过大小限制')
    const result = this.db
      .prepare('UPDATE segments SET phase=?,body=? WHERE id=? AND body=?')
      .run(before.phase, body, id, prior)
    if (!result.changes) throw new MemoryError('片段记录已变化，请刷新后重试', 409)
    return before
  }
  settings(sessionId: string): { revision: number; enabled: boolean } {
    const row = this.db.prepare('SELECT revision,enabled FROM settings WHERE session=?').get(sessionId)
    return row ? { revision: Number(row.revision), enabled: !!row.enabled } : { revision: 0, enabled: true }
  }
  configure(sessionId: string, revision: number, enabled: boolean) {
    if (typeof enabled !== 'boolean' || revision !== this.settings(sessionId).revision)
      throw new MemoryError('后台整理设置已变化，请刷新', 409)
    const result = this.db
      .prepare(
        'INSERT INTO settings VALUES(?,?,?) ON CONFLICT(session) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled WHERE settings.revision=?'
      )
      .run(sessionId, revision + 1, enabled ? 1 : 0, revision)
    if (!result.changes) throw new MemoryError('后台整理设置已变化，请刷新', 409)
    return this.settings(sessionId)
  }
  close(): void {
    if (!this.closed) {
      this.closed = true
      this.db.close()
    }
  }
}
