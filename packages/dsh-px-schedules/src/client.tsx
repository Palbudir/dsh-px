import { createWorkspaceClient, inject } from '../../dsh-px-workspace/src/client/runtime'
import { createNativeSidebar } from '../../shared/native-sidebar'
import { SchedulesPanel } from './client/schedules'
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
          id: 'px-schedules',
          title: '定时任务',
          order: 16,
          component: (p: Panel) => <SchedulesPanel key={p.scope.sessionId} {...p} ctx={ctx} />
        }),
      'dsh-px-schedules: panel'
    )
  })
}
