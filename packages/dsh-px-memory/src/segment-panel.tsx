import { useEffect, useState } from 'react'
import { requestJson } from '../../shared/client-http'
const labels: Record<string, string> = {
  preparing: '后台整理中',
  stopping: '正在停止，等待后台调用结束',
  ready: '摘要已准备，等待下次安全步骤',
  committing: '正在核对原生提交',
  committed: '已压缩，原文保留',
  failed: '整理失败，原文保留',
  cancelled: '已停止',
  discarded: '候选失效，未重复提交'
}

export function SegmentPanel({ url, visible }: { url: string; visible: boolean }) {
  const [view, setView] = useState<any>(null),
    [error, setError] = useState(''),
    [loadError, setLoadError] = useState(''),
    [busy, setBusy] = useState(false),
    [original, setOriginal] = useState<any>(null)
  const request = (input: unknown, signal?: AbortSignal) =>
    requestJson<any>(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'segments', input }),
      signal
    })
  useEffect(() => {
    if (!visible || busy) return
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const value = await request({ action: 'status' }, ac.signal)
        if (!ac.signal.aborted) {
          setView(value)
          setLoadError('')
        }
      } catch (e: any) {
        if (!ac.signal.aborted) setLoadError(e.message)
      }
      if (!ac.signal.aborted) timer = setTimeout(refresh, 4000)
    }
    void refresh()
    return () => {
      ac.abort()
      clearTimeout(timer)
    }
  }, [url, visible, busy])
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const action = (input: unknown) => run(async () => setView(await request(input)))
  return (
    <details className="px-card" style={{ marginBottom: 12 }}>
      <summary>
        本会话的上下文整理
        {view?.records?.some((row: any) =>
          ['preparing', 'stopping', 'ready', 'committing'].includes(row.phase)
        )
          ? ' · 有后台片段'
          : ''}
      </summary>
      <p>
        定期在后台整理已结束的旧段，保留近期原文，并在安全步骤用原生事务提交。不会等待摘要才继续当前工作；必要时仍使用原生压力压缩。
      </p>
      {error && <p role="alert">{error}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {view && (
        <>
          <label>
            <input
              type="checkbox"
              checked={view.settings.enabled}
              disabled={busy}
              onChange={(e: any) =>
                void action({
                  action: 'configure',
                  revision: view.settings.revision,
                  enabled: e.target.checked
                })
              }
            />{' '}
            后台整理较早对话
          </label>
          {!view.ready && <p role="status">后台提交服务暂未就绪，原生压缩仍可继续。</p>}
          {view.problem && <p role="status">{view.problem}</p>}
          <div className="px-actions">
            <button disabled={busy} onClick={() => void action({ action: 'stop' })}>
              停止本次后台整理
            </button>
            <button
              disabled={
                busy ||
                !view.settings.enabled ||
                view.records.some((row: any) =>
                  ['preparing', 'stopping', 'ready', 'committing'].includes(row.phase)
                )
              }
              onClick={() => void action({ action: 'retry' })}
            >
              重新整理符合条件的旧段
            </button>
          </div>
          <p className="px-muted">
            后台调用：{view.cost.measuredJobs} 次有用量记录，{view.cost.unknownJobs}{' '}
            次用量未知。当前页合计输入 {view.cost.usage.inputTokens ?? 0}、输出{' '}
            {view.cost.usage.outputTokens ?? 0}、缓存读取 {view.cost.usage.cacheReadTokens ?? 0}{' '}
            token。此处仅列后台开销。
          </p>
          {view.preparingAdmission && <p role="status">正在检查可整理的旧段，不影响当前会话继续。</p>}
          {!view.records.length && !view.preparingAdmission && (
            <p>尚无需要整理的旧段。消息较少、旧段过大或包含尚不支持的多媒体时，保留原文。</p>
          )}
          {view.records.map((row: any) => (
            <details key={row.id} style={{ marginTop: 12 }}>
              <summary>
                {labels[row.phase] ?? row.phase} · {new Date(row.createdAt).toLocaleTimeString()} ·{' '}
                {row.source.seqs.length} 条原始事件
              </summary>
              <p className="px-muted">
                {row.route.provider} / {row.route.model}
                {row.jobId ? ` · 原生作业 ${row.jobId}` : ''}
              </p>
              {row.error && <p role="status">{row.error}</p>}
              {row.prepared && (
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{row.prepared.summary}</pre>
              )}
              <details>
                <summary>原始交流与执行回执</summary>
                {(row.source.readableSeqs ?? []).map((seq: number) => (
                  <button
                    key={seq}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await requestJson<any>(url, {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ type: 'read-history', targetSessionId: row.sessionId, seq })
                        })
                        setOriginal(result.result)
                      })
                    }
                  >
                    事件 {seq}
                  </button>
                ))}
                <p className="px-muted">
                  原生来源共 {row.source.seqs.length}{' '}
                  条；这里只提供可从普通历史入口读取的交流和回执，运行上下文仍保留在原生日志中。
                </p>
              </details>
              {!!row.prepared?.memories.length && (
                <p>
                  从本段整理的记忆建议：
                  {row.memoryTarget?.conversation
                    ? '保存到此人格的本聊天记忆'
                    : row.memoryTarget?.scope === 'persona-project'
                      ? '保存到“此人格在本项目”的知识'
                      : '保存到此人格的通用知识'}
                  。同主题会更新现行正文。
                </p>
              )}
              {row.prepared?.memories.map((memory: any, index: number) => (
                <div key={index} className="px-card">
                  <strong>{memory.key}</strong>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{memory.body}</p>
                  <p className="px-muted">
                    依据事件：{memory.seqs.join(', ')}。
                    {row.memoryDecisions?.[index]?.status === 'accepted'
                      ? '已采纳'
                      : row.memoryDecisions?.[index]?.status === 'dismissed'
                        ? '已忽略'
                        : '尚未保存'}
                  </p>
                  <button
                    disabled={
                      busy ||
                      row.nativeJobPending ||
                      !!row.memoryDecisions?.[index] ||
                      !['ready', 'committed'].includes(row.phase)
                    }
                    onClick={() => void action({ action: 'accept', id: row.id, index })}
                  >
                    采纳到记忆
                  </button>
                  <button
                    disabled={
                      busy ||
                      row.nativeJobPending ||
                      !!row.memoryDecisions?.[index] ||
                      !['ready', 'committed'].includes(row.phase)
                    }
                    onClick={() => void action({ action: 'dismiss', id: row.id, index })}
                  >
                    忽略建议
                  </button>
                </div>
              ))}
            </details>
          ))}
        </>
      )}
      {original && (
        <div>
          <p>
            事件 {original.seq} · 已显示 {original.text.length} / {original.totalCharacters} 字符
          </p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{original.text}</pre>
          {original.nextOffset !== null && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await requestJson<any>(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      type: 'read-history',
                      targetSessionId: original.sessionId,
                      seq: original.seq,
                      offset: original.nextOffset
                    })
                  })
                  setOriginal({ ...result.result, text: original.text + result.result.text })
                })
              }
            >
              继续读取这条原文
            </button>
          )}
        </div>
      )}
    </details>
  )
}
