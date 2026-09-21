import { useEffect, useState } from 'react'
import { requestJson } from '../../dsh-px-updater/src/client-data'
import type { TaskReview } from './evidence'

export const inject = ['betterSidebar']
const card = { border: '1px solid #8884', borderRadius: 10, padding: 12, marginBottom: 12 }
const labels = { returned: '已返回', error: '执行异常', interrupted: '结果未记录', running: '执行中' }
const states = { working: '进行中', blocked: '遇到阻碍', ready_for_review: '待检查交付' }
function TaskPanel ({ scope, visible }: { scope: { sessionId: string }, visible: boolean }): unknown {
  const [data, setData] = useState<TaskReview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    setData(null); setError('')
    if (!visible) return
    const poll = async (): Promise<void> => {
      try {
        const value = await requestJson<TaskReview>(`/dsh-px-taskflow/review?sessionId=${encodeURIComponent(scope.sessionId)}`)
        if (active) { setData(value); setError('') }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : String(e)) }
      if (active) timer = setTimeout(() => void poll(), 2500)
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [scope.sessionId, visible])
  return <div style={{ padding: 16, height: '100%', overflowY: 'auto', minWidth: 0, overflowWrap: 'anywhere', fontSize: 13, lineHeight: 1.6 }}>
    <h3 style={{ marginTop: 0 }}>任务进展与交付</h3>
    <p style={{ opacity: .65 }}>在这里核对 Agent 做过什么、下一步是什么。记录随会话保存，重新打开仍可查看。</p>
    {error ? <p role="alert">{error} {data ? '下方是上次读取的记录。' : '正在重试。'}</p> : null}
    {!data && !error ? <p>正在读取任务记录…</p> : null}
    {data ? <>
      <section style={card} aria-label="任务记录">
        {data.checkpoint ? <><strong>{states[data.checkpoint.state]}</strong><h4 style={{ margin: '8px 0' }}>{data.checkpoint.goal}</h4>
          {data.checkpoint.summary.length > 240 ? <details><summary style={{ cursor: 'pointer' }}>{data.checkpoint.summary.slice(0, 240)}…</summary><p>{data.checkpoint.summary}</p></details> : <p>{data.checkpoint.summary}</p>}
          <p>下一步：{data.checkpoint.nextStep || '检查修改与验证结果'}</p><small style={{ opacity: .65 }}>Agent 工作记录 · {new Date(data.checkpoint.time).toLocaleString()}</small>
          {data.checkpointStale ? <p role="status">记录之后还有新的执行，请结合下方执行记录判断当前进度。</p> : null}
          {data.checkpoint.evidence.length ? <details><summary>引用的执行证据</summary>{data.checkpoint.evidence.map(id => {
            const call = data.executions.find(c => c.id === id)
            return <div key={id}>{call ? `${labels[call.outcome]} · ${call.tool} · ` : '较早记录 · '}<code>{id}</code></div>
          })}</details> : null}
        </> : <><strong>尚无工作记录</strong><p>多步骤任务开始后，Agent 可以记录目标、进度和交接点。下面的执行记录自动产生。</p></>}
      </section>
      {data.changedFiles.length ? <section style={card}><strong>文件操作涉及 {data.changedFiles.length} 个路径</strong>{data.changedFiles.map(path => <div key={path} style={{ paddingTop: 6 }}><code>{path}</code></div>)}<p style={{ marginBottom: 0, opacity: .65 }}>来自成功返回的文件工具。命令行改动、最终差异与原有修改请在文件变动面板核对。</p></section> : null}
      <section aria-label="实际执行记录"><h4>实际执行记录 · {data.total}</h4><p style={{ opacity: .65 }}>“已返回”只代表工具正常返回。测试是否通过、覆盖是否足够，需要核对输出。</p>
        {data.truncated ? <p>显示最近 80 条，其余记录保留在会话中。</p> : null}
        {data.executions.length === 0 ? <p>当前会话还没有工具执行记录。</p> : null}
        {[...data.executions].reverse().map(call => <details key={call.id} style={card}>
          <summary style={{ cursor: 'pointer' }}>{labels[call.outcome]} · {call.tool}{call.durationMs !== null ? ` · ${(call.durationMs / 1000).toFixed(1)} 秒` : ''}</summary>
          {call.input ? <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{call.input}</pre> : null}
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{call.output || '尚无输出记录'}</pre><small>证据编号：{call.id}</small>
        </details>)}
      </section>
    </> : null}
  </div>
}
export function apply (ctx: { betterSidebar: { registerTab: (tab: unknown) => () => void }, effect: (fn: () => () => void, label: string) => void }): void {
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-px-taskflow', title: '任务进展', description: '目标、交接点与实际执行证据', order: 15, single: true, icon: '✓', component: TaskPanel }), 'taskflow: task panel')
}
