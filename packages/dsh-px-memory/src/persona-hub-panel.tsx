import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../shared/client-http'
import type { PersonaHubView as HubView } from './persona-hub'

/** Switching this directory never rebinds native sessions or changes another window's selection. */
export function PersonaHubPanel({
  openSession,
  titles
}: {
  openSession: (id: string) => void
  titles: Record<string, any>
}) {
  const [personaId, setPersonaId] = useState('default'),
    [workspaceId, setWorkspaceId] = useState('')
  const [view, setView] = useState<HubView | null>(null),
    [error, setError] = useState('')
  const [busy, setBusy] = useState(false),
    [newName, setNewName] = useState(''),
    [refresh, setRefresh] = useState(0)
  const request = useRef<{ key: string; id: string } | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const ac = new AbortController()
    setError('')
    setView(null)
    void requestJson<HubView>('/dsh-px-personas?personaId=' + encodeURIComponent(personaId), {
      signal: ac.signal
    })
      .then((data) => {
        if (ac.signal.aborted) return
        setView(data)
        setWorkspaceId((current) =>
          data.workspaces.some((w) => w.id === current) ? current : (data.workspaces[0]?.id ?? '')
        )
      })
      .catch((error) => {
        if (!ac.signal.aborted) setError(error.message)
      })
    return () => ac.abort()
  }, [personaId, refresh])
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (error: any) {
      if (alive.current) setError(error.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const post = <T,>(input: unknown) =>
    requestJson<T>('/dsh-px-personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    })
  const selected = view?.personas.find((p) => p.id === personaId)
  return (
    <section className="px-ui" style={{ padding: 20, overflow: 'auto', minHeight: 0 }}>
      <h2>人格与会话</h2>
      <p className="px-muted">
        每个人格使用自己的会话、记忆和私有技能。已开始的会话保留原身份，正在运行的工作继续。
      </p>
      {error && <p role="alert">{error}</p>}
      {!view && !error && <p role="status">正在读取人格目录…</p>}
      {view && (
        <>
          <div className="px-actions">
            <label>
              查看人格{' '}
              <select
                aria-label="查看人格"
                value={personaId}
                disabled={busy}
                onChange={(event: any) => setPersonaId(event.target.value)}
              >
                {view.personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name}
                    {persona.archived ? '（已归档）' : ''} · {persona.sessionCount} 个会话
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
              刷新目录
            </button>
          </div>
          <details style={{ marginTop: 16 }}>
            <summary>创建人格</summary>
            <label>
              人格名称{' '}
              <input
                aria-label="新建人格名称"
                maxLength={60}
                value={newName}
                disabled={busy}
                onChange={(event: any) => setNewName(event.target.value)}
              />
            </label>
            <button
              disabled={busy || !newName.trim()}
              onClick={() =>
                void run(async () => {
                  const created = await post<{ id: string }>({ type: 'create-persona', name: newName })
                  if (alive.current) {
                    setNewName('')
                    setPersonaId(created.id)
                  }
                })
              }
            >
              创建独立人格
            </button>
          </details>
          <div className="px-actions" style={{ marginTop: 16 }}>
            <label>
              工作区{' '}
              <select
                aria-label="人格新会话工作区"
                value={workspaceId}
                disabled={busy}
                onChange={(event: any) => setWorkspaceId(event.target.value)}
              >
                {!view.workspaces.length && <option value="">先在原生侧栏添加工作区</option>}
                {view.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !workspaceId || !!selected?.archived}
              onClick={() =>
                void run(async () => {
                  const key = JSON.stringify([personaId, workspaceId])
                  if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
                  const created = await post<{ createdSessionId: string }>({
                    type: 'create-session',
                    personaId,
                    workspaceId,
                    requestId: request.current.id
                  })
                  if (alive.current) {
                    request.current = null
                    openSession(created.createdSessionId)
                  }
                })
              }
            >
              用此人格新建会话
            </button>
          </div>
          <h3>{selected?.name}的会话</h3>
          {!view.sessions.length && <p>这个人格还没有已保存的普通会话。</p>}
          {view.sessions.map((row) => (
            <div key={row.id} className="px-card" style={{ marginTop: 8 }}>
              <button disabled={busy} onClick={() => openSession(row.id)}>
                {titles[row.id]?.displayTitle ?? `${row.channel ? row.channel + ' · ' : ''}${row.id}`}
              </button>
              <div className="px-muted">
                {row.running ? '运行中' : row.live ? '会话已加载' : '已保存'} · {row.cwd ?? '无项目目录'}
              </div>
            </div>
          ))}
          {view.nextOffset !== null && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const more = await requestJson<HubView>(
                    `/dsh-px-personas?personaId=${encodeURIComponent(personaId)}&offset=${view.nextOffset}`
                  )
                  if (alive.current)
                    setView((old) =>
                      old?.selectedPersonaId === more.selectedPersonaId
                        ? {
                            ...more,
                            sessions: [
                              ...old.sessions,
                              ...more.sessions.filter(
                                (row) => !old.sessions.some((existing) => existing.id === row.id)
                              )
                            ]
                          }
                        : old
                    )
                })
              }
            >
              继续读取会话（已显示 {view.sessions.length} / {view.total}）
            </button>
          )}
        </>
      )}
      {error && !view && (
        <button
          onClick={() => {
            setPersonaId('default')
            setRefresh((v) => v + 1)
          }}
        >
          返回默认人格并重试
        </button>
      )}
    </section>
  )
}
