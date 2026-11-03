import { DatabaseSync } from 'node:sqlite'
import { MemoryError } from './store'

const startMarker = '\ufdd0',
  endMarker = '\ufdd1'
const sanitize = (value: string) => value.replace(/[\0\ufdd0\ufdd1]/g, '\ufffd')

/** Match visible exports with the pinned native SQLite provider's literal unicode61 phrase rules. */
export class NativeVisibleQuery {
  private db: DatabaseSync
  private phrase: string
  constructor(query: string) {
    const normalized = query.trim().replace(/\s+/gu, ' ')
    if (!normalized || normalized.includes('\0')) throw new MemoryError('历史搜索内容无效')
    this.phrase = '"' + sanitize(normalized).replaceAll('"', '""') + '"'
    this.db = new DatabaseSync(':memory:')
    this.db.exec("CREATE VIRTUAL TABLE evidence USING fts5(body, tokenize='unicode61')")
  }
  excerpt(text: string): { snippet: string; readOffset: number } | undefined {
    this.db.exec('DELETE FROM evidence')
    this.db.prepare('INSERT INTO evidence(body) VALUES(?)').run(sanitize(text))
    const row = this.db
      .prepare('SELECT highlight(evidence,0,?,?) marked FROM evidence WHERE evidence MATCH ? LIMIT 1')
      .get(startMarker, endMarker, this.phrase)
    if (!row) return
    const marked = String(row.marked),
      offset = Math.max(0, marked.indexOf(startMarker) - 100),
      clean = marked.replaceAll(startMarker, '').replaceAll(endMarker, '')
    return { snippet: clean.slice(offset, offset + 700), readOffset: offset }
  }
  close(): void {
    this.db.close()
  }
}
