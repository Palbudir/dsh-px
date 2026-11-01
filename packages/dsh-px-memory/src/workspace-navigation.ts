export interface SkillPageRequest {
  serial: number
  sessionId: string
  name: string
}
export function skillAnchorName(anchor: any, currentSessionId?: string): string | undefined {
  if (
    !currentSessionId ||
    anchor?.page !== 'skills/library' ||
    (anchor.sessionId !== undefined && anchor.sessionId !== currentSessionId) ||
    typeof anchor.seed !== 'string'
  )
    return
  const match = /^name:([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(anchor.seed)
  return match && match[1].length <= 80 ? match[1] : undefined
}
/** Use native Slot shadowing; the community registration remains owned by Mnemon. */
export function memoryNavigation(
  host: any,
  component: any,
  icon: any,
  events: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | undefined = typeof window ===
  'undefined'
    ? undefined
    : window,
  routes?: { reset(): void }
) {
  let stopMain: (() => void) | undefined
  let advanced = false
  let disposed = false
  let ready = false
  const install = () => {
    if (!disposed && !advanced && ready && !stopMain)
      stopMain = host.slots.register({ name: 'main', key: 'mnemon', priority: -10 }, component)
  }
  const stop = host.slots.inject('main', () =>
    host.slots.inject('sidebar.panellist', () => {
      ready = true
      install()
      const stopIcon = host.slots.register(
        { name: 'sidebar.panellist', id: 'mnemon', priority: -10, order: 30, label: '记忆与知识' },
        icon
      )
      return () => {
        ready = false
        stopIcon()
        stopMain?.()
        stopMain = undefined
      }
    })
  )
  const restore = () => {
    advanced = false
    install()
  }
  const stopSelection = host.layout.panelInfo.subscribe(() => {
    if (host.layout.panelInfo.getSnapshot().activePanelId !== 'mnemon') {
      routes?.reset()
      if (advanced) restore()
    }
  })
  const hasNative = () =>
    host.slots
      .entries('main')
      .some((entry: any) => entry.options.key === 'mnemon' && entry.component !== component)
  const stopEntries = host.slots.subscribe('main', () => {
    // A different window can disable Mnemon while its advanced page is open.
    if (advanced && ready && !hasNative()) restore()
  })
  const openNative = () => {
    if (!hasNative()) throw Error('原生记忆管理页未启用。请在 Mnemon 配置中启用页面，并选择侧栏展示。')
    advanced = true
    routes?.reset()
    stopMain?.()
    stopMain = undefined
    host.layout.selectPanel('mnemon')
  }
  // Mnemon 0.5.34 retains the source-owned anchor until its own view mounts. Delegate
  // it unchanged instead of consuming the seed or rebuilding native detail pages.
  const onAnchor = (event: Event) => {
    const page = (event as CustomEvent).detail?.page
    if (disposed || typeof page !== 'string' || !page || !hasNative()) return
    if (
      page.split('/')[0] === 'skills' &&
      host.slots.entries('main').some((entry: any) => entry.options.key === 'mnemon-skills')
    )
      return // The community's independent Skills panel already owns this route.
    openNative()
  }
  events?.addEventListener('mnemon:anchor', onAnchor)
  return {
    open: () => {
      routes?.reset()
      restore()
      host.layout.selectPanel('mnemon')
    },
    openNative,
    openSkillView: () => {
      restore()
      host.layout.selectPanel('mnemon')
    },
    dispose: () => {
      disposed = true
      events?.removeEventListener('mnemon:anchor', onAnchor)
      stopSelection()
      stopEntries()
      stop()
      stopMain?.()
      stopMain = undefined
    }
  }
}
