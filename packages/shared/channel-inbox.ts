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
export interface ChannelRecipient {
  personaId: string
  routeRevision: number
}
export interface IngressClaim extends ChannelRecipient {
  epoch: string
  sessionId: string
  requestId: string
}
export interface PendingChannelMessage {
  id: string
  seq: number
  event: ChannelInboxEvent
  recipient: ChannelRecipient
}
const id = (v: unknown): v is string =>
  typeof v === 'string' && !!v.trim() && v.length <= 512 && !/[\r\n\0]/.test(v)
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const recipientJson = (value: ChannelRecipient): string => {
  if (!value || !id(value.personaId) || !Number.isSafeInteger(value.routeRevision) || value.routeRevision < 0)
    throw Error('收件目标人格或路由版本无效')
  return JSON.stringify({ personaId: value.personaId, routeRevision: value.routeRevision })
}
const claimJson = (claim: IngressClaim): string => {
  if (![claim.epoch, claim.personaId, claim.sessionId, claim.requestId].every(id))
    throw Error('收件投递归属无效')
  recipientJson(claim)
  return JSON.stringify({
    epoch: claim.epoch,
    personaId: claim.personaId,
    routeRevision: claim.routeRevision,
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
      db.exec('BEGIN IMMEDIATE')
      db.exec(
        'CREATE TABLE IF NOT EXISTS channel_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS channel_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,chat TEXT NOT NULL,message TEXT NOT NULL,digest TEXT NOT NULL,phase TEXT NOT NULL,event TEXT,bytes INTEGER NOT NULL,metadata TEXT NOT NULL,recipient TEXT NOT NULL,claim TEXT,native_message TEXT); CREATE INDEX IF NOT EXISTS channel_pending ON channel_messages(phase,seq);'
      )
      db.exec('CREATE INDEX IF NOT EXISTS channel_conversation_order ON channel_messages(chat,seq)')
      db.exec(
        'CREATE TABLE IF NOT EXISTS channel_replies(id TEXT PRIMARY KEY,chat TEXT NOT NULL,source TEXT NOT NULL,session TEXT NOT NULL,digest TEXT NOT NULL,phase TEXT NOT NULL,result TEXT); CREATE INDEX IF NOT EXISTS channel_reply_pending ON channel_replies(chat,phase)'
      )
      const identity = JSON.stringify(this.owner),
        existing = db.prepare("SELECT value FROM channel_meta WHERE key='owner'").get()?.value,
        schema = db.prepare("SELECT value FROM channel_meta WHERE key='schema'").get()?.value
      if ((existing !== undefined && existing !== identity) || (schema !== undefined && schema !== '2'))
        throw Error('渠道收件账号或格式不匹配，原数据保留')
      db.prepare("INSERT OR IGNORE INTO channel_meta VALUES('owner',?)").run(identity)
      db.prepare("INSERT OR IGNORE INTO channel_meta VALUES('schema','2')").run()
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
  accept(
    event: ChannelInboxEvent,
    recipient: ChannelRecipient,
    signal?: AbortSignal
  ): { id: string; duplicate: boolean; recipient: ChannelRecipient } {
    signal?.throwIfAborted()
    const destination = recipientJson(recipient)
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
      const prior = this.db.prepare('SELECT digest,recipient FROM channel_messages WHERE id=?').get(key)
      if (prior) {
        if (prior.digest !== digest) throw Error('同一平台消息内容或来源已变化，未覆盖原收件')
        this.db.exec('COMMIT')
        return { id: key, duplicate: true, recipient: JSON.parse(String(prior.recipient)) }
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
          "INSERT INTO channel_messages(id,chat,message,digest,phase,event,bytes,metadata,recipient) VALUES(?,?,?,?,'received',?,?,?,?)"
        )
        .run(
          key,
          event.conversationId,
          event.messageId,
          digest,
          body,
          bytes,
          JSON.stringify(metadata),
          destination
        )
      this.db.exec('COMMIT')
      return { id: key, duplicate: false, recipient: JSON.parse(destination) }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  pending(limit = 20): PendingChannelMessage[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('收件批次大小无效')
    return this.db
      .prepare(
        "SELECT id,seq,event,recipient FROM channel_messages WHERE phase='received' ORDER BY seq LIMIT ?"
      )
      .all(limit)
      .map((r) => ({
        id: String(r.id),
        seq: Number(r.seq),
        event: JSON.parse(String(r.event)),
        recipient: JSON.parse(String(r.recipient))
      }))
  }
  /** One head per conversation; an unresolved native admission blocks only its own conversation. */
  heads(limit = 20, afterSequence = 0): PendingChannelMessage[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('收件批次大小无效')
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw Error('收件游标无效')
    return this.db
      .prepare(
        "SELECT m.id,m.seq,m.event,m.recipient FROM channel_messages m WHERE m.phase='received' AND m.seq>? AND NOT EXISTS (SELECT 1 FROM channel_messages older WHERE older.chat=m.chat AND older.seq<m.seq AND older.phase IN ('received','dispatching','uncertain')) ORDER BY m.seq LIMIT ?"
      )
      .all(afterSequence, limit)
      .map((r) => ({
        id: String(r.id),
        seq: Number(r.seq),
        event: JSON.parse(String(r.event)),
        recipient: JSON.parse(String(r.recipient))
      }))
  }
  claim(key: string, claim: IngressClaim): boolean {
    return (
      this.db
        .prepare(
          "UPDATE channel_messages SET phase='dispatching',claim=? WHERE id=? AND phase='received' AND recipient=?"
        )
        .run(claimJson(claim), key, recipientJson(claim)).changes === 1
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
      .prepare('SELECT phase,claim,native_message,metadata,recipient FROM channel_messages WHERE id=?')
      .get(key)
    return r
      ? {
          phase: String(r.phase) as IngressPhase,
          recipient: JSON.parse(String(r.recipient)) as ChannelRecipient,
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
  beginReply(
    callId: string,
    sourceId: string,
    sessionId: string,
    text: string
  ): { id: string; phase: string; result?: unknown } {
    if (!id(callId) || !id(sessionId) || typeof text !== 'string' || !text.trim() || text.length > 4000)
      throw Error('渠道回复参数无效')
    const source = this.receipt(sourceId)
    if (source?.phase !== 'admitted' || source.claim?.sessionId !== sessionId)
      throw Error('回复缺少已持久接收的原生来源')
    const key = hash([sessionId, sourceId, callId]),
      digest = hash([sourceId, text])
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const previous = this.db.prepare('SELECT digest,phase,result FROM channel_replies WHERE id=?').get(key)
      if (previous) {
        if (previous.digest !== digest) throw Error('同一原生调用的回复内容已变化')
        this.db.exec('COMMIT')
        return {
          id: key,
          phase: String(previous.phase),
          ...(previous.result ? { result: JSON.parse(String(previous.result)) } : {})
        }
      }
      if (
        this.db
          .prepare("SELECT id FROM channel_replies WHERE chat=? AND phase IN ('sending','uncertain') LIMIT 1")
          .get(source.source.conversationId)
      )
        throw Error('此聊天有回复尚未确认，请先核对，不要重复发送')
      if (Number(this.db.prepare('SELECT count(*) n FROM channel_replies').get()!.n) >= this.bounds.records)
        throw Error('回复凭据容量已满，未丢弃原记录')
      this.db
        .prepare(
          "INSERT INTO channel_replies(id,chat,source,session,digest,phase) VALUES(?,?,?,?,?,'sending')"
        )
        .run(key, source.source.conversationId, sourceId, sessionId, digest)
      this.db.exec('COMMIT')
      return { id: key, phase: 'new' }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  finishReply(key: string, phase: 'sent' | 'uncertain' | 'refused', result: unknown): void {
    const data = JSON.stringify(result)
    if (typeof data !== 'string' || Buffer.byteLength(data) > 8192) throw Error('回复回执超出容量')
    if (
      this.db
        .prepare("UPDATE channel_replies SET phase=?,result=? WHERE id=? AND phase='sending'")
        .run(phase, data, key).changes !== 1
    )
      throw Error('回复状态已变化，未覆盖旧回执')
  }
  hasPendingMention(conversationId: string): boolean {
    return !!this.db
      .prepare(
        "SELECT id FROM channel_messages WHERE chat=? AND phase='received' AND json_extract(event,'$.mentioned')=1 LIMIT 1"
      )
      .get(conversationId)
  }
  close(): void {
    this.db.close()
  }
}
