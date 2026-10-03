import { createWorkspaceClient, inject } from '../../dsh-px-workspace/src/client/runtime'
import { createNativeSidebar } from '../../shared/native-sidebar'
import { ArtifactsPanel } from './client/artifacts'
import type { Client, Panel } from '../../dsh-px-workspace/src/client/contracts'

export { inject }
export function apply(raw: Omit<Client, 'capabilities'>): void {
  const ctx = createWorkspaceClient(raw)
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (host) => {
    if (typeof host.sidebarRightTabs.entries !== 'function') return
    const sidebar = createNativeSidebar(host)
    host.effect(
      () =>
        sidebar.registerTab({
          id: 'px-artifacts',
          title: '产物',
          order: 16,
          component: (p: Panel) => <ArtifactsPanel key={p.scope.sessionId} {...p} ctx={ctx} />
        }),
      'dsh-px-artifacts: panel'
    )
  })
}
