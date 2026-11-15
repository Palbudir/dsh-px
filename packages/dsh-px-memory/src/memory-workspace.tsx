import { useState, useSyncExternalStore } from 'react'
import { selectedSession } from '../../shared/native-navigation'
import { memoryNavigation, skillAnchorName, type SkillPageRequest } from './workspace-navigation'
import { PersonaHubPanel } from './persona-hub-panel'
import { catalogueCreatedSession } from './created-session-client'

export function registerMemoryWorkspace(host: any, Panel: any) {
  let stopped = false
  let requestedSkill: SkillPageRequest | undefined,
    requestSerial = 0
  const listeners = new Set<() => void>()
  const skillRequests = {
    getSnapshot: () => requestedSkill,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset: () => {
      if (!requestedSkill) return
      requestedSkill = undefined
      for (const listener of listeners) listener()
    }
  }
  const openSettings = () => {
    const navigation = host.get?.('pluginNavigation') ?? host.pluginNavigation
    if (!navigation?.openBundle) throw Error('原生插件配置入口尚未加载，请从左侧“插件”打开 Mnemon。')
    navigation.openBundle('dsh-mnemon')
  }
  const Main = () => {
    const sessions: any = useSyncExternalStore(host.sessions.list.subscribe, host.sessions.list.getSnapshot)
    const id = selectedSession(sessions, null)
    const skillRequest = useSyncExternalStore(skillRequests.subscribe, skillRequests.getSnapshot)
    const [hub, setHub] = useState(false)
    const directory = (hub && !skillRequest) || !id
    return (
      <div
        className="px-ui"
        style={{ height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}
      >
        <div className="px-actions" style={{ margin: '16px 20px 0', flexShrink: 0 }}>
          <button onClick={() => host.layout.selectPanel(null)}>返回会话</button>
          <button
            aria-pressed={directory}
            onClick={() => {
              skillRequests.reset()
              setHub(true)
            }}
          >
            人格与会话
          </button>
          {id && (
            <button
              aria-pressed={!directory}
              onClick={() => {
                skillRequests.reset()
                setHub(false)
              }}
            >
              当前人格资料
            </button>
          )}
          {id && <span className="px-muted">{sessions.byId[id]?.displayTitle ?? '当前会话'}</span>}
        </div>
        {directory ? (
          <PersonaHubPanel
            prepareCreatedSession={(target: string) => catalogueCreatedSession(host.sessions, target)}
            nativeNavigation={
              host.sessions.pxPersonaTransportVersion === 1 &&
              host.uiWorkspace.pxPersonaNavigationVersion === 1
            }
            currentSessionId={id ?? undefined}
            titles={sessions.byId}
            openSession={(target: string) => {
              host.uiWorkspace.openSession(target)
              setHub(false)
            }}
          />
        ) : id ? (
          <Panel
            prepareCreatedSession={(target: string) => catalogueCreatedSession(host.sessions, target)}
            key={id}
            sessionId={id}
            skillRequest={skillRequest?.sessionId === id ? skillRequest : undefined}
            visible={true}
            openSession={(target: string) => host.uiWorkspace.openSession(target)}
            openKnowledge={() => navigation.openNative()}
            openSettings={openSettings}
            openTasks={() => {
              host.uiWorkspace.openSession(id)
              host.sidebarRight.openTabIn(id, 'dsh-px-taskflow')
            }}
          />
        ) : (
          <div style={{ padding: 24 }}>
            <h2>记忆与知识</h2>
            <p>先从左侧打开一个会话，即可查看该人格的记忆、经历和项目知识。</p>
            <p className="px-muted">查看其他会话不会改变它绑定的人格，也不会自动启动任务。</p>
            <button onClick={openSettings}>高级：Mnemon 配置</button>
          </div>
        )}
      </div>
    )
  }
  const Icon = ({ size = 20 }: { size?: number }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15" />
    </svg>
  )
  const navigation = memoryNavigation(host, Main, Icon, undefined, {
    reset: skillRequests.reset
  })
  return {
    ...navigation,
    openSkill: (sessionId: string, name: string) => {
      if (stopped) return false
      const current = selectedSession(host.sessions.list.getSnapshot(), null)
      if (!skillAnchorName({ page: 'skills/library', seed: 'name:' + name, sessionId }, current)) return false
      requestedSkill = { serial: ++requestSerial, sessionId, name }
      for (const listener of listeners) listener()
      navigation.openSkillView()
      return true
    },
    open: (id?: string) => {
      if (id) host.uiWorkspace.openSession(id)
      navigation.open()
    },
    dispose: () => {
      stopped = true
      navigation.dispose()
      listeners.clear()
      requestedSkill = undefined
    }
  }
}
