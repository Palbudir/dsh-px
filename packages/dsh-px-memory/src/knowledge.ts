import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { MemorySourceRuntime } from 'dsh-mnemon/contracts'
import { MemoryError, projectKey, publicSession, type MemoryStore } from './store'

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
}
interface Origin extends Namespace {
  id: string
  revision: number
  contentHash: string
}
interface Envelope {
  schema: 1
  sources: FileReference[]
  author?: { kind: 'human' | 'model' | 'unknown'; at: string }
  sharedBy?: { kind: 'human' | 'model'; at: string }
  origin?: Origin
  previous?: { revision: number; contentHash: string }
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
  const privateScope = ns.scope === 'persona' || ns.scope === 'persona-project',
    projectScope = ns.scope === 'project' || ns.scope === 'persona-project'
  if (
    privateScope !==
      (typeof ns.personaId === 'string' && ns.personaId.length > 0 && ns.personaId.length <= 200) ||
    projectScope !== (typeof ns.project === 'string' && ns.project.length > 0)
  )
    throw new MemoryError('知识来源身份无效', 409)
}

/** Mnemon owns document writes, locks, revisions, archives and search. PX only selects scope and adds provenance. */
export class KnowledgeBank {
  private runtimes = new Map<string, MemorySourceRuntime>()
  private factory?: Promise<typeof import('dsh-mnemon-source-documents')>
  constructor(
    private root: string,
    private identities: MemoryStore,
    private observeFile?: (caller: KnowledgeCaller, path: string) => Promise<FileReference | undefined>
  ) {
    mkdirSync(root, { recursive: true })
  }
  namespace(caller: KnowledgeCaller, scope: KnowledgeScope): Namespace {
    if (!KNOWLEDGE_SCOPES.includes(scope)) throw new MemoryError('知识范围无效')
    const state = this.identities.read(),
      binding = state.bindings[caller.sessionId]
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
    const result = await this.call(this.namespace(caller, scope), 'snapshot')
    return {
      scope,
      label: SCOPE_LABELS[scope],
      revision: contentRevision(result.value),
      documents: result.value.documents.map((d: any) => ({
        id: d.id,
        key: d.title,
        revision: d.revision,
        contentHash: d.contentHash,
        status: d.status,
        updatedAt: d.updatedAt,
        healthy: d.healthy
      }))
    }
  }
  private async present(ns: Namespace, document: KnowledgeDocument, caller: KnowledgeCaller): Promise<any> {
    const { metadata, body } = unwrap(document)
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
      current: document.status === 'active' && !stale,
      sourceState,
      body,
      sources: sourceFiles,
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
      result.value.results.map((d: KnowledgeDocument) => this.present(ns, d, caller))
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
      results: matches.filter((d) => includeHistorical || d.current),
      excludedHistorical: includeHistorical ? 0 : matches.filter((d) => !d.current).length
    }
  }
  async write(
    caller: KnowledgeCaller,
    scope: KnowledgeScope,
    args: { key: string; body: string; revision: string; sources?: FileReference[]; sourcePaths?: string[] },
    origin?: Origin,
    sourceAuthor?: Envelope['author']
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
    const metadata: Envelope = {
      schema: 1,
      sources,
      author: origin
        ? (sourceAuthor ?? { kind: 'unknown', at: new Date().toISOString() })
        : { kind: caller.actor ?? 'model', at: new Date().toISOString() },
      ...(origin ? { sharedBy: { kind: caller.actor ?? 'model', at: new Date().toISOString() } } : {}),
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
  }
}
