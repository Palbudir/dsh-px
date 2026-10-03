import { createNativeSidebar } from '../../../shared/native-sidebar'
import { createCapabilities } from '../../../shared/client-capabilities'
import { installUiStyles } from '../../../shared/ui'
import { installOwnedStyle } from '../../../shared/owned-style'
import type { Client } from './contracts'
import { css } from './styles'
export const inject = ['slots', 'sessions', 'uiWorkspace', 'conversation', 'layout']
export function createWorkspaceClient(raw: Omit<Client, 'capabilities'>): Client {
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
  installOwnedStyle(ctx, 'workspace', css)
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
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (host) => {
    if (typeof host.sidebarRightTabs.entries !== 'function') return
    const sidebar = createNativeSidebar(host)
    capabilities.set({ sidebar })
    host.effect(
      () => () => {
        if (capabilities.getSnapshot().sidebar === sidebar) capabilities.set({ sidebar: undefined })
      },
      'workspace: panels'
    )
  })
  return ctx
}
