import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { qqId, QqError } from './policy'
import {
  parseAttention,
  validAttentionChat,
  type AttentionMessage,
  type QqAttentionSettings
} from './attention'

type Phase = 'received' | 'dispatching' | 'admitted' | 'context' | 'uncertain' | 'command' | 'cancelled'
export interface InboxMessage extends AttentionMessage {
  id: string
  messageId: string
  senderId: string
  seq: number
  receivedAt: number
  preview: string
  phase: Phase
  event?: any
  sessionId?: string
  nativeMessageId?: string
}
export interface InboxLimits {
  messages: number
  pendingBytes: number
  eventBytes: number
}
export interface QqNotice {
  chatId: string
  label?: string
  through: number
  count: number
  preview: string
  mentioned: boolean
  receivedAt: number
}
const limits: InboxLimits = { messages: 20000, pendingBytes: 32 * 1024 * 1024, eventBytes: 256000 }

/** Pending transport content only. Native sessions own context, execution and transcripts after admission. */
export class QqAttentionInbox {
  private readonly db: DatabaseSync
  constructor(
    file: string,
    private readonly accountId: string,
    private readonly bounds: InboxLimits = limits
  ) {
    qqId(accountId)
    for (const n of Object.values(bounds))
      if (!Number.isSafeInteger(n) || n < 1) throw new QqError('QQ 收件箱容量无效')
    mkdirSync(dirname(file), { recursive: true })
    const db = new DatabaseSync(file)
    try {
      db.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      db.exec(`CREATE TABLE IF NOT EXISTS inbox_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, chat TEXT NOT NULL,
          message TEXT NOT NULL, sender TEXT NOT NULL, mentioned INTEGER NOT NULL,
          received INTEGER NOT NULL, preview TEXT NOT NULL, phase TEXT NOT NULL,
          event TEXT, bytes INTEGER NOT NULL, session TEXT, native_message TEXT,
          UNIQUE(chat,message));
        CREATE INDEX IF NOT EXISTS messages_chat_seq ON messages(chat,seq);
        CREATE INDEX IF NOT EXISTS messages_phase_seq ON messages(phase,seq);`)
      const owner = db.prepare('SELECT value FROM inbox_meta WHERE key=?').get('account')?.value
      const schema = db.prepare('SELECT value FROM inbox_meta WHERE key=?').get('schema')?.value
      if ((owner !== undefined && owner !== accountId) || (schema !== undefined && schema !== '1'))
        throw new QqError('QQ 收件箱账号或格式不匹配，未覆盖原数据', 409)
      db.prepare('INSERT OR IGNORE INTO inbox_meta(key,value) VALUES (?,?)').run('account', accountId)
      db.prepare('INSERT OR IGNORE INTO inbox_meta(key,value) VALUES (?,?)').run('schema', '1')
      // A crash between dispatch and native flush is never permission to replay a request.
      db.prepare("UPDATE messages SET phase='uncertain' WHERE phase='dispatching'").run()
      this.db = db
    } catch (error) {
      db.close()
      throw error
    }
  }
  close(): void {
    this.db.close()
  }
  preferences(fallback: QqAttentionSettings): { revision: number; settings: QqAttentionSettings } {
    const row = this.db.prepare('SELECT value FROM inbox_meta WHERE key=?').get('attention')
    if (!row) return { revision: 0, settings: parseAttention(fallback) }
    const value = JSON.parse(String(row.value))
    if (!Number.isSafeInteger(value.revision) || value.revision < 1)
      throw new QqError('QQ 消息模式记录无效', 503)
    return { revision: value.revision, settings: parseAttention(value.settings) }
  }
  savePreferences(revision: number, value: unknown, fallback: QqAttentionSettings) {
    const settings = parseAttention(value)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.preferences(fallback)
      if (revision !== current.revision) throw new QqError('QQ 消息模式已变化，请刷新后重试', 409)
      const next = { revision: revision + 1, settings }
      this.db
        .prepare('INSERT OR REPLACE INTO inbox_meta(key,value) VALUES (?,?)')
        .run('attention', JSON.stringify(next))
      this.db.exec('COMMIT')
      return next
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  knownChats(): string[] {
    return this.db
      .prepare('SELECT DISTINCT chat FROM messages')
      .all()
      .map((row) => String(row.chat))
  }
  setLabels(kind: 'group' | 'private', rows: readonly any[]): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of rows.slice(0, 10000)) {
        const chatId = kind + ':' + String(kind === 'group' ? row.group_id : row.user_id)
        const label = String(kind === 'group' ? (row.group_name ?? '') : row.remark || row.nickname || '')
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .trim()
          .slice(0, 80)
        if (!label || !validAttentionChat(chatId)) continue
        this.db
          .prepare('INSERT OR REPLACE INTO inbox_meta(key,value) VALUES (?,?)')
          .run('label/' + chatId, label)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  private label(chatId: string): string {
    const name = this.db.prepare('SELECT value FROM inbox_meta WHERE key=?').get('label/' + chatId)?.value
    return typeof name === 'string'
      ? name
      : chatId.startsWith('group:')
        ? '群聊 ' + chatId.slice(6)
        : '私聊 ' + chatId.slice(8)
  }
  recordReply(sessionId: string, turn: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO inbox_meta(key,value) VALUES (?,?)')
      .run('reply/' + sessionId, turn)
  }
  hasReply(sessionId: string, turn: string): boolean {
    return (
      this.db.prepare('SELECT value FROM inbox_meta WHERE key=?').get('reply/' + sessionId)?.value === turn
    )
  }
  clearReply(sessionId: string, turn: string): void {
    this.db.prepare('DELETE FROM inbox_meta WHERE key=? AND value=?').run('reply/' + sessionId, turn)
  }
  notifications(): QqNotice[] {
    const groups = this.db
      .prepare(
        `SELECT chat,MAX(seq) AS lastSeq,MIN(seq) AS firstSeq,
      COUNT(*) AS count,MAX(mentioned) AS mentioned FROM messages WHERE phase='received'
      GROUP BY chat HAVING MAX(seq) > COALESCE((SELECT CAST(value AS INTEGER) FROM inbox_meta WHERE key='noticed/' || chat),0)
      ORDER BY firstSeq`
      )
      .all()
    return groups.map((group: any) => {
      const last: any = this.db
        .prepare('SELECT preview,received FROM messages WHERE seq=?')
        .get(group.lastSeq)
      return {
        chatId: group.chat,
        label: this.label(group.chat),
        through: Number(group.lastSeq),
        count: Number(group.count),
        preview: last.preview,
        mentioned: group.mentioned === 1,
        receivedAt: Number(last.received)
      }
    })
  }
  /** Attempt cursor, not a model-read receipt. Failure remains visible and can be retried explicitly. */
  noticeAttempt(rows: readonly QqNotice[]): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of rows) {
        if (!validAttentionChat(row.chatId) || !Number.isSafeInteger(row.through) || row.through < 1)
          throw new QqError('QQ 通知游标无效')
        this.db
          .prepare(
            'INSERT INTO inbox_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=MAX(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER))'
          )
          .run('noticed/' + row.chatId, String(row.through))
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  retryNotifications(): void {
    this.db.exec("DELETE FROM inbox_meta WHERE key LIKE 'noticed/%'")
  }
  private row(row: any): InboxMessage {
    return {
      id: row.id,
      seq: Number(row.seq),
      chatId: row.chat,
      messageId: row.message,
      senderId: row.sender,
      mentioned: row.mentioned === 1,
      self: false,
      receivedAt: Number(row.received),
      preview: row.preview,
      phase: row.phase,
      ...(row.event ? { event: JSON.parse(row.event) } : {}),
      ...(row.session ? { sessionId: row.session, nativeMessageId: row.native_message } : {})
    }
  }
  receive(event: any): { duplicate: boolean; message: InboxMessage } | undefined {
    if (String(event?.self_id) !== this.accountId) throw new QqError('QQ 收件账号不匹配', 403)
    if (event?.post_type !== 'message' || !['private', 'group'].includes(event.message_type)) return
    const sender = qqId(String(event.user_id))
    if (sender === this.accountId) return
    const chat =
      event.message_type === 'private' ? 'private:' + sender : 'group:' + qqId(String(event.group_id))
    const messageId = String(event.message_id ?? '')
    if (!/^[A-Za-z0-9:_.-]{1,120}$/.test(messageId)) throw new QqError('QQ 消息缺少稳定标识')
    const original = this.db.prepare('SELECT * FROM messages WHERE chat=? AND message=?').get(chat, messageId)
    if (original) return { duplicate: true, message: this.row(original) }
    const serialized = JSON.stringify(event),
      bytes = Buffer.byteLength(serialized)
    if (bytes > this.bounds.eventBytes) throw new QqError('QQ 消息超过收件大小限制，未声称已读取', 413)
    const segments = Array.isArray(event.message) ? event.message : undefined
    const mentioned = segments
      ? segments.some((s: any) => s?.type === 'at' && String(s.data?.qq) === this.accountId)
      : typeof event.message === 'string' && event.message.includes('[CQ:at,qq=' + this.accountId + ']')
    const preview = (
      segments
        ? segments
            .map((s: any) =>
              s?.type === 'text'
                ? String(s.data?.text ?? '')
                : '[' + String(s?.type ?? '内容').slice(0, 25) + ']'
            )
            .join('')
        : String(event.message ?? event.raw_message ?? '')
    )
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .slice(0, 240)
    const id = createHash('sha256')
      .update(JSON.stringify([this.accountId, chat, messageId]))
      .digest('hex')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const held = this.db
        .prepare('SELECT COALESCE(SUM(bytes),0) AS bytes, COUNT(*) AS count FROM messages')
        .get()!
      if (Number(held.bytes) + bytes > this.bounds.pendingBytes)
        throw new QqError('QQ 未处理消息已达到容量限制，请处理积压；本条尚未受理', 429)
      if (Number(held.count) >= this.bounds.messages) {
        this.db
          .prepare(
            "DELETE FROM messages WHERE seq IN (SELECT seq FROM messages WHERE phase IN ('context','command','cancelled') ORDER BY seq LIMIT ?)"
          )
          .run(Number(held.count) - this.bounds.messages + 1)
        const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM messages').get()!.count)
        if (count >= this.bounds.messages) throw new QqError('QQ 收件箱积压过多，本条尚未受理', 429)
      }
      this.db
        .prepare(
          `INSERT INTO messages(id,chat,message,sender,mentioned,received,preview,phase,event,bytes)
        VALUES(?,?,?,?,?,?,?,'received',?,?)`
        )
        .run(id, chat, messageId, sender, mentioned ? 1 : 0, Date.now(), preview, serialized, bytes)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return {
      duplicate: false,
      message: this.row(this.db.prepare('SELECT * FROM messages WHERE id=?').get(id))
    }
  }
  pending(chat: string, count = 50, mentionsOnly = false): InboxMessage[] {
    if (!validAttentionChat(chat) || !Number.isSafeInteger(count) || count < 1 || count > 100)
      throw new QqError('QQ 收件查询无效')
    return this.db
      .prepare(
        "SELECT * FROM messages WHERE chat=? AND phase='received'" +
          (mentionsOnly ? ' AND mentioned=1' : '') +
          ' ORDER BY seq LIMIT ?'
      )
      .all(chat, count)
      .map((row) => this.row(row))
  }
  pendingChats(): string[] {
    return this.db
      .prepare("SELECT chat FROM messages WHERE phase='received' GROUP BY chat ORDER BY MIN(seq)")
      .all()
      .map((row) => String(row.chat))
  }
  canDispatch(id: string): boolean {
    return this.db.prepare('SELECT phase FROM messages WHERE id=?').get(id)?.phase === 'received'
  }
  /** Native stop discards queued work. A later, distinct QQ message can start a new turn normally. */
  cancelPending(chatId?: string, exceptMessageId?: string): void {
    if (chatId !== undefined && !validAttentionChat(chatId)) throw new QqError('QQ 停止范围无效')
    const where =
      "phase IN ('received','dispatching','admitted')" +
      (chatId ? ' AND chat=?' : '') +
      (exceptMessageId ? ' AND message<>?' : '')
    this.db
      .prepare("UPDATE messages SET phase='cancelled',event=NULL,bytes=0 WHERE " + where)
      .run(...(chatId ? [chatId] : []), ...(exceptMessageId ? [exceptMessageId] : []))
  }
  claim(id: string): void {
    const changed = this.db
      .prepare("UPDATE messages SET phase='dispatching' WHERE id=? AND phase='received'")
      .run(id)
    if (changed.changes !== 1) throw new QqError('QQ 消息已经受理或需要核对，未重复投递', 409)
  }
  admitted(id: string, sessionId: string, messageId: string): void {
    if (
      [sessionId, messageId].some((v) => typeof v !== 'string' || !v || v.length > 200 || /[\r\n\0]/.test(v))
    )
      throw new QqError('QQ 原生投递身份无效')
    const change = this.db
      .prepare(
        "UPDATE messages SET phase='admitted',session=?,native_message=? WHERE id=? AND phase='dispatching'"
      )
      .run(sessionId, messageId, id)
    if (change.changes !== 1) throw new QqError('QQ 投递状态已变化，需核对原生会话', 409)
  }
  /** Call only when this native user message is actually committed into the current turn. */
  presented(sessionId: string, nativeMessageId: string): void {
    this.db
      .prepare(
        "UPDATE messages SET phase='context',event=NULL,bytes=0 WHERE session=? AND native_message=? AND phase='admitted'"
      )
      .run(sessionId, nativeMessageId)
  }
  uncertain(id: string): void {
    this.db.prepare("UPDATE messages SET phase='uncertain' WHERE id=? AND phase='dispatching'").run(id)
  }
  /** Command handling is recorded separately from model context; no implicit task success claim. */
  consumed(id: string): void {
    this.db
      .prepare("UPDATE messages SET phase='command',event=NULL,bytes=0 WHERE id=? AND phase='dispatching'")
      .run(id)
  }
  summaries(count = 50, offset = 0) {
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 200 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new QqError('QQ 收件分页参数无效')
    const groups = this.db
      .prepare(
        `SELECT chat,MAX(seq) AS lastSeq,
      SUM(CASE WHEN phase='received' THEN 1 ELSE 0 END) AS unread,
      SUM(CASE WHEN phase IN ('dispatching','uncertain') THEN 1 ELSE 0 END) AS uncertain,
      SUM(CASE WHEN phase='admitted' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN phase='cancelled' THEN 1 ELSE 0 END) AS cancelled
      FROM messages GROUP BY chat ORDER BY lastSeq DESC LIMIT ? OFFSET ?`
      )
      .all(count + 1, offset)
    const items = groups.slice(0, count).map((group: any) => {
      const row: any = this.db
        .prepare('SELECT preview,received,mentioned,sender FROM messages WHERE seq=?')
        .get(group.lastSeq)
      return {
        chatId: group.chat as string,
        label: this.label(group.chat),
        unread: Number(group.unread),
        queued: Number(group.queued),
        cancelled: Number(group.cancelled),
        uncertain: Number(group.uncertain),
        preview: row.preview as string,
        receivedAt: Number(row.received),
        mentioned: row.mentioned === 1,
        senderId: row.sender as string
      }
    })
    return { items, ...(groups.length > count ? { nextOffset: offset + count } : {}) }
  }
}
