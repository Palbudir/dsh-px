import * as React from 'react'

interface ReceptionSnapshot {
  botId: string
  fingerprint: string
  connected: boolean
  reception: {
    version: 1
    mode: 'standalone' | 'external-consumer'
    revision: string
    active: boolean
    stopUncertain: boolean
  }
}
type Invoke = (endpoint: string, payload: object, signal?: AbortSignal) => Promise<unknown>

function snapshot(value: unknown, botId: string): ReceptionSnapshot {
  const state = value as ReceptionSnapshot
  if (
    state?.botId !== botId ||
    !/^[a-f0-9]{64}$/.test(state.fingerprint) ||
    typeof state.connected !== 'boolean' ||
    state.reception?.version !== 1 ||
    !['standalone', 'external-consumer'].includes(state.reception.mode) ||
    !/^[a-f0-9-]{36}$/.test(state.reception.revision) ||
    typeof state.reception.active !== 'boolean' ||
    typeof state.reception.stopUncertain !== 'boolean'
  )
    throw Error('无法确认接收模式，请检查配套 IM 插件版本。')
  return state
}

/** Inserted into the native IM settings, so recovery remains available when PX is disabled. */
export function ImReceptionPanel({ botId, invoke }: { botId: string; invoke: Invoke }) {
  const [opened, setOpened] = React.useState(false),
    [state, setState] = React.useState<ReceptionSnapshot | null>(null),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState(''),
    [confirm, setConfirm] = React.useState(false),
    active = React.useRef<AbortController | null>(null)
  React.useEffect(() => {
    active.current?.abort()
    active.current = null
    setBusy(false)
    setState(null)
    setConfirm(false)
    setError('')
    return () => {
      active.current?.abort()
    }
  }, [botId, invoke])

  const read = async (signal: AbortSignal) =>
    snapshot(await invoke('bot.reception.describe', { botId }, signal), botId)
  const refresh = async () => {
    if (active.current) return
    const request = new AbortController()
    active.current = request
    setBusy(true)
    setError('')
    setConfirm(false)
    setState(null)
    try {
      const next = await read(request.signal)
      if (!request.signal.aborted) setState(next)
    } catch {
      if (!request.signal.aborted) setError('无法确认接收模式，请检查连接和配套 IM 插件版本后刷新。')
    } finally {
      if (active.current === request) active.current = null
      if (!request.signal.aborted) setBusy(false)
    }
  }
  const restore = async () => {
    if (active.current || !state || !confirm) return
    const request = new AbortController(),
      before = state
    active.current = request
    setBusy(true)
    setError('')
    setConfirm(false)
    try {
      await invoke(
        'bot.reception.restore',
        { botId, expectedFingerprint: before.fingerprint, expectedRevision: before.reception.revision },
        request.signal
      )
      const next = await read(request.signal)
      if (!request.signal.aborted) setState(next)
    } catch {
      if (!request.signal.aborted) {
        setState(null)
        setError(
          '恢复未确认：接收方可能仍在运行、状态已变化或连接失败。请刷新查看实际模式；不会自动重复恢复。'
        )
      }
    } finally {
      if (active.current === request) active.current = null
      if (!request.signal.aborted) setBusy(false)
    }
  }
  const external = state?.reception.mode === 'external-consumer'
  return (
    <section aria-label="飞书接收模式" style={{ marginBlock: 12 }}>
      <button
        className="bxf-button"
        type="button"
        disabled={busy}
        aria-expanded={opened}
        onClick={() => {
          setOpened(!opened)
          if (!opened) void refresh()
        }}
      >
        接收模式与恢复
      </button>
      {opened && (
        <div>
          {busy && <p role="status">正在核对…</p>}
          {error && <p role="alert">{error}</p>}
          {state && (
            <>
              <p>
                配置的接收方式：{external ? '由外部接收方处理' : '原生 IM 处理'}；连接：
                {state.connected ? '已连接' : '未连接'}。
              </p>
              {state.reception.stopUncertain && (
                <p role="alert">
                  旧连接停止尚未确认，当前配置不能代表实际处理方。请重试恢复或重新连接；不会启动第二份连接。
                </p>
              )}
              {external && (
                <p>
                  {state.reception.active
                    ? '接收方仍在运行。请先在 PX 停止该账号的接收与在途工作，再刷新恢复。'
                    : '当前没有接收方。可以恢复原生 IM 的会话、命令与审批处理。'}
                </p>
              )}
              {external &&
                !state.reception.active &&
                (!confirm ? (
                  <button
                    className="bxf-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirm(true)}
                  >
                    恢复原生处理
                  </button>
                ) : (
                  <div>
                    <p>将重新连接这个机器人，由原生 IM 处理后续消息。账号和凭据保留。</p>
                    <button
                      className="bxf-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void restore()}
                    >
                      确认恢复
                    </button>{' '}
                    <button
                      className="bxf-button"
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirm(false)}
                    >
                      取消
                    </button>
                  </div>
                ))}
            </>
          )}
          <button className="bxf-button" type="button" disabled={busy} onClick={() => void refresh()}>
            刷新状态
          </button>
        </div>
      )}
    </section>
  )
}
