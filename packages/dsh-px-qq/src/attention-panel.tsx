import { useState } from 'react'
import { controlStyle } from '../../shared/ui'
import { requestJson } from '../../shared/client-http'
import type { QqAttentionMode, QqAttentionSettings } from './attention'

export interface AttentionSnapshot {
  accountId: string
  revision: number
  configured: QqAttentionSettings
  effective: QqAttentionSettings
  temporary: { until: number; reason: string } | null
  problem?: string
  observer?: { phase: string; reason?: string; error?: string }
  inbox: {
    items: Array<{
      chatId: string
      label?: string
      unread: number
      queued: number
      uncertain: number
      cancelled?: number
      preview: string
    }>
    nextOffset?: number
  }
}
const modes: Array<{ id: QqAttentionMode; name: string; description: string }> = [
  { id: 'focus', name: '专注聊天', description: '读各群和私聊，由它决定参与还是旁听。' },
  { id: 'normal', name: '普通', description: '处理私聊、@ 和关注的聊天，其余合并预览。' },
  { id: 'notifications', name: '仅通知', description: '先看通知和预览，需要时再打开聊天。' }
]
export function AttentionPanel({
  value,
  refresh
}: {
  value: AttentionSnapshot
  refresh: (snapshot: any) => void
}): unknown {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [pendingSettings, setPendingSettings] = useState<QqAttentionSettings | null>(null)
  const configured = pendingSettings ?? value.configured
  const [more, setMore] = useState<AttentionSnapshot['inbox']['items']>([])
  const [nextOffset, setNextOffset] = useState<number | undefined>(undefined)
  const rows = [
    ...value.inbox.items,
    ...more.filter((row) => !value.inbox.items.some((current) => current.chatId === row.chatId))
  ]
  const nextPage = more.length ? nextOffset : value.inbox.nextOffset
  async function save(settings: QqAttentionSettings) {
    if (busy) return
    setBusy(true)
    setPendingSettings(settings)
    setError('')
    try {
      refresh(
        await requestJson('/dsh-px-qq', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'attention',
            accountId: value.accountId,
            revision: value.revision,
            settings
          })
        })
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : '消息模式未保存')
    } finally {
      setPendingSettings(null)
      setBusy(false)
    }
  }
  const toggle = (key: 'focusedChats' | 'mutedChats', chat: string) => {
    const current = configured[key]
    void save({
      ...configured,
      [key]: current.includes(chat) ? current.filter((id) => id !== chat) : [...current, chat]
    })
  }
  async function observer(operation: 'stop' | 'retry') {
    setBusy(true)
    setError('')
    try {
      refresh(
        await requestJson('/dsh-px-qq', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'attention-observer', accountId: value.accountId, operation })
        })
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : '通知操作未完成')
    } finally {
      setBusy(false)
    }
  }
  async function loadMore() {
    if (nextPage === undefined || busy) return
    setBusy(true)
    setError('')
    try {
      const page = await requestJson<AttentionSnapshot['inbox']>('/dsh-px-qq', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'attention-page', accountId: value.accountId, offset: nextPage })
      })
      setMore((current) => [
        ...current,
        ...page.items.filter((row) => !current.some((old) => old.chatId === row.chatId))
      ])
      setNextOffset(page.nextOffset)
    } catch (error) {
      setError(error instanceof Error ? error.message : '聊天列表暂不可用')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="px-card" aria-label="QQ 消息模式">
      <h3>消息模式</h3>
      <p className="px-muted">
        {pendingSettings
          ? '正在应用消息设置…'
          : '切换只调整消息处理，已开始的任务继续。当前：' +
            modes.find((m) => m.id === value.effective.mode)?.name}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {modes.map((mode) => (
          <button
            key={mode.id}
            className={configured.mode === mode.id ? 'px-primary' : undefined}
            style={{
              ...controlStyle,
              flex: '1 1 160px',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              justifyContent: 'flex-start',
              gap: 4,
              padding: 10,
              color: configured.mode === mode.id ? 'var(--px-accent)' : 'var(--px-fg)'
            }}
            type="button"
            aria-pressed={configured.mode === mode.id}
            disabled={busy}
            onClick={() => void save({ ...configured, mode: mode.id })}
          >
            <strong style={{ whiteSpace: 'nowrap' }}>{mode.name}</strong>
            <span style={{ display: 'block', color: 'var(--px-muted)' }}>{mode.description}</span>
          </button>
        ))}
      </div>
      <p>
        <label>
          <input
            type="checkbox"
            checked={configured.allowAgentChanges}
            disabled={busy}
            onChange={(e: any) => void save({ ...configured, allowAgentChanges: e.target.checked })}
          />{' '}
          允许它临时管理关注、群提醒和模式（最多 30 分钟）
        </label>
      </p>
      {value.temporary && (
        <p role="status">
          临时调整至 {new Date(value.temporary.until).toLocaleTimeString()}：{value.temporary.reason}
          。重新选择模式会立即采用你的设置。
        </p>
      )}
      {['queued', 'running'].includes(value.observer?.phase ?? '') && (
        <p role="status">
          {value.observer?.phase === 'queued' ? '有新通知等待查看。' : '正在查看新通知…'}{' '}
          <button type="button" style={controlStyle} disabled={busy} onClick={() => void observer('stop')}>
            停止查看
          </button>
        </p>
      )}
      {value.observer?.phase === 'completed' && value.observer.reason && (
        <p className="px-muted">最近一次关注判断：{value.observer.reason}</p>
      )}
      {['failed', 'stopped'].includes(value.observer?.phase ?? '') && (
        <p>
          通知判断{value.observer?.phase === 'failed' ? '未完成' : '已停止'}，消息仍保留。{' '}
          <button type="button" style={controlStyle} disabled={busy} onClick={() => void observer('retry')}>
            重新查看通知
          </button>
        </p>
      )}
      <details>
        <summary>仅通知模式的提醒来源</summary>
        <p className="px-muted">
          由 PX 管理提醒，暂不自动同步 QQ 客户端设置。专注聊天或临时打开聊天时仍可阅读消息。
        </p>
        {(
          [
            ['notifyDirect', '私聊提醒'],
            ['notifyMentions', '@ 我的提醒'],
            ['notifyGroups', '其他群消息提醒'],
            ['mentionOverridesMute', '@ 我时穿透免打扰']
          ] as const
        ).map(([key, label]) => (
          <label key={key} style={{ display: 'block', margin: '8px 0' }}>
            <input
              type="checkbox"
              disabled={busy}
              checked={configured[key]}
              onChange={(e: any) => void save({ ...configured, [key]: e.target.checked })}
            />{' '}
            {label}
          </label>
        ))}
      </details>
      <details style={{ marginTop: 12 }}>
        <summary>聊天与未读消息 · 当前显示 {rows.length} 个聊天</summary>
        {!rows.length && <p className="px-muted">还没有收到消息。</p>}
        {rows.map((row) => (
          <div key={row.chatId} style={{ padding: '12px 0', borderBottom: '1px solid var(--px-border)' }}>
            <strong>
              {row.label ??
                (row.chatId.startsWith('group:')
                  ? '群聊 ' + row.chatId.slice(6)
                  : '私聊 ' + row.chatId.slice(8))}
            </strong>
            <span>
              {' '}
              · {row.unread} 条未处理{row.queued ? ' · ' + row.queued + ' 条已投递' : ''}
              {row.uncertain ? ' · ' + row.uncertain + ' 条需核对' : ''}
              {row.cancelled ? ' · ' + row.cancelled + ' 条已停止' : ''}
              {value.effective.mutedChats.includes(row.chatId) && !configured.mutedChats.includes(row.chatId)
                ? ' · 临时免打扰'
                : ''}
              {!value.effective.mutedChats.includes(row.chatId) && configured.mutedChats.includes(row.chatId)
                ? ' · 临时开启提醒'
                : ''}
            </span>
            <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{row.preview}</p>
            <label>
              <input
                type="checkbox"
                checked={configured.focusedChats.includes(row.chatId)}
                disabled={busy}
                onChange={() => toggle('focusedChats', row.chatId)}
              />{' '}
              关注（普通模式）
            </label>
            {'　'}
            <label>
              <input
                type="checkbox"
                checked={configured.mutedChats.includes(row.chatId)}
                disabled={busy}
                onChange={() => toggle('mutedChats', row.chatId)}
              />{' '}
              免打扰通知
            </label>
          </div>
        ))}
        {nextPage !== undefined && (
          <button type="button" style={controlStyle} disabled={busy} onClick={() => void loadMore()}>
            显示更多聊天
          </button>
        )}
      </details>
      {(error || value.problem) && <p role="alert">{error || value.problem}</p>}
    </section>
  )
}
