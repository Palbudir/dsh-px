import { publicSession, samePublicConversation, isInternalSession, type MemoryStore } from './store'
import { personaToolAllowed, personaChannelAllowed } from '../../shared/persona-resources'

/** Read-only facet for a pinned native-history authorization hook. The id set stays fixed across cursor pages. */
export function nativeHistoryScope(store: MemoryStore, agent: any, tool: string) {
  const id = agent?.session?.id
  if (typeof id !== 'string' || !NATIVE_HISTORY_TOOLS.has(tool)) throw new Error('原生历史缺少合法调用主体')
  const initial = store.bind(id, { parent: agent.session.header.parentSession, locked: true }),
    caller = initial.bindings[id]
  const owner = initial.personas.find((p) => p.id === caller.personaId)
  if (!owner || owner.archived || caller.purpose || isInternalSession(id))
    throw new Error('原生历史主体不可用')
  const permits = (state: typeof initial, target: string) => {
    const current = state.bindings[id],
      persona = state.personas.find((p) => p.id === current?.personaId),
      binding = state.bindings[target]
    return (
      !!current &&
      !!persona &&
      !persona.archived &&
      current.personaId === caller.personaId &&
      personaToolAllowed(owner.resources, tool) &&
      personaToolAllowed(persona.resources, tool) &&
      (!current.channel ||
        personaChannelAllowed(persona.resources, current.channel.provider, current.channel.accountId)) &&
      !!binding &&
      !binding.pending &&
      !binding.purpose &&
      !isInternalSession(target) &&
      (binding.locked || target === id) &&
      binding.personaId === caller.personaId &&
      (target === id || persona.memoryEnabled) &&
      (!publicSession(current) || samePublicConversation(current, binding))
    )
  }
  const ids = Object.keys(initial.bindings)
      .filter((target) => permits(initial, target))
      .sort(),
    captured = new Set(ids)
  if (!captured.has(id)) throw new Error('当前原生历史操作未获准')
  let currentState: typeof initial | undefined
  return Object.freeze({
    ids: Object.freeze(ids),
    allows(target: string) {
      if (!captured.has(target)) return false
      try {
        if (!currentState) {
          currentState = store.read()
          queueMicrotask(() => {
            currentState = undefined
          })
        }
        return permits(currentState, target)
      } catch {
        return false
      }
    }
  })
}

export const NATIVE_HISTORY_TOOLS = new Set([
  'session_search',
  'session_event_search',
  'session_event_read',
  'session_event_trace',
  'session_trace',
  'session_query'
])

/** Monotonic protection while the native query seam is adapted to persona-scoped corpus/lineage filtering. */
export function nativeHistoryGuard(store: MemoryStore, exec: any, adapted = false): string | undefined {
  if (!NATIVE_HISTORY_TOOLS.has(exec.name) || !exec.agent) return
  if (adapted && exec.name !== 'session_query') {
    nativeHistoryScope(store, exec.agent, exec.name)
    return
  }
  const id = exec.agent.session.id
  const state = store.bind(id, { parent: exec.agent.session.header.parentSession, locked: true })
  const caller = state.bindings[id],
    persona = state.personas.find((p) => p.id === caller.personaId)
  if (!persona || persona.archived || caller.purpose || isInternalSession(id))
    return '当前人格不能读取原生历史'
  const allowed = (target: unknown): boolean => {
    if (typeof target !== 'string' || isInternalSession(target)) return false
    const binding = state.bindings[target]
    return (
      !!binding &&
      !binding.pending &&
      !binding.purpose &&
      (binding.locked || target === id) &&
      binding.personaId === caller.personaId &&
      (target === id || persona.memoryEnabled) &&
      (!publicSession(caller) || samePublicConversation(caller, binding))
    )
  }
  if (exec.name === 'session_query' || exec.name === 'session_trace')
    return '此原生入口尚未完成按人格过滤；请使用 persona_history 获取受限历史。'
  const args = exec.arguments ?? {}
  if (exec.name === 'session_search') {
    if (!Array.isArray(args.session_ids) || !args.session_ids.length || !args.session_ids.every(allowed))
      return '跨会话搜索必须限定到本人格已固定的会话；可先用 persona_history sessions 或 search 找到可见来源。'
    if (
      args.parent_session_ids !== undefined &&
      (!Array.isArray(args.parent_session_ids) || !args.parent_session_ids.every(allowed))
    )
      return '不能以其他人格的会话作为历史筛选来源'
    return
  }
  if (!allowed(args.session_id ?? id))
    return '目标历史不属于本人格的可见会话，或尚未固定人格；未读取。明确交接的内容请使用 persona_history。'
}
