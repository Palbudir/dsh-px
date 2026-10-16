import { useEffect, useState } from 'react'
import { requestJson } from '../../../shared/client-http'
import { cardStyle } from '../../../shared/ui'
import type { NativeWork } from '../native-work'

const goalLabels = { active: '进行中', paused: '已暂停', blocked: '遇到阻碍', complete: '已完成' }
const taskLabels: Record<string, string> = {
  pending: '待处理',
  in_progress: '处理中',
  completed: '已完成',
  deleted: '已删除'
}
const memberLabels: Record<string, string> = {
  running: '执行中',
  inactive: '空闲',
  provisioning: '准备中',
  failed: '失败',
  active: '已登记'
}

/** Native status stays separate from the model-authored ledger; observing never resumes a goal. */
export function NativeWorkPanel({ sessionId, visible }: { sessionId: string; visible: boolean }): unknown {
  const [view, setView] = useState<NativeWork | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setView(null)
    setError('')
    if (!visible) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async (): Promise<void> => {
      try {
        const next = await requestJson<NativeWork>(
          `/dsh-px-taskflow/state?sessionId=${encodeURIComponent(sessionId)}`,
          { signal: abort.signal }
        )
        if (!abort.signal.aborted) {
          setView(next)
          setError('')
        }
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void refresh(), 2500)
    }
    void refresh()
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [sessionId, visible])
  if (!view) return <p role={error ? 'alert' : 'status'}>{error || '正在读取原生任务状态…'}</p>
  const goal = view.goal.status === 'available' ? view.goal.value : null
  const team = view.team.status === 'available' ? view.team.value : null
  return (
    <section aria-label="原生目标与团队">
      {error && <p role="alert">{error} 下方为上次读取的状态。</p>}
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <h4 style={{ marginTop: 0 }}>当前目标</h4>
        {view.goal.status !== 'available' ? (
          <p>{view.goal.reason}</p>
        ) : goal ? (
          <>
            <strong>{goalLabels[goal.phase]}</strong>
            <p style={{ whiteSpace: 'pre-wrap' }}>{goal.objective}</p>
            {goal.blockedReason && <p>阻碍：{goal.blockedReason.message}</p>}
            <small>
              {goal.activation === 'armed'
                ? '自动继续已启用'
                : goal.activation === 'disarmed'
                  ? '自动继续未启用'
                  : '存储快照，自动继续状态未知'}{' '}
              · 已使用 {goal.roundsStarted}/{goal.maxGoalRounds} 轮
            </small>
            <details>
              <summary>编号与来源</summary>
              <p>
                DSH Goal · {goal.id} · revision {goal.revision}
              </p>
            </details>
          </>
        ) : (
          <p>尚未设置原生目标。需要持续完成多轮任务时，可使用会话中的 /goal。</p>
        )}
      </div>
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <h4 style={{ marginTop: 0 }}>团队任务</h4>
        {view.team.status !== 'available' ? (
          <p>{view.team.reason}</p>
        ) : team ? (
          <>
            <p>{team.members.map((m) => `${m.name}（${memberLabels[m.status] ?? m.status}）`).join('、')}</p>
            {view.source === 'stored' && <small>显示持久记录，不代表成员正在运行。</small>}
            {team.tasks.length ? (
              team.tasks.map((task) => (
                <div key={task.id} style={{ padding: '8px 0', borderTop: '1px solid var(--px-border)' }}>
                  <strong>
                    {taskLabels[task.status] ?? task.status} · {task.subject}
                  </strong>
                  <div>
                    {task.ownerName ? `负责人：${task.ownerName}` : '未分配'}
                    {task.blockedBy.length ? ` · 依赖 ${task.blockedBy.length} 项` : ''}
                  </div>
                  {task.writeScopeWarnings.map((warning, i) => (
                    <p key={i} role="status">
                      {warning}
                    </p>
                  ))}
                  <small>
                    {task.id} · revision {task.revision}
                  </small>
                </div>
              ))
            ) : (
              <p>尚无团队任务。由原生团队工具创建、领取和更新；这里不会另外创建任务。</p>
            )}
            {team.truncated && (
              <p>
                显示前 {team.tasks.length}/{team.taskCount} 项，请在原生团队面板查看完整任务板。
              </p>
            )}
          </>
        ) : (
          <p>暂无团队记录。</p>
        )}
      </div>
    </section>
  )
}
