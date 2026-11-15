/** Transport serialization per conversation. A canceled queued send never invokes its producer. */
export class ChannelSendQueue {
  busy(conversation: string): boolean {
    return this.tails.has(conversation)
  }
  private readonly tails = new Map<string, Promise<unknown>>()
  run<T>(conversation: string, signal: AbortSignal, send: () => Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason ?? Error('发送已取消'))
    const previous = this.tails.get(conversation) ?? Promise.resolve()
    let queued = true,
      reject!: (error: unknown) => void
    const cancelled = new Promise<never>((_, fail) => {
      reject = fail
    })
    const abort = () => {
      if (queued) {
        signal.removeEventListener('abort', abort)
        reject(signal.reason ?? Error('排队发送已取消'))
      }
    }
    signal.addEventListener('abort', abort, { once: true })
    const result = previous
      .catch(() => {})
      .then(() => {
        queued = false
        signal.removeEventListener('abort', abort)
        signal.throwIfAborted()
        return send()
      })
    this.tails.set(conversation, result)
    void result
      .finally(() => {
        if (this.tails.get(conversation) === result) this.tails.delete(conversation)
      })
      .catch(() => {})
    return Promise.race([result, cancelled])
  }
  async drain() {
    await Promise.allSettled([...this.tails.values()])
  }
}
