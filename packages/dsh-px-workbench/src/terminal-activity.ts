import {
  SIDEBAR_TERMINAL_PATCH_ID,
  type SidebarTerminalService
} from '../../shared/sidebar-terminal-contract'

export interface TerminalOwner {
  ctx?: { get: (name: string) => unknown }
}
export interface NativeTerminalRegistry {
  hasOwnerActivity: (owner: TerminalOwner) => boolean
  list: (owner: TerminalOwner) => readonly unknown[]
}
export interface TerminalSources {
  entries: () => Iterable<{ options: { name: string }; disabled: boolean; fiber?: { state: number } }>
  sidebar: () => SidebarTerminalService | undefined
  native: (owner: TerminalOwner) => NativeTerminalRegistry | undefined
}

/** Count resources, not guessed foreground command state. Retain closing registries until drained. */
export function createTerminalActivityReader() {
  const sidebars = new Set<SidebarTerminalService>()
  const nativeOwners = new Map<TerminalOwner, Map<object, NativeTerminalRegistry>>()
  const read = (
    owners: readonly TerminalOwner[],
    sources?: TerminalSources
  ): { known: boolean; openTerminals: number } => {
    const result = { known: false, openTerminals: 0 }
    if (!sources) return result
    try {
      const sidebar = sources.sidebar()
      const expected = [...sources.entries()].some(
        (entry) =>
          entry.options.name === 'dsh-better-sidebar' &&
          (!entry.disabled || [1, 2, 5].includes(entry.fiber?.state ?? -1))
      )
      if (expected && !sidebar) return result
      if (sidebar) sidebars.add(sidebar)
      for (const service of sidebars) {
        if (service.version !== 1 || service.patchId !== SIDEBAR_TERMINAL_PATCH_ID) return result
        const snapshot = service.snapshot()
        if (
          snapshot.known !== true ||
          !Number.isSafeInteger(snapshot.openTerminals) ||
          snapshot.openTerminals < 0 ||
          typeof snapshot.closing !== 'boolean'
        )
          return result
        result.openTerminals += snapshot.openTerminals
        if (service !== sidebar && snapshot.closing && snapshot.openTerminals === 0) sidebars.delete(service)
      }
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
    } catch {
      // A missing or incompatible contract must never be reported as an idle terminal service.
    }
    return result
  }
  return Object.assign(read, {
    observeSidebar: (service: SidebarTerminalService) => {
      sidebars.add(service)
    }
  })
}

export function registerTerminalActivity(
  ctx: any
): (owners: readonly TerminalOwner[]) => { known: boolean; openTerminals: number } {
  const read = createTerminalActivityReader()
  let loader: { entries: TerminalSources['entries'] } | undefined
  let sidebar: SidebarTerminalService | undefined
  let native: NativeTerminalRegistry | undefined
  const bind = (name: string, set: (value: any) => void, get: () => any): void => {
    ctx.inject([name], (host: any) => {
      const value = host[name]
      set(value)
      host.effect?.(
        () => () => {
          if (get() === value) set(undefined)
        },
        'workbench: terminal activity source'
      )
    })
  }
  bind(
    'loader',
    (value) => {
      loader = value
    },
    () => loader
  )
  bind(
    'dshPxSidebarTerminals',
    (value) => {
      sidebar = value
      if (value) read.observeSidebar(value)
    },
    () => sidebar
  )
  bind(
    'terminals',
    (value) => {
      native = value
    },
    () => native
  )
  return (owners) =>
    read(
      owners,
      loader
        ? {
            entries: () => loader!.entries(),
            sidebar: () => sidebar,
            native: (owner) => (owner.ctx?.get('terminals') as NativeTerminalRegistry | undefined) ?? native
          }
        : undefined
    )
}
