import { useEffect, useState } from 'react'
import { createNativeSidebar } from '../../shared/native-sidebar'
import { installUiStyles, controlStyle, cardStyle } from '../../shared/ui'
import { requestJson } from '../../shared/client-http'
import type { Persona, MemoryEntry } from './store'

export const inject: string[] = []
interface View {
  revision: number
  personas: Array<{ id: string; name: string }>
  persona: Persona
  project: string | null
}
function MemoryPanel({ sessionId, visible }: { sessionId: string; visible: boolean }): unknown {
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [name, setName] = useState(''),
    [instructions, setInstructions] = useState(''),
    [enabled, setEnabled] = useState(true)
  const [newName, setNewName] = useState(''),
    [note, setNote] = useState(''),
    [editing, setEditing] = useState<string | undefined>(undefined)
  const [scope, setScope] = useState('project')
  const dirty =
    !!note ||
    !!newName ||
    !!(
      view &&
      (name !== view.persona.name ||
        instructions !== view.persona.instructions ||
        enabled !== view.persona.memoryEnabled)
    )
  const url = `/dsh-px-memory?sessionId=${encodeURIComponent(sessionId)}`
  const accept = (data: View): void => {
    setView(data)
    setName(data.persona.name)
    setInstructions(data.persona.instructions)
    setEnabled(data.persona.memoryEnabled)
  }
  useEffect(() => {
    if (!visible || busy || dirty) return
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const data = await requestJson<View>(url, { signal: ac.signal })
        if (!ac.signal.aborted) accept(data)
      } catch (e: any) {
        if (!ac.signal.aborted) setError(String(e.message))
      }
      if (!ac.signal.aborted) timer = setTimeout(() => void refresh(), 5000)
    }
    void refresh()
    return () => {
      ac.abort()
      clearTimeout(timer)
    }
  }, [url, visible, busy, dirty])
  const act = async (action?: object): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      const data = await requestJson<View>(
        url,
        action
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...action, revision: view?.revision })
            }
          : {}
      )
      if (!action && dirty && data.persona.id !== view?.persona.id) {
        setError('另一个窗口切换了人格；请取消当前编辑后刷新，草稿未被覆盖。')
        return false
      }
      if ((!action && dirty) || (action && ['save', 'forget'].includes((action as { type: string }).type)))
        setView(data)
      else accept(data)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  const edit = (entry: MemoryEntry): void => {
    setEditing(entry.id)
    setNote(entry.text)
    setScope(entry.project ? 'project' : 'persona')
  }
  return (
    <div
      className="px-ui"
      style={{ padding: 16, height: '100%', overflow: 'auto', overflowWrap: 'anywhere', fontSize: 13 }}
    >
      <h3>人格与记忆</h3>
      {dirty && (
        <p role="status" style={{ opacity: 0.7 }}>
          有未保存的编辑，自动刷新已暂停。可手动刷新记录，草稿会保留。
        </p>
      )}
      <button style={controlStyle} disabled={busy} onClick={() => void act()}>
        刷新记录
      </button>
      <p>每个人格有独立的协作方式和记忆。切换或修改从下一轮生效，模型与权限沿用当前会话。</p>
      {error && <p role="alert">{error} </p>}
      {!view && !error && <p>正在读取…</p>}
      {view && (
        <>
          <label>
            当前会话的人格
            <select
              aria-label="当前人格"
              style={{ ...controlStyle, width: '100%', margin: '8px 0 16px' }}
              disabled={busy}
              value={view.persona.id}
              onChange={(e: any) => {
                if (
                  name !== view.persona.name ||
                  instructions !== view.persona.instructions ||
                  enabled !== view.persona.memoryEnabled ||
                  note
                ) {
                  setError('请先保存或清空当前编辑，再切换人格。')
                  return
                }
                void act({ type: 'select', personaId: e.target.value })
              }}
            >
              {view.personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <details style={{ ...cardStyle, marginBottom: 16 }}>
            <summary>编辑人格</summary>
            <label>
              名称
              <input
                disabled={busy}
                aria-label="人格名称"
                style={{ ...controlStyle, width: '100%' }}
                maxLength={60}
                value={name}
                onChange={(e: any) => setName(e.target.value)}
              />
            </label>
            <label>
              职责与协作方式
              <textarea
                disabled={busy}
                aria-label="职责与协作方式"
                rows={4}
                maxLength={2000}
                style={{ ...controlStyle, width: '100%', resize: 'vertical' }}
                placeholder="例如：先解释结论；协助研究时标明来源和不确定性。"
                value={instructions}
                onChange={(e: any) => setInstructions(e.target.value)}
              />
            </label>
            <label>
              <input
                disabled={busy}
                type="checkbox"
                checked={enabled}
                onChange={(e: any) => setEnabled(e.target.checked)}
              />{' '}
              使用并允许保存此人格的记忆
            </label>
            <p>
              <button
                style={controlStyle}
                disabled={busy || !name.trim()}
                onClick={() => void act({ type: 'configure', name, instructions, memoryEnabled: enabled })}
              >
                保存人格
              </button>
            </p>
          </details>
          {dirty && (
            <button
              style={controlStyle}
              disabled={busy}
              onClick={() => {
                accept(view)
                setNewName('')
                setNote('')
                setEditing(undefined)
              }}
            >
              取消未保存的编辑
            </button>
          )}
          {view.persona.id !== 'default' && (
            <button
              style={{ ...controlStyle, marginBottom: 16 }}
              disabled={busy || !!note}
              onClick={() => {
                if (
                  window.confirm(
                    '删除此人格及其全部记忆？使用它的会话将在下一轮恢复默认助手；已有对话记录保留。'
                  )
                )
                  void act({ type: 'delete-persona' })
              }}
            >
              删除此人格及记忆
            </button>
          )}
          <details style={{ ...cardStyle, marginBottom: 16 }}>
            <summary>新增人格</summary>
            <p>新建后使用独立的空记忆，不复制其他人格的记忆。</p>
            <input
              disabled={busy}
              aria-label="新人格名称"
              style={controlStyle}
              placeholder="例如：研究助手"
              value={newName}
              maxLength={60}
              onChange={(e: any) => setNewName(e.target.value)}
            />{' '}
            <button
              style={controlStyle}
              disabled={
                busy ||
                !newName.trim() ||
                !!note ||
                name !== view.persona.name ||
                instructions !== view.persona.instructions ||
                enabled !== view.persona.memoryEnabled
              }
              onClick={() =>
                void act({ type: 'create', name: newName }).then((ok) => {
                  if (ok) setNewName('')
                })
              }
            >
              创建并选择
            </button>
          </details>
          <h4>保存的记忆</h4>
          <p style={{ opacity: 0.7 }}>
            只显示本目录及此人格通用的记忆。可直接编辑，也可在对话中明确要求 Agent 记住或忘记。
          </p>
          {!view.persona.memoryEnabled && <p>记忆已关闭，条目仍保留。</p>}
          {view.persona.memories
            .filter((m) => !m.project || m.project === view.project)
            .map((m) => (
              <section key={m.id} style={{ ...cardStyle, marginBottom: 8 }}>
                <small>{m.project ? '本目录' : '此人格通用'}</small>
                <p style={{ whiteSpace: 'pre-wrap' }}>{m.text}</p>
                <button style={controlStyle} disabled={busy} onClick={() => edit(m)}>
                  编辑
                </button>{' '}
                <button
                  style={controlStyle}
                  disabled={busy}
                  onClick={() =>
                    void act({ type: 'forget', id: m.id }).then((ok) => {
                      if (ok && editing === m.id) {
                        setEditing(undefined)
                        setNote('')
                      }
                    })
                  }
                >
                  忘记
                </button>
              </section>
            ))}
          <textarea
            disabled={busy}
            aria-label="记忆内容"
            rows={3}
            maxLength={2000}
            style={{ ...controlStyle, width: '100%', resize: 'vertical' }}
            placeholder="写下需要在以后的会话中记住的约定…"
            value={note}
            onChange={(e: any) => setNote(e.target.value)}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <select
              disabled={busy}
              aria-label="记忆范围"
              style={controlStyle}
              value={scope}
              onChange={(e: any) => setScope(e.target.value)}
            >
              <option value="project" disabled={!view.project}>
                本目录
              </option>
              <option value="persona">此人格通用</option>
            </select>
            <button
              style={controlStyle}
              disabled={busy || !note.trim() || !view.persona.memoryEnabled}
              onClick={() =>
                void act({ type: 'save', id: editing, text: note, scope }).then((ok) => {
                  if (ok) {
                    setNote('')
                    setEditing(undefined)
                  }
                })
              }
            >
              {editing ? '保存修改' : '记住'}
            </button>
            {note && (
              <button
                style={controlStyle}
                onClick={() => {
                  setNote('')
                  setEditing(undefined)
                }}
              >
                取消编辑
              </button>
            )}
          </div>
          <p style={{ opacity: 0.65 }}>
            每条最多 2000 字，每个人格合计最多 8000 字。临时任务进度请放在会话账本中。
          </p>
        </>
      )}
    </div>
  )
}
export function apply(ctx: any): void {
  installUiStyles(ctx)
  ctx.inject(['sidebarRight', 'sidebarRightTabs', 'slots'], (host: any) =>
    host.effect(
      () =>
        createNativeSidebar(host).registerTab({
          id: 'dsh-px-memory',
          title: '人格与记忆',
          order: 17,
          component: ({ scope, visible }) => (
            <MemoryPanel key={scope.sessionId} sessionId={scope.sessionId} visible={visible} />
          )
        }),
      'memory: panel'
    )
  )
}
