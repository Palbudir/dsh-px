import { requestJson } from '../../shared/client-http'
import { selectedSession } from '../../shared/native-navigation'

const selectionKey = 'dsh-px-persona-directory'
const pendingKey = 'dsh-px-persona-new-pending'
let transientSelection: string | undefined
export const savedPersona = () => {
  try {
    const value = sessionStorage.getItem(selectionKey)
    return value && /^(?:default|[a-f0-9-]{36})$/.test(value) ? value : undefined
  } catch {
    return transientSelection
  }
}
export const rememberPersona = (value?: string) => {
  transientSelection = value
  try {
    if (value) sessionStorage.setItem(selectionKey, value)
    else sessionStorage.removeItem(selectionKey)
  } catch {
    /* Per-window memory still works when persistence is disabled. */
  }
}

/** Capture at New's admission, before any await. Never mutate the selected or restored Session. */
export function personaNavigationClient(ports: {
  selection(): { personaId?: string; currentSessionId?: string }
  load(): Record<string, string>
  save(value: Record<string, string>): void
  uuid(): string
  post(body: unknown): Promise<any>
}) {
  const pending = ports.load()
  return {
    capture() {
      const selection = ports.selection(),
        key = JSON.stringify(selection)
      return {
        key,
        transport: async (request: any) => {
          const operation = JSON.stringify([key, request.workspaceId, request.agentPreset]),
            requestId = pending[operation] ?? ports.uuid()
          pending[operation] = requestId
          ports.save(pending)
          const result = await ports.post({
            type: 'navigate-new',
            ...selection,
            workspaceId: request.workspaceId,
            agentPreset: request.agentPreset,
            requestId
          })
          // A lost HTTP response retains the receipt for the next click/reload. A definite reply ends this operation.
          if (pending[operation] === requestId) {
            delete pending[operation]
            ports.save(pending)
          }
          return result
        }
      }
    }
  }
}

export function registerPersonaNavigationClient(host: any) {
  if (host.sessions.pxPersonaTransportVersion !== 1 || host.uiWorkspace.pxPersonaNavigationVersion !== 1)
    return () => {}
  const navigation = personaNavigationClient({
    selection: () => {
      const personaId = savedPersona()
      return personaId
        ? { personaId }
        : { currentSessionId: selectedSession(host.sessions.list.getSnapshot(), null) }
    },
    load: () => {
      try {
        const entries = JSON.parse(sessionStorage.getItem(pendingKey) ?? '{}')
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return Object.create(null)
        return Object.fromEntries(
          Object.entries(entries).filter(
            ([key, value]) => key.length < 1000 && typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
          )
        ) as Record<string, string>
      } catch {
        return Object.create(null)
      }
    },
    save: (value) => {
      try {
        sessionStorage.setItem(pendingKey, JSON.stringify(value))
      } catch {}
    },
    uuid: () => crypto.randomUUID(),
    post: (body) =>
      requestJson('/dsh-px-personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
  })
  return host.effect(() => {
    host.provide('pxPersonaNavigation', navigation)
  }, 'memory: native New persona selection')
}
