import type { ChannelInbox } from './channel-inbox'
import { matchingNativeAdmissions } from './channel-admission'

/** Bounded read-only native log scan. It never creates/resumes an Agent or resubmits a message. */
export async function recoverStoredAdmission(
  host: any,
  inbox: ChannelInbox,
  row: ReturnType<ChannelInbox['uncertainInputs']>[number],
  signal: AbortSignal
): Promise<'admitted' | 'partial' | 'missing' | 'changed'> {
  const get = (name: string) => (host.get ? host.get(name) : host[name]),
    receipt = inbox.receipt(row.id),
    claim = receipt?.claim
  signal.throwIfAborted()
  if (!receipt || !claim || receipt.phase !== 'uncertain') return 'changed'
  const persistence = get('sessionPersistence')
  if (!persistence?.open || !persistence.flush) throw Error('原生持久历史读取服务未就绪')
  const reader = await persistence.open(claim.sessionId, 'read', { signal })
  try {
    if (reader.header.id !== claim.sessionId || reader.access !== 'read') throw Error('原生核对来源不匹配')
    let cursor = Math.max(row.cursor, claim.fromSeq ?? 0, reader.inheritedEventCount ?? 0)
    for (let page = 0; page < 4; page++) {
      signal.throwIfAborted()
      const { events } = await reader.read(cursor, 256, { signal }),
        found = matchingNativeAdmissions(row.id, receipt, events, reader.inheritedEventCount ?? 0)
      if (found.size > 1) throw Error('原生收件存在多个回执，需要人工核对')
      if (found.size === 1) {
        const live = get('sessions')?.get(claim.sessionId)
        if (live) {
          if (!(await get('sessions').flush(live))) throw Error('原生会话未提供持久写入回执')
        } else await persistence.flush()
        signal.throwIfAborted()
        return inbox.admit(row.id, claim, [...found][0]) ? 'admitted' : 'changed'
      }
      if (events.length) cursor = events.at(-1)!.seq + 1
      if (events.length < 256) {
        inbox.advanceRecovery(row.id, claim, row.cursor, cursor)
        return 'missing'
      }
    }
    return inbox.advanceRecovery(row.id, claim, row.cursor, cursor) ? 'partial' : 'changed'
  } finally {
    await reader.close()
  }
}
