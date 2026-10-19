import { useEffect, useState } from 'react'
import type { MemorySourcePageProps } from 'dsh-mnemon/client'
import { controlStyle, cardStyle } from '../../shared/ui'

function KnowledgeSourcePage({
  source,
  openSession
}: {
  source: MemorySourcePageProps
  openSession: (id: string) => void
}): unknown {
  const [rows, setRows] = useState<any[]>([]),
    [scope, setScope] = useState(''),
    [document, setDocument] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setDocument(null)
    setError('')
    void source.management
      ?.read('snapshot')
      .then((r) => {
        if (!active) return
        const scopes = (r.value as any).scopes ?? []
        setRows(scopes)
        setScope((old) => (scopes.some((s: any) => s.scope === old) ? old : (scopes[0]?.scope ?? '')))
      })
      .catch((e) => {
        if (active) setError(String(e.message))
      })
    return () => {
      active = false
    }
  }, [source.management, source.refreshKey])
  const read = async (id: string, historical = false) => {
    setBusy(true)
    setError('')
    try {
      const r = await source.management?.read('query', { action: 'read', scope, id, historical })
      setDocument((r?.value as any)?.document)
    } catch (e: any) {
      setError(String(e.message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="px-ui" style={{ padding: 16, overflowWrap: 'anywhere' }}>
      <h3>PX 知识</h3>
      <p>
        人格私有与公共知识分开保存。这里只展示当前原生访问范围；编辑、分享和 Skills
        管理可从统一的“记忆与知识”页面进入。
      </p>
      {!source.sessionId && (
        <p className="px-muted">当前没有绑定会话，仅显示公共范围。私有知识需要先选择对应人格的会话。</p>
      )}
      {source.sessionId && (
        <button style={controlStyle} onClick={() => openSession(source.sessionId!)}>
          返回记忆与知识
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <select
        aria-label="Mnemon 知识范围"
        style={controlStyle}
        value={scope}
        disabled={busy}
        onChange={(e: any) => {
          setScope(e.target.value)
          setDocument(null)
        }}
      >
        {rows.map((r) => (
          <option key={r.scope} value={r.scope}>
            {r.label}
          </option>
        ))}
      </select>
      {(rows.find((r) => r.scope === scope)?.documents ?? []).map((d: any) => (
        <button
          key={d.id}
          style={{ ...controlStyle, display: 'block', marginTop: 8 }}
          disabled={busy}
          onClick={() => void read(d.id)}
        >
          {d.key} · v{d.revision}
          {d.status === 'archived' ? ' · 已归档' : ''}
        </button>
      ))}
      {document && (
        <div style={{ ...cardStyle, marginTop: 12 }}>
          <strong>
            {document.key} · v{document.revision}
          </strong>
          {!document.current && <p role="status">已过时、已归档或来源暂不可验证，不作为当前结论。</p>}
          {document.body !== undefined ? (
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{document.body}</pre>
          ) : (
            <button disabled={busy} onClick={() => void read(document.id, true)}>
              查看历史正文
            </button>
          )}
        </div>
      )}
    </div>
  )
}
/** Public Mnemon child-slot contract; no hard client import, so disabling Mnemon cannot break the persona panel. */
export function registerMnemonKnowledgePage(host: any, openWorkspace: (id: string) => void): () => void {
  return host.slots.inject('mnemon.source.page', () =>
    host.slots.register(
      { name: 'mnemon.source.page', id: 'px-knowledge/library', order: 100, label: 'PX 知识' },
      Object.assign(
        (props: MemorySourcePageProps) => <KnowledgeSourcePage source={props} openSession={openWorkspace} />,
        { mnemonNavigation: { group: 'storage', primary: true, glyph: '◇', detail: '人格、项目与共享知识' } }
      )
    )
  )
}
