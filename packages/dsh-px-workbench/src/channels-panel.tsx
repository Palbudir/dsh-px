import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { requestJson } from '../../shared/client-http'
import { defaultChannelAttention } from '../../shared/channel-attention'
import type { ChannelAccount, ChannelConfiguration } from './channel-settings'
import type { FeishuChannel } from './feishu-channel'
import type { createCapabilities } from '../../shared/client-capabilities'

export interface ChannelNavigation {
  openSession?: (id: string) => void | Promise<void>
  openPlugin?: (name: string) => void
}
type Navigation = ReturnType<typeof createCapabilities<ChannelNavigation>>
type Runtime = ReturnType<FeishuChannel['status']>
interface View {
  revision: string
  configuration: ChannelConfiguration
  available: boolean
  componentEnabled: boolean
  personas: Array<{ id: string; name: string }>
  accounts: Array<{ botId: string; channel: string }>
  runtimes: Runtime[]
  failures: Array<{ id: string; error: string }>
  discoveryError?: string
}
interface Description {
  accountId: string
  name: string
  fingerprint: string
  connected: boolean
  supported: boolean
  reception?: { mode: string; active: boolean }
}
interface Edit {
  revision: string
  configuration: ChannelConfiguration
  account: ChannelAccount
}
const post = <T,>(body: unknown) =>
  requestJson<T>('/dsh-px-channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
const modes = { focus: '专注聊天', normal: '普通', notifications: '仅通知' }

function AccountEditor({
  edit,
  personas,
  available,
  onClose,
  onSaved
}: {
  edit: Edit
  personas: View['personas']
  available: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [draft, setDraft] = useState(() => structuredClone(edit.account)),
    [focused, setFocused] = useState(() => edit.account.attention.focusedChats.join('\n')),
    [muted, setMuted] = useState(() => edit.account.attention.mutedChats.join('\n')),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const update = (change: Partial<ChannelAccount>) => setDraft((old) => ({ ...old, ...change }))
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const configuration = structuredClone(edit.configuration),
        index = configuration.accounts.findIndex((row) => row.accountId === draft.accountId)
      const lines = (text: string) =>
        text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      const account = {
        ...draft,
        attention: { ...draft.attention, focusedChats: lines(focused), mutedChats: lines(muted) }
      }
      if (index < 0) configuration.accounts.push(account)
      else configuration.accounts[index] = account
      await post({ type: 'save', revision: edit.revision, configuration })
      if (alive.current) {
        await onSaved()
        onClose()
      }
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof Error
            ? error.message +
                ((error as any).status === 409
                  ? '。草稿仍保留；请先保留需要的内容，再放弃草稿并重新读取。'
                  : '')
            : '保存失败'
        )
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <section className="px-card" aria-label="渠道设置草稿">
      <h3>飞书账号设置</h3>
      <p className="px-muted">{draft.accountId} · 刷新状态不会覆盖这份草稿。</p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy} style={{ border: 0, padding: 0, display: 'grid', gap: 12 }}>
        <label>
          使用人格{' '}
          <select
            aria-label="渠道人格"
            value={draft.personaId}
            onChange={(e: any) => update({ personaId: e.target.value })}
          >
            {!personas.some((p) => p.id === draft.personaId) && (
              <option value={draft.personaId}>当前人格不可用</option>
            )}
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          聊天工作目录{' '}
          <input
            aria-label="聊天工作目录"
            style={{ width: '100%' }}
            value={draft.workspace}
            onChange={(e: any) => update({ workspace: e.target.value })}
          />
        </label>
        <label>
          消息模式{' '}
          <select
            aria-label="消息模式"
            value={draft.attention.mode}
            onChange={(e: any) =>
              update({
                attention: { ...draft.attention, mode: e.target.value as ChannelAccount['attention']['mode'] }
              })
            }
          >
            {Object.entries(modes).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="px-muted">
          专注聊天会处理可见文字，由人格决定回复或旁听。普通模式优先处理私聊、@
          和关注聊天；仅通知保留预览，打开聊天后再处理。
        </p>
        <label>
          本账号的公共交流说明{' '}
          <textarea
            aria-label="公共交流说明"
            rows={3}
            maxLength={2000}
            style={{ width: '100%' }}
            value={draft.publicInstructions}
            onChange={(e: any) => update({ publicInstructions: e.target.value })}
          />
        </label>
        <details>
          <summary>关注与提醒</summary>
          <label style={{ display: 'block' }}>
            关注的聊天 ID，每行一个
            <textarea
              aria-label="关注聊天"
              rows={3}
              style={{ width: '100%' }}
              value={focused}
              onChange={(e: any) => setFocused(e.target.value)}
            />
          </label>
          <label style={{ display: 'block' }}>
            免打扰聊天 ID，每行一个
            <textarea
              aria-label="免打扰聊天"
              rows={3}
              style={{ width: '100%' }}
              value={muted}
              onChange={(e: any) => setMuted(e.target.value)}
            />
          </label>
          {(['notifyDirect', 'notifyMentions', 'notifyGroups', 'mentionOverridesMute'] as const).map(
            (key, index) => (
              <label key={key} style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={draft.attention[key]}
                  onChange={(e: any) =>
                    update({ attention: { ...draft.attention, [key]: e.target.checked } })
                  }
                />
                {['私聊提醒', '@ 提醒', '其他群消息提醒', '@ 可以打破免打扰'][index]}
              </label>
            )
          )}
        </details>
        <label>
          <input
            type="checkbox"
            aria-label="启用PX接收"
            checked={draft.enabled}
            disabled={!available && !draft.enabled}
            onChange={(e: any) => update({ enabled: e.target.checked })}
          />
          启用 PX 文本接收
        </label>
        <p>
          消息模式会即时生效。更换人格或目录会停止相关处理，新消息使用新会话，旧记录保留。启用后由 PX
          接收文字，原生 IM 的独立聊天、卡片与命令流程不再同时运行；可在原生 IM 设置中恢复。
        </p>
        <div className="px-actions">
          <button className="px-primary" onClick={() => void save()}>
            保存设置
          </button>
          <button onClick={onClose}>放弃草稿</button>
        </div>
      </fieldset>
    </section>
  )
}

