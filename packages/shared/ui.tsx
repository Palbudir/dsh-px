import { useState } from 'react'

/** Theme tokens are resolved by DSH; this sheet affects only PX-owned surfaces. */
export const uiCss = `
.px-ui{--px-bg:var(--dsw-alias-bg-base,#fff);--px-layer:var(--dsw-alias-bg-layer-1,#f8f9fb);--px-fg:var(--dsw-alias-label-primary,#20242d);--px-muted:var(--dsw-alias-label-secondary,#657080);--px-border:var(--dsw-alias-border-l2,#d9dee7);--px-accent:var(--dsw-alias-state-business-primary,#466dea);--px-error:var(--dsw-alias-state-error-primary,#bc3946);color:var(--px-fg);font-size:13px;line-height:1.6}
.px-ui button,.px-ui input,.px-ui select,.px-ui textarea{font:inherit;color:inherit}
.px-ui button{min-height:32px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:5px 11px;border:1px solid var(--px-border);border-radius:8px;background:var(--px-bg);cursor:pointer;transition:background-color 130ms ease,border-color 130ms ease,color 130ms ease,box-shadow 130ms ease,transform 100ms ease}
.px-ui button:not(:disabled):hover{background:color-mix(in srgb,var(--px-fg) 7%,var(--px-bg));border-color:color-mix(in srgb,var(--px-fg) 25%,var(--px-border))}
.px-ui button:not(:disabled):active{transform:translateY(1px)}
.px-ui button:disabled{cursor:default!important;opacity:.45}
.px-ui :is(button,input,select,textarea,summary):focus-visible{outline:2px solid var(--px-accent);outline-offset:2px}
.px-ui :is(input,select,textarea){border:1px solid var(--px-border);border-radius:8px;background:var(--px-bg);padding:7px 9px;box-sizing:border-box;transition:border-color 130ms ease,box-shadow 130ms ease}
.px-ui textarea{resize:vertical}.px-ui input[type=checkbox]{accent-color:var(--px-accent)}
.px-ui .px-primary{background:color-mix(in srgb,var(--px-accent) 12%,var(--px-bg));border-color:var(--px-accent);color:var(--px-accent)}
.px-ui .px-danger,.px-ui [role=alert]{color:var(--px-error)}
.px-ui .px-muted{color:var(--px-muted);font-size:12px}.px-ui [role=status]{overflow-wrap:anywhere}
.px-ui .px-card{border:1px solid var(--px-border);border-radius:10px;padding:14px;margin:12px 0;background:var(--px-bg)}
.px-ui .px-empty{border:1px dashed var(--px-border);border-radius:10px;padding:18px;text-align:center;color:var(--px-muted);margin:14px 0}
.px-ui .px-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0}
.px-ui .px-feedback{border-left:3px solid var(--px-accent);padding:7px 10px;background:var(--px-layer);border-radius:5px;animation:px-feedback-in 150ms ease-out}
.px-ui .px-confirm-delete{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;padding:5px;border:1px solid var(--px-error);border-radius:8px}
.px-icon{width:16px;height:16px;flex:none;display:inline-block;vertical-align:middle}
@keyframes px-feedback-in{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.px-ui,.px-ui *{animation:none!important;transition:none!important;scroll-behavior:auto!important}.px-ui button:not(:disabled):active{transform:none}}
`
export function installUiStyles(ctx: { effect?: (fn: () => () => void, label: string) => unknown }): void {
  ctx.effect?.(() => {
    const style =
      document.querySelector<HTMLStyleElement>('style[data-dsh-px-ui]') ?? document.createElement('style')
    style.dataset.dshPxUi = '1'
    style.textContent = uiCss
    style.dataset.users = String(Number(style.dataset.users ?? 0) + 1)
    if (!style.isConnected) document.head.appendChild(style)
    return () => {
      const users = Number(style.dataset.users) - 1
      style.dataset.users = String(users)
      if (users <= 0) style.remove()
    }
  }, 'px: shared theme')
}
export const controlStyle = {
  borderRadius: 8,
  padding: '5px 11px',
  minHeight: 32,
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 13
}
export const cardStyle = { border: '1px solid var(--px-border)', borderRadius: 10, padding: 14, minWidth: 0 }
const paths: Record<string, string> = {
  file: 'M5 2.5h6l4 4v11H5z M11 2.5v4h4 M8 10h4 M8 13h4',
  terminal: 'M3 4h14v12H3z M6 7l3 3-3 3 M11 13h3',
  artifact: 'M3 6l7-3 7 3-7 3z M3 6v8l7 3 7-3V6 M10 9v8',
  git: 'M6 4v9 M14 7v3c0 3-8 0-8 3 M4 3h4v3H4z M12 4h4v3h-4z M4 13h4v3H4z',
  jobs: 'M10 2a8 8 0 1 0 .01 0 M10 5v5l3 2',
  note: 'M3 3h14v11H9l-4 3v-3H3z M6 7h8 M6 10h5',
  schedule: 'M3 5h14v12H3z M6 2v5 M14 2v5 M3 9h14 M6 12h2 M11 12h2',
  pin: 'M7 3h6l-1 5 3 3H5l3-3z M10 11v6',
  close: 'M5 5l10 10 M15 5L5 15',
  restore: 'M5 5v5h5 M5 10a6 6 0 1 1 1 5',
  plus: 'M10 4v12 M4 10h12'
}
export function Icon({ name }: { name: string }): unknown {
  return (
    <svg
      className="px-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name] ?? paths.file} />
    </svg>
  )
}
export function ConfirmDelete({
  label,
  disabled,
  onConfirm
}: {
  label: string
  disabled?: boolean
  onConfirm: () => Promise<unknown>
}): unknown {
  const [confirm, setConfirm] = useState(false)
  return confirm ? (
    <span className="px-confirm-delete">
      <span>确认{label}？</span>
      <button
        className="px-danger"
        disabled={disabled}
        onClick={() => {
          void onConfirm().finally(() => setConfirm(false))
        }}
      >
        确认{label}
      </button>
      <button disabled={disabled} onClick={() => setConfirm(false)}>
        保留
      </button>
    </span>
  ) : (
    <button className="px-danger" disabled={disabled} onClick={() => setConfirm(true)}>
      {label}
    </button>
  )
}
