import { useEffect, useState } from 'react'
import { requestJson } from '../../shared/client-http'

const kinds: Record<string, string> = {
  user: '用户原话',
  assistant: '助手历史回答',
  'assistant-interrupted': '助手中断输出（未完成）',
  'tool-call': '工具调用',
  'tool-result': '工具返回',
  ledger: '工作账本／检视摘要（含模型记录）',
  'native-state': '原生状态记录'
}
export function HistoryPanel({
  url,
  visible,
  openSession
}: {
  url: string
  visible: boolean
  openSession: (id: string) => void
}): unknown {
  const [query, setQuery] = useState(''),
    [projectOnly, setProjectOnly] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [data, setData] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [detailKey, setDetailKey] = useState('')
  const post = async (args: object) =>
    requestJson<any>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    })
  const search = async (targetSessionId?: string) => {
    setBusy(true)
    setError('')
    setDetail(null)
    try {
      setData(
        await post({
          type: 'search-history',
          query: targetSessionId ? '' : query,
          projectOnly,
          targetSessionId
        })
      )
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const read = async (row: any, offset = 0, key?: string) => {
    setBusy(true)
    setError('')
    try {
      const next = await post({ type: 'read-history', targetSessionId: row.sessionId, seq: row.seq, offset })
      setDetail(next.result)
      if (key) setDetailKey(key)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    setData(null)
    setDetail(null)
    setError('')
  }, [url])
  if (!visible) return null
  return (
    <section className="px-card">
      <h4>本人格的经历与历史</h4>
      <p>按关键词找回交流、执行记录和原生任务状态。目录显示原文摘录，不把旧回答当成已验证事实。</p>
      <form
        onSubmit={(e: any) => {
          e.preventDefault()
          void search()
        }}
      >
        <input
          aria-label="搜索人格历史"
          value={query}
          maxLength={256}
          placeholder="例如：更新失败，或多个关键词用空格分隔"
          onChange={(e: any) => setQuery(e.target.value)}
          disabled={busy}
        />
        <label>
          <input
            type="checkbox"
            checked={projectOnly}
            onChange={(e: any) => setProjectOnly(e.target.checked)}
            disabled={busy}
          />
          仅本项目
        </label>
        <button disabled={busy} type="submit">
          {busy ? '正在查询…' : query.trim() ? '搜索历史' : '查看经历目录'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {data?.coverage && (
        <p className="px-muted">
          已索引 {data.coverage.indexedSessions} / {data.coverage.totalSessions} 个可读会话。
          {data.coverage.partial ? '仍有未完成或不可读记录；再次查询会继续索引。' : '本次索引已完成。'}
        </p>
      )}
      {data?.coverage?.errors?.length > 0 && <p role="status">部分原始会话不可读，结果可能不完整。</p>}
      {data && (
        <p className="px-muted">
          目录最多显示最近 100 个会话，关键词检索每次最多 20 条记录。结果是历史片段，不代表当前仍然有效。
        </p>
      )}
      {data?.result?.length === 0 && (
        <p>未找到匹配内容。可换关键词或取消“仅本项目”；不会搜索其他人格的私有库。</p>
      )}
      {data?.result?.map((row: any) => (
        <article className="px-card" key={`${row.sessionId}:${row.seq ?? 'session'}:${row.part ?? 0}`}>
          <strong title={row.title}>
            {row.title?.length > 80 ? row.title.slice(0, 80) + '…' : row.title || '历史会话'}
          </strong>
          <p className="px-muted">
            {row.kind ? (kinds[row.kind] ?? row.kind) : '会话原文目录'} ·{' '}
            {new Date(row.time ?? row.lastEventAt ?? 0).toLocaleString()}
            {row.seq !== undefined ? ` · 事件 ${row.seq}` : ''}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>
            {String(row.snippet ?? row.lastReply ?? '暂无助手回复').slice(0, 240)}
            {String(row.snippet ?? row.lastReply ?? '').length > 240 ? '…' : ''}
          </p>
          {row.lastState && (
            <details>
              <summary>最近状态记录（历史）</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{row.lastState}</pre>
            </details>
          )}
          <div className="px-actions">
            <button
              disabled={busy}
              onClick={() =>
                row.seq === undefined
                  ? void search(row.sessionId)
                  : void read(row, row.readOffset ?? 0, `${row.sessionId}:${row.seq}:${row.part ?? 0}`)
              }
            >
              {row.seq === undefined ? '查看最近记录' : '读取原文'}
            </button>
            <button disabled={busy} onClick={() => openSession(row.sessionId)}>
              打开原会话
            </button>
          </div>
          {detail && detailKey === `${row.sessionId}:${row.seq}:${row.part ?? 0}` && (
            <section className="px-card" aria-label="历史原文">
              <strong>
                {kinds[detail.kind] ?? detail.kind} · 事件 {detail.seq}
              </strong>
              <p className="px-muted">原生会话 {detail.sessionId} · 历史内容</p>
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>{detail.text}</pre>
              {detail.nextOffset !== null && (
                <button disabled={busy} onClick={() => void read(detail, detail.nextOffset)}>
                  下一段原文
                </button>
              )}
              <button onClick={() => setDetail(null)}>收起原文</button>
            </section>
          )}
        </article>
      ))}
    </section>
  )
}
