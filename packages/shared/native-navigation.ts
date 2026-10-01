/** Public DSH file-resource grammar: path segments are escaped, Windows drive colons remain literal. */
export function nativeFileAddress(sessionId: string, path: string): string {
  if (!sessionId || !path || /[\r\n\0]/.test(path)) throw new Error('文件地址无效')
  const encode = (segment: string): string => encodeURIComponent(segment).replace(/%3A/gi, ':')
  return `dsh-resource://file/session/${encode(sessionId)}/${path
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/, '')
    .split('/')
    .map(encode)
    .join('/')}`
}

/**
 * Leave the last Session. The PX home panel is selected only where PX can read the selection back
 * (0.2 publishes layout.panelInfo); a 0.1.5 host has no panelInfo, so its Session list is cleared.
 */
export function closeLastSession(ctx: {
  layout?: { panelInfo?: unknown; selectPanel: (id: string) => void }
  sessions: { clear?: () => void }
}): void {
  if (ctx.layout?.panelInfo) ctx.layout.selectPanel('px-session-home')
  else ctx.sessions.clear?.()
}

/**
 * 0.2 selects its conversation through the public `mainView` retention source, which @deepseek-ai/dsh-client-ui-session
 * declares as a SessionReferenceSourceMap extension (lib/types/client/index.d.ts); 0.1.5 keeps `current`.
 */
export function selectedSession(
  list: {
    current?: string
    byId: Record<string, { id: string; retainedBy?: Readonly<Record<string, number>> }>
  },
  panel: string | null
): string | undefined {
  if (panel === 'px-session-home') return undefined
  return list.current ?? Object.values(list.byId).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id
}
