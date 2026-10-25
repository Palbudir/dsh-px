import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../shared/client-http'
import { controlStyle, cardStyle } from '../../shared/ui'
import { TIER_LABELS, type ContextTier } from '../../shared/context-policy'
import { observeRejectedModelSelection } from './model-selection-observer'

type Selection = { provider: string; model: string; reasoningEffort?: string }
type Status = {
  bound?: ContextTier
  target: { capacity?: number; tier: ContextTier }
  requiresContinuation: boolean
  nativeGuard: boolean
  canContinue: boolean
}
function query(sessionId: string, selection: Selection): string {
  return (
    '/dsh-px-workbench/context-policy?' +
    new URLSearchParams({ sessionId, provider: selection.provider, model: selection.model })
  )
}
function ModelSeat({ openSession, pxSessionId, ...props }: any): unknown {
  const [snapshot, setSnapshot] = useState<any>(props.directory.getSnapshot)
  useEffect(() => {
    const refresh = () => setSnapshot(props.directory.getSnapshot())
    const stop = props.directory.subscribe(refresh)
    refresh()
    return stop
  }, [props.directory])
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState('')
  const [pending, setPending] = useState<{ selection: Selection; status: Status; requestId: string } | null>(
    null
  )
  const [busy, setBusy] = useState(false),
    alive = useRef(true)
  const dialog = useRef<any>(null)
  useEffect(
    () =>
      observeRejectedModelSelection<Status>(
        props.directory,
        (selection, signal) => requestJson<Status>(query(pxSessionId, selection), { signal }),
        (selection, value) => {
          if (value.requiresContinuation) {
            setError('')
            setPending({ selection, status: value, requestId: crypto.randomUUID() })
          }
        }
      ),
    [props.directory, pxSessionId]
  )
  useEffect(() => {
    if (pending && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [pending])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const ac = new AbortController()
    setStatus(null)
    if (snapshot.current)
      void requestJson<Status>(query(pxSessionId, snapshot.current), { signal: ac.signal })
        .then((value) => {
          if (!ac.signal.aborted) setStatus(value)
        })
        .catch(() => {
          /* Native picker retains its own unavailable/error surface. */
        })
    return () => ac.abort()
    // Native catalog refreshes after provider settings change, even when the selected route is unchanged.
  }, [pxSessionId, snapshot.current?.provider, snapshot.current?.model, snapshot.groups])
  async function continueSession(): Promise<void> {
    if (!pending || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await requestJson<{ createdSessionId: string }>(
        '/dsh-px-memory?sessionId=' + encodeURIComponent(pxSessionId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'new-model-session',
            requestId: pending.requestId,
            ...pending.selection
          })
        }
      )
      if (alive.current) {
        setPending(null)
        openSession(result.createdSessionId)
      }
    } catch (e: any) {
      if (alive.current) setError(e.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <>
      {status && (
        <span
          title={
            (status.nativeGuard ? '' : '此宿主只提供请求前检查；完整切换约束需要 PX Desktop 0.7。') +
            (status.target.capacity
              ? `${status.target.capacity.toLocaleString()} tokens；同档仍按实际容量校验`
              : '窗口未声明，按最低档注入；请在模型设置中填写容量')
          }
          style={{ fontSize: 11, opacity: 0.65, whiteSpace: 'nowrap' }}
        >
          {TIER_LABELS[status.bound ?? status.target.tier]}
          {status.target.capacity ? '' : ' · 未声明'}
        </span>
      )}
      {status?.requiresContinuation && snapshot.current && (
        <button
          style={{ ...controlStyle, fontSize: 12 }}
          onClick={() => setPending({ selection: snapshot.current, status, requestId: crypto.randomUUID() })}
        >
          新档位接续
        </button>
      )}
      {!pending && error && (
        <span role="alert" style={{ fontSize: 12 }}>
          {error}
        </span>
      )}
      {pending && (
        <dialog
          ref={dialog}
          className="px-ui"
          aria-label="换档接续会话"
          onCancel={(e: any) => {
            e.preventDefault()
            if (!busy) {
              setPending(null)
              setError('')
            }
          }}
          style={{
            ...cardStyle,
            width: 400,
            maxWidth: '90vw',
            padding: 20,
            background: 'var(--px-bg)',
            color: 'var(--px-fg)'
          }}
        >
          <strong>用新模型接续会话</strong>
          <p>
            从「{TIER_LABELS[pending.status.bound!]}」切换到「{TIER_LABELS[pending.status.target.tier]}
            」档需要新会话。
          </p>
          <p>
            保留当前人格与工作区，提供历史和工作账本的接续入口。原会话草稿留在原处；新会话不会自动发送消息或恢复任务。
          </p>
          {error && <p role="alert">{error}</p>}
          {!pending.status.canContinue && (
            <p>请先启用“人格与经历”插件以接续历史；也可以从左侧新建空白会话。</p>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              style={controlStyle}
              disabled={busy}
              onClick={() => {
                setPending(null)
                setError('')
              }}
            >
              取消
            </button>
            <button
              style={controlStyle}
              disabled={busy || !pending.status.canContinue}
              onClick={() => void continueSession()}
            >
              {busy ? '正在创建…' : '新建接续会话'}
            </button>
          </div>
        </dialog>
      )}
    </>
  )
}
/** Keep native controls and child-slot ownership intact; use their shared directory to offer a continuation. */
export function installContextModelSelect(ctx: any): void {
  ctx.inject(['slots', 'uiWorkspace', 'modelDirectories', 'sessions'], (host: any) =>
    host.slots.inject('conversation.input.right', () =>
      host.slots.register(
        {
          name: 'conversation.input.right',
          id: 'dsh-px-context',
          order: 80,
          inject: (sessionId: string) => ({
            pxSessionId: sessionId,
            available: host.sessions.subagentAddress(sessionId) === undefined,
            directory: host.modelDirectories.directoryFor(sessionId).store
          })
        },
        (props: any) =>
          props.available ? (
            <ModelSeat
              key={props.pxSessionId}
              {...props}
              openSession={(id: string) => host.uiWorkspace.openSession(id)}
            />
          ) : null
      )
    )
  )
}
