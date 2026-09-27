/** Page-lifetime form drafts. Persistence is tab-scoped; nothing is submitted automatically. */
export interface DraftStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem?: (key: string) => void
}
export function createDraftCell<T>(
  key: string,
  initial: T,
  storage?: DraftStorage,
  validate: (value: T) => boolean = () => true
) {
  let value = initial
  let persisted = Boolean(storage)
  let unreadable = false
  let memoryEdits = false
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
        if (!validate(restored as T)) throw new Error('invalid draft record')
        value = restored as T
      } else if (raw) {
        throw new Error('unsupported draft record')
      }
    } else if (raw) {
      throw new Error('draft record too large')
    }
  } catch {
    /* Keep the unreadable record until an explicit edit replaces it. */
    unreadable = true
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    isPersisted: () => persisted,
    isUnreadable: () => unreadable,
    canReleaseMemory: () => persisted || !memoryEdits,
    subscribers: () => listeners.size,
    isEmpty: () => JSON.stringify(value) === JSON.stringify(initial),
    subscribe: (cb: () => void) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    set: (next: T | ((old: T) => T)) => {
      unreadable = false
      memoryEdits = true
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
    },
    clear: (cleanValue: T = initial) => {
      value = cleanValue && typeof cleanValue === 'object' ? { ...cleanValue } : cleanValue
      unreadable = false
      memoryEdits = false
      persisted = Boolean(storage)
      try {
        storage?.removeItem?.(key)
      } catch {
        persisted = false
      }
      for (const cb of listeners) cb()
    }
  }
}

/** Persisted inactive drafts can leave memory; unsaved memory-only edits must never be evicted. */
export function createDraftRegistry(limit = 48, canEvict: (key: string) => boolean = () => true) {
  const cells = new Map<string, ReturnType<typeof createDraftCell<any>>>()
  const trim = (reserve = 0): void => {
    for (const [key, cell] of cells) {
      if (cells.size + reserve <= limit) break
      if (cell.subscribers() === 0 && canEvict(key) && (cell.canReleaseMemory() || cell.isEmpty()))
        cells.delete(key)
    }
  }
  return {
    acquire<T extends object>(
      key: string,
      initial: T,
      storage?: DraftStorage,
      validate?: (value: T) => boolean
    ) {
      const existing = cells.get(key)
      if (existing) {
        cells.delete(key)
        cells.set(key, existing)
        return existing as ReturnType<typeof createDraftCell<T>>
      }
      trim(1)
      if (cells.size >= limit) return null
      const cell = createDraftCell(key, initial, storage, validate)
      cells.set(key, cell)
      return cell
    },
    size: () => cells.size,
    release: () => trim()
  }
}
