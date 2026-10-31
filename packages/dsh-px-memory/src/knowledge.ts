import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { MemorySourceRuntime } from 'dsh-mnemon/contracts'
import { MemoryError, projectKey, publicSession, type MemoryStore } from './store'
import {
  MemoryFeedback,
  feedbackHash,
  rankMemoryMatch,
  presentFeedback,
  type FeedbackKind,
  type FeedbackEvidence
} from './memory-feedback'

export const KNOWLEDGE_SCOPES = ['persona', 'persona-project', 'project', 'global'] as const
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number]
export const SCOPE_LABELS: Record<KnowledgeScope, string> = {
  persona: '人格私有',
  'persona-project': '人格 × 项目',
  project: '项目共享',
  global: '全局共享'
}
export interface KnowledgeCaller {
  sessionId: string
  project?: string
  actor?: 'human' | 'model'
}
export interface FileReference {
  path: string
  version: string
  observedAt: string
}
interface Namespace {
  scope: KnowledgeScope
  personaId?: string
  project?: string
  conversation?: { provider: string; accountId: string; id: string }
}
interface Origin extends Namespace {
  id: string
  revision: number
  contentHash: string
}
interface Envelope {
  schema: 1
  sources: FileReference[]
  events?: Array<{ sessionId: string; seq: number; kind: string; eventHash: string; time: number | null }>
  author?: { kind: 'human' | 'model' | 'unknown'; at: string }
  sharedBy?: { kind: 'human' | 'model'; at: string }
  origin?: Origin
  previous?: { revision: number; contentHash: string }
  migration?: Origin
}
export interface KnowledgeDocument {
  id: string
  title: string
  content: string
  revision: number
  contentHash: string
  status: string
  updatedAt: string
  sourcePaths: string[]
  sessionIds: string[]
}
const prefix = '<!-- dsh-px-knowledge:'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const contentRevision = (snapshot: any): string =>
  digest(snapshot.documents.map((d: any) => [d.id, d.revision, d.contentHash, d.title, d.status, d.healthy]))
function unwrap(document: KnowledgeDocument): { metadata: Envelope; body: string } {
  const end = document.content.indexOf(' -->\n')
  if (!document.content.startsWith(prefix) || end < 0)
    throw new MemoryError('知识来源信息缺失，请检查此条目的原文', 409)
  let metadata: Envelope
  try {
    metadata = JSON.parse(document.content.slice(prefix.length, end))
  } catch {
    throw new MemoryError('知识来源信息无效', 409)
  }
  if (metadata.schema !== 1 || !Array.isArray(metadata.sources))
    throw new MemoryError('知识版本格式不受支持', 409)
  return { metadata, body: document.content.slice(end + 5) }
}
function wrap(metadata: Envelope, body: string): string {
  return prefix + JSON.stringify(metadata) + ' -->\n' + body
}
function bounded(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new MemoryError(`${label}为空或超过限制`)
  return value.trim()
}
function validateNamespace(ns: Namespace): void {
  if (!ns || !KNOWLEDGE_SCOPES.includes(ns.scope)) throw new MemoryError('知识来源范围无效', 409)
  const privateScope = ns.scope === 'persona' || ns.scope === 'persona-project' || !!ns.conversation,
    projectScope = ns.scope === 'project' || ns.scope === 'persona-project'
  if (
    privateScope !==
      (typeof ns.personaId === 'string' && ns.personaId.length > 0 && ns.personaId.length <= 200) ||
    projectScope !== (typeof ns.project === 'string' && ns.project.length > 0)
  )
    throw new MemoryError('知识来源身份无效', 409)
  if (
    ns.conversation &&
    (ns.scope !== 'project' ||
      [ns.conversation.provider, ns.conversation.accountId, ns.conversation.id].some(
        (value) => typeof value !== 'string' || !value || value.length > 200
      ))
  )
    throw new MemoryError('交流记忆来源身份无效', 409)
}

