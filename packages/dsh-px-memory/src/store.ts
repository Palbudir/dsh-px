import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  statSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parsePersonaExpression, type PersonaExpression } from '../../shared/persona-expression'
import { parsePersonaResources, type PersonaResources } from '../../shared/persona-resources'
import {
  audienceOf,
  sameConversationAudience,
  validateSessionChannel,
  type SessionChannel
} from '../../shared/subject-context'
export type { SessionChannel } from '../../shared/subject-context'

export interface MemoryEntry {
  id: string
  text: string
  project: string | null
  updatedAt: string
  entryRevision?: number
  provenance?: MemoryProvenance
  previous?: { entryRevision: number; updatedAt: string; provenance?: MemoryProvenance }
  /** Earliest retained source anchor; later manual edits must not erase the original event links. */
  origin?: { entryRevision: number; updatedAt: string; provenance?: MemoryProvenance }
  /** Read projection only; never trusted from action payloads. */
  feedback?: { confirmed: boolean; disputed: boolean; strength: number; count: number; entries?: unknown[] }
  current?: boolean
}
export interface MemoryProvenance {
  actor: 'human' | 'model' | 'unknown'
  sessionId: string
  events: Array<{ sessionId: string; seq: number; eventHash: string; kind: string; time: number | null }>
}
export interface PersonaVersion {
  revision: number
  name: string
  instructions: string
  /** Explicitly public style; unlike instructions, this can be reused by group-audience sessions. */
  expression?: PersonaExpression
}
export interface Persona extends PersonaVersion {
  id: string
  /** Resource revocation is live and independent of the adopted expression revision. */
  resources?: PersonaResources
  memoryEnabled: boolean
  memories: MemoryEntry[]
  versions: PersonaVersion[]
  archived?: boolean
}
export interface Handoff {
  sessionId: string
  throughSeq: number
  summary: string
  createdAt: string
}
export interface SessionBinding {
  personaId: string
  personaRevision: number
  locked: boolean
  createdAt: string
  handoff?: Handoff
  pending?: boolean
  createdFrom?: string
  /** Native workspace chosen by a new persona-hub session; retained for idempotent retries. */
  creationWorkspaceId?: string
  /** Explicit creation acknowledgement is independent of runtime identity locking/pending state. */
  creation?: SessionCreation
  /** Internal analysis remains auditable in native storage, outside conversational recall. */
  purpose?: 'experience'
  channel?: SessionChannel
}
export interface SessionCreation {
  kind: 'hub' | 'continuation'
  cwd: string
  workspaceId?: string
  agentPreset?: string
  complete: boolean
}
export const publicSession = (binding?: Pick<SessionBinding, 'channel'>): boolean =>
  audienceOf(binding).kind === 'conversation'
export function samePublicConversation(
  a?: Pick<SessionBinding, 'channel'>,
  b?: Pick<SessionBinding, 'channel'>
): boolean {
  return sameConversationAudience(a, b)
}
/** Reserved PX task ids remain excluded from recall even after their temporary binding is released. */
export const isExperienceSession = (id: string): boolean =>
  /^px-experience-(?:root-)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
export const isAttentionSession = (id: string): boolean =>
  /^px-(?:qq|channel)-attention-(?:root-)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
    id
  )
