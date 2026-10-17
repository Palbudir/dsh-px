import { MemoryError, projectKey, type MemoryStore } from './store'
import type { AgentIdentity } from './identity'
import type { KnowledgeCaller } from './knowledge'

type NativeAgent = AgentIdentity & {
  session: AgentIdentity['session'] & { header: AgentIdentity['session']['header'] & { origin?: string } }
}
export function delegatedKnowledgeCaller(
  caller: KnowledgeCaller,
  actor: NativeAgent | undefined,
  get: (id: string) => NativeAgent | undefined,
  store: MemoryStore
): KnowledgeCaller {
  if (!actor || actor.session.id === caller.sessionId) return caller
  const state = store.read(),
    owner = state.bindings[caller.sessionId],
    child = state.bindings[actor.session.id]
  if (
    !owner ||
    !child ||
    owner.personaId !== child.personaId ||
    owner.personaRevision !== child.personaRevision ||
    projectKey(caller.project) !== projectKey(actor.session.header.cwd)
  )
    throw new MemoryError('委派知识视图与当前人格或项目不一致，请新建独立会话', 409)
  const seen = new Set<string>()
  let cursor: NativeAgent | undefined = actor
  while (cursor && !seen.has(cursor.session.id)) {
    seen.add(cursor.session.id)
    if (cursor.session.id === caller.sessionId) return { ...caller, sessionId: actor.session.id }
    if (cursor.session.header.origin !== 'subagent' || !cursor.session.header.parentSession) break
    cursor = get(cursor.session.header.parentSession)
  }
  throw new MemoryError('当前调用不属于此委派知识视图', 409)
}

/** Instructions only: native Mnemon still owns the retained View, grants and call budget. */
export function delegatedContract(
  agent: NativeAgent,
  get: (id: string) => NativeAgent | undefined,
  lookup: (id: string) => string | undefined,
  store: MemoryStore
): string | undefined {
  const seen = new Set<string>()
  let cursor: NativeAgent | undefined = agent
  while (cursor && !seen.has(cursor.session.id)) {
    seen.add(cursor.session.id)
    const instance = lookup(cursor.session.id)
    if (instance) {
      delegatedKnowledgeCaller(
        { sessionId: cursor.session.id, project: cursor.session.header.cwd },
        agent,
        get,
        store
      )
      return instance
    }
    if (cursor.session.header.origin !== 'subagent' || !cursor.session.header.parentSession) break
    cursor = get(cursor.session.header.parentSession)
  }
  return undefined
}
