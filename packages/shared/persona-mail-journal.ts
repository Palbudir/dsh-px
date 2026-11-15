import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PersonaMailSender, PersonaMailSource } from './persona-mail-policy'

export interface MailEnvelope {
  id: string
  requestId: string
  sender: PersonaMailSender
  target: string
  relationDigest: string
  receiverSessionId: string
  source: PersonaMailSource
  text: string
}
export interface MailReceipt {
  envelope: MailEnvelope
  jobId: string
  /** Delivery receipt, not an alternative to native Job / Goal execution state. */
  delivery: 'prepared' | 'admitted' | 'replied' | 'closed'
  nativeMessageId?: string
  reply?: string
  detail?: string
}

/** Durable deduplication and reply evidence. Opening never resumes work or calls a model. */
export class PersonaMailJournal {
  private readonly db: DatabaseSync
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS persona_mail (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, request TEXT NOT NULL,
        receipt TEXT NOT NULL, UNIQUE(owner,request));`)
  }
  close(): void {
    this.db.close()
  }
  recent(limit = 30): MailReceipt[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('通信记录读取数量无效')
    return this.db
      .prepare('SELECT receipt FROM persona_mail ORDER BY rowid DESC LIMIT ?')
      .all(limit)
      .map((row) => JSON.parse(String(row.receipt)))
  }
  get(id: string): MailReceipt | undefined {
    const row = this.db.prepare('SELECT receipt FROM persona_mail WHERE id=?').get(id)
    return row ? JSON.parse(String(row.receipt)) : undefined
  }
  request(owner: string, request: string): MailReceipt | undefined {
    const row = this.db
      .prepare('SELECT receipt FROM persona_mail WHERE owner=? AND request=?')
      .get(owner, request)
    return row ? JSON.parse(String(row.receipt)) : undefined
  }
  insert(envelope: MailEnvelope, jobId: string): void {
    if (Number(this.db.prepare('SELECT count(*) AS n FROM persona_mail').get()?.n) >= 10000)
      throw Error('人格通信记录已达到容量，请整理后再发送')
    this.db
      .prepare('INSERT INTO persona_mail(id,owner,request,receipt) VALUES(?,?,?,?)')
      .run(
        envelope.id,
        envelope.sender.sessionId,
        envelope.requestId,
        JSON.stringify({ envelope, jobId, delivery: 'prepared' } satisfies MailReceipt)
      )
  }
  admitted(id: string, nativeMessageId: string): void {
    this.change(id, (row) => {
      if (!['prepared', 'replied'].includes(row.delivery)) throw Error('人格来信的接收回执已变化')
      return { ...row, delivery: row.delivery === 'replied' ? 'replied' : 'admitted', nativeMessageId }
    })
  }
  reply(id: string, text: string): void {
    this.change(id, (row) => {
      if (row.delivery === 'replied' && row.reply === text) return row
      if (!['prepared', 'admitted'].includes(row.delivery)) throw Error('本次通信已结束，不能再次提交回复')
      return { ...row, delivery: 'replied', reply: text }
    })
  }
  finish(id: string, detail?: string): void {
    this.change(id, (row) => ({
      ...row,
      delivery: row.delivery === 'replied' ? 'replied' : 'closed',
      ...(detail ? { detail } : {})
    }))
  }
  private change(id: string, update: (row: MailReceipt) => MailReceipt): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.get(id)
      if (!row) throw Error('人格通信记录不存在')
      this.db.prepare('UPDATE persona_mail SET receipt=? WHERE id=?').run(JSON.stringify(update(row)), id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
