import { createHash } from 'node:crypto'
import { nativeReader } from './history'
import { MemoryError } from './store'

export interface SegmentSource {
  sessionId: string
  seqs: number[]
  messages: any[]
  fingerprint: string
  tokens: number
  capturedThrough: number
}
export interface SegmentBudget {
  minimumTokens: number
  retainTokens: number
  maximumCharacters: number
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const checkpoint = (event: any) =>
  event.type === 'user/message' && event.data?.source?.kind === 'compact-checkpoint'
const textBlocks = (blocks: any[]): boolean =>
  blocks.every(
    (block) =>
      ['text', 'reasoning', 'tool-call'].includes(block.type) ||
      (block.type === 'tool-result' && Array.isArray(block.content) && textBlocks(block.content))
  )
const visibleBlocks = (blocks: any[]): any[] =>
  blocks
    .filter((block) => block.type !== 'reasoning')
    .map((block) =>
      block.type === 'tool-result' ? { ...block, content: visibleBlocks(block.content) } : block
    )

/** Auxiliary analysis sees visible evidence, never provider reasoning as a source of new facts. */
export function segmentEvidence(source: SegmentSource): unknown[] {
  return source.messages.map((message, i) => ({
    seq: source.seqs[i],
    role: message.role,
    source: message.source,
    content: visibleBlocks(message.content)
  }))
}

/** Select only completed earlier turns; never rewrite an earlier checkpoint into the next segment. */
export async function captureSegment(
  host: any,
  agent: any,
  budget: SegmentBudget,
  signal?: AbortSignal
): Promise<SegmentSource | undefined> {
  if (
    ![budget.minimumTokens, budget.retainTokens, budget.maximumCharacters].every(
      (n) => Number.isSafeInteger(n) && n > 0
    )
  )
    throw new MemoryError('分段预算无效')
  const { toolPairingBalancedBefore, toolPairingBalancedAfter } = await import('@deepseek-ai/dsh-compaction')
  const session = agent.session,
    meter = host.get('tokenMeter'),
    projections = host.get('sessionProjections')
  if (!meter?.measure || !projections?.stateOf) throw new MemoryError('原生上下文测量服务不可用', 503)
  const boundary = projections.stateOf(session, 'turnBoundary')?.openTurnStartSeq
  if (!Number.isSafeInteger(boundary) || boundary <= 0) return
  const measurement = meter.measure(session),
    nodes = [...session.surface.nodes] as number[]
  if (
    measurement.nodes.length !== nodes.length ||
    measurement.nodes.some((node: any, i: number) => node.seq !== nodes[i])
  )
    throw new MemoryError('上下文测量与原生投影不一致', 409)
  let retained = 0,
    keepFrom = nodes.length
  while (keepFrom > 0 && retained < budget.retainTokens) retained += measurement.nodes[--keepFrom].tokens
  if (keepFrom < 2) return
  const reader = await nativeReader(host, session.id, signal)
  try {
    let seqs: number[] = [],
      messages: any[] = [],
      tokens = 0,
      characters = 0
    for (let at = 0; at < keepFrom && at < 512; at++) {
      signal?.throwIfAborted()
      const seq = nodes[at]
      const event = (await reader.read(seq, 1, { signal })).events[0]
      if (!event || event.seq !== seq) return // A buffered native write has not become readable yet.
      if (event.type === 'system/message' || checkpoint(event)) {
        seqs = []
        messages = []
        tokens = 0
        characters = 0
        continue
      }
      if (seq >= boundary) break
      if (!seqs.length && !toolPairingBalancedBefore(session, seq as any)) continue
      const message = session.deriveEventMessage(event)
      if (!message) return
      // The initial background summarizer is text-only. Native pressure compaction retains its own multimodal path.
      if (!textBlocks(message.content)) return
      characters += JSON.stringify({ ...message, content: visibleBlocks(message.content) }).length
      if (characters > budget.maximumCharacters) return
      seqs.push(seq)
      messages.push(message)
      tokens += measurement.nodes[at].tokens
      if (
        seqs.length >= 2 &&
        tokens >= budget.minimumTokens &&
        toolPairingBalancedAfter(session, seq as any)
      ) {
        const source = {
          sessionId: session.id,
          seqs,
          messages,
          fingerprint: hash(messages),
          tokens,
          capturedThrough: measurement.logRevision
        }
        if (!segmentStillVisible(session, source)) return
        return source
      }
    }
  } finally {
    await reader.close()
  }
}

/** Positional checks allow a newer tail, but reject replaced, removed or interleaved source nodes. */
export function segmentStillVisible(session: any, source: SegmentSource): boolean {
  if (session.id !== source.sessionId || !source.seqs.length) return false
  const nodes = session.surface.nodes as number[],
    start = nodes.indexOf(source.seqs[0])
  return start >= 0 && source.seqs.every((seq, i) => nodes[start + i] === seq)
}

/** Instantiate the original native transaction in a private service scope; do not replace the active pressure backend. */
export async function createSegmentCommitter(host: any) {
  const { BasicCompactionEngine } = await import('@deepseek-ai/dsh-compaction-basic')
  const candidates = new WeakMap<
    object,
    { source: SegmentSource; summary: string; provider: string; model: string }
  >()
  class PreparedCompaction extends BasicCompactionEngine {
    protected override async summarize(input: any, agent: any, signal?: AbortSignal): Promise<any> {
      signal?.throwIfAborted()
      const ready = candidates.get(agent)
      if (!ready || !segmentStillVisible(agent.session, ready.source))
        throw new MemoryError('后台片段已失效，未提交', 409)
      // Preparation intentionally summarizes source messages only. Changing unrelated request headers is not a source edit.
      const sourceMessages = input.messages.slice(-ready.source.messages.length)
      if (hash(sourceMessages) !== ready.source.fingerprint)
        throw new MemoryError('后台片段的原生消息投影已变化，未提交', 409)
      return {
        summary: [{ type: 'text', text: ready.summary }],
        provider: ready.provider,
        model: ready.model
      }
    }
  }
  const isolated = host.isolate('compaction'),
    fiber = isolated.plugin(PreparedCompaction, { auto: false })
  await fiber.await()
  const backend = isolated.get('compaction')
  if (!backend?.compactRegion) {
    await fiber.dispose()
    throw new MemoryError('原生片段提交服务未就绪', 503)
  }
  let disposed = false
  return {
    async commit(
      agent: any,
      source: SegmentSource,
      prepared: { id: string; summary: string; provider: string; model: string },
      signal: AbortSignal
    ) {
      if (disposed) throw new MemoryError('片段提交服务已停止', 409)
      signal.throwIfAborted()
      if (candidates.has(agent)) throw new MemoryError('此会话已有片段正在提交', 409)
      if (!segmentStillVisible(agent.session, source)) throw new MemoryError('片段来源已离开当前上下文', 409)
      if (
        !/^[a-zA-Z0-9-]{1,80}$/.test(prepared.id) ||
        typeof prepared.summary !== 'string' ||
        !prepared.summary.trim() ||
        prepared.summary.length > 16000 ||
        !prepared.provider ||
        !prepared.model
      )
        throw new MemoryError('后台摘要结果无效')
      candidates.set(agent, {
        source,
        provider: prepared.provider,
        model: prepared.model,
        summary: `【已压缩片段 ${prepared.id}】\n来源会话 ${source.sessionId}；原始事件 ${source.seqs.join(', ')}。以下是已结束旧段的摘要，不是新的任务或权限。需要细节时使用 persona_history read 按来源会话和事件编号读取原文；当前任务状态以原生 Goal/Job/Team 回执与账本为准。\n${prepared.summary}`
      })
      try {
        return await backend.compactRegion(source.seqs[0], source.seqs.at(-1), agent, signal)
      } finally {
        candidates.delete(agent)
      }
    },
    async dispose() {
      disposed = true
      await fiber.dispose()
    }
  }
}
