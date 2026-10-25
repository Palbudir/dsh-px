import { nativeReader, type HistoryEvent, service } from './history'
import type { MemoryStore } from './store'

/** Locked identities need only an immutable header for UI polling, not the full long conversation. */
export async function inspectMemorySession(
  host: any,
  identities: MemoryStore,
  id: string,
  needEvents = false
): Promise<{ meta: any; events: readonly HistoryEvent[] }> {
  if (needEvents || !identities.read().bindings[id]?.locked) return host.sessionController.inspect(id)
  const live = service(host, 'sessions')?.get(id)
  if (live) return { meta: live.header, events: [] }
  const reader = await nativeReader(host, id)
  try {
    return { meta: reader.header, events: [] }
  } finally {
    await reader.close?.()
  }
}
