/** Public Slot lifetime and metadata remain owned by the original Source component. */
export function mountMnemonSkillPage(host: any, wrap: (Native: any) => any): () => void {
  const slot = 'mnemon.source.page',
    id = 'skills/library'
  return host.slots.inject(slot, () => {
    let own: any, native: any, remove: (() => void) | undefined
    const refresh = () => {
      const entry = host.slots
        .entries(slot)
        .filter((entry: any) => entry.options.id === id && entry.component !== own)
        .sort((a: any, b: any) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0]
      if (native === entry?.component) return
      remove?.()
      remove = undefined
      native = entry?.component
      if (!native) return
      own = Object.assign(wrap(native), {
        ...(native.mnemonNavigation ? { mnemonNavigation: native.mnemonNavigation } : {})
      })
      remove = host.slots.register({ name: slot, id, priority: -10 }, own)
    }
    const off = host.slots.subscribe(slot, refresh)
    refresh()
    return () => {
      off()
      remove?.()
    }
  })
}
