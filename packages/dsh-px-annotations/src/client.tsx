import { createWorkspaceClient, inject } from '../../dsh-px-workspace/src/client/runtime'
import { createNativeSidebar } from '../../shared/native-sidebar'
import { NotesPanel } from './client/notes'
import type { Client, Panel } from '../../dsh-px-workspace/src/client/contracts'
import { QuoteAction } from '../../dsh-px-workspace/src/client/quote-action'
import { SelectionAction } from './client/selection'
import { createAnnotationAttachments } from './client/attachments'
import { AttachmentPreview, AttachmentRecovery } from './client/attachment-preview'
export { inject }
export function apply(raw: Omit<Client, 'capabilities'>): void {
  const ctx = createWorkspaceClient(raw)
  const attachments = createAnnotationAttachments(ctx)
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'px-annotation-preview', order: 91 }, () => (
      <AttachmentPreview ctx={ctx} attachments={attachments} />
    ))
  )
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      { name: 'conversation.input.dock', id: 'px-annotation-recovery', order: 99 },
      (p: any) => <AttachmentRecovery {...p} attachments={attachments} />
    )
  )
  ctx.inject(['uiConversation'], (host) => {
    host.slots.inject('shell.overlay', () =>
      host.slots.register(
        { name: 'shell.overlay', id: 'dsh-px-selection', order: 90, registrant: 'dsh-px-annotations' },
        () => <SelectionAction ctx={ctx} reader={host.uiConversation} attachments={attachments} />
      )
    )
  })
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (host) => {
    if (typeof host.sidebarRightTabs.entries !== 'function') return
    const sidebar = createNativeSidebar(host)
    host.effect(
      () =>
        sidebar.registerTab({
          id: 'px-notes',
          title: '引用与批注',
          order: 16,
          component: (p: Panel) => (
            <NotesPanel key={p.scope.sessionId} {...p} ctx={ctx} attachments={attachments} />
          )
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
