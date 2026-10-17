import { useEffect, useRef, useState } from 'react'
import type { Client } from './contracts'
import { errorText, useSnapshot } from './data'
import { Icon } from '../../../shared/ui'
import { attachToolbarLayout } from './host-layout'
import { panelAvailability, usePanelCapabilities } from './panel-availability'
import { selectedSession } from '../../../shared/native-navigation'

const panels = [
  ['editor', '文件', 'file'],
  ['terminal', '终端', 'terminal'],
  ['git', '文件变动', 'git'],
  ['subagent', '后台任务', 'jobs']
] as const
const emptyPanel = { activePanelId: null }
const defaultPanel = { getSnapshot: () => emptyPanel, subscribe: () => () => {} }
const featureIcons: Record<string, string> = {
  'px-artifacts': 'artifact',
  'px-notes': 'note',
  'px-schedules': 'schedule',
  'dsh-px-taskflow': 'ledger',
  'dsh-px-memory': 'persona',
  'dsh-px-computer': 'computer'
}
export function SessionBar({ ctx }: { ctx: Client }): unknown {
  const sessions = useSnapshot(ctx.sessions.list)
  const panelInfo = useSnapshot(ctx.layout?.panelInfo ?? defaultPanel)
  const capabilities = usePanelCapabilities(ctx)
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)
  const bar = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const popup = useRef<HTMLDivElement | null>(null)
  const current = selectedSession(sessions, panelInfo.activePanelId),
    row = current ? sessions.byId[current] : undefined
  const shown = !!current && panelInfo.activePanelId === null
  useEffect(() => (shown && bar.current ? attachToolbarLayout(bar.current) : undefined), [shown])
  useEffect(() => {
    setError('')
    setMore(false)
  }, [current, shown])
  useEffect(() => {
    if (!more) return
    popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismiss = (event: PointerEvent): void => {
      if (event.target instanceof Node && !bar.current?.contains(event.target)) setMore(false)
    }
    window.addEventListener('pointerdown', dismiss, true)
    return () => window.removeEventListener('pointerdown', dismiss, true)
  }, [more])
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
      setMore(false)
    } catch (e) {
      setError(errorText(e))
    }
  }
  // Feature-owned native tab registrations supply the optional actions and their titles.
  const entries = capabilities.sidebar?.getSnapshot()
  const optional: Array<readonly [string, string, string]> = []
  if (Array.isArray(entries))
    for (const entry of entries) {
      const kind = entry.kind ?? entry.id
      if (typeof kind !== 'string' || !/^px-|^dsh-px-/.test(kind)) continue
      const title = entry.title ?? entry.guide?.[0]?.title
      if (typeof title !== 'function') continue
      const label = title()
      if (typeof label === 'string') optional.push([kind, label, featureIcons[kind] ?? 'artifact'])
    }
  const panelStates = [...panels, ...optional].map(([type, text, icon]) => ({
    type,
    text,
    icon,
    ...panelAvailability(capabilities, type)
  }))
  const missingPanels = panelStates.filter((panel) => panel.state === 'missing' || panel.state === 'unknown')
  const primary = ['editor', 'dsh-px-taskflow']
  const primaryPanels = primary.flatMap((type) => panelStates.filter((p) => p.type === type))
  const secondaryPanels = panelStates.filter((p) => !primary.includes(p.type))
  const groups = [
    { label: '工作区', types: ['terminal', 'git', 'px-artifacts'] },
    { label: '会话', types: ['subagent', 'px-notes', 'px-schedules'] },
    { label: '能力', types: ['dsh-px-memory', 'dsh-px-computer'] }
  ]
  const known = groups.flatMap((group) => group.types)
  groups.push({
    label: '其他',
    types: secondaryPanels.filter((p) => !known.includes(p.type)).map((p) => p.type)
  })
  if (!shown) return null
  const action = ({ type, text, icon, enabled, reason }: (typeof panelStates)[number]) => (
    <button
      key={type}
      disabled={!enabled}
      title={enabled ? text : `${text}不可用：${reason}`}
      onClick={() => panel(type)}
    >
      <Icon name={icon} />
      {text}
    </button>
  )
  return (
    <div
      ref={bar}
      className="px-ui px-bar"
      aria-label="DSH-PX 工作工具"
      onKeyDown={(event: any) => {
        if (event.key === 'Escape' && more) {
          event.stopPropagation()
          setMore(false)
          trigger.current?.focus()
        }
      }}
      onBlur={(event: any) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setMore(false)
      }}
    >
      <div className="px-tools">
        {primaryPanels.map(action)}
        {secondaryPanels.length > 0 && (
          <button
            ref={trigger}
            aria-expanded={more}
            aria-controls="px-more-tools"
            onClick={() => setMore(!more)}
          >
            工具{more ? ' ▴' : ' ▾'}
          </button>
        )}
        {(row?.running || row?.origin === 'subagent') && (
          <span className="px-status">{row?.running ? 'Agent 执行中' : '正在查看子 Agent'}</span>
        )}
      </div>
      {more && (
        <div ref={popup} id="px-more-tools" className="px-tool-popup" aria-label="工作工具">
          {groups.map(({ label, types }) => {
            const items = types.flatMap((type) => secondaryPanels.filter((p) => p.type === type))
            return items.length ? (
              <div key={label} className="px-tool-group" role="group" aria-label={label}>
                <div className="px-tool-heading" aria-hidden="true">
                  {label}
                </div>
                {items.map(action)}
              </div>
            ) : null
          })}
          {missingPanels.length > 0 && (
            <div role="status" className="px-dependency-warning">
              暂不可用：{missingPanels.map((panel) => panel.text).join('、')}
              。请在插件设置或“运行与帮助”中检查。
            </div>
          )}
        </div>
      )}
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