export function ChannelsPanel({ navigation }: { navigation: Navigation }) {
  const nav = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot),
    [view, setView] = useState<View | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<Edit | null>(null),
    [selected, setSelected] = useState(''),
    [description, setDescription] = useState<Description | null>(null),
    [confirm, setConfirm] = useState<{
      accountId: string
      id: string
      revision: string
      decision: 'sent' | 'release'
    } | null>(null)
  const alive = useRef(true),
    sequence = useRef(0)
  const refresh = async (signal?: AbortSignal) => {
    const request = ++sequence.current,
      data = await requestJson<View>('/dsh-px-channels', { signal })
    if (alive.current && request === sequence.current) {
      setView(data)
      setError('')
    }
  }
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        await refresh(controller.signal)
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '无法读取渠道状态')
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000)
    }
    void poll()
    return () => {
      alive.current = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [])
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : '操作未完成')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const command = async (body: unknown) => {
    await post(body)
    await refresh()
  }
  const openSession = (id?: string) => {
    if (id && nav.openSession)
      void run(async () => {
        await nav.openSession!(id)
        setNotice('会话已在工作区选中，关闭设置后即可查看。')
      })
  }
  return (
    <div className="px-ui" style={{ padding: 20, maxWidth: 1100, margin: 'auto' }}>
      <h2>渠道与活动</h2>
      <p>连接账号、选择接收人格，并核对消息与回复。账号凭据仍在原生插件中管理。</p>
      <div className="px-actions">
        <button disabled={busy} onClick={() => void run(() => refresh())}>
          刷新状态
        </button>
        {nav.openPlugin && (
          <>
            <button onClick={() => nav.openPlugin?.('@xmanrui/dsh-im')}>打开原生 IM</button>
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!view ? (
        <p role="status">正在读取渠道状态…</p>
      ) : (
        <>
          {!view.available && (
            <p role="status">原生渠道服务尚未就绪。已保存的配置保留；请检查 IM 与人格插件是否已启用。</p>
          )}
          {view.discoveryError && <p role="alert">{view.discoveryError}</p>}
          {view.failures.map((row) => (
            <p key={row.id} role="alert">
              {row.id}：{row.error}
            </p>
          ))}
          <section className="px-card">
            <h3>添加飞书账号</h3>
            <p className="px-muted">先在原生 IM 配置账号，再在这里核对身份。当前入口接入飞书文字交流。</p>
            <div className="px-actions">
              <select
                aria-label="选择飞书账号"
                disabled={busy}
                value={selected}
                onChange={(e: any) => {
                  setSelected(e.target.value)
                  setDescription(null)
                }}
              >
                <option value="">选择已配置的机器人</option>
                {view.accounts
                  .filter(
                    (a) =>
                      a.channel === 'feishu' &&
                      !view.configuration.accounts.some((c) => c.accountId === a.botId)
                  )
                  .map((a) => (
                    <option key={a.botId} value={a.botId}>
                      {a.botId}
                    </option>
                  ))}
              </select>
              <button
                disabled={busy || !selected}
                onClick={() =>
                  void run(async () => {
                    const result = await requestJson<Description>(
                      '/dsh-px-channels?describe=' + encodeURIComponent(selected)
                    )
                    if (alive.current) setDescription(result)
                  })
                }
              >
                核对账号
              </button>
            </div>
            {description && (
              <div>
                <p>
                  {description.name} · {description.connected ? '已连接' : '未连接'} ·{' '}
                  {description.supported ? '支持 PX 接收与恢复' : '需要配套 IM 接收适配'}
                </p>
                <button
                  disabled={busy || !description.supported || !view.personas.length || !!edit}
                  onClick={() =>
                    setEdit({
                      revision: view.revision,
                      configuration: structuredClone(view.configuration),
                      account: {
                        provider: 'feishu',
                        accountId: description.accountId,
                        fingerprint: description.fingerprint,
                        enabled: false,
                        personaId: view.personas[0].id,
                        workspace: '',
                        routeRevision: 1,
                        authorizedUsers: [],
                        publicInstructions: '',
                        attention: defaultChannelAttention()
                      }
                    })
                  }
                >
                  配置此账号
                </button>
              </div>
            )}
          </section>
          {edit && (
            <AccountEditor
              key={edit.account.accountId + edit.revision}
              edit={edit}
              personas={view.personas}
              available={view.available && view.componentEnabled}
              onClose={() => setEdit(null)}
              onSaved={refresh}
            />
          )}
          {!view.configuration.accounts.length && !edit && (
            <div className="px-empty">尚未启用 PX 渠道接收。原生 IM 与 QQ 的现有设置不会自动改变。</div>
          )}
          {view.configuration.accounts.map((account) => {
            const runtime = view.runtimes.find((r) => r.accountId === account.accountId)
            return (
              <section
                key={account.accountId}
                className="px-card"
                aria-label={'飞书账号 ' + account.accountId}
              >
                <h3>飞书 · {account.accountId}</h3>
                <p>
                  人格：{view.personas.find((p) => p.id === account.personaId)?.name ?? account.personaId} ·{' '}
                  {modes[account.attention.mode]} ·{' '}
                  {runtime?.accepting ? '接收方已注册' : account.enabled ? '接收方未运行' : '已停用'}
                </p>
                <div className="px-actions">
                  <button
                    disabled={busy || !!edit}
                    onClick={() =>
                      setEdit({
                        revision: view.revision,
                        configuration: structuredClone(view.configuration),
                        account: structuredClone(account)
                      })
                    }
                  >
                    编辑设置
                  </button>
                  {runtime && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await command({ type: 'stop', accountId: account.accountId })
                          setNotice(
                            '本次接收与处理已停止。可重新开始接收；若需重启后也保持停用，请编辑设置并关闭接收。'
                          )
                        })
                      }
                    >
                      停止接收与处理
                    </button>
                  )}
                  {account.enabled && !runtime?.accepting && (
                    <button
                      disabled={busy || !view.available || !view.componentEnabled}
                      onClick={() =>
                        void run(() => command({ type: 'retry-account', accountId: account.accountId }))
                      }
                    >
                      开始或重试接收
                    </button>
                  )}
                </div>
                {runtime && (
                  <>
                    <p className="px-muted">
                      待处理 {runtime.counts.inputs.received} 条 · 收件待核对{' '}
                      {runtime.counts.inputs.uncertain} 条 · 回复待核对 {runtime.counts.replies} 条
                    </p>
                    {runtime.recovering && <p role="status">正在读取原生记录核对，不会重新投递旧消息。</p>}
                    {runtime.failures.length > 0 && (
                      <details>
                        <summary>查看处理问题（{runtime.failures.length}）</summary>
                        {runtime.failures.map((row) => (
                          <p key={row.id}>
                            {row.error}
                            {runtime.blocked.includes(row.id) && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    command({ type: 'retry', accountId: account.accountId, id: row.id })
                                  )
                                }
                              >
                                重试准备
                              </button>
                            )}
                          </p>
                        ))}
                      </details>
                    )}
                    {!!runtime.pending.length && (
                      <details>
                        <summary>待处理消息预览（前 {runtime.pending.length} 条）</summary>
                        {runtime.pending.map((row) => (
                          <div key={row.id}>
                            <strong>{row.conversationId}</strong>
                            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.preview}</p>
                          </div>
                        ))}
                      </details>
                    )}
                    {!!runtime.uncertain.length && (
                      <div>
                        <h4>收件待核对</h4>
                        <button
                          disabled={busy || runtime.recovering}
                          onClick={() =>
                            void run(() => command({ type: 'reconcile', accountId: account.accountId }))
                          }
                        >
                          核对原生记录
                        </button>
                        {runtime.uncertain.map((row) => (
                          <div key={row.id} className="px-card">
                            <p>{row.preview}</p>
                            <p className="px-muted">
                              {row.conversationId} · 已检查至事件 {row.cursor}；未重新投递。
                            </p>
                            {nav.openSession && (
                              <button onClick={() => openSession(row.sessionId)}>查看原生会话</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {!!runtime.replies.length && (
                      <div>
                        <h4>回复待核对</h4>
                        <p>请先在对方聊天中核对。接收回执不明时，不会自动补发。</p>
                        {runtime.replies.map((reply) => (
                          <div key={reply.id} className="px-card">
                            <p>
                              {reply.conversationId} ·{' '}
                              {reply.phase === 'sending' ? '发送尚未结算' : '发送结果不明'}
                            </p>
                            <pre
                              style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit' }}
                            >
                              {reply.draft ?? '旧记录没有保留待发正文，请查看原生会话。'}
                            </pre>
                            <div className="px-actions">
                              {nav.openSession && (
                                <button onClick={() => openSession(reply.sessionId)}>查看原生会话</button>
                              )}
                              <button
                                disabled={busy}
                                onClick={() =>
                                  setConfirm({
                                    accountId: account.accountId,
                                    id: reply.id,
                                    revision: reply.revision,
                                    decision: 'sent'
                                  })
                                }
                              >
                                确认已发送
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  setConfirm({
                                    accountId: account.accountId,
                                    id: reply.id,
                                    revision: reply.revision,
                                    decision: 'release'
                                  })
                                }
                              >
                                允许后续新回复
                              </button>
                            </div>
                            {confirm?.id === reply.id && (
                              <div role="group" aria-label="确认回复核对">
                                <p>
                                  {confirm.decision === 'sent'
                                    ? '将记录为人工确认已发送，不会补发。'
                                    : '原回复仍未确认；只解除后续回复的阻塞，不会补发旧内容。请留意旧回复仍可能稍后送达。'}
                                </p>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await command({ type: 'resolve-reply', ...confirm })
                                      setConfirm(null)
                                      setNotice('已记录你的核对决定，没有重新发送旧内容。')
                                    })
                                  }
                                >
                                  确认记录
                                </button>{' '}
                                <button disabled={busy} onClick={() => setConfirm(null)}>
                                  取消
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
