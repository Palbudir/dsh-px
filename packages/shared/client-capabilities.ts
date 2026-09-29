/**
 * The official Desktop preload exposes `window.dshDesktop` with a numeric protocol version.
 * A browser connected to the same service has no such bridge, so it is never labelled Desktop.
 */
export function pageCarrier(value: unknown): 'desktop' | 'browser' {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Number.isSafeInteger((value as any).protocolVersion) &&
    (value as any).protocolVersion > 0
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
