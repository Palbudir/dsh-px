import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { requestJson } from '../../shared/client-http'
import { defaultChannelAttention } from '../../shared/channel-attention'
import type { ChannelAccount, ChannelConfiguration } from './channel-settings'
import type { FeishuChannel } from './feishu-channel'
import type { FeishuTasks } from './feishu-tasks'
import type { createCapabilities } from '../../shared/client-capabilities'
import { PersonaMailPanel } from './persona-mail-panel'
import { ChannelInteractionPanel } from '../../shared/channel-interactions-panel'
import { ChannelRoutesPanel } from './channel-routes-panel'

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
  activities: Array<ReturnType<FeishuTasks['status']> & { accountId: string }>
  knownChats: Array<{ accountId: string; conversations: Array<{ conversationId: string; kind: string }> }>
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
  observedMembers,
  onClose,
  onSaved
}: {
  edit: Edit
  personas: View['personas']
  available: boolean
  observedMembers: Array<{ id: string; conversationId: string; at: string; preview: string }>
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [draft, setDraft] = useState(() => structuredClone(edit.account)),
    [focused, setFocused] = useState(() => edit.account.attention.focusedChats.join('\n')),
    [muted, setMuted] = useState(() => edit.account.attention.mutedChats.join('\n')),
    [members, setMembers] = useState(() => edit.account.authorizedUsers.join('\n')),
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
        authorizedUsers: [...new Set(lines(members))],
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
          任务授权成员（每行一个接收记录中的 ID，最多 32 个）
          <textarea
            aria-label="飞书任务授权成员"
            value={members}
            onChange={(e: any) => setMembers(e.target.value)}
            rows={3}
            style={{ width: '100%' }}
          />
        </label>
        <p className="px-muted">
          请先私聊机器人发送一条可辨认的消息，再核对下方记录并添加对应
          ID。昵称不用于授权；任务权限不会自动开放人格私有资料。
        </p>
        {!!observedMembers.length && (
          <details>
            <summary>最近接收成员</summary>
            {observedMembers.map((member) => (
              <div key={member.id}>
                <code>{member.id}</code> · {member.conversationId}
                <p>{member.preview || '旧记录未保留预览'}</p>
                <button
                  type="button"
                  onClick={() =>
                    setMembers((value) =>
                      [
                        ...new Set([
                          ...value
                            .split(/\r?\n/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                          member.id
                        ])
                      ].join('\n')
                    )
                  }
                >
                  添加此成员 ID
                </button>
              </div>
            ))}
          </details>
        )}
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
        <label style={{ display: 'block' }}>
          <input
            type="checkbox"
            checked={draft.attention.allowAgentChanges === true}
            onChange={(e: any) =>
              update({ attention: { ...draft.attention, allowAgentChanges: e.target.checked } })
            }
          />
          允许人格判断通知并临时关注聊天
        </label>
        <p className="px-muted">
          开启后会使用少量模型请求检查通知预览；只调整关注，不授予任务权限。原有配置默认保持关闭。
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
      task?: boolean
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
    try {
      await refresh()
    } catch {
      if (alive.current) setNotice('操作已受理，但状态暂未刷新；请稍后刷新查看。')
    }
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
      <PersonaMailPanel />
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
          {!view.componentEnabled && (
            <p role="status">渠道配置项已在内置插件中停用，已保存的账号设置仍然保留。</p>
          )}
          {view.discoveryError && <p role="alert">{view.discoveryError}</p>}
          {view.failures.map((row) => (
            <p key={row.id} role="alert">
              {row.id}：{row.error}
            </p>
          ))}
          <section className="px-card">
            <h3>添加飞书账号</h3>
            <p className="px-muted">
              先在原生 IM 配置账号，再核对身份。可接收文字交流，并让明确授权的成员发起原生任务。
            </p>
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
                        attention: { ...defaultChannelAttention(), allowAgentChanges: true }
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
              observedMembers={
                view.runtimes.find((r) => r.accountId === edit.account.accountId)?.observedMembers ?? []
              }
              onClose={() => setEdit(null)}
              onSaved={refresh}
            />
          )}
          {!view.configuration.accounts.length && !edit && (
            <div className="px-empty">尚未启用 PX 渠道接收。原生 IM 与 QQ 的现有设置不会自动改变。</div>
          )}
          {view.configuration.accounts.map((account) => {
            const runtime = view.runtimes.find((r) => r.accountId === account.accountId)
            const activity = view.activities.find((r) => r.accountId === account.accountId)
            return (
              <section
                key={account.accountId}
                className="px-card"
                aria-label={'飞书账号 ' + account.accountId}
              >
                <h3>飞书 · {account.accountId}</h3>
                {runtime && (
                  <details className="px-card">
                    <summary>
                      通知判断 ·{' '}
                      {runtime.attention.enabled
                        ? ({
                            idle: '空闲',
                            queued: '等待检查',
                            running: '检查中',
                            completed: '已检查',
                            failed: '检查失败',
                            stopped: '已停止'
                          }[runtime.attention.observer.phase] ?? runtime.attention.observer.phase)
                        : '仅保留预览'}
                    </summary>
                    <p>只判断是否临时关注聊天；回复和本机任务仍在原聊天中核对。</p>
                    {runtime.attention.observer.error && (
                      <p role="alert">{runtime.attention.observer.error}</p>
                    )}
                    {runtime.attention.temporary.map((lease) => (
                      <p key={lease.chatId}>
                        {lease.chatId} ·{' '}
                        {view.personas.find((p) => p.id === lease.personaId)?.name ?? lease.personaId} ·{' '}
                        {lease.quiet ? '临时安静旁听' : '临时关注'}，至{' '}
                        {new Date(lease.until).toLocaleTimeString()}
                      </p>
                    ))}
                    <div className="px-actions">
                      <button
                        disabled={busy || !runtime.attention.enabled}
                        onClick={() =>
                          void run(() =>
                            command({
                              type: 'attention-observer',
                              accountId: account.accountId,
                              action: 'retry'
                            })
                          )
                        }
                      >
                        重新检查通知
                      </button>
                      <button
                        disabled={busy || !['running', 'queued'].includes(runtime.attention.observer.phase)}
                        onClick={() =>
                          void run(() =>
                            command({
                              type: 'attention-observer',
                              accountId: account.accountId,
                              action: 'stop'
                            })
                          )
                        }
                      >
                        停止本次检查
                      </button>
                    </div>
                  </details>
                )}
                <ChannelRoutesPanel
                  account={account}
                  revision={view.revision}
                  personas={view.personas}
                  chats={
                    view.knownChats.find((row) => row.accountId === account.accountId)?.conversations ?? []
                  }
                  onSaved={() => refresh()}
                />
                {activity && (
                  <ChannelInteractionPanel
                    items={activity.pendingInteractions ?? []}
                    answer={(input) =>
                      command({ type: 'answer-interaction', accountId: account.accountId, ...input })
                    }
                  />
                )}
                {activity?.admissionBlocked && (
                  <div role="status">
                    <p>
                      有任务在投入原生会话前失败。可重试尚未投入的任务；已受理或收件待核对的输入不会重复执行。
                    </p>
                    {!activity.records.length &&
                      activity.errors?.map((row) => <p key={row.id}>{row.error}</p>)}
                    <button
                      disabled={busy || activity.receptionPaused || !view.available}
                      onClick={() =>
                        void run(() =>
                          command({ type: 'retry-task-admission', accountId: account.accountId })
                        )
                      }
                    >
                      重试未投入任务
                    </button>
                  </div>
                )}
                {!!activity?.records.length && (
                  <details>
                    <summary>
                      原生任务（{activity.total}
                      {activity.partial ? '，显示最近 100 项' : ''}）
                    </summary>
                    {!activity.connected && (
                      <p role="status">渠道连接不可用；已授权的本机工作可继续，结果保留待发。</p>
                    )}
                    {!!activity.queuedReplies?.length && (
                      <p>
                        有 {activity.queuedReplies.length} 条尚未发送的任务结果或通知，连接恢复后继续交付。
                      </p>
                    )}
                    {activity.records.map((task: any) => (
                      <div key={task.taskId} className="px-card">
                        <p>
                          {task.conversationId} · {task.requesterId} ·{' '}
                          {{ running: '运行中', idle: '当前未运行', stored: '已保存，未加载' }[
                            task.state as string
                          ] ?? task.state}
                          {task.stopping
                            ? ' · 正在停止'
                            : task.paused
                              ? ' · 交付已暂停'
                              : task.authorized
                                ? ''
                                : ' · 当前授权不可用'}
                        </p>
                        <div className="px-actions">
                          <button
                            disabled={busy || !nav.openSession}
                            onClick={() => openSession(task.taskId)}
                          >
                            打开任务会话
                          </button>
                          <button
                            disabled={busy || task.stopping}
                            onClick={() =>
                              void run(() =>
                                command({
                                  type: 'stop-task',
                                  accountId: account.accountId,
                                  taskId: task.taskId
                                })
                              )
                            }
                          >
                            停止任务
                          </button>
                        </div>
                      </div>
                    ))}
                    {activity.replies?.map((reply) => (
                      <div className="px-card" key={reply.id}>
                        <p>
                          任务回复{reply.phase === 'sending' ? '发送尚未结算' : '发送结果不明'} ·{' '}
                          {reply.conversationId}
                        </p>
                        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit' }}>
                          {reply.draft ?? '请查看原生会话中的结果。'}
                        </pre>
                        <div className="px-actions">
                          <button
                            disabled={busy || !nav.openSession}
                            onClick={() => openSession(reply.sessionId)}
                          >
                            查看任务会话
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              setConfirm({
                                accountId: account.accountId,
                                id: reply.id,
                                revision: reply.revision,
                                decision: 'sent',
                                task: true
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
                                decision: 'release',
                                task: true
                              })
                            }
                          >
                            允许后续新回复
                          </button>
                        </div>
                        {confirm?.task && confirm.id === reply.id && (
                          <div role="group" aria-label="确认任务回复核对">
                            <p>
                              {confirm.decision === 'sent'
                                ? '记录为人工确认已发送，不会补发。'
                                : '原回复仍未确认；仅解除后续输出的阻塞，不会补发旧内容。旧回复仍可能稍后送达。'}
                            </p>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await command({ type: 'resolve-task-reply', ...confirm })
                                  setConfirm(null)
                                })
                              }
                            >
                              确认记录
                            </button>
                            <button disabled={busy} onClick={() => setConfirm(null)}>
                              取消
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {activity.errors?.map((row) => (
                      <p key={row.id} role="alert">
                        {row.error}
                      </p>
                    ))}
                  </details>
                )}
                <p>
                  账号默认人格：
                  {view.personas.find((p) => p.id === account.personaId)?.name ?? account.personaId} ·{' '}
                  {modes[account.attention.mode]} ·{' '}
                  {runtime?.accepting
                    ? '接收方已注册'
                    : runtime?.leaseHeld
                      ? '正在结束处理'
                      : account.enabled
                        ? '接收方未运行'
                        : '已停用'}
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
                      {runtime.accepting ? '停止接收与处理' : '重试停止'}
                    </button>
                  )}
                  {account.enabled && !runtime?.accepting && (
                    <button
                      disabled={busy || !!runtime?.leaseHeld || !view.available || !view.componentEnabled}
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
                              {row.conversationId} · 原人格{' '}
                              {view.personas.find((p) => p.id === row.personaId)?.name ?? row.personaId} ·
                              已检查至事件 {row.cursor}；未重新投递。
                              {row.retiredRoute ? '旧路由不再接收新消息。' : ''}
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
