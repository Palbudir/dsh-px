export interface StyleOwner {
  effect?: (effect: () => () => void, label: string) => unknown
}

/** Effect-owned styles must never be adopted by an unrelated native module factory. */
export function installOwnedStyle(ctx: StyleOwner, key: string, css: string): void {
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error('Invalid PX stylesheet key')
  ctx.effect?.(() => {
    const style =
      document.querySelector<HTMLStyleElement>(`style[data-dsh-px-style="${key}"]`) ??
      document.createElement('style')
    style.dataset.dshPxStyle = key
    // Native claimStyles only adopts untagged nodes. This reserved owner is disposed by
    // the ref-counted Cordis effects below, including when multiple features share CSS.
    style.setAttribute('data-plugin', `dsh-px-effect:${key}`)
    style.textContent = css
    style.dataset.users = String(Number(style.dataset.users ?? 0) + 1)
    if (!style.isConnected) document.head.appendChild(style)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const users = Number(style.dataset.users) - 1
      style.dataset.users = String(users)
      if (users <= 0) style.remove()
    }
  }, `px: ${key} stylesheet`)
}
