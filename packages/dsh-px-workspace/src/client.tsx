import type { Client, Panel } from './client/contracts'
import { css } from './client/styles'
import { requestQuote } from './client/data'
import { SessionBar } from './client/session-bar'
import { ArtifactsPanel } from './client/artifacts'
import { NotesPanel } from './client/notes'
import { SchedulesPanel } from './client/schedules'
import { installUiStyles, Icon } from '../../shared/ui'
export const inject = ['slots', 'sessions', 'uiWorkspace', 'conversation', 'betterSidebar', 'sidebarRight']
export function apply(ctx: Client): void {
  installUiStyles(ctx)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    document.body.setAttribute('data-dsh-px-workspace', '')
    return () => {
      style.remove()
      document.body.removeAttribute('data-dsh-px-workspace')
    }
  }, 'workspace: layout')
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-px-workspace', order: 0, registrant: 'dsh-px-workspace' },
      () => <SessionBar ctx={ctx} />
    )
  )
  ctx.slots.inject('conversation.chat.assistant-actions', () =>
    ctx.slots.register(
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
              requestQuote(p.sessionId, p.messageId)
              ctx.betterSidebar.openTab(
                { type: 'px-notes', meta: { messageId: p.messageId } },
                { sessionId: p.sessionId }
              )
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
    ctx.effect(
      () =>
        ctx.betterSidebar.registerTab({
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
