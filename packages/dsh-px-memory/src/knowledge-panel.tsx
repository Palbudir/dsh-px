import { useEffect, useState, useMemo } from 'react'
import { requestJson } from '../../shared/client-http'
import { controlStyle, cardStyle } from '../../shared/ui'
import { createDraftRegistry } from '../../shared/draft-store'
import { ExperiencePanel } from './experience-panel'
const drafts = createDraftRegistry(64)
const newest = (rows: any[]) =>
  [...rows].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))

const scopes = [
  ['persona', '仅此人格'],
  ['persona-project', '此人格在本项目'],
  ['project', '本项目所有人格'],
  ['global', '全部人格与项目']
]
export function KnowledgePanel({
  sessionId,
  personaId,
  project
}: {
  sessionId: string
  personaId: string
  project: string | null
}): unknown {
  const initial = {
    editing: false,
    scope: project ? 'project' : 'persona',
    tab: 'knowledge',
    key: '',
    body: '',
    paths: '',
    revision: '',
    selected: null as any,
    skill: null as any,
    skillDirectories: null as any,
    skillName: '',
    skillDescription: '',
    skillEnabled: false,
    skillScope: project ? 'project' : 'global'
  }
  const draft = useMemo(() => {
    let storage
    try {
      storage = sessionStorage
    } catch {}
    return drafts.acquire(
      'px-knowledge-form:' + sessionId + ':' + personaId,
      initial,
      storage,
      (v) =>
        v.body.length <= 64000 &&
        scopes.some((s) => s[0] === v.scope) &&
        ['knowledge', 'skills'].includes(v.tab)
    )
  }, [sessionId, personaId])
  const saved = draft?.getSnapshot() ?? initial
  const [scope, setScope] = useState(saved.scope),
    [catalog, setCatalog] = useState<any>(null),
    [selected, setSelected] = useState<any>(saved.selected)
  const [query, setQuery] = useState(''),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(saved.editing),
    [key, setKey] = useState(saved.key),
    [body, setBody] = useState(saved.body),
    [paths, setPaths] = useState(saved.paths),
    [editRevision, setEditRevision] = useState(saved.revision),
    [destination, setDestination] = useState('project')
  const [tab, setTab] = useState(saved.tab),
    [skillDirectories, setSkillDirectories] = useState<any>(saved.skillDirectories),
    [skills, setSkills] = useState<any[]>([]),
    [skill, setSkill] = useState<any>(saved.skill),
    [skillName, setSkillName] = useState(saved.skillName),
    [skillDescription, setSkillDescription] = useState(saved.skillDescription),
    [skillEnabled, setSkillEnabled] = useState(saved.skillEnabled),
    [skillScope, setSkillScope] = useState(saved.skillScope)
  useEffect(() => {
    if (!draft) return
    if (!editing) {
      draft.clear()
      return
    }
    draft.set({
      editing,
      scope,
      tab,
      key,
      body,
      paths,
      revision: editRevision,
      selected: selected ? { ...selected, body: undefined } : null,
      skill: skill ? { ...skill, skill: { ...skill.skill, content: undefined } } : null,
      skillName,
      skillDescription,
      skillEnabled,
      skillScope,
      skillDirectories
    })
  }, [
    draft,
    editing,
    scope,
    tab,
    key,
    body,
    paths,
    editRevision,
    selected,
    skill,
    skillName,
    skillDescription,
    skillEnabled,
    skillScope,
    skillDirectories
  ])
  const url = `/dsh-px-memory?sessionId=${encodeURIComponent(sessionId)}`
  const call = (type: string, input: any, signal?: AbortSignal) =>
    requestJson<any>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, input }),
      signal
    })
  useEffect(() => {
    const ac = new AbortController()
    setCatalog(null)
    setRows([])
    if (!draft?.getSnapshot().editing) {
      setSelected(null)
      setEditing(false)
    }
    setError('')
    void call('knowledge', { action: 'catalog', scope }, ac.signal)
      .then((v) => {
        if (!ac.signal.aborted) {
          setCatalog(v)
          setRows(newest(v.documents))
        }
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(String(e.message))
      })
    return () => ac.abort()
  }, [url, scope])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e: any) {
      setError(String(e.message))
    } finally {
      setBusy(false)
    }
  }
  const refresh = async () => {
    const next = await call('knowledge', { action: 'catalog', scope })
    setCatalog(next)
    setRows(newest(next.documents))
    setSelected(null)
  }
  const read = async (id: string, historical = false) => {
    const next = await call('knowledge', { action: 'read', scope, id, historical })
    setSelected(next.document)
    setCatalog((old: any) => ({ ...old, revision: next.revision }))
    setEditing(false)
  }
  const edit = (item: any) => {
    if (!draft) {
      setError('当前窗口草稿过多，请先保存或取消其他草稿。')
      return
    }
    setSelected(item)
    setKey(item?.key ?? '')
    setBody(item?.body ?? '')
    setPaths(item?.sources?.map((s: any) => s.path).join('\n') ?? '')
    setEditRevision(catalog.revision)
    setEditing(true)
  }
  const readSkill = async (name: string) => {
    const v = await call('skills', { action: 'read', name })
    setSkill(v)
    setSkillDirectories(v.directories)
    setSkillName(v.skill.name)
    setSkillDescription(v.skill.description)
    setBody(v.skill.content)
    setSkillEnabled(v.skill.invocation?.modelInvocable === true)
    setSkillScope(v.skill.source === 'user-dsh' ? 'global' : 'project')
    setEditing(false)
  }
  return (
    <section>
      <div className="px-actions">
        <button style={controlStyle} disabled={busy || editing} onClick={() => setTab('knowledge')}>
          知识
        </button>
        <button
          style={controlStyle}
          disabled={busy || editing}
          onClick={() =>
            void run(async () => {
              setTab('skills')
              const value = await call('skills', { action: 'list' })
              setSkills(value.skills)
              setSkillDirectories(value.directories)
            })
          }
        >
          Skills
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {editing && (
        <p role="status" className="px-muted">
          编辑草稿保留在当前窗口。返回或切换会话不会自动提交；保存仍检查原版本，避免覆盖后来修改。
        </p>
      )}
      {tab === 'knowledge' ? (
        <>
          <p className="px-muted">同一主题只维护一份现行结论。纠正时编辑原条目；临时任务进度放在工作账本。</p>
          <label>
            谁可以使用？
            <select
              aria-label="知识范围"
              style={{ ...controlStyle, width: '100%' }}
              value={scope}
              disabled={busy || editing}
              onChange={(e: any) => {
                setScope(e.target.value)
                setQuery('')
              }}
            >
              {scopes.map(([id, label]) => (
                <option
                  key={id}
                  value={id}
                  disabled={!project && (id === 'project' || id === 'persona-project')}
                >
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="px-muted">
            {scope === 'global'
              ? '所有人格、所有项目可用。'
              : scope === 'project'
                ? '本项目的所有人格可用。'
                : scope === 'persona-project'
                  ? '仅当前人格在本项目可用。'
                  : '仅当前人格可用，可跨项目。'}
          </p>
          <div className="px-actions">
            <input
              aria-label="搜索知识"
              style={controlStyle}
              value={query}
              disabled={busy || editing}
              onChange={(e: any) => setQuery(e.target.value)}
              placeholder="搜索现行知识"
            />
            <button
              style={controlStyle}
              disabled={busy || editing || !catalog}
              onClick={() =>
                void run(async () => {
                  if (!query.trim()) return refresh()
                  const v = await call('knowledge', { action: 'search', scope, query })
                  setRows(v.results)
                  setCatalog((old: any) => ({ ...old, revision: v.revision }))
                  setSelected(null)
                })
              }
            >
              搜索
            </button>
            <button style={controlStyle} disabled={busy || editing} onClick={() => void run(refresh)}>
              全部
            </button>
            <button style={controlStyle} disabled={busy || editing || !catalog} onClick={() => edit(null)}>
              新增
            </button>
          </div>
          {!catalog && !error && <p>正在读取知识范围…</p>}
          {catalog && !rows.length && !editing && (
            <p className="px-muted">暂无匹配知识。新建条目或换个关键词。</p>
          )}
          {!editing &&
            rows.map((row) => (
              <button
                key={row.id}
                style={{
                  ...controlStyle,
                  width: '100%',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  marginTop: 6
                }}
                disabled={busy}
                onClick={() => void run(() => read(row.id))}
              >
                {row.key}{' '}
                <small>
                  · v{row.revision}
                  {row.updatedAt ? ' · ' + new Date(row.updatedAt).toLocaleDateString() : ''}
                  {row.status === 'archived' ? ' · 已归档' : ''}
                </small>
              </button>
            ))}
          {selected && !editing && (
            <div style={{ ...cardStyle, marginTop: 12 }}>
              <strong>
                {selected.key} · v{selected.revision}
              </strong>
              <p className="px-muted">
                {selected.author?.kind === 'human'
                  ? '用户编写 / 纠正'
                  : selected.author?.kind === 'model'
                    ? '模型整理'
                    : '作者未标注'}
                ；文件引用只核对版本是否变化，不代表正文已被逐条证实。
              </p>
              {!selected.current && (
                <p role="status">这条知识已过时、已归档或来源无法验证，不作为当前结论使用。</p>
              )}
              {selected.body !== undefined ? (
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{selected.body}</pre>
              ) : (
                <button disabled={busy} onClick={() => void run(() => read(selected.id, true))}>
                  查看历史正文
                </button>
              )}
              {selected.sources?.map((s: any) => (
                <p className="px-muted" key={s.path}>
                  {s.path} ·{' '}
                  {s.state === 'current'
                    ? '版本一致'
                    : s.state === 'changed'
                      ? '文件已变化'
                      : s.state === 'missing'
                        ? '文件不存在'
                        : '暂不可验证'}
                </p>
              ))}
              <div className="px-actions">
                <button
                  disabled={busy || selected.status !== 'active' || selected.body === undefined}
                  onClick={() => edit(selected)}
                >
                  编辑 / 纠正
                </button>
                <button
                  disabled={busy || selected.status !== 'active'}
                  onClick={() =>
                    void run(async () => {
                      if (!confirm('归档后不会作为当前知识返回。继续吗？')) return
                      await call('knowledge', {
                        action: 'archive',
                        scope,
                        id: selected.id,
                        revision: catalog.revision,
                        documentRevision: selected.revision
                      })
                      await refresh()
                    })
                  }
                >
                  归档
                </button>
              </div>
              {selected.current && (
                <div className="px-actions">
                  <select
                    aria-label="分享目标范围"
                    value={destination}
                    disabled={busy}
                    onChange={(e: any) => setDestination(e.target.value)}
                  >
                    {scopes.map(([id, label]) => (
                      <option
                        key={id}
                        value={id}
                        disabled={
                          id === scope || (!project && (id === 'project' || id === 'persona-project'))
                        }
                      >
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy || destination === scope}
                    onClick={() =>
                      void run(async () => {
                        if (
                          !confirm(
                            `将这份知识快照分享到“${scopes.find((s) => s[0] === destination)?.[1]}”？来源以后改变时，此副本会失效。`
                          )
                        )
                          return
                        const target = await call('knowledge', { action: 'catalog', scope: destination })
                        await call('knowledge', {
                          action: 'share',
                          scope,
                          id: selected.id,
                          targetScope: destination,
                          revision: target.revision,
                          documentRevision: selected.revision
                        })
                        setScope(destination)
                      })
                    }
                  >
                    分享快照
                  </button>
                </div>
              )}
            </div>
          )}
          {editing && (
            <div style={{ ...cardStyle, marginTop: 12 }}>
              <label>
                主题
                <input
                  aria-label="知识主题"
                  style={{ ...controlStyle, width: '100%' }}
                  value={key}
                  disabled={busy || !!selected}
                  onChange={(e: any) => setKey(e.target.value)}
                  maxLength={160}
                />
              </label>
              <label>
                现行正文
                <textarea
                  aria-label="知识正文"
                  style={{ ...controlStyle, width: '100%', minHeight: 180 }}
                  value={body}
                  disabled={busy}
                  onChange={(e: any) => setBody(e.target.value)}
                />
              </label>
              <label>
                来源文件（可选，每行一个）
                <textarea
                  aria-label="知识来源文件"
                  style={{ ...controlStyle, width: '100%' }}
                  value={paths}
                  disabled={busy}
                  onChange={(e: any) => setPaths(e.target.value)}
                />
              </label>
              <p className="px-muted">保存时记录文件版本。来源改变后需重新核对并更新本条目。</p>
              <div className="px-actions">
                <button
                  disabled={busy || !key.trim() || !body.trim()}
                  onClick={() =>
                    void run(async () => {
                      await call('knowledge', {
                        action: 'write',
                        scope,
                        key,
                        body,
                        revision: editRevision,
                        sourcePaths: paths
                          .split('\n')
                          .map((s) => s.trim())
                          .filter(Boolean)
                      })
                      setEditing(false)
                      await refresh()
                    })
                  }
                >
                  保存现行版本
                </button>
                <button disabled={busy} onClick={() => setEditing(false)}>
                  取消编辑
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <ExperiencePanel
            key={sessionId + ':' + personaId}
            sessionId={sessionId}
            personaId={personaId}
            project={project}
            onAdopted={async () => {
              const value = await call('skills', { action: 'list' })
              setSkills(value.skills)
              setSkillDirectories(value.directories)
            }}
          />
          <p className="px-muted">
            列表与加载使用 DSH 原生 Skills。项目技能优先于全局技能；只有本页创建的技能可在此编辑。
          </p>
          <button
            disabled={busy || editing || !draft}
            onClick={() => {
              setSkill(null)
              setSkillName('')
              setSkillDescription('')
              setBody('')
              setSkillEnabled(false)
              setEditing(true)
            }}
          >
            新建技能
          </button>
          <button
            disabled={busy || editing}
            onClick={() =>
              void run(async () => {
                const value = await call('skills', { action: 'list' })
                setSkills(value.skills)
                setSkillDirectories(value.directories)
              })
            }
          >
            刷新技能列表
          </button>
          {skillDirectories && (
            <p className="px-muted">
              项目技能目录：{skillDirectories.project ?? '未选择项目'}；全局技能目录：
              {skillDirectories.global}
            </p>
          )}
          {!editing &&
            skills.map((item) => (
              <button
                key={item.name}
                style={{ ...controlStyle, width: '100%', textAlign: 'left', marginTop: 6 }}
                disabled={busy}
                onClick={() => void run(() => readSkill(item.name))}
              >
                {item.name} · {item.source}
                {!item.invocation?.modelInvocable ? ' · 不自动调用' : ''}
              </button>
            ))}
          {skill && !editing && (
            <div style={cardStyle}>
              <strong>{skill.skill.name}</strong>
              <p>{skill.skill.description}</p>
              <p className="px-muted">{skill.skill.path ?? skill.skill.provider}</p>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{skill.skill.content}</pre>
              {skill.managed ? (
                <button disabled={busy} onClick={() => setEditing(true)}>
                  编辑 / 启停
                </button>
              ) : (
                <p className="px-muted">由原生或第三方来源管理，请在原文件中修改。</p>
              )}
            </div>
          )}
          {editing && (
            <div style={cardStyle}>
              <select
                aria-label="技能范围"
                disabled={busy || !!skill}
                value={skillScope}
                onChange={(e: any) => setSkillScope(e.target.value)}
              >
                <option value="project" disabled={!project}>
                  本项目
                </option>
                <option value="global">全局</option>
              </select>
              <input
                aria-label="技能名称"
                style={controlStyle}
                disabled={busy || !!skill}
                value={skillName}
                onChange={(e: any) => setSkillName(e.target.value)}
                placeholder="例如 review-changes"
              />
              <input
                aria-label="技能说明"
                style={{ ...controlStyle, width: '100%' }}
                disabled={busy}
                value={skillDescription}
                onChange={(e: any) => setSkillDescription(e.target.value)}
                placeholder="何时使用这项技能"
              />
              <textarea
                aria-label="技能正文"
                style={{ ...controlStyle, width: '100%', minHeight: 180 }}
                disabled={busy}
                value={body}
                onChange={(e: any) => setBody(e.target.value)}
              />
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={skillEnabled}
                  onChange={(e: any) => setSkillEnabled(e.target.checked)}
                />
                允许原生 Agent 发现和调用
              </label>
              <div className="px-actions">
                <button
                  disabled={busy || !skillName || !skillDescription || !body}
                  onClick={() =>
                    void run(async () => {
                      const saved = await call('skills', {
                        action: 'save',
                        scope: skillScope,
                        name: skillName,
                        description: skillDescription,
                        body,
                        enabled: skillEnabled,
                        version: skill?.version,
                        expectedRoot: skillDirectories?.[skillScope]
                      })
                      setNotice(
                        saved.discovery === 'ready'
                          ? '技能已保存，原生列表已更新。'
                          : '技能已保存；原生目录仍在刷新，可稍后点击“刷新技能列表”。'
                      )
                      setEditing(false)
                      setSkill(null)
                      const value = await call('skills', { action: 'list' })
                      setSkills(value.skills)
                      setSkillDirectories(value.directories)
                    })
                  }
                >
                  保存技能
                </button>
                <button disabled={busy} onClick={() => setEditing(false)}>
                  取消编辑
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
