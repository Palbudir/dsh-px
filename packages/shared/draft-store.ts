/** Page-lifetime form drafts. Persistence is tab-scoped; nothing is submitted automatically. */
export interface DraftStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}
export function createDraftCell<T>(key: string, initial: T, storage?: DraftStorage) {
  let value = initial
  let persisted = Boolean(storage)
  try {
    const raw = storage?.getItem(key)
    if (raw && raw.length <= 150000) {
      const parsed = JSON.parse(raw)
      if (
        parsed?.version === 1 &&
        parsed.value &&
        typeof parsed.value === 'object' &&
        !Array.isArray(parsed.value)
      ) {
        const restored = { ...initial } as Record<string, unknown>
        for (const [name, seed] of Object.entries(initial as object)) {
          const candidate = parsed.value[name]
          if (
            (typeof seed === 'string' && typeof candidate === 'string') ||
            (typeof seed === 'boolean' && typeof candidate === 'boolean') ||
            (typeof seed === 'number' && typeof candidate === 'number' && Number.isFinite(candidate)) ||
            (seed === null &&
              (candidate === null ||
                (candidate && typeof candidate === 'object' && !Array.isArray(candidate))))
          )
            restored[name] = candidate
        }
        value = restored as T
      }
    }
  } catch {
    /* Keep the unreadable record until an explicit edit replaces it. */
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    isPersisted: () => persisted,
    subscribe: (cb: () => void) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    set: (next: T | ((old: T) => T)) => {
      value = typeof next === 'function' ? (next as (old: T) => T)(value) : next
      persisted = Boolean(storage)
      try {
        const raw = JSON.stringify({ version: 1, value })
        if (raw.length > 150000) throw new Error('draft too large')
        storage?.setItem(key, raw)
      } catch {
        persisted = false
      }
      for (const cb of listeners) cb()
      return persisted
    }
  }
}
