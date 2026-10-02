export interface TerminalOwner {
  id?: string
  ctx?: { get: (name: string) => unknown }
}
export interface NativeTerminalRegistry {
  hasOwnerActivity: (owner: TerminalOwner) => boolean
  list: (owner: TerminalOwner) => readonly unknown[]
}
/** DSH `terminalController`: interactive browser/sidebar shells, retained per Session id. */
export interface BrowserTerminalController {
  list: (sessionId: string) => readonly unknown[]
}
export interface TerminalSources {
  native: (owner: TerminalOwner) => NativeTerminalRegistry | undefined
  browser: BrowserTerminalController
}
export interface TerminalActivity {
  known: boolean
  observedKnown: boolean
  scope: 'observed-sessions'
  openTerminals: number
}

/**
 * Count terminal resources, not guessed foreground command state. DSH has two owners of terminals:
 * the Agent-scoped `terminals` service (Agent tool terminals, read per owner; an Agent without it
 * has none) and the host `terminalController` (interactive shells the user opens in the sidebar,
 * spawned directly through the subprocess service). Without `terminalController` the count is
 * unknown, never idle. Closing native registries are retained until they drain. Browser shells are
 * released only when their Agent's context is disposed and cleanup succeeds, which can finish after
 * the Agent has left the list (or never, when cleanup fails); every Session id seen as an owner is
 * therefore counted until its shells are gone. The public controller cannot enumerate all Session
 * owners: a shell can outlive an Agent that no poll observed. Counts are observations only, never a
 * complete Host inventory. `known` stays false even when `observedKnown` confirms a successful read.
 */
export function createTerminalActivityReader() {
  const nativeOwners = new Map<TerminalOwner, Map<object, NativeTerminalRegistry>>()
  const browserSessions = new Set<string>()
  return (owners: readonly TerminalOwner[], sources?: TerminalSources): TerminalActivity => {
    const result: TerminalActivity = {
      known: false,
      observedKnown: false,
      scope: 'observed-sessions',
      openTerminals: 0
    }
    if (!sources) return result
    try {
      for (const owner of owners) {
        const registry = sources.native(owner)
        if (registry) {
          let registries = nativeOwners.get(owner)
          if (!registries) nativeOwners.set(owner, (registries = new Map()))
          // Cordis get() creates a new caller-bound Proxy. Its public original
          // symbol identifies the same registry without discarding call context.
          const original = (registry as unknown as Record<symbol, object | undefined>)[
            Symbol.for('cordis.original')
          ]
          registries.set(original ?? registry, registry)
        }
        if (typeof owner.id !== 'string') return result
        browserSessions.add(owner.id)
      }
      for (const sessionId of browserSessions) {
        const shells = sources.browser.list(sessionId)
        if (!Array.isArray(shells)) return result
        // A Session that has left the Agent list is dropped only once its shells are gone.
        if (!shells.length && !owners.some((owner) => owner.id === sessionId))
          browserSessions.delete(sessionId)
        result.openTerminals += shells.length
      }
      for (const [owner, registries] of nativeOwners) {
        for (const [identity, registry] of registries) {
          const active = registry.hasOwnerActivity(owner)
          if (typeof active !== 'boolean') return result
          if (!active) {
            registries.delete(identity)
            continue
          }
          const sessions = registry.list(owner)
          if (!Array.isArray(sessions)) return result
          // A pending native spawn is active before a session can appear in list().
          result.openTerminals += Math.max(1, sessions.length)
        }
        if (!registries.size) nativeOwners.delete(owner)
      }
      result.observedKnown = Number.isSafeInteger(result.openTerminals) && result.openTerminals >= 0
    } catch (error) {
      // An incompatible contract must never be reported as an idle terminal service.
      void error
    }
    return result
  }
}

interface TerminalHost {
  inject: (names: string[], apply: (host: Record<string, unknown> & TerminalHostEffects) => void) => void
}
interface TerminalHostEffects {
  effect?: (setup: () => () => void, label: string) => void
}
/** The part of DSH `agentPresets` used here: a service mounted inside an Agent's preset group. */
interface AgentPresetLookup {
  serviceFor: (agent: { ctx: unknown }, name: string) => unknown
}

export function registerTerminalActivity(
  ctx: TerminalHost
): (owners: readonly TerminalOwner[]) => TerminalActivity {
  const read = createTerminalActivityReader()
  // `terminals` is an Agent-scoped service. Official presets mount it inside an isolated preset
  // group that is not under the Agent's own fiber, so `agent.ctx.get('terminals')` cannot see it;
  // the owning `agentPresets.serviceFor(agent, 'terminals')` lookup can. An Agent is listed only
  // after its preset finished mounting, so "no terminals service" there means it has none. The
  // host-level `terminalController` is required.
  let native: NativeTerminalRegistry | undefined
  let browser: BrowserTerminalController | undefined
  let presets: AgentPresetLookup | undefined
  ctx.inject(['agentPresets'], (host) => {
    const value = host.agentPresets as AgentPresetLookup | undefined
    presets = value
    host.effect?.(
      () => () => {
        if (presets === value) presets = undefined
      },
      'workbench: agent preset terminal lookup'
    )
  })
  ctx.inject(['terminals'], (host) => {
    const value = host.terminals as NativeTerminalRegistry | undefined
    native = value
    host.effect?.(
      () => () => {
        if (native === value) native = undefined
      },
      'workbench: native terminal activity source'
    )
  })
  ctx.inject(['terminalController'], (host) => {
    const value = host.terminalController as BrowserTerminalController | undefined
    browser = value
    host.effect?.(
      () => () => {
        if (browser === value) browser = undefined
      },
      'workbench: browser terminal activity source'
    )
  })
  return (owners) =>
    read(
      owners,
      browser
        ? {
            native: (owner) =>
              (owner.ctx && typeof presets?.serviceFor === 'function'
                ? (presets.serviceFor(owner as { ctx: unknown }, 'terminals') as
                    NativeTerminalRegistry | undefined)
                : undefined) ??
              (owner.ctx?.get('terminals') as NativeTerminalRegistry | undefined) ??
              native,
            browser
          }
        : undefined
    )
}
