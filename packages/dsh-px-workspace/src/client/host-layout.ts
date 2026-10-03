/** Compatibility adapter for the pinned DSH 0.1.5/0.2 shell.overlay frames. */
export const hostLayoutContract = {
  overlay: '[data-shell-overlay]',
  fullscreen: 'data-rightbar-fullscreen',
  owner: 'data-dsh-px-layout-owner'
} as const
export const hostLayoutCss = `
[data-dsh-px-layout-owner]{padding-top:var(--dsh-px-toolbar-height,46px);box-sizing:border-box;grid-template-rows:minmax(0,1fr)}
[data-dsh-px-layout-owner][data-rightbar-fullscreen]{padding-top:0}
[data-dsh-px-layout-owner][data-rightbar-fullscreen] .px-bar{display:none}
[data-windows-titlebar] [data-dsh-px-layout-owner]{padding-top:calc(var(--dsh-windows-titlebar-height,0px) + var(--dsh-px-toolbar-height,46px))}
[data-windows-titlebar] [data-dsh-px-layout-owner] .px-bar{top:var(--dsh-windows-titlebar-height,0px)}
[data-windows-titlebar] [data-dsh-px-layout-owner][data-rightbar-fullscreen]{padding-top:var(--dsh-windows-titlebar-height,0px)}
`
export function attachToolbarLayout(bar: HTMLElement): () => void {
  const owner = bar.closest(hostLayoutContract.overlay)?.parentElement
  if (!owner) return () => {}
  const previous = owner.style.getPropertyValue('--dsh-px-toolbar-height')
  owner.setAttribute(hostLayoutContract.owner, '')
  const update = (): void => {
    const height = bar.getBoundingClientRect().height
    if (height > 0) owner.style.setProperty('--dsh-px-toolbar-height', `${Math.ceil(height)}px`)
  }
  const observer = new ResizeObserver(update)
  observer.observe(bar)
  update()
  return () => {
    observer.disconnect()
    owner.removeAttribute(hostLayoutContract.owner)
    if (previous) owner.style.setProperty('--dsh-px-toolbar-height', previous)
    else owner.style.removeProperty('--dsh-px-toolbar-height')
  }
}
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))
  )
}
