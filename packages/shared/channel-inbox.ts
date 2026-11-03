import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'

export interface ChannelInboxOwner {
  provider: string
  accountId: string
  fingerprint: string
}
export interface ChannelInboxEvent extends ChannelInboxOwner {
  eventId: string
  messageId: string
  conversationId: string
  actorId: string
  kind: 'direct' | 'group'
  mentioned: boolean
  at: string
  text: string
  reply: Record<string, string>
}
export type IngressPhase = 'received' | 'dispatching' | 'admitted' | 'uncertain' | 'cancelled'
export interface IngressClaim {
  epoch: string
  personaId: string
  sessionId: string
  requestId: string
}
const id = (v: unknown): v is string =>
  typeof v === 'string' && !!v.trim() && v.length <= 512 && !/[\r\n\0]/.test(v)
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const claimJson = (claim: IngressClaim): string => {
  if (![claim.epoch, claim.personaId, claim.sessionId, claim.requestId].every(id))
    throw Error('收件投递归属无效')
  return JSON.stringify({
    epoch: claim.epoch,
    personaId: claim.personaId,
    sessionId: claim.sessionId,
    requestId: claim.requestId
  })
}

/** Transport receipts only: native sessions own admitted content, execution and task state. */
export class ChannelInbox {
  private readonly db: DatabaseSync
  private readonly owner: ChannelInboxOwner
  constructor(
    file: string,
    owner: ChannelInboxOwner,
    private readonly bounds = { records: 200000, pendingBytes: 32 * 1024 * 1024, eventBytes: 128000 }
  ) {
    if (
      !/^[a-z][a-z0-9.-]{0,79}$/.test(owner.provider) ||
      !id(owner.accountId) ||
      !/^[a-f0-9]{64}$/.test(owner.fingerprint)
    )
      throw Error('渠道收件账号身份无效')
    if (Object.values(bounds).some((n) => !Number.isSafeInteger(n) || n < 1)) throw Error('渠道收件容量无效')
    this.owner = Object.freeze({
      provider: owner.provider,
      accountId: owner.accountId,
      fingerprint: owner.fingerprint
    })
    this.bounds = Object.freeze({ ...bounds })
    mkdirSync(dirname(file), { recursive: true })
    const db = new DatabaseSync(file)
    try {
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;')
      if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
        throw Error('渠道收件存储需要检查，未清空原记录')
      db.exec(
        'CREATE TABLE IF NOT EXISTS channel_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS channel_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,chat TEXT NOT NULL,message TEXT NOT NULL,digest TEXT NOT NULL,phase TEXT NOT NULL,event TEXT,bytes INTEGER NOT NULL,metadata TEXT NOT NULL,claim TEXT,native_message TEXT); CREATE INDEX IF NOT EXISTS channel_pending ON channel_messages(phase,seq);'
      )
      db.exec('BEGIN IMMEDIATE')
      const identity = JSON.stringify(this.owner),
        existing = db.prepare("SELECT value FROM channel_meta WHERE key='owner'").get()?.value,
        schema = db.prepare("SELECT value FROM channel_meta WHERE key='schema'").get()?.value
      if ((existing !== undefined && existing !== identity) || (schema !== undefined && schema !== '1'))
        throw Error('渠道收件账号或格式不匹配，原数据保留')
      db.prepare("INSERT OR IGNORE INTO channel_meta VALUES('owner',?)").run(identity)
      db.prepare("INSERT OR IGNORE INTO channel_meta VALUES('schema','1')").run()
      db.exec('COMMIT')
      this.db = db
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {}
      db.close()
      throw error
    }
  }
  accept(event: ChannelInboxEvent, signal?: AbortSignal): { id: string; duplicate: boolean } {
    signal?.throwIfAborted()
    if (
      event.provider !== this.owner.provider ||
      event.accountId !== this.owner.accountId ||
      event.fingerprint !== this.owner.fingerprint ||
      ![event.eventId, event.messageId, event.conversationId, event.actorId].every(id) ||
      !['direct', 'group'].includes(event.kind) ||
      typeof event.mentioned !== 'boolean' ||
      typeof event.text !== 'string' ||
      !event.text.trim() ||
      !Number.isFinite(Date.parse(event.at)) ||
      !event.reply ||
      Array.isArray(event.reply) ||
      typeof event.reply !== 'object' ||
      Object.entries(event.reply).some(([key, value]) => !id(key) || !id(value))
    )
      throw Error('渠道收件证据无效')
    const key = hash([this.owner, event.conversationId, event.messageId]),
      canonical = {
        ...this.owner,
        eventId: event.eventId,
        messageId: event.messageId,
        conversationId: event.conversationId,
        actorId: event.actorId,
        kind: event.kind,
        mentioned: event.mentioned,
        at: new Date(event.at).toISOString(),
        text: event.text,
        reply: Object.fromEntries(
          Object.entries(event.reply).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      },
      digest = hash({ ...canonical, eventId: undefined }),
      body = JSON.stringify(canonical),
      bytes = Buffer.byteLength(body)
    if (bytes > this.bounds.eventBytes) throw Error('单条渠道消息超出容量')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const prior = this.db.prepare('SELECT digest FROM channel_messages WHERE id=?').get(key)
      if (prior) {
        if (prior.digest !== digest) throw Error('同一平台消息内容或来源已变化，未覆盖原收件')
        this.db.exec('COMMIT')
        return { id: key, duplicate: true }
      }
      const size = this.db
        .prepare('SELECT count(*) count,coalesce(sum(bytes),0) bytes FROM channel_messages')
        .get()!
      if (Number(size.count) >= this.bounds.records || Number(size.bytes) + bytes > this.bounds.pendingBytes)
        throw Error('渠道收件箱容量已满，未丢弃原消息')
      signal?.throwIfAborted()
      const { text: _body, ...metadata } = canonical
      this.db
        .prepare(
          "INSERT INTO channel_messages(id,chat,message,digest,phase,event,bytes,metadata) VALUES(?,?,?,?,'received',?,?,?)"
        )
        .run(key, event.conversationId, event.messageId, digest, body, bytes, JSON.stringify(metadata))
      this.db.exec('COMMIT')
      return { id: key, duplicate: false }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  pending(limit = 20): Array<{ id: string; seq: number; event: ChannelInboxEvent }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('收件批次大小无效')
    return this.db
      .prepare("SELECT id,seq,event FROM channel_messages WHERE phase='received' ORDER BY seq LIMIT ?")
      .all(limit)
      .map((r) => ({ id: String(r.id), seq: Number(r.seq), event: JSON.parse(String(r.event)) }))
  }
  claim(key: string, claim: IngressClaim): boolean {
    return (
      this.db
        .prepare("UPDATE channel_messages SET phase='dispatching',claim=? WHERE id=? AND phase='received'")
        .run(claimJson(claim), key).changes === 1
    )
  }
  admit(key: string, claim: IngressClaim, nativeMessageId: string): boolean {
    if (!id(nativeMessageId)) throw Error('原生收件回执无效')
    return (
      this.db
        .prepare(
          "UPDATE channel_messages SET phase='admitted',native_message=?,event=NULL,bytes=0 WHERE id=? AND phase IN ('dispatching','uncertain') AND claim=?"
        )
        .run(nativeMessageId, key, claimJson(claim)).changes === 1
    )
  }
  uncertain(key: string, claim: IngressClaim): boolean {
    return (
      this.db
        .prepare(
          "UPDATE channel_messages SET phase='uncertain' WHERE id=? AND phase='dispatching' AND claim=?"
        )
        .run(key, claimJson(claim)).changes === 1
    )
  }
  /** Call only after obtaining exclusive native consumer ownership; opening a DB never mutates in-flight work. */
  recoverInterrupted(epoch: string): number {
    if (!id(epoch)) throw Error('接收生命周期标识无效')
    return Number(
      this.db
        .prepare(
          "UPDATE channel_messages SET phase='uncertain' WHERE phase='dispatching' AND json_extract(claim,'$.epoch')<>?"
        )
        .run(epoch).changes
    )
  }
  receipt(key: string) {
    const r = this.db
      .prepare('SELECT phase,claim,native_message,metadata FROM channel_messages WHERE id=?')
      .get(key)
    return r
      ? {
          phase: String(r.phase) as IngressPhase,
          claim: r.claim ? (JSON.parse(String(r.claim)) as IngressClaim) : undefined,
          nativeMessageId: r.native_message ? String(r.native_message) : undefined,
          source: JSON.parse(String(r.metadata)) as Omit<ChannelInboxEvent, 'text'>
        }
      : undefined
  }
  cancelPending(key: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE channel_messages SET phase='cancelled',event=NULL,bytes=0 WHERE id=? AND phase='received'"
        )
        .run(key).changes === 1
    )
  }
  close(): void {
    this.db.close()
  }
}
