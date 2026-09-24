import type { Client, Panel } from './client/contracts'
import { css } from './client/styles'
import { requestQuote } from './client/data'
import { SessionBar } from './client/session-bar'
import { ArtifactsPanel } from './client/artifacts'
import { NotesPanel } from './client/notes'
import { SchedulesPanel } from './client/schedules'
import { installUiStyles, Icon } from '../../shared/ui'
import { createCapabilities } from '../../shared/client-capabilities'
export const inject = ['slots', 'sessions', 'uiWorkspace', 'conversation']
export function apply(raw: Omit<Client, 'capabilities'>): void {
  const capabilities = createCapabilities<ReturnType<Client['capabilities']['getSnapshot']>>({})
  const ctx: Client = {
    sessions: raw.sessions,
    uiWorkspace: raw.uiWorkspace,
    conversation: raw.conversation,
    slots: raw.slots,
    effect: raw.effect.bind(raw),
    inject: raw.inject.bind(raw),
    capabilities
  }
  installUiStyles(ctx)
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
  ctx.inject(['betterSidebar'], (host) => {
    const sidebar = host.betterSidebar
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
        (p: { sessionId: string; messageId: string }) => (
          <span className="px-ui">
            <button
              className="px-quote-action"
              title="引用或批注这条消息"
              onClick={() => {
                try {
                  requestQuote(p.sessionId, p.messageId)
                  sidebar.openTab(
                    { type: 'px-notes', meta: { messageId: p.messageId } },
                    { sessionId: p.sessionId }
                  )
                } catch (err) {
                  const scope = ctx.sessions.scope(p.sessionId)
                  if (scope)
                    ctx.conversation.input
                      .for(scope)
                      .notify('error', err instanceof Error ? err.message : String(err))
                }
              }}
            >
              <Icon name="note" />
              引用 / 批注
            </button>
          </span>
        )
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
  })
}
