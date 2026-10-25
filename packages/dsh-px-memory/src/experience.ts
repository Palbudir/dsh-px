import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { MemorySourceRuntime } from 'dsh-mnemon/contracts'
import { MemoryError, projectKey, type MemoryStore } from './store'

export interface ExperienceCaller {
  sessionId: string
  project: string
  actor: 'human' | 'model'
  /** A background task pins its source identity when admitted. */
  personaId?: string
  /** Internal analysis cancellation; human requests do not supply this field. */
  signal?: AbortSignal
}
const reads = new Set([
  'overview',
  'catalog',
  'skill',
  'suggestions',
  'suggestion',
  'trajectories',
  'trajectory',
  'drafts',
  'draft',
  'cases',
  'runs',
  'run',
  'evidence-pack',
  'target-content'
])
const writes = new Set([
  'review-record',
  'draft-record',
  'draft-update',
  'draft-discard',
  'suggestion-dismiss',
  'case-save',
  'run-start',
  'run-link',
  'run-progress',
  'run-finish'
])
interface Entry {
  runtime: MemorySourceRuntime
  used: number
  active: number
}

/** Native Skills owns candidates, revisions and files. PX chooses a private persona/project namespace. */
export class ExperienceBank {
  private disposed = false
  private entries = new Map<string, Entry>()
  private tails = new Map<string, Promise<unknown>>()
  private factory?: Promise<typeof import('dsh-mnemon-source-skills')>
  constructor(
    private root: string,
    private home: string,
    private identities: MemoryStore,
    private agentsHome?: string
  ) {}
  identity(caller: ExperienceCaller) {
    const state = this.identities.read(),
      binding = state.bindings[caller.sessionId]
    const persona = state.personas.find((p) => p.id === binding?.personaId),
      project = projectKey(caller.project)
    if (!binding || binding.pending || !persona || !project)
      throw new MemoryError('请先选择会话人格与项目', 409)
    if (caller.personaId && caller.personaId !== persona.id)
      throw new MemoryError('来源人格已变化，未保存旧任务的建议', 409)
    return { personaId: persona.id, project, enabled: persona.memoryEnabled && !persona.archived }
  }
  private async withRuntime<T>(
    caller: ExperienceCaller,
    run: (runtime: MemorySourceRuntime, key: string, project: string) => Promise<T>
  ): Promise<T> {
    if (this.disposed) throw new MemoryError('经验服务已停止', 503)
    caller.signal?.throwIfAborted()
    const identity = this.identity(caller),
      key = createHash('sha256')
        .update(JSON.stringify([identity.personaId, identity.project]))
        .digest('hex')
    const previous = this.tails.get(key) ?? Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(async () => {
        caller.signal?.throwIfAborted()
        this.identity({ ...caller, personaId: identity.personaId })
        let entry = this.entries.get(key)
        if (!entry) {
          const module = await (this.factory ??= import('dsh-mnemon-source-skills').catch((error) => {
            this.factory = undefined
            throw error
          }))
          while (this.entries.size >= 64) {
            const oldest = [...this.entries]
              .filter(([, value]) => !value.active)
              .sort((a, b) => a[1].used - b[1].used)[0]
            if (!oldest) throw new MemoryError('经验服务正在处理较多任务，请稍后重试', 503)
            this.entries.delete(oldest[0])
            await oldest[1].runtime.dispose?.()
          }
          entry = {
            runtime: module
              .createSkillsMemorySource({
                dataDir: join(this.root, key),
                dshHome: this.home,
                ...(this.agentsHome ? { agentsHome: this.agentsHome } : {})
              })
              .create({
                sourceInstanceKey: 'px-experience-' + key,
                provenance: { packageName: 'dsh-px-memory', entryId: 'px-experience' }
              }),
            used: Date.now(),
            active: 0
          }
          this.entries.set(key, entry)
        }
        entry.active++
        entry.used = Date.now()
        try {
          return await run(entry.runtime, key, identity.project)
        } finally {
          entry.active--
        }
      })
    this.tails.set(key, next)
    try {
      return await next
    } finally {
      if (this.tails.get(key) === next) this.tails.delete(key)
    }
  }
  async read(caller: ExperienceCaller, operation: string, input: any = {}): Promise<any> {
    if (!reads.has(operation)) throw new MemoryError('经验读取操作无效')
    return this.manage(caller, operation, input)
  }
  async write(caller: ExperienceCaller, operation: string, input: any, revision: string): Promise<any> {
    if (!writes.has(operation)) throw new MemoryError('经验修改操作无效')
    if (!this.identity(caller).enabled && operation !== 'run-finish')
      throw new MemoryError('此人格的记忆已关闭或已归档', 409)
    return this.manage(caller, operation, input, revision)
  }
  async adopt(
    caller: ExperienceCaller,
    draftId: string,
    revision: string,
    share: 'project' | 'global'
  ): Promise<any> {
    if (caller.actor !== 'human' || !['project', 'global'].includes(share))
      throw new MemoryError('采纳 Skill 需要你明确选择共享范围', 403)
    if (!this.identity(caller).enabled) throw new MemoryError('此人格的记忆已关闭或已归档', 409)
    return this.manage(
      caller,
      'draft-adopt',
      { id: draftId, root: share === 'project' ? 'project-dsh' : 'user-dsh' },
      revision
    )
  }
  private async manage(
    caller: ExperienceCaller,
    operation: string,
    input: any,
    revision?: string
  ): Promise<any> {
    const mutation = writes.has(operation) || operation === 'draft-adopt'
    if (mutation && (typeof revision !== 'string' || !revision))
      throw new MemoryError('请重新读取经验版本后再修改', 409)
    return this.withRuntime(caller, async (runtime, key, project) => {
      const request = {
        scope: { storage: 'workspace' as const, workspaceId: project },
        sourceInstanceKey: 'px-experience-' + key
      }
      if (mutation) {
        const current = await runtime.manage!({
          ...request,
          mode: 'read',
          operation: 'revision',
          input: {},
          confirmed: false
        })
        if ((current.value as any).revision !== revision)
          throw new MemoryError('经验已被其他操作更新，请刷新后再修改', 409)
      }
      caller.signal?.throwIfAborted()
      if (mutation && !this.identity(caller).enabled && operation !== 'run-finish')
        throw new MemoryError('此人格的记忆已关闭或已归档', 409)
      if (operation === 'draft-adopt') {
        const detail = await runtime.manage!({
          ...request,
          mode: 'read',
          operation: 'draft',
          input: { id: input.id },
          confirmed: false
        })
        const draft = (detail.value as any).draft
        // Native updates keep their existing root and ignore the new-skill root selector.
        // Never let a UI choice for project sharing silently rewrite a global/third-party Skill.
        if (draft.action === 'update' && draft.baseKey?.split(':')[0] !== input.root)
          throw new MemoryError(
            '此草稿更新已有 Skill，采纳范围必须与原 Skill 一致；其他来源请在原文件中管理',
            409
          )
      }
      return runtime.manage!({
        ...request,
        mode: mutation ? 'mutate' : 'read',
        operation,
        input,
        confirmed: mutation,
        ...(mutation ? { expectedRevision: revision } : {})
      })
    })
  }
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.allSettled(this.tails.values())
    for (const entry of this.entries.values()) await entry.runtime.dispose?.()
    this.entries.clear()
  }
}