const legacyConversationTitle = (title: unknown): boolean =>
  typeof title === 'string' && /^QQ 经历 \/ [^/]{1,200} \/ /.test(title)

/** Mnemon owns document writes, locks, revisions, archives and search. PX only selects scope and adds provenance. */
export class KnowledgeBank {
  private readonly feedbackStore: MemoryFeedback
  private runtimes = new Map<string, MemorySourceRuntime>()
  private factory?: Promise<typeof import('dsh-mnemon-source-documents')>
  private readonly conversationCallers = new WeakMap<KnowledgeCaller, Namespace>()
  private readonly migrations = new Map<string, Promise<void>>()
  constructor(
    private root: string,
    private identities: MemoryStore,
    private observeFile?: (caller: KnowledgeCaller, path: string) => Promise<FileReference | undefined>,
    private readEvidence?: (
      caller: KnowledgeCaller,
      source: string,
      seq: number,
      signal?: AbortSignal
    ) => Promise<any>
  ) {
    mkdirSync(root, { recursive: true })
    this.feedbackStore = new MemoryFeedback(join(root, 'feedback.sqlite'))
  }
  private feedbackTarget(
    caller: KnowledgeCaller,
    ns: Namespace,
    document: Pick<KnowledgeDocument, 'id' | 'revision' | 'contentHash'>
  ): string {
    const binding = this.identities.read().bindings[caller.sessionId]
    if (!binding || binding.pending) return ''
    const audience = publicSession(binding)
      ? {
          provider: binding.channel!.provider,
          accountId: binding.channel!.accountId,
          conversationId: binding.channel!.conversationId
        }
      : 'private'
    return feedbackHash([
      ns,
      document.id,
      document.revision,
      document.contentHash,
      binding.personaId,
      audience
    ])
  }
  async feedback(
    caller: KnowledgeCaller,
    scope: KnowledgeScope,
    input: {
      id: string
      documentRevision: number
      kind: FeedbackKind
      reason: string
      evidence?: { sessionId: string; seq: number }
    },
    signal?: AbortSignal
  ): Promise<any> {
    const ns = this.namespace(caller, scope),
      id = bounded(input.id, '知识编号', 300),
      reason = bounded(input.reason, '反馈理由', 1000),
      actor = caller.actor === 'human' ? 'human' : 'model'
    if (!['confirmed', 'useful', 'not-applicable', 'disputed'].includes(input.kind))
      throw new MemoryError('反馈类型无效')
    if (actor === 'model' && !['useful', 'not-applicable'].includes(input.kind))
      throw new MemoryError('确认与判定不正确需由用户操作；模型只能记录有依据的应用反馈', 403)
    const before = (await this.call(ns, 'document', { id })).value as KnowledgeDocument
    this.assertReadableDocument(ns, before)
    if (before.status !== 'active' || before.revision !== input.documentRevision)
      throw new MemoryError('知识已变化或归档，请重新读取后反馈', 409)
    const target = this.feedbackTarget(caller, ns, before)
    if (!target) throw new MemoryError('反馈需要已固定的人格会话', 409)
    let evidence: FeedbackEvidence | undefined
    if (input.evidence !== undefined) {
      const ref = input.evidence
      if (
        !ref ||
        typeof ref.sessionId !== 'string' ||
        !Number.isSafeInteger(ref.seq) ||
        ref.seq < 0 ||
        !this.readEvidence
      )
        throw new MemoryError('反馈需要可读取的原始事件依据')
      const record = await this.readEvidence(caller, ref.sessionId, ref.seq, signal)
      if (
        !['user', 'tool-result'].includes(record?.kind) ||
        typeof record.text !== 'string' ||
        !record.text.trim()
      )
        throw new MemoryError('模型复述或记忆检索不是独立反馈依据', 403)
      if (
        actor === 'model' &&
        input.kind === 'useful' &&
        (record.kind !== 'tool-result' || record.failed !== false)
      )
        throw new MemoryError('成功应用需要原生工具的成功回执；交流陈述不等于任务成功', 403)
      evidence = {
        sessionId: ref.sessionId,
        seq: ref.seq,
        kind: record.kind,
        hash: feedbackHash([record.kind, record.tool ?? null, record.text.trim()])
      }
    } else if (actor === 'model')
      throw new MemoryError('模型应用反馈必须引用原始事件，不能通过重复检索自我加权', 403)
    signal?.throwIfAborted()
    const now = (await this.call(ns, 'document', { id })).value as KnowledgeDocument
    if (
      now.status !== 'active' ||
      now.revision !== before.revision ||
      now.contentHash !== before.contentHash ||
      this.feedbackTarget(caller, this.namespace(caller, scope), now) !== target
    )
      throw new MemoryError('知识或反馈受众已变化，未采纳迟到反馈', 409)
    // Human UI gives one opinion of each kind; repeated clicks/restarts cannot manufacture more votes.
    const origin = feedbackHash(actor === 'human' ? ['human'] : ['native-evidence', evidence!.hash])
    const result = this.feedbackStore.record(target, origin, {
      actor,
      kind: input.kind,
      reason,
      ...(evidence ? { evidence } : {}),
      at: new Date().toISOString()
    })
    return {
      ...result,
      feedback: presentFeedback(result.feedback, caller.actor),
      ...(await this.read(caller, scope, id, true))
    }
  }
  namespace(caller: KnowledgeCaller, scope: KnowledgeScope): Namespace {
    if (!KNOWLEDGE_SCOPES.includes(scope)) throw new MemoryError('知识范围无效')
    const state = this.identities.read(),
      binding = state.bindings[caller.sessionId]
    const granted = this.conversationCallers.get(caller)
    if (granted) {
      if (scope !== 'project' || digest(granted) !== digest(this.conversationNamespace(caller)))
        throw new MemoryError('交流记忆调用范围已变化', 403)
      return structuredClone(granted)
    }
    if (publicSession(binding) && (scope === 'persona' || scope === 'persona-project'))
      throw new MemoryError('公共聊天不能读取人格私有知识', 403)
    if ((scope === 'persona' || scope === 'persona-project') && (!binding || binding.pending))
      throw new MemoryError('请先建立当前会话人格', 409)
    const project = projectKey(
      publicSession(binding) && binding.channel?.workspace ? binding.channel.workspace : caller.project
    )
    if ((scope === 'project' || scope === 'persona-project') && !project)
      throw new MemoryError('此范围需要当前项目目录')
    return {
      scope,
      ...(scope === 'persona' || scope === 'persona-project' ? { personaId: binding.personaId } : {}),
      ...(scope === 'project' || scope === 'persona-project' ? { project: project! } : {})
    }
  }
  /** An in-process capability, not a caller-controlled JSON flag. Ordinary knowledge routes cannot mint it. */
  conversationCaller(caller: KnowledgeCaller): KnowledgeCaller {
    const value = { ...caller }
    this.conversationCallers.set(value, this.conversationNamespace(value))
    return value
  }
  private conversationNamespace(caller: KnowledgeCaller): Namespace {
    const state = this.identities.read(),
      binding = state.bindings[caller.sessionId],
      channel = binding?.channel
    const persona = state.personas.find((row) => row.id === binding?.personaId)
    if (
      !binding ||
      binding.pending ||
      !publicSession(binding) ||
      !channel?.workspace ||
      projectKey(caller.project) !== projectKey(channel.workspace) ||
      !persona ||
      (caller.actor !== 'human' && (persona.archived || !persona.memoryEnabled))
    )
      throw new MemoryError('交流记忆调用范围已变化或已关闭', 403)
    return {
      scope: 'project',
      personaId: binding.personaId,
      project: projectKey(channel.workspace)!,
      conversation: { provider: channel.provider, accountId: channel.accountId, id: channel.conversationId }
    }
  }
  private exportable(
    ns: Namespace,
    document: Pick<KnowledgeDocument, 'title'> & Partial<KnowledgeDocument>
  ): boolean {
    if (ns.conversation || !legacyConversationTitle(document.title)) return true
    try {
      const meta = unwrap(document as KnowledgeDocument).metadata
      return !!meta.sharedBy
    } catch {
      return false
    }
  }
  private assertReadableDocument(
    ns: Namespace,
    document: Pick<KnowledgeDocument, 'title'> & Partial<KnowledgeDocument>
  ): void {
    if (!this.exportable(ns, document))
      throw new MemoryError('此条目属于人格交流记忆，请从对应聊天的记忆入口读取', 403)
  }
  /** Imports generated notes into an owner+account+conversation namespace; original provenance remains readable internally. */
  async prepareConversation(caller: KnowledgeCaller, topicPrefix: string): Promise<void> {
    const target = this.namespace(caller, 'project')
    if (!target.conversation || topicPrefix !== `QQ 经历 / ${target.personaId} / `)
      throw new MemoryError('交流记忆迁移范围无效', 403)
    const key = digest(target),
      active = this.migrations.get(key)
    if (active) return active
    const work = this.migrateConversation(caller, target, topicPrefix).finally(() => {
      if (this.migrations.get(key) === work) this.migrations.delete(key)
    })
    this.migrations.set(key, work)
    return work
  }
  private async migrateConversation(
    caller: KnowledgeCaller,
    target: Namespace,
    topicPrefix: string
  ): Promise<void> {
    const originNs = this.namespace({ ...caller }, 'project')
    const initial = await this.call(originNs, 'snapshot')
    const pending = initial.value.documents.filter(
      (row: any) => row.status === 'active' && row.title.startsWith(topicPrefix)
    )
    let copied = 0,
      remaining = 0
    for (const row of pending) {
      const source = (await this.call(originNs, 'document', { id: row.id })).value as KnowledgeDocument
      const { metadata, body } = unwrap(source)
      if (metadata.sharedBy) continue
      let observation: any
      try {
        observation = JSON.parse(body)
      } catch {
        throw new MemoryError('旧交流记忆格式需要检查；原记录已保留', 409)
      }
      if (observation.kind !== 'conversation-observation' || observation.version !== 1)
        throw new MemoryError('旧交流记忆类型需要检查；原记录已保留', 409)
      const destination = await this.call(target, 'snapshot')
      const existing = destination.value.documents.find(
        (doc: any) => doc.title === source.title && doc.status === 'active'
      )
      const migration = {
        ...originNs,
        id: source.id,
        revision: source.revision,
        contentHash: source.contentHash
      }
      if (existing) {
        const migrated = unwrap((await this.call(target, 'document', { id: existing.id })).value).metadata
          .migration
        if (
          !migrated ||
          migrated.id !== source.id ||
          migrated.revision !== source.revision ||
          migrated.contentHash !== source.contentHash
        )
          throw new MemoryError('新旧交流记忆均有变化，请核对后合并；未覆盖任一原文', 409)
      } else {
        if (copied >= 32) {
          remaining++
          continue
        }
        await this.write(
          caller,
          'project',
          {
            key: source.title,
            body,
            sources: metadata.sources,
            revision: contentRevision(destination.value)
          },
          undefined,
          metadata.author ?? { kind: 'unknown', at: source.updatedAt },
          migration
        )
        copied++
      }
      const current = await this.call(originNs, 'snapshot')
      const latest = current.value.documents.find((doc: any) => doc.id === source.id)
      if (
        latest?.status !== 'active' ||
        latest.revision !== source.revision ||
        latest.contentHash !== source.contentHash
      )
        throw new MemoryError('旧交流记忆在迁移期间变化，已保留副本，请重新核对', 409)
      // Keep a hidden provenance anchor for already-authorized shared copies. A later
      // correction/archive of the private record invalidates the anchor first.
    }
    if (remaining) throw new MemoryError('已迁移一批交流记忆，请再次读取以继续；原记录保留', 409)
  }
  private async invalidateMigratedSource(origin?: Origin): Promise<void> {
    if (!origin) return
    const { id, revision, contentHash, ...ns } = origin
    const source = await this.call(ns, 'snapshot'),
      row = source.value.documents.find((item: any) => item.id === id)
    if (!row || row.status !== 'active') return
    if (row.revision !== revision || row.contentHash !== contentHash)
      throw new MemoryError('迁移来源已有其他修改，请核对后再纠正；原件保留', 409)
    await this.call(
      ns,
      'archive',
      { id, documentRevision: revision, summary: '人格交流记忆已有更新，旧共享依据不再作为当前结论。' },
      source.revision
    )
  }
  async conversationAlias(caller: KnowledgeCaller, id: string): Promise<string | undefined> {
    bounded(id, '交流记忆编号', 300)
    const ns = this.namespace(caller, 'project')
    if (!ns.conversation) throw new MemoryError('交流记忆范围无效', 403)
    const snapshot = await this.call(ns, 'snapshot')
    for (const row of snapshot.value.documents) {
      const migrated = unwrap((await this.call(ns, 'document', { id: row.id })).value).metadata.migration
      if (migrated?.id === id) return row.id
    }
  }
  private async runtime(ns: Namespace): Promise<MemorySourceRuntime> {
    validateNamespace(ns)
    const key = digest(ns),
      existing = this.runtimes.get(key)
    if (existing) return existing
    const module = await (this.factory ??= import('dsh-mnemon-source-documents').catch((e) => {
      this.factory = undefined
      throw e
    }))
    // A fixed Documents dataDir is shared even when workspaceId changes. Every namespace needs its own runtime directory.
    const runtime = module
      .createDocumentsMemorySource({ dataDir: join(this.root, ns.scope, key), limitBytes: 10 * 1024 * 1024 })
      .create({
        sourceInstanceKey: 'px-knowledge-' + key,
        provenance: { packageName: 'dsh-px-memory', entryId: 'px-knowledge' }
      })
    if (this.runtimes.size >= 64) {
      const oldest = this.runtimes.keys().next().value!
      await this.runtimes.get(oldest)?.dispose?.()
      this.runtimes.delete(oldest)
    }
    this.runtimes.set(key, runtime)
    return runtime
  }
  private async call(ns: Namespace, operation: string, input: any = {}, revision?: string): Promise<any> {
    const runtime = await this.runtime(ns)
    const mutate = operation === 'mutate' || operation === 'archive'
    if (mutate && (!revision || typeof revision !== 'string'))
      throw new MemoryError('请先读取当前知识版本', 409)
    return runtime.manage!({
      scope: { storage: 'workspace', workspaceId: ns.project ?? this.root },
      sourceInstanceKey: 'px-knowledge-' + digest(ns),
      mode: mutate ? 'mutate' : 'read',
      operation,
      input,
      expectedRevision: revision,
      confirmed: mutate
    })
  }
  async catalog(caller: KnowledgeCaller, scope: KnowledgeScope): Promise<any> {
    const ns = this.namespace(caller, scope),
      result = await this.call(ns, 'snapshot')
    const documents = []
    for (const row of result.value.documents) {
      const document =
        !ns.conversation && legacyConversationTitle(row.title)
          ? (await this.call(ns, 'document', { id: row.id })).value
          : row
      if (this.exportable(ns, document)) documents.push(row)
    }
    return {
      scope,
      label: SCOPE_LABELS[scope],
      revision: contentRevision(result.value),
      documents: documents.map((d: any) => ({
        id: d.id,
        key: d.title,
        revision: d.revision,
        contentHash: d.contentHash,
        status: d.status,
        updatedAt: d.updatedAt,
        healthy: d.healthy,
        feedback: (() => {
          const f = this.feedbackStore.view(this.feedbackTarget(caller, ns, d))
          return { confirmed: f.confirmed, disputed: f.disputed, strength: f.strength, count: f.count }
        })()
      }))
    }
  }
  private async present(ns: Namespace, document: KnowledgeDocument, caller: KnowledgeCaller): Promise<any> {
    this.assertReadableDocument(ns, document)
    const { metadata, body } = unwrap(document)
    const feedback = this.feedbackStore.view(this.feedbackTarget(caller, ns, document))
    let stale = false,
      sourceState = 'original'
    if (metadata.origin) {
      const { id, revision, contentHash, ...originNs } = metadata.origin
      try {
        const original = (await this.call(originNs, 'document', { id })).value
        stale =
          original.status !== 'active' ||
          original.revision !== revision ||
          original.contentHash !== contentHash
        sourceState = stale ? 'shared-source-changed' : 'shared-snapshot'
      } catch {
        stale = true
        sourceState = 'shared-source-unavailable'
      }
    }
    const sourceFiles = []
    for (const source of metadata.sources) {
      let state = 'unavailable'
      try {
        const current = await this.observeFile?.(caller, source.path)
        state = !current ? 'missing' : current.version === source.version ? 'current' : 'changed'
      } catch {}
      sourceFiles.push({ ...source, state })
      if (state !== 'current') {
        stale = true
        sourceState = 'file-source-' + state
      }
    }
    return {
      id: document.id,
      key: document.title,
      scope: ns.scope,
      revision: document.revision,
      contentHash: document.contentHash,
      status: document.status,
      current: document.status === 'active' && !stale && !feedback.disputed,
      feedback: presentFeedback(feedback, caller.actor),
      sourceState,
      body,
      sources: sourceFiles,
      events: metadata.events ?? [],
      author: metadata.author ?? { kind: 'unknown' },
      sourceMeaning: 'File versions track freshness; they do not prove the content supports every claim.',
      previous: metadata.previous,
      sharedFrom: metadata.origin
        ? { scope: metadata.origin.scope, revision: metadata.origin.revision }
        : undefined
    }
  }
  async read(
    caller: KnowledgeCaller,
    scope: KnowledgeScope,
    id: string,
    includeHistorical = false
  ): Promise<any> {
    const ns = this.namespace(caller, scope)
    bounded(id, '条目编号', 300)
    let result
    try {
      result = await this.call(ns, 'document', { id })
    } catch (error) {
      if (error instanceof Error && error.message === `document not found: ${id}`)
        throw new MemoryError('此知识条目不在当前可见范围内，或已不存在', 404)
      throw error
    }
    const document = await this.present(ns, result.value, caller)
    if (!document.current && !includeHistorical) {
      delete document.body
      document.requiresHistoricalRead = true
    }
    const snapshot = (await this.call(ns, 'snapshot')).value,
      now = snapshot.documents.find((d: any) => d.id === document.id)
    if (
      !now ||
      now.revision !== document.revision ||
      now.contentHash !== document.contentHash ||
      now.status !== document.status
    )
      throw new MemoryError('知识读取期间发生变化，请重新读取', 409)
    return { revision: contentRevision(snapshot), document }
  }
  async search(
    caller: KnowledgeCaller,
    scope: KnowledgeScope,
    query: string,
    includeHistorical = false
  ): Promise<any> {
    const ns = this.namespace(caller, scope),
      result = await this.call(ns, 'search', {
        query: bounded(query, '关键词', 256),
        limit: 20,
        includeArchived: includeHistorical
      })
    const matches = await Promise.all(
      result.value.results
        .filter((d: KnowledgeDocument) => this.exportable(ns, d))
        .map(async (d: KnowledgeDocument & { score?: number }) => {
          const item = await this.present(ns, d, caller),
            lexicalScore = Number.isFinite(d.score) ? d.score! : 0
          return { ...item, relevance: lexicalScore, rank: rankMemoryMatch(lexicalScore, item.feedback) }
        })
    )
    const snapshot = (await this.call(ns, 'snapshot')).value
    if (
      matches.some(
        (d) =>
          !snapshot.documents.some(
            (now: any) =>
              now.id === d.id &&
              now.revision === d.revision &&
              now.contentHash === d.contentHash &&
              now.status === d.status
          )
      )
    )
      throw new MemoryError('知识查询期间发生变化，请重新查询', 409)
    return {
      scope,
      revision: contentRevision(snapshot),
      results: matches
        .filter((d) => includeHistorical || d.current)
        .sort((a, b) => b.rank - a.rank || b.relevance - a.relevance),
      excludedHistorical: includeHistorical ? 0 : matches.filter((d) => !d.current).length
    }
  }
  async write(
    caller: KnowledgeCaller,
    scope: KnowledgeScope,
    args: {
      key: string
      body: string
      revision: string
      sources?: FileReference[]
      sourcePaths?: string[]
      sourceEvents?: Array<{ sessionId: string; seq: number }>
    },
    origin?: Origin,
    sourceAuthor?: Envelope['author'],
    migration?: Origin
  ): Promise<any> {
    const ns = this.namespace(caller, scope),
      key = bounded(args.key, '知识主题', 160),
      body = bounded(args.body, '知识正文', 64000)
    const snapshot = await this.call(ns, 'snapshot')
    if (contentRevision(snapshot.value) !== args.revision)
      throw new MemoryError('知识已经变化，请先 catalog 读取 CONTROL.revision 后再修改', 409)
    const matches = snapshot.value.documents.filter((d: any) => d.status === 'active' && d.title === key)
    if (matches.length > 1) throw new MemoryError('主题存在重复记录，请先整理为单一现行条目', 409)
    const old = matches[0]
    const oldMetadata = old
      ? unwrap((await this.call(ns, 'document', { id: old.id })).value).metadata
      : undefined
    if (!ns.conversation && legacyConversationTitle(key) && !origin && !oldMetadata?.sharedBy)
      throw new MemoryError('此主题属于人格交流记忆，请通过对应聊天的记忆入口修改', 403)
    let sources =
      args.sources ??
      (old ? unwrap((await this.call(ns, 'document', { id: old.id })).value).metadata.sources : [])
    if (args.sourcePaths !== undefined) {
      if (!Array.isArray(args.sourcePaths) || args.sourcePaths.length > 12 || !this.observeFile)
        throw new MemoryError('文件来源或原生读取服务不可用')
      sources = await Promise.all(
        args.sourcePaths.map(async (path) => {
          const ref = await this.observeFile!(caller, path)
          if (!ref) throw new MemoryError('来源文件不存在')
          return ref
        })
      )
    }
    if (
      !Array.isArray(sources) ||
      sources.length > 12 ||
      sources.some(
        (s) =>
          typeof s.path !== 'string' ||
          typeof s.version !== 'string' ||
          !Number.isFinite(Date.parse(s.observedAt))
      )
    )
      throw new MemoryError('文件版本引用无效')
    let events = oldMetadata?.events
    if (args.sourceEvents !== undefined) {
      if (!Array.isArray(args.sourceEvents) || args.sourceEvents.length > 12 || !this.readEvidence)
        throw new MemoryError('原始事件引用或读取服务不可用')
      events = []
      for (const ref of args.sourceEvents) {
        if (!ref || typeof ref.sessionId !== 'string' || !Number.isSafeInteger(ref.seq) || ref.seq < 0)
          throw new MemoryError('原始事件引用无效')
        const record = await this.readEvidence(caller, ref.sessionId, ref.seq)
        if (record?.source !== 'native-session-event' || !/^[a-f0-9]{64}$/.test(record.eventHash))
          throw new MemoryError('原始事件来源无法验证', 409)
        if (!events.some((row) => row.sessionId === ref.sessionId && row.seq === ref.seq))
          events.push({
            sessionId: ref.sessionId,
            seq: ref.seq,
            kind: record.kind,
            eventHash: record.eventHash,
            time: Number.isFinite(record.time) ? record.time : null
          })
      }
    }
    if (digest(this.namespace(caller, scope)) !== digest(ns))
      throw new MemoryError('保存期间知识受众已变化，未写入', 409)
    const metadata: Envelope = {
      schema: 1,
      sources,
      ...(events ? { events } : {}),
      author:
        sourceAuthor ??
        (origin
          ? { kind: 'unknown', at: new Date().toISOString() }
          : { kind: caller.actor ?? 'model', at: new Date().toISOString() }),
      ...((migration ?? oldMetadata?.migration) ? { migration: migration ?? oldMetadata?.migration } : {}),
      ...(origin ? { sharedBy: { kind: caller.actor ?? 'model', at: new Date().toISOString() } } : {}),
      ...(!origin && legacyConversationTitle(key) && oldMetadata?.sharedBy
        ? { sharedBy: oldMetadata.sharedBy }
        : {}),
      ...(origin ? { origin } : {}),
      ...(old ? { previous: { revision: old.revision, contentHash: old.contentHash } } : {})
    }
    const mutation = {
      action: old ? 'update' : 'create',
      ...(old ? { id: old.id } : {}),
      title: key,
      description: '由 PX 管理的现行知识；历史修订不作为当前结论。',
      content: wrap(metadata, body),
      sourcePaths: sources.map((s) => s.path),
      sessionIds: caller.sessionId ? [caller.sessionId] : []
    }
    let result: any
    if (ns.conversation) await this.invalidateMigratedSource(oldMetadata?.migration)
    try {
      result = await this.call(ns, 'mutate', mutation, snapshot.revision)
    } catch (error: any) {
      // Native search updates access timestamps. Retry only its pre-commit CAS rejection, never an uncertain write.
      if (error?.name !== 'DocumentConflictError') throw error
      const latest = await this.call(ns, 'snapshot')
      if (contentRevision(latest.value) !== args.revision)
        throw new MemoryError('知识已经变化，请先 catalog 读取 CONTROL.revision 后再修改', 409)
      result = await this.call(ns, 'mutate', mutation, latest.revision)
    }
    return {
      revision: contentRevision(result.value.snapshot),
      document: await this.present(ns, result.value.document, caller)
    }
  }
  async share(
    caller: KnowledgeCaller,
    from: KnowledgeScope,
    id: string,
    to: KnowledgeScope,
    revision: string,
    expectedSourceRevision: number
  ): Promise<any> {
    if (from === to) throw new MemoryError('来源与目标范围相同')
    const ns = this.namespace(caller, from),
      document = (await this.call(ns, 'document', { id })).value as KnowledgeDocument
    this.assertReadableDocument(ns, document)
    if (document.revision !== expectedSourceRevision || document.status !== 'active')
      throw new MemoryError('来源已经变化，请重新预览后分享', 409)
    const { metadata, body } = unwrap(document)
    if (!(await this.present(ns, document, caller)).current)
      throw new MemoryError('来源不是现行知识，不能继续分享旧副本', 409)
    return this.write(
      caller,
      to,
      { key: document.title, body, revision, sources: metadata.sources },
      metadata.origin ?? { ...ns, id, revision: document.revision, contentHash: document.contentHash },
      metadata.author
    )
  }
  async archive(
    caller: KnowledgeCaller,
    scope: KnowledgeScope,
    id: string,
    revision: string,
    documentRevision: number
  ): Promise<any> {
    const ns = this.namespace(caller, scope),
      current = await this.call(ns, 'snapshot')
    if (contentRevision(current.value) !== revision)
      throw new MemoryError('知识已经变化，请刷新后再归档', 409)
    const target = current.value.documents.find((row: any) => row.id === id)
    if (target) {
      const document = (await this.call(ns, 'document', { id })).value
      this.assertReadableDocument(ns, document)
      if (ns.conversation) await this.invalidateMigratedSource(unwrap(document).metadata.migration)
    }
    const result = await this.call(
      ns,
      'archive',
      { id, documentRevision, summary: '由用户归档，不再用于当前结论。' },
      current.revision
    )
    return {
      revision: contentRevision(result.value.snapshot),
      document: await this.present(ns, result.value.document, caller)
    }
  }
  async dispose(): Promise<void> {
    for (const runtime of this.runtimes.values()) await runtime.dispose?.()
    this.runtimes.clear()
    this.feedbackStore.close()
  }
}
