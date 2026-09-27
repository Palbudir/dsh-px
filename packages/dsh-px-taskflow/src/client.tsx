import { installUiStyles, controlStyle, cardStyle } from '../../shared/ui'
import { useEffect, useState } from 'react'
import { RequestError, requestJson } from '../../shared/client-http'
import type { EvidenceDetail, Execution, TaskReview } from './evidence'
import { appendToDraft, type DraftInputContext } from '../../shared/client-input'
import { commandRetryDraft } from './command-retry-draft'

export const inject: string[] = []
const card = { ...cardStyle, marginBottom: 12 }
const button = controlStyle
const labels = {
  returned: '已返回',
  error: '执行异常',
  cancelled: '已取消',
  interrupted: '结果未记录',
  running: '执行中'
}
const states = { working: '进行中', blocked: '遇到阻碍', ready_for_review: '待检查交付' }
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
function ExecutionCard({
  call,
  sessionId,
  inputContext
}: {
  call: Execution
  sessionId: string
  inputContext: DraftInputContext
}): unknown {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<EvidenceDetail | null>(null)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const [prepared, setPrepared] = useState(false)
  const url = `/dsh-px-taskflow/evidence?sessionId=${encodeURIComponent(sessionId)}&callId=${encodeURIComponent(call.id)}`
  useEffect(() => {
    if (!open) return
    let active = true
    setBusy(true)
    setError('')
    setDetail(null)
    setOutput('')
    void requestJson<EvidenceDetail>(url)
      .then((value) => {
        if (active) {
          setDetail(value)
          setOutput(value.output)
        }
      })
      .catch((err) => {
        if (active) setError(message(err))
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [url, open, call.outcome, call.durationMs, retry])
  async function more(): Promise<void> {
    if (detail?.nextOutputOffset === null || detail?.nextOutputOffset === undefined || busy) return
    setBusy(true)
    setError('')
    try {
      const value = await requestJson<EvidenceDetail>(url + `&offset=${detail.nextOutputOffset}`)
      setDetail(value)
      setOutput((old) => old + value.output)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  async function prepareApproval(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const latest = await requestJson<EvidenceDetail>(url)
      const guidance = latest.commandGuidance
      setDetail(latest)
      if (!guidance?.request) throw new Error(guidance?.unavailableReason ?? '当前记录不支持准备授权重试')
      appendToDraft(
        inputContext,
        sessionId,
        commandRetryDraft(guidance.request),
        '已加入此会话草稿；发送后仍需原生审批，尚未执行命令。'
      )
      setPrepared(true)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <details
      style={card}
      onToggle={(event: { currentTarget: { open: boolean } }) => setOpen(event.currentTarget.open)}
    >
      <summary style={{ cursor: 'pointer' }}>
        {labels[call.outcome]} · {call.tool}
        {call.durationMs !== null ? ` · ${(call.durationMs / 1000).toFixed(1)} 秒` : ''}
      </summary>
      {open ? (
        <>
          {(detail?.input ?? call.input) ? (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{detail?.input ?? call.input}</pre>
          ) : null}
          {detail?.commandGuidance ? (
            <section style={{ ...card, marginTop: 10 }} aria-label="Windows 命令限制说明">
              <strong>Windows 子进程权限提示</strong>
              <p>{detail.commandGuidance.message}</p>
              {detail.commandGuidance.request ? (
                <>
                  <details>
                    <summary>查看完整原命令与工作目录</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                      {detail.commandGuidance.request.command}
                    </pre>
                    <p>
                      工作目录：<code>{detail.commandGuidance.request.workdir}</code>
                    </p>
                  </details>
                  <p>
                    仅准备原命令的一次性批准请求，不执行命令、不改变默认权限。检查并发送草稿后，仍须在原生审批中选择允许一次；拒绝或取消就停止。
                  </p>
                  <button style={button} disabled={busy || prepared} onClick={() => void prepareApproval()}>
                    {prepared ? '已加入草稿，等待你检查' : '准备一次性授权重试'}
                  </button>
                </>
              ) : (
                <p>{detail.commandGuidance.unavailableReason}</p>
              )}
            </section>
          ) : null}
          {error ? (
            <p role="alert">
              {error}{' '}
              <button
                style={button}
                disabled={busy}
                onClick={() => (detail ? void more() : setRetry((v) => v + 1))}
              >
                重试读取
              </button>
            </p>
          ) : null}
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {output || (busy ? '正在读取已保存的输出…' : detail ? '尚无文本输出记录' : call.output)}
          </pre>
          {detail ? (
            <p style={{ fontSize: 12, opacity: 0.7 }}>
              已读取 {output.length} / {detail.outputLength} 字符
              {call.outcomeSource === 'command_marker' ? ' · 状态依据命令输出末尾标记' : ''}
            </p>
          ) : null}
          {detail?.nextOutputOffset !== null && detail?.nextOutputOffset !== undefined ? (
            <button style={button} disabled={busy} onClick={() => void more()}>
              {busy ? '读取中…' : '读取后续输出'}
            </button>
          ) : null}
          <div>
            <small>证据编号：{call.id}</small>
          </div>
          <small style={{ opacity: 0.65 }}>
            读取的是会话已保存的文本，不会重新执行工具；上游工具未保存的内容无法从这里恢复。
          </small>
        </>
      ) : null}
    </details>
  )
}
function SessionTaskPanel({
  scope,
  visible,
  inputContext
}: {
  scope: { sessionId: string }
  visible: boolean
  inputContext: DraftInputContext
}): unknown {
  const [data, setData] = useState<TaskReview | null>(null)
  const [error, setError] = useState('')
  const [retryable, setRetryable] = useState(true)
  const [pages, setPages] = useState<Array<number | undefined>>([undefined])
  const [refresh, setRefresh] = useState(0)
  const beforeSeq = pages[pages.length - 1]
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    setData(null)
    setError('')
    setRetryable(true)
    if (!visible) return
    const poll = async (): Promise<void> => {
      let retry = true
      try {
        const query = beforeSeq === undefined ? '' : `&beforeSeq=${beforeSeq}`
        const value = await requestJson<TaskReview>(
          `/dsh-px-taskflow/review?sessionId=${encodeURIComponent(scope.sessionId)}${query}`
        )
        if (active) {
          setData(value)
          setError('')
        }
      } catch (err) {
        retry = !(err instanceof RequestError) || err.retryable
        if (active) {
          setError(message(err))
          setRetryable(retry)
        }
      }
      if (active && retry && beforeSeq === undefined) timer = setTimeout(() => void poll(), 2500)
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [scope.sessionId, visible, beforeSeq, refresh])
  return (
    <div
      className="px-ui"
      style={{
        padding: 16,
        height: '100%',
        overflowY: 'auto',
        minWidth: 0,
        overflowWrap: 'anywhere',
        fontSize: 13,
        lineHeight: 1.6
      }}
    >
      <h3 style={{ marginTop: 0 }}>执行记录</h3>
      <p style={{ opacity: 0.65 }}>记录随会话保存。列表显示摘要，展开执行可按需读取输出。</p>
      {error ? (
        <p role="alert">
          {error} {data ? '下方是上次读取的记录。' : null}{' '}
          {retryable && beforeSeq === undefined ? '正在重试。' : '自动重试已停止。'}
        </p>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button style={button} onClick={() => setRefresh((v) => v + 1)}>
          重新读取
        </button>
        {beforeSeq !== undefined ? (
          <button style={button} onClick={() => setPages([undefined])}>
            返回最新记录
          </button>
        ) : null}
      </div>
      {!data && !error ? <p>正在读取任务记录…</p> : null}
      {data ? (
        <>
          {data.checkpoint ? (
            <section style={card} aria-label="可选工作摘要">
              {data.checkpoint ? (
                <>
                  <strong>{states[data.checkpoint.state]}</strong>
                  <h4 style={{ margin: '8px 0' }}>{data.checkpoint.goal}</h4>
                  {data.checkpoint.summary.length > 240 ? (
                    <details>
                      <summary style={{ cursor: 'pointer' }}>
                        {data.checkpoint.summary.slice(0, 240)}…
                      </summary>
                      <p>{data.checkpoint.summary}</p>
                    </details>
                  ) : (
                    <p>{data.checkpoint.summary}</p>
                  )}
                  <p>下一步：{data.checkpoint.nextStep || '检查修改与验证结果'}</p>
                  <small style={{ opacity: 0.65 }}>
                    Agent 工作摘要 · {new Date(data.checkpoint.time).toLocaleString()}
                  </small>
                  {data.checkpointStale ? (
                    <p role="status">记录之后还有可能影响结论的执行，请核对最新结果。</p>
                  ) : null}
                  {data.checkpoint.evidence.length ? (
                    <details>
                      <summary>引用的执行证据</summary>
                      {data.checkpoint.evidence.map((id) => {
                        const call = data.referencedExecutions.find((c) => c.id === id)
                        return call ? (
                          <ExecutionCard
                            key={id}
                            call={call}
                            sessionId={scope.sessionId}
                            inputContext={inputContext}
                          />
                        ) : (
                          <div key={id}>
                            此条引用未找到：<code>{id}</code>
                          </div>
                        )
                      })}
                    </details>
                  ) : null}
                </>
              ) : (
                <>
                  <strong>尚无工作记录</strong>
                  <p>多步骤任务开始后，Agent 可以记录目标和交接点。执行记录自动产生。</p>
                </>
              )}
            </section>
          ) : null}
          {data.changedFiles.length ? (
            <section style={card}>
              <strong>已记录的文件写入 · 共 {data.changedFilesTotal} 个路径</strong>
              {data.changedFilesTruncated ? (
                <p style={{ opacity: 0.65 }}>
                  当前仅显示最近 {data.changedFiles.length} 个路径。最终文件状态请在“文件变动”的 Git
                  视图中核对。
                </p>
              ) : null}
              {data.changedFiles.map((path) => (
                <div key={path} style={{ paddingTop: 6 }}>
                  <code>{path}</code>
                </div>
              ))}
              <p style={{ marginBottom: 0, opacity: 0.65 }}>
                来自成功返回的文件写工具，不包含只读查看。命令行改动、最终差异与人工已有修改请在“文件变动”的
                Git 视图中核对。
              </p>
            </section>
          ) : null}
          <section aria-label="实际执行记录">
            <h4>实际执行记录 · 共 {data.total} 条</h4>
            <p style={{ opacity: 0.65 }}>“已返回”只代表工具正常返回，测试结果仍需核对输出。</p>
            {beforeSeq !== undefined ? (
              <p>正在查看历史页（第 {pages.length} 页），不会自动跳回最新记录。</p>
            ) : null}
            {data.executions.length === 0 ? <p>当前页没有工具执行记录。</p> : null}
            {[...data.executions].reverse().map((call) => (
              <ExecutionCard
                key={call.id}
                call={call}
                sessionId={scope.sessionId}
                inputContext={inputContext}
              />
            ))}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {pages.length > 1 ? (
                <button style={button} onClick={() => setPages((old) => old.slice(0, -1))}>
                  较新一页
                </button>
              ) : null}
              {data.nextBeforeSeq !== null ? (
                <button style={button} onClick={() => setPages((old) => [...old, data.nextBeforeSeq!])}>
                  更早记录
                </button>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
function TaskPanel(props: {
  scope: { sessionId: string }
  visible: boolean
  inputContext: DraftInputContext
}): unknown {
  return <SessionTaskPanel key={props.scope.sessionId} {...props} />
}
export function apply(ctx: {
  inject: (
    services: string[],
    callback: (
      host: DraftInputContext & {
        betterSidebar: { registerTab: (tab: unknown) => () => void }
        effect: (fn: () => () => void, label: string) => void
      }
    ) => void
  ) => unknown
  effect: (fn: () => () => void, label: string) => void
}): void {
  installUiStyles(ctx)
  ctx.inject(['betterSidebar', 'sessions', 'conversation'], (host) =>
    host.effect(
      () =>
        host.betterSidebar.registerTab({
          id: 'dsh-px-taskflow',
          title: '执行记录',
          description: '工具执行记录与按需读取的输出',
          order: 15,
          single: true,
          icon: '✓',
          component: (props: { scope: { sessionId: string }; visible: boolean }) => (
            <TaskPanel {...props} inputContext={host} />
          )
        }),
      'taskflow: task panel'
    )
  )
}
