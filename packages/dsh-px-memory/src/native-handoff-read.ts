import { MemoryError } from './store'
import type { HistoryIndex } from './history'
import type { nativeHistoryScope } from './native-history-policy'

/** Handoffs export visible evidence, never raw private instructions or the source's later events. */
export async function readNativeHandoff(
  host: any,
  history: Pick<HistoryIndex, 'read'>,
  scope: ReturnType<typeof nativeHistoryScope>,
  caller: string,
  args: { session_id?: string; seq: number; before?: number; after?: number },
  signal?: AbortSignal
): Promise<string | undefined> {
  const target = args.session_id ?? caller,
    grant = scope.bounded(target)
  if (!grant) return
  const check = () => {
    signal?.throwIfAborted()
    if (!scope.allowsEvent(target, args.seq)) throw new MemoryError('该事件已超出当前明确交接范围', 403)
  }
  check()
  for (const count of [args.before ?? 0, args.after ?? 0])
    if (!Number.isSafeInteger(count) || count < 0) throw new MemoryError('相邻事件数量必须是非负安全整数')
  const before = Math.min(10, args.before ?? 0),
    after = Math.min(10, args.after ?? 0)
  const event = await history.read(host, caller, target, args.seq, 0, signal)
  check()
  const neighbors: unknown[] = []
  for (let seq = Math.max(0, args.seq - before); seq <= Math.min(grant.throughSeq, args.seq + after); seq++) {
    if (seq === args.seq) continue
    check()
    try {
      const row: any = await history.read(host, caller, target, seq, 0, signal)
      neighbors.push({
        seq: row.seq,
        kind: row.kind,
        text: row.text.slice(0, 700),
        truncated: row.totalCharacters > 700
      })
    } catch (error) {
      if (!(error instanceof MemoryError) || ![403, 404].includes(error.status)) throw error
      // Private/system events are omitted. A revoked grant still fails the whole read below.
    }
    check()
  }
  return JSON.stringify({
    view: 'explicit-handoff-visible-evidence',
    sessionId: target,
    throughSeq: grant.throughSeq,
    neighborsLimited:
      before !== (args.before ?? 0) || after !== (args.after ?? 0) || args.seq + after > grant.throughSeq,
    note: '明确交接的可见交流与执行回执；不是完整原生事件。隐藏推理、系统上下文、私有技能及记忆工具副本不随交接公开。正文有 nextOffset 时，可用 persona_history read 继续读取。',
    event,
    neighbors
  })
}
