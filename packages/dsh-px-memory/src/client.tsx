import { useEffect, useRef, useState } from 'react'
import { createNativeSidebar } from '../../shared/native-sidebar'
import { installUiStyles, controlStyle, cardStyle } from '../../shared/ui'
import { requestJson } from '../../shared/client-http'
import type { Persona, MemoryEntry, SessionBinding } from './store'
import { HistoryPanel } from './history-panel'
import { KnowledgePanel } from './knowledge-panel'
import { registerMnemonKnowledgePage } from './mnemon-page'

export const inject: string[] = []
interface View {
  revision: number
  personas: Array<{ id: string; name: string; archived?: boolean }>
  persona: Persona
  template: Persona
  binding: SessionBinding
  project: string | null
}
function MemoryPanel({
  sessionId,
  visible,
  openKnowledge,
  openSession
}: {
  sessionId: string
  visible: boolean
  openKnowledge: () => void
  openSession: (id: string) => void
}): unknown {
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
  const [targetPersona, setTargetPersona] = useState('')
  const [knowledgePage, setKnowledgePage] = useState(false)
  const newRequest = useRef<{ key: string; id: string } | null>(null)
  const alive = useRef(true),
    isVisible = useRef(visible)
  useEffect(() => {
    isVisible.current = visible
  }, [visible])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const configDirty = !!(
    view &&
    (name !== view.template.name ||
      instructions !== view.template.instructions ||
      enabled !== view.persona.memoryEnabled)
  )
  const dirty = !!note || !!newName || configDirty
  const url = `/dsh-px-memory?sessionId=${encodeURIComponent(sessionId)}`
  const accept = (data: View): void => {
    setView(data)
    setName(data.template.name)
    setInstructions(data.template.instructions)
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
      if (configDirty && (!action || ['save', 'forget'].includes((action as { type: string }).type)))
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
  const createSession = async (handoff: boolean) => {
    if (!targetPersona) return
    setBusy(true)
    setError('')
    const key = `${sessionId}:${targetPersona}:${handoff}`
    if (newRequest.current?.key !== key) newRequest.current = { key, id: crypto.randomUUID() }
    try {
      const data = await requestJson<{ createdSessionId: string }>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'new-session',
          personaId: targetPersona,
          handoff,
          requestId: newRequest.current.id
        })
      })
      if (alive.current && isVisible.current) openSession(data.createdSessionId)
      newRequest.current = null
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  if (knowledgePage && view)
    return (
      <div
        className="px-ui"
        style={{ padding: 16, height: '100%', overflow: 'auto', overflowWrap: 'anywhere', fontSize: 13 }}
      >
        <button style={controlStyle} onClick={() => setKnowledgePage(false)}>
          返回人格与经历
        </button>
        <h3>知识与 Skills</h3>
        <p className="px-muted">当前人格：{view.persona.name}</p>
        <KnowledgePanel
          key={sessionId + view.persona.id}
          sessionId={sessionId}
          personaId={view.persona.id}
          project={view.project}
          openLegacy={openKnowledge}
        />
      </div>
    )
  return (
    <div
      className="px-ui"
      style={{ padding: 16, height: '100%', overflow: 'auto', overflowWrap: 'anywhere', fontSize: 13 }}
    >
      <h3>人格与经历</h3>
      <div className="px-actions">
        <button style={controlStyle} disabled={busy || dirty || !view} onClick={() => setKnowledgePage(true)}>
          知识与 Skills
        </button>
        <button
          style={controlStyle}
          disabled={busy || dirty}
          title={dirty ? '请先保存或放弃下方编辑' : '打开社区知识管理页面'}
          onClick={() => {
            try {
              openKnowledge()
            } catch {
              setError(
                '项目知识页面未加载。请在“插件”中安装或启用 dsh-mnemon；已有安装继续使用你自己的设置。'
              )
            }
          }}
        >
          打开项目知识
        </button>
      </div>
      {dirty && (
        <p role="status" style={{ opacity: 0.7 }}>
          有未保存的编辑，自动刷新已暂停。可手动刷新记录，草稿会保留。
        </p>
      )}
      <button style={controlStyle} disabled={busy} onClick={() => void act()}>
        刷新记录
      </button>
      <p>会话开始运行后固定人格。需要换人格时新建接续会话；模型与权限仍由原生会话管理。</p>
      {error && <p role="alert">{error} </p>}
      {!view && !error && <p>正在读取…</p>}
      {view && (
        <>
          <label>
            当前会话的人格
            <select
              aria-label="当前人格"
              style={{ ...controlStyle, width: '100%', margin: '8px 0 16px' }}
              disabled={busy || view.binding.locked}
              value={view.persona.id}
              onChange={(e: any) => {
                if (dirty) {
                  setError('请先保存或清空当前编辑，再切换人格。')
                  return
                }
                void act({ type: 'select', personaId: e.target.value })
              }}
            >
              {view.personas.map((p) => (
                <option key={p.id} value={p.id} disabled={p.archived}>
                  {p.name}
                  {p.archived ? '（已归档）' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="px-muted">
            本会话使用配置版本 {view.binding.personaRevision}。
            {view.binding.locked ? '人格已固定。' : '尚未开始，可以选择人格。'}
          </p>
          {view.persona.archived && (
            <p role="status">此人格已归档。历史仍可查看，请新建其他人格的会话继续。</p>
          )}
          {view.template.revision !== view.binding.personaRevision && (
            <button
              disabled={busy || view.persona.archived}
              onClick={() => void act({ type: 'adopt-version' })}
            >
              本会话采用最新人格配置（版本 {view.template.revision}）
            </button>
          )}
          {view.binding.handoff && (
            <p className="px-muted">
              已接续来源会话截至事件 {view.binding.handoff.throughSeq}{' '}
              的对话与执行记录；原会话任务不会自动恢复。
            </p>
          )}
          <HistoryPanel key={view.persona.id} url={url} visible={visible} openSession={openSession} />
          <details className="px-card">
            <summary>用另一个人格继续</summary>
            <p>
              接续会话可按需读取原会话截至创建时的可见对话与执行记录，不复制旧人格的私有记忆注入。原会话已说出的内容也在交接范围内。
            </p>
            <select
              aria-label="新会话人格"
              value={targetPersona}
              disabled={busy}
              onChange={(e: any) => setTargetPersona(e.target.value)}
            >
              <option value="">选择人格</option>
              {view.personas
                .filter((p) => !p.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <div className="px-actions">
              <button disabled={busy || dirty || !targetPersona} onClick={() => void createSession(true)}>
                新建接续会话
              </button>
              <button disabled={busy || dirty || !targetPersona} onClick={() => void createSession(false)}>
                新建空白会话
              </button>
            </div>
          </details>
          <details className="px-card">
            <summary>人格模板与私有记忆</summary>
            <details style={{ ...cardStyle, marginBottom: 16 }}>
              <summary>编辑人格模板（保存为新版本）</summary>
              <label>
                名称
                <input
                  disabled={busy || view.persona.archived}
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
                  disabled={busy || view.persona.archived}
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
                  disabled={busy || view.persona.archived}
                  type="checkbox"
                  checked={enabled}
                  onChange={(e: any) => setEnabled(e.target.checked)}
                />{' '}
                使用并允许保存此人格的记忆
              </label>
              <p>
                <button
                  style={controlStyle}
                  disabled={busy || !name.trim() || view.persona.archived}
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
            {view.persona.id !== 'default' && !view.persona.archived && (
              <button
                style={{ ...controlStyle, marginBottom: 16 }}
                disabled={busy || !!note}
                onClick={() => {
                  if (
                    window.confirm(
                      '归档此人格？历史与记忆仍可查看，它将不能用于新的模型轮次；已有会话不会变成其他人格。'
                    )
                  )
                    void act({ type: 'archive-persona' })
                }}
              >
                归档此人格
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
                  name !== view.template.name ||
                  instructions !== view.template.instructions ||
                  enabled !== view.persona.memoryEnabled
                }
                onClick={() =>
                  void act({ type: 'create', name: newName }).then((ok) => {
                    if (ok) setNewName('')
                  })
                }
              >
                {view.binding.locked ? '创建人格' : '创建并选择'}
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
                  <button
                    style={controlStyle}
                    disabled={busy || view.persona.archived}
                    onClick={() => edit(m)}
                  >
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
              disabled={busy || view.persona.archived}
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
                disabled={busy || view.persona.archived}
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
                disabled={busy || !note.trim() || !view.persona.memoryEnabled || view.persona.archived}
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
          </details>
        </>
      )}
    </div>
  )
}
export function apply(ctx: any): void {
  installUiStyles(ctx)
  ctx.inject(['slots', 'uiWorkspace', 'sidebarRight'], (host: any) =>
    host.effect(() => registerMnemonKnowledgePage(host), 'memory: native Mnemon knowledge page')
  )
  ctx.inject(['sidebarRight', 'sidebarRightTabs', 'slots', 'uiWorkspace'], (host: any) =>
    host.effect(
      () =>
        createNativeSidebar(host).registerTab({
          id: 'dsh-px-memory',
          title: '人格与经历',
          order: 17,
          component: ({ scope, visible }) => (
            <MemoryPanel
              key={scope.sessionId}
              sessionId={scope.sessionId}
              visible={visible}
              openSession={(id: string) => host.uiWorkspace.openSession(id)}
              openKnowledge={() => {
                const layout = host.get?.('layout') ?? host.layout
                if (!layout?.selectPanel) throw Error('原生页面导航不可用')
                layout.selectPanel('mnemon')
              }}
            />
          )
        }),
      'memory: panel'
    )
  )
}
