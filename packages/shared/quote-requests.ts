export function createQuoteRequests(limit = 64) {
  type Selection = { messageId: string; token: string; quote?: string }
  let requests: Record<string, Selection> = {}
  let revision = 0
  const epoch = Date.now().toString(36) + Math.random().toString(36).slice(2)
  const listeners = new Set<() => void>()
  const publish = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => requests,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    request(sessionId: string, messageId: string, quote?: string) {
      if (quote !== undefined && (!quote || quote.length > 8000)) throw new Error('引用片段须为 1–8000 字符')
      if (!requests[sessionId] && Object.keys(requests).length >= limit)
        throw new Error('待处理引用过多，请先在引用与批注面板处理已有引用。')
      requests = {
        ...requests,
        [sessionId]: { messageId, token: `${epoch}:${++revision}`, ...(quote === undefined ? {} : { quote }) }
      }
      publish()
    },
    consume(sessionId: string, token?: string) {
      if (!requests[sessionId] || (token && requests[sessionId].token !== token)) return
      const next = { ...requests }
      delete next[sessionId]
      requests = next
      publish()
    }
  }
}
