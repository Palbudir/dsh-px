import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  MemoryError,
  isInternalSession,
  projectKey,
  validId,
  type MemoryStore,
  type SessionBinding
} from './store'
import { service } from './history'

interface NativeResult {
  sessionId: string
  agentPreset?: string
}
interface Receipt {
  fingerprint: string
  personaId: string
  workspaceId: string
  cwd: string
  requestedPreset?: string
  target: string
  attempt?: NativeResult & { kind: 'create' | 'reuse' }
  resolved?: NativeResult
  complete?: boolean
}
/** Small creation receipts only. Native sessions remain the authority for existence, presets and execution. */
export class PersonaNavigation {
  private db: DatabaseSync
  private pending = new Map<string, { fingerprint: string; promise: Promise<any> }>()
  constructor(
    private readonly store: MemoryStore,
    path: string
  ) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA synchronous=FULL;')
      if (
        (this.db.prepare('PRAGMA user_version').get() as any).user_version > 1 ||
        (this.db.prepare('PRAGMA quick_check').get() as any).quick_check !== 'ok'
      )
        throw new MemoryError('新会话创建记录需要检查，未覆盖原记录', 503)
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, body TEXT NOT NULL); PRAGMA user_version=1;'
      )
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  close() {
    this.db.close()
  }
  private read(id: string): Receipt | undefined {
    const row = this.db.prepare('SELECT body FROM requests WHERE id=?').get(id)
    return row ? JSON.parse(String(row.body)) : undefined
  }
  private save(id: string, receipt: Receipt) {
    this.db
      .prepare('INSERT INTO requests(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(id, JSON.stringify(receipt))
  }
  create(host: any, args: any): Promise<any> {
    const requestId = args.requestId
    if (
      typeof requestId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)
    )
      throw new MemoryError('新会话请求标识无效')
    const workspaceId = validId(args.workspaceId),
      personaId = args.personaId === undefined ? undefined : validId(args.personaId),
      currentSessionId = args.currentSessionId === undefined ? undefined : validId(args.currentSessionId),
      agentPreset = args.agentPreset === undefined ? undefined : validId(args.agentPreset),
      fingerprint = JSON.stringify([personaId, currentSessionId, workspaceId, agentPreset]),
      active = this.pending.get(requestId)
    if (active) {
      if (active.fingerprint !== fingerprint) throw new MemoryError('此请求已用于另一项新建操作', 409)
      return active.promise
    }
    const promise = Promise.resolve().then(() =>
      this.run(host, requestId, fingerprint, { personaId, currentSessionId, workspaceId, agentPreset })
    )
    this.pending.set(requestId, { fingerprint, promise })
    void promise
      .finally(() => {
        this.pending.delete(requestId)
      })
      .catch(() => {})
    return promise
  }
  private async run(host: any, requestId: string, fingerprint: string, args: any) {
    const controller = service(host, 'sessionController'),
      registry = service(host, 'workspaceRegistry')
    if (controller?.pxPersonaCreationVersion !== 1 || typeof controller.createForPersona !== 'function')
      throw new MemoryError('当前宿主未安装人格导航接入，请从“人格与会话”新建', 503)
    const workspace = registry?.get?.(args.workspaceId)
    if (!workspace) throw new MemoryError('工作区不存在，请刷新后选择', 404)
    let receipt = this.read(requestId)
    if (
      receipt &&
      (receipt.fingerprint !== fingerprint || projectKey(receipt.cwd) !== projectKey(workspace.path))
    )
      throw new MemoryError('此请求的目标或工作区路径已改变，请重新选择', 409)
    if (!receipt) {
      const state = this.store.read(),
        current = state.bindings[args.currentSessionId],
        personaId =
          args.personaId ?? (current && !current.purpose && !current.pending ? current.personaId : 'default')
      this.assertPersona(personaId)
      const native = await controller.list({})
      if (!Array.isArray(native?.items)) throw new MemoryError('原生会话目录不可用', 503)
      const blank = native.items.find(
        (row: any) =>
          row.blank === true &&
          row.running !== true &&
          row.origin !== 'subagent' &&
          projectKey(row.cwd) === projectKey(workspace.path) &&
          workspace.sessionIds.includes(row.sessionId) &&
          !registry.archivedSessionIds.includes(row.sessionId) &&
          this.owned(row.sessionId, personaId, false, state.bindings) &&
          (args.agentPreset === undefined ||
            row.projectionValues?.agentPreset === undefined ||
            row.projectionValues.agentPreset === args.agentPreset)
      )
      receipt = {
        fingerprint,
        personaId,
        workspaceId: workspace.id,
        cwd: workspace.path,
        requestedPreset: args.agentPreset,
        target: blank?.sessionId ?? 'session-' + requestId
      }
      this.save(requestId, receipt)
    }
    this.assertPersona(receipt.personaId)
    if (receipt.resolved || receipt.attempt) {
      const previous = receipt.resolved ?? receipt.attempt!
      let inspected: any
      try {
        const observation = await service(host, 'sessionQuery').observeSession(previous.sessionId, {
          projectionMode: 'none'
        })
        try {
          inspected = { meta: observation.header, events: [...observation.events] }
        } finally {
          observation[Symbol.dispose]()
        }
      } catch (error: any) {
        // Only a definite native not-found permits another creation attempt.
        if (error?.code !== 'SESSION_QUERY_SESSION_NOT_FOUND') throw error
        if (receipt.resolved || receipt.attempt?.kind !== 'create')
          throw new MemoryError('原创建会话已不存在，请在目录确认后重新新建', 409)
      }
      if (inspected) {
        const recoveringCreation = !receipt.resolved && receipt.attempt?.kind === 'create'
        if (
          !this.owned(previous.sessionId, receipt.personaId, recoveringCreation) ||
          projectKey(inspected.meta.cwd) !== projectKey(receipt.cwd)
        )
          throw new MemoryError('原创建会话的身份或目录已变化，未重建或重新绑定', 409)
        const preset =
          [...inspected.events].reverse().find((e: any) => e.type === 'agent-preset/selected')?.data
            ?.agentPreset ?? inspected.meta.agentPreset
        if (!receipt.resolved && preset !== previous.agentPreset)
          throw new MemoryError('上次新建结果尚不明确，请在“人格与会话”打开原会话检查；未重复切换预设', 409)
        const value = {
          sessionId: previous.sessionId,
          ...(preset === undefined ? {} : { agentPreset: preset })
        }
        this.store.bind(value.sessionId, { personaId: receipt.personaId, locked: true })
        receipt.resolved = value
        this.save(requestId, receipt)
        if (receipt.complete && !workspace.sessionIds.includes(value.sessionId))
          throw new MemoryError('原会话已移出这个工作区，请从人格目录打开；未自动移回', 409)
        try {
          if (!workspace.sessionIds.includes(value.sessionId)) await workspace.attachSession(value.sessionId)
        } catch (error) {
          return this.attachmentFailure(value.sessionId, workspace.id, error)
        }
        receipt.complete = true
        this.save(requestId, receipt)
        return { ok: true, value }
      }
      receipt.target = previous.sessionId
    }
    const attempt = (kind: 'create' | 'reuse', value: NativeResult & { cwd: string }) => {
      this.assertPersona(receipt.personaId)
      if (projectKey(value.cwd) !== projectKey(receipt.cwd)) throw new MemoryError('原生创建目录已变化', 409)
      if (kind === 'reuse' && !this.owned(value.sessionId, receipt.personaId)) return false
      receipt.attempt = { kind, sessionId: value.sessionId, agentPreset: value.agentPreset }
      this.save(requestId, receipt)
      // This is an explicit persona New operation. Fix the existing SAME owner before native reuse awaits.
      this.store.bind(value.sessionId, {
        personaId: receipt.personaId,
        locked: true,
        ...(kind === 'create' ? { pending: true, creationWorkspaceId: workspace.id } : {})
      })
      return true
    }
    const result = await controller.createForPersona(
      {
        sessionId: receipt.target,
        workspaceId: workspace.id,
        ...(receipt.requestedPreset === undefined ? {} : { agentPreset: receipt.requestedPreset })
      },
      {
        reusable: (id: string) => this.owned(id, receipt.personaId),
        beforeReuse: (value: any) => attempt('reuse', value),
        beforeCreate: (value: any) => {
          attempt('create', value)
        },
        resolved: (value: any) => {
          if (!this.owned(value.sessionId, receipt.personaId, true))
            throw new MemoryError('创建结果的人格不匹配', 409)
          this.store.bind(value.sessionId, { personaId: receipt.personaId, locked: true })
          receipt.resolved = { sessionId: value.sessionId, agentPreset: value.agentPreset }
          this.save(requestId, receipt)
        }
      }
    )
    if (result.ok) {
      receipt.complete = true
      this.save(requestId, receipt)
    }
    return result
  }
  private assertPersona(id: string) {
    if (!this.store.read().personas.some((p) => p.id === id && !p.archived))
      throw new MemoryError('人格不存在或已归档，请重新选择', 409)
  }
  private owned(id: string, personaId: string, pending = false, bindings?: Record<string, SessionBinding>) {
    const b = (bindings ?? this.store.read().bindings)[id]
    return (
      !isInternalSession(id) &&
      !b?.channel &&
      !b?.purpose &&
      !b?.handoff &&
      b?.creation?.complete !== false &&
      (pending || !b?.pending) &&
      (b?.personaId ?? 'default') === personaId
    )
  }
  private attachmentFailure(sessionId: string, workspaceId: string, error: unknown) {
    return {
      ok: false,
      error: {
        code: 'session/workspace-attach-failed',
        message: '会话已创建，但未能加入工作区：' + String(error),
        details: { sessionId, workspaceId }
      }
    }
  }
}
