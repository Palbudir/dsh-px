/** Versioned, host-only resource contract; it never exposes terminal input or output. */
export const SIDEBAR_TERMINAL_PATCH_ID = 'dsh-px/sidebar-terminals/1'
export interface SidebarTerminalSnapshot {
  known: boolean
  openTerminals: number
  closing: boolean
}
export interface SidebarTerminalService {
  version: 1
  patchId: typeof SIDEBAR_TERMINAL_PATCH_ID
  snapshot: () => SidebarTerminalSnapshot
}
