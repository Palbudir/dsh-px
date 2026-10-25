import { useEffect, useMemo, useRef, useState } from 'react'
import { requestJson } from '../../shared/client-http'
import { cardStyle, controlStyle } from '../../shared/ui'
import { createDraftRegistry } from '../../shared/draft-store'

const drafts = createDraftRegistry(64)

const active = (task: any) => ['starting', 'running', 'stopping'].includes(task.phase)
const phase: Record<string, string> = {
  starting: '准备中',
  running: '处理中',
  stopping: '正在停止',
  completed: '已完成',
  failed: '失败',
  killed: '已停止'
}

/** A short review flow, backed by native Skills records and native background Jobs. */
export function ExperiencePanel({
  sessionId,
  personaId,
  project,
  onAdopted
}: {
  sessionId: string
  personaId: string
  project: string | null
  onAdopted: () => Promise<void>
}): unknown {
  const draft = useMemo(() => {
    let storage
    try {
      storage = sessionStorage
    } catch {}
    return drafts.acquire(
      'px-experience-form:' + sessionId + ':' + personaId,
      { selected: null as any, body: '' },
      storage,
      (value) =>
        typeof value.body === 'string' &&
        value.body.length <= 16000 &&
        (!value.selected || typeof value.selected.value?.draft?.content === 'string')
    )
  }, [sessionId, personaId])
  const saved = draft?.getSnapshot()
  const [view, setView] = useState<any>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [generation, setGeneration] = useState(0),
    [selected, setSelected] = useState<any>(saved?.selected ?? null),
    [body, setBody] = useState(saved?.body ?? ''),
    [share, setShare] = useState(
      saved?.selected?.value?.draft?.baseKey?.startsWith('user-dsh:') ? 'global' : 'project'
    ),
    [evidence, setEvidence] = useState<any>(null)
  const lifetime = useRef<AbortController | null>(null)
  const url = `/dsh-px-memory?sessionId=${encodeURIComponent(sessionId)}`
  const call = (input: any, signal?: AbortSignal) =>
    requestJson<any>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'experience', input }),
      signal
    })
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [url])
  useEffect(() => {
    if (!project) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const next = await call({ action: 'view' }, controller.signal)
        if (controller.signal.aborted) return
        setView(next)
        if (next.tasks.some(active)) timer = setTimeout(() => void refresh(), 1000)
      } catch (error: any) {
        if (!controller.signal.aborted) setError(String(error.message))
      }
    }
    void refresh()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [url, project, generation])
  const dirty = !!selected && body !== selected.value.draft.content
  useEffect(() => {
    if (dirty)
      draft?.set({
        selected: { revision: selected.revision, value: { draft: selected.value.draft, runs: [] } },
        body
      })
    else draft?.clear()
  }, [draft, dirty, selected, body])
  const working = view?.tasks?.some(active) ?? false
  const disabled = busy || working || dirty || !view
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action(signal)
    } catch (error: any) {
      if (!signal.aborted) setError(String(error.message))
    } finally {
      if (!signal.aborted) {
        setBusy(false)
        setGeneration((value) => value + 1)
      }
    }
  }
  const start = (action: string, id?: string) =>
    void run(async (signal) => {
      await call({ action, id, requestId: crypto.randomUUID() }, signal)
      if (signal.aborted) return
      setSelected(null)
      setEvidence(null)
      setNotice('已开始后台处理，可以继续对话。')
    })
  const readDraft = (id: string) =>
    void run(async (signal) => {
      const next = await call({ action: 'read', kind: 'draft', id }, signal)
      if (signal.aborted) return
      setSelected(next)
      setBody(next.value.draft.content)
      setShare(next.value.draft.baseKey?.startsWith('user-dsh:') ? 'global' : 'project')
      setEvidence(null)
    })
  if (!project) return <p className="px-muted">选择项目后，可将工作经历整理为 Skill。</p>
  return (
    <section style={cardStyle} aria-label="从经历改进 Skills">
      <div className="px-actions">
        <strong>从经历改进 Skills</strong>
        <button style={controlStyle} disabled={disabled} onClick={() => start('review')}>
          整理本次经历
        </button>
        <button
          style={controlStyle}
          disabled={busy || dirty}
          onClick={() => {
            setError('')
            setGeneration((value) => value + 1)
          }}
        >
          刷新
        </button>
      </div>
      <p className="px-muted">
        从已结束的轮次提炼方法，候选仅此人格在本项目可见。使用来源模型的较低推理档（若支持）；由你采纳后才写入共享
        Skill。
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {view?.tasks?.slice(0, working ? 8 : 1).map((task: any) => (
        <div key={task.requestId} role="status">
          {phase[task.phase] ?? task.phase} · {task.progress}
          {task.error && <p role="alert">{task.error}</p>}
          {active(task) && (
            <button
              style={controlStyle}
              disabled={busy || task.phase === 'stopping'}
              onClick={() =>
                void run(async (signal) => {
                  await call({ action: 'cancel', requestId: task.requestId }, signal)
                })
              }
            >
              停止
            </button>
          )}
        </div>
      ))}
      {view && !working && !view.suggestions.length && !view.drafts.length && (
        <p className="px-muted">还没有待处理建议。完成一项工作后，点击“整理本次经历”。</p>
      )}
      {view?.suggestions
        .filter((s: any) => !view.drafts.some((d: any) => d.suggestionId === s.id))
        .map((suggestion: any) => (
          <div key={suggestion.id} style={cardStyle}>
            <strong>{suggestion.skillName}</strong>
            <p>{suggestion.summary}</p>
            <div className="px-actions">
              <button style={controlStyle} disabled={disabled} onClick={() => start('draft', suggestion.id)}>
                生成草稿
              </button>
              <button
                style={controlStyle}
                disabled={busy || dirty}
                onClick={() =>
                  void run(async (signal) => {
                    const detail = await call(
                      { action: 'read', kind: 'suggestion', id: suggestion.id },
                      signal
                    )
                    const references = await Promise.all(
                      detail.value.suggestion.evidence.slice(0, 3).map(async (ref: any) => {
                        const result = await call(
                          { action: 'read', kind: 'trajectory', id: ref.trajectoryId },
                          signal
                        )
                        return result.value.steps.filter((step: any) => ref.steps.includes(step.index))
                      })
                    )
                    if (!signal.aborted)
                      setEvidence({ summary: suggestion.rationale, steps: references.flat() })
                  })
                }
              >
                查看依据
              </button>
              <button
                style={controlStyle}
                disabled={disabled}
                onClick={() =>
                  void run(async (signal) => {
                    await call({ action: 'dismiss', id: suggestion.id, revision: view.revision }, signal)
                  })
                }
              >
                忽略
              </button>
            </div>
          </div>
        ))}
      {evidence && (
        <details open>
          <summary>建议依据</summary>
          <p>{evidence.summary}</p>
          {evidence.steps.map((step: any, index: number) => (
            <pre key={index} style={{ whiteSpace: 'pre-wrap' }}>
              {step.text}
            </pre>
          ))}
        </details>
      )}
      {view?.drafts.map((draft: any) => (
        <button
          key={draft.id}
          style={{ ...controlStyle, margin: '6px 6px 6px 0' }}
          disabled={busy || dirty}
          onClick={() => readDraft(draft.id)}
        >
          {draft.skillName} · 审阅草稿
        </button>
      ))}
      {selected && (
        <div style={{ marginTop: 12 }}>
          <strong>{selected.value.draft.skillName}</strong>
          <p>{selected.value.draft.notes}</p>
          {selected.value.base && (
            <details>
              <summary>对照现有 Skill</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{selected.value.base.content}</pre>
            </details>
          )}
          <label>
            待采纳内容
            <textarea
              aria-label="Skill 草稿内容"
              style={{ ...controlStyle, display: 'block', width: '100%', minHeight: 200 }}
              maxLength={16000}
              value={body}
              disabled={busy || working || !draft}
              onChange={(event: any) => setBody(event.target.value)}
            />
          </label>
          {dirty && <p className="px-muted">有未保存修改，保留在当前窗口。保存后再回测或采纳。</p>}
          <div className="px-actions">
            <button
              style={controlStyle}
              disabled={busy || working || !dirty}
              onClick={() =>
                void run(async (signal) => {
                  await call(
                    {
                      action: 'edit',
                      id: selected.value.draft.id,
                      revision: selected.revision,
                      content: body
                    },
                    signal
                  )
                  const next = await call(
                    { action: 'read', kind: 'draft', id: selected.value.draft.id },
                    signal
                  )
                  if (!signal.aborted) {
                    setSelected(next)
                    setBody(next.value.draft.content)
                  }
                })
              }
            >
              保存草稿
            </button>
            <button
              style={controlStyle}
              disabled={disabled}
              onClick={() => start('backtest', selected.value.draft.id)}
            >
              模拟回测
            </button>
            <button
              style={controlStyle}
              disabled={busy || working || !dirty}
              onClick={() => setBody(selected.value.draft.content)}
            >
              撤销本次编辑
            </button>
          </div>
          <p className="px-muted">
            模拟回测对照现行方法与草稿的方案和预期答案，最多两道用例，优先使用非推理档。它不执行真实工具，评分不代表实际任务已通过。
          </p>
          {selected.value.runs.length > 0 && (
            <details open>
              <summary>回测结果</summary>
              {selected.value.runs.map((result: any) => (
                <div key={result.id} style={cardStyle}>
                  <strong>
                    {result.target.kind === 'draft' ? '草稿' : '现行方法'} ·{' '}
                    {result.awaitingRecovery
                      ? '上次运行未结算'
                      : result.status === 'completed'
                        ? '模拟完成'
                        : result.status === 'running'
                          ? '进行中'
                          : '未完成'}
                  </strong>
                  {result.awaitingRecovery && (
                    <p role="status">
                      这条记录来自上次服务，当前没有对应的经验任务；已有结果保留，不计为回测完成。
                    </p>
                  )}
                  {!result.matchesCurrentContent && (
                    <p role="status">旧版本结果：内容已变化，需要重新回测。</p>
                  )}
                  <p>
                    {result.progress.done} / {result.progress.total} 用例
                    {typeof result.passRate === 'number'
                      ? ` · 方案检查通过率 ${Math.round(result.passRate * 100)}%`
                      : ''}
                  </p>
                  {result.results.map((entry: any) => (
                    <details key={entry.caseId}>
                      <summary>
                        {entry.title} · {entry.verdict === 'pass' ? '模拟通过' : '未通过'}
                      </summary>
                      <p>{entry.answer}</p>
                      {entry.checks.map((check: any) => (
                        <p key={check.checkId}>
                          {check.pass ? '通过' : '未通过'}：{check.note}
                        </p>
                      ))}
                    </details>
                  ))}
                  {result.error && <p role="alert">{result.error}</p>}
                </div>
              ))}
            </details>
          )}
          <div style={cardStyle}>
            <label>
              采纳到{' '}
              <select
                aria-label="Skill 共享范围"
                style={controlStyle}
                value={share}
                disabled={disabled || selected.value.draft.action === 'update'}
                onChange={(event: any) => setShare(event.target.value)}
              >
                <option value="project">本项目所有人格</option>
                <option value="global">全部人格与项目</option>
              </select>
            </label>
            <p className="px-muted">
              采纳会写入上述共享范围的
              SKILL.md，并可供模型调用。请先审阅内容；候选与原始经历仍保留在此人格下。
            </p>
            {selected.value.draft.action === 'update' && (
              <p className="px-muted">更新已有 Skill 时保留原文件与共享范围。</p>
            )}
            <div className="px-actions">
              <button
                style={controlStyle}
                disabled={disabled}
                onClick={() =>
                  void run(async (signal) => {
                    const result = await call(
                      { action: 'adopt', id: selected.value.draft.id, revision: selected.revision, share },
                      signal
                    )
                    if (signal.aborted) return
                    setSelected(null)
                    setNotice(
                      result.discovery === 'ready'
                        ? '已采纳，原生 Skills 已发现新内容。'
                        : '已写入共享 Skill，原生列表尚未确认更新，请稍后刷新。'
                    )
                    await onAdopted()
                  })
                }
              >
                采纳为共享 Skill
              </button>
              <button
                style={controlStyle}
                disabled={disabled}
                onClick={() =>
                  void run(async (signal) => {
                    await call(
                      { action: 'discard', id: selected.value.draft.id, revision: selected.revision },
                      signal
                    )
                    if (!signal.aborted) setSelected(null)
                  })
                }
              >
                放弃草稿
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
