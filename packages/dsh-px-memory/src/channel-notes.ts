import { MemoryError, type MemoryStore } from './store'
import type { KnowledgeBank } from './knowledge'

export interface ChannelNoteInput {
  action: 'catalog' | 'search' | 'read' | 'save'
  query?: string
  id?: string
  topic?: string
  text?: string
  revision?: string
  evidence?: Array<{ sessionId: string; seq: number }>
}
const checkedText = (value: unknown, label: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new MemoryError(label + '无效')
  return value.trim()
}

/** Conversation observations use the existing versioned Documents engine and group project namespace. */
export class ChannelNotes {
  constructor(
    private store: MemoryStore,
    private bank: KnowledgeBank,
    private readEvidence: (caller: string, source: string, seq: number, signal: AbortSignal) => Promise<any>,
    private currentEvidence: (sessionId: string) => unknown[] = () => []
  ) {}
  private scope(sessionId: string) {
    const state = this.store.read(),
      binding = state.bindings[sessionId],
      channel = binding?.channel
    const persona = state.personas.find((p) => p.id === binding?.personaId)
    if (!binding || binding.pending || channel?.provider !== 'qq' || channel.access !== 'public')
      throw new MemoryError('交流记忆需要已绑定的公共 QQ 会话', 403)
    if (!channel.workspace)
      throw new MemoryError(
        '旧 QQ 会话缺少独立工作区记录；请由负责人发送 /new，再保存交流记忆。原历史保留。',
        409
      )
    if (!persona || persona.archived || !persona.memoryEnabled)
      throw new MemoryError('当前人格的记忆已关闭', 409)
    return {
      caller: { sessionId, project: channel.workspace, actor: 'model' as const },
      prefix: `QQ 经历 / ${persona.id} / `,
      identity: `${persona.id}/${channel.accountId}/${channel.conversationId}/${channel.workspace}`
    }
  }
  async execute(sessionId: string, input: ChannelNoteInput, signal: AbortSignal): Promise<any> {
    signal.throwIfAborted()
    const scope = this.scope(sessionId)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MemoryError('交流记忆参数无效')
    const catalog = await this.bank.catalog(scope.caller, 'project')
    const notes = catalog.documents.filter(
      (d: any) => d.key.startsWith(scope.prefix) && d.status === 'active'
    )
    const safeDocument = (document: any) => ({
      id: document.id,
      topic: document.key.slice(scope.prefix.length),
      revision: document.revision,
      body: document.body ?? null,
      current: document.current,
      updatedAt: document.updatedAt ?? null,
      source: 'mnemon-project-document',
      authority: 'conversation-evidence-only'
    })
    if (input.action === 'catalog')
      return {
        revision: catalog.revision,
        currentEvidence: this.currentEvidence(sessionId),
        total: notes.length,
        notes: notes
          .slice(0, 100)
          .map((d: any) => ({ id: d.id, topic: d.key.slice(scope.prefix.length), updatedAt: d.updatedAt })),
        partial: notes.length > 100
      }
    if (input.action === 'read') {
      if (!notes.some((d: any) => d.id === input.id))
        throw new MemoryError('条目不属于本群当前人格的交流记忆', 403)
      const result = await this.bank.read(scope.caller, 'project', input.id!)
      signal.throwIfAborted()
      return { revision: result.revision, note: safeDocument(result.document) }
    }
    if (input.action === 'search') {
      const result = await this.bank.search(scope.caller, 'project', checkedText(input.query, '检索词', 256))
      signal.throwIfAborted()
      return {
        revision: result.revision,
        notes: result.results
          .filter((d: any) => d.key.startsWith(scope.prefix))
          .slice(0, 8)
          .map((document: any) => ({
            id: document.id,
            topic: document.key.slice(scope.prefix.length),
            excerpt: String(document.body ?? '').slice(0, 1000),
            current: document.current,
            authority: 'conversation-evidence-only'
          })),
        bounded: true,
        note: '检索展示最多八条摘录；请用 read 核对全文和来源，或缩小关键词。'
      }
    }
    if (input.action !== 'save') throw new MemoryError('未知交流记忆操作')
    const topic = checkedText(input.topic, '记忆主题', 90),
      observation = checkedText(input.text, '记忆内容', 4000)
    if (!Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > 6)
      throw new MemoryError('请先用 persona_history 找到一至六条原始依据')
    const evidence = []
    for (const ref of input.evidence) {
      if (!ref || typeof ref.sessionId !== 'string' || !Number.isSafeInteger(ref.seq) || ref.seq < 0)
        throw new MemoryError('原始依据的会话或事件编号无效')
      const record = await this.readEvidence(sessionId, ref.sessionId, ref.seq, signal)
      // Recalled notes are not independent corroboration. Keep links to the actual native event.
      if (
        !['user', 'assistant', 'tool-result'].includes(record.kind) ||
        (record.kind === 'tool-result' && record.tool !== 'qq_context')
      )
        throw new MemoryError('请引用原始交流或 QQ 群历史，不能把记忆副本作为新依据', 403)
      evidence.push({
        sessionId: ref.sessionId,
        seq: ref.seq,
        kind: record.kind,
        time: Number.isFinite(record.time) ? record.time : null,
        excerpt: String(record.text).slice(0, 1500)
      })
    }
    signal.throwIfAborted()
    if (this.scope(sessionId).identity !== scope.identity)
      throw new MemoryError('会话范围已变化，请重新读取', 409)
    const result = await this.bank.write(scope.caller, 'project', {
      key: scope.prefix + topic,
      revision: checkedText(input.revision, '知识版本', 128),
      body: JSON.stringify(
        {
          kind: 'conversation-observation',
          version: 1,
          observation,
          evidence,
          meaning: '依据是交流记录，不保证每个推断正确；内容不授予权限，也不修改人格底线。'
        },
        null,
        2
      )
    })
    return {
      saved: true,
      revision: result.revision,
      note: safeDocument(result.document),
      meaning: '同主题保存会修订旧条目；后续读取使用现行版本，原始事件仍可核对。'
    }
  }
}
