import { MemoryError, MemoryStore, type Persona } from './store'
import { conversationalSource } from '../../shared/channel-source'
export interface AgentIdentity {
  session: {
    id: string
    header: { id: string; cwd?: string; parentSession?: string }
    snapshotEvents?: () => readonly any[]
  }
}
/** Capture before prompt rendering, not agent/pre-step (which runs after assembly in pinned DSH). */
export class TurnIdentity {
  private active = new WeakMap<AgentIdentity, { turnSeq: number; persona: Persona }>()
  constructor(
    private store: MemoryStore,
    private boundary?: (agent: AgentIdentity) => { lastTurn: number } | undefined
  ) {}
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
    this.active.set(agent, { turnSeq, persona })
    return persona
  }
}
export function hasStarted(events: readonly any[]): boolean {
  return events.some(
    (e) => e.type === 'turn/start' || (e.type === 'user/message' && conversationalSource(e.data?.source))
  )
}
