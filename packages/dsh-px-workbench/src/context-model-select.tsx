import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../shared/client-http'
import { controlStyle, cardStyle } from '../../shared/ui'
import { TIER_LABELS, type ContextTier } from '../../shared/context-policy'

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
function ModelSeat({ Native, openSession, pxSessionId, ...props }: any): unknown {
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
  async function select(selection: Selection): Promise<any> {
    setError('')
    try {
      const value = await requestJson<Status>(query(pxSessionId, selection))
      if (!alive.current) return
      if (value.requiresContinuation) {
        setPending({ selection, status: value, requestId: crypto.randomUUID() })
        return undefined
      }
      return await props.select(selection)
    } catch (e: any) {
      if (alive.current) setError(e.message)
      return undefined
    }
  }
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
      <Native key={pending?.requestId ?? 'picker'} {...props} select={select} />
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
/** Reuse the native picker and its store; add the continuation action around its public select callback. */
export function installContextModelSelect(ctx: any): void {
  ctx.inject(['slots', 'uiWorkspace', 'modelDirectories'], (host: any) =>
    host.effect(() => {
      const key = 'conversation.input.model',
        tag = 'dsh-px-context',
        slots = host.slots
      let current: any,
        dispose: (() => void) | undefined,
        closed = false,
        scheduled = false
      const refresh = () => {
        if (closed) return
        const original = slots.entries(key).find((e: any) => e.registrant !== tag)
        if (original === current) return
        dispose?.()
        dispose = undefined
        current = original
        if (!original) return
        dispose = slots.register(
          {
            name: key,
            registrant: tag,
            priority: (original.options.priority ?? 0) - 1,
            locale: original.locale,
            inject: (...args: any[]) => ({ ...original.inject?.(...args), pxSessionId: args[0] })
          },
          (props: any) => (
            <ModelSeat
              key={props.pxSessionId}
              {...props}
              Native={original.component}
              openSession={(id: string) => host.uiWorkspace.openSession(id)}
            />
          )
        )
      }
      const schedule = () => {
        if (!scheduled) {
          scheduled = true
          queueMicrotask(() => {
            scheduled = false
            refresh()
          })
        }
      }
      const unsubscribe = slots.subscribe(key, schedule)
      schedule()
      return () => {
        closed = true
        unsubscribe()
        dispose?.()
      }
    }, 'workbench: native model tier picker')
  )
}
