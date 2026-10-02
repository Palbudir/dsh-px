import { useEffect, useRef, useState } from 'react'
import type { Client } from './contracts'
import { errorText, useSnapshot, quoteRequests } from './data'
import { closeTabState, visibleTabs } from './tab-state'
import { Icon } from '../../../shared/ui'
import { useSessionLayout } from './layout'
import { attachToolbarLayout, isTypingTarget } from './host-layout'
import { panelAvailability, usePanelCapabilities } from './panel-availability'
import { closeLastSession, selectedSession } from '../../../shared/native-navigation'

const panels = [
  ['editor', '文件', 'file'],
  ['terminal', '终端', 'terminal'],
  ['px-artifacts', '产物', 'artifact'],
  ['git', '文件变动', 'git'],
  ['dsh-px-taskflow', '执行记录', 'jobs'],
  ['subagent', '后台任务', 'jobs'],
  ['px-notes', '引用与批注', 'note'],
  ['px-schedules', '定时任务', 'schedule']
] as const
const emptyPanel = { activePanelId: null }
const defaultPanel = { getSnapshot: () => emptyPanel, subscribe: () => () => {} }
export function SessionBar({ ctx }: { ctx: Client }): unknown {
  const sessions = useSnapshot(ctx.sessions.list)
  const panelInfo = useSnapshot(ctx.layout?.panelInfo ?? defaultPanel)
  const capabilities = usePanelCapabilities(ctx)
  const layout = useSessionLayout()
  const { tabs, setTabs, ready } = layout
  const [error, setError] = useState('')
  const bar = useRef<HTMLDivElement | null>(null)
  useEffect(() => (bar.current ? attachToolbarLayout(bar.current) : undefined), [])
  const selected = useRef<HTMLButtonElement | null>(null)
  const current = selectedSession(sessions, panelInfo.activePanelId),
    row = current ? sessions.byId[current] : undefined
  // Child views belong to the native lineage; ordinary openSession cannot reopen them.
  const ordinaryCurrent = row?.origin === 'subagent' ? row.parentId : current
  const ids = visibleTabs(tabs)
  const label = (id: string): string => {
    const s = sessions.byId[id]
    return s?.blank
      ? `新会话${s.cwd ? ' · ' + s.cwd.split(/[\\/]/).filter(Boolean).pop() : ''}`
      : (s?.title ??
          tabs.titles[id] ??
          s?.displayTitle ??
          (sessions.phase === 'pending' ? '加载会话…' : '会话不可用'))
  }
  useEffect(() => {
    if (
      !ready ||
      !ordinaryCurrent ||
      !sessions.byId[ordinaryCurrent] ||
      sessions.byId[ordinaryCurrent].origin === 'subagent'
    )
      return
    setTabs((old) =>
      old.ids.includes(ordinaryCurrent)
        ? old
        : {
            ...old,
            ids: [...old.ids, ordinaryCurrent],
            closed: old.closed.filter((id) => id !== ordinaryCurrent)
          }
    )
  }, [ordinaryCurrent, sessions.phase, ready])
  useEffect(() => {
    setTabs((old) => {
      const titles = { ...old.titles }
      let changed = false
      for (const id of [...old.ids, ...old.closed])
        if (sessions.byId[id]) {
          const s = sessions.byId[id]
          const title = (s.blank ? label(id) : (s.title ?? titles[id] ?? s.displayTitle)).slice(0, 160)
          if (title !== titles[id]) {
            titles[id] = title
            changed = true
          }
        }
      return changed ? { ...old, titles } : old
    })
  }, [sessions])
  useEffect(() => {
    selected.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [ordinaryCurrent, tabs.ids.length])
  const open = (id: string, focus = false): void => {
    try {
      ctx.uiWorkspace.openSession(id)
      setError('')
      if (focus) requestAnimationFrame(() => selected.current?.focus())
    } catch (e) {
      setError(errorText(e))
    }
  }
  const close = (id: string): void => {
    quoteRequests.consume(id)
    const result = closeTabState(
      tabs,
      id,
      Object.keys(sessions.byId).filter((id) => sessions.byId[id].origin !== 'subagent')
    )
    setTabs(result.tabs)
    if (id === ordinaryCurrent) {
      if (result.next) open(result.next)
      else closeLastSession(ctx)
    }
  }
  const reopen = (): void => {
    const id = tabs.closed.find((id) => sessions.byId[id]?.origin !== 'subagent' && sessions.byId[id])
    if (id) open(id)
  }
  const cycle = (direction: number, focus = false): void => {
    const available = ids.filter((id) => sessions.byId[id] && sessions.byId[id].origin !== 'subagent'),
      index = available.indexOf(ordinaryCurrent ?? '')
    if (available.length) open(available[(index + direction + available.length) % available.length], focus)
  }
  useEffect(() => {
    const keydown = (e: KeyboardEvent): void => {
      if (
        e.defaultPrevented ||
        isTypingTarget(e.target) ||
        e.isComposing ||
        !e.ctrlKey ||
        !e.altKey ||
        document.querySelector('[role=dialog],[role=alertdialog]')
      )
        return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        cycle(e.key === 'ArrowRight' ? 1 : -1)
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault()
        reopen()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [tabs, current, sessions])
  const panel = (type: string): void => {
    if (!current) return
    try {
      const live = ctx.capabilities.getSnapshot()
      const availability = panelAvailability(live, type)
      if (!availability.enabled) {
        setError(availability.reason)
        return
      }
      if (type === 'terminal') live.terminal!.openTabIn(current, 'terminal', { revealIfOpened: true })
      else live.sidebar!.openTab({ type }, { sessionId: current, cwd: row?.cwd })
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }
  const panelStates = panels.map(([type, text, icon]) => ({
    type,
    text,
    icon,
    ...panelAvailability(capabilities, type)
  }))
  const missingPanels = panelStates.filter((panel) => panel.state === 'missing' || panel.state === 'unknown')
  return (
    <div ref={bar} className="px-ui px-bar" aria-label="DSH-PX 会话工作区">
      <div className="px-tabs">
        <strong className="px-brand">DSH-PX</strong>
        <div className="px-tabstrip" role="tablist" aria-label="已打开会话">
          {ids.map((id) => {
            const active = id === ordinaryCurrent
            return (
              <div className="px-tab" key={id} data-active={active}>
                <button
                  role="tab"
                  ref={active ? selected : undefined}
                  tabIndex={active || (!ordinaryCurrent && id === ids[0]) ? 0 : -1}
                  aria-selected={active}
                  data-session-id={id}
                  disabled={!sessions.byId[id] || sessions.byId[id].origin === 'subagent'}
                  title={`${label(id)} · Ctrl+Alt+方向键切换`}
                  onClick={() => open(id)}
                  onKeyDown={(e: any) => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                      e.preventDefault()
                      cycle(e.key === 'ArrowRight' ? 1 : -1, true)
                    } else if (e.key === 'Home' || e.key === 'End') {
                      e.preventDefault()
                      const available = ids.filter(
                        (id) => sessions.byId[id] && sessions.byId[id].origin !== 'subagent'
                      )
                      const next = e.key === 'Home' ? available[0] : available[available.length - 1]
                      if (next) open(next, true)
                    }
                  }}
                >
                  <span
                    className={`px-session-dot${sessions.byId[id]?.running ? ' is-running' : sessions.byId[id]?.completed ? ' is-done' : ''}`}
                    aria-hidden="true"
                  />
                  <span className="px-tab-title">{label(id)}</span>
                </button>
                <button
                  className="px-tab-action"
                  title={tabs.pins.includes(id) ? '取消固定' : '固定标签'}
                  aria-label={`${tabs.pins.includes(id) ? '取消固定' : '固定'} ${label(id)}`}
                  aria-pressed={tabs.pins.includes(id)}
                  disabled={!ready}
                  onClick={() =>
                    setTabs((old) => ({
                      ...old,
                      pins: old.pins.includes(id) ? old.pins.filter((x) => x !== id) : [...old.pins, id]
                    }))
                  }
                >
                  <Icon name="pin" />
                </button>
                <button
                  className="px-tab-action"
                  title="关闭标签（任务继续运行，未保存草稿保留在此窗口）"
                  disabled={!ready}
                  aria-label={`关闭标签 ${label(id)}`}
                  onClick={() => close(id)}
                >
                  <Icon name="close" />
                </button>
              </div>
            )
          })}
        </div>
        <button onClick={() => ctx.uiWorkspace.startSession()} title="在当前工作区新建会话">
          <Icon name="plus" />
          新会话
        </button>
        <select aria-label="打开已有会话" value="" onChange={(e: any) => open(e.target.value)}>
          <option value="">打开会话…</option>
          {sessions.ids
            .filter((id) => sessions.byId[id]?.origin !== 'subagent')
            .map((id) => (
              <option key={id} value={id}>
                {label(id)}
              </option>
            ))}
        </select>
        <button
          className="px-restore"
          aria-label="恢复最近关闭的会话"
          disabled={!tabs.closed.some((id) => sessions.byId[id])}
          onClick={reopen}
          title="恢复最近关闭 · Ctrl+Alt+T"
        >
          <Icon name="restore" />
        </button>
      </div>
      <div className="px-tools">
        {panelStates.map(({ type, text, icon, enabled, reason }) => (
          <button
            key={type}
            disabled={!current || !enabled}
            title={!current ? '请先选择或新建会话' : enabled ? text : `${text}不可用：${reason}`}
            onClick={() => panel(type)}
          >
            <Icon name={icon} />
            {text}
          </button>
        ))}
        <span className="px-status">
          {current
            ? row?.origin === 'subagent'
              ? '正在查看子 Agent · 返回上级可继续任务'
              : row?.running
                ? 'Agent 执行中'
                : '可继续对话'
            : '选择或新建会话开始'}
        </span>
      </div>
      {missingPanels.length ? (
        <div role="status" className="px-dependency-warning">
          暂不可用的面板：{missingPanels.map((panel) => panel.text).join('、')}
          。可在“插件”设置中检查是否启用，或到“运行与帮助”查看依赖；会话仍可使用。
        </div>
      ) : null}
      {layout.warning ? (
        <div className="px-bar-error" role="alert">
          {layout.warning}
          <button onClick={() => void layout.restore()}>恢复服务布局</button>
          <button onClick={() => void layout.keepCurrent()}>
            {layout.conflict ? '保存此窗口布局' : '重试保存布局'}
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="px-bar-error" role="alert">
          {error}
          <button aria-label="关闭提示" onClick={() => setError('')}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
