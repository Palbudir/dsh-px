import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../shared/client-http'
import type { QqPersonaRoute } from './persona-routes'

interface Status {
  chatId: string
  revision: number
  route: QqPersonaRoute | null
  personaId: string
  pendingInputs: number
  busy: string[]
  persistenceBlocked?: boolean
}
const post = <T,>(input: unknown) =>
  requestJson<T>('/dsh-px-qq', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  })

export function PersonaRoutingPanel({
  accountId,
  available,
  revision,
  chats,
  nextOffset,
  personas,
  refresh
}: {
  accountId: string
  available: boolean
  revision: number
  chats: Array<{ chatId: string; label?: string }>
  nextOffset?: number
  personas: Array<{ id: string; name: string }>
  refresh(snapshot: any): void
}) {
  const [chatId, setChatId] = useState(''),
    [target, setTarget] = useState(''),
    [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [loadError, setLoadError] = useState(''),
    [stopPending, setStopPending] = useState(false),
    [reload, setReload] = useState(0)
  const [more, setMore] = useState<typeof chats>([]),
    [page, setPage] = useState<number | undefined>(nextOffset),
    [loadedPage, setLoadedPage] = useState(false)
  const dirtyTarget = useRef(false)
  const rows = [...chats, ...more.filter((row) => !chats.some((current) => current.chatId === row.chatId))]
  useEffect(() => {
    if (!chatId) return
    const ac = new AbortController()
    setStatus(null)
    setLoadError('')
    setStopPending(false)
    void requestJson<Status>('/dsh-px-qq', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({ action: 'persona-route-status', accountId, chatId })
    })
      .then((value) => {
        if (!ac.signal.aborted) {
          setStatus(value)
          if (!dirtyTarget.current) setTarget(value.personaId)
        }
      })
      .catch((error) => {
        if (!ac.signal.aborted) setLoadError(error.message)
      })
    return () => ac.abort()
  }, [accountId, chatId, revision, reload])
  const operate = async (operation: 'change' | 'retry' | 'abort') => {
    if (!status || busy) return
    setBusy(true)
    setError('')
    try {
      const next = await post({
        action: 'persona-route',
        operation,
        accountId,
        chatId,
        revision: status.revision,
        personaId: target,
        stopPending,
        transitionId: status.route?.pending?.id
      })
      refresh(next)
      dirtyTarget.current = false
    } catch (error: any) {
      setError(error.message)
    } finally {
      setBusy(false)
      setReload((value) => value + 1)
    }
  }
  const loadMore = async () => {
    const offset = loadedPage ? page : nextOffset
    if (offset === undefined || busy) return
    setBusy(true)
    setError('')
    try {
      const value = await post<{ items: typeof chats; nextOffset?: number }>({
        action: 'attention-page',
        accountId,
        offset
      })
      setMore((previous) => [
        ...previous,
        ...value.items.filter((row) => !previous.some((current) => current.chatId === row.chatId))
      ])
      setPage(value.nextOffset)
      setLoadedPage(true)
    } catch (error: any) {
      setError(error.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="px-card" style={{ marginTop: 12 }}>
      <summary>按聊天选择负责人格</summary>
      <p className="px-muted">
        共用一个 QQ
        连接，各人格使用自己的会话。切换会恢复目标人格原来的聊天会话，或为它新建会话；旧会话不会改名为新人格。
      </p>
      {!available ? (
        <p>当前 QQ 成员尚未提供路由切换接口。</p>
      ) : (
        <>
          <label>
            聊天{' '}
            <select
              aria-label="路由聊天"
              value={chatId}
              disabled={busy}
              onChange={(event: any) => {
                dirtyTarget.current = false
                setError('')
                setChatId(event.target.value)
              }}
            >
              <option value="">选择已收到消息的聊天</option>
              {rows.map((chat) => (
                <option key={chat.chatId} value={chat.chatId}>
                  {chat.label ?? chat.chatId}
                </option>
              ))}
            </select>
          </label>
          {(loadedPage ? page : nextOffset) !== undefined && (
            <button disabled={busy} onClick={() => void loadMore()}>
              加载更多聊天
            </button>
          )}
          {status && (
            <>
              <p>
                当前负责人格：{personas.find((p) => p.id === status.personaId)?.name ?? '原人格已不可用'}。
              </p>
              {!!status.busy.length && (
                <p role="status">{status.busy.join('；')}。请先结束或停止这些工作。</p>
              )}
              {status.persistenceBlocked && (
                <p role="status">接续记录尚未保存。请先在账号设置中重试保存，再恢复人格切换。</p>
              )}
              {status.route?.pending ? (
                <div>
                  <p role="status">
                    切换到“
                    {personas.find((persona) => persona.id === status.route?.pending?.targetPersonaId)
                      ?.name ?? '目标人格'}
                    ”尚未完成，新消息已保留。可以继续切换，或恢复原负责人格。
                  </p>
                  <button
                    disabled={busy || !!status.busy.length || status.persistenceBlocked}
                    onClick={() => void operate('retry')}
                  >
                    继续切换
                  </button>
                  <button
                    disabled={busy || !!status.busy.length || status.persistenceBlocked}
                    onClick={() => void operate('abort')}
                  >
                    恢复原负责人格
                  </button>
                </div>
              ) : (
                <>
                  <label>
                    交给{' '}
                    <select
                      aria-label="负责人格"
                      value={target}
                      disabled={busy}
                      onChange={(event: any) => {
                        dirtyTarget.current = true
                        setTarget(event.target.value)
                      }}
                    >
                      {!personas.some((p) => p.id === target) && (
                        <option value={target}>请选择可用人格</option>
                      )}
                      {personas.map((persona) => (
                        <option key={persona.id} value={persona.id}>
                          {persona.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!!status.pendingInputs && (
                    <label style={{ display: 'block', marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={stopPending}
                        disabled={busy}
                        onChange={(event: any) => setStopPending(event.target.checked)}
                      />{' '}
                      停止此前 {status.pendingInputs} 条未完成输入后切换，保留原记录
                    </label>
                  )}
                  <button
                    disabled={
                      busy ||
                      !target ||
                      target === status.personaId ||
                      !!status.busy.length ||
                      status.persistenceBlocked ||
                      (!!status.pendingInputs && !stopPending)
                    }
                    onClick={() => void operate('change')}
                  >
                    切换负责人格
                  </button>
                </>
              )}
              <button disabled={busy} onClick={() => setReload((value) => value + 1)}>
                刷新切换状态
              </button>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {loadError && <p role="alert">{loadError}</p>}
    </details>
  )
}
