import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../shared/client-http'
import type { ChannelAccount } from './channel-settings'

export function ChannelRoutesPanel({
  account,
  revision,
  personas,
  chats,
  onSaved
}: {
  account: ChannelAccount
  revision: string
  personas: Array<{ id: string; name: string }>
  chats: Array<{ conversationId: string; kind: string }>
  onSaved: () => Promise<void>
}) {
  const [selected, setSelected] = useState(''),
    [draft, setDraft] = useState<{
      chat: string
      persona: string
      revision: string
      restart: boolean
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const route = account.routes?.find((row) => row.conversationId === selected)
  const currentPersona = route?.personaId ?? account.personaId
  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      await requestJson('/dsh-px-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'change-route',
          revision: draft.revision,
          accountId: account.accountId,
          conversationId: draft.chat,
          personaId: draft.persona || null,
          restart: draft.restart,
          stopPending: true
        })
      })
      if (alive.current) setDraft(null)
      try {
        await onSaved()
      } catch {
        if (alive.current) setError('设置已保存，状态暂未刷新；请刷新查看。')
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '更改未完成')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <details className="px-card">
      <summary>聊天与人格</summary>
      <p>可为每个聊天选择人格。更改后新建会话，原会话不重新绑定，私有记忆不复制；其他聊天保持原状。</p>
      {error && <p role="alert">{error}</p>}
      <label>
        已识别的聊天
        <select
          aria-label="选择人格路由的聊天"
          disabled={busy || !!draft}
          value={selected}
          onChange={(e: any) => {
            setSelected(e.target.value)
            setError('')
          }}
        >
          <option value="">选择聊天</option>
          {chats.map((chat) => (
            <option key={chat.conversationId} value={chat.conversationId}>
              {chat.kind === 'group' ? '群聊' : chat.kind === 'direct' ? '私聊' : '聊天'} ·{' '}
              {chat.conversationId}
            </option>
          ))}
        </select>
      </label>
      {selected && !draft && (
        <div>
          <p>
            当前人格：{personas.find((p) => p.id === currentPersona)?.name ?? currentPersona}
            {route?.personaId ? '' : '（使用账号默认）'}
          </p>
          <button
            onClick={() =>
              setDraft({ chat: selected, persona: route?.personaId ?? '', revision, restart: false })
            }
          >
            更改或新建会话
          </button>
        </div>
      )}
      {draft && (
        <fieldset disabled={busy}>
          <legend>此聊天的后续消息</legend>
          <label>
            接收人格
            <select
              aria-label="聊天接收人格"
              value={draft.persona}
              onChange={(e: any) => setDraft({ ...draft, persona: e.target.value })}
            >
              <option value="">使用账号默认人格</option>
              {personas.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.restart}
              onChange={(e: any) => setDraft({ ...draft, restart: e.target.checked })}
            />
            同一人格也新建会话
          </label>
          <p>
            先结束或停止此聊天正在执行的任务。应用后停止旧路由尚未投入的输入；结果不明的记录仍待核对，不自动重新执行。
          </p>
          <div className="px-actions">
            <button onClick={() => void save()}>停止旧输入并应用</button>
            <button onClick={() => setDraft(null)}>取消</button>
          </div>
        </fieldset>
      )}
      {!chats.length && <p className="px-muted">收到此账号的消息后，可在这里选择已识别的聊天。</p>}
    </details>
  )
}
