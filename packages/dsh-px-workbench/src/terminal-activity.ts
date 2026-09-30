export interface TerminalOwner {
  ctx?: { get: (name: string) => unknown }
}
export interface NativeTerminalRegistry {
  hasOwnerActivity: (owner: TerminalOwner) => boolean
  list: (owner: TerminalOwner) => readonly unknown[]
}
export interface TerminalSources {
  native: (owner: TerminalOwner) => NativeTerminalRegistry | undefined
}

/**
 * Count native DSH terminal resources, not guessed foreground command state. Terminals are owned
 * by the host `terminals` service; the bundled sidebar opens them through that service and has no
 * terminal registry of its own. Registries that are closing are retained until they drain.
 */
export function createTerminalActivityReader() {
  const nativeOwners = new Map<TerminalOwner, Map<object, NativeTerminalRegistry>>()
  return (
    owners: readonly TerminalOwner[],
    sources?: TerminalSources
  ): { known: boolean; openTerminals: number } => {
    const result = { known: false, openTerminals: 0 }
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
      result.known = Number.isSafeInteger(result.openTerminals) && result.openTerminals >= 0
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

export function registerTerminalActivity(
  ctx: TerminalHost
): (owners: readonly TerminalOwner[]) => { known: boolean; openTerminals: number } {
  const read = createTerminalActivityReader()
  let native: NativeTerminalRegistry | undefined
  let bound = false
  ctx.inject(['terminals'], (host) => {
    const value = host.terminals as NativeTerminalRegistry | undefined
    native = value
    bound = true
    host.effect?.(
      () => () => {
        if (native === value) {
          native = undefined
          bound = false
        }
      },
      'workbench: terminal activity source'
    )
  })
  return (owners) =>
    read(
      owners,
      bound
        ? { native: (owner) => (owner.ctx?.get('terminals') as NativeTerminalRegistry | undefined) ?? native }
        : undefined
    )
}
