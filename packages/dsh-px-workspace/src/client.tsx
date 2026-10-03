import { createWorkspaceClient, inject } from './client/runtime'
import { SessionBar } from './client/session-bar'
import type { Client } from './client/contracts'
export { inject }
export function apply(raw: Omit<Client, 'capabilities'>): void {
  const ctx = createWorkspaceClient(raw)
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-px-workspace', order: 0, registrant: 'dsh-px-workspace' },
      () => <SessionBar ctx={ctx} />
    )
  )
}