export const isInternalSession = (id: string): boolean => isExperienceSession(id) || isAttentionSession(id)
export interface MemoryState {
  schemaVersion: 2
  revision: number
  personas: Persona[]
  bindings: Record<string, SessionBinding>
}
export class MemoryError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}
export function projectKey(cwd?: string): string | null {
  if (!cwd) return null
  let path = resolve(cwd)
  try {
    path = realpathSync.native(path)
  } catch {
    /* Removed workspaces retain their scope. */
  }
  return process.platform === 'win32' ? path.toLowerCase() : path
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new MemoryError('内容为空或超过长度限制')
  return value.trim()
}
export function validId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\r\n\0]/.test(value))
    throw new MemoryError('标识无效')
  return value
}
function validateMemoryProvenance(source: MemoryProvenance): void {
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new MemoryError('记忆来源格式无效', 503)
  validId(source.sessionId)
  if (
    !['human', 'model', 'unknown'].includes(source.actor) ||
    !Array.isArray(source.events) ||
    source.events.length > 6
  )
    throw new MemoryError('记忆来源无效', 503)
  for (const ref of source.events) {
    if (!ref) throw new MemoryError('记忆事件来源无效', 503)
    validId(ref.sessionId)
    if (
      !Number.isSafeInteger(ref.seq) ||
      ref.seq < 0 ||
      !/^[a-f0-9]{64}$/.test(ref.eventHash) ||
      !['user', 'assistant', 'tool-result', 'native-state', 'ledger'].includes(ref.kind) ||
      (ref.time !== null && !Number.isFinite(ref.time))
    )
      throw new MemoryError('记忆事件来源无效', 503)
  }
}
function config(p: Persona): PersonaVersion {
  return {
    revision: p.revision,
    name: p.name,
    instructions: p.instructions,
    ...(p.expression ? { expression: structuredClone(p.expression) } : {})
  }
}
function initial(): MemoryState {
  const p: Persona = {
    id: 'default',
    name: '默认助手',
    instructions: '',
    memoryEnabled: true,
    memories: [],
    revision: 1,
    versions: []
  }
  p.versions = [config(p)]
  return { schemaVersion: 2, revision: 0, personas: [p], bindings: Object.create(null) }
}
function validate(s: MemoryState): void {
  if (
    !s ||
    s.schemaVersion !== 2 ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 0 ||
    !Array.isArray(s.personas) ||
    s.personas.length > 30 ||
    !s.bindings ||
    typeof s.bindings !== 'object' ||
    Array.isArray(s.bindings)
  )
    throw new MemoryError('人格配置格式无效', 503)
  const ids = new Set<string>()
  for (const p of s.personas) {
    validId(p.id)
    text(p.name, 60, true)
    text(p.instructions, 2000)
    parsePersonaExpression(p.expression)
    parsePersonaResources(p.resources)
    if (
      ids.has(p.id) ||
      typeof p.memoryEnabled !== 'boolean' ||
      (p.archived !== undefined && typeof p.archived !== 'boolean') ||
      !Array.isArray(p.memories) ||
      p.memories.length > 40 ||
      !Number.isSafeInteger(p.revision) ||
      p.revision < 1 ||
      !Array.isArray(p.versions) ||
      p.versions.length > 100
    )
      throw new MemoryError('人格配置无效', 503)
    ids.add(p.id)
    const revisions = new Set<number>(),
      entries = new Set<string>()
    for (const v of p.versions) {
      if (
        !Number.isSafeInteger(v.revision) ||
        v.revision < 1 ||
        v.revision > p.revision ||
        revisions.has(v.revision)
      )
        throw new MemoryError('人格版本无效', 503)
      text(v.name, 60, true)
      text(v.instructions, 2000)
      parsePersonaExpression(v.expression)
      revisions.add(v.revision)
    }
    if (!revisions.has(p.revision)) throw new MemoryError('缺少当前人格版本', 503)
    for (const m of p.memories) {
      validId(m.id)
      text(m.text, 2000, true)
      if (
        entries.has(m.id) ||
        (m.project !== null && typeof m.project !== 'string') ||
        !Number.isFinite(Date.parse(m.updatedAt)) ||
        (m.entryRevision !== undefined && (!Number.isSafeInteger(m.entryRevision) || m.entryRevision < 1))
      )
        throw new MemoryError('记忆条目无效', 503)
      if (m.provenance !== undefined) validateMemoryProvenance(m.provenance)
      if (m.previous !== undefined) {
        if (
          !m.previous ||
          m.previous.entryRevision !== (m.entryRevision ?? 1) - 1 ||
          !Number.isFinite(Date.parse(m.previous.updatedAt))
        )
          throw new MemoryError('约定的前一版来源无效', 503)
        if (m.previous.provenance) validateMemoryProvenance(m.previous.provenance)
      }
      if (m.origin !== undefined) {
        if (
          !m.origin ||
          !Number.isSafeInteger(m.origin.entryRevision) ||
          m.origin.entryRevision < 1 ||
          m.origin.entryRevision >= (m.entryRevision ?? 1) ||
          !Number.isFinite(Date.parse(m.origin.updatedAt))
        )
          throw new MemoryError('记忆初始来源无效', 503)
        if (m.origin.provenance) validateMemoryProvenance(m.origin.provenance)
      }
      entries.add(m.id)
    }
    if (p.memories.reduce((n, m) => n + m.text.length, 0) > 8000)
      throw new MemoryError('每个人格的记忆合计最多 8000 字，请精简后保存')
  }
  if (!ids.has('default') || Object.keys(s.bindings).length > 20000)
    throw new MemoryError('人格或会话绑定无效', 503)
  for (const [id, b] of Object.entries(s.bindings)) {
    validId(id)
    if (b.creationWorkspaceId !== undefined) validId(b.creationWorkspaceId)
    if (b.creation !== undefined) {
      const c = b.creation
      if (!c || !['hub', 'continuation'].includes(c.kind) || typeof c.complete !== 'boolean')
        throw new MemoryError('会话创建回执无效', 503)
      text(c.cwd, 4096, true)
      if (c.workspaceId !== undefined) validId(c.workspaceId)
      if (c.agentPreset !== undefined) validId(c.agentPreset)
      if (
        (c.kind === 'hub' &&
          (!c.workspaceId ||
            c.workspaceId !== b.creationWorkspaceId ||
            b.createdFrom ||
            b.channel ||
            b.handoff)) ||
        (c.kind === 'continuation' && !b.createdFrom)
      )
        throw new MemoryError('会话创建回执与归属不一致', 503)
    }
    if (b.channel) {
      try {
        validateSessionChannel(b.channel)
      } catch (error) {
        throw new MemoryError(error instanceof Error ? error.message : '会话渠道边界无效', 503)
      }
    }
    if (b.purpose !== undefined && b.purpose !== 'experience') throw new MemoryError('会话用途无效', 503)
    if (b.createdFrom !== undefined) {
      validId(b.createdFrom)
      if (b.createdFrom === id) throw new MemoryError('会话创建来源无效', 503)
    }
    const p = s.personas.find((p) => p.id === b.personaId)
    if (
      !p?.versions.some((v) => v.revision === b.personaRevision) ||
      typeof b.locked !== 'boolean' ||
      (b.pending !== undefined && typeof b.pending !== 'boolean') ||
      !Number.isFinite(Date.parse(b.createdAt))
    )
      throw new MemoryError('会话人格绑定无效', 503)
    if (b.handoff) {
      validId(b.handoff.sessionId)
      text(b.handoff.summary, 12000)
      if (
        b.handoff.sessionId === id ||
        !Number.isSafeInteger(b.handoff.throughSeq) ||
        b.handoff.throughSeq < 0 ||
        !Number.isFinite(Date.parse(b.handoff.createdAt))
      )
        throw new MemoryError('交接范围无效', 503)
    }
  }
}
/** Native logs own conversation history; this store owns identity and explicit private memory. */
export class MemoryStore {
  private readonly listeners = new Set<() => void>()
  private authorizationCache?: { version: string; state: MemoryState }
  constructor(private path: string) {}
  /** Immutable authorization reads avoid reparsing an unchanged file; ordinary editable reads stay detached. */
  authorizationSnapshot(): MemoryState {
    const version = (): string => {
      try {
        const s = statSync(this.path, { bigint: true })
        return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':')
      } catch (error: any) {
        if (error?.code === 'ENOENT') return 'missing'
        throw error
      }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = version()
      if (this.authorizationCache?.version === before) return this.authorizationCache.state
      const state = this.read()
      if (before !== version()) continue
      const freeze = (value: any): void => {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
        for (const child of Object.values(value)) freeze(child)
        Object.freeze(value)
      }
      freeze(state)
      this.authorizationCache = { version: before, state }
      return state
    }
    throw new MemoryError('人格授权文件正在变化，请重试', 409)
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  createPersona(name: unknown): { id: string; name: string } {
    const label = text(name, 60, true),
      state = this.read()
    if (state.personas.some((p) => p.name === label && !p.archived))
      throw new MemoryError('已有同名人格，请直接选择或使用其他名字', 409)
    const id = randomUUID()
    this.change(state.revision, (next) =>
      next.personas.push({
        id,
        name: label,
        instructions: '',
        memoryEnabled: true,
        memories: [],
        revision: 1,
        versions: [{ revision: 1, name: label, instructions: '' }]
      })
    )
    return { id, name: label }
  }
  read(): MemoryState {
    if (!existsSync(this.path)) return initial()
    const raw = readFileSync(this.path, 'utf8')
    if (raw.length > 12_000_000) throw new MemoryError('人格配置超过容量限制', 503)
    let s = JSON.parse(raw)
    if (s?.schemaVersion === 1 && Array.isArray(s.personas) && s.sessions && typeof s.sessions === 'object') {
      s = {
        schemaVersion: 2,
        revision: s.revision,
        personas: s.personas.map((p: Persona) => ({
          ...p,
          revision: 1,
          versions: [{ revision: 1, name: p.name, instructions: p.instructions }]
        })),
        bindings: Object.fromEntries(
          Object.entries(s.sessions).map(([id, personaId]) => [
            id,
            { personaId, personaRevision: 1, locked: true, createdAt: new Date(0).toISOString() }
          ])
        )
      }
    }
    if (s?.bindings && typeof s.bindings === 'object' && !Array.isArray(s.bindings))
      Object.setPrototypeOf(s.bindings, null)
    validate(s)
    return s
  }
  change(revision: unknown, update: (state: MemoryState) => void): MemoryState {
    const s = this.read()
    if (revision !== s.revision) throw new MemoryError('记录已变化，请刷新后重试；未覆盖你的修改', 409)
    update(s)
    s.revision++
    validate(s)
    const serialized = JSON.stringify(s, null, 2)
    if (serialized.length > 12_000_000) throw new MemoryError('人格配置已达到容量限制')
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = this.path + '.' + randomUUID() + '.tmp'
    try {
      const fd = openSync(tmp, 'wx')
      try {
        writeFileSync(fd, serialized, 'utf8')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(tmp, this.path)
      this.authorizationCache = undefined
    } finally {
      if (existsSync(tmp)) unlinkSync(tmp)
    }
    // Cache observers cannot veto an already committed identity update.
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {}
    }
    return s
  }
  persona(s: MemoryState, sessionId: string): Persona {
    const b = s.bindings[sessionId],
      p = s.personas.find((p) => p.id === (b?.personaId ?? 'default'))
    if (!p) throw new MemoryError('会话的人格不存在', 503)
    const v = b ? p.versions.find((v) => v.revision === b.personaRevision) : config(p)
    if (!v) throw new MemoryError('会话的人格版本不存在', 503)
    return publicSession(b)
      ? {
          ...p,
          ...v,
          expression: v.expression,
          instructions: b.channel!.publicInstructions,
          memories: [],
          versions: [],
          memoryEnabled: false
        }
      : { ...p, ...v, expression: v.expression }
  }
  bind(
    sessionId: string,
    options: {
      parent?: string
      personaId?: string
      locked?: boolean
      handoff?: Handoff
      pending?: boolean
      createdFrom?: string
      creationWorkspaceId?: string
      creation?: SessionCreation
      purpose?: 'experience'
      channel?: SessionChannel
    } = {}
  ): MemoryState {
    validId(sessionId)
    const s = this.read(),
      existing = s.bindings[sessionId]
    if (existing) {
      if (options.personaId && options.personaId !== existing.personaId)
        throw new MemoryError('会话已绑定人格', 409)
      if (options.channel && JSON.stringify(options.channel) !== JSON.stringify(existing.channel))
        throw new MemoryError('会话的渠道或授权范围已变化，请新建会话', 409)
      if ((!options.locked || existing.locked) && (!existing.pending || options.pending === true)) return s
      return this.change(s.revision, (n) => {
        if (options.locked) n.bindings[sessionId].locked = true
        if (options.pending !== true) n.bindings[sessionId].pending = false
      })
    }
    const parent = options.parent ? s.bindings[options.parent] : undefined
    const channel = options.channel ?? parent?.channel
    if (publicSession(parent) && options.channel && !samePublicConversation(parent, { channel }))
      throw new MemoryError('公共会话不能提升为私有任务会话', 409)
    if (
      channel?.access === 'public' &&
      options.handoff &&
      !samePublicConversation({ channel }, s.bindings[options.handoff.sessionId])
    )
      throw new MemoryError('公共会话不能接续其他私有或群聊上下文', 409)
    const p = s.personas.find((p) => p.id === (options.personaId ?? parent?.personaId ?? 'default'))
    if (!p || p.archived) throw new MemoryError('人格不存在或已归档')
    const purpose =
      options.purpose ?? parent?.purpose ?? (isInternalSession(sessionId) ? 'experience' : undefined)
    return this.change(s.revision, (n) => {
      n.bindings[sessionId] = {
        personaId: p.id,
        personaRevision: !options.personaId && parent ? parent.personaRevision : p.revision,
        locked: options.locked ?? !!parent,
        createdAt: new Date().toISOString(),
        ...(options.pending ? { pending: true } : {}),
        ...(options.createdFrom ? { createdFrom: options.createdFrom } : {}),
        ...(options.creationWorkspaceId ? { creationWorkspaceId: options.creationWorkspaceId } : {}),
        ...(options.creation ? { creation: structuredClone(options.creation) } : {}),
        ...(channel ? { channel: structuredClone(channel) } : {}),
        ...(purpose ? { purpose } : {}),
        ...(options.handoff ? { handoff: options.handoff } : {})
      }
    })
  }
  /** Drop internal identities only; native logs and ordinary conversation bindings are untouched. */
  releaseExperienceBindings(ids: readonly string[]): void {
    this.releaseInternalBindings(ids.filter(isExperienceSession))
  }
  releaseInternalBindings(ids: readonly string[]): void {
    const state = this.read(),
      removable = ids.filter((id) => isInternalSession(id) && !!state.bindings[id]?.purpose)
    if (!removable.length) return
    this.change(state.revision, (next) => {
      for (const id of removable) delete next.bindings[id]
    })
  }
  action(
    revision: unknown,
    action: any,
    sessionId: string,
    project: string | null,
    provenance?: MemoryProvenance
  ): MemoryState {
    validId(sessionId)
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new MemoryError('操作内容无效')
    return this.change(revision, (s) => {
      const bound = this.persona(s, sessionId),
        p = s.personas.find((p) => p.id === bound.id)!
      const binding = () =>
        (s.bindings[sessionId] ??= {
          personaId: p.id,
          personaRevision: p.revision,
          locked: false,
          createdAt: new Date().toISOString()
        })
      switch (action.type) {
        case 'create': {
          const id = randomUUID(),
            name = text(action.name, 60, true)
          s.personas.push({
            id,
            name,
            instructions: '',
            memoryEnabled: true,
            memories: [],
            revision: 1,
            versions: [{ revision: 1, name, instructions: '' }]
          })
          if (!binding().locked) s.bindings[sessionId] = { ...binding(), personaId: id, personaRevision: 1 }
          break
        }
        case 'select': {
          if (binding().locked) throw new MemoryError('本会话已固定人格，请新建接续会话', 409)
          const next = s.personas.find((p) => p.id === action.personaId && !p.archived)
          if (!next) throw new MemoryError('人格不存在或已归档')
          s.bindings[sessionId] = { ...binding(), personaId: next.id, personaRevision: next.revision }
          break
        }
        case 'configure': {
          if (p.archived) throw new MemoryError('人格已归档')
          const name = text(action.name, 60, true),
            instructions = text(action.instructions, 2000)
          let expression = p.expression
          if (Object.hasOwn(action, 'expression')) {
            try {
              expression = parsePersonaExpression(action.expression)
            } catch (error) {
              throw new MemoryError(error instanceof Error ? error.message : '公开人格表达无效')
            }
          }
          if (typeof action.memoryEnabled !== 'boolean') throw new MemoryError('记忆开关无效')
          p.memoryEnabled = action.memoryEnabled
          if (
            name === p.name &&
            instructions === p.instructions &&
            JSON.stringify(expression) === JSON.stringify(p.expression)
          )
            break
          p.name = name
          p.instructions = instructions
          if (expression) p.expression = expression
          else delete p.expression
          const keep = new Set(
            Object.values(s.bindings)
              .filter((b) => b.personaId === p.id)
              .map((b) => b.personaRevision)
          )
          p.versions = p.versions.filter((v) => keep.has(v.revision))
          p.revision++
          p.versions.push(config(p))
          if (!binding().locked) binding().personaRevision = p.revision
          break
        }
        case 'adopt-version': {
          if (p.archived) throw new MemoryError('人格已归档')
          binding().personaRevision = p.revision
          break
        }
        case 'archive-persona': {
          if (p.id === 'default') throw new MemoryError('默认助手不能归档')
          p.archived = true
          break
        }
        case 'save': {
          if (p.archived || (!p.memoryEnabled && provenance?.actor !== 'human'))
            throw new MemoryError('人格记忆已关闭或归档')
          const content = text(action.text, 2000, true)
          if (action.scope !== 'persona' && action.scope !== 'project') throw new MemoryError('记忆范围无效')
          if (action.scope === 'project' && !project) throw new MemoryError('当前会话没有项目目录')
          const old = action.id ? p.memories.find((m) => m.id === validId(action.id)) : undefined
          if (action.id && !old) throw new MemoryError('记忆已移除，请刷新', 409)
          if (old?.project && old.project !== project) throw new MemoryError('记忆不属于当前目录')
          const entry = {
            id: old?.id ?? randomUUID(),
            text: content,
            project: action.scope === 'project' ? project : null,
            updatedAt: new Date().toISOString(),
            entryRevision: (old?.entryRevision ?? (old ? 1 : 0)) + 1,
            ...(provenance ? { provenance: structuredClone(provenance) } : {}),
            ...(old
              ? {
                  previous: {
                    entryRevision: old.entryRevision ?? 1,
                    updatedAt: old.updatedAt,
                    ...(old.provenance ? { provenance: structuredClone(old.provenance) } : {})
                  },
                  origin: structuredClone(
                    old.origin ??
                      old.previous ?? {
                        entryRevision: old.entryRevision ?? 1,
                        updatedAt: old.updatedAt,
                        ...(old.provenance ? { provenance: old.provenance } : {})
                      }
                  )
                }
              : {})
          }
          if (old) p.memories[p.memories.indexOf(old)] = entry
          else p.memories.push(entry)
          break
        }
        case 'forget': {
          const at = p.memories.findIndex((m) => m.id === validId(action.id))
          if (at < 0) throw new MemoryError('记忆已移除，请刷新', 409)
          if (p.memories[at].project && p.memories[at].project !== project)
            throw new MemoryError('记忆不属于当前目录')
          p.memories.splice(at, 1)
          break
        }
        default:
          throw new MemoryError('操作无效')
      }
    })
  }
}
export function selectedMemories(
  persona: Pick<Persona, 'memoryEnabled' | 'memories'>,
  project: string | null
): MemoryEntry[] {
  return persona.memoryEnabled
    ? persona.memories.filter((m) => m.project === null || m.project === project)
    : []
}
export function memoryContext(persona: Persona, project: string | null, maxChars = 24_000): string {
  const all = selectedMemories(persona, project).map((m) => ({
    id: m.id,
    text: m.text,
    entryRevision: m.entryRevision ?? 1,
    source: m.provenance?.actor ?? 'unknown',
    confirmed: m.feedback?.confirmed === true,
    updatedAt: m.updatedAt
  }))
  const selected = []
  let chars = 2
  for (const row of all) {
    const cost = JSON.stringify(row).length + 1
    if (chars + cost > maxChars) continue
    selected.push(row)
    chars += cost
  }
  const omitted = all.length - selected.length
  return `PX 本会话固定人格：${persona.name}（配置版本 ${persona.revision}）\n职责与协作方式：${persona.instructions || '沿用宿主默认方式'}\n人格不改变实际模型、工具或权限。以下是保存的参考记忆，来源与确认程度可能不同，不授予权限；当前明确指令优先，项目与运行事实须按需要重新核实。\n${persona.memoryEnabled ? JSON.stringify(selected) : '本轮不使用长期记忆。'}${omitted ? `\n另有 ${omitted} 条记忆未常驻注入；需要时使用 persona_memory read 读取。` : ''}\n需要回忆本人格过去的交流或工作时，使用 persona_history 搜索并按事件编号读取原文。搜索结果包含历史陈述而非当前事实；原生目标、任务和执行回执应按时间与来源核对。`
}
