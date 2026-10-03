import { useOperation } from '../../../dsh-px-workspace/src/client/data'
import { useState } from 'react'
import { useDraft } from '../../../dsh-px-workspace/src/client/drafts'
import { ConfirmDelete } from '../../../shared/ui'
import type { Panel, Client } from '../../../dsh-px-workspace/src/client/contracts'
import type { Schedule, Timing } from '../../../dsh-px-workspace/src/model'
import { base, stamp, useData, errorText, post, useSnapshot } from '../../../dsh-px-workspace/src/client/data'
import { StorageNotice } from '../../../dsh-px-workspace/src/client/storage-notice'
import { validScheduleDraft } from '../../../dsh-px-workspace/src/client/draft-validation'
function localTime(time: number): string {
  const d = new Date(time)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
export function SchedulesPanel({ ctx, scope, visible }: Panel & { ctx: Client }): unknown {
  const sessions = useSnapshot(ctx.sessions.list),
    { data, error, refresh } = useData<{ schedules: Schedule[]; timeZone: string }>(
      `${base}/schedules`,
      visible
    )
  const [draft, setDraft, draftWarning, draftAvailable, clearDraft, unreadableDraft] = useDraft<{
    editing: Schedule | null
    form: boolean
    title: string
    prompt: string
    sessionId: string
    kind: Timing['kind']
    at: string
    minutes: string
    daily: string
    enabled: boolean
    dirty: boolean
  }>(
    `schedules:${scope.sessionId}`,
    () => ({
      editing: null,
      form: false,
      title: '',
      prompt: '',
      sessionId: scope.sessionId,
      kind: 'once',
      at: localTime(Date.now() + 300000),
      minutes: '60',
      daily: '09:00',
      enabled: true,
      dirty: false
    }),
    validScheduleDraft
  )
  const { editing, form, title, prompt, sessionId, kind, at, minutes, daily, enabled } = draft
  const setEditing = (editing: Schedule | null): void => setDraft((old) => ({ ...old, editing }))
  const setForm = (form: boolean): void => setDraft((old) => ({ ...old, form }))
  const setTitle = (title: string): void => setDraft((old) => ({ ...old, title, dirty: true }))
  const setPrompt = (prompt: string): void => setDraft((old) => ({ ...old, prompt, dirty: true }))
  const setSessionId = (sessionId: string): void => setDraft((old) => ({ ...old, sessionId, dirty: true }))
  const setKind = (kind: Timing['kind']): void => setDraft((old) => ({ ...old, kind, dirty: true }))
  const setAt = (at: string): void => setDraft((old) => ({ ...old, at, dirty: true }))
  const setMinutes = (minutes: string): void => setDraft((old) => ({ ...old, minutes, dirty: true }))
  const setDaily = (daily: string): void => setDraft((old) => ({ ...old, daily, dirty: true }))
  const setEnabled = (enabled: boolean): void => setDraft((old) => ({ ...old, enabled, dirty: true }))
  const [localBusy, setBusy] = useState(false),
    [failure, setFailure] = useState(''),
    [notice, setNotice] = useState('')
  const [replacement, setReplacement] = useState<{ schedule: Schedule | null } | null>(null)
  const begin = (s: Schedule | null, replace = false): void => {
    if (!draftAvailable) return
    if ((draft.dirty || title.trim() || prompt.trim()) && !replace) {
      setReplacement({ schedule: s })
      return
    }
    setReplacement(null)
    setEditing(s)
    setTitle(s?.title ?? '')
    setPrompt(s?.prompt ?? '')
    setSessionId(s?.sessionId ?? scope.sessionId)
    setKind(s?.timing.kind ?? 'once')
    setEnabled(s?.enabled ?? true)
    setAt(localTime(s?.timing.kind === 'once' ? s.timing.at : Date.now() + 300000))
    setMinutes(String(s?.timing.kind === 'interval' ? s.timing.minutes : 60))
    setDaily(s?.timing.kind === 'daily' ? s.timing.time : '09:00')
    setForm(true)
    setDraft((old) => ({ ...old, dirty: false }))
    setFailure('')
    setNotice('')
  }
  const [operationBusy, runOperation] = useOperation(`schedules:${scope.sessionId}`)
  const busy = localBusy || operationBusy
  async function action(fn: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true)
    setFailure('')
    setNotice('')
    try {
      await runOperation(fn)
      refresh()
      setNotice(success)
    } catch (e) {
      setFailure(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const rule = (): Timing =>
    kind === 'once'
      ? { kind, at: new Date(at).getTime() }
      : kind === 'interval'
        ? { kind, minutes: Number(minutes) }
        : { kind, time: daily }
  const timingText = (t: Timing): string =>
    t.kind === 'once'
      ? '一次 · ' + stamp(t.at)
      : t.kind === 'interval'
        ? `每 ${t.minutes} 分钟`
        : `每天 ${t.time}`
  return (
    <div className="px-ui px-panel">
      <h3>定时任务</h3>
      <p className="px-muted">
        应用运行时向指定会话投递，沿用该会话的模型与权限。忙碌时进入队列；退出期间不执行，恢复后重复任务只补最新一次。时区：
        {data?.timeZone ?? '读取中'}。
      </p>
      <div className="px-actions">
        <button className="px-primary" disabled={busy || !draftAvailable} onClick={() => begin(null)}>
          新建定时任务
        </button>
        <button onClick={refresh}>刷新任务</button>
      </div>
      {draftWarning ? <p role="alert">{draftWarning}</p> : null}
      {unreadableDraft ? (
        <ConfirmDelete label="放弃无法恢复的草稿" onConfirm={async () => clearDraft()} />
      ) : null}
      <StorageNotice visible={visible} onRestored={refresh} />
      {!form && (draft.dirty || title.trim() || prompt.trim()) ? (
        <button onClick={() => setForm(true)}>继续编辑草稿</button>
      ) : null}
      {replacement ? (
        <section className="px-card" role="alert">
          <p>当前窗口已有定时任务草稿。请先保存，或明确放弃后再打开另一项。</p>
          <div className="px-actions">
            <button
              onClick={() => {
                setReplacement(null)
                setForm(true)
              }}
            >
              保留当前草稿
            </button>
            <button onClick={() => begin(replacement.schedule, true)}>放弃草稿并打开</button>
          </div>
        </section>
      ) : null}
      {failure || error ? <p role="alert">{failure || error}</p> : null}
      {notice ? (
        <p role="status" className="px-feedback">
          {notice}
        </p>
      ) : null}
      {form ? (
        <section className="px-card" aria-label="定时任务编辑器">
          <fieldset disabled={busy || !draftAvailable}>
            <h4>{editing ? '编辑任务' : '新建任务'}</h4>
            <label>
              任务名称
              <input
                aria-label="任务名称"
                maxLength={100}
                value={title}
                onChange={(e: any) => setTitle(e.target.value)}
              />
            </label>
            <label>
              目标会话
              <select
                aria-label="目标会话"
                value={sessionId}
                onChange={(e: any) => setSessionId(e.target.value)}
              >
                {!sessions.byId[sessionId] ? (
                  <option value={sessionId}>{sessionId}（暂不可用）</option>
                ) : null}
                {sessions.ids
                  .filter((id) => sessions.byId[id]?.origin !== 'subagent')
                  .map((id) => (
                    <option key={id} value={id}>
                      {sessions.byId[id].displayTitle}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              执行要求
              <textarea
                aria-label="执行要求"
                rows={4}
                maxLength={4000}
                value={prompt}
                onChange={(e: any) => setPrompt(e.target.value)}
                placeholder="例如：检查项目测试，汇报新增失败和对应文件。"
              />
            </label>
            <label>
              触发方式
              <select aria-label="触发方式" value={kind} onChange={(e: any) => setKind(e.target.value)}>
                <option value="once">指定时间执行一次</option>
                <option value="interval">固定间隔</option>
                <option value="daily">每天</option>
              </select>
            </label>
            {kind === 'once' ? (
              <label>
                本机时间
                <input
                  aria-label="本机时间"
                  type="datetime-local"
                  value={at}
                  onInput={(e: any) => setAt(e.currentTarget.value)}
                  onChange={(e: any) => setAt(e.target.value)}
                />
              </label>
            ) : kind === 'interval' ? (
              <label>
                间隔（分钟）
                <input
                  aria-label="间隔分钟"
                  type="number"
                  min={1}
                  max={525600}
                  value={minutes}
                  onInput={(e: any) => setMinutes(e.currentTarget.value)}
                  onChange={(e: any) => setMinutes(e.target.value)}
                />
              </label>
            ) : (
              <label>
                每日时间
                <input
                  aria-label="每日时间"
                  type="time"
                  value={daily}
                  onInput={(e: any) => setDaily(e.currentTarget.value)}
                  onChange={(e: any) => setDaily(e.target.value)}
                />
              </label>
            )}
            <label className="px-check">
              <input type="checkbox" checked={enabled} onChange={(e: any) => setEnabled(e.target.checked)} />
              启用此任务
            </label>
            <div className="px-actions">
              <button
                className="px-primary"
                disabled={busy || !title.trim() || !prompt.trim()}
                onClick={() =>
                  void action(async () => {
                    await post('schedules', {
                      action: 'save',
                      ...(editing ? { id: editing.id, updatedAt: editing.updatedAt } : {}),
                      title,
                      prompt,
                      sessionId,
                      timing: rule(),
                      enabled
                    })
                    clearDraft()
                  }, '定时任务已保存')
                }
              >
                保存定时任务
              </button>
              <button disabled={busy} onClick={() => setForm(false)}>
                收起编辑器（保留草稿）
              </button>
              <ConfirmDelete
                label="放弃草稿"
                disabled={busy}
                onConfirm={async () => {
                  clearDraft()
                  setReplacement(null)
                }}
              />
            </div>
          </fieldset>
        </section>
      ) : null}
      {data?.schedules.length === 0 ? <p>尚未配置定时任务。</p> : null}
      {data?.schedules.map((s) => (
        <article className="px-card" key={s.id}>
          <h4>
            {s.title} · {s.enabled ? '已启用' : '已暂停'}
          </h4>
          <p>{s.prompt}</p>
          <p className="px-muted">
            会话：{sessions.byId[s.sessionId]?.displayTitle ?? s.sessionId}
            <br />
            {timingText(s.timing)} · {s.timeZone}
            <br />
            下次：{stamp(s.nextAt)}
          </p>
          {s.history[0]?.status === 'uncertain' ? (
            <p role="alert">{s.history[0].detail} 检查会话后再手动投递或启用。</p>
          ) : null}
          <div className="px-actions">
            <button
              disabled={!sessions.byId[s.sessionId]}
              onClick={() => ctx.uiWorkspace.openSession(s.sessionId)}
            >
              打开会话
            </button>
            <button disabled={busy} onClick={() => begin(s)}>
              编辑任务
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(
                  () => post('schedules', { ...s, action: 'save', enabled: !s.enabled }),
                  s.enabled ? '任务已暂停' : '任务已启用'
                )
              }
            >
              {s.enabled ? '暂停任务' : '启用任务'}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await post<Schedule>('schedules', { action: 'run', id: s.id })
                  if (!['queued', 'running', 'completed'].includes(result.history[0]?.status))
                    throw new Error(result.history[0]?.detail ?? '投递尚未确认')
                }, '已投递到目标会话；这不代表 Agent 已完成。')
              }
            >
              立即投递一次
            </button>
            <ConfirmDelete
              label="删除任务"
              disabled={busy}
              onConfirm={() =>
                action(
                  () => post('schedules', { action: 'delete', id: s.id, updatedAt: s.updatedAt }),
                  '任务已删除；已投递的会话消息会保留。'
                )
              }
            />
          </div>
          <details>
            <summary>最近触发 · {s.history.length} 次</summary>
            <p className="px-muted">
              已入队表示会话已接收；轮次结束不代表任务内容验证通过。请打开目标会话核对输出。
            </p>
            {s.history.map((h) => (
              <p key={h.requestId}>
                {stamp(h.time)} ·{' '}
                {
                  {
                    queued: '已入队',
                    dispatching: '投递中',
                    uncertain: '未确认 / 已暂停',
                    running: '执行中',
                    completed: '轮次结束',
                    failed: '执行失败',
                    cancelled: '已取消',
                    interrupted: '执行中断'
                  }[h.status]
                }
                {h.turn !== undefined ? ` · 第 ${h.turn} 轮` : ''}
                {h.finishedAt ? ` · 结束于 ${stamp(h.finishedAt)}` : ''}
                {h.detail ? (
                  <small>
                    <br />
                    {h.detail}
                  </small>
                ) : null}
              </p>
            ))}
          </details>
        </article>
      ))}
    </div>
  )
}
