import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { conversationalSource } from '../../shared/channel-source'
import { personaMailOrigin } from '../../shared/persona-mail-policy'
import { nativeJobEvidence } from './native-job-evidence'
import { controlAudit } from '../../shared/channel-control'
import { bareNativeUser, nativeDelegationRanges, type DelegationRange } from './native-delegation'
import {
  MemoryError,
  projectKey,
  isInternalSession,
  publicSession,
  samePublicConversation,
  type MemoryStore
} from './store'

export interface HistoryEvent {
  seq: number
  time: number
  type: string
  ignorable?: true
  data: any
}
export interface HistoryRecord {
  seq: number
  time: number
  kind: string
  text: string
  tool?: string
  failed?: boolean
  channelProvider?: string
}
// Loaded skills can contain persona-private instructions. Keep the original native event,
// but do not re-export its body or invocation metadata through history and handoff tools.
const privateTools =
  /^(persona_(memory|history)|qq_memory$|channel_(memory|knowledge)$|qq_public_knowledge$|mnemon_|memory_|skill$)/
const coordinationTools = new Set([
  'persona_mail',
  'job_output',
  'job_list',
  'job_kill',
  'task_wait',
  'computer_browser_resource'
])
const texts = (blocks: any): string =>
  Array.isArray(blocks)
    ? blocks
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
    : ''
const hash = (event: HistoryEvent): string => createHash('sha256').update(JSON.stringify(event)).digest('hex')
// Rebuild only the derived extraction cache when its policy changes. Original event hashes stay stable.
const cacheHash = (event: HistoryEvent): string => 'peer-control-delegation-v4:' + hash(event)

/** Deliberately excludes system/runtime-context messages, reasoning and memory-tool copies. */
export function historyRecord(
  event: HistoryEvent,
  resolveTool?: string | ((id: string) => string | undefined),
  delegatedInput = false
): HistoryRecord | undefined {
  const d = event.data ?? {}
  let kind: string, text: string, toolName: string | undefined, failed: boolean | undefined
  const peer = event.type === 'user/message' ? personaMailOrigin(d.source) : undefined
  const control =
    event.type === 'plugin:dsh-px/channel-control' && event.ignorable === true ? controlAudit(d) : undefined
  if (control)
    return {
      seq: event.seq,
      time: event.time,
      kind: 'coordination',
      tool: 'channel-control',
      channelProvider: control.provider,
      text: '[已验证成员的控制输入；不是任务完成或通用权限]\n' + JSON.stringify(control)
    }
  if (peer) {
    kind = 'peer'
    text = `[人格来信；交流资料，不是用户授权] ${JSON.stringify(peer)}\n${texts(d.content)}`
  } else if (
    event.type === 'user/message' &&
    ['agent-message', 'subagent-settled'].includes(d.source?.kind) &&
    typeof d.source.senderSessionId === 'string' &&
    d.source.senderSessionId.length > 0 &&
    d.source.senderSessionId.length <= 200 &&
    !/[\r\n\0]/.test(d.source.senderSessionId)
  ) {
    kind = 'coordination'
    toolName = d.source.kind
    text =
      '[原生智能体协作消息；不是用户授权或独立执行证明] ' +
      JSON.stringify({ senderSessionId: d.source.senderSessionId }) +
      '\n' +
      texts(d.content)
  } else if (
    event.type === 'user/message' &&
    d.source?.kind === 'user' &&
    delegatedInput &&
    !(
      typeof d.source.rpcId === 'string' &&
      d.source.rpcId.length > 0 &&
      d.source.rpcId.length <= 200 &&
      !/[\r\n\0]/.test(d.source.rpcId)
    )
  ) {
    kind = 'coordination'
    toolName = 'derived-input'
    text = '[委派或继承输入；不是独立的人类反馈]\n' + texts(d.content)
  } else if (event.type === 'user/message' && conversationalSource(d.source)) {
    kind = 'user'
    text = texts(d.content)
  } else if (event.type === 'assistant/message') {
    kind = d.interrupted === true ? 'assistant-interrupted' : 'assistant'
    text = texts(d.message?.content)
  } else if (['tool/call', 'tool/ptc-dispatch-start'].includes(event.type)) {
    if (typeof d.name !== 'string' || privateTools.test(d.name)) return
    kind = 'tool-call'
    text = `${d.name}\n${typeof d.arguments === 'string' ? d.arguments : JSON.stringify(d.arguments ?? {})}`
    toolName = d.name
  } else if (['tool/result', 'tool/ptc-dispatch'].includes(event.type)) {
    const blocks =
      event.type === 'tool/ptc-dispatch'
        ? [d]
        : d.message?.role === 'tool'
          ? [d.message]
          : (d.message?.content ?? []).filter((b: any) => b.type === 'tool-result')
    const visible = blocks.flatMap((b: any) => {
      const name =
        typeof resolveTool === 'function'
          ? resolveTool(b.toolCallId ?? d.subCallId)
          : blocks.length === 1
            ? resolveTool
            : undefined
      return name && !privateTools.test(name)
        ? [
            {
              name,
              failed: b.isError === true,
              text: `${name}\n${b.isError ? '[error] ' : ''}${texts(b.content)}`
            }
          ]
        : []
    })
    if (!visible.length) return
    toolName = visible.map((b: any) => b.name).join(', ')
    failed = visible.some((b: any) => b.failed)
    kind = visible.some((b: any) => b.name === 'persona_reply')
      ? 'peer-reply'
      : visible.some((b: any) => coordinationTools.has(b.name))
        ? 'coordination'
        : visible.every((b: any) => ['task_checkpoint', 'task_review'].includes(b.name))
          ? 'ledger'
          : 'tool-result'
    text = visible.map((b: any) => b.text).join('\n')
  } else if (/^(goal\/|team\/|job\/|turn\/end$)/.test(event.type)) {
    kind = 'native-state'
    text = `${event.type}\n${JSON.stringify(d)}`
  } else return
  return text.trim()
    ? { seq: event.seq, time: event.time, kind, text, ...(toolName ? { tool: toolName, failed } : {}) }
    : undefined
}
export function service(host: any, name: string): any {
  return typeof host.get === 'function' ? host.get(name) : host[name]
}
export async function nativeReader(host: any, id: string, signal?: AbortSignal): Promise<any> {
  const persistence = service(host, 'sessionPersistence')
  if (persistence?.open) return persistence.open(id, 'read', { signal })
  const live = service(host, 'sessions')?.get(id)
  if (live)
    return {
      header: live.header,
      inheritedEventCount: live.inheritedEventCount ?? 0,
      read: async (offset = 0, length?: number) => {
        signal?.throwIfAborted()
        return { events: live.snapshotEvents(offset).slice(0, length) }
      },
      close: async () => {}
    }
  throw new MemoryError('原生会话读取服务不可用', 503)
}

