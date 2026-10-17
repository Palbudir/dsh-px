import { MemoryError, type MemoryStore, type Handoff } from './store'
import { historyRecord, service, type HistoryEvent, type HistoryRecord } from './history'

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
    !events.some((e) => e.type === 'user/message' && e.data?.source?.kind === 'user' && e.seq <= cut)
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
  if (
    typeof args.requestId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(args.requestId)
  )
    throw new MemoryError('缺少有效的新会话请求标识')
  if (typeof args.personaId !== 'string') throw new MemoryError('请选择人格')
  if (typeof args.handoff !== 'boolean') throw new MemoryError('请选择新建或接续方式')
  const controller = service(host, 'sessionController')
  if (!controller?.create || !controller?.inspect) throw new MemoryError('原生会话创建接口不可用', 503)
  const state = store.read(),
    persona = state.personas.find((p) => p.id === args.personaId && !p.archived)
  if (!persona) throw new MemoryError('人格不存在或已归档')
  const id = 'session-' + args.requestId
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
  store.bind(id, { personaId: persona.id, locked: !!handoff, handoff, pending: true, createdFrom: sourceId })
  // Explicit IDs make retry after an uncertain HTTP response adopt the same native Session.
  const workspace = service(host, 'workspaceRegistry')
    ?.list?.()
    .find((w: any) => w.sessionIds?.includes(sourceId))
  await controller.create({
    sessionId: id,
    ...(workspace ? { workspaceId: workspace.id } : { cwd: source.meta.cwd }),
    agentPreset: source.meta.agentPreset
  })
  store.bind(id, { personaId: persona.id, locked: !!handoff })
  return id
}
