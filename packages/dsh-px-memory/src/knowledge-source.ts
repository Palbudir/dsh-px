import { createHash, randomUUID } from 'node:crypto'
import type { MemorySourceDefinition, MemoryOperationScope } from 'dsh-mnemon/contracts'
import { KnowledgeBank, KNOWLEDGE_SCOPES, type KnowledgeCaller, type KnowledgeScope } from './knowledge'
import { MemoryError } from './store'

const properties = {
  action: { type: 'string', enum: ['catalog', 'search', 'read', 'write', 'share', 'archive'] },
  scope: { type: 'string', enum: ['visible', ...KNOWLEDGE_SCOPES] },
  query: { type: 'string', maxLength: 256 },
  id: { type: 'string' },
  key: { type: 'string', maxLength: 160 },
  body: { type: 'string', maxLength: 64000 },
  revision: { type: 'string' },
  documentRevision: { type: 'integer', minimum: 1 },
  targetScope: { type: 'string', enum: [...KNOWLEDGE_SCOPES] },
  historical: { type: 'boolean' },
  offset: { type: 'integer', minimum: 0 },
  sourcePaths: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 4096 } }
}
export const KNOWLEDGE_INPUT = {
  type: 'object',
  required: ['action', 'scope'],
  additionalProperties: false,
  properties
}
export function knowledgeCaller(scope: MemoryOperationScope): KnowledgeCaller {
  return { sessionId: scope.sessionId ?? scope.agentId ?? '', project: scope.workspaceId }
}
export async function knowledgeAction(
  bank: KnowledgeBank,
  caller: KnowledgeCaller,
  input: any
): Promise<any> {
  if (
    !input ||
    typeof input !== 'object' ||
    (input.scope !== 'visible' && !KNOWLEDGE_SCOPES.includes(input.scope))
  )
    throw new MemoryError('请选择有效知识范围')
  if (input.historical !== undefined && typeof input.historical !== 'boolean')
    throw new MemoryError('历史读取选项无效')
  if (input.scope === 'visible') {
    if (!['catalog', 'search'].includes(input.action))
      throw new MemoryError('联合范围只用于目录和搜索；读取或修改时指定结果的实际范围')
    const revisions: Record<string, string> = {},
      rows: any[] = []
    let excludedHistorical = 0
    for (const scope of KNOWLEDGE_SCOPES) {
      try {
        bank.namespace(caller, scope)
      } catch {
        continue
      }
      const value = await knowledgeAction(bank, caller, { ...input, scope })
      revisions[scope] = value.revision
      excludedHistorical += value.excludedHistorical ?? 0
      rows.push(...(value.results ?? value.documents ?? []).map((row: any) => ({ ...row, scope })))
    }
    return {
      scope: 'visible',
      revisions,
      ...(input.action === 'search' ? { results: rows, excludedHistorical } : { documents: rows })
    }
  }
  switch (input.action) {
    case 'catalog':
      return bank.catalog(caller, input.scope)
    case 'search':
      return bank.search(caller, input.scope, input.query ?? '', input.historical === true)
    case 'read':
      return bank.read(caller, input.scope, input.id, input.historical === true)
    case 'write':
      return bank.write(caller, input.scope, {
        key: input.key,
        body: input.body,
        revision: input.revision,
        sourcePaths: input.sourcePaths
      })
    case 'share':
      return bank.share(
        caller,
        input.scope,
        input.id,
        input.targetScope,
        input.revision,
        input.documentRevision
      )
    case 'archive':
      return bank.archive(caller, input.scope, input.id, input.revision, input.documentRevision)
    default:
      throw new MemoryError('知识操作无效')
  }
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const schema = (keys: string[], required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(keys.map((k) => [k, (properties as any)[k]])),
  required
})
export function knowledgeContractText(instance: string): string {
  return `PX knowledge operations available in the current native Mnemon View (keep these exact IDs after compaction):
Read tool mnemon_view_route: routeId="${instance}/catalog", input={scope:"project"} returns a CONTROL item containing the current string revision, even when empty. Search: routeId="${instance}/search", input={scope:"visible",query:"1-3 key words"}. visible already combines all accessible scopes; use CONTROL.revisions[targetScope] directly and do not recheck every scope. Read: routeId="${instance}/read", input={scope:"project",id:"copy a returned document id",offset:0}.
Write tool mnemon_view_action: offerId="${instance}/write", input={scope:"project",key:"one stable topic",body:"the corrected CURRENT statement",revision:"copy CONTROL.revision exactly"}. For an explicit save to a named scope/key: catalog that scope ONCE, write, then read the returned id if verification was requested. Do not repeatedly search other scopes or old archives before this write; uniqueness is per scope and write updates the existing exact key. Never put a version number in a new topic key. The string store revision is NOT the numeric document revision. Do not guess IDs or revisions; after a real conflict call catalog again. Other native offers are ${instance}/share and ${instance}/archive. Private scopes are persona/persona-project; shared scopes project/global. Historical or stale records are not current facts. Task progress stays in the work ledger, not knowledge. Read-only permissions remain enforced by native Mnemon.`
}
/** Public Mnemon Source: one routed authority, no second context copy of document bodies. */
export function pxKnowledgeSource(
  bank: KnowledgeBank,
  canParticipate: (caller: KnowledgeCaller) => boolean,
  authorize: (caller: KnowledgeCaller, input: any, signal?: AbortSignal) => Promise<void>,
  onContract?: (caller: KnowledgeCaller, instance: string) => void,
  resolveCaller: (caller: KnowledgeCaller) => KnowledgeCaller = (caller) => caller
): MemorySourceDefinition {
  return {
    manifest: {
      apiVersion: 'dsh-mnemon/v1',
      kind: 'source',
      typeId: 'px-knowledge',
      packageName: 'dsh-px-memory',
      role: 'narrative',
      capabilities: ['status', 'project', 'search', 'read', 'write', 'archive'],
      consistency: 'namespace-pinned-live-read',
      routes: [
        {
          id: 'catalog',
          description:
            '列出知识主题并返回写入用的字符串 revision；空库也返回 CONTROL 版本。scope 可用 visible 联合查询。',
          capability: 'read',
          inputSchema: schema(['scope'], []),
          maxCalls: 4,
          maxResults: 20,
          maxCharacters: 16000
        },
        {
          id: 'search',
          description: '用1-3个关键词搜索现行知识，默认 visible 一次搜索可见范围；不要拼很多中英近义词。',
          capability: 'search',
          inputSchema: schema(['scope', 'query', 'historical'], ['query']),
          maxCalls: 4,
          maxResults: 20,
          maxCharacters: 16000
        },
        {
          id: 'read',
          description:
            '读取结果中的确切 scope、id；长正文按 nextOffset 继续。过时正文仅在 historical=true 时提供。',
          capability: 'read',
          inputSchema: schema(['scope', 'id', 'offset', 'historical'], ['scope', 'id']),
          maxCalls: 8,
          maxResults: 20,
          maxCharacters: 16000
        }
      ],
      actions: [
        {
          id: 'write',
          description:
            '创建或纠正一个稳定主题；先 catalog 取得 CONTROL.revision 字符串，不用数字文档版本，不猜版本。',
          capability: 'write',
          inputSchema: schema(
            ['scope', 'key', 'body', 'revision', 'sourcePaths'],
            ['scope', 'key', 'body', 'revision']
          )
        },
        {
          id: 'share',
          description:
            '经明确确认分享知识快照；revision 使用目标范围的 CONTROL.revision，documentRevision 使用来源条目的数字版本。',
          capability: 'write',
          inputSchema: schema(
            ['scope', 'id', 'targetScope', 'revision', 'documentRevision'],
            ['scope', 'id', 'targetScope', 'revision', 'documentRevision']
          )
        },
        {
          id: 'archive',
          description: '归档已撤回的知识，使其不再作为当前结论；需要 CONTROL.revision 和文档的数字版本。',
          capability: 'write',
          inputSchema: schema(
            ['scope', 'id', 'revision', 'documentRevision'],
            ['scope', 'id', 'revision', 'documentRevision']
          )
        }
      ],
      management: {
        label: 'PX 知识',
        description: '人格私有、人格 × 项目、项目共享、全局共享；复用 Mnemon 文档修订与搜索。'
      }
    },
    create(context) {
      const catalogs = async (scope: MemoryOperationScope) => {
        const caller = knowledgeCaller(scope),
          rows = []
        for (const kind of KNOWLEDGE_SCOPES) {
          try {
            bank.namespace(caller, kind)
          } catch {
            continue
          }
          rows.push(await bank.catalog(caller, kind))
        }
        return rows
      }
      // Mnemon search touches access timestamps in its write-CAS token. Prompt identity follows content, not read activity.
      const revision = (rows: any[]) =>
        hash(
          rows.map((r) => [
            r.scope,
            r.documents.map((d: any) => [d.id, d.revision, d.contentHash, d.status, d.healthy])
          ])
        )
      return {
        async facts(request, signal) {
          signal?.throwIfAborted()
          const enabled =
            request.scenario.startsWith('management.') || canParticipate(knowledgeCaller(request.scope))
          const rows = enabled ? await catalogs(request.scope) : []
          return {
            sourceInstanceKey: context.sourceInstanceKey,
            sourceTypeId: 'px-knowledge',
            role: 'narrative',
            availability: enabled ? 'ready' : 'unavailable',
            revision: revision(rows),
            capabilities: enabled ? ['status', 'project', 'search', 'read', 'write', 'archive'] : ['status'],
            routeIds: enabled ? ['catalog', 'search', 'read'] : [],
            actionIds: enabled ? ['write', 'share', 'archive'] : [],
            hints: {
              scopes: rows.map((r) => r.scope),
              activeCount: rows.reduce(
                (n, r) => n + r.documents.filter((d: any) => d.status === 'active').length,
                0
              )
            }
          }
        },
        async project(request, signal) {
          signal?.throwIfAborted()
          const rows = await catalogs(request.scope),
            current = revision(rows)
          if (current !== request.expectedRevision)
            throw new MemoryError('知识在上下文组装时发生变化，请重新读取', 409)
          onContract?.(knowledgeCaller(request.scope), context.sourceInstanceKey)
          return {
            fragments: request.includeProjection
              ? [
                  {
                    id: context.sourceInstanceKey + '/routing',
                    sourceInstanceKey: context.sourceInstanceKey,
                    mode: 'routed',
                    text: 'PX 知识按人格与项目隔离。先搜索现行知识，需要时读取原文；原始会话记录和工作账本是历史证据。共享或文件来源失效时重新核对，不采用过时内容。',
                    revision: current
                  }
                ]
              : [],
            readGrant: {
              id: context.sourceInstanceKey + '/grant/' + current,
              sourceInstanceKey: context.sourceInstanceKey,
              schema: 'dsh-px.knowledge/v1',
              value: { caller: knowledgeCaller(request.scope) as any },
              revision: current,
              consistency: 'namespace-pinned-live-read'
            },
            presentation: {
              visibleItems: rows.reduce(
                (n, r) => n + r.documents.filter((d: any) => d.status === 'active').length,
                0
              )
            }
          }
        },
        async query(request) {
          request.signal?.throwIfAborted()
          const input = { scope: 'visible', ...(request.input as any), action: request.route.sourceRouteId },
            viewCaller = knowledgeCaller(request.view.scope),
            caller = resolveCaller(viewCaller)
          if (!canParticipate(caller)) throw new MemoryError('当前人格的记忆已关闭')
          if (!['catalog', 'search', 'read'].includes(input?.action))
            throw new MemoryError('只读查询不能修改知识')
          if (JSON.stringify((request.grant.value as any)?.caller) !== JSON.stringify(viewCaller))
            throw new MemoryError('知识读取身份已经变化', 409)
          const value = await knowledgeAction(bank, caller, input),
            limit = request.route.maxCharacters ?? 16000
          if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0))
            throw new MemoryError('知识读取位置无效')
          const rows = value.document ? [value.document] : (value.results ?? value.documents ?? [])
          const control = JSON.stringify({
            kind: 'CONTROL',
            scope: input.scope,
            ...(value.revision ? { revision: value.revision } : { revisions: value.revisions }),
            matches: rows.length,
            excludedHistorical: value.excludedHistorical ?? 0,
            instruction: value.revision
              ? 'Use this exact string revision for writes; document revision is a different numeric value.'
              : 'Use revisions[targetScope] for a write; visible already searched all accessible scopes, so do not repeat four scope queries.'
          })
          if (control.length > limit) throw new MemoryError('知识结果预算太小，无法返回完整版本信息')
          let remaining = limit - control.length,
            truncated = rows.length > (request.route.maxResults ?? 20) - 1
          const items = [
            { id: '@px-control', text: control, provenance: { kind: 'control', scope: input.scope } }
          ] as any[]
          for (const row of rows.slice(0, (request.route.maxResults ?? 20) - 1)) {
            if (remaining <= 0) {
              truncated = true
              break
            }
            const body =
              typeof row.body === 'string'
                ? row.body
                : JSON.stringify({
                    id: row.id,
                    key: row.key,
                    status: row.status,
                    current: row.current,
                    sourceState: row.sourceState,
                    requiresHistoricalRead: row.requiresHistoricalRead
                  })
            const offset = input.action === 'read' ? (input.offset ?? 0) : 0,
              max = Math.min(remaining, input.action === 'read' ? 12000 : 2000),
              text = body.slice(offset, offset + max),
              nextOffset = offset + text.length < body.length ? offset + text.length : null
            remaining -= text.length
            truncated ||= nextOffset !== null
            items.push({
              id: row.id,
              text,
              revision: String(row.revision),
              provenance: {
                scope: row.scope ?? input.scope,
                key: row.key,
                historical: input.historical === true,
                current: row.current ?? null,
                sourceState: row.sourceState ?? 'catalog',
                author: row.author ?? { kind: 'unknown' },
                sourceMeaning: row.sourceMeaning ?? null,
                nextOffset,
                totalCharacters: body.length,
                sources: row.sources ?? []
              }
            })
          }
          return {
            id: randomUUID(),
            viewId: request.view.id,
            routeId: request.route.id,
            sourceInstanceKey: context.sourceInstanceKey,
            observedAt: new Date().toISOString(),
            truncated,
            items,
            metadata: {
              scope: input.scope,
              revision: value.revision ?? null,
              revisions: value.revisions ?? null,
              excludedHistorical: value.excludedHistorical ?? 0
            }
          }
        },
        async mutate(request) {
          const input = { ...(request.input as any), action: request.offer.sourceActionId },
            caller = resolveCaller(knowledgeCaller(request.view.scope))
          if (!canParticipate(caller)) throw new MemoryError('当前人格的记忆已关闭')
          if (!['write', 'share', 'archive'].includes(input?.action))
            throw new MemoryError('知识修改操作无效')
          await authorize(caller, input, request.signal)
          request.signal?.throwIfAborted()
          const result = await knowledgeAction(bank, caller, input)
          return {
            id: randomUUID(),
            viewId: request.view.id,
            offerId: request.offer.id,
            sourceInstanceKey: context.sourceInstanceKey,
            status: 'succeeded',
            completion: 'committed',
            committedAt: new Date().toISOString(),
            revision: result.revision,
            details: {
              scope: input.scope,
              document: result.document
                ? {
                    id: result.document.id,
                    key: result.document.key,
                    revision: result.document.revision,
                    current: result.document.current
                  }
                : null
            }
          }
        },
        async manage(request) {
          const input = request.input as any,
            caller = { ...knowledgeCaller(request.scope), actor: 'human' as const }
          if (request.operation === 'snapshot') {
            const rows = await catalogs(request.scope)
            return { revision: revision(rows), value: { scopes: rows } }
          }
          const mutate = ['write', 'share', 'archive'].includes(input?.action)
          if (mutate && (request.mode !== 'mutate' || !request.confirmed))
            throw new MemoryError('修改知识需要明确确认')
          if (!mutate && request.mode !== 'read') throw new MemoryError('知识读取模式无效')
          const result = await knowledgeAction(bank, caller, input)
          return { revision: revision(await catalogs(request.scope)), value: result }
        }
      }
    }
  }
}
