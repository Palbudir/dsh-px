import { nativeFileAddress } from './native-navigation'
/** Adapter for the public DSH 0.2 sidebar registry; business panels keep their session-scoped props. */
export interface NativePanelProps {
  sessionId: string
  useTabInfo: () => { tab: { visible: boolean; navigation: { params?: { messageId?: string } } } }
}
export interface NativeSidebarHost {
  sidebarRight: {
    openTabIn: (sessionId: string, kind: string, options?: { params?: unknown }) => void
    openResourceIn: (sessionId: string, address: string) => void
  }
  sidebarRightTabs: {
    register: (definition: {
      id: string
      kind: string
      title: () => string
      guide: Array<{ id: string; order: number; title: () => string }>
    }) => () => void
    get: (kind: string) => unknown
    entries: () => readonly unknown[]
    subscribe: (listener: () => void) => () => void
  }
  slots: {
    inject: (name: string, register: () => unknown) => unknown
    register: (
      entry: { name: string; key: string },
      component: (props: NativePanelProps) => unknown
    ) => unknown
  }
  effect: (register: () => () => void, label: string) => void
}
interface PanelDefinition {
  id: string
  title: string
  order?: number
  component: (props: {
    scope: { sessionId: string }
    visible: boolean
    tab: { meta?: { messageId?: string } }
  }) => unknown
}
const nativeKind = (type: string): string => (type === 'editor' ? 'files' : type)

export function createNativeSidebar(host: NativeSidebarHost) {
  const registry = host.sidebarRightTabs
  return {
    registerTab(definition: PanelDefinition): () => void {
      const off = registry.register({
        id: definition.id,
        kind: definition.id,
        title: () => definition.title,
        guide: [
          { id: definition.id + '-guide', order: definition.order ?? 50, title: () => definition.title }
        ]
      })
      host.slots.inject('sidebar.right.pane.tab', () =>
        host.slots.register({ name: 'sidebar.right.pane.tab', key: definition.id }, (props) => {
          const info = props.useTabInfo()
          const Component = definition.component
          return (
            <Component
              scope={{ sessionId: props.sessionId }}
              visible={info.tab.visible}
              tab={{ meta: info.tab.navigation.params }}
            />
          )
        })
      )
      return off
    },
    openTab(seed: { type: string; meta?: unknown }, scope?: { sessionId: string }): void {
      if (!scope?.sessionId) throw new Error('请先选择会话')
      host.sidebarRight.openTabIn(scope.sessionId, nativeKind(seed.type), { params: seed.meta })
    },
    openFile(scope: { sessionId: string }, path: string): void {
      host.sidebarRight.openResourceIn(scope.sessionId, nativeFileAddress(scope.sessionId, path))
    },
    isTabEnabled: (type: string): boolean => !!registry.get(nativeKind(type)),
    getTab: (type: string): unknown => registry.get(nativeKind(type)),
    subscribe: (listener: () => void): (() => void) => registry.subscribe(listener),
    getSnapshot: (): readonly unknown[] => registry.entries(),
    subscribeState: (listener: () => void): (() => void) => registry.subscribe(listener)
  }
}
