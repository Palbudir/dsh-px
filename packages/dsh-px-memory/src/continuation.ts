import { MemoryError, type MemoryStore, type Handoff } from './store'
import { historyRecord, service, type HistoryEvent, type HistoryRecord } from './history'
import { conversationalSource } from '../../shared/channel-source'
import { creationSessionId, ownedCreationRequest, createOwnedNativeSession } from './owned-session'

/** Collapse retries while a native creation/selection is in flight; persisted bindings handle later retries. */
export function continuationRequests() {
  const pending = new Map<string, { fingerprint: string; promise: Promise<string> }>()
  return async (id: string, fingerprint: string, run: () => Promise<string>): Promise<string> => {
    const active = pending.get(id)
    if (active) {
      if (active.fingerprint !== fingerprint) throw new MemoryError('接续请求正在用于另一项操作', 409)
      return active.promise
    }
    const promise = Promise.resolve().then(run)
    pending.set(id, { fingerprint, promise })
    try {
      return await promise
    } finally {
      pending.delete(id)
    }
  }
}

/** A finite, human-authorized source range. Does not clone runtime context or resume any Goal. */
export function handoffFrom(events: readonly HistoryEvent[], sessionId: string): Handoff {
  let open = false,
    cut = -1
  for (const e of events) {
    if (e.type === 'turn/start') open = true
    if (e.type === 'turn/end') open = false
    if (!open) cut = e.seq
  }
  if (
    cut < 0 ||
    !events.some((e) => e.type === 'user/message' && conversationalSource(e.data?.source) && e.seq <= cut)
  )
    throw new MemoryError('原会话还没有可交接的已完成对话')
  const calls = new Map<string, string>(),
    rows: HistoryRecord[] = []
  for (const e of events) {
    if (e.seq > cut) break
    const d = e.data ?? {}
    if (['tool/call', 'tool/ptc-dispatch-start'].includes(e.type) && typeof d.name === 'string')
      calls.set(d.callId ?? d.subCallId, d.name)
    const row = historyRecord(e, (id: string) => calls.get(id))
    if (row && ['user', 'assistant', 'ledger', 'native-state'].includes(row.kind)) rows.push(row)
  }
  const last = (kind: string, n: number) =>
    rows
      .filter((r) => r.kind === kind)
      .slice(-n)
      .map((r) => ({
        seq: r.seq,
        time: r.time,
        kind: r.kind,
        text: r.text.slice(0, kind === 'native-state' ? 1500 : 2500),
        truncated: r.text.length > (kind === 'native-state' ? 1500 : 2500)
      }))
  const excerpt = {
    sourceSessionId: sessionId,
    throughSeq: cut,
    latestNativeStates: last('native-state', 3),
    ledger: last('ledger', 1),
    requests: last('user', 2),
    reply: last('assistant', 1)
  }
  let summary = JSON.stringify(excerpt)
  while (summary.length > 12000) {
    const largest = [
      ...excerpt.latestNativeStates,
      ...excerpt.ledger,
      ...excerpt.requests,
      ...excerpt.reply
    ].sort((a, b) => b.text.length - a.text.length)[0]
    largest.text = largest.text.slice(0, Math.floor(largest.text.length / 2))
    largest.truncated = true
    summary = JSON.stringify(excerpt)
  }
  return { sessionId, throughSeq: cut, summary, createdAt: new Date().toISOString() }
}
export async function createPersonaSession(
  host: any,
  store: MemoryStore,
  sourceId: string,
  args: any,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  const id = creationSessionId(args.requestId)
  return ownedCreationRequest(
    store,
    id,
    JSON.stringify(['continuation', sourceId, args.personaId, args.handoff]),
    () => createPersonaAttempt(host, store, sourceId, args, id, signal)
  )
}
async function createPersonaAttempt(
  host: any,
  store: MemoryStore,
  sourceId: string,
  args: any,
  id: string,
  signal?: AbortSignal
): Promise<string> {
  if (typeof args.personaId !== 'string') throw new MemoryError('请选择人格')
  if (typeof args.handoff !== 'boolean') throw new MemoryError('请选择新建或接续方式')
  const controller = service(host, 'sessionController')
  if (!controller?.create || !controller?.inspect) throw new MemoryError('原生会话创建接口不可用', 503)
  const state = store.read(),
    persona = state.personas.find((p) => p.id === args.personaId && !p.archived)
  if (!persona) throw new MemoryError('人格不存在或已归档')
  const existing = state.bindings[id]
  if (
    existing &&
    (existing.personaId !== persona.id ||
      existing.createdFrom !== sourceId ||
      Boolean(existing.handoff) !== Boolean(args.handoff) ||
      (existing.handoff && existing.handoff.sessionId !== sourceId))
  )
    throw new MemoryError('新会话请求已经用于其他操作', 409)
  const source = await controller.inspect(sourceId, signal)
  let handoff = existing?.handoff
  if (args.handoff && !existing) {
    if (service(host, 'agents')?.get(sourceId)?.status === 'running')
      throw new MemoryError('请等待原会话本轮结束或先停止，再创建接续会话', 409)
    handoff = handoffFrom(source.events, sourceId)
  }
  signal?.throwIfAborted()
  const sourceChannel = state.bindings[sourceId]?.channel
  const channel = sourceChannel?.task
    ? {
        ...sourceChannel,
        task: { ...sourceChannel.task, rootSessionId: id }
      }
    : sourceChannel
  const workspace = service(host, 'workspaceRegistry')
    ?.list?.()
    .find((w: any) => w.sessionIds?.includes(sourceId))
  return createOwnedNativeSession(host, store, id, {
    creation: {
      kind: 'continuation',
      cwd: source.meta.cwd,
      workspaceId: workspace?.id,
      agentPreset: source.meta.agentPreset,
      complete: false
    },
    binding: { personaId: persona.id, locked: true, handoff, createdFrom: sourceId, channel },
    signal
  })
}
