import type { MemorySourceRuntime, MemoryOperationScope, MemoryReadGrant } from 'dsh-mnemon/contracts'
import { MemoryError } from './store'

interface Candidate {
  id: string
  revision: number
  strength: number
  updatedAt: string
  order: number
}
interface Hit extends Candidate {
  relevance: number
  rank: number
}
interface Bucket {
  remaining: Set<string>
  heads: Hit[]
  exhausted: boolean
}
interface Plan {
  signature: string
  scope: MemoryOperationScope
  sourceKey: string
  grant: MemoryReadGrant
  candidates: Map<string, Candidate>
  buckets: Bucket[]
  materialized: Hit[]
  done: boolean
  at: number
  queue: Promise<unknown>
  reads: number
}
const compare = (a: Hit, b: Hit) =>
  b.rank - a.rank || b.relevance - a.relevance || b.updatedAt.localeCompare(a.updatedAt) || a.order - b.order

/** Page a weighted merge of native Documents searches. Each bucket has constant feedback, so native relevance order remains valid. */
export class DocumentSearchPager {
  private plans = new Map<string, Plan>()
  async page(input: {
    signature: string
    cursor?: string
    requireCursor: boolean
    offset: number
    query: string
    scope: MemoryOperationScope
    sourceKey: string
    candidates: Candidate[]
    runtime: () => Promise<MemorySourceRuntime>
    signal: AbortSignal
  }) {
    const { signature, offset, signal } = input
    if (input.cursor !== undefined && input.cursor !== signature)
      throw new MemoryError('交流记忆目录已变化（正文或反馈），请从第一页重新查询', 409)
    if (offset > 0 && input.cursor === undefined && input.requireCursor)
      throw new MemoryError('带反馈排序的后续页需要 cursor，请从第一页重新查询', 409)
    let plan = this.plans.get(signature)
    if (plan && Date.now() - plan.at > 300000) {
      this.plans.delete(signature)
      plan = undefined
    }
    if (!plan) {
      if (offset > 0) throw new MemoryError('搜索游标已过期，请从第一页重新查询', 409)
      const runtime = await input.runtime()
      if (!runtime.query) throw new MemoryError('原生文档查询接口不可用', 503)
      const facts = await runtime.facts(
        {
          scope: input.scope,
          scenario: 'px.conversation-search',
          budget: {
            maxProjectionCharacters: 0,
            maxRoutes: 1,
            maxActions: 0,
            maxEvidenceResults: 6,
            maxEvidenceCharacters: 16000
          }
        },
        signal
      )
      const projection = await runtime.project(
        {
          scope: input.scope,
          sourceInstanceKey: input.sourceKey,
          expectedRevision: facts.revision,
          includeProjection: false,
          mode: 'routed',
          maxCharacters: 0
        },
        signal
      )
      const grant = projection.readGrant,
        value = grant?.value as any
      if (!grant || grant.schema !== 'dsh-mnemon.documents/v1' || !Array.isArray(value?.documentIds))
        throw new MemoryError('原生文档读取范围不可用', 503)
      const permitted = new Set(value.documentIds),
        candidates = new Map(
          input.candidates.filter((row) => permitted.has(row.id)).map((row) => [row.id, row])
        )
      const groups = new Map<number, string[]>()
      for (const row of candidates.values()) {
        if (!groups.has(row.strength)) groups.set(row.strength, [])
        groups.get(row.strength)!.push(row.id)
      }
      plan = {
        signature,
        scope: input.scope,
        sourceKey: input.sourceKey,
        grant,
        candidates,
        buckets: [...groups.values()].map((ids) => ({
          remaining: new Set(ids),
          heads: [],
          exhausted: false
        })),
        materialized: [],
        done: false,
        at: Date.now(),
        queue: Promise.resolve(),
        reads: 0
      }
      this.plans.set(signature, plan)
      while (this.plans.size > 32) this.plans.delete(this.plans.keys().next().value!)
    }
    const active = plan
    active.at = Date.now()
    const task = active.queue
      .catch(() => {})
      .then(async () => {
        signal.throwIfAborted()
        if (offset > active.materialized.length)
          throw new MemoryError('请使用上次返回的 nextOffset 顺序读取', 409)
        let reads = 0
        const fill = async (bucket: Bucket) => {
          if (bucket.heads.length || bucket.exhausted) return
          if (!bucket.remaining.size) {
            bucket.exhausted = true
            return
          }
          signal.throwIfAborted()
          if (++reads > 12) throw new MemoryError('本页读取达到预算，请缩小检索词后重新查询', 409)
          const runtime = await input.runtime(),
            value = active.grant.value as any
          const grant = {
            ...active.grant,
            id: active.grant.id + '/page-' + ++active.reads,
            value: { ...value, documentIds: [...bucket.remaining], archivedDocumentIds: [] }
          }
          const result = await runtime.query!({
            // Backend-only subview; derived strictly by narrowing a Source-issued grant, never by model-supplied ids.
            view: { id: 'px-conversation-search-' + signature + '-' + active.reads, scope: input.scope },
            route: {
              id: input.sourceKey + '/search',
              sourceInstanceKey: input.sourceKey,
              sourceRouteId: 'search',
              description: 'Scoped native document search',
              capability: 'search',
              inputSchema: { type: 'object' },
              readGrantId: grant.id,
              maxCalls: 1,
              maxResults: 6,
              maxCharacters: 16000
            },
            grant,
            input: { query: input.query, limit: 6 },
            signal
          })
          signal.throwIfAborted()
          const hits = result.items.filter(
            (item) =>
              (item.provenance as any)?.kind === 'match' &&
              typeof item.score === 'number' &&
              Number.isFinite(item.score) &&
              item.score > 0
          )
          for (const hit of hits) {
            const candidate = active.candidates.get(hit.id)
            if (!candidate || !bucket.remaining.has(hit.id) || Number(hit.revision) !== candidate.revision)
              throw new MemoryError('文档在检索期间变化，请重新查询', 409)
            bucket.remaining.delete(hit.id)
            bucket.heads.push({
              ...candidate,
              relevance: hit.score!,
              rank: hit.score! + candidate.strength * 0.5
            })
          }
          bucket.heads.sort(compare)
          if (hits.length < 6) bucket.exhausted = true
        }
        while (active.materialized.length < offset + 8 && !active.done) {
          // Each refill reads only its original native grant subset; other personas never enter this View.
          for (const bucket of active.buckets) await fill(bucket)
          const heads = active.buckets
            .filter((bucket) => bucket.heads.length)
            .sort((a, b) => compare(a.heads[0], b.heads[0]))
          if (!heads.length) {
            active.done = true
            break
          }
          active.materialized.push(heads[0].heads.shift()!)
        }
        const rows = active.materialized.slice(offset, offset + 8)
        const hasMore =
          active.materialized.length > offset + rows.length ||
          (!active.done && active.buckets.some((bucket) => bucket.heads.length || !bucket.exhausted))
        return {
          rows,
          cursor: signature,
          nextOffset: hasMore ? offset + rows.length : null,
          partial: hasMore
        }
      })
    active.queue = task
    try {
      return await task
    } catch (error) {
      if (this.plans.get(signature) === active) this.plans.delete(signature)
      throw error
    }
  }
  clear() {
    this.plans.clear()
  }
}
