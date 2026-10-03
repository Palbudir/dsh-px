import { createWorkspaceClient, inject } from '../../dsh-px-workspace/src/client/runtime'
import { createNativeSidebar } from '../../shared/native-sidebar'
import { NotesPanel } from './client/notes'
import type { Client, Panel } from '../../dsh-px-workspace/src/client/contracts'
import { QuoteAction } from '../../dsh-px-workspace/src/client/quote-action'
export { inject }
export function apply(raw: Omit<Client, 'capabilities'>): void {
  const ctx = createWorkspaceClient(raw)
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (host) => {
    if (typeof host.sidebarRightTabs.entries !== 'function') return
    const sidebar = createNativeSidebar(host)
    host.effect(
      () =>
        sidebar.registerTab({
          id: 'px-notes',
          title: '引用与批注',
          order: 16,
          component: (p: Panel) => <NotesPanel key={p.scope.sessionId} {...p} ctx={ctx} />
        }),
      'dsh-px-annotations: panel'
    )
    host.slots.inject('conversation.chat.assistant-actions', () =>
      host.slots.register(
        {
          name: 'conversation.chat.assistant-actions',
          id: 'dsh-px-quote',
          order: 95,
          registrant: 'dsh-px-annotations'
        },
        (p: { sessionId: string; messageId: string }) => <QuoteAction {...p} ctx={ctx} />
      )
    )
  })
}
