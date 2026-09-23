import { useEffect, useState } from 'react'
import { RequestError, requestJson } from '../../../shared/client-http'
import type { Snapshot } from './contracts'
import { createOperation } from '../../../shared/operation'
const operations = new Map<string, ReturnType<typeof createOperation>>()
export function useOperation(key: string): [boolean, ReturnType<typeof createOperation>['run']] {
  const [operation] = useState(() => {
    if (!operations.has(key)) operations.set(key, createOperation())
    return operations.get(key)!
  })
  return [useSnapshot(operation), operation.run]
}
export const base = '/dsh-px-workspace'
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
export const stamp = (time: number | null): string =>
  time === null ? '已暂停' : new Date(time).toLocaleString()
export const post = <T>(route: string, value: unknown): Promise<T> =>
  requestJson<T>(`${base}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  })
// Native single tabs focus an existing view without replacing its params. A small
// plugin-owned observable routes repeated quote selections into that same view.
const quoteEpoch = Date.now().toString(36) + Math.random().toString(36).slice(2)
let quoteSelections: Record<string, { messageId: string; token: string }> = {}
let quoteRevision = 0
const quoteListeners = new Set<() => void>()
export const quoteRequests: Snapshot<typeof quoteSelections> = {
  getSnapshot: () => quoteSelections,
  subscribe: (cb) => {
    quoteListeners.add(cb)
    return () => {
      quoteListeners.delete(cb)
    }
  }
}
export function requestQuote(sessionId: string, messageId: string): void {
  quoteSelections = {
    ...quoteSelections,
    [sessionId]: { messageId, token: `${quoteEpoch}:${++quoteRevision}` }
  }
  for (const cb of quoteListeners) cb()
}
export function useSnapshot<T>(store: Snapshot<T>): T {
  const [value, set] = useState(store.getSnapshot)
  useEffect(() => {
    const refresh = (): void => set(store.getSnapshot())
    refresh()
    return store.subscribe(refresh)
  }, [store])
  return value
}
const cache = new Map<string, unknown>()
export function useData<T>(
  url: string,
  enabled: boolean
): { data: T | null; error: string; loading: boolean; refresh: () => void } {
  const [data, set] = useState<T | null>(() => (cache.get(url) as T) ?? null),
    [error, setError] = useState(''),
    [revision, revise] = useState(0),
    [loading, setLoading] = useState(false)
  useEffect(() => {
    let alive = true,
      busy = false,
      retry = true,
      timer: ReturnType<typeof setTimeout>,
      controller: AbortController | undefined
    set((cache.get(url) as T) ?? null)
    setError('')
    if (!enabled) return
    const read = async (): Promise<void> => {
      if (!alive || busy || document.hidden || !retry) return
      busy = true
      setLoading(true)
      controller = new AbortController()
      try {
        const value = await requestJson<T>(url, { signal: controller.signal })
        if (alive) {
          cache.delete(url)
          cache.set(url, value)
          if (cache.size > 40) cache.delete(cache.keys().next().value!)
          set(value)
          setError('')
        }
      } catch (e) {
        if (alive && !controller.signal.aborted) {
          retry = !(e instanceof RequestError) || e.retryable
          setError(errorText(e))
        }
      } finally {
        busy = false
        if (alive) {
          setLoading(false)
          if (retry && !document.hidden) timer = setTimeout(() => void read(), 5000)
        }
      }
    }
    const visibility = (): void => {
      clearTimeout(timer)
      if (document.hidden) controller?.abort()
      else void read()
    }
    document.addEventListener('visibilitychange', visibility)
    void read()
    return () => {
      alive = false
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [url, enabled, revision])
  return { data, error, loading, refresh: () => revise((n) => n + 1) }
}
