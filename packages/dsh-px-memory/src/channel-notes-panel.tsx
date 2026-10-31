import { useEffect, useState } from 'react'
import { requestJson } from '../../shared/client-http'
import { cardStyle } from '../../shared/ui'

export function ChannelNotesPanel({ url }: { url: string }) {
  const [catalog, setCatalog] = useState<any>(null),
    [note, setNote] = useState<any>(null)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [original, setOriginal] = useState<any>(null)
  const request = <T,>(input: unknown, signal?: AbortSignal) =>
    requestJson<T>(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({ type: 'conversation-memory', input })
    })
  useEffect(() => {
    const ac = new AbortController()
    setError('')
    setNote(null)
    setOriginal(null)
    void request<any>({ action: 'catalog' }, ac.signal)
      .then((value) => {
        if (!ac.signal.aborted) setCatalog(value)
      })
      .catch((error) => {
        if (!ac.signal.aborted) setError(error.message)
      })
    return () => ac.abort()
  }, [url, refresh])
  let body: any
  try {
    body = note?.body ? JSON.parse(note.body) : null
  } catch {
    body = { observation: note?.body }
  }
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (error: any) {
      setError(error.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <h3>本聊天记忆</h3>
      <p className="px-muted">
        只属于此人格在当前聊天中的经历与约定。项目共享知识仍在“知识与 Skills”中管理。
      </p>
      <button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
        刷新聊天记忆
      </button>
      {error && <p role="alert">{error}</p>}
      {catalog?.total === 0 && <p>此人格在这个聊天中还没有保存的记忆。</p>}
      {(catalog?.notes ?? []).map((row: any) => (
        <button
          key={row.id}
          style={{ display: 'block', marginTop: 8 }}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const value: any = await request({ action: 'read', id: row.id })
              setNote(value.note)
              setOriginal(null)
            })
          }
        >
          {row.topic}
        </button>
      ))}
      {catalog?.nextOffset != null && (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const value: any = await request({
                action: 'catalog',
                offset: catalog.nextOffset,
                revision: catalog.revision
              })
              setCatalog({ ...value, notes: [...catalog.notes, ...value.notes] })
            })
          }
        >
          继续读取记忆
        </button>
      )}
      {note && (
        <div style={cardStyle}>
          <strong>{note.topic}</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{body?.observation ?? note.body}</p>
          <p className="px-muted">
            修订 {note.revision} · {note.current ? '现行记录' : '历史记录，使用前需核对'}
          </p>
          {(body?.evidence ?? []).map((evidence: any, index: number) => (
            <button
              key={index}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const value: any = await requestJson(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      type: 'read-history',
                      targetSessionId: evidence.sessionId,
                      seq: evidence.seq,
                      offset: 0
                    })
                  })
                  setOriginal(value.result)
                })
              }
            >
              读取依据 {index + 1}（事件 {evidence.seq}）
            </button>
          ))}
          {original && (
            <pre style={{ whiteSpace: 'pre-wrap' }}>{original.text ?? JSON.stringify(original, null, 2)}</pre>
          )}
        </div>
      )}
    </section>
  )
}
