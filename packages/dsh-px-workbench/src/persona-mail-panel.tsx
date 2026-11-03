import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../shared/client-http'
import type { PersonaMailRelation } from '../../shared/persona-mail-policy'
import type { SubjectAudience } from '../../shared/subject-context'

interface MailView {
  revision: string
  relations: PersonaMailRelation[]
  componentEnabled: boolean
  personas: Array<{ id: string; name: string }>
  audiences: SubjectAudience[]
  active: number
  unreleased: string[]
  records: Array<{
    mailId: string
    from: string
    to: string
    delivery: string
    detail?: string
    sourceSessionId: string
    jobId: string
  }>
}
const audienceName = (a: SubjectAudience) =>
  a.channel
    ? `${a.channel.provider} · ${a.channel.accountId} · ${a.channel.conversationId}${a.kind === 'personal' ? '（本人私聊）' : ''}`
    : '本机私人会话'
const states: Record<string, string> = {
  prepared: '正在投递',
  admitted: '已接收，等待回复',
  replied: '已有回复',
  closed: '通信结束',
  uncertain: '投递结果待核对'
}

export function PersonaMailPanel() {
  const [view, setView] = useState<MailView | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<{ revision: string; relations: PersonaMailRelation[] } | null>(null),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [audience, setAudience] = useState(''),
    [expiry, setExpiry] = useState('')
  const alive = useRef(true)
  const refresh = async () => {
    const next = await requestJson<MailView>('/dsh-px-persona-mail')
    if (alive.current) setView(next)
  }
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  useEffect(() => {
    alive.current = true
    void run(refresh)
    return () => {
      alive.current = false
    }
  }, [])
  const name = (id: string) => view?.personas.find((p) => p.id === id)?.name ?? id
  const change = (relations: PersonaMailRelation[]) =>
    setDraft({ revision: draft?.revision ?? view!.revision, relations })
  const rows = draft?.relations ?? view?.relations ?? []
  const save = () =>
    run(async () => {
      if (!draft) return
      await requestJson('/dsh-px-persona-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'save', ...draft })
      })
      if (alive.current) setDraft(null)
      await refresh()
    })
  return (
    <section className="px-card" aria-label="人格通信">
      <h3>人格通信</h3>
      <p>
        允许一个人格向另一个人格交流指定内容。双方的私人会话、记忆与技能仍然分开；回复通过原生后台作业返回，不代替任务完成。
      </p>
      {error && (
        <p role="alert">
          {error}
          {draft ? '；草稿保留，请先核对后再刷新重改。' : ''}
        </p>
      )}
      {!view ? (
        <p>尚未读取到通信设置。</p>
      ) : (
        <>
          {!view.componentEnabled && <p role="status">渠道配置项已停用，通信授权暂不生效。</p>}
          <p className="px-muted">{view.active} 项通信进行中。默认没有通信关系；新增关系需保存后生效。</p>
          {view.unreleased.length > 0 && <p role="alert">接收会话尚未完成清理，已暂停新通信。</p>}
          <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label>
                发件人格{' '}
                <select aria-label="发件人格" value={from} onChange={(e: any) => setFrom(e.target.value)}>
                  <option value="">选择人格</option>
                  {view.personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                收件人格{' '}
                <select aria-label="收件人格" value={to} onChange={(e: any) => setTo(e.target.value)}>
                  <option value="">选择人格</option>
                  {view.personas
                    .filter((p) => p.id !== from)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                来源场合{' '}
                <select
                  aria-label="通信来源场合"
                  value={audience}
                  onChange={(e: any) => setAudience(e.target.value)}
                >
                  <option value="">选择场合</option>
                  {view.audiences.map((a) => (
                    <option key={JSON.stringify(a)} value={JSON.stringify(a)}>
                      {audienceName(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                截止时间（可选）{' '}
                <input
                  type="datetime-local"
                  aria-label="通信授权截止时间"
                  value={expiry}
                  onChange={(e: any) => setExpiry(e.target.value)}
                />
              </label>
              <button
                disabled={!from || !to || from === to || !audience}
                onClick={() => {
                  if (
                    rows.some(
                      (r) => r.from === from && r.to === to && JSON.stringify(r.audience) === audience
                    )
                  ) {
                    setError('此方向与场合已有通信关系')
                    return
                  }
                  change([
                    ...rows,
                    {
                      id: crypto.randomUUID(),
                      from,
                      to,
                      audience: JSON.parse(audience),
                      ...(expiry ? { expiresAt: new Date(expiry).toISOString() } : {})
                    }
                  ])
                }}
              >
                添加关系
              </button>
            </div>
            {rows.length === 0 ? (
              <p>尚未允许人格间通信。</p>
            ) : (
              <ul>
                {rows.map((row) => (
                  <li key={row.id}>
                    {name(row.from)} → {name(row.to)} · {audienceName(row.audience)}
                    {row.expiresAt ? ` · 截止 ${new Date(row.expiresAt).toLocaleString()}` : ''}{' '}
                    <button onClick={() => change(rows.filter((r) => r.id !== row.id))}>撤销关系</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="px-actions">
              <button disabled={!draft} onClick={() => void save()}>
                保存通信关系
              </button>
              <button
                disabled={!draft}
                onClick={() => {
                  setDraft(null)
                  void run(refresh)
                }}
              >
                放弃草稿
              </button>
              <button onClick={() => void run(refresh)}>刷新通信状态</button>
            </div>
          </fieldset>
          {draft && (
            <p role="status">关系修改尚未保存。刷新状态不会覆盖草稿；其他窗口的修改会使旧草稿保存失败。</p>
          )}
          {view.records.length > 0 && (
            <details>
              <summary>最近通信（最多 30 项）</summary>
              <ul>
                {view.records.map((row) => (
                  <li key={row.mailId}>
                    {name(row.from)} → {name(row.to)} · {states[row.delivery] ?? row.delivery} · {row.jobId}
                    {row.detail && <p>{row.detail}</p>}
                  </li>
                ))}
              </ul>
              <p className="px-muted">这里只记录投递与回复；工作是否完成，以来源会话的原生作业和目标为准。</p>
            </details>
          )}
        </>
      )}
    </section>
  )
}
