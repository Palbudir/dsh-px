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
  'dsh-px-taskflow': 'jobs'
}
export function SessionBar({ ctx }: { ctx: Client }): unknown {
  const sessions = useSnapshot(ctx.sessions.list)
  const panelInfo = useSnapshot(ctx.layout?.panelInfo ?? defaultPanel)
  const capabilities = usePanelCapabilities(ctx)
  const [error, setError] = useState('')
  const bar = useRef<HTMLDivElement | null>(null)
  useEffect(() => (bar.current ? attachToolbarLayout(bar.current) : undefined), [])
  const current = selectedSession(sessions, panelInfo.activePanelId),
    row = current ? sessions.byId[current] : undefined
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
  return (
    <div ref={bar} className="px-ui px-bar" aria-label="DSH-PX 工作工具">
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
