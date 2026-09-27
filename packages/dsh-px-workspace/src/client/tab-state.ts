import type { TabState } from '../../../shared/session-layout'
export { parseTabs, type TabState } from '../../../shared/session-layout'
export function visibleTabs(tabs: TabState): string[] {
  return [
    ...tabs.ids.filter((id) => tabs.pins.includes(id)),
    ...tabs.ids.filter((id) => !tabs.pins.includes(id))
  ]
}
export function closeTabState(
  tabs: TabState,
  id: string,
  available: readonly string[]
): { tabs: TabState; next?: string } {
  const ordered = visibleTabs(tabs),
    at = ordered.indexOf(id)
  const candidates = [...ordered.slice(at + 1), ...ordered.slice(0, at).reverse()]
  const ids = tabs.ids.filter((x) => x !== id)
  const closed = [id, ...tabs.closed.filter((x) => x !== id)].slice(0, 10)
  return {
    tabs: {
      ...tabs,
      ids,
      pins: tabs.pins.filter((x) => x !== id),
      closed,
      titles: Object.fromEntries(
        [...ids, ...closed].filter((id) => tabs.titles[id]).map((id) => [id, tabs.titles[id]])
      )
    },
    next: candidates.find((x) => available.includes(x))
  }
}
