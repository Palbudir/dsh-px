import { useEffect, useState } from 'react'
import { installUiStyles, controlStyle } from '../../shared/ui'
import { requestJson } from '../../shared/client-http'
import { DEFAULT_QQ_SETTINGS, type QqSettings } from './policy'
import type { PendingInteraction } from './interactions'

export const inject = ['slots']
interface Snapshot {
  installed: boolean
  componentEnabled?: boolean
  revision: string
  settings: QqSettings
  credentialConfigured: boolean
  sessionModelSelection?: boolean
  suggestedWorkspace?: string
  personas: Array<{ id: string; name: string }>
  workspaces: Array<{ id: string; path: string }>
  active: number
  pendingInteractions?: PendingInteraction[]
  connection: { state: string; message: string; nickname?: string; persistenceBlocked?: boolean }
}
interface Catalog {
  default?: { provider: string; model: string }
  groups: Array<{
    id: string
    name: string
    models: Array<{
      id: string
      name: string
      reasoning?: { efforts: Array<{ id: string; name: string }> }
    }>
  }>
  failures?: Array<{ name: string; message: string }>
}
const endpoint = '/dsh-px-qq'
const post = <T,>(value: unknown): Promise<T> =>
  requestJson<T>(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value)
  })

export function QqSettingsPanel(): unknown {
  const [view, setView] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<QqSettings>({ ...DEFAULT_QQ_SETTINGS })
  const [revision, setRevision] = useState('')
  const [owners, setOwners] = useState('')
  const [secret, setSecret] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [personaName, setPersonaName] = useState('')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [feedbackAt, setFeedbackAt] = useState<'connection' | 'settings' | 'persona' | 'interaction'>(
    'settings'
  )
  const [answers, setAnswers] = useState<Record<string, string>>({})
  function adopt(value: Snapshot) {
    setView(value)
    setDraft(value.settings)
    setRevision(value.revision)
    setOwners(value.settings.authorizedUsers.join(', '))
    setSecret('')
    setDirty(false)
  }
  useEffect(() => {
    let active = true,
      first = true,
      timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await requestJson<Snapshot>(endpoint)
        if (!active) return
        setLoadError('')
        if (first) {
          adopt(result)
          first = false
        } else setView(result)
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : '无法读取 QQ 设置')
      } finally {
        if (active) timer = setTimeout(poll, 3000)
      }
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [])
  function change<K extends keyof QqSettings>(key: K, value: QqSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }
  async function models() {
    setCatalogBusy(true)
    setCatalogError('')
    try {
      setCatalog(await post<Catalog>({ action: 'model-catalog' }))
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : '模型目录暂不可用')
    } finally {
      setCatalogBusy(false)
    }
  }
  async function action(kind: string, fields: Record<string, unknown> = {}) {
    setFeedbackAt(kind === 'answer-interaction' ? 'interaction' : 'connection')
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await post<{ message?: string }>({ action: kind, ...fields })
      setMessage(result.message ?? '操作完成')
      setView(await requestJson<Snapshot>(endpoint))
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成')
    } finally {
      setBusy(false)
    }
  }
  async function save() {
    setFeedbackAt('settings')
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await post<Snapshot>({
        action: 'save',
        revision,
        settings: {
          ...draft,
          authorizedUsers: owners
            .split(/[,，;\s]+/)
            .map((x) => x.trim())
            .filter(Boolean)
        },
        ...(secret ? { secret } : {})
      })
      adopt(result)
      setMessage(
        result.settings.enabled
          ? result.connection.state === 'error'
            ? '设置已保存，接入尚未就绪；请按状态提示修复。'
            : '设置已保存，正在连接 QQ。请以连接状态和实际收发结果为准。'
          : '设置已保存，QQ 接入保持关闭。'
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存未完成；填写内容已保留')
    } finally {
      setBusy(false)
    }
  }
  async function reload() {
    setFeedbackAt('settings')
    setBusy(true)
    setError('')
    try {
      adopt(await requestJson<Snapshot>(endpoint))
      setMessage('已重新加载保存的设置')
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取未完成')
    } finally {
      setBusy(false)
    }
  }
  async function createPersona() {
    setFeedbackAt('persona')
    setBusy(true)
    setError('')
    try {
      const persona = await post<{ id: string; name: string }>({
        action: 'create-persona',
        name: personaName
      })
      setView(await requestJson<Snapshot>(endpoint))
      change('personaId', persona.id)
      setPersonaName('')
      setMessage('人格已创建并选中，请保存 QQ 设置。人格私有记忆在“记忆与知识”中管理。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建未完成')
    } finally {
      setBusy(false)
    }
  }
  const online = !loadError && view?.connection.state === 'online'
  const selectedModel = catalog?.groups
    .find((g) => g.id === draft.model?.provider)
    ?.models.find((m) => m.id === draft.model?.model)
  const modelValue = draft.model ? JSON.stringify([draft.model.provider, draft.model.model]) : ''
  const feedback = (location: typeof feedbackAt) =>
    feedbackAt === location && (
      <>
        {error && <p role="alert">{error}</p>}
        {message && (
          <p role="status" className="px-feedback">
            {message}
          </p>
        )}
      </>
    )
  return (
    <div className="px-ui" style={{ minWidth: 0, overflowWrap: 'anywhere', paddingBottom: 24 }}>
      <h2 style={{ marginTop: 0 }}>QQ 账号</h2>
      <p style={{ lineHeight: 1.7, opacity: 0.75 }}>
        使用普通 QQ 账号接入。私聊和群内 @ 可以交流；只有授权成员能执行本机任务和访问私有资料。
      </p>
      <section className="px-card" aria-label="QQ 连接状态">
        <strong>
          {loadError
            ? '状态暂不可用'
            : !view
              ? '正在读取'
              : view.componentEnabled === false
                ? '组件未就绪'
                : view?.connection.state === 'error'
                  ? '接入异常'
                  : online
                    ? '已连接'
                    : view?.settings.enabled
                      ? '等待连接'
                      : '未开启'}
        </strong>
        {view?.connection.nickname && <span> · {view.connection.nickname}</span>}
        <p role={view?.connection.state === 'error' ? 'alert' : 'status'}>
          {loadError
            ? '暂时无法读取接入状态，已保留填写内容。'
            : (view?.connection.message ?? '正在读取设置…')}
        </p>
        {!!view?.active && (
          <p>当前有 {view.active} 个活动或排队会话。保存配置会重新连接，请先等待任务完成。</p>
        )}
        <div className="px-actions">
          {view?.connection.persistenceBlocked && (
            <button style={controlStyle} disabled={busy} onClick={() => void action('retry-persistence')}>
              重试保存接续记录
            </button>
          )}
          <button
            style={controlStyle}
            disabled={busy || !view?.credentialConfigured || view?.componentEnabled === false || dirty}
            onClick={() => void action('test-connection')}
          >
            检查已保存的连接
          </button>
          <button
            style={controlStyle}
            disabled={busy || !online || dirty}
            onClick={() => void action('send-test')}
          >
            发测试消息给负责人
          </button>
          {!!view?.active && (
            <button style={controlStyle} disabled={busy} onClick={() => void action('stop')}>
              停止当前任务
            </button>
          )}
        </div>
        {dirty && <p className="px-muted">有未保存的设置。连接检查使用保存后的配置。</p>}
        {loadError && <p role="alert">{loadError}</p>}
        {feedback('connection')}
        {!view?.pendingInteractions?.length && feedback('interaction')}
      </section>
      {!!view?.pendingInteractions?.length && (
        <section className="px-card" aria-label="QQ 待处理请求">
          <h3>待处理请求</h3>
          {feedback('interaction')}
          <p className="px-muted">与 QQ 私聊是同一个原生请求；任一处处理后，另一处的旧回复即失效。</p>
          {view.pendingInteractions.map((p) => (
            <div key={p.id} style={{ borderTop: '1px solid var(--px-border)', padding: '12px 0' }}>
              <strong>
                {p.id} · {p.chatId}
              </strong>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 'inherit' }}>
                {p.text}
              </pre>
              {p.kind === 'approval' ? (
                <div className="px-actions">
                  <button
                    style={controlStyle}
                    disabled={busy}
                    onClick={() => void action('answer-interaction', { id: p.id, decision: 'allowed-once' })}
                  >
                    批准一次
                  </button>
                  <button
                    style={controlStyle}
                    disabled={busy}
                    onClick={() => void action('answer-interaction', { id: p.id, decision: 'rejected' })}
                  >
                    拒绝
                  </button>
                </div>
              ) : (
                p.questions?.map((q, index) => (
                  <div key={q.id} style={{ marginTop: 10 }}>
                    <label>
                      {index + 1}. {q.question}
                      {p.answered.includes(index) ? '（已记录，可重新填写）' : ''}
                      <input
                        aria-label={'回答第 ' + (index + 1) + ' 题'}
                        style={{ display: 'block', width: '100%', marginTop: 5 }}
                        value={answers[p.id + ':' + index] ?? ''}
                        placeholder="选项序号或你的文字"
                        onChange={(e: any) =>
                          setAnswers((old) => ({ ...old, [p.id + ':' + index]: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      style={controlStyle}
                      disabled={busy || !answers[p.id + ':' + index]?.trim()}
                      onClick={() =>
                        void action('answer-interaction', {
                          id: p.id,
                          question: index + 1,
                          answer: answers[p.id + ':' + index]
                        })
                      }
                    >
                      提交本题
                    </button>
                  </div>
                ))
              )}
            </div>
          ))}
        </section>
      )}
      <form
        onSubmit={(e: any) => {
          e.preventDefault()
          void save()
        }}
      >
        <fieldset
          disabled={busy || !view?.installed || view?.componentEnabled === false}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <section
            className="px-card"
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}
          >
            <label>
              交给 DSH-PX 的 QQ 号
              <input
                aria-label="QQ 账号"
                inputMode="numeric"
                style={{ display: 'block', width: '100%', marginTop: 5 }}
                value={draft.accountId}
                onChange={(e: any) => change('accountId', e.target.value.trim())}
                placeholder="例如：机器人专用 QQ 号"
              />
            </label>
            <label>
              授权成员
              <input
                aria-label="授权成员"
                inputMode="numeric"
                style={{ display: 'block', width: '100%', marginTop: 5 }}
                value={owners}
                onChange={(e: any) => {
                  setOwners(e.target.value)
                  setDirty(true)
                }}
                placeholder="填写你的 QQ 号；多个号码用逗号分隔"
              />
              <span className="px-muted">
                其他人仍可交流，但不能执行本机任务或读取私有资料。群任务留在原群；私有资料需明确分享到该群，才可用于任务。
              </span>
            </label>
            <label>
              独立工作区
              <input
                aria-label="QQ 工作区"
                style={{ display: 'block', width: '100%', marginTop: 5 }}
                value={draft.workspace}
                onChange={(e: any) => change('workspace', e.target.value)}
                placeholder="选择或填写独立的本机工作目录"
              />
            </label>
            <div className="px-actions">
              {view?.suggestedWorkspace && (
                <button
                  type="button"
                  style={controlStyle}
                  onClick={() => change('workspace', view.suggestedWorkspace!)}
                >
                  使用建议目录
                </button>
              )}
              {!!view?.workspaces.length && (
                <select
                  aria-label="使用已有工作区"
                  style={{ minWidth: 0, maxWidth: '100%', flex: '1 1 180px' }}
                  value=""
                  onChange={(e: any) => change('workspace', e.target.value)}
                >
                  <option value="">使用已有工作区…</option>
                  {view.workspaces.map((w) => (
                    <option key={w.id} value={w.path}>
                      {w.path}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <label>
              固定人格
              <select
                aria-label="QQ 人格"
                style={{ display: 'block', width: '100%', marginTop: 5 }}
                value={draft.personaId}
                onChange={(e: any) => change('personaId', e.target.value)}
              >
                <option value="">请选择人格</option>
                {draft.personaId && view && !view.personas.some((p) => p.id === draft.personaId) && (
                  <option value={draft.personaId}>原人格已归档或不可用，请重新选择</option>
                )}
                {view?.personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <details>
              <summary>创建新人格</summary>
              <div className="px-actions">
                <input
                  aria-label="新人格名称"
                  value={personaName}
                  maxLength={60}
                  onChange={(e: any) => setPersonaName(e.target.value)}
                  placeholder="例如：项目助手"
                />
                <button
                  type="button"
                  style={controlStyle}
                  disabled={!personaName.trim()}
                  onClick={() => void createPersona()}
                >
                  创建并选中
                </button>
              </div>
              {feedback('persona')}
            </details>
            <label>
              公开介绍
              <textarea
                aria-label="QQ 公开介绍"
                maxLength={2000}
                rows={3}
                style={{ display: 'block', width: '100%', marginTop: 5, resize: 'vertical' }}
                value={draft.publicIntroduction}
                onChange={(e: any) => change('publicIntroduction', e.target.value)}
                placeholder="群聊和普通私聊可见的身份、语气与交流偏好；请勿填写私有资料。"
              />
            </label>
            <p className="px-muted">
              已开始的会话固定人格和公开介绍。修改默认值后，新会话使用新设置；现有会话保持原有身份。
            </p>
            <label>
              QQ 新会话默认模型
              <select
                aria-label="QQ 默认模型"
                style={{ display: 'block', width: '100%', marginTop: 5 }}
                value={modelValue}
                onFocus={() => {
                  if (!catalog && !catalogBusy) void models()
                }}
                onChange={(e: any) => {
                  if (!e.target.value) change('model', undefined)
                  else {
                    const [provider, model] = JSON.parse(e.target.value)
                    change('model', { provider, model })
                  }
                }}
              >
                <option value="">
                  跟随 DSH 默认
                  {catalog?.default ? ' · ' + catalog.default.provider + '/' + catalog.default.model : ''}
                </option>
                {draft.model && !selectedModel && (
                  <option value={modelValue}>
                    已保存：{draft.model.provider}/{draft.model.model}
                  </option>
                )}
                {catalog?.groups.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {g.models.map((m) => (
                      <option key={m.id} value={JSON.stringify([g.id, m.id])}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {!!selectedModel?.reasoning?.efforts.length && (
              <label>
                推理强度
                <select
                  aria-label="QQ 推理强度"
                  style={{ marginLeft: 8 }}
                  value={draft.model?.reasoningEffort ?? ''}
                  onChange={(e: any) => {
                    const next = { ...draft.model! }
                    if (e.target.value) next.reasoningEffort = e.target.value
                    else delete next.reasoningEffort
                    change('model', next)
                  }}
                >
                  <option value="">模型默认</option>
                  {draft.model?.reasoningEffort &&
                    !selectedModel.reasoning.efforts.some((v) => v.id === draft.model!.reasoningEffort) && (
                      <option value={draft.model.reasoningEffort}>
                        已保存：{draft.model.reasoningEffort}
                      </option>
                    )}
                  {selectedModel.reasoning.efforts.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="px-actions">
              <button type="button" style={controlStyle} disabled={catalogBusy} onClick={() => void models()}>
                {catalogBusy ? '正在读取模型…' : '刷新模型目录'}
              </button>
            </div>
            {catalogError && <p role="alert">{catalogError}</p>}
            {!!catalog?.failures?.length && (
              <p role="alert">
                部分模型目录未能读取：{catalog.failures.map((f) => f.name).join('、')}
                。请到“模型”设置检查后重试。
              </p>
            )}
            <p className="px-muted">
              这里只设置 QQ 后续新会话的模型，不改变 DSH 全局默认，也不替换已有会话的模型。
            </p>
          </section>
          <details className="px-card" open={!view?.credentialConfigured}>
            <summary>本机 QQ 桥与连接设置</summary>
            <p>
              先启动并登录 NapCat，启用本机 WebSocket 服务。该 QQ 号的普通电脑客户端需退出同账号，手机 QQ
              可以保留登录。
            </p>
            <p>
              <a href="https://napneko.github.io/guide/boot/Shell" target="_blank" rel="noreferrer">
                查看 NapCat 官方安装说明
              </a>
            </p>
            <label style={{ display: 'block', margin: '12px 0' }}>
              OneBot 地址
              <input
                aria-label="OneBot 地址"
                style={{ display: 'block', width: '100%', marginTop: 5 }}
                value={draft.endpoint}
                onChange={(e: any) => change('endpoint', e.target.value)}
              />
            </label>
            <label style={{ display: 'block', margin: '12px 0' }}>
              连接令牌
              <input
                aria-label="OneBot 连接令牌"
                type="password"
                autoComplete="new-password"
                style={{ display: 'block', width: '100%', marginTop: 5 }}
                value={secret}
                onChange={(e: any) => {
                  setSecret(e.target.value)
                  setDirty(true)
                }}
                placeholder={
                  view?.credentialConfigured ? '已配置；留空保留，填写新值替换' : '填写 OneBot 连接令牌'
                }
              />
            </label>
            <p className="px-muted">
              使用 OneBot 令牌，不是 NapCat WebUI 密码。仅连接本机服务，令牌由 DSH 原生凭据服务保存。
            </p>
          </details>
          <label style={{ display: 'block', margin: '16px 0' }}>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e: any) => change('enabled', e.target.checked)}
            />{' '}
            开启 QQ 接入
          </label>
          <div className="px-actions">
            <button type="submit" style={controlStyle} className="px-primary" disabled={!dirty}>
              保存设置
            </button>
            <button type="button" style={controlStyle} onClick={() => void reload()}>
              {dirty ? '放弃修改并重新加载' : '重新加载设置'}
            </button>
          </div>
        </fieldset>
      </form>
      {feedback('settings')}
      <details className="px-card">
        <summary>使用方法与范围</summary>
        <ol style={{ paddingLeft: 22, lineHeight: 1.9 }}>
          <li>准备并登录专用 QQ 桥，填写上面的账号、授权成员、独立工作区和人格。</li>
          <li>保存连接配置，点击“检查已保存的连接”，核对成功后开启接入并保存。</li>
          <li>点击“发测试消息给负责人”，再从你的 QQ 私聊回复一条消息，验证模型回答。</li>
          <li>
            群里 @ 它即可交流。负责人可直接私聊安排任务，或在群内用 <code>/task 内容</code>
            ；群任务结果留在原群，私有资料需明确分享。
          </li>
        </ol>
        <p>
          私聊和每个群分别保存上下文。公共聊天只用公开介绍和共享知识，不能访问人格私有记忆或其他聊天。负责人私聊可使用原生任务和工具权限。
        </p>
        <p>
          负责人命令：<code>/help</code>、<code>/new</code>、<code>/stop</code>、<code>/status</code>；群内用{' '}
          <code>/newtask</code> 新建任务会话。
        </p>
        <p>
          单个问题卡片可以直接回复选项或文字。工具审批或多个问题按 QQ 卡片中的编号使用 <code>/approve</code>、
          <code>/reject</code>、<code>/answer</code>
          ，也可以在本页“待处理请求”中操作。普通文字不会被误当成工具审批；未回答的请求可通过{' '}
          <code>/stop</code> 取消。
        </p>
        {view?.sessionModelSelection ? (
          <p>
            <code>/model</code> 选择同档模型；<code>/continue 提供商 模型</code>{' '}
            新建跨档接续会话，原会话保留。
          </p>
        ) : (
          <p className="px-muted">
            当前宿主尚未提供仅本会话的模型切换接口。QQ 模型切换与接续需先更新配套客户端。
          </p>
        )}
        <p className="px-muted">
          智能回复需要 DSH-PX 和 QQ 桥保持运行。普通账号通过第三方桥接，QQ 版本或登录验证变化可能影响连接。
        </p>
      </details>
    </div>
  )
}
export function apply(ctx: any): void {
  installUiStyles(ctx)
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({ name: 'settings.section', id: 'dsh-px-qq', order: 22, label: 'QQ 账号' }, () => (
      <QqSettingsPanel />
    ))
  )
}
