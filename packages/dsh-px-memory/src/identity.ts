import { MemoryError, MemoryStore, type Persona } from './store'
import { conversationalSource, qqMessageOrigin } from '../../shared/channel-source'
import type { PersonaInteraction } from '../../shared/persona-scenes'
export interface AgentIdentity {
  session: {
    id: string
    header: { id: string; cwd?: string; parentSession?: string }
    snapshotEvents?: () => readonly any[]
  }
}
/** Capture before prompt rendering, not agent/pre-step (which runs after assembly in pinned DSH). */
export class TurnIdentity {
  private active = new WeakMap<
    AgentIdentity,
    { turnSeq: number; persona: Persona; interaction: PersonaInteraction }
  >()
  private claimed = new WeakMap<
    AgentIdentity,
    { turn: number; accountId: string; conversationId: string; participants: Set<string> }
  >()
  constructor(
    private store: MemoryStore,
    private boundary?: (agent: AgentIdentity) => { lastTurn: number } | undefined
  ) {}
  /** Native inbox claims precede prompt assembly; user/message persistence happens only afterwards. */
  claim(agent: AgentIdentity, message: { source?: unknown }, turn: number): void {
    if (!Number.isSafeInteger(turn) || turn < 1) return
    const origin = qqMessageOrigin(message.source)
    if (!origin) return
    const channel = this.store.read().bindings[agent.session.id]?.channel
    if (
      channel?.provider !== 'qq' ||
      origin.accountId !== channel.accountId ||
      origin.conversationId !== channel.conversationId
    )
      return
    // Do not change an already assembled turn when later steering is claimed.
    if (this.boundary?.(agent)?.lastTurn === turn && this.active.get(agent)?.turnSeq === turn - 1) return
    let pending = this.claimed.get(agent)
    if (
      !pending ||
      pending.turn !== turn ||
      pending.accountId !== origin.accountId ||
      pending.conversationId !== origin.conversationId
    ) {
      pending = {
        turn,
        accountId: origin.accountId,
        conversationId: origin.conversationId,
        participants: new Set()
      }
      this.claimed.set(agent, pending)
    }
    pending.participants.add(origin.senderId)
  }
  current(agent: AgentIdentity): Persona {
    const boundary = this.boundary?.(agent)
    let turnSeq = boundary ? boundary.lastTurn - 1 : -1
    if (!boundary) {
      const events = agent.session.snapshotEvents?.() ?? []
      for (let i = events.length - 1; i >= 0; i--)
        if (events[i].type === 'turn/start') {
          turnSeq = events[i].seq
          break
        }
    }
    const previous = this.active.get(agent)
    if (previous && previous.turnSeq === turnSeq) return previous.persona
    const state = this.store.bind(agent.session.id, {
      parent: agent.session.header.parentSession,
      locked: !!agent.session.header.parentSession || turnSeq >= 0
    })
    const persona = this.store.persona(state, agent.session.id)
    if (persona.archived) throw new MemoryError('本会话人格已归档；请新建其他人格的接续会话', 409)
    const channel = state.bindings[agent.session.id]?.channel
    const participants = new Set<string>()
    if (channel?.task) participants.add(channel.task.requesterId)
    if (channel?.provider === 'qq' && persona.expression?.scenes?.some((rule) => rule.participantId)) {
      const claimed = this.claimed.get(agent)
      if (
        claimed?.turn === boundary?.lastTurn &&
        claimed?.accountId === channel.accountId &&
        claimed?.conversationId === channel.conversationId
      )
        for (const id of claimed.participants) participants.add(id)
      const events = agent.session.snapshotEvents?.() ?? []
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'turn/start') break
        if (events[i].type !== 'user/message') continue
        const origin = qqMessageOrigin(events[i].data?.source)
        if (origin?.accountId === channel.accountId && origin.conversationId === channel.conversationId)
          participants.add(origin.senderId)
      }
    }
    const interaction: PersonaInteraction = {
      provider: channel?.provider ?? 'local',
      accountId: channel?.accountId,
      conversationId: channel?.conversationId,
      participants: [...participants],
      activity: channel?.task ? 'work' : channel ? 'conversation' : 'auto'
    }
    this.active.set(agent, { turnSeq, persona, interaction })
    return persona
  }
  interaction(agent: AgentIdentity): PersonaInteraction {
    this.current(agent)
    return structuredClone(this.active.get(agent)!.interaction)
  }
}
export function hasStarted(events: readonly any[]): boolean {
  return events.some(
    (e) => e.type === 'turn/start' || (e.type === 'user/message' && conversationalSource(e.data?.source))
  )
}
