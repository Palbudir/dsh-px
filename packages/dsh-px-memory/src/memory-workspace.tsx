import { useSyncExternalStore } from 'react'
import { selectedSession } from '../../shared/native-navigation'
import { memoryNavigation } from './workspace-navigation'

export function registerMemoryWorkspace(host: any, Panel: any) {
  const openSettings = () => {
    const navigation = host.get?.('pluginNavigation') ?? host.pluginNavigation
    if (!navigation?.openBundle) throw Error('原生插件配置入口尚未加载，请从左侧“插件”打开 Mnemon。')
    navigation.openBundle('dsh-mnemon')
  }
  const Main = () => {
    const sessions: any = useSyncExternalStore(host.sessions.list.subscribe, host.sessions.list.getSnapshot)
    const id = selectedSession(sessions, null)
    return (
      <div
        className="px-ui"
        style={{ height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}
      >
        <div className="px-actions" style={{ margin: '16px 20px 0', flexShrink: 0 }}>
          <button onClick={() => host.layout.selectPanel(null)}>返回会话</button>
          {id && <span className="px-muted">{sessions.byId[id]?.displayTitle ?? '当前会话'}</span>}
        </div>
        {id ? (
          <Panel
            key={id}
            sessionId={id}
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
  const navigation = memoryNavigation(host, Main, Icon)
  return {
    ...navigation,
    open: (id?: string) => {
      if (id) host.uiWorkspace.openSession(id)
      navigation.open()
    }
  }
}
