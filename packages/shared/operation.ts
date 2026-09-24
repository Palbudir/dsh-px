/** A mutation outlives its panel. Remounts share this state until it settles. */
export function createOperation(onUnused?: () => void) {
  let pending = false
  const listeners = new Set<() => void>()
  const publish = (value: boolean): void => {
    pending = value
    for (const cb of listeners) cb()
    if (!pending && !listeners.size) onUnused?.()
  }
  return {
    getSnapshot: () => pending,
    subscribers: () => listeners.size,
    subscribe: (cb: () => void) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
        if (!pending && !listeners.size) onUnused?.()
      }
    },
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (pending) throw new Error('此操作仍在进行，请稍后查看结果。')
      publish(true)
      try {
        return await fn()
      } finally {
        publish(false)
      }
    }
  }
}

export function createOperationRegistry() {
  const operations = new Map<string, ReturnType<typeof createOperation>>()
  return {
    get(key: string) {
      let operation = operations.get(key)
      if (!operation) {
        operation = createOperation(() => {
          // A React effect can unsubscribe and immediately subscribe again during replay.
          queueMicrotask(() => {
            if (operations.get(key) === operation && !operation!.getSnapshot() && !operation!.subscribers())
              operations.delete(key)
          })
        })
        operations.set(key, operation)
      }
      return operation
    },
    pending: (key: string) => operations.get(key)?.getSnapshot() === true,
    size: () => operations.size
  }
}
