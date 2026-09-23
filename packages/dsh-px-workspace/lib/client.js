window.__ModuleLoader__.load({
	id: "dsh-px-workspace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		"use strict";
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name in all)
		    __defProp(target, name, { get: all[name], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

		// packages/dsh-px-workspace/src/client.tsx
		var client_exports = {};
		__export(client_exports, {
		  apply: () => apply,
		  inject: () => inject
		});
		module.exports = __toCommonJS(client_exports);

		// packages/dsh-px-workspace/src/client/styles.ts
		var css = `
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
		`;

		// packages/dsh-px-workspace/src/client/data.ts
		var import_react = require("react");

		// packages/shared/client-http.ts
		var RequestError = class extends Error {
		  constructor(message, status, code, retryable = true) {
		    super(message);
		    this.status = status;
		    this.code = code;
		    this.retryable = retryable;
		    this.name = "RequestError";
		  }
		};
		async function requestJson(path, init = {}, allowCheckFailure = false) {
		  const controller = new AbortController();
		  const caller = init.signal;
		  const cancel = () => controller.abort(caller?.reason);
		  if (caller?.aborted) cancel();
		  else caller?.addEventListener("abort", cancel, { once: true });
		  let timedOut = false;
		  const timer = setTimeout(() => {
		    timedOut = true;
		    controller.abort();
		  }, 2e4);
		  try {
		    const headers = new Headers(init.headers);
		    if (!headers.has("accept")) headers.set("accept", "application/json");
		    headers.set("x-dsh-px-request", "1");
		    const response = await fetch(path, { ...init, signal: controller.signal, headers });
		    let body;
		    try {
		      body = await response.json();
		    } catch {
		      throw new RequestError(
		        `\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BFB\u53D6\u7684\u54CD\u5E94\uFF08HTTP ${response.status}\uFF09\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5\u6216\u68C0\u67E5\u65E5\u5FD7\u3002`,
		        response.status || 502,
		        "INVALID_RESPONSE",
		        response.status >= 500 || response.ok
		      );
		    }
		    if (!response.ok && !(allowCheckFailure && response.status === 502 && Array.isArray(body?.errors))) {
		      throw new RequestError(
		        typeof body?.error === "string" ? body.error : `HTTP ${response.status}`,
		        response.status,
		        typeof body?.code === "string" ? body.code : void 0,
		        typeof body?.retryable === "boolean" ? body.retryable : response.status >= 500
		      );
		    }
		    return body;
		  } catch (error) {
		    if (timedOut)
		      throw new Error(
		        init.method && init.method !== "GET" ? "\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u5148\u5237\u65B0\u8BB0\u5F55\u786E\u8BA4\u7ED3\u679C\uFF0C\u907F\u514D\u91CD\u590D\u64CD\u4F5C\u3002" : "\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5"
		      );
		    if (caller?.aborted) throw caller.reason ?? new DOMException("\u8BF7\u6C42\u5DF2\u53D6\u6D88", "AbortError");
		    if (error instanceof TypeError && /fetch|network/i.test(error.message))
		      throw new Error("\u65E0\u6CD5\u8FDE\u63A5\u670D\u52A1\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5");
		    throw error;
		  } finally {
		    clearTimeout(timer);
		    caller?.removeEventListener("abort", cancel);
		  }
		}

		// packages/shared/operation.ts
		function createOperation() {
		  let pending = false;
		  const listeners = /* @__PURE__ */ new Set();
		  const publish = (value) => {
		    pending = value;
		    for (const cb of listeners) cb();
		  };
		  return {
		    getSnapshot: () => pending,
		    subscribe: (cb) => {
		      listeners.add(cb);
		      return () => {
		        listeners.delete(cb);
		      };
		    },
		    async run(fn) {
		      if (pending) throw new Error("\u6B64\u64CD\u4F5C\u4ECD\u5728\u8FDB\u884C\uFF0C\u8BF7\u7A0D\u540E\u67E5\u770B\u7ED3\u679C\u3002");
		      publish(true);
		      try {
		        return await fn();
		      } finally {
		        publish(false);
		      }
		    }
		  };
		}

		// packages/dsh-px-workspace/src/client/data.ts
		var operations = /* @__PURE__ */ new Map();
		function useOperation(key) {
		  const [operation] = (0, import_react.useState)(() => {
		    if (!operations.has(key)) operations.set(key, createOperation());
		    return operations.get(key);
		  });
		  return [useSnapshot(operation), operation.run];
		}
		var base = "/dsh-px-workspace";
		var errorText = (e) => e instanceof Error ? e.message : String(e);
		var stamp = (time) => time === null ? "\u5DF2\u6682\u505C" : new Date(time).toLocaleString();
		var post = (route, value) => requestJson(`${base}/${route}`, {
		  method: "POST",
		  headers: { "Content-Type": "application/json" },
		  body: JSON.stringify(value)
		});
		var quoteEpoch = Date.now().toString(36) + Math.random().toString(36).slice(2);
		var quoteSelections = {};
		var quoteRevision = 0;
		var quoteListeners = /* @__PURE__ */ new Set();
		var quoteRequests = {
		  getSnapshot: () => quoteSelections,
		  subscribe: (cb) => {
		    quoteListeners.add(cb);
		    return () => {
		      quoteListeners.delete(cb);
		    };
		  }
		};
		function requestQuote(sessionId, messageId) {
		  quoteSelections = {
		    ...quoteSelections,
		    [sessionId]: { messageId, token: `${quoteEpoch}:${++quoteRevision}` }
		  };
		  for (const cb of quoteListeners) cb();
		}
		function useSnapshot(store) {
		  const [value, set] = (0, import_react.useState)(store.getSnapshot);
		  (0, import_react.useEffect)(() => {
		    const refresh = () => set(store.getSnapshot());
		    refresh();
		    return store.subscribe(refresh);
		  }, [store]);
		  return value;
		}
		var cache = /* @__PURE__ */ new Map();
		function useData(url, enabled) {
		  const [data, set] = (0, import_react.useState)(() => cache.get(url) ?? null), [error, setError] = (0, import_react.useState)(""), [revision, revise] = (0, import_react.useState)(0), [loading, setLoading] = (0, import_react.useState)(false);
		  (0, import_react.useEffect)(() => {
		    let alive = true, busy = false, retry = true, timer, controller;
		    set(cache.get(url) ?? null);
		    setError("");
		    if (!enabled) return;
		    const read = async () => {
		      if (!alive || busy || document.hidden || !retry) return;
		      busy = true;
		      setLoading(true);
		      controller = new AbortController();
		      try {
		        const value = await requestJson(url, { signal: controller.signal });
		        if (alive) {
		          cache.delete(url);
		          cache.set(url, value);
		          if (cache.size > 40) cache.delete(cache.keys().next().value);
		          set(value);
		          setError("");
		        }
		      } catch (e) {
		        if (alive && !controller.signal.aborted) {
		          retry = !(e instanceof RequestError) || e.retryable;
		          setError(errorText(e));
		        }
		      } finally {
		        busy = false;
		        if (alive) {
		          setLoading(false);
		          if (retry && !document.hidden) timer = setTimeout(() => void read(), 5e3);
		        }
		      }
		    };
		    const visibility = () => {
		      clearTimeout(timer);
		      if (document.hidden) controller?.abort();
		      else void read();
		    };
		    document.addEventListener("visibilitychange", visibility);
		    void read();
		    return () => {
		      alive = false;
		      clearTimeout(timer);
		      controller?.abort();
		      document.removeEventListener("visibilitychange", visibility);
		    };
		  }, [url, enabled, revision]);
		  return { data, error, loading, refresh: () => revise((n) => n + 1) };
		}

		// packages/dsh-px-workspace/src/client/session-bar.tsx
		var import_react3 = require("react");

		// packages/dsh-px-workspace/src/client/tab-state.ts
		function visibleTabs(tabs) {
		  return [
		    ...tabs.ids.filter((id) => tabs.pins.includes(id)),
		    ...tabs.ids.filter((id) => !tabs.pins.includes(id))
		  ];
		}
		function closeTabState(tabs, id, available) {
		  const ordered = visibleTabs(tabs), at = ordered.indexOf(id);
		  const candidates = [...ordered.slice(at + 1), ...ordered.slice(0, at).reverse()];
		  return {
		    tabs: {
		      ...tabs,
		      ids: tabs.ids.filter((x) => x !== id),
		      pins: tabs.pins.filter((x) => x !== id),
		      closed: [id, ...tabs.closed.filter((x) => x !== id)].slice(0, 10)
		    },
		    next: candidates.find((x) => available.includes(x))
		  };
		}
		function parseTabs(raw) {
		  try {
		    const p = JSON.parse(raw ?? "{}");
		    const ids = (v) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && /^[\w-]{1,200}$/.test(x)))] : [];
		    const open = ids(p.ids), closed = ids(p.closed).slice(0, 10), titles = {};
		    for (const id of [...open, ...closed])
		      if (typeof p.titles?.[id] === "string")
		        Object.defineProperty(titles, id, {
		          value: p.titles[id].slice(0, 160),
		          enumerable: true,
		          writable: true,
		          configurable: true
		        });
		    return { ids: open, pins: ids(p.pins).filter((id) => open.includes(id)), closed, titles };
		  } catch {
		    return { ids: [], pins: [], closed: [], titles: {} };
		  }
		}

		// packages/shared/ui.tsx
		var import_react2 = require("react");
		var import_jsx_runtime = require("react/jsx-runtime");
		var uiCss = `
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
		`;
		function installUiStyles(ctx) {
		  ctx.effect?.(() => {
		    const style = document.querySelector("style[data-dsh-px-ui]") ?? document.createElement("style");
		    style.dataset.dshPxUi = "1";
		    style.textContent = uiCss;
		    style.dataset.users = String(Number(style.dataset.users ?? 0) + 1);
		    if (!style.isConnected) document.head.appendChild(style);
		    return () => {
		      const users = Number(style.dataset.users) - 1;
		      style.dataset.users = String(users);
		      if (users <= 0) style.remove();
		    };
		  }, "px: shared theme");
		}
		var paths = {
		  file: "M5 2.5h6l4 4v11H5z M11 2.5v4h4 M8 10h4 M8 13h4",
		  terminal: "M3 4h14v12H3z M6 7l3 3-3 3 M11 13h3",
		  artifact: "M3 6l7-3 7 3-7 3z M3 6v8l7 3 7-3V6 M10 9v8",
		  git: "M6 4v9 M14 7v3c0 3-8 0-8 3 M4 3h4v3H4z M12 4h4v3h-4z M4 13h4v3H4z",
		  jobs: "M10 2a8 8 0 1 0 .01 0 M10 5v5l3 2",
		  note: "M3 3h14v11H9l-4 3v-3H3z M6 7h8 M6 10h5",
		  schedule: "M3 5h14v12H3z M6 2v5 M14 2v5 M3 9h14 M6 12h2 M11 12h2",
		  pin: "M7 3h6l-1 5 3 3H5l3-3z M10 11v6",
		  close: "M5 5l10 10 M15 5L5 15",
		  restore: "M5 5v5h5 M5 10a6 6 0 1 1 1 5",
		  plus: "M10 4v12 M4 10h12"
		};
		function Icon({ name }) {
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		    "svg",
		    {
		      className: "px-icon",
		      viewBox: "0 0 20 20",
		      fill: "none",
		      stroke: "currentColor",
		      strokeWidth: "1.5",
		      strokeLinecap: "round",
		      strokeLinejoin: "round",
		      "aria-hidden": "true",
		      focusable: "false",
		      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: paths[name] ?? paths.file })
		    }
		  );
		}
		function ConfirmDelete({
		  label,
		  disabled,
		  onConfirm
		}) {
		  const [confirm, setConfirm] = (0, import_react2.useState)(false);
		  return confirm ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "px-confirm-delete", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
		      "\u786E\u8BA4",
		      label,
		      "\uFF1F"
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
		      "button",
		      {
		        className: "px-danger",
		        disabled,
		        onClick: () => {
		          void onConfirm().finally(() => setConfirm(false));
		        },
		        children: [
		          "\u786E\u8BA4",
		          label
		        ]
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled, onClick: () => setConfirm(false), children: "\u4FDD\u7559" })
		  ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "px-danger", disabled, onClick: () => setConfirm(true), children: label });
		}

		// packages/dsh-px-workspace/src/client/session-bar.tsx
		var import_jsx_runtime2 = require("react/jsx-runtime");
		var tabKey = "dsh-px.session-tabs.v1";
		var panels = [
		  ["editor", "\u6587\u4EF6", "file"],
		  ["terminal", "\u7EC8\u7AEF", "terminal"],
		  ["px-artifacts", "\u4EA7\u7269", "artifact"],
		  ["git", "\u53D8\u66F4", "git"],
		  ["subagent", "\u540E\u53F0\u4EFB\u52A1", "jobs"],
		  ["px-notes", "\u5F15\u7528\u4E0E\u6279\u6CE8", "note"],
		  ["px-schedules", "\u5B9A\u65F6\u4EFB\u52A1", "schedule"]
		];
		function SessionBar({ ctx }) {
		  const sessions = useSnapshot(ctx.sessions.list);
		  const [sidebarStore] = (0, import_react3.useState)(() => ({
		    getSnapshot: ctx.betterSidebar.getSnapshot,
		    subscribe: ctx.betterSidebar.subscribeState
		  }));
		  useSnapshot(sidebarStore);
		  const [tabs, setTabs] = (0, import_react3.useState)(() => {
		    try {
		      return parseTabs(localStorage.getItem(tabKey));
		    } catch {
		      return parseTabs(null);
		    }
		  });
		  const [error, setError] = (0, import_react3.useState)("");
		  const selected = (0, import_react3.useRef)(null);
		  const current = sessions.current, row = current ? sessions.byId[current] : void 0;
		  const ordinaryCurrent = row?.origin === "subagent" ? row.parentId : current;
		  const ids = visibleTabs(tabs);
		  const label = (id) => {
		    const s = sessions.byId[id];
		    return s?.blank ? `\u65B0\u4F1A\u8BDD${s.cwd ? " \xB7 " + s.cwd.split(/[\\/]/).filter(Boolean).pop() : ""}` : s?.title ?? tabs.titles[id] ?? s?.displayTitle ?? (sessions.phase === "pending" ? "\u52A0\u8F7D\u4F1A\u8BDD\u2026" : "\u4F1A\u8BDD\u4E0D\u53EF\u7528");
		  };
		  (0, import_react3.useEffect)(() => {
		    if (!ordinaryCurrent || !sessions.byId[ordinaryCurrent] || sessions.byId[ordinaryCurrent].origin === "subagent")
		      return;
		    setTabs(
		      (old) => old.ids.includes(ordinaryCurrent) ? old : {
		        ...old,
		        ids: [...old.ids, ordinaryCurrent],
		        closed: old.closed.filter((id) => id !== ordinaryCurrent)
		      }
		    );
		  }, [ordinaryCurrent, sessions.phase]);
		  (0, import_react3.useEffect)(() => {
		    setTabs((old) => {
		      const titles = { ...old.titles };
		      let changed = false;
		      for (const id of [...old.ids, ...old.closed])
		        if (sessions.byId[id]) {
		          const s = sessions.byId[id];
		          const title = (s.blank ? label(id) : s.title ?? titles[id] ?? s.displayTitle).slice(0, 160);
		          if (title !== titles[id]) {
		            titles[id] = title;
		            changed = true;
		          }
		        }
		      return changed ? { ...old, titles } : old;
		    });
		  }, [sessions]);
		  (0, import_react3.useEffect)(() => {
		    try {
		      localStorage.setItem(tabKey, JSON.stringify(tabs));
		    } catch {
		      setError("\u6807\u7B7E\u4ECD\u53EF\u4F7F\u7528\uFF0C\u4F46\u6D4F\u89C8\u5668\u672A\u80FD\u4FDD\u5B58\u5E03\u5C40\u3002");
		    }
		  }, [tabs]);
		  (0, import_react3.useEffect)(() => {
		    selected.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
		  }, [ordinaryCurrent, tabs.ids.length]);
		  const open = (id, focus = false) => {
		    try {
		      ctx.uiWorkspace.openSession(id);
		      setError("");
		      if (focus) requestAnimationFrame(() => selected.current?.focus());
		    } catch (e) {
		      setError(errorText(e));
		    }
		  };
		  const close = (id) => {
		    const result = closeTabState(
		      tabs,
		      id,
		      Object.keys(sessions.byId).filter((id2) => sessions.byId[id2].origin !== "subagent")
		    );
		    setTabs(result.tabs);
		    if (id === ordinaryCurrent) {
		      if (result.next) open(result.next);
		      else ctx.sessions.clear();
		    }
		  };
		  const reopen = () => {
		    const id = tabs.closed.find((id2) => sessions.byId[id2]?.origin !== "subagent" && sessions.byId[id2]);
		    if (id) open(id);
		  };
		  const cycle = (direction, focus = false) => {
		    const available = ids.filter((id) => sessions.byId[id] && sessions.byId[id].origin !== "subagent"), index = available.indexOf(ordinaryCurrent ?? "");
		    if (available.length) open(available[(index + direction + available.length) % available.length], focus);
		  };
		  (0, import_react3.useEffect)(() => {
		    const keydown = (e) => {
		      if (e.defaultPrevented || e.isComposing || !e.ctrlKey || !e.altKey || document.querySelector("[role=dialog],[role=alertdialog]"))
		        return;
		      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
		        e.preventDefault();
		        cycle(e.key === "ArrowRight" ? 1 : -1);
		      } else if (e.key.toLowerCase() === "t") {
		        e.preventDefault();
		        reopen();
		      }
		    };
		    window.addEventListener("keydown", keydown);
		    return () => window.removeEventListener("keydown", keydown);
		  }, [tabs, current, sessions]);
		  const panel = (type) => {
		    if (!current) return;
		    try {
		      if (!ctx.betterSidebar.isTabEnabled(type)) {
		        setError("\u6B64\u9762\u677F\u5DF2\u5173\u95ED\uFF0C\u53EF\u5728\u201C\u4FA7\u8FB9\u5361\u7247\u201D\u8BBE\u7F6E\u4E2D\u542F\u7528\u3002");
		        return;
		      }
		      if (type === "terminal") ctx.sidebarRight.openTabIn(current, "terminal", { revealIfOpened: true });
		      else ctx.betterSidebar.openTab({ type }, { sessionId: current, cwd: row?.cwd });
		      setError("");
		    } catch (e) {
		      setError(errorText(e));
		    }
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-ui px-bar", "aria-label": "DSH-PX \u4F1A\u8BDD\u5DE5\u4F5C\u533A", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-tabs", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { className: "px-brand", children: "DSH-PX" }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "px-tabstrip", role: "tablist", "aria-label": "\u5DF2\u6253\u5F00\u4F1A\u8BDD", children: ids.map((id) => {
		        const active = id === ordinaryCurrent;
		        return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-tab", "data-active": active, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
		            "button",
		            {
		              role: "tab",
		              ref: active ? selected : void 0,
		              tabIndex: active || !ordinaryCurrent && id === ids[0] ? 0 : -1,
		              "aria-selected": active,
		              "data-session-id": id,
		              disabled: !sessions.byId[id] || sessions.byId[id].origin === "subagent",
		              title: `${label(id)} \xB7 Ctrl+Alt+\u65B9\u5411\u952E\u5207\u6362`,
		              onClick: () => open(id),
		              onKeyDown: (e) => {
		                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
		                  e.preventDefault();
		                  cycle(e.key === "ArrowRight" ? 1 : -1, true);
		                } else if (e.key === "Home" || e.key === "End") {
		                  e.preventDefault();
		                  const available = ids.filter((id2) => sessions.byId[id2]);
		                  const next = e.key === "Home" ? available[0] : available[available.length - 1];
		                  if (next) open(next, true);
		                }
		              },
		              children: [
		                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		                  "span",
		                  {
		                    className: `px-session-dot${sessions.byId[id]?.running ? " is-running" : sessions.byId[id]?.completed ? " is-done" : ""}`,
		                    "aria-hidden": "true"
		                  }
		                ),
		                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "px-tab-title", children: label(id) })
		              ]
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		            "button",
		            {
		              className: "px-tab-action",
		              title: tabs.pins.includes(id) ? "\u53D6\u6D88\u56FA\u5B9A" : "\u56FA\u5B9A\u6807\u7B7E",
		              "aria-label": `${tabs.pins.includes(id) ? "\u53D6\u6D88\u56FA\u5B9A" : "\u56FA\u5B9A"} ${label(id)}`,
		              "aria-pressed": tabs.pins.includes(id),
		              onClick: () => setTabs((old) => ({
		                ...old,
		                pins: old.pins.includes(id) ? old.pins.filter((x) => x !== id) : [...old.pins, id]
		              })),
		              children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "pin" })
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		            "button",
		            {
		              className: "px-tab-action",
		              title: "\u5173\u95ED\u6807\u7B7E\uFF08\u4EFB\u52A1\u7EE7\u7EED\u8FD0\u884C\uFF09",
		              "aria-label": `\u5173\u95ED\u6807\u7B7E ${label(id)}`,
		              onClick: () => close(id),
		              children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "close" })
		            }
		          )
		        ] }, id);
		      }) }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { onClick: () => ctx.uiWorkspace.startSession(), title: "\u5728\u5F53\u524D\u5DE5\u4F5C\u533A\u65B0\u5EFA\u4F1A\u8BDD", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "plus" }),
		        "\u65B0\u4F1A\u8BDD"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { "aria-label": "\u6253\u5F00\u5DF2\u6709\u4F1A\u8BDD", value: "", onChange: (e) => open(e.target.value), children: [
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u6253\u5F00\u4F1A\u8BDD\u2026" }),
		        sessions.ids.filter((id) => sessions.byId[id]?.origin !== "subagent").map((id) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: id, children: label(id) }, id))
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		        "button",
		        {
		          className: "px-restore",
		          "aria-label": "\u6062\u590D\u6700\u8FD1\u5173\u95ED\u7684\u4F1A\u8BDD",
		          disabled: !tabs.closed.some((id) => sessions.byId[id]),
		          onClick: reopen,
		          title: "\u6062\u590D\u6700\u8FD1\u5173\u95ED \xB7 Ctrl+Alt+T",
		          children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "restore" })
		        }
		      )
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-tools", children: [
		      panels.map(([type, text, icon]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
		        "button",
		        {
		          disabled: !current || !ctx.betterSidebar.isTabEnabled(type),
		          title: ctx.betterSidebar.isTabEnabled(type) ? text : `${text}\u5DF2\u5728\u4FA7\u8FB9\u5361\u7247\u8BBE\u7F6E\u4E2D\u5173\u95ED`,
		          onClick: () => panel(type),
		          children: [
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: icon }),
		            text
		          ]
		        },
		        type
		      )),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "px-status", children: current ? row?.origin === "subagent" ? "\u6B63\u5728\u67E5\u770B\u5B50 Agent \xB7 \u8FD4\u56DE\u4E0A\u7EA7\u53EF\u7EE7\u7EED\u4EFB\u52A1" : row?.running ? "Agent \u6267\u884C\u4E2D" : "\u5C31\u7EEA" : "\u9009\u62E9\u6216\u65B0\u5EFA\u4F1A\u8BDD\u5F00\u59CB" })
		    ] }),
		    error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-bar-error", role: "alert", children: [
		      error,
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { "aria-label": "\u5173\u95ED\u63D0\u793A", onClick: () => setError(""), children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "close" }) })
		    ] }) : null
		  ] });
		}

		// packages/dsh-px-workspace/src/client/artifacts.tsx
		var import_jsx_runtime3 = require("react/jsx-runtime");
		function ArtifactsPanel({ ctx, scope, visible }) {
		  const { data, error, refresh, loading } = useData(
		    `${base}/content?sessionId=${encodeURIComponent(scope.sessionId)}`,
		    visible
		  );
		  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-ui px-panel", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: "\u4F1A\u8BDD\u4EA7\u7269" }),
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "px-muted", children: "\u6C47\u603B Agent \u4F7F\u7528 present \u58F0\u660E\u7684\u4EA4\u4ED8\u3002\u6253\u5F00\u7684\u662F\u6587\u4EF6\u5F53\u524D\u5185\u5BB9\uFF1B\u539F\u6587\u4EF6\u79FB\u52A8\u6216\u5220\u9664\u540E\u9700\u8981\u91CD\u65B0\u5B9A\u4F4D\u3002" }),
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { disabled: loading, onClick: refresh, children: "\u5237\u65B0\u4EA7\u7269" }),
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "px-load-status", role: "status", children: loading ? "\u6B63\u5728\u8BFB\u53D6\u4EA7\u7269\u2026" : "" }),
		    error ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "alert", children: error }) : null,
		    !data && !error ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u2026" }) : null,
		    data?.artifacts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "px-empty", children: "\u6B64\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u4EA4\u4ED8\u6587\u4EF6\u3002\u53EF\u4EE5\u8BA9 Agent \u5B8C\u6210\u4EFB\u52A1\u540E\u5C55\u793A\u4EA7\u7269\u3002" }) : null,
		    data?.artifacts.map((a) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("article", { className: "px-card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: a.path.split(/[\\/]/).pop() }),
		      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: a.description || "\u672A\u586B\u5199\u8BF4\u660E" }),
		      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "px-muted", children: [
		        a.path,
		        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("br", {}),
		        stamp(a.time)
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { onClick: () => ctx.betterSidebar.openFile(scope, a.path), children: "\u6253\u5F00\u4EA7\u7269" })
		    ] }, a.path))
		  ] });
		}

		// packages/dsh-px-workspace/src/client/notes.tsx
		var import_react5 = require("react");

		// packages/dsh-px-workspace/src/model.ts
		function quoteDraft(a) {
		  return `\u5F15\u7528\u5386\u53F2\u5185\u5BB9\uFF08\u6765\u6E90 ${a.sessionId}\uFF0C\u8BB0\u5F55 ${a.seq}\uFF1B\u4EE5\u4E0B\u662F\u80CC\u666F\u8D44\u6599\uFF09\uFF1A
		${a.quote.split("\n").map((line) => "> " + line).join("\n")}

		${a.note ? "\u6211\u7684\u6279\u6CE8\uFF1A" + a.note + "\n" : ""}`;
		}

		// packages/dsh-px-workspace/src/client-input.ts
		function insertQuote(ctx, target, note) {
		  const actx = ctx.sessions.scope(target);
		  if (!actx) throw new Error("\u8BF7\u5148\u6253\u5F00\u76EE\u6807\u4F1A\u8BDD");
		  const input = ctx.conversation.input.for(actx), state = input.state.getSnapshot();
		  if (state.phase !== "plain") throw new Error("\u8F93\u5165\u6846\u6B63\u5728\u63D0\u4EA4\u6216\u5904\u4E8E\u547D\u4EE4\u6A21\u5F0F\uFF0C\u8BF7\u7A0D\u540E\u5F15\u7528");
		  const accepted = actx.bail(actx, "slash/input-insert-text", {
		    text: (state.draft ? "\n\n" : "") + quoteDraft(note),
		    span: { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev }
		  });
		  if (accepted !== true) throw new Error("\u8F93\u5165\u6846\u5C1A\u672A\u5C31\u7EEA\u6216\u8349\u7A3F\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5");
		  input.notify("info", "\u5F15\u7528\u5DF2\u52A0\u5165\u8349\u7A3F\uFF0C\u8BF7\u68C0\u67E5\u540E\u53D1\u9001\u3002");
		}

		// packages/dsh-px-workspace/src/client/drafts.ts
		var import_react4 = require("react");

		// packages/shared/draft-store.ts
		function createDraftCell(key, initial, storage) {
		  let value = initial;
		  let persisted = Boolean(storage);
		  try {
		    const raw = storage?.getItem(key);
		    if (raw && raw.length <= 15e4) {
		      const parsed = JSON.parse(raw);
		      if (parsed?.version === 1 && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)) {
		        const restored = { ...initial };
		        for (const [name, seed] of Object.entries(initial)) {
		          const candidate = parsed.value[name];
		          if (typeof seed === "string" && typeof candidate === "string" || typeof seed === "boolean" && typeof candidate === "boolean" || typeof seed === "number" && typeof candidate === "number" && Number.isFinite(candidate) || seed === null && (candidate === null || candidate && typeof candidate === "object" && !Array.isArray(candidate)))
		            restored[name] = candidate;
		        }
		        value = restored;
		      }
		    }
		  } catch {
		  }
		  const listeners = /* @__PURE__ */ new Set();
		  return {
		    getSnapshot: () => value,
		    isPersisted: () => persisted,
		    subscribe: (cb) => {
		      listeners.add(cb);
		      return () => {
		        listeners.delete(cb);
		      };
		    },
		    set: (next) => {
		      value = typeof next === "function" ? next(value) : next;
		      persisted = Boolean(storage);
		      try {
		        const raw = JSON.stringify({ version: 1, value });
		        if (raw.length > 15e4) throw new Error("draft too large");
		        storage?.setItem(key, raw);
		      } catch {
		        persisted = false;
		      }
		      for (const cb of listeners) cb();
		      return persisted;
		    }
		  };
		}

		// packages/dsh-px-workspace/src/client/drafts.ts
		var cells = /* @__PURE__ */ new Map();
		function useDraft(key, initial) {
		  const [cell] = (0, import_react4.useState)(() => {
		    let cell2 = cells.get(key);
		    if (!cell2) {
		      let storage;
		      try {
		        storage = sessionStorage;
		      } catch {
		      }
		      cell2 = createDraftCell("dsh-px.draft.v1." + key, initial(), storage);
		      cells.set(key, cell2);
		    }
		    return cell2;
		  });
		  const value = useSnapshot(cell);
		  return [
		    value,
		    (next) => {
		      cell.set(next);
		    },
		    cell.isPersisted() ? "" : "\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\uFF0C\u672C\u6B21\u9875\u9762\u5185\u4ECD\u4FDD\u7559\u8349\u7A3F\uFF1B\u5237\u65B0\u524D\u8BF7\u4FDD\u5B58\u3002"
		  ];
		}

		// packages/dsh-px-workspace/src/client/notes.tsx
		var import_jsx_runtime4 = require("react/jsx-runtime");
		function NotesPanel({ ctx, scope, visible, tab }) {
		  const selection = useSnapshot(quoteRequests)[scope.sessionId];
		  const [before, setBefore] = (0, import_react5.useState)(null);
		  const { data, error, refresh } = useData(
		    `${base}/content?sessionId=${encodeURIComponent(scope.sessionId)}${before === null ? "" : "&before=" + before}`,
		    visible
		  );
		  const [noteBefore, setNoteBefore] = (0, import_react5.useState)(null);
		  const notes = useData(
		    `${base}/annotations?sessionId=${encodeURIComponent(scope.sessionId)}${noteBefore ? "&before=" + encodeURIComponent(noteBefore) : ""}`,
		    visible
		  );
		  const [editor, setEditor, draftWarning] = useDraft(`notes:${scope.sessionId}`, () => ({
		    source: null,
		    quote: "",
		    note: "",
		    editing: null,
		    initialized: false,
		    collapsed: false
		  }));
		  const { source, quote, note, editing } = editor;
		  const setQuote = (quote2) => setEditor((old) => ({ ...old, quote: quote2 }));
		  const setNote = (note2) => setEditor((old) => ({ ...old, note: note2 }));
		  const setEditing = (editing2) => setEditor((old) => ({ ...old, editing: editing2 }));
		  const setSource = (source2) => setEditor((old) => ({ ...old, source: source2, initialized: true }));
		  const [notice, setNotice] = (0, import_react5.useState)(""), [failure, setFailure] = (0, import_react5.useState)(""), [localBusy, setBusy] = (0, import_react5.useState)(false);
		  const [operationBusy, runOperation] = useOperation(`notes:${scope.sessionId}`);
		  const busy = localBusy || operationBusy;
		  const revision = (0, import_react5.useRef)(0);
		  const active = (0, import_react5.useRef)(true), sourceRequest = (0, import_react5.useRef)(null);
		  (0, import_react5.useEffect)(() => {
		    active.current = true;
		    return () => {
		      active.current = false;
		      sourceRequest.current?.abort();
		    };
		  }, []);
		  async function choose(id, existing = null, offset = 0) {
		    if (operationBusy) return;
		    const rev = ++revision.current;
		    sourceRequest.current?.abort();
		    const controller = new AbortController();
		    sourceRequest.current = controller;
		    setBusy(true);
		    setFailure("");
		    setNotice("");
		    try {
		      const value = await requestJson(
		        `${base}/message?sessionId=${encodeURIComponent(scope.sessionId)}&messageId=${encodeURIComponent(id)}&offset=${offset}`,
		        { signal: controller.signal }
		      );
		      if (rev !== revision.current || !active.current) return;
		      setEditor({
		        source: value,
		        editing: existing,
		        quote: existing?.quote ?? value.text.slice(0, 8e3),
		        note: existing?.note ?? "",
		        initialized: true,
		        collapsed: false,
		        requestToken: selection?.token
		      });
		    } catch (e) {
		      if (active.current && rev === revision.current && !controller.signal.aborted) setFailure(errorText(e));
		    } finally {
		      if (active.current && rev === revision.current) setBusy(false);
		    }
		  }
		  (0, import_react5.useEffect)(() => {
		    if (selection && selection.token !== editor.requestToken) void choose(selection.messageId);
		    else if (!editor.initialized && tab.meta?.messageId) void choose(tab.meta.messageId);
		  }, [selection, tab.meta?.messageId, operationBusy]);
		  const draft = source ? { sessionId: scope.sessionId, messageId: source.id, seq: source.seq, quote, note } : null;
		  const validQuote = !!quote && (!!source?.text.includes(quote) || editing?.quote === quote);
		  async function action(fn, success) {
		    setBusy(true);
		    setFailure("");
		    setNotice("");
		    try {
		      await runOperation(fn);
		      setNoteBefore(null);
		      notes.refresh();
		      setNotice(success);
		    } catch (e) {
		      setFailure(errorText(e));
		    } finally {
		      setBusy(false);
		    }
		  }
		  function insert(a) {
		    try {
		      insertQuote(ctx, scope.sessionId, a);
		      setFailure("");
		      setNotice("\u5DF2\u52A0\u5165\u8349\u7A3F\uFF0C\u68C0\u67E5\u540E\u53D1\u9001\u3002");
		    } catch (e) {
		      setFailure(errorText(e));
		    }
		  }
		  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-ui px-panel", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: "\u5F15\u7528\u4E0E\u6279\u6CE8" }),
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u9009\u62E9\u539F\u6587\u5E76\u6DFB\u52A0\u6279\u6CE8\u3002\u5207\u6362\u9762\u677F\u4F1A\u4FDD\u7559\u8349\u7A3F\uFF1B\u70B9\u51FB\u5F15\u7528\u624D\u4F1A\u52A0\u5165\u4F1A\u8BDD\u8F93\u5165\u6846\u3002" }),
		    draftWarning ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: draftWarning }) : null,
		    source && editor.collapsed ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => setEditor((old) => ({ ...old, collapsed: false })), children: "\u7EE7\u7EED\u7F16\u8F91\u8349\u7A3F" }) : null,
		    failure || error || notes.error ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: failure || error || notes.error }) : null,
		    notice ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", className: "px-feedback", children: notice }) : null,
		    source && !editor.collapsed ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("section", { className: "px-card", "aria-label": "\u6279\u6CE8\u7F16\u8F91\u5668", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("fieldset", { disabled: busy, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("h4", { children: [
		        source.role === "user" ? "\u7528\u6237" : "\u52A9\u624B",
		        " \xB7 \u8BB0\u5F55 ",
		        source.seq
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
		        "\u6D88\u606F\u539F\u6587\uFF08\u53EF\u9009\u4E2D\u4E00\u6BB5\u4F5C\u4E3A\u5F15\u7528\uFF09",
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		          "textarea",
		          {
		            "aria-label": "\u6D88\u606F\u539F\u6587",
		            readOnly: true,
		            rows: 5,
		            value: source.text,
		            onSelect: (e) => {
		              const el = e.currentTarget;
		              if (el.selectionEnd > el.selectionStart)
		                setQuote(source.text.slice(el.selectionStart, el.selectionEnd).slice(0, 8e3));
		            }
		          }
		        )
		      ] }),
		      source.length > source.text.length ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "px-muted", children: [
		        "\u663E\u793A ",
		        source.offset + 1,
		        "\u2013",
		        source.offset + source.text.length,
		        " / ",
		        source.length,
		        " \u5B57\u7B26\u3002",
		        source.nextOffset !== null ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy, onClick: () => void choose(source.id, null, source.nextOffset), children: "\u540E\u7EED\u6B63\u6587" }) : null,
		        source.offset > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => void choose(source.id), children: "\u8FD4\u56DE\u5F00\u5934" }) : null
		      ] }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
		        "\u5F15\u7528\u7247\u6BB5 \xB7 ",
		        quote.length,
		        " \u5B57\u7B26\uFF08\u6700\u591A 8000\uFF09",
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		          "textarea",
		          {
		            "aria-label": "\u5F15\u7528\u7247\u6BB5",
		            rows: 3,
		            maxLength: 8e3,
		            value: quote,
		            onInput: (e) => setQuote(e.currentTarget.value),
		            onChange: (e) => setQuote(e.target.value)
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u53EF\u9009\u4E2D\u4E0A\u65B9\u539F\u6587\uFF0C\u4E5F\u53EF\u5728\u8FD9\u91CC\u5220\u53BB\u4E0D\u9700\u8981\u7684\u90E8\u5206\uFF1B\u987B\u4FDD\u7559\u8FDE\u7EED\u7684\u539F\u6587\u3002" }),
		      quote && !validQuote ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: "\u6B64\u7247\u6BB5\u4E0D\u5728\u5F53\u524D\u539F\u6587\u4E2D\uFF0C\u8BF7\u6062\u590D\u539F\u6587\uFF1B\u8865\u5145\u610F\u89C1\u8BF7\u5199\u5728\u6279\u6CE8\u91CC\u3002" }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
		        "\u6211\u7684\u6279\u6CE8",
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		          "textarea",
		          {
		            "aria-label": "\u6211\u7684\u6279\u6CE8",
		            maxLength: 4e3,
		            value: note,
		            onChange: (e) => setNote(e.target.value),
		            placeholder: "\u9700\u8981\u4FEE\u6539\u7684\u5730\u65B9\u3001\u8865\u5145\u8981\u6C42\u6216\u5F85\u6838\u5BF9\u7684\u95EE\u9898\u2026"
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		          "button",
		          {
		            className: "px-primary",
		            disabled: busy || !validQuote,
		            onClick: () => void action(async () => {
		              const saved = await post("annotations", {
		                action: "save",
		                ...draft,
		                ...editing ? { id: editing.id, updatedAt: editing.updatedAt } : {}
		              });
		              setEditing(saved);
		            }, "\u6279\u6CE8\u5DF2\u4FDD\u5B58"),
		            children: editing ? "\u66F4\u65B0\u6279\u6CE8" : "\u4FDD\u5B58\u6279\u6CE8"
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy || !validQuote, onClick: () => draft && insert(draft), children: "\u5F15\u7528\u5230\u8F93\u5165\u6846" }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy, onClick: () => setEditor((old) => ({ ...old, collapsed: true })), children: "\u6536\u8D77\u7F16\u8F91\u5668" })
		      ] })
		    ] }) }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("h4", { children: [
		      "\u5DF2\u4FDD\u5B58 \xB7 ",
		      notes.data?.total ?? 0
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
		      noteBefore ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => setNoteBefore(null), children: "\u6700\u65B0\u6279\u6CE8" }) : null,
		      notes.data?.nextBefore ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => setNoteBefore(notes.data.nextBefore), children: "\u66F4\u65E9\u6279\u6CE8" }) : null
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "px-load-status", role: "status", children: notes.loading ? "\u6B63\u5728\u8BFB\u53D6\u6279\u6CE8\u2026" : "" }),
		    notes.data?.annotations.map((a) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("article", { className: "px-card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("small", { className: "px-muted", children: [
		        "\u8BB0\u5F55 ",
		        a.seq,
		        " \xB7 ",
		        stamp(a.updatedAt)
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("blockquote", { children: a.quote }),
		      a.note ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: a.note }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy, onClick: () => insert(a), children: "\u5F15\u7528\u5230\u8F93\u5165\u6846" }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy, onClick: () => void choose(a.messageId, a), children: "\u67E5\u770B\u539F\u6587 / \u7F16\u8F91" }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		          ConfirmDelete,
		          {
		            label: "\u5220\u9664\u6279\u6CE8",
		            disabled: busy,
		            onConfirm: () => action(async () => {
		              await post("annotations", { action: "delete", id: a.id, updatedAt: a.updatedAt });
		              if (editing?.id === a.id) {
		                setEditing(null);
		                setSource(null);
		              }
		            }, "\u6279\u6CE8\u5DF2\u5220\u9664")
		          }
		        )
		      ] })
		    ] }, a.id)),
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "\u4F1A\u8BDD\u6B63\u6587" }),
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		        "button",
		        {
		          onClick: () => {
		            setBefore(null);
		            refresh();
		          },
		          children: "\u6700\u65B0\u6B63\u6587"
		        }
		      ),
		      data?.nextBefore !== null && data?.nextBefore !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => setBefore(data.nextBefore), children: "\u66F4\u65E9\u6B63\u6587" }) : null
		    ] }),
		    data?.messages.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u8FD8\u6CA1\u6709\u53EF\u5F15\u7528\u7684\u6B63\u6587\u3002" }) : null,
		    data?.messages.map((m) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("article", { className: "px-card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("small", { children: [
		        m.role === "user" ? "\u7528\u6237" : "\u52A9\u624B",
		        " \xB7 ",
		        stamp(m.time)
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: m.text }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy, onClick: () => void choose(m.id), children: "\u5F15\u7528 / \u6279\u6CE8\u6B64\u6D88\u606F" })
		    ] }, m.id))
		  ] });
		}

		// packages/dsh-px-workspace/src/client/schedules.tsx
		var import_react6 = require("react");
		var import_jsx_runtime5 = require("react/jsx-runtime");
		function localTime(time) {
		  const d = new Date(time);
		  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
		}
		function SchedulesPanel({ ctx, scope, visible }) {
		  const sessions = useSnapshot(ctx.sessions.list), { data, error, refresh } = useData(
		    `${base}/schedules`,
		    visible
		  );
		  const [draft, setDraft, draftWarning] = useDraft(`schedules:${scope.sessionId}`, () => ({
		    editing: null,
		    form: false,
		    title: "",
		    prompt: "",
		    sessionId: scope.sessionId,
		    kind: "once",
		    at: localTime(Date.now() + 3e5),
		    minutes: "60",
		    daily: "09:00",
		    enabled: true
		  }));
		  const { editing, form, title, prompt, sessionId, kind, at, minutes, daily, enabled } = draft;
		  const setEditing = (editing2) => setDraft((old) => ({ ...old, editing: editing2 }));
		  const setForm = (form2) => setDraft((old) => ({ ...old, form: form2 }));
		  const setTitle = (title2) => setDraft((old) => ({ ...old, title: title2 }));
		  const setPrompt = (prompt2) => setDraft((old) => ({ ...old, prompt: prompt2 }));
		  const setSessionId = (sessionId2) => setDraft((old) => ({ ...old, sessionId: sessionId2 }));
		  const setKind = (kind2) => setDraft((old) => ({ ...old, kind: kind2 }));
		  const setAt = (at2) => setDraft((old) => ({ ...old, at: at2 }));
		  const setMinutes = (minutes2) => setDraft((old) => ({ ...old, minutes: minutes2 }));
		  const setDaily = (daily2) => setDraft((old) => ({ ...old, daily: daily2 }));
		  const setEnabled = (enabled2) => setDraft((old) => ({ ...old, enabled: enabled2 }));
		  const [localBusy, setBusy] = (0, import_react6.useState)(false), [failure, setFailure] = (0, import_react6.useState)(""), [notice, setNotice] = (0, import_react6.useState)("");
		  const begin = (s) => {
		    setEditing(s);
		    setTitle(s?.title ?? "");
		    setPrompt(s?.prompt ?? "");
		    setSessionId(s?.sessionId ?? scope.sessionId);
		    setKind(s?.timing.kind ?? "once");
		    setEnabled(s?.enabled ?? true);
		    setAt(localTime(s?.timing.kind === "once" ? s.timing.at : Date.now() + 3e5));
		    setMinutes(String(s?.timing.kind === "interval" ? s.timing.minutes : 60));
		    setDaily(s?.timing.kind === "daily" ? s.timing.time : "09:00");
		    setForm(true);
		    setFailure("");
		    setNotice("");
		  };
		  const [operationBusy, runOperation] = useOperation(`schedules:${scope.sessionId}`);
		  const busy = localBusy || operationBusy;
		  async function action(fn, success) {
		    setBusy(true);
		    setFailure("");
		    setNotice("");
		    try {
		      await runOperation(fn);
		      refresh();
		      setNotice(success);
		    } catch (e) {
		      setFailure(errorText(e));
		    } finally {
		      setBusy(false);
		    }
		  }
		  const rule = () => kind === "once" ? { kind, at: new Date(at).getTime() } : kind === "interval" ? { kind, minutes: Number(minutes) } : { kind, time: daily };
		  const timingText = (t) => t.kind === "once" ? "\u4E00\u6B21 \xB7 " + stamp(t.at) : t.kind === "interval" ? `\u6BCF ${t.minutes} \u5206\u949F` : `\u6BCF\u5929 ${t.time}`;
		  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "px-ui px-panel", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { children: "\u5B9A\u65F6\u4EFB\u52A1" }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { className: "px-muted", children: [
		      "\u5E94\u7528\u8FD0\u884C\u65F6\u5411\u6307\u5B9A\u4F1A\u8BDD\u6295\u9012\uFF0C\u6CBF\u7528\u8BE5\u4F1A\u8BDD\u7684\u6A21\u578B\u4E0E\u6743\u9650\u3002\u5FD9\u788C\u65F6\u8FDB\u5165\u961F\u5217\uFF1B\u9000\u51FA\u671F\u95F4\u4E0D\u6267\u884C\uFF0C\u6062\u590D\u540E\u91CD\u590D\u4EFB\u52A1\u53EA\u8865\u6700\u65B0\u4E00\u6B21\u3002\u65F6\u533A\uFF1A",
		      data?.timeZone ?? "\u8BFB\u53D6\u4E2D",
		      "\u3002"
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "px-actions", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { className: "px-primary", disabled: busy, onClick: () => begin(null), children: "\u65B0\u5EFA\u5B9A\u65F6\u4EFB\u52A1" }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { onClick: refresh, children: "\u5237\u65B0\u4EFB\u52A1" })
		    ] }),
		    draftWarning ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "alert", children: draftWarning }) : null,
		    failure || error ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "alert", children: failure || error }) : null,
		    notice ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "status", className: "px-feedback", children: notice }) : null,
		    form ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("section", { className: "px-card", "aria-label": "\u5B9A\u65F6\u4EFB\u52A1\u7F16\u8F91\u5668", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("fieldset", { disabled: busy, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h4", { children: editing ? "\u7F16\u8F91\u4EFB\u52A1" : "\u65B0\u5EFA\u4EFB\u52A1" }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
		        "\u4EFB\u52A1\u540D\u79F0",
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		          "input",
		          {
		            "aria-label": "\u4EFB\u52A1\u540D\u79F0",
		            maxLength: 100,
		            value: title,
		            onChange: (e) => setTitle(e.target.value)
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
		        "\u76EE\u6807\u4F1A\u8BDD",
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
		          "select",
		          {
		            "aria-label": "\u76EE\u6807\u4F1A\u8BDD",
		            value: sessionId,
		            onChange: (e) => setSessionId(e.target.value),
		            children: [
		              !sessions.byId[sessionId] ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("option", { value: sessionId, children: [
		                sessionId,
		                "\uFF08\u6682\u4E0D\u53EF\u7528\uFF09"
		              ] }) : null,
		              sessions.ids.filter((id) => sessions.byId[id]?.origin !== "subagent").map((id) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: id, children: sessions.byId[id].displayTitle }, id))
		            ]
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
		        "\u6267\u884C\u8981\u6C42",
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		          "textarea",
		          {
		            "aria-label": "\u6267\u884C\u8981\u6C42",
		            rows: 4,
		            maxLength: 4e3,
		            value: prompt,
		            onChange: (e) => setPrompt(e.target.value),
		            placeholder: "\u4F8B\u5982\uFF1A\u68C0\u67E5\u9879\u76EE\u6D4B\u8BD5\uFF0C\u6C47\u62A5\u65B0\u589E\u5931\u8D25\u548C\u5BF9\u5E94\u6587\u4EF6\u3002"
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
		        "\u89E6\u53D1\u65B9\u5F0F",
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("select", { "aria-label": "\u89E6\u53D1\u65B9\u5F0F", value: kind, onChange: (e) => setKind(e.target.value), children: [
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "once", children: "\u6307\u5B9A\u65F6\u95F4\u6267\u884C\u4E00\u6B21" }),
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "interval", children: "\u56FA\u5B9A\u95F4\u9694" }),
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "daily", children: "\u6BCF\u5929" })
		        ] })
		      ] }),
		      kind === "once" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
		        "\u672C\u673A\u65F6\u95F4",
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		          "input",
		          {
		            "aria-label": "\u672C\u673A\u65F6\u95F4",
		            type: "datetime-local",
		            value: at,
		            onInput: (e) => setAt(e.currentTarget.value),
		            onChange: (e) => setAt(e.target.value)
		          }
		        )
		      ] }) : kind === "interval" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
		        "\u95F4\u9694\uFF08\u5206\u949F\uFF09",
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		          "input",
		          {
		            "aria-label": "\u95F4\u9694\u5206\u949F",
		            type: "number",
		            min: 1,
		            max: 525600,
		            value: minutes,
		            onInput: (e) => setMinutes(e.currentTarget.value),
		            onChange: (e) => setMinutes(e.target.value)
		          }
		        )
		      ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
		        "\u6BCF\u65E5\u65F6\u95F4",
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		          "input",
		          {
		            "aria-label": "\u6BCF\u65E5\u65F6\u95F4",
		            type: "time",
		            value: daily,
		            onInput: (e) => setDaily(e.currentTarget.value),
		            onChange: (e) => setDaily(e.target.value)
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "px-check", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { type: "checkbox", checked: enabled, onChange: (e) => setEnabled(e.target.checked) }),
		        "\u542F\u7528\u6B64\u4EFB\u52A1"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "px-actions", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		          "button",
		          {
		            className: "px-primary",
		            disabled: busy || !title.trim() || !prompt.trim(),
		            onClick: () => void action(async () => {
		              await post("schedules", {
		                action: "save",
		                ...editing ? { id: editing.id, updatedAt: editing.updatedAt } : {},
		                title,
		                prompt,
		                sessionId,
		                timing: rule(),
		                enabled
		              });
		              setForm(false);
		            }, "\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u4FDD\u5B58"),
		            children: "\u4FDD\u5B58\u5B9A\u65F6\u4EFB\u52A1"
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => setForm(false), children: "\u53D6\u6D88\u7F16\u8F91" })
		      ] })
		    ] }) }) : null,
		    data?.schedules.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: "\u5C1A\u672A\u914D\u7F6E\u5B9A\u65F6\u4EFB\u52A1\u3002" }) : null,
		    data?.schedules.map((s) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("article", { className: "px-card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("h4", { children: [
		        s.title,
		        " \xB7 ",
		        s.enabled ? "\u5DF2\u542F\u7528" : "\u5DF2\u6682\u505C"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: s.prompt }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { className: "px-muted", children: [
		        "\u4F1A\u8BDD\uFF1A",
		        sessions.byId[s.sessionId]?.displayTitle ?? s.sessionId,
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("br", {}),
		        timingText(s.timing),
		        " \xB7 ",
		        s.timeZone,
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("br", {}),
		        "\u4E0B\u6B21\uFF1A",
		        stamp(s.nextAt)
		      ] }),
		      s.history[0]?.status === "uncertain" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { role: "alert", children: [
		        s.history[0].detail,
		        " \u68C0\u67E5\u4F1A\u8BDD\u540E\u518D\u624B\u52A8\u6295\u9012\u6216\u542F\u7528\u3002"
		      ] }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "px-actions", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { onClick: () => ctx.uiWorkspace.openSession(s.sessionId), children: "\u6253\u5F00\u4F1A\u8BDD" }),
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => begin(s), children: "\u7F16\u8F91\u4EFB\u52A1" }),
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		          "button",
		          {
		            disabled: busy,
		            onClick: () => void action(
		              () => post("schedules", { ...s, action: "save", enabled: !s.enabled }),
		              s.enabled ? "\u4EFB\u52A1\u5DF2\u6682\u505C" : "\u4EFB\u52A1\u5DF2\u542F\u7528"
		            ),
		            children: s.enabled ? "\u6682\u505C\u4EFB\u52A1" : "\u542F\u7528\u4EFB\u52A1"
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		          "button",
		          {
		            disabled: busy,
		            onClick: () => void action(async () => {
		              const result = await post("schedules", { action: "run", id: s.id });
		              if (result.history[0]?.status !== "queued")
		                throw new Error(result.history[0]?.detail ?? "\u6295\u9012\u5C1A\u672A\u786E\u8BA4");
		            }, "\u5DF2\u6295\u9012\u5230\u76EE\u6807\u4F1A\u8BDD\uFF1B\u8FD9\u4E0D\u4EE3\u8868 Agent \u5DF2\u5B8C\u6210\u3002"),
		            children: "\u7ACB\u5373\u6295\u9012\u4E00\u6B21"
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		          ConfirmDelete,
		          {
		            label: "\u5220\u9664\u4EFB\u52A1",
		            disabled: busy,
		            onConfirm: () => action(
		              () => post("schedules", { action: "delete", id: s.id, updatedAt: s.updatedAt }),
		              "\u4EFB\u52A1\u5DF2\u5220\u9664\uFF1B\u5DF2\u6295\u9012\u7684\u4F1A\u8BDD\u6D88\u606F\u4F1A\u4FDD\u7559\u3002"
		            )
		          }
		        )
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("details", { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("summary", { children: [
		          "\u6700\u8FD1\u6295\u9012 \xB7 ",
		          s.history.length,
		          " \u6B21"
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "px-muted", children: "\u201C\u5DF2\u6295\u9012\u201D\u8868\u793A\u4F1A\u8BDD\u63A5\u6536\u3002\u6267\u884C\u8FDB\u5C55\u548C\u6700\u7EC8\u7ED3\u679C\u8BF7\u6253\u5F00\u76EE\u6807\u4F1A\u8BDD\u67E5\u770B\u3002" }),
		        s.history.map((h) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { children: [
		          stamp(h.time),
		          " \xB7",
		          " ",
		          h.status === "queued" ? "\u5DF2\u6295\u9012" : h.status === "dispatching" ? "\u6295\u9012\u4E2D" : "\u672A\u786E\u8BA4 / \u5DF2\u6682\u505C",
		          h.detail ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("small", { children: [
		            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("br", {}),
		            h.detail
		          ] }) : null
		        ] }, h.requestId))
		      ] })
		    ] }, s.id))
		  ] });
		}

		// packages/dsh-px-workspace/src/client.tsx
		var import_jsx_runtime6 = require("react/jsx-runtime");
		var inject = ["slots", "sessions", "uiWorkspace", "conversation", "betterSidebar", "sidebarRight"];
		function apply(ctx) {
		  installUiStyles(ctx);
		  ctx.effect(() => {
		    const style = document.createElement("style");
		    style.textContent = css;
		    document.head.appendChild(style);
		    document.body.setAttribute("data-dsh-px-workspace", "");
		    return () => {
		      style.remove();
		      document.body.removeAttribute("data-dsh-px-workspace");
		    };
		  }, "workspace: layout");
		  ctx.slots.inject(
		    "shell.overlay",
		    () => ctx.slots.register(
		      { name: "shell.overlay", id: "dsh-px-workspace", order: 0, registrant: "dsh-px-workspace" },
		      () => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(SessionBar, { ctx })
		    )
		  );
		  ctx.slots.inject(
		    "conversation.chat.assistant-actions",
		    () => ctx.slots.register(
		      {
		        name: "conversation.chat.assistant-actions",
		        id: "dsh-px-quote",
		        order: 95,
		        registrant: "dsh-px-workspace"
		      },
		      (p) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "px-ui", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
		        "button",
		        {
		          className: "px-quote-action",
		          title: "\u5F15\u7528\u6216\u6279\u6CE8\u8FD9\u6761\u6D88\u606F",
		          onClick: () => {
		            requestQuote(p.sessionId, p.messageId);
		            ctx.betterSidebar.openTab(
		              { type: "px-notes", meta: { messageId: p.messageId } },
		              { sessionId: p.sessionId }
		            );
		          },
		          children: [
		            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "note" }),
		            "\u5F15\u7528 / \u6279\u6CE8"
		          ]
		        }
		      ) })
		    )
		  );
		  for (const [id, title, component, icon] of [
		    ["px-artifacts", "\u4EA7\u7269", ArtifactsPanel, "artifact"],
		    ["px-notes", "\u5F15\u7528\u4E0E\u6279\u6CE8", NotesPanel, "note"],
		    ["px-schedules", "\u5B9A\u65F6\u4EFB\u52A1", SchedulesPanel, "schedule"]
		  ])
		    ctx.effect(
		      () => ctx.betterSidebar.registerTab({
		        id,
		        title,
		        order: 16,
		        single: true,
		        icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: icon }),
		        component: (p) => {
		          const Component = component;
		          return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Component, { ...p, ctx }, p.scope.sessionId);
		        }
		      }),
		      `workspace: ${id}`
		    );
		}

		return module.exports;
	}
});
