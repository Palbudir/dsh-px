export interface Snapshot<T> {
  getSnapshot: () => T
  subscribe: (cb: () => void) => () => void
}
export interface SessionRow {
  id: string
  displayTitle: string
  title?: string
  cwd?: string
  origin?: string
  parentId?: string
  blank?: boolean
  running: boolean
  completed?: boolean
}
export interface SessionList {
  current?: string
  phase: string
  ids: string[]
  byId: Record<string, SessionRow>
  jobsBySession: Record<string, unknown[]>
}
export interface Scope {
  sessionId: string
  cwd?: string
}
export interface Panel {
  scope: Scope
  visible: boolean
  tab: { meta?: { messageId?: string } }
}
export interface PanelCapabilities {
  sidebar?: Sidebar
  terminal?: {
    openTabIn: (sessionId: string, kind: string, options?: { revealIfOpened?: boolean }) => void
  }
  nativeTabs?: {
    get: (kind: string) => unknown
    subscribe: (cb: () => void) => () => void
  }
}
export interface Client {
  sessions: { list: Snapshot<SessionList>; scope: (id: string) => any; clear: () => void }
  uiWorkspace: { openSession: (id: string) => void; startSession: () => void }
  conversation: {
    input: {
      for: (ctx: any) => {
        state: Snapshot<{ draft: string; draftRev: number; phase: string }>
        notify: (level: 'info' | 'error', text: string) => void
      }
    }
  }
  capabilities: Snapshot<PanelCapabilities>
  inject: (services: string[], callback: (ctx: any) => void) => unknown
  slots: {
    inject: (name: string, fn: () => unknown) => unknown
    register: (entry: any, component: any) => unknown
  }
  effect: (fn: () => () => void, name?: string) => void
}
export interface Sidebar {
  registerTab: (tab: any) => () => void
  openTab: (seed: any, scope?: Scope) => void
  openFile: (scope: Scope, path: string, title?: string) => void
  isTabEnabled: (type: string) => boolean
  getTab: (type: string) => unknown
  subscribe: (cb: () => void) => () => void
  getSnapshot: () => unknown
  subscribeState: (cb: () => void) => () => void
}
