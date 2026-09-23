/** A mutation outlives its panel. Remounts share this state until it settles. */
export function createOperation() {
  let pending = false
  const listeners = new Set<() => void>()
  const publish = (value: boolean): void => {
    pending = value
    for (const cb of listeners) cb()
  }
  return {
    getSnapshot: () => pending,
    subscribe: (cb: () => void) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
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