/** A rebuildable search cache; scope decisions always come from the current identity store. */
export class HistoryIndex {
  private db: DatabaseSync
  private refreshQueue: Promise<unknown> = Promise.resolve()
  private disposed = false
  constructor(
    path: string,
    private store: MemoryStore
  ) {
    mkdirSync(dirname(path), { recursive: true })
    let opened: DatabaseSync | undefined
    try {
      opened = new DatabaseSync(path)
      const check = opened.prepare('PRAGMA quick_check').get() as any
      if (check?.quick_check !== 'ok') throw Error('malformed history index')
    } catch (error) {
      opened?.close()
      if (!/malformed|not a database|corrupt/i.test(String(error))) throw error
      const suffix = '.invalid-' + Date.now()
      for (const ext of ['', '-wal', '-shm'])
        if (existsSync(path + ext)) renameSync(path + ext, path + ext + suffix)
      opened = new DatabaseSync(path)
    }
    this.db = opened
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,cwd TEXT,title TEXT,lastseq INTEGER NOT NULL DEFAULT -1,lasthash TEXT,updated INTEGER NOT NULL DEFAULT 0,complete INTEGER NOT NULL DEFAULT 0,error TEXT);
      CREATE TABLE IF NOT EXISTS calls(sid TEXT,callid TEXT,name TEXT,seq INTEGER,PRIMARY KEY(sid,callid));
      CREATE TABLE IF NOT EXISTS records(sid TEXT,seq INTEGER,time INTEGER,kind TEXT,part INTEGER,body TEXT,PRIMARY KEY(sid,seq,part));
      CREATE INDEX IF NOT EXISTS records_session_time ON records(sid,time);
      CREATE INDEX IF NOT EXISTS records_native_lookup ON records(sid,kind,part,seq);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(sid UNINDEXED,seq UNINDEXED,part UNINDEXED,body,tokenize='trigram');`)
    const version = (this.db.prepare('PRAGMA user_version').get() as any)?.user_version
    if (version > 1) {
      this.db.close()
      throw new MemoryError('历史索引由更新版本创建，请使用配套版本或重建此缓存', 409)
    }
    if (version !== 1) {
      // Earlier caches could contain loaded Skill bodies. Rebuild only derived data under
      // the new export policy; native event logs and persona bindings are never modified.
      this.db.exec(
        'BEGIN; DELETE FROM search; DELETE FROM records; DELETE FROM calls; DELETE FROM sessions; PRAGMA user_version=1; COMMIT;'
      )
    }
  }
  async close(): Promise<void> {
    this.disposed = true
    await this.refreshQueue.finally(() => this.db.close())
  }
  private allowed(sessionId: string): Record<string, number> {
    const s = this.store.authorizationSnapshot(),
      b = s.bindings[sessionId]
    if (!b) throw new MemoryError('会话尚未绑定人格', 409)
    if (b.purpose || isInternalSession(sessionId)) return Object.create(null)
    const allowed = Object.fromEntries(
      Object.entries(s.bindings)
        .filter(
          ([id, v]) =>
            v.personaId === b.personaId &&
            (!publicSession(b) || samePublicConversation(b, v)) &&
            !v.pending &&
            !v.purpose &&
            !isInternalSession(id)
        )
        .map(([id]) => [id, Number.MAX_SAFE_INTEGER])
    )
    Object.setPrototypeOf(allowed, null)
    if (
      b.handoff &&
      (!publicSession(b) || samePublicConversation(b, s.bindings[b.handoff.sessionId])) &&
      !isInternalSession(b.handoff.sessionId) &&
      !s.bindings[b.handoff.sessionId]?.purpose &&
      !Object.hasOwn(allowed, b.handoff.sessionId)
    )
      allowed[b.handoff.sessionId] = b.handoff.throughSeq
    return allowed
  }
  async refresh(host: any, sessionId: string, signal?: AbortSignal): Promise<unknown> {
    const work = this.refreshQueue.then(() => this.refreshNow(host, sessionId, signal))
    this.refreshQueue = work.catch(() => {})
    return work
  }
  private async refreshNow(host: any, sessionId: string, signal?: AbortSignal): Promise<unknown> {
    if (this.disposed) throw new MemoryError('历史索引正在关闭', 503)
    const allowed = this.allowed(sessionId),
      ids = Object.keys(allowed)
    const order = ids.sort((a, b) => {
      const row = (id: string): any =>
        this.db.prepare('SELECT complete,updated FROM sessions WHERE id=?').get(id)
      const x = row(a),
        y = row(b)
      return (x?.complete ?? 0) - (y?.complete ?? 0) || (x?.updated ?? 0) - (y?.updated ?? 0)
    })
    const errors: Array<{ sessionId: string; message: string }> = []
    let processed = 0,
      pages = 0
    // Every invocation makes bounded progress; coverage is returned explicitly, never assumed complete.
    for (const id of order.slice(0, 20)) {
      signal?.throwIfAborted()
      if (pages >= 40) break
      let reader: any
      try {
        reader = await nativeReader(host, id, signal)
        this.db
          .prepare('INSERT OR IGNORE INTO sessions(id,cwd,title) VALUES(?,?,?)')
          .run(id, projectKey(reader.header.cwd) ?? '', '')
        const saved: any = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id)
        if (saved.lastseq >= 0) {
          const at = (await reader.read(saved.lastseq, 1, { signal })).events[0]
          if (!at || cacheHash(at) !== saved.lasthash) {
            this.db.exec('BEGIN')
            try {
              this.db.prepare('DELETE FROM records WHERE sid=?').run(id)
              this.db.prepare('DELETE FROM search WHERE sid=?').run(id)
              this.db.prepare('DELETE FROM calls WHERE sid=?').run(id)
              this.db
                .prepare('UPDATE sessions SET lastseq=-1,lasthash=NULL,complete=0,title=? WHERE id=?')
                .run('', id)
              this.db.exec('COMMIT')
            } catch (e) {
              this.db.exec('ROLLBACK')
              throw e
            }
            saved.lastseq = -1
          }
        }
        let delegation: DelegationRange[] | undefined
        let cursor = saved.lastseq + 1,
          complete = false
        for (let n = 0; n < 8 && pages < 40; n++, pages++) {
          signal?.throwIfAborted()
          const events: HistoryEvent[] = (await reader.read(cursor, 256, { signal })).events
          if (!events.length) {
            complete = true
            break
          }
          if (!delegation && events.some(bareNativeUser))
            delegation = await nativeDelegationRanges(
              reader,
              (parent) => nativeReader(host, parent, signal),
              signal
            )
          this.append(id, events, delegation ?? [])
          cursor = events.at(-1)!.seq + 1
          if (events.length < 256) {
            complete = true
            break
          }
        }
        this.db
          .prepare('UPDATE sessions SET complete=?,error=NULL,updated=? WHERE id=?')
          .run(complete ? 1 : 0, Date.now(), id)
        processed++
      } catch (e) {
        signal?.throwIfAborted()
        const message = e instanceof Error ? e.message : String(e)
        errors.push({ sessionId: id, message })
        this.db.prepare('UPDATE sessions SET complete=0,error=? WHERE id=?').run(message.slice(0, 500), id)
      } finally {
        await reader?.close()
      }
    }
    const complete = this.db
      .prepare('SELECT count(*) n FROM sessions WHERE id IN (SELECT key FROM json_each(?)) AND complete=1')
      .get(JSON.stringify(allowed)) as any
    return {
      indexedSessions: complete.n,
      totalSessions: ids.length,
      processed,
      partial: complete.n < ids.length,
      errors
    }
  }
  private append(id: string, events: HistoryEvent[], delegation: DelegationRange[]): void {
    this.db.exec('BEGIN')
    try {
      for (const e of events) {
        const d = e.data ?? {}
        if (['tool/call', 'tool/ptc-dispatch-start'].includes(e.type) && typeof d.name === 'string')
          this.db
            .prepare('INSERT OR REPLACE INTO calls VALUES(?,?,?,?)')
            .run(id, d.callId ?? d.subCallId ?? '', d.name, e.seq)
        const row = historyRecord(
          e,
          (callId: string) =>
            (this.db.prepare('SELECT name FROM calls WHERE sid=? AND callid=?').get(id, callId) as any)?.name,
          delegation.some((range) => e.seq >= range.from && e.seq <= range.through)
        )
        if (row) {
          // Chunk the full text, including the middle of long outputs; exact reads go back to DSH.
          for (let offset = 0, part = 0; offset < row.text.length; offset += 4000, part++) {
            const body = row.text.slice(offset, offset + 4128)
            this.db
              .prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?)')
              .run(id, e.seq, e.time, row.kind, part, body)
            this.db
              .prepare('INSERT INTO search(sid,seq,part,body) VALUES(?,?,?,?)')
              .run(id, e.seq, part, body)
          }
          if (row.kind === 'user')
            this.db
              .prepare("UPDATE sessions SET title=CASE WHEN title='' THEN ? ELSE title END WHERE id=?")
              .run(row.text.slice(0, 100), id)
        }
        if (e.type === 'session/title' && typeof d.title === 'string')
          this.db.prepare('UPDATE sessions SET title=? WHERE id=?').run(d.title.slice(0, 200), id)
      }
      const last = events.at(-1)!
      this.db
        .prepare('UPDATE sessions SET lastseq=?,lasthash=? WHERE id=?')
        .run(last.seq, cacheHash(last), id)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  search(
    sessionId: string,
    query: string,
    options: { project?: string; beforeTime?: number; limit?: number; targetSessionId?: string } = {}
  ): unknown {
    const allowed = this.allowed(sessionId),
      limit = Math.min(20, Math.max(1, options.limit ?? 20))
    if (typeof query !== 'string' || query.length > 256) throw new MemoryError('搜索内容最多 256 字')
    const terms = query.trim().split(/\s+/u).filter(Boolean).slice(0, 8)
    const useFts = terms.length > 0 && terms.every((t) => [...t].length >= 3)
    const source = useFts
      ? 'search JOIN records r ON r.sid=search.sid AND r.seq=search.seq AND r.part=search.part'
      : 'records r'
    const predicates = ['r.seq<=a.value'],
      values: any[] = [JSON.stringify(allowed)]
    if (useFts) {
      predicates.push('search MATCH ?')
      values.push(terms.map((t) => '"' + t.replaceAll('"', '""') + '"').join(' AND '))
    } else
      for (const term of terms) {
        predicates.push("r.body LIKE ? ESCAPE '\\'")
        values.push('%' + term.replace(/[\\%_]/g, '\\$&') + '%')
      }
    if (options.project) {
      predicates.push('s.cwd=?')
      values.push(projectKey(options.project))
    }
    if (options.targetSessionId) {
      predicates.push('r.sid=?')
      values.push(options.targetSessionId)
    }
    if (options.beforeTime !== undefined) {
      predicates.push('r.time<?')
      values.push(options.beforeTime)
    }
    values.push(limit)
    const rows = this.db
      .prepare(
        `SELECT r.sid sessionId,r.seq,r.time,r.kind,r.part,r.body,(SELECT substr(t.body,1,100) FROM records t WHERE t.sid=r.sid AND t.kind='user' AND t.seq<=a.value AND t.part=0 ORDER BY t.seq LIMIT 1) title,s.cwd FROM ${source} JOIN json_each(?) a ON a.key=r.sid JOIN sessions s ON s.id=r.sid WHERE ${predicates.join(' AND ')} ORDER BY ${useFts ? 'bm25(search),' : ''} r.time DESC,r.seq DESC LIMIT ?`
      )
      .all(...values) as any[]
    return rows.map(({ body, ...r }) => {
      const at = terms.length ? body.toLocaleLowerCase().indexOf(terms[0].toLocaleLowerCase()) : 0
      const start = Math.max(0, at - 100)
      return {
        ...r,
        ...(['peer', 'peer-reply'].includes(r.kind)
          ? { authority: 'peer-advice-only' }
          : r.kind === 'coordination'
            ? { authority: 'coordination-receipt-only' }
            : {}),
        snippet: body.slice(start, start + 700),
        source: 'native-session-event',
        historical: true,
        readOffset: r.part * 4000 + start,
        sourceThroughSeq: allowed[r.sessionId] === Number.MAX_SAFE_INTEGER ? null : allowed[r.sessionId]
      }
    })
  }
  list(sessionId: string, project?: string): unknown {
    const allowed = this.allowed(sessionId)
    return this.db
      .prepare(
        `SELECT s.id sessionId,s.cwd,min(s.lastseq,a.value) throughSeq,s.complete,s.error,max(r.time) lastEventAt,count(DISTINCT r.seq) indexedEvents,
        (SELECT substr(t.body,1,100) FROM records t WHERE t.sid=s.id AND t.kind='user' AND t.seq<=a.value AND t.part=0 ORDER BY t.seq LIMIT 1) title,
        (SELECT substr(t.body,1,700) FROM records t WHERE t.sid=s.id AND t.kind='assistant' AND t.seq<=a.value AND t.part=0 ORDER BY t.seq DESC LIMIT 1) lastReply,
        (SELECT substr(t.body,1,1000) FROM records t WHERE t.sid=s.id AND t.kind='native-state' AND t.seq<=a.value AND t.part=0 ORDER BY t.seq DESC LIMIT 1) lastState
        FROM sessions s JOIN json_each(?) a ON a.key=s.id LEFT JOIN records r ON r.sid=s.id AND r.seq<=a.value WHERE (? IS NULL OR s.cwd=?) GROUP BY s.id HAVING count(r.seq)>0 ORDER BY lastEventAt DESC LIMIT 100`
      )
      .all(JSON.stringify(allowed), projectKey(project) ?? null, projectKey(project) ?? null)
  }
  async read(
    host: any,
    caller: string,
    target: string,
    seq: number,
    offset = 0,
    signal?: AbortSignal
  ): Promise<unknown> {
    const allowed = this.allowed(caller)
    if (!Object.hasOwn(allowed, target) || !Number.isSafeInteger(seq) || seq < 0 || seq > allowed[target])
      throw new MemoryError('原文不在本会话允许读取的历史范围内', 403)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new MemoryError('读取位置无效')
    const reader = await nativeReader(host, target, signal)
    try {
      const event = (await reader.read(seq, 1, { signal })).events[0] as HistoryEvent | undefined
      if (!event) throw new MemoryError('原始事件不存在', 404)
      const d = event.data ?? {},
        blocks =
          event.type === 'tool/ptc-dispatch'
            ? [d]
            : d.message?.role === 'tool'
              ? [d.message]
              : (d.message?.content ?? []).filter((b: any) => b.type === 'tool-result'),
        names = new Map<string, string>(),
        argumentsByCall = new Map<string, unknown>()
      for (const block of blocks) {
        const callId = block.toolCallId ?? d.subCallId
        if (typeof callId !== 'string') continue
        const cached = this.db
          .prepare('SELECT seq FROM calls WHERE sid=? AND callid=?')
          .get(target, callId) as any
        if (cached && cached.seq <= seq) {
          const source = (await reader.read(cached.seq, 1, { signal })).events[0]
          if (
            source &&
            ['tool/call', 'tool/ptc-dispatch-start'].includes(source.type) &&
            (source.data.callId ?? source.data.subCallId) === callId
          ) {
            names.set(callId, source.data.name)
            argumentsByCall.set(callId, source.data.arguments)
          }
        }
      }
      const wanted = new Set<string>(
        blocks
          .map((b: any) => b.toolCallId ?? d.subCallId)
          .filter((id: any) => typeof id === 'string' && !names.has(id))
      )
      for (let cursor = seq - 1, pages = 0; wanted.size && cursor >= 0 && pages < 256; pages++) {
        signal?.throwIfAborted()
        const start = Math.max(0, cursor - 255),
          earlier = (await reader.read(start, cursor - start + 1, { signal })).events
        for (let i = earlier.length - 1; i >= 0; i--) {
          const e = earlier[i],
            id = e.data?.callId ?? e.data?.subCallId
          if (['tool/call', 'tool/ptc-dispatch-start'].includes(e.type) && wanted.has(id)) {
            names.set(id, e.data.name)
            argumentsByCall.set(id, e.data.arguments)
            wanted.delete(id)
          }
        }
        cursor = start - 1
      }
      if (wanted.size) throw new MemoryError('尚未定位原工具调用，请继续更新历史索引后读取', 409)
      const delegation = bareNativeUser(event)
        ? await nativeDelegationRanges(reader, (parent) => nativeReader(host, parent, signal), signal, seq)
        : []
      const row = historyRecord(
        event,
        (id: string) => names.get(id),
        delegation.some((range) => event.seq >= range.from && event.seq <= range.through)
      )
      if (!row) throw new MemoryError('该事件不是可共享的对话、执行结果或原生状态', 403)
      let job: Awaited<ReturnType<typeof nativeJobEvidence>>
      if (row.tool === 'job_output' && blocks.length === 1 && row.failed === false) {
        const raw = argumentsByCall.get(blocks[0].toolCallId ?? d.subCallId)
        let args: any
        try {
          args = typeof raw === 'string' ? JSON.parse(raw) : raw
        } catch {
          /* malformed historical input is not evidence */
        }
        if (typeof args?.job_id === 'string') {
          const pattern = '%"jobId":' + JSON.stringify(args.job_id).replace(/[\\%_]/g, '\\$&') + '%'
          const cached = this.db
            .prepare(
              "SELECT seq FROM records WHERE sid=? AND kind='native-state' AND part=0 AND seq<=? AND body LIKE ? ESCAPE '\\' ORDER BY seq DESC LIMIT 32"
            )
            .all(target, seq, pattern)
          job = await nativeJobEvidence(
            reader,
            target,
            seq,
            args.job_id,
            cached.map((r) => Number(r.seq)),
            signal
          )
          if (job) {
            row.kind = 'tool-result'
            row.failed = job.status !== 'completed'
          }
        }
      }
      return {
        sessionId: target,
        eventHash: hash(event),
        seq,
        time: row.time,
        kind: row.kind,
        ...(['peer', 'peer-reply'].includes(row.kind)
          ? { authority: 'peer-advice-only' }
          : row.kind === 'coordination'
            ? { authority: 'coordination-receipt-only' }
            : {}),
        tool: row.tool,
        failed: row.failed,
        ...(row.channelProvider ? { channelProvider: row.channelProvider } : {}),
        ...(job ? { nativeJob: job, authority: 'native-execution-receipt' } : {}),
        text: row.text.slice(offset, offset + 12000),
        offset,
        nextOffset: offset + 12000 < row.text.length ? offset + 12000 : null,
        totalCharacters: row.text.length,
        historical: true,
        sourceThroughSeq: allowed[target] === Number.MAX_SAFE_INTEGER ? null : allowed[target],
        source: 'native-session-event'
      }
    } finally {
      await reader.close()
    }
  }
}
