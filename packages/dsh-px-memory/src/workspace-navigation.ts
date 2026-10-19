/** Use native Slot shadowing; the community registration remains owned by Mnemon. */
export function memoryNavigation(host: any, component: any, icon: any) {
  let stopMain: (() => void) | undefined
  let advanced = false
  let disposed = false
  let ready = false
  const install = () => {
    if (!disposed && ready && !stopMain)
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
    if (advanced && host.layout.panelInfo.getSnapshot().activePanelId !== 'mnemon') restore()
  })
  return {
    open: () => {
      restore()
      host.layout.selectPanel('mnemon')
    },
    openNative: () => {
      const original = host.slots
        .entries('main')
        .some((entry: any) => entry.options.key === 'mnemon' && entry.component !== component)
      if (!original) throw Error('原生记忆管理页未启用。请在 Mnemon 配置中启用页面，并选择侧栏展示。')
      advanced = true
      stopMain?.()
      stopMain = undefined
      host.layout.selectPanel('mnemon')
    },
    dispose: () => {
      disposed = true
      stopSelection()
      stop()
      stopMain?.()
      stopMain = undefined
    }
  }
}
