import { MemoryError, projectKey, type MemoryStore, type SessionBinding, type SessionCreation } from './store'
import { service } from './history'

const requests = new WeakMap<MemoryStore, Map<string, { fingerprint: string; promise: Promise<string> }>>()
export function creationSessionId(requestId: unknown): string {
  if (
    typeof requestId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)
  )
    throw new MemoryError('新会话请求标识无效')
  return 'session-' + requestId
}
/** All explicit persona creation entrances share admission for their preallocated identity. */
export function ownedCreationRequest(
  store: MemoryStore,
  id: string,
  fingerprint: string,
  run: () => Promise<string>
): Promise<string> {
  let map = requests.get(store)
  if (!map) requests.set(store, (map = new Map()))
  const previous = map.get(id)
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      return Promise.reject(new MemoryError('此请求正在用于另一项会话创建', 409))
    return previous.promise
  }
  const promise = Promise.resolve().then(run)
  map.set(id, { fingerprint, promise })
  void promise.finally(() => map.delete(id)).catch(() => {})
  return promise
}
async function observe(host: any, id: string): Promise<any | undefined> {
  const query = service(host, 'sessionQuery')
  if (query?.observeSession) {
    try {
      const observation = await query.observeSession(id, { projectionMode: 'none' })
      try {
        return { meta: observation.header, events: [...observation.events] }
      } finally {
        observation[Symbol.dispose]()
      }
    } catch (error: any) {
      if (error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return
      throw error
    }
  }
  // The older controller's inspect contract has a typed missing error. Unknown errors are never absence.
  try {
    return await service(host, 'sessionController').inspect(id)
  } catch (error: any) {
    if (error?.code === 'session/not-found' || error?.constructor?.name === 'ApiSessionNotFound') return
    throw error
  }
}

/** Complete an explicit create once. A live identity is adopted, never re-created through native blank reuse. */
export async function createOwnedNativeSession(
  host: any,
  store: MemoryStore,
  id: string,
  options: {
    creation: SessionCreation
    binding: Parameters<MemoryStore['bind']>[1] & { personaId: string }
    signal?: AbortSignal
  }
): Promise<string> {
  const { creation, binding, signal } = options,
    controller = service(host, 'sessionController'),
    registry = service(host, 'workspaceRegistry')
  const workspace =
    creation.workspaceId === undefined
      ? undefined
      : (registry?.get?.(creation.workspaceId) ??
        registry?.list?.().find((w: any) => w.id === creation.workspaceId))
  if (creation.workspaceId && !workspace)
    throw new MemoryError('原请求的工作区已不存在，请从人格目录确认', 409)
  if (workspace?.path && projectKey(workspace.path) !== projectKey(creation.cwd))
    throw new MemoryError('工作区路径已变化，请重新创建', 409)
  const old = store.read().bindings[id]
  if (
    old?.creation &&
    (old.creation.kind !== creation.kind ||
      projectKey(old.creation.cwd) !== projectKey(creation.cwd) ||
      old.creation.workspaceId !== creation.workspaceId ||
      old.creation.agentPreset !== creation.agentPreset)
  )
    throw new MemoryError('原创建请求的目标已变化，请从人格目录打开原会话', 409)
  const assertOwner = (): SessionBinding => {
    const b = store.read().bindings[id]
    if (
      !b ||
      b.personaId !== binding.personaId ||
      b.createdFrom !== binding.createdFrom ||
      b.creationWorkspaceId !== binding.creationWorkspaceId ||
      JSON.stringify(b.channel) !== JSON.stringify(binding.channel)
    )
      throw new MemoryError('创建请求的身份或受众已变化，未重新绑定', 409)
    return b
  }
  const verify = (record: any) => {
    const b = assertOwner()
    if (
      (record.meta.id !== undefined && record.meta.id !== id) ||
      projectKey(record.meta.cwd) !== projectKey(creation.cwd) ||
      record.meta.origin === 'subagent'
    )
      throw new MemoryError('原生会话的目录或归属已变化，未重建', 409)
    if (!b.creation?.complete && creation.agentPreset !== undefined) {
      const preset =
        [...(record.events ?? [])].reverse().find((e: any) => e.type === 'agent-preset/selected')?.data
          ?.agentPreset ?? record.meta.agentPreset
      if (preset !== creation.agentPreset)
        throw new MemoryError('原生会话预设与原请求不同，请在目录中检查', 409)
    }
  }
  const existing = await observe(host, id)
  signal?.throwIfAborted()
  if (existing && !old) throw new MemoryError('此标识已有原生会话，请重新新建；未改变原人格', 409)
  if (old?.creation?.complete && !existing) throw new MemoryError('原会话已不存在，请重新新建', 409)
  if (existing) {
    verify(existing)
    if (workspace && !workspace.sessionIds?.includes(id)) {
      // Legacy bindings lack a durable creation acknowledgement. Do not undo an intentional move.
      if (old?.creation?.complete !== false)
        throw new MemoryError('原会话不在此工作区，请从目录确认；未自动移回', 409)
      if (typeof workspace.attachSession !== 'function') throw new MemoryError('原生工作区挂接不可用', 503)
      await workspace.attachSession(id)
    }
  } else {
    if (old && !old.creation) {
      if (!old.pending) throw new MemoryError('无法确认旧创建请求的结果，请从目录确认后重新新建', 409)
      const state = store.read()
      store.change(state.revision, (next) => {
        next.bindings[id].creation = { ...creation }
      })
    }
    store.bind(id, { ...binding, locked: true, pending: true, creation })
    const request = {
      sessionId: id,
      ...(workspace ? { workspaceId: workspace.id } : { cwd: creation.cwd }),
      ...(creation.agentPreset === undefined ? {} : { agentPreset: creation.agentPreset })
    }
    if (controller.pxPersonaCreationVersion === 1 && controller.createForPersona) {
      const result = await controller.createForPersona(request, {
        reusable: (target: string) => target === id && assertOwner().personaId === binding.personaId,
        beforeReuse: ({ sessionId }: any) => sessionId === id && !!assertOwner(),
        beforeCreate: ({ sessionId }: any) => {
          if (sessionId !== id) throw new MemoryError('原生创建改用了其他标识，请重试原请求以核对结果', 409)
          assertOwner()
        },
        resolved: ({ sessionId }: any) => {
          if (sessionId !== id) throw new MemoryError('原生返回了不同的会话标识', 409)
        }
      })
      if (!result.ok) throw new MemoryError(result.error.message, 503)
      if (result.value.sessionId !== id) throw new MemoryError('原生返回了不同的会话标识', 409)
    } else {
      const result = await controller.create(request)
      if (result?.sessionId !== id)
        throw new MemoryError('原生返回了不同的会话标识，未将其当作本请求结果', 409)
    }
  }
  const state = store.read()
  const acknowledged = assertOwner()
  if (acknowledged.creation?.complete && acknowledged.locked && !acknowledged.pending) return id
  store.change(state.revision, (next) => {
    next.bindings[id].pending = false
    next.bindings[id].locked = true
    next.bindings[id].creation = { ...creation, complete: true }
  })
  return id
}
