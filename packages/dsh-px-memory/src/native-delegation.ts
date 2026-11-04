/** Native subagents persist a descriptor during setup, before their first turn.
 * Bare `user` prompts in that independent suffix come from delegation APIs;
 * native human subagent.prompt RPCs carry rpcId and remain distinguishable.
 */
export async function nativeDelegationBoundary(
  reader: any,
  signal?: AbortSignal,
  through = Number.MAX_SAFE_INTEGER
): Promise<number | undefined> {
  let cursor = reader.inheritedEventCount ?? 0
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw Error('原生继承边界无效')
  for (let page = 0; page < 8; page++) {
    signal?.throwIfAborted()
    if (cursor > through) return undefined
    const length = Math.min(256, through - cursor + 1)
    const { events } = await reader.read(cursor, length, { signal })
    for (const event of events) {
      if (event.seq < cursor) continue
      if (event.type === 'subagent/descriptor') return event.seq
      if (event.type === 'turn/start' || event.type === 'user/message') return undefined
    }
    if (events.length < length || events.at(-1)?.seq === through) return undefined
    cursor = events.at(-1).seq + 1
  }
  throw Error('原生会话初始化来源尚未核对，未把子会话输入视为人类反馈')
}

export const bareNativeUser = (event: any): boolean =>
  event.type === 'user/message' &&
  event.data?.source?.kind === 'user' &&
  !(
    typeof event.data.source.rpcId === 'string' &&
    event.data.source.rpcId.length > 0 &&
    event.data.source.rpcId.length <= 200 &&
    !/[\r\n\0]/.test(event.data.source.rpcId)
  )
export interface DelegationRange {
  from: number
  through: number
}
/** Follow only already-visible inherited prefixes. Forking cannot promote an Agent prompt to human evidence. */
export async function nativeDelegationRanges(
  reader: any,
  open: (id: string) => Promise<any>,
  signal?: AbortSignal,
  through = Number.MAX_SAFE_INTEGER,
  seen = new Set<string>()
): Promise<DelegationRange[]> {
  signal?.throwIfAborted()
  const cut = reader.inheritedEventCount ?? 0,
    id = reader.header?.id
  if (!Number.isSafeInteger(cut) || cut < 0) throw Error('原生继承边界无效')
  const ranges: DelegationRange[] = []
  if (cut > 0) {
    const end = Math.min(cut - 1, through),
      parentId = reader.header?.parentSession
    if (end >= 0) {
      if (typeof parentId !== 'string' || parentId === id || seen.has(parentId) || seen.size >= 32) {
        ranges.push({ from: 0, through: end })
      } else {
        let parent: any
        try {
          parent = await open(parentId)
          if (parent.header?.id !== parentId) throw Error('继承来源不匹配')
          ranges.push(
            ...(await nativeDelegationRanges(
              parent,
              open,
              signal,
              end,
              new Set([...seen, ...(typeof id === 'string' ? [id] : [])])
            ))
          )
        } catch (error) {
          signal?.throwIfAborted()
          ranges.push({ from: 0, through: end })
        } finally {
          await parent?.close()
        }
      }
    }
  }
  if (cut <= through) {
    const from = await nativeDelegationBoundary(reader, signal, through)
    if (from !== undefined) ranges.push({ from, through })
  }
  return ranges
}
