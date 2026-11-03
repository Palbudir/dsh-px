import { MemoryError } from './store'
import { service, type HistoryIndex } from './history'
import type { nativeHistoryScope } from './native-history-policy'

/** Use native query filters/cursors, then export only matches in the shared visible evidence. */
export async function searchNativeHandoff(
  host: any,
  history: Pick<HistoryIndex, 'read'>,
  scope: ReturnType<typeof nativeHistoryScope>,
  caller: string,
  target: string,
  query: string,
  filters: any[],
  maxResults: number,
  signal: AbortSignal
): Promise<string> {
  const grant = scope.bounded(target)
  if (!grant) throw new MemoryError('明确交接范围已不可用', 403)
  if (filters.some((filter) => filter.kind === 'surface'))
    throw new MemoryError('有界交接不提供来源会话当前的上下文状态筛选；请去掉 surfaces 后按事件范围检索', 403)
  const check = () => {
    signal.throwIfAborted()
    if (!scope.bounded(target)) throw new MemoryError('明确交接授权已变化', 403)
  }
  const native = service(host, 'sessionQuery')
  if (!native?.searchEvents) throw new MemoryError('原生历史搜索服务不可用', 503)
  const ranges = filters.filter((filter) => filter.kind === 'seq'),
    from = Math.max(0, ...ranges.map((filter) => filter.from ?? 0)),
    to = Math.min(grant.throughSeq, ...ranges.map((filter) => filter.to ?? grant.throughSeq)),
    constrainedFilters = [...filters.filter((filter) => filter.kind !== 'seq'), { kind: 'seq', from, to }]
  const items: any[] = [],
    seen = new Set<number>(),
    cursors = new Set<string>()
  const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  let cursor: string | undefined,
    partial = false
  for (let pageIndex = 0; from <= to && pageIndex < 50; pageIndex++) {
    check()
    const page = await native.searchEvents(
      {
        sessionId: target,
        query,
        filters: constrainedFilters,
        ...(cursor === undefined ? {} : { cursor })
      },
      { signal }
    )
    check()
    if (page.session?.id !== target) throw new MemoryError('原生搜索会话归属不一致', 403)
    for (const hit of page.items) {
      if (seen.has(hit.seq)) continue
      seen.add(hit.seq)
      if (!scope.allowsEvent(target, hit.seq)) throw new MemoryError('原生搜索返回了交接范围外的事件', 403)
      let row: any
      try {
        row = await history.read(host, caller, target, hit.seq, 0, signal)
      } catch (error) {
        check()
        if (error instanceof MemoryError && [403, 404].includes(error.status)) continue
        throw error
      }
      check()
      if (row.nextOffset !== null) partial = true
      // A match in hidden reasoning/private tool metadata is not a visible-history match.
      if (!terms.every((term) => row.text.toLocaleLowerCase().includes(term))) continue
      const start = Math.max(0, row.text.toLocaleLowerCase().indexOf(terms[0] ?? '') - 100)
      items.push({
        seq: row.seq,
        kind: row.kind,
        time: row.time,
        snippet: row.text.slice(start, start + 700),
        readOffset: start
      })
      if (items.length >= Math.min(100, Math.max(1, maxResults))) {
        partial = true
        break
      }
    }
    if (items.length >= Math.min(100, Math.max(1, maxResults))) break
    if (page.nextCursor === undefined) break
    if (typeof page.nextCursor !== 'string' || cursors.has(page.nextCursor))
      throw new MemoryError('原生历史搜索游标无法继续', 503)
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
    if (pageIndex === 49) partial = true
  }
  check()
  return JSON.stringify({
    view: 'explicit-handoff-search',
    sessionId: target,
    throughSeq: grant.throughSeq,
    items,
    partial,
    note: '只返回明确交接的可见交流及执行回执；不返回原生私有摘要、当前标题或范围外计数。partial 表示达到检索或正文预算，请缩小范围或用 persona_history 读取原文。'
  })
}

/** Keep full native results separate from sources shared only through a recorded cutoff. */
export async function appendNativeHandoffs(
  host: any,
  history: Pick<HistoryIndex, 'read'>,
  scope: ReturnType<typeof nativeHistoryScope>,
  caller: string,
  args: any,
  query: string,
  sessionFilters: any[],
  eventFilters: any[],
  own: string,
  maxResults: number,
  signal: AbortSignal
): Promise<string> {
  const sources = scope.boundedIds.filter(
    (id) => args.session_ids === undefined || args.session_ids.includes(id)
  )
  if (!sources.length) return own
  const check = () => {
    signal.throwIfAborted()
    if (!scope.allows(caller) || sources.some((id) => !scope.bounded(id)))
      throw new MemoryError('交接搜索授权已变化', 403)
  }
  check()
  if (
    args.parent_session_ids !== undefined ||
    args.include_root_sessions === true ||
    sessionFilters.some((filter) => filter.kind === 'availability') ||
    eventFilters.some((filter) => filter.kind === 'surface')
  ) {
    return JSON.stringify({
      samePersonaResults: own,
      handoffNotice:
        '本次未检索有界交接：父子关系、当前可用性和当前上下文状态不在交接内容授权内。去掉这些筛选后可搜索交接事件。'
    })
  }
  const native = service(host, 'sessionQuery')
  if (!native?.filterSessions) throw new MemoryError('原生会话筛选服务不可用', 503)
  const matches: unknown[] = []
  for (const id of sources) {
    const records = await native.filterSessions([...sessionFilters, { kind: 'id', values: [id] }], signal)
    check()
    if (!records.some((record: any) => record.header.id === id)) continue
    const result = JSON.parse(
      await searchNativeHandoff(host, history, scope, caller, id, query, eventFilters, maxResults, signal)
    )
    check()
    if (result.items.length || result.partial) matches.push(result)
  }
  check()
  return matches.length ? JSON.stringify({ samePersonaResults: own, handoffMatches: matches }) : own
}
