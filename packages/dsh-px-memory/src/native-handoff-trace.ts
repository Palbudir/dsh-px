import { MemoryError } from './store'
import { nativeReader, service, type HistoryIndex } from './history'
import type { nativeHistoryScope } from './native-history-policy'

export async function traceNativeHandoff(
  host: any,
  history: Pick<HistoryIndex, 'read'>,
  scope: ReturnType<typeof nativeHistoryScope>,
  caller: string,
  target: string,
  seq: number | undefined,
  signal: AbortSignal
): Promise<string> {
  const grant = scope.bounded(target)
  if (!grant) throw new MemoryError('明确交接范围已不可用', 403)
  const check = () => {
    signal.throwIfAborted()
    if (!scope.bounded(target)) throw new MemoryError('明确交接授权已变化', 403)
  }
  check()
  if (seq === undefined) {
    const reader = await nativeReader(host, target, signal)
    let response: string
    try {
      check()
      if (reader.header.id !== target) throw new MemoryError('原始会话归属不一致', 403)
      response = JSON.stringify({
        view: 'explicit-handoff-lineage',
        sessionId: target,
        throughSeq: grant.throughSeq,
        handoffSummary: grant.summary,
        lineageBoundary: true,
        note: '本授权只交接此会话的有界可见内容，不交接其父子会话。不会把范围外关联报告为不存在。'
      })
    } finally {
      await reader.close()
    }
    check()
    return response
  }
  if (!scope.allowsEvent(target, seq)) throw new MemoryError('该事件超出明确交接范围', 403)
  const event: any = await history.read(host, caller, target, seq, 0, signal)
  check()
  const native = service(host, 'sessionQuery')
  if (!native?.traceEvent) throw new MemoryError('原生事件追溯服务不可用', 503)
  const trace = await native.traceEvent({ sessionId: target, seq }, signal)
  check()
  if (trace.session?.id !== target || trace.target?.seq !== seq)
    throw new MemoryError('原生追溯归属不一致', 403)
  const fields = ['replacementChain', 'replacedEventSeqs', 'sourceEventSeqs', 'derivedEventSeqs'] as const
  const candidates = [trace.replacedBy, ...fields.flatMap((key) => trace[key] ?? [])],
    visible = new Set<number>()
  let inspected = 0
  for (const candidate of new Set(candidates)) {
    if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate > grant.throughSeq) continue
    if (inspected++ >= 64) break
    try {
      await history.read(host, caller, target, candidate, 0, signal)
      visible.add(candidate)
    } catch (error) {
      if (!(error instanceof MemoryError) || ![403, 404].includes(error.status)) throw error
    }
    check()
  }
  check()
  return JSON.stringify({
    view: 'explicit-handoff-event-trace',
    sessionId: target,
    throughSeq: grant.throughSeq,
    target: { seq: event.seq, kind: event.kind, time: event.time },
    ...(visible.has(trace.replacedBy) ? { replacedBy: trace.replacedBy } : {}),
    ...Object.fromEntries(
      fields.map((key) => [key, (trace[key] ?? []).filter((value: number) => visible.has(value))])
    ),
    scopeLimited: true,
    note: '仅列交接范围内的可见事件关系，最多核对64个候选关联；未列出的关系可能未获授权或超出预算，不代表不存在。'
  })
}
