import { useEffect, useState } from 'react'
import { requestJson } from '../../shared/client-http'
import type { PersonaResources } from '../../shared/persona-resources'

type ResourceView = {
  personaId: string
  policy: PersonaResources | null
  tools: Array<{ name: string; description: string }>
}
const defaults = (): PersonaResources => ({
  revision: 0,
  tools: { mode: 'native', names: [] },
  channels: { mode: 'native', accounts: [] }
})

/** Human settings remain available even when every model tool is disabled. */
export function PersonaResourcesPanel({ personaId }: { personaId: string }) {
  const [view, setView] = useState<ResourceView | null>(null),
    [draft, setDraft] = useState(defaults),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [filter, setFilter] = useState(''),
    [accounts, setAccounts] = useState(''),
    [epoch, setEpoch] = useState(0)
  useEffect(() => {
    const ac = new AbortController()
    setView(null)
    setError('')
    setSaved(false)
    void requestJson<ResourceView>(
      `/dsh-px-personas?view=resources&personaId=${encodeURIComponent(personaId)}`,
      { signal: ac.signal }
    )
      .then((result) => {
        if (ac.signal.aborted) return
        setView(result)
        setDraft(result.policy ?? defaults())
        setAccounts(
          (result.policy?.channels.accounts ?? []).map((row) => `${row.provider}:${row.accountId}`).join('\n')
        )
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e.message)
      })
    return () => ac.abort()
  }, [personaId, epoch])
  const names = new Map((view?.tools ?? []).map((row) => [row.name, row.description]))
  for (const name of draft.tools.names)
    if (!names.has(name)) names.set(name, '当前未加载；保留配置，工具恢复后仍受此规则约束')
  return (
    <div className="px-card" style={{ marginTop: 12 }}>
      <p>
        控制此人格可以调用的工具。实际操作仍须通过会话权限、应用授权和聊天成员规则。收紧立即约束后续调用；新增授权从下一轮开始使用。正在执行的操作请用原生“停止”结束。
      </p>
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">资源规则已保存。</p>}
      {view ? (
        <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
          <label>
            工具范围{' '}
            <select
              aria-label="人格工具范围"
              value={draft.tools.mode}
              onChange={(e: any) => {
                setSaved(false)
                setDraft({ ...draft, tools: { ...draft.tools, mode: e.target.value } })
              }}
            >
              <option value="native">沿用原生会话可用工具</option>
              <option value="selected">只允许选中的工具</option>
            </select>
          </label>
          {draft.tools.mode === 'selected' && (
            <>
              <p className="px-muted">
                未选中任何工具时，只能对话。新插件的工具不会自动加入。允许终端、脚本或代理转发工具意味着允许其能力，不能据此宣称操作系统隔离。
              </p>
              <input
                aria-label="筛选人格工具"
                placeholder="筛选工具名称或说明"
                value={filter}
                onChange={(e: any) => setFilter(e.target.value)}
              />
              <div style={{ maxHeight: 280, overflow: 'auto' }}>
                {[...names]
                  .filter(([name, description]) =>
                    (name + description).toLowerCase().includes(filter.toLowerCase())
                  )
                  .map(([name, description]) => (
                    <label key={name} style={{ display: 'block', margin: '8px 0' }} title={description}>
                      <input
                        type="checkbox"
                        checked={draft.tools.names.includes(name)}
                        onChange={(e: any) => {
                          setSaved(false)
                          setDraft({
                            ...draft,
                            tools: {
                              ...draft.tools,
                              names: e.target.checked
                                ? [...draft.tools.names, name]
                                : draft.tools.names.filter((n) => n !== name)
                            }
                          })
                        }}
                      />{' '}
                      {name} <span className="px-muted">{description.slice(0, 80)}</span>
                    </label>
                  ))}
              </div>
            </>
          )}
          <div style={{ marginTop: 12 }}>
            <label>
              渠道账号范围{' '}
              <select
                aria-label="人格渠道账号范围"
                value={draft.channels.mode}
                onChange={(e: any) => {
                  setSaved(false)
                  setDraft({ ...draft, channels: { ...draft.channels, mode: e.target.value } })
                }}
              >
                <option value="native">沿用已配置的账号与聊天路由</option>
                <option value="selected">仅指定账号</option>
              </select>
            </label>
          </div>
          {draft.channels.mode === 'selected' && (
            <label style={{ display: 'block', marginTop: 8 }}>
              每行填写渠道:账号ID（如 qq:123456、feishu:bot_xxx）；留空禁用渠道账号{' '}
              <textarea
                aria-label="人格允许的渠道账号"
                rows={3}
                value={accounts}
                onChange={(e: any) => {
                  setAccounts(e.target.value)
                  setSaved(false)
                }}
              />
            </label>
          )}
          <p className="px-muted">
            账号规则约束已接入 PX
            的人格路由、通知与交付；填写账号不会自动建立连接。其他渠道仍由工具范围和原生配置控制。它不会断开其他人格共用的账号。
          </p>
          {draft.expiresAt && (
            <p>
              现有授权截止：{draft.expiresAt}。到期后停止授予工具和账号访问。
              <button
                onClick={() => {
                  const { expiresAt: _, ...next } = draft
                  setDraft(next)
                  setSaved(false)
                }}
              >
                移除到期时间
              </button>
            </p>
          )}
          <div className="px-actions">
            <button
              onClick={() => {
                setBusy(true)
                setError('')
                setSaved(false)
                const rows = accounts
                  .split(/\r?\n/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                if (rows.some((row) => !/^[a-z0-9-]{1,80}:[^\s]{1,200}$/.test(row))) {
                  setError('每行填写渠道:账号ID，例如 qq:123456 或 feishu:bot_xxx')
                  setBusy(false)
                  return
                }
                const policy = {
                  ...draft,
                  channels: {
                    ...draft.channels,
                    accounts: rows.map((row) => ({
                      provider: row.slice(0, row.indexOf(':')),
                      accountId: row.slice(row.indexOf(':') + 1)
                    }))
                  }
                }
                void requestJson<ResourceView>('/dsh-px-personas', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    type: 'resources',
                    personaId,
                    revision: view.policy?.revision ?? 0,
                    policy
                  })
                })
                  .then((result) => {
                    setView({ ...view, policy: result.policy })
                    setDraft(result.policy!)
                    setSaved(true)
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false))
              }}
            >
              保存资源规则
            </button>
            <button onClick={() => setEpoch((v) => v + 1)}>放弃草稿并重新读取</button>
          </div>
        </fieldset>
      ) : (
        !error && <p role="status">正在读取资源规则…</p>
      )}
    </div>
  )
}
