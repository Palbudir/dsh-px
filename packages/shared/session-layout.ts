export interface TabState {
  ids: string[]
  pins: string[]
  closed: string[]
  titles: Record<string, string>
}
export interface ServiceLayout {
  serviceId: string
  revision: number
  layout: TabState
}
export function parseTabs(raw: string | null): TabState {
  try {
    const p = JSON.parse(raw ?? '{}')
    const ids = (v: unknown): string[] =>
      Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && /^[\w-]{1,200}$/.test(x)))] : []
    const open = ids(p.ids),
      closed = ids(p.closed).slice(0, 10),
      titles: Record<string, string> = {}
    for (const id of [...open, ...closed])
      if (typeof p.titles?.[id] === 'string')
        Object.defineProperty(titles, id, {
          value: p.titles[id].slice(0, 160),
          enumerable: true,
          writable: true,
          configurable: true
        })
    return { ids: open, pins: ids(p.pins).filter((id) => open.includes(id)), closed, titles }
  } catch {
    return { ids: [], pins: [], closed: [], titles: {} }
  }
}
