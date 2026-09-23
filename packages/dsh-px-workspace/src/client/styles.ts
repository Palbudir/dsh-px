export const css = `
body[data-dsh-px-workspace] div:has(> [data-shell-overlay]){padding-top:86px;box-sizing:border-box}
body[data-dsh-px-workspace] div[data-rightbar-fullscreen]:has(> [data-shell-overlay]){padding-top:0}
[data-rightbar-fullscreen] .px-bar{display:none}
.px-bar{position:absolute;inset:0 0 auto;height:86px;box-sizing:border-box;pointer-events:auto;background:var(--px-bg);border-bottom:1px solid var(--px-border);display:flex;flex-direction:column;padding:6px 12px;gap:6px;isolation:isolate}
.px-brand{flex:none;font-size:12px;letter-spacing:.04em;margin:0 7px 0 2px;color:var(--px-muted)}
.px-tabs,.px-tools{display:flex;align-items:center;gap:6px;min-width:0;height:34px;flex:none}
.px-tabstrip{display:flex;flex:1;overflow-x:auto;overflow-y:hidden;gap:5px;min-width:50px;scrollbar-width:thin;padding:2px}
.px-tab{display:flex;align-items:center;flex:none;max-width:276px;border:1px solid var(--px-border);border-radius:9px;transition:background-color 130ms ease,border-color 130ms ease}
.px-tab[data-active=true]{border-color:var(--px-accent);background:color-mix(in srgb,var(--px-accent) 9%,var(--px-bg))}
.px-bar .px-tab>button{min-height:28px;border:0;background:transparent;border-radius:6px;padding:3px 7px;flex:none}
.px-bar .px-tab>button[role=tab]{max-width:196px;min-width:0;flex:1;justify-content:flex-start;gap:6px}
.px-tab-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.px-bar .px-tab-action{width:27px;padding:3px;color:var(--px-muted)}
.px-tab-action[aria-pressed=true]{color:var(--px-accent)}
.px-session-dot{width:6px;height:6px;border-radius:50%;background:var(--px-muted);opacity:.4;flex:none}.px-session-dot.is-running{background:var(--px-accent);opacity:1}.px-session-dot.is-done{background:var(--dsw-alias-state-success-primary,#23835d);opacity:1}
.px-tabs>button,.px-tabs>select{flex:none}.px-tabs>select{max-width:155px;height:32px;padding:3px 7px}.px-restore{width:32px;padding:0!important}
.px-tools{overflow-x:auto;scrollbar-width:thin}.px-tools>button{white-space:nowrap;flex:none;border-color:transparent;background:transparent;padding:4px 8px}
.px-status{margin-left:auto;white-space:nowrap;color:var(--px-muted);font-size:12px;padding:0 5px}
.px-bar-error{position:absolute;right:12px;top:88px;max-width:min(540px,calc(100vw - 24px));border:1px solid var(--px-error);background:var(--px-bg);padding:9px 12px;border-radius:9px;display:flex;gap:10px;align-items:center;box-shadow:0 4px 18px #0002}
.px-panel{padding:16px;height:100%;overflow:auto;overflow-wrap:anywhere;box-sizing:border-box;animation:px-panel-in 130ms ease-out}
.px-panel h3{font-size:17px;line-height:1.45;margin:0 0 8px}.px-panel h4{font-size:14px;margin:4px 0}.px-panel p{margin:8px 0 12px}
.px-panel label{display:block;font-size:13px}.px-panel :is(textarea,input,select){display:block;width:100%;margin:5px 0 12px}.px-panel textarea{min-height:80px}
.px-panel fieldset{border:0;margin:0;padding:0;min-width:0}.px-panel fieldset:disabled{opacity:.7}
.px-panel label.px-check{display:flex;gap:7px;align-items:center}.px-panel input[type=checkbox]{display:inline;width:16px;height:16px;margin:0}
.px-panel pre,.px-panel blockquote{white-space:pre-wrap;margin:9px 0;max-height:220px;overflow:auto;font:inherit}.px-panel blockquote{border-left:3px solid var(--px-accent);padding-left:11px;color:var(--px-muted)}
.px-load-status{font-size:12px;min-height:20px;color:var(--px-muted);display:block}
.px-quote-action{font-size:12px!important;min-height:28px!important;padding:3px 8px!important}
@keyframes px-panel-in{from{opacity:.6}to{opacity:1}}
@media(max-width:1000px){.px-status{display:none}.px-brand{display:none}.px-tabs>select{max-width:116px}.px-bar{padding-left:6px;padding-right:6px}.px-tools>button{padding-inline:6px}}
`
