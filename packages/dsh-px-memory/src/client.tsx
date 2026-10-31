import { useEffect, useMemo, useRef, useState } from 'react'
import { createNativeSidebar } from '../../shared/native-sidebar'
import { installUiStyles, controlStyle, cardStyle } from '../../shared/ui'
import { requestJson } from '../../shared/client-http'
import type { Persona, MemoryEntry, SessionBinding } from './store'
import { HistoryPanel } from './history-panel'
import { KnowledgePanel } from './knowledge-panel'
import { registerMnemonKnowledgePage } from './mnemon-page'
import { registerMemoryWorkspace } from './memory-workspace'
import { createDraftRegistry } from '../../shared/draft-store'
import {
  parsePersonaExpression,
  renderPersonaExpression,
  type PersonaExpression
} from '../../shared/persona-expression'
import { PersonaExpressionEditor } from '../../shared/persona-expression-editor'

const personaDrafts = createDraftRegistry(64)

export const inject: string[] = []
interface View {
  revision: number
  personas: Array<{ id: string; name: string; archived?: boolean }>
  persona: Persona
  template: Persona
  binding: SessionBinding
  project: string | null
}
export function MemoryPanel({
  sessionId,
  visible,
  openKnowledge,
  openSession,
  openSettings,
  openTasks
}: {
  sessionId: string
  visible: boolean
  openKnowledge: () => void
  openSession: (id: string) => void
  openSettings: () => void
  openTasks: () => void
}): unknown {
  const draft = useMemo(() => {
    let storage
    try {
      storage = sessionStorage
    } catch {}
    return personaDrafts.acquire(
      'px-persona-form-v2:' + sessionId,
      {
        revision: -1,
        personaId: '',
        configDirty: false,
        name: '',
        instructions: '',
        expression: null as PersonaExpression | null,
        enabled: true,
        newName: '',
        note: '',
        editing: '',
        scope: 'project'
      },
      storage,
      (v) => {
        try {
          parsePersonaExpression(v.expression)
        } catch {
          return false
        }
        return (
          v.note.length <= 2000 &&
          v.instructions.length <= 2000 &&
          v.name.length <= 60 &&
          v.newName.length <= 60 &&
          Number.isSafeInteger(v.revision) &&
          v.revision >= -1 &&
          ['project', 'persona'].includes(v.scope)
        )
      }
    )
  }, [sessionId])
  const saved = draft?.getSnapshot()
  const restoring = useRef(!!saved && saved.revision >= 0)
  const [draftRevision, setDraftRevision] = useState<number | undefined>(
      saved && saved.revision >= 0 ? saved.revision : undefined
    ),
    [draftPersona, setDraftPersona] = useState(saved?.personaId ?? ''),
    [conflict, setConflict] = useState(false)
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [name, setName] = useState(saved?.name ?? ''),
    [instructions, setInstructions] = useState(saved?.instructions ?? ''),
    [expression, setExpression] = useState<PersonaExpression | null>(saved?.expression ?? null),
    [enabled, setEnabled] = useState(saved?.enabled ?? true)
  const [newName, setNewName] = useState(saved?.newName ?? ''),
    [note, setNote] = useState(saved?.note ?? ''),
    [editing, setEditing] = useState<string | undefined>(saved?.editing || undefined)
  const [scope, setScope] = useState(saved?.scope ?? 'project')
  const [targetPersona, setTargetPersona] = useState('')
  const [tab, setTab] = useState('persona')
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
      JSON.stringify(expression) !== JSON.stringify(view.template.expression ?? null) ||
      enabled !== view.persona.memoryEnabled)
  )
  const dirty = !!note || !!newName || configDirty || (restoring.current && !!saved?.configDirty)
  const identityChanged = !!(view && draftPersona && draftPersona !== view.persona.id)
  const beginEdit = () => {
    if (draftRevision === undefined && view) {
      setDraftRevision(view.revision)
      setDraftPersona(view.persona.id)
    }
  }
  const discardDraft = () => {
    restoring.current = false
    draft?.clear()
    setDraftRevision(undefined)
    setDraftPersona('')
    setConflict(false)
    setNote('')
    setNewName('')
    setEditing(undefined)
    setName('')
    setInstructions('')
    setExpression(null)
    setView(null)
    setError('')
  }
  useEffect(() => {
    if (!draft || !view) return
    if (dirty)
      draft.set({
        revision: draftRevision ?? view.revision,
        personaId: draftPersona || view.persona.id,
        configDirty,
        name,
        instructions,
        expression,
        enabled,
        newName,
        note,
        editing: editing ?? '',
        scope
      })
    else {
      draft.clear()
      setDraftRevision(undefined)
      setDraftPersona('')
    }
  }, [
    draft,
    dirty,
    view,
    name,
    instructions,
    expression,
    enabled,
    newName,
    note,
    editing,
    scope,
    draftRevision,
    draftPersona,
    configDirty
  ])
  const url = `/dsh-px-memory?sessionId=${encodeURIComponent(sessionId)}`
  const accept = (data: View): void => {
    setView(data)
    setName(data.template.name)
    setInstructions(data.template.instructions)
    setExpression(data.template.expression ?? null)
    setEnabled(data.persona.memoryEnabled)
    if (!data.project) setScope('persona')
  }
  useEffect(() => {
    if (!visible || busy || (view && dirty)) return
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const data = await requestJson<View>(url, { signal: ac.signal })
        if (!ac.signal.aborted) {
          if (restoring.current) {
            restoring.current = false
            setView(data)
            if (!saved?.configDirty) {
              setName(data.template.name)
              setInstructions(data.template.instructions)
              setExpression(data.template.expression ?? null)
              setEnabled(data.persona.memoryEnabled)
            }
            if (saved?.personaId !== data.persona.id) {
              setConflict(true)
              setError('此会话的人格已改变。旧人格草稿未提交，请放弃草稿后查看当前人格。')
            } else if (saved?.revision !== data.revision) {
              setConflict(true)
              setError('这份草稿的原版本已变化，不能直接覆盖。请先保留需要的文字，再放弃草稿并读取最新内容。')
            }
          } else {
            accept(data)
            setError('')
            setConflict(false)
          }
        }
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
  }, [url, visible, busy, dirty, !!view])
  const act = async (action?: object): Promise<boolean> => {
    if (action && identityChanged) {
      setConflict(true)
      setError('人格已改变，旧草稿未提交。请放弃草稿后重新读取。')
      return false
    }
    setBusy(true)
    setError('')
    try {
      const data = await requestJson<View>(
        url,
        action
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...action, revision: draftRevision ?? view?.revision })
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
      setDraftRevision(undefined)
      setDraftPersona('')
      setConflict(false)
      return true
    } catch (e) {
      if ((e as { status?: number }).status === 409) setConflict(true)
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  const edit = (entry: MemoryEntry): void => {
    beginEdit()
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
  return (
    <div
      className="px-ui px-memory-panel"
      style={{ padding: 20, flex: 1, minHeight: 0, overflow: 'auto', overflowWrap: 'anywhere', fontSize: 14 }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div className="px-actions" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: '0 0 8px' }}>记忆与知识</h2>
          <button onClick={() => setTab('advanced')} aria-pressed={tab === 'advanced'}>
            高级设置
          </button>
        </div>
        {view && (
          <p className="px-muted">
            当前人格：<strong>{view.persona.name}</strong> · 项目：
            {view.project ? view.project.split(/[\\/]/).filter(Boolean).pop() : '未关联项目'}
            {view.binding.locked ? ' · 会话人格已固定' : ''}
          </p>
        )}
        <div className="px-actions" role="group" aria-label="记忆页面">
          {[
            ['persona', '人格记忆'],
            ['history', '经历与历史'],
            ['knowledge', '知识与 Skills']
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              className={tab === id ? 'px-primary' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {dirty && (
          <p role="status" style={{ opacity: 0.7 }}>
            草稿尚未保存，已暂停自动刷新。切换页面会保留草稿；保存时仍会核对原版本。
          </p>
        )}
        {!draft && <p role="alert">当前窗口草稿已满。本页新编辑暂不能跨页保留，请先保存其他草稿。</p>}
        {tab === 'persona' && (
          <button style={controlStyle} disabled={busy || dirty} onClick={() => void act()}>
            刷新记录
          </button>
        )}

        {error && <p role="alert">{error} </p>}
        {conflict && (
          <button disabled={busy} onClick={discardDraft}>
            放弃草稿并读取最新
          </button>
        )}
        {!view && !error && <p>正在读取…</p>}
        {view && !identityChanged && (
          <>
            <div hidden={tab !== 'history'}>
              <HistoryPanel
                key={view.persona.id}
                url={url}
                visible={visible && tab === 'history'}
                openSession={openSession}
              />
            </div>
            {tab === 'knowledge' && (
              <KnowledgePanel
                key={sessionId + view.persona.id}
                sessionId={sessionId}
                personaId={view.persona.id}
                project={view.project}
              />
            )}
            <section hidden={tab !== 'advanced'}>
              <h3>引擎配置与诊断</h3>
              <p className="px-muted">
                日常资料在前三个页面管理。下面保留 Mnemon
                原生设置、项目档案及其他记忆来源；不会自动开启后台提炼或迁移资料。
              </p>
              <div className="px-actions">
                <button
                  disabled={dirty || busy}
                  onClick={() => {
                    try {
                      openKnowledge()
                    } catch (e: any) {
                      setError(e.message)
                    }
                  }}
                >
                  打开原生记忆管理
                </button>
                <button
                  disabled={dirty || busy}
                  onClick={() => {
                    try {
                      openSettings()
                    } catch (e: any) {
                      setError(e.message)
                    }
                  }}
                >
                  打开 Mnemon 配置
                </button>
              </div>
              <h3>当前工作放在哪里？</h3>
              <p>
                任务进度和下一步保存在工作账本，Goal 与 Team
                仍以原生执行状态为准。长期约定放在人格记忆，可复用结论放在知识库。
              </p>
              <button disabled={dirty || busy} onClick={openTasks}>
                查看当前任务与工作账本
              </button>
            </section>
            <section hidden={tab !== 'persona'}>
              <details className="px-card">
                <summary>人格与协作偏好</summary>
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
                    <button
                      disabled={busy || dirty || !targetPersona}
                      onClick={() => void createSession(true)}
                    >
                      新建接续会话
                    </button>
                    <button
                      disabled={busy || dirty || !targetPersona}
                      onClick={() => void createSession(false)}
                    >
                      新建空白会话
                    </button>
                  </div>
                </details>
                <section>
                  <details style={{ ...cardStyle, marginBottom: 16 }}>
                    <summary>本会话的人格配置 · 版本 {view.binding.personaRevision}</summary>
                    <p style={{ whiteSpace: 'pre-wrap' }}>
                      {renderPersonaExpression(view.persona.expression) ||
                        '未设置独立的公开表达，沿用原有协作和渠道配置。'}
                    </p>
                  </details>
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
                        onChange={(e: any) => {
                          beginEdit()
                          setName(e.target.value)
                        }}
                      />
                    </label>
                    <label>
                      私人协作要求
                      <textarea
                        disabled={busy || view.persona.archived}
                        aria-label="私人协作要求"
                        rows={4}
                        maxLength={2000}
                        style={{ ...controlStyle, width: '100%', resize: 'vertical' }}
                        placeholder="只用于私人和本机工作会话，不自动公开到群聊。例如：研究时标明来源。"
                        value={instructions}
                        onChange={(e: any) => {
                          beginEdit()
                          setInstructions(e.target.value)
                        }}
                      />
                    </label>
                    <PersonaExpressionEditor
                      value={expression}
                      disabled={busy || !!view.persona.archived}
                      onChange={(value) => {
                        beginEdit()
                        setExpression(value)
                      }}
                    />
                    <label>
                      <input
                        disabled={busy || view.persona.archived}
                        type="checkbox"
                        checked={enabled}
                        onChange={(e: any) => {
                          beginEdit()
                          setEnabled(e.target.checked)
                        }}
                      />{' '}
                      使用并允许保存此人格的记忆
                    </label>
                    <p>
                      <button
                        style={controlStyle}
                        disabled={busy || !name.trim() || view.persona.archived}
                        onClick={() =>
                          void act({
                            type: 'configure',
                            name,
                            instructions,
                            expression,
                            memoryEnabled: enabled
                          })
                        }
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
                      onChange={(e: any) => {
                        beginEdit()
                        setNewName(e.target.value)
                      }}
                    />{' '}
                    <button
                      style={controlStyle}
                      disabled={
                        busy ||
                        !newName.trim() ||
                        !!note ||
                        name !== view.template.name ||
                        instructions !== view.template.instructions ||
                        JSON.stringify(expression) !== JSON.stringify(view.template.expression ?? null) ||
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
                </section>
              </details>
              <h3>保存的约定</h3>
              <p style={{ opacity: 0.7 }}>
                只显示本目录及此人格通用的记忆。可直接编辑，也可在对话中明确要求 Agent 记住或忘记。
              </p>
              {!view.persona.memoryEnabled && (
                <p role="status">此人格的记忆已关闭，条目仍保留。可在“人格与协作偏好”中开启。</p>
              )}
              {!view.persona.memories.some((m) => !m.project || m.project === view.project) && (
                <p className="px-empty">
                  还没有保存约定。可以记下你的协作偏好，也可以在对话中明确要求助手记住。
                </p>
              )}
              {view.persona.memories
                .filter((m) => !m.project || m.project === view.project)
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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
                onChange={(e: any) => {
                  beginEdit()
                  setNote(e.target.value)
                }}
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
            </section>
          </>
        )}
      </div>
    </div>
  )
}
export function apply(ctx: any): void {
  installUiStyles(ctx)
  ctx.inject(
    ['slots', 'layout', 'sessions', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs'],
    (host: any) =>
      host.effect(() => {
        const workspace = registerMemoryWorkspace(host, MemoryPanel)
        const nativePage = registerMnemonKnowledgePage(host, workspace.open)
        const sidebar = createNativeSidebar(host).registerTab({
          id: 'dsh-px-memory',
          title: '记忆与知识',
          order: 17,
          component: ({ scope }) => (
            <div className="px-ui" style={{ padding: 16 }}>
              <h3>记忆与知识</h3>
              <p>人格约定、历史检索、知识与 Skills 在同一个页面管理。</p>
              <button onClick={() => workspace.open(scope.sessionId)}>打开记忆与知识</button>
            </div>
          )
        })
        return () => {
          sidebar()
          nativePage()
          workspace.dispose()
        }
      }, 'memory: unified workspace')
  )
}
