import { service } from './history'

/** Use Mnemon's native View operations; legacy convenience tools advertise sources which may be manual-only or absent. */
export function installKnowledgeToolRouting(host: any): () => void {
  const masks = new Map<any, { key: string; dispose: () => void }>()
  let changing = false,
    closed = false,
    queued = false
  const refresh = () => {
    if (changing || closed) return
    changing = true
    try {
      const agents = service(host, 'agents')?.list?.() ?? []
      for (const [agent, mask] of masks)
        if (!agents.includes(agent)) {
          masks.delete(agent)
          mask.dispose()
        }
      const names = (service(host, 'tools')?.schemas?.() ?? [])
        .map((t: any) => t.name)
        .filter(
          (n: string) => n.startsWith('mnemon_') && !['mnemon_view_route', 'mnemon_view_action'].includes(n)
        )
        .sort()
      const key = names.join(',')
      for (const agent of agents) {
        const tools = agent.ctx?.get?.('tools') ?? agent.ctx?.tools
        if (!tools?.restrict) continue
        const old = masks.get(agent)
        if (old?.key === key) continue
        if (old) {
          masks.delete(agent)
          old.dispose()
        }
        if (names.length) {
          const dispose = tools.restrict({ deny: names })
          masks.set(agent, { key, dispose })
        }
      }
    } finally {
      changing = false
    }
  }
  const schedule = () => {
    if (queued || changing || closed) return
    queued = true
    queueMicrotask(() => {
      queued = false
      try {
        refresh()
      } catch (e) {
        host.logger?.warn('PX 知识工具路由未更新：%s', String(e))
      }
    })
  }
  const offCreated = host.on('agent/created', schedule),
    offTools = host.on('tools/change', schedule)
  refresh()
  return () => {
    closed = true
    offCreated?.()
    offTools?.()
    for (const mask of masks.values()) mask.dispose()
    masks.clear()
  }
}
