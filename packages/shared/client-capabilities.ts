export function pageCarrier(value: unknown): 'desktop' | 'browser' {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as any).app === 'DSH-PX' &&
    typeof (value as any).electron === 'string'
  )
    ? 'desktop'
    : 'browser'
}
export function createCapabilities<T extends object>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: Partial<T>) {
      value = { ...value, ...next }
      for (const listener of listeners) listener()
    }
  }
}
