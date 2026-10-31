import {
  personaChannelAllowed,
  personaToolAllowed,
  parsePersonaResources,
  type PersonaResources
} from '../../shared/persona-resources'
import { MemoryError, validId, type MemoryStore } from './store'
import type { TurnIdentity, AgentIdentity } from './identity'
import { service } from './history'

/** The latest policy can restrict an existing turn; new grants take effect only in its next turn. */
export class PersonaResourceAccess {
  private captured = new WeakMap<
    AgentIdentity,
    { identity: object; policies: Array<PersonaResources | undefined> }
  >()
  constructor(
    private readonly store: MemoryStore,
    private readonly identity: TurnIdentity,
    private readonly parentAgent: (id: string) => AgentIdentity | undefined = () => undefined,
    private readonly nativeChild: (child: AgentIdentity, parent: AgentIdentity) => boolean = () => false
  ) {}
  private policies(agent: AgentIdentity, visited = new Set<string>()): Array<PersonaResources | undefined> {
    if (visited.size >= 32 || visited.has(agent.session.id)) throw new MemoryError('人格资源继承链无效', 403)
    visited.add(agent.session.id)
    const identity = this.identity.current(agent),
      saved = this.captured.get(agent)
    if (saved?.identity === identity) return saved.policies
    const parentId = agent.session.header.parentSession,
      parent = parentId && this.parentAgent(parentId)
    const policies = [identity.resources, ...(parent ? this.policies(parent, visited) : [])]
    this.captured.set(agent, { identity, policies })
    return policies
  }
  private current(personaId: string) {
    const persona = this.store.read().personas.find((p) => p.id === personaId)
    if (!persona || persona.archived) throw new MemoryError('人格不存在或已归档', 403)
    return persona
  }
  tool(agent: AgentIdentity, name: string): string | undefined {
    if (this.isResultSubmission(agent, name)) return
    return this.checker(agent)(name)
  }
  private isResultSubmission(agent: AgentIdentity, name: string): boolean {
    if (name !== 'structured_output') return false
    const parentId = agent.session.header.parentSession,
      parent = parentId && this.parentAgent(parentId)
    // Native result submission is protocol machinery, never a new external action grant.
    return !!parent && this.nativeChild(agent, parent)
  }
  private checker(agent: AgentIdentity): (name: string) => string | undefined {
    try {
      const captured = this.identity.current(agent),
        current = this.current(captured.id),
        policies = [...this.policies(agent), current.resources]
      const channel = this.store.read().bindings[agent.session.id]?.channel
      if (
        channel &&
        policies.some((policy) => !personaChannelAllowed(policy, channel.provider, channel.accountId))
      )
        return () => '本会话人格已失去此渠道账号的使用权限'
      return (name) =>
        policies.some((policy) => !personaToolAllowed(policy, name))
          ? `人格“${current.name}”未获准执行工具 ${name}；请由用户在“人格与会话 → 可用资源”中调整。当前轮不会获得中途新增的工具授权。`
          : undefined
    } catch (error) {
      return () => (error instanceof Error ? error.message : '人格资源规则暂不可用')
    }
  }
  filter<T extends { name: string }>(agent: AgentIdentity, tools: T[]): T[] {
    const check = this.checker(agent)
    return tools.filter((tool) => this.isResultSubmission(agent, tool.name) || !check(tool.name))
  }
  channel(personaId: string, provider: string, accountId: string): boolean {
    try {
      return personaChannelAllowed(this.current(personaId).resources, provider, accountId)
    } catch {
      return false
    }
  }
  snapshot(personaId: string) {
    const persona = this.current(personaId)
    return { personaId, policy: persona.resources ?? null }
  }
  save(personaId: string, revision: unknown, input: unknown): void {
    validId(personaId)
    const state = this.store.read(),
      persona = state.personas.find((p) => p.id === personaId)
    if (!persona || persona.archived) throw new MemoryError('人格不存在或已归档', 403)
    if (revision !== (persona.resources?.revision ?? 0))
      throw new MemoryError('资源规则已变化，请刷新后重试；没有覆盖旧修改', 409)
    let policy: PersonaResources | undefined
    try {
      policy = parsePersonaResources({ ...(input as object), revision: Number(revision) + 1 })
    } catch (error) {
      throw new MemoryError(error instanceof Error ? error.message : '资源规则无效')
    }
    this.store.change(state.revision, (next) => {
      next.personas.find((p) => p.id === personaId)!.resources = policy
    })
  }
}

/** Monotonic native guard covers scoped tools, direct dispatch and PTC subcalls. */
export function installPersonaResourceAccess(ctx: any, access: PersonaResourceAccess): () => void {
  const provided = ctx.provide('pxPersonaResources', {
    version: 1,
    allowsChannel: (personaId: string, provider: string, accountId: string) =>
      access.channel(personaId, provider, accountId),
    inspect: (personaId: string) => access.snapshot(personaId),
    save: (personaId: string, revision: unknown, input: unknown) => access.save(personaId, revision, input)
  })
  const injection = ctx.inject(['tools'], (host: any) =>
    host.effect(function* () {
      yield host.tools.guard((exec: any) => (exec.agent ? access.tool(exec.agent, exec.name) : undefined))
      // Filtering is guidance only; the guard is the authoritative execution boundary.
      yield host.on(
        'system-prompt/assemble',
        async (_: any, context: any, next: () => Promise<any>) => {
          const assembly = await next()
          if (!context.agent) return assembly
          return {
            ...assembly,
            tools: access.filter(context.agent, assembly.tools)
          }
        },
        { prepend: true }
      )
    }, 'memory: persona resource guard')
  )
  return () => {
    if (typeof provided === 'function') provided()
    return injection.dispose()
  }
}

export function resourceToolCatalog(ctx: any): Array<{ name: string; description: string }> {
  const tools = service(ctx, 'tools'),
    agents = service(ctx, 'agents')
  if (!tools?.schemas) return []
  const seen = new Map<string, string>()
  for (const agent of [undefined, ...(agents?.list?.() ?? [])]) {
    for (const schema of tools.schemas(agent)) seen.set(schema.name, (schema.description ?? '').slice(0, 240))
  }
  return [...seen]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, description]) => ({ name, description }))
}
