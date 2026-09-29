import { createNativeSidebar } from '../../shared/native-sidebar'
import type { Client, Panel } from './client/contracts'
import { css } from './client/styles'
import { QuoteAction } from './client/quote-action'
import { SessionBar } from './client/session-bar'
import { ArtifactsPanel } from './client/artifacts'
import { NotesPanel } from './client/notes'
import { SchedulesPanel } from './client/schedules'
import { installUiStyles, Icon } from '../../shared/ui'
import { createCapabilities } from '../../shared/client-capabilities'
export const inject = ['slots', 'sessions', 'uiWorkspace', 'conversation', 'layout']
export function apply(raw: Omit<Client, 'capabilities'>): void {
  const capabilities = createCapabilities<ReturnType<Client['capabilities']['getSnapshot']>>({})
  const ctx: Client = {
    sessions: raw.sessions,
    layout: raw.layout,
    uiWorkspace: raw.uiWorkspace,
    conversation: raw.conversation,
    slots: raw.slots,
    effect: raw.effect.bind(raw),
    inject: raw.inject.bind(raw),
    capabilities
  }
  installUiStyles(ctx)
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: 'px-session-home' }, () => (
      <section className="px-ui px-panel">
        <h2>会话已关闭</h2>
        <p>任务和会话记录仍会保留。可以重新打开会话，或开始新任务。</p>
        <button onClick={() => ctx.uiWorkspace.startSession()}>开始新任务</button>
      </section>
    ))
  )
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    return () => style.remove()
  }, 'workspace: layout')
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-px-workspace', order: 0, registrant: 'dsh-px-workspace' },
      () => <SessionBar ctx={ctx} />
    )
  )
  ctx.inject(['sidebarRight'], (host) => {
    const terminal = host.sidebarRight
    capabilities.set({ terminal })
    host.effect(
      () => () => {
        if (capabilities.getSnapshot().terminal === terminal) capabilities.set({ terminal: undefined })
      },
      'workspace: terminal capability'
    )
  })
  ctx.inject(['sidebarRightTabs'], (host) => {
    const nativeTabs = host.sidebarRightTabs
    capabilities.set({ nativeTabs })
    host.effect(
      () => () => {
        if (capabilities.getSnapshot().nativeTabs === nativeTabs) capabilities.set({ nativeTabs: undefined })
      },
      'workspace: native panel registry'
    )
  })
  const mountPanels = (host: any, sidebar: import('./client/contracts').Sidebar): void => {
    capabilities.set({ sidebar })
    host.effect(
      () => () => {
        if (capabilities.getSnapshot().sidebar === sidebar) capabilities.set({ sidebar: undefined })
      },
      'workspace: sidebar capability'
    )
    host.slots.inject('conversation.chat.assistant-actions', () =>
      host.slots.register(
        {
          name: 'conversation.chat.assistant-actions',
          id: 'dsh-px-quote',
          order: 95,
          registrant: 'dsh-px-workspace'
        },
        (p: { sessionId: string; messageId: string }) => <QuoteAction {...p} ctx={ctx} />
      )
    )
    for (const [id, title, component, icon] of [
      ['px-artifacts', '产物', ArtifactsPanel, 'artifact'],
      ['px-notes', '引用与批注', NotesPanel, 'note'],
      ['px-schedules', '定时任务', SchedulesPanel, 'schedule']
    ] as const)
      host.effect(
        () =>
          sidebar.registerTab({
            id,
            title,
            order: 16,
            single: true,
            icon: <Icon name={icon} />,
            component: (p: Panel) => {
              const Component = component
              return <Component key={p.scope.sessionId} {...p} ctx={ctx} />
            }
          }),
        `workspace: ${id}`
      )
  }
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (host) => {
    if (typeof host.sidebarRightTabs.entries === 'function') mountPanels(host, createNativeSidebar(host))
  })
}
