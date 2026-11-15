import {
  MemoryError,
  publicSession,
  isInternalSession,
  validId,
  type MemoryStore,
  type MemoryEntry,
  type MemoryProvenance,
  type Persona
} from './store'
import {
  MemoryFeedback,
  feedbackHash,
  prepareFeedback,
  presentFeedback,
  type FeedbackInput
} from './memory-feedback'

export interface HotMemoryCaller {
  sessionId: string
  project: string | null
  actor: 'human' | 'model'
}
/** Existing hot-memory text remains in MemoryStore; judgments never replace its content revision or ownership. */
export class HotMemory {
  private feedback: MemoryFeedback
  constructor(
    private store: MemoryStore,
    path: string,
    private readEvidence: (caller: string, source: string, seq: number, signal?: AbortSignal) => Promise<any>
  ) {
    this.feedback = new MemoryFeedback(path)
  }
  private identity(caller: HotMemoryCaller) {
    const state = this.store.read(),
      binding = state.bindings[caller.sessionId],
      persona = state.personas.find((p) => p.id === binding?.personaId)
    if (
      !binding ||
      binding.pending ||
      binding.purpose ||
      isInternalSession(caller.sessionId) ||
      publicSession(binding) ||
      !persona
    )
      throw new MemoryError('此会话不能访问人格私有约定', 403)
    return { state, persona }
  }
  private target(personaId: string, entry: MemoryEntry) {
    return feedbackHash([
      'hot-memory',
      personaId,
      entry.id,
      entry.entryRevision ?? 1,
      entry.text,
      entry.project,
      entry.updatedAt
    ])
  }
  project(persona: Persona, actor: 'human' | 'model', currentOnly = false): Persona {
    const live = this.store.read().personas.find((p) => p.id === persona.id)
    if (currentOnly && (!live || !live.memoryEnabled || live.archived || !persona.memoryEnabled))
      return { ...persona, memoryEnabled: false, memories: [] }
    const memories = persona.memories
      .filter(
        (entry) =>
          !currentOnly ||
          live?.memories.some((now) => this.target(persona.id, now) === this.target(persona.id, entry))
      )
      .map((entry) => {
        const feedback = this.feedback.view(this.target(persona.id, entry))
        return {
          ...entry,
          entryRevision: entry.entryRevision ?? 1,
          provenance: entry.provenance ?? { actor: 'unknown' as const, sessionId: '', events: [] },
          current: !feedback.disputed,
          feedback: presentFeedback(feedback, actor)
        }
      })
      .filter((entry) => !currentOnly || entry.current)
    memories.sort(
      (a, b) =>
        b.feedback.strength - a.feedback.strength ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id)
    )
    return { ...persona, memories }
  }
  private entry(caller: HotMemoryCaller, id: string) {
    const { state, persona } = this.identity(caller),
      entry = persona.memories.find((row) => row.id === validId(id))
    if (!entry || (entry.project !== null && entry.project !== caller.project))
      throw new MemoryError('条目不属于当前人格与项目的可见约定', 403)
    return { state, persona, entry, target: this.target(persona.id, entry) }
  }
  async judge(
    caller: HotMemoryCaller,
    input: FeedbackInput & { id: string; entryRevision: number },
    signal?: AbortSignal
  ) {
    const before = this.entry(caller, input.id)
    if (before.persona.archived || (caller.actor === 'model' && !before.persona.memoryEnabled))
      throw new MemoryError('此人格的记忆已关闭或归档', 409)
    if (input.entryRevision !== (before.entry.entryRevision ?? 1))
      throw new MemoryError('约定已被修改，请重新读取后反馈', 409)
    const prepared = await prepareFeedback(
      input,
      caller.actor,
      (source, seq, stop) => this.readEvidence(caller.sessionId, source, seq, stop),
      signal
    )
    const now = this.entry(caller, input.id)
    if (
      before.target !== now.target ||
      before.persona.id !== now.persona.id ||
      now.persona.archived ||
      (caller.actor === 'model' && !now.persona.memoryEnabled)
    )
      throw new MemoryError('约定或权限已变化，未采纳迟到反馈', 409)
    signal?.throwIfAborted()
    const result = this.feedback.record(before.target, prepared.origin, prepared.entry)
    return {
      duplicate: result.duplicate,
      feedback: presentFeedback(result.feedback, caller.actor),
      applies: 'next-context-assembly'
    }
  }
  async save(
    caller: HotMemoryCaller,
    revision: unknown,
    input: any,
    evidence: Array<{ sessionId: string; seq: number }> = [],
    signal?: AbortSignal
  ) {
    const before = this.identity(caller)
    if (!Array.isArray(evidence) || evidence.length > 6) throw new MemoryError('约定来源最多引用六条事件')
    const refs: MemoryProvenance['events'] = []
    for (const ref of evidence) {
      if (!ref || typeof ref.sessionId !== 'string' || !Number.isSafeInteger(ref.seq) || ref.seq < 0)
        throw new MemoryError('约定来源编号无效')
      const record = await this.readEvidence(caller.sessionId, ref.sessionId, ref.seq, signal)
      if (
        record?.source !== 'native-session-event' ||
        !/^[a-f0-9]{64}$/.test(record.eventHash) ||
        !['user', 'assistant', 'tool-result', 'native-state', 'ledger'].includes(record.kind)
      )
        throw new MemoryError('约定来源无法核对', 409)
      if (!refs.some((v) => v.sessionId === ref.sessionId && v.seq === ref.seq))
        refs.push({
          sessionId: ref.sessionId,
          seq: ref.seq,
          eventHash: record.eventHash,
          kind: record.kind,
          time: Number.isFinite(record.time) ? record.time : null
        })
    }
    signal?.throwIfAborted()
    const now = this.identity(caller)
    if (now.persona.id !== before.persona.id) throw new MemoryError('保存期间人格已变化，未写入', 409)
    return this.store.action(revision, { ...input, type: 'save' }, caller.sessionId, caller.project, {
      actor: caller.actor,
      sessionId: caller.sessionId,
      events: refs
    })
  }
  close() {
    this.feedback.close()
  }
}
