window.__ModuleLoader__.load({
	id: "dsh-px-annotations",
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

// packages/dsh-px-annotations/src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// packages/shared/native-navigation.ts
function nativeFileAddress(sessionId, path) {
  if (!sessionId || !path || /[\r\n\0]/.test(path)) throw new Error("\u6587\u4EF6\u5730\u5740\u65E0\u6548");
  const encode = (segment) => encodeURIComponent(segment).replace(/%3A/gi, ":");
  return `dsh-resource://file/session/${encode(sessionId)}/${path.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "").split("/").map(encode).join("/")}`;
}
function selectedSession(list, panel) {
  if (panel === "px-session-home") return void 0;
  return list.current ?? Object.values(list.byId).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id;
}

// packages/shared/native-sidebar.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var nativeKind = (type) => type === "editor" ? "files" : type;
function createNativeSidebar(host) {
  const registry = host.sidebarRightTabs;
  return {
    registerTab(definition) {
      const off = registry.register({
        id: definition.id,
        kind: definition.id,
        title: () => definition.title,
        guide: [
          { id: definition.id + "-guide", order: definition.order ?? 50, title: () => definition.title }
        ]
      });
      host.slots.inject(
        "sidebar.right.pane.tab",
        () => host.slots.register({ name: "sidebar.right.pane.tab", key: definition.id }, (props) => {
          const info = props.useTabInfo();
          const Component = definition.component;
          return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            Component,
            {
              scope: { sessionId: props.sessionId },
              visible: info.tab.visible,
              tab: { meta: info.tab.navigation.params }
            }
          );
        })
      );
      return off;
    },
    openTab(seed, scope) {
      if (!scope?.sessionId) throw new Error("\u8BF7\u5148\u9009\u62E9\u4F1A\u8BDD");
      host.sidebarRight.openTabIn(scope.sessionId, nativeKind(seed.type), { params: seed.meta });
    },
    openFile(scope, path) {
      host.sidebarRight.openResourceIn(scope.sessionId, nativeFileAddress(scope.sessionId, path));
    },
    isTabEnabled: (type) => !!registry.get(nativeKind(type)),
    getTab: (type) => registry.get(nativeKind(type)),
    subscribe: (listener) => registry.subscribe(listener),
    getSnapshot: () => registry.entries(),
    subscribeState: (listener) => registry.subscribe(listener)
  };
}

// packages/shared/client-capabilities.ts
function createCapabilities(initial) {
  let value = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      value = { ...value, ...next };
      for (const listener of listeners) listener();
    }
  };
}

// packages/shared/ui.tsx
var import_react = require("react");

// packages/shared/owned-style.ts
function installOwnedStyle(ctx, key, css2) {
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error("Invalid PX stylesheet key");
  ctx.effect?.(() => {
    const style = document.querySelector(`style[data-dsh-px-style="${key}"]`) ?? document.createElement("style");
    style.dataset.dshPxStyle = key;
    style.setAttribute("data-plugin", `dsh-px-effect:${key}`);
    style.textContent = css2;
    style.dataset.users = String(Number(style.dataset.users ?? 0) + 1);
    if (!style.isConnected) document.head.appendChild(style);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const users = Number(style.dataset.users) - 1;
      style.dataset.users = String(users);
      if (users <= 0) style.remove();
    };
  }, `px: ${key} stylesheet`);
}

// packages/shared/ui.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
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
  installOwnedStyle(ctx, "shared-ui", uiCss);
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
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
      children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: paths[name] ?? paths.file })
    }
  );
}
function ConfirmDelete({
  label,
  disabled,
  onConfirm
}) {
  const [confirm, setConfirm] = (0, import_react.useState)(false);
  return confirm ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "px-confirm-delete", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
      "\u786E\u8BA4",
      label,
      "\uFF1F"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
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
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { disabled, onClick: () => setConfirm(false), children: "\u4FDD\u7559" })
  ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "px-danger", disabled, onClick: () => setConfirm(true), children: label });
}

// packages/dsh-px-workspace/src/client/host-layout.ts
var hostLayoutCss = `
[data-dsh-px-layout-owner]{padding-top:var(--dsh-px-toolbar-height,46px);box-sizing:border-box;grid-template-rows:minmax(0,1fr)}
[data-dsh-px-layout-owner][data-rightbar-fullscreen]{padding-top:0}
[data-dsh-px-layout-owner][data-rightbar-fullscreen] .px-bar{display:none}
[data-windows-titlebar] [data-dsh-px-layout-owner]{padding-top:calc(var(--dsh-windows-titlebar-height,0px) + var(--dsh-px-toolbar-height,46px))}
[data-windows-titlebar] [data-dsh-px-layout-owner] .px-bar{top:var(--dsh-windows-titlebar-height,0px)}
[data-windows-titlebar] [data-dsh-px-layout-owner][data-rightbar-fullscreen]{padding-top:var(--dsh-windows-titlebar-height,0px)}
`;

// packages/dsh-px-workspace/src/client/styles.ts
var css = hostLayoutCss + `
.px-bar{position:absolute;inset:0 0 auto;min-height:46px;box-sizing:border-box;pointer-events:auto;background:var(--px-bg);border-bottom:1px solid var(--px-border);display:flex;flex-direction:column;padding:6px 12px;gap:6px;isolation:isolate}
.px-bar .px-tab>button{min-height:28px;border:0;background:transparent;border-radius:6px;padding:3px 7px;flex:none}
.px-bar .px-tab>button[role=tab]{max-width:196px;min-width:0;flex:1;justify-content:flex-start;gap:6px}
.px-tools{display:flex;align-items:center;gap:4px;overflow-x:auto;scrollbar-width:thin}.px-tools>button{white-space:nowrap;flex:none;border-color:transparent;background:transparent;padding:4px 8px}
.px-status{margin-left:auto;white-space:nowrap;color:var(--px-muted);font-size:12px;padding:0 5px}
.px-bar-error{position:absolute;right:12px;top:calc(100% + 2px);max-width:min(540px,calc(100vw - 24px));border:1px solid var(--px-error);background:var(--px-bg);padding:9px 12px;border-radius:9px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;box-shadow:0 4px 18px #0002;z-index:2}
.px-dependency-warning{font-size:12px;line-height:1.5;color:var(--px-muted)}
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
@media(max-width:560px){.px-tools{min-height:34px}}
`;

// packages/dsh-px-workspace/src/client/runtime.tsx
var inject = ["slots", "sessions", "uiWorkspace", "conversation", "layout"];
function createWorkspaceClient(raw) {
  const capabilities = createCapabilities({});
  const ctx = {
    sessions: raw.sessions,
    layout: raw.layout,
    uiWorkspace: raw.uiWorkspace,
    conversation: raw.conversation,
    slots: raw.slots,
    effect: raw.effect.bind(raw),
    inject: raw.inject.bind(raw),
    capabilities
  };
  installUiStyles(ctx);
  installOwnedStyle(ctx, "workspace", css);
  ctx.inject(["sidebarRight"], (host) => {
    const terminal = host.sidebarRight;
    capabilities.set({ terminal });
    host.effect(
      () => () => {
        if (capabilities.getSnapshot().terminal === terminal) capabilities.set({ terminal: void 0 });
      },
      "workspace: terminal capability"
    );
  });
  ctx.inject(["sidebarRightTabs"], (host) => {
    const nativeTabs = host.sidebarRightTabs;
    capabilities.set({ nativeTabs });
    host.effect(
      () => () => {
        if (capabilities.getSnapshot().nativeTabs === nativeTabs) capabilities.set({ nativeTabs: void 0 });
      },
      "workspace: native panel registry"
    );
  });
  ctx.inject(["sidebarRight", "sidebarRightTabs"], (host) => {
    if (typeof host.sidebarRightTabs.entries !== "function") return;
    const sidebar = createNativeSidebar(host);
    capabilities.set({ sidebar });
    host.effect(
      () => () => {
        if (capabilities.getSnapshot().sidebar === sidebar) capabilities.set({ sidebar: void 0 });
      },
      "workspace: panels"
    );
  });
  return ctx;
}

// packages/dsh-px-workspace/src/client/data.ts
var import_react2 = require("react");

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
async function requestJson(path, init = {}) {
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
    if (!response.ok) {
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
function createOperation(onUnused) {
  let pending = false;
  const listeners = /* @__PURE__ */ new Set();
  const publish = (value) => {
    pending = value;
    for (const cb of listeners) cb();
    if (!pending && !listeners.size) onUnused?.();
  };
  return {
    getSnapshot: () => pending,
    subscribers: () => listeners.size,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
        if (!pending && !listeners.size) onUnused?.();
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
function createOperationRegistry() {
  const operations2 = /* @__PURE__ */ new Map();
  return {
    get(key) {
      let operation = operations2.get(key);
      if (!operation) {
        operation = createOperation(() => {
          queueMicrotask(() => {
            if (operations2.get(key) === operation && !operation.getSnapshot() && !operation.subscribers())
              operations2.delete(key);
          });
        });
        operations2.set(key, operation);
      }
      return operation;
    },
    pending: (key) => operations2.get(key)?.getSnapshot() === true,
    size: () => operations2.size
  };
}

// packages/shared/quote-requests.ts
function createQuoteRequests(limit = 64) {
  let requests = {};
  let revision = 0;
  const epoch = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const listeners = /* @__PURE__ */ new Set();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => requests,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request(sessionId, messageId, quote) {
      if (quote !== void 0 && (!quote || quote.length > 8e3)) throw new Error("\u5F15\u7528\u7247\u6BB5\u987B\u4E3A 1\u20138000 \u5B57\u7B26");
      if (!requests[sessionId] && Object.keys(requests).length >= limit)
        throw new Error("\u5F85\u5904\u7406\u5F15\u7528\u8FC7\u591A\uFF0C\u8BF7\u5148\u5728\u5F15\u7528\u4E0E\u6279\u6CE8\u9762\u677F\u5904\u7406\u5DF2\u6709\u5F15\u7528\u3002");
      requests = {
        ...requests,
        [sessionId]: { messageId, token: `${epoch}:${++revision}`, ...quote === void 0 ? {} : { quote } }
      };
      publish();
    },
    consume(sessionId, token) {
      if (!requests[sessionId] || token && requests[sessionId].token !== token) return;
      const next = { ...requests };
      delete next[sessionId];
      requests = next;
      publish();
    }
  };
}

// packages/dsh-px-workspace/src/client/data.ts
var operations = createOperationRegistry();
var isOperationPending = operations.pending;
function useOperation(key) {
  const [operation] = (0, import_react2.useState)(() => {
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
var quoteRequests = createQuoteRequests();
var requestQuote = quoteRequests.request;
function useSnapshot(store) {
  const [value, set] = (0, import_react2.useState)(store.getSnapshot);
  (0, import_react2.useEffect)(() => {
    const refresh = () => set(store.getSnapshot());
    refresh();
    return store.subscribe(refresh);
  }, [store]);
  return value;
}
var cache = /* @__PURE__ */ new Map();
function useData(url, enabled) {
  const [data, set] = (0, import_react2.useState)(() => cache.get(url) ?? null), [error, setError] = (0, import_react2.useState)(""), [revision, revise] = (0, import_react2.useState)(0), [loading, setLoading] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => {
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

// packages/dsh-px-annotations/src/client/notes.tsx
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
var import_react3 = require("react");

// packages/shared/draft-store.ts
function createDraftCell(key, initial, storage, validate = () => true) {
  let value = initial;
  let persisted = Boolean(storage);
  let unreadable = false;
  let memoryEdits = false;
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
        if (!validate(restored)) throw new Error("invalid draft record");
        value = restored;
      } else if (raw) {
        throw new Error("unsupported draft record");
      }
    } else if (raw) {
      throw new Error("draft record too large");
    }
  } catch {
    unreadable = true;
  }
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => value,
    isPersisted: () => persisted,
    isUnreadable: () => unreadable,
    canReleaseMemory: () => persisted || !memoryEdits,
    subscribers: () => listeners.size,
    isEmpty: () => JSON.stringify(value) === JSON.stringify(initial),
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    set: (next) => {
      unreadable = false;
      memoryEdits = true;
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
    },
    clear: (cleanValue = initial) => {
      value = cleanValue && typeof cleanValue === "object" ? { ...cleanValue } : cleanValue;
      unreadable = false;
      memoryEdits = false;
      persisted = Boolean(storage);
      try {
        storage?.removeItem?.(key);
      } catch {
        persisted = false;
      }
      for (const cb of listeners) cb();
    }
  };
}
function createDraftRegistry(limit = 48, canEvict = () => true) {
  const cells2 = /* @__PURE__ */ new Map();
  const trim = (reserve = 0) => {
    for (const [key, cell] of cells2) {
      if (cells2.size + reserve <= limit) break;
      if (cell.subscribers() === 0 && canEvict(key) && (cell.canReleaseMemory() || cell.isEmpty()))
        cells2.delete(key);
    }
  };
  return {
    acquire(key, initial, storage, validate) {
      const existing = cells2.get(key);
      if (existing) {
        cells2.delete(key);
        cells2.set(key, existing);
        return existing;
      }
      trim(1);
      if (cells2.size >= limit) return null;
      const cell = createDraftCell(key, initial, storage, validate);
      cells2.set(key, cell);
      return cell;
    },
    size: () => cells2.size,
    release: () => trim()
  };
}

// packages/dsh-px-workspace/src/client/drafts.ts
var prefix = "dsh-px.draft.v1.";
var cells = createDraftRegistry(48, (key) => !isOperationPending(key.slice(prefix.length)));
function useDraft(key, initial, validate) {
  const [{ cell, available }] = (0, import_react3.useState)(() => {
    let storage;
    try {
      storage = sessionStorage;
    } catch {
    }
    const seed = initial();
    const acquired = cells.acquire(prefix + key, seed, storage, validate);
    return { cell: acquired ?? createDraftCell(key, seed), available: Boolean(acquired) };
  });
  const value = useSnapshot(cell);
  return [
    value,
    (next) => {
      if (available) cell.set(next);
    },
    cell.isUnreadable() ? "\u6B64\u7A97\u53E3\u8349\u7A3F\u683C\u5F0F\u65E0\u6CD5\u6062\u590D\uFF0C\u539F\u8BB0\u5F55\u5C1A\u672A\u8986\u76D6\u3002\u786E\u8BA4\u653E\u5F03\u540E\u53EF\u91CD\u65B0\u7F16\u8F91\u3002" : !available ? "\u672A\u4FDD\u5B58\u8349\u7A3F\u7F13\u5B58\u5DF2\u6EE1\uFF0C\u5DF2\u6682\u505C\u65B0\u5EFA\u7F16\u8F91\u3002\u8BF7\u5148\u4FDD\u5B58\u5DF2\u6709\u8349\u7A3F\uFF0C\u518D\u91CD\u65B0\u6253\u5F00\u6B64\u9762\u677F\u3002" : cell.isPersisted() ? "" : "\u7A97\u53E3\u5B58\u50A8\u4E0D\u53EF\u7528\uFF0C\u672C\u6B21\u9875\u9762\u5185\u4ECD\u4FDD\u7559\u8349\u7A3F\uFF1B\u5237\u65B0\u6216\u5173\u95ED\u524D\u8BF7\u4FDD\u5B58\u3002",
    available && !cell.isUnreadable(),
    (cleanValue) => cell.clear(cleanValue),
    cell.isUnreadable()
  ];
}

// packages/dsh-px-workspace/src/client/storage-notice.tsx
var import_react4 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
function StorageNotice({
  visible,
  onRestored
}) {
  const status = useData(`${base}/storage`, visible);
  const [selected, setSelected] = (0, import_react4.useState)(null);
  const [failure, setFailure] = (0, import_react4.useState)("");
  const [busy, run] = useOperation("storage:restore");
  if (!status.data || status.data.ready) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "px-card", role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h4", { children: "\u6279\u6CE8\u4E0E\u5B9A\u65F6\u5B58\u50A8\u9700\u8981\u6062\u590D" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
      status.data.error,
      " \u4F1A\u8BDD\u6B63\u6587\u4E0E\u4EA7\u7269\u4ECD\u53EF\u67E5\u770B\u3002"
    ] }),
    failure ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: failure }) : null,
    status.data.snapshots.length ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u6062\u590D\u4F1A\u4FDD\u7559\u5F53\u524D\u635F\u574F\u6587\u4EF6\uFF0C\u5E76\u6682\u505C\u5168\u90E8\u5B9A\u65F6\u4EFB\u52A1\uFF1B\u6838\u5BF9\u540E\u518D\u542F\u7528\u3002" }),
      status.data.snapshots.map((snapshot) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
          new Date(snapshot.createdAt).toLocaleString(),
          " \xB7 ",
          snapshot.annotations,
          " \u6761\u6279\u6CE8 \xB7",
          " ",
          snapshot.schedules,
          " \u4E2A\u4EFB\u52A1"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { disabled: busy, onClick: () => setSelected(snapshot.id), children: "\u9009\u62E9\u6B64\u5FEB\u7167" })
      ] }, snapshot.id)),
      selected ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            disabled: busy,
            onClick: () => void run(async () => {
              setFailure("");
              try {
                await post("storage", {
                  action: "restore",
                  snapshotId: selected,
                  revision: status.data.revision
                });
                setSelected(null);
                status.refresh();
                onRestored();
              } catch (err) {
                setFailure(errorText(err));
              }
            }),
            children: busy ? "\u6062\u590D\u4E2D\u2026" : "\u786E\u8BA4\u6062\u590D\u6240\u9009\u5FEB\u7167"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { disabled: busy, onClick: () => setSelected(null), children: "\u53D6\u6D88" })
      ] }) : null
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u6CA1\u6709\u53EF\u6062\u590D\u5FEB\u7167\uFF0C\u8BF7\u4ECE\u6570\u636E\u76EE\u5F55\u5907\u4EFD\u6062\u590D\uFF1B\u4E0D\u4F1A\u4EE5\u7A7A\u6570\u636E\u8986\u76D6\u5F53\u524D\u6587\u4EF6\u3002" })
  ] });
}

// packages/dsh-px-workspace/src/client/draft-validation.ts
var record = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
var finite = (value) => typeof value === "number" && Number.isFinite(value);
function validNoteDraft(value) {
  const source = value.source;
  if (source !== null && (!record(source) || typeof source.id !== "string" || typeof source.text !== "string" || !finite(source.seq) || !finite(source.length) || !finite(source.offset) || source.nextOffset !== null && !finite(source.nextOffset) || !["user", "assistant"].includes(String(source.role))))
    return false;
  const editing = value.editing;
  return editing === null || record(editing) && typeof editing.id === "string" && typeof editing.messageId === "string" && typeof editing.sessionId === "string" && typeof editing.quote === "string" && typeof editing.note === "string" && finite(editing.updatedAt);
}

// packages/shared/quote-whitespace.ts
var quoteWhitespace = (text) => text.replace(/\s+/gu, " ").trim();

// packages/dsh-px-annotations/src/client/notes.tsx
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
  const [editor, setEditor, draftWarning, draftAvailable, clearDraft, unreadableDraft] = useDraft(
    `notes:${scope.sessionId}`,
    () => ({
      source: null,
      quote: "",
      note: "",
      editing: null,
      initialized: false,
      collapsed: false,
      dirty: false,
      requestToken: ""
    }),
    validNoteDraft
  );
  const { source, quote, note, editing } = editor;
  const resetEditor = () => clearDraft({
    source: null,
    quote: "",
    note: "",
    editing: null,
    initialized: true,
    collapsed: false,
    dirty: false,
    requestToken: ""
  });
  const setQuote = (quote2) => setEditor((old) => ({ ...old, quote: quote2, dirty: true }));
  const setNote = (note2) => setEditor((old) => ({ ...old, note: note2, dirty: true }));
  const [notice, setNotice] = (0, import_react5.useState)(""), [failure, setFailure] = (0, import_react5.useState)(""), [localBusy, setBusy] = (0, import_react5.useState)(false);
  const [operationBusy, runOperation] = useOperation(`notes:${scope.sessionId}`);
  const busy = localBusy || operationBusy;
  const [replacement, setReplacement] = (0, import_react5.useState)(null);
  const [sourceRetry, setSourceRetry] = (0, import_react5.useState)(null);
  const revision = (0, import_react5.useRef)(0);
  const active = (0, import_react5.useRef)(true), sourceRequest = (0, import_react5.useRef)(null);
  (0, import_react5.useEffect)(() => {
    active.current = true;
    return () => {
      active.current = false;
      sourceRequest.current?.abort();
    };
  }, []);
  async function choose(id, existing = null, offset = 0, replace = false, request, selectedQuote) {
    if (operationBusy || !draftAvailable) return;
    const pending = quoteRequests.getSnapshot()[scope.sessionId];
    const requestToken = typeof request === "object" ? request.token : void 0;
    if (requestToken && pending?.token !== requestToken) return;
    if (request === "initial" && pending) return;
    if (request === void 0) {
      setEditor((old) => ({ ...old, initialized: true, requestToken: pending?.token ?? old.requestToken }));
      if (pending) quoteRequests.consume(scope.sessionId, pending.token);
    }
    if ((editor.dirty || note !== (editing?.note ?? "")) && !replace) {
      setEditor((old) => ({ ...old, initialized: true, requestToken: requestToken ?? old.requestToken }));
      if (requestToken) quoteRequests.consume(scope.sessionId, requestToken);
      setReplacement({ id, existing, offset, quote: selectedQuote });
      return;
    }
    setReplacement(null);
    setSourceRetry(null);
    const rev = ++revision.current;
    sourceRequest.current?.abort();
    const controller = new AbortController();
    sourceRequest.current = controller;
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      const value = selectedQuote === void 0 ? await requestJson(
        `${base}/message?sessionId=${encodeURIComponent(scope.sessionId)}&messageId=${encodeURIComponent(id)}&offset=${offset}`,
        { signal: controller.signal }
      ) : await requestJson(`${base}/selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: scope.sessionId, messageId: id, quote: selectedQuote }),
        signal: controller.signal
      });
      if (rev !== revision.current || !active.current) return;
      setEditor({
        source: value,
        editing: existing,
        quote: existing?.quote ?? selectedQuote ?? value.text.slice(0, 8e3),
        note: existing?.note ?? "",
        initialized: true,
        collapsed: false,
        dirty: false,
        requestToken: requestToken ?? ""
      });
      if (requestToken) quoteRequests.consume(scope.sessionId, requestToken);
    } catch (e) {
      if (active.current && rev === revision.current && !controller.signal.aborted) {
        setFailure(errorText(e));
        setSourceRetry({ id, existing, offset, quote: selectedQuote });
      }
    } finally {
      if (active.current && rev === revision.current) setBusy(false);
    }
  }
  (0, import_react5.useEffect)(() => {
    const pending = quoteRequests.getSnapshot()[scope.sessionId];
    if (pending && pending.token !== editor.requestToken)
      void choose(pending.messageId, null, 0, false, { token: pending.token }, pending.quote);
    else if (!pending && !editor.initialized && tab.meta?.messageId)
      void choose(tab.meta.messageId, null, 0, false, "initial");
  }, [selection, tab.meta?.messageId, operationBusy, draftAvailable]);
  const draft = source ? { sessionId: scope.sessionId, messageId: source.id, seq: source.seq, quote, note } : null;
  const validQuote = !!quote && ((source?.rendered ? quoteWhitespace(source.text).includes(quoteWhitespace(quote)) : !!source?.text.includes(quote)) || editing?.quote === quote);
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
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u8FD9\u91CC\u7BA1\u7406\u5DF2\u4FDD\u5B58\u7684\u6279\u6CE8\u3002\u60F3\u5BF9\u4E00\u53E5\u8BDD\u63D0\u610F\u89C1\uFF0C\u53EF\u76F4\u63A5\u5728\u5BF9\u8BDD\u4E2D\u9009\u4E2D\u6587\u5B57\uFF0C\u70B9\u51FB\u201C\u6279\u6CE8\u201D\u3002" }),
    draftWarning ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: draftWarning }) : null,
    unreadableDraft ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ConfirmDelete, { label: "\u653E\u5F03\u65E0\u6CD5\u6062\u590D\u7684\u8349\u7A3F", onConfirm: async () => resetEditor() }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      StorageNotice,
      {
        visible,
        onRestored: () => {
          notes.refresh();
          refresh();
        }
      }
    ),
    replacement ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "px-card", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u5F53\u524D\u6279\u6CE8\u6709\u672A\u4FDD\u5B58\u4FEE\u6539\u3002\u4FDD\u5B58\u6216\u4FDD\u7559\u5F53\u524D\u8349\u7A3F\u540E\uFF0C\u518D\u5207\u6362\u5F15\u7528\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => setReplacement(null), children: "\u4FDD\u7559\u5F53\u524D\u8349\u7A3F" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            disabled: busy,
            onClick: () => void choose(
              replacement.id,
              replacement.existing,
              replacement.offset,
              true,
              void 0,
              replacement.quote
            ),
            children: "\u653E\u5F03\u4FEE\u6539\u5E76\u5207\u6362"
          }
        )
      ] })
    ] }) : null,
    source && editor.collapsed ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => setEditor((old) => ({ ...old, collapsed: false })), children: "\u7EE7\u7EED\u7F16\u8F91\u8349\u7A3F" }) : null,
    failure || error || notes.error ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: failure || error || notes.error }) : null,
    sourceRetry ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "button",
      {
        disabled: busy || !draftAvailable,
        onClick: () => void choose(
          sourceRetry.id,
          sourceRetry.existing,
          sourceRetry.offset,
          false,
          void 0,
          sourceRetry.quote
        ),
        children: "\u91CD\u8BD5\u8BFB\u53D6\u539F\u6587"
      }
    ) : null,
    notice ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", className: "px-feedback", children: notice }) : null,
    source && !editor.collapsed ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("section", { className: "px-card", "aria-label": "\u6279\u6CE8\u7F16\u8F91\u5668", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("fieldset", { disabled: busy || !draftAvailable, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("h4", { children: [
        source.role === "user" ? "\u7528\u6237" : "\u52A9\u624B",
        " \xB7 \u8BB0\u5F55 ",
        source.seq
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "\u6D88\u606F\u6B63\u6587\uFF08\u53EF\u9009\u4E2D\u4E00\u6BB5\u4F5C\u4E3A\u5F15\u7528\uFF09",
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
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u53EF\u9009\u4E2D\u4E0A\u65B9\u6B63\u6587\uFF0C\u4E5F\u53EF\u5220\u53BB\u4E0D\u9700\u8981\u7684\u90E8\u5206\uFF1B\u5F15\u7528\u987B\u5BF9\u5E94\u8FD9\u6761\u6D88\u606F\u7684\u8FDE\u7EED\u5185\u5BB9\u3002" }),
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
              clearDraft({ ...editor, editing: saved, dirty: false });
              notes.refresh();
              try {
                insertQuote(ctx, scope.sessionId, saved);
              } catch (error2) {
                throw new Error(`\u6279\u6CE8\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u672A\u80FD\u52A0\u5165\u8349\u7A3F\uFF1A${errorText(error2)}`);
              }
            }, "\u6279\u6CE8\u5DF2\u4FDD\u5B58\u5E76\u52A0\u5165\u4F1A\u8BDD\u8349\u7A3F\uFF0C\u8BF7\u68C0\u67E5\u540E\u53D1\u9001\u3002"),
            children: "\u4FDD\u5B58\u5E76\u52A0\u5165\u4F1A\u8BDD"
          }
        ),
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
              clearDraft({ ...editor, editing: saved, dirty: false });
            }, "\u6279\u6CE8\u5DF2\u4FDD\u5B58"),
            children: editing ? "\u66F4\u65B0\u6279\u6CE8" : "\u4FDD\u5B58\u6279\u6CE8"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy || !validQuote, onClick: () => draft && insert(draft), children: "\u5F15\u7528\u5230\u8F93\u5165\u6846" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy, onClick: () => setEditor((old) => ({ ...old, collapsed: true })), children: "\u6536\u8D77\u7F16\u8F91\u5668" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          ConfirmDelete,
          {
            label: "\u653E\u5F03\u8349\u7A3F",
            disabled: busy,
            onConfirm: async () => {
              resetEditor();
              setReplacement(null);
            }
          }
        )
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
                resetEditor();
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

// packages/dsh-px-workspace/src/client/panel-availability.ts
var import_react6 = require("react");
var unavailable = (state, reason) => ({ enabled: false, state, reason });
function panelAvailability(capabilities, type) {
  const { sidebar, terminal, nativeTabs } = capabilities;
  try {
    if (type === "terminal") {
      if (sidebar) {
        if (typeof sidebar.isTabEnabled !== "function")
          return unavailable("unknown", "\u65E0\u6CD5\u786E\u8BA4\u7EC8\u7AEF\u8BBE\u7F6E\uFF0C\u8BF7\u68C0\u67E5\u4FA7\u8FB9\u5361\u7247\u7248\u672C\u3002");
        const preference = sidebar.isTabEnabled(type);
        if (preference === false) return unavailable("disabled", "\u5DF2\u5728\u201C\u4FA7\u8FB9\u5361\u7247\u201D\u8BBE\u7F6E\u4E2D\u7981\u7528\u3002");
        if (preference !== true) return unavailable("unknown", "\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u7EC8\u7AEF\u8BBE\u7F6E\u3002");
      }
      if (typeof terminal?.openTabIn !== "function") return unavailable("missing", "\u539F\u751F\u7EC8\u7AEF\u5165\u53E3\u5C1A\u672A\u52A0\u8F7D\u3002");
      if (typeof nativeTabs?.get !== "function" || typeof nativeTabs.subscribe !== "function")
        return unavailable("missing", "\u539F\u751F\u7EC8\u7AEF\u9762\u677F\u72B6\u6001\u5C1A\u672A\u5C31\u7EEA\u3002");
      if (!nativeTabs.get(type)) return unavailable("missing", "\u7EC8\u7AEF\u63D2\u4EF6\u5C1A\u672A\u52A0\u8F7D\u3002");
    } else {
      if (!sidebar) return unavailable("missing", "\u4FA7\u8FB9\u5361\u7247\u670D\u52A1\u5C1A\u672A\u52A0\u8F7D\u3002");
      if (typeof sidebar.getTab !== "function" || typeof sidebar.subscribe !== "function" || typeof sidebar.subscribeState !== "function" || typeof sidebar.isTabEnabled !== "function")
        return unavailable("unknown", "\u4FA7\u8FB9\u5361\u7247\u7248\u672C\u672A\u63D0\u4F9B\u5B8C\u6574\u9762\u677F\u72B6\u6001\uFF0C\u8BF7\u68C0\u67E5\u63D2\u4EF6\u7248\u672C\u3002");
      if (!sidebar.getTab(type)) return unavailable("missing", "\u63D0\u4F9B\u6B64\u9762\u677F\u7684\u63D2\u4EF6\u5C1A\u672A\u52A0\u8F7D\u3002");
      const preference = sidebar.isTabEnabled(type);
      if (preference === false) return unavailable("disabled", "\u5DF2\u5728\u201C\u4FA7\u8FB9\u5361\u7247\u201D\u8BBE\u7F6E\u4E2D\u7981\u7528\u3002");
      if (preference !== true) return unavailable("unknown", "\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u9762\u677F\u8BBE\u7F6E\u3002");
    }
    return { enabled: true, state: "ready", reason: "" };
  } catch {
    return unavailable("unknown", "\u9762\u677F\u72B6\u6001\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u8BF7\u5230\u201C\u8FD0\u884C\u4E0E\u5E2E\u52A9\u201D\u68C0\u67E5\u3002");
  }
}
function usePanelCapabilities(ctx) {
  const capabilities = useSnapshot(ctx.capabilities);
  const [, refresh] = (0, import_react6.useState)(0);
  (0, import_react6.useEffect)(() => {
    const changed = () => refresh((value) => value + 1);
    const offRegistry = typeof capabilities.sidebar?.subscribe === "function" ? capabilities.sidebar.subscribe(changed) : void 0;
    const offState = typeof capabilities.sidebar?.subscribeState === "function" ? capabilities.sidebar.subscribeState(changed) : void 0;
    const offNative = typeof capabilities.nativeTabs?.subscribe === "function" ? capabilities.nativeTabs.subscribe(changed) : void 0;
    changed();
    return () => {
      offRegistry?.();
      offState?.();
      offNative?.();
    };
  }, [capabilities.sidebar, capabilities.nativeTabs]);
  return capabilities;
}

// packages/dsh-px-workspace/src/client/quote-action.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function QuoteAction({
  ctx,
  sessionId,
  messageId
}) {
  const availability = panelAvailability(usePanelCapabilities(ctx), "px-notes");
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "px-ui", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
    "button",
    {
      className: "px-quote-action",
      disabled: !availability.enabled,
      title: availability.enabled ? "\u5F15\u7528\u6216\u6279\u6CE8\u8FD9\u6761\u6D88\u606F" : `\u5F15\u7528\u4E0E\u6279\u6CE8\u4E0D\u53EF\u7528\uFF1A${availability.reason}`,
      onClick: () => {
        let requestToken;
        try {
          const live = ctx.capabilities.getSnapshot();
          const current = panelAvailability(live, "px-notes");
          if (!current.enabled) throw new Error(current.reason);
          requestQuote(sessionId, messageId);
          requestToken = quoteRequests.getSnapshot()[sessionId]?.token;
          live.sidebar.openTab({ type: "px-notes", meta: { messageId } }, { sessionId });
        } catch (err) {
          if (requestToken) quoteRequests.consume(sessionId, requestToken);
          const scope = ctx.sessions.scope(sessionId);
          if (scope)
            ctx.conversation.input.for(scope).notify("error", err instanceof Error ? err.message : String(err));
        }
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Icon, { name: "note" }),
        "\u5F15\u7528 / \u6279\u6CE8"
      ]
    }
  ) });
}

// packages/dsh-px-annotations/src/client/selection.tsx
var import_react8 = require("react");

// packages/dsh-px-annotations/src/client/quick-note.tsx
var import_react7 = require("react");
var import_jsx_runtime6 = require("react/jsx-runtime");
function QuickNote({
  ctx,
  selection,
  lock,
  close
}) {
  const key = `quick-note:${JSON.stringify([selection.sessionId, selection.messageId, selection.quote])}`;
  const [draft, setDraft, warning, available, clearDraft, unreadable] = useDraft(
    key,
    () => ({ note: "", saved: null }),
    (value) => typeof value.note === "string" && value.note.length <= 4e3 && validNoteDraft({ source: null, editing: value.saved }) && (!value.saved || value.saved.sessionId === selection.sessionId && value.saved.messageId === selection.messageId && value.saved.quote === selection.quote && Number.isSafeInteger(value.saved.seq))
  );
  const [expanded, expand] = (0, import_react7.useState)(Boolean(draft.note || draft.saved || warning));
  const [failure, fail] = (0, import_react7.useState)("");
  const [busy, run] = useOperation(key);
  const running = (0, import_react7.useRef)(false), alive = (0, import_react7.useRef)(true), root = (0, import_react7.useRef)(null);
  const [viewport, resize] = (0, import_react7.useState)({ width: window.innerWidth, height: window.innerHeight });
  (0, import_react7.useEffect)(() => {
    alive.current = true;
    const update = () => resize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => {
      alive.current = false;
      window.removeEventListener("resize", update);
    };
  }, []);
  (0, import_react7.useEffect)(() => {
    lock(expanded || busy);
    if (expanded) root.current?.querySelector("textarea")?.focus();
    return () => lock(false);
  }, [expanded, busy]);
  (0, import_react7.useEffect)(() => {
    if (!expanded) return;
    const outside = (event) => {
      if (!running.current && !root.current?.contains(event.target)) close();
    };
    const escape = (event) => {
      if (event.key === "Escape" && !event.isComposing && !running.current) {
        event.preventDefault();
        close();
      }
    };
    const scroll = (event) => {
      if (!running.current && !root.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [expanded, close]);
  const assertCurrent = () => {
    if (selectedSession(
      ctx.sessions.list.getSnapshot(),
      ctx.layout?.panelInfo?.getSnapshot().activePanelId ?? null
    ) !== selection.sessionId)
      throw new Error("\u4F1A\u8BDD\u5DF2\u5207\u6362\uFF1B\u6279\u6CE8\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u56DE\u5230\u539F\u4F1A\u8BDD\u7EE7\u7EED");
  };
  async function add() {
    if (running.current || busy || !available) return;
    running.current = true;
    lock(true);
    fail("");
    try {
      await run(async () => {
        assertCurrent();
        let saved = draft.saved;
        if (!saved || saved.note !== draft.note) {
          saved = await post("annotations", {
            action: "save",
            sessionId: selection.sessionId,
            messageId: selection.messageId,
            quote: selection.quote,
            note: draft.note,
            ...saved ? { id: saved.id, updatedAt: saved.updatedAt } : {}
          });
          setDraft({ note: draft.note, saved });
        }
        if (!alive.current) return;
        assertCurrent();
        insertQuote(ctx, selection.sessionId, saved);
        clearDraft();
        window.getSelection()?.removeAllRanges();
        close();
      });
    } catch (error) {
      if (alive.current) {
        fail(errorText(error));
        expand(true);
      }
    } finally {
      running.current = false;
    }
  }
  const width = Math.min(expanded ? 340 : 240, viewport.width - 16);
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
    "div",
    {
      ref: root,
      className: "px-ui px-selection-action",
      role: expanded ? "dialog" : "group",
      "aria-label": expanded ? "\u6DFB\u52A0\u6279\u6CE8" : "\u9009\u4E2D\u6587\u5B57\u64CD\u4F5C",
      style: {
        position: "fixed",
        zIndex: 1e3,
        pointerEvents: "auto",
        boxSizing: "border-box",
        animation: "px-feedback-in 130ms ease-out",
        width,
        left: Math.max(8, Math.min(selection.left, viewport.width - width - 8)),
        top: Math.max(48, Math.min(selection.top, viewport.height - (expanded ? 260 : 52))),
        maxHeight: Math.max(100, viewport.height - 64),
        overflowY: "auto",
        background: "var(--px-bg)",
        border: "1px solid var(--px-border)",
        borderRadius: 12,
        boxShadow: "0 6px 24px #0002",
        padding: expanded ? 12 : 4
      },
      children: expanded ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "blockquote",
          {
            style: {
              margin: "0 0 8px",
              paddingLeft: 8,
              borderLeft: "2px solid var(--px-border)",
              color: "var(--px-muted)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere"
            },
            title: selection.quote,
            children: selection.quote
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "textarea",
          {
            "aria-label": "\u6279\u6CE8",
            placeholder: "\u5199\u4E0B\u4F60\u7684\u60F3\u6CD5\u2026",
            rows: 2,
            maxLength: 4e3,
            style: { width: "100%", resize: "vertical", minHeight: 64, maxHeight: 140 },
            value: draft.note,
            disabled: busy || !available,
            onChange: (event) => setDraft({ ...draft, note: event.target.value }),
            onKeyDown: (event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent?.isComposing) {
                event.preventDefault();
                void add();
              }
            }
          }
        ),
        warning ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "px-muted", children: warning }) : null,
        unreadable ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ConfirmDelete, { label: "\u653E\u5F03\u65E0\u6CD5\u6062\u590D\u7684\u8349\u7A3F", onConfirm: async () => clearDraft() }) : null,
        failure ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { role: "alert", children: failure }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "px-actions", style: { marginBottom: 0, justifyContent: "space-between" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { disabled: busy, onClick: close, title: "\u8349\u7A3F\u4FDD\u7559\uFF0C\u91CD\u65B0\u9009\u4E2D\u539F\u53E5\u53EF\u7EE7\u7EED", children: "\u6536\u8D77" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "button",
            {
              className: "px-primary",
              disabled: busy || !available,
              onClick: () => void add(),
              title: "Ctrl+Enter \xB7 \u52A0\u5165\u8349\u7A3F\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u53D1\u9001",
              children: busy ? "\u6B63\u5728\u6DFB\u52A0\u2026" : "\u52A0\u5165\u5BF9\u8BDD"
            }
          )
        ] })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", gap: 4 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "button",
          {
            disabled: busy || !available,
            onPointerDown: (e) => e.preventDefault(),
            onClick: () => void add(),
            children: "\u6DFB\u52A0\u5230\u5BF9\u8BDD"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
          "button",
          {
            disabled: busy,
            onPointerDown: (e) => e.preventDefault(),
            onClick: () => {
              lock(true);
              expand(true);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "note" }),
              "\u6279\u6CE8"
            ]
          }
        )
      ] })
    }
  );
}

// packages/dsh-px-annotations/src/client/selection.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
function readSentenceSelection(ctx, reader) {
  const selected = window.getSelection();
  if (!selected || selected.isCollapsed || selected.rangeCount !== 1) return null;
  const range = selected.getRangeAt(0);
  const element = (node2) => node2 instanceof Element ? node2 : node2.parentElement;
  const start = element(range.startContainer), end = element(range.endContainer);
  if (!start || !end || start.closest('input,textarea,[contenteditable],button,[role="dialog"],.px-ui'))
    return null;
  const seat = start.closest("[data-chat-node-key]");
  if (!seat) return null;
  if (seat !== end.closest("[data-chat-node-key]")) {
    const outside = range.cloneRange();
    outside.setStartAfter(seat);
    if (outside.toString().trim()) return null;
  }
  const quote = selected.toString().trim();
  if (!quote || quote.length > 8e3) return null;
  const sessionId = selectedSession(
    ctx.sessions.list.getSnapshot(),
    ctx.layout?.panelInfo?.getSnapshot().activePanelId ?? null
  );
  const owner = seat.closest("[data-conversation-session]")?.getAttribute("data-conversation-session");
  if (!sessionId || owner !== sessionId) return null;
  const node = reader.binding(sessionId).target("chat").getSnapshot()?.nodes.get(seat.getAttribute("data-chat-node-key"));
  const messageId = node?.kind === "assistant-step" ? node.data?.finalNode?.messageId : node?.kind === "user" || node?.kind === "steering" ? node.id : void 0;
  if (typeof messageId !== "string" || !messageId) return null;
  const rect = range.getBoundingClientRect();
  return {
    sessionId,
    messageId,
    quote,
    left: Math.max(8, Math.min(window.innerWidth - 160, rect.left)),
    top: Math.max(48, Math.min(window.innerHeight - 44, rect.bottom + 6))
  };
}
function SelectionAction({ ctx, reader }) {
  const [selection, setSelection] = (0, import_react8.useState)(null);
  const locked = (0, import_react8.useRef)(false);
  (0, import_react8.useEffect)(() => {
    const update = () => {
      if (locked.current) return;
      try {
        setSelection(readSentenceSelection(ctx, reader));
      } catch {
        setSelection(null);
      }
    };
    const clear = () => {
      if (!locked.current) setSelection(null);
    };
    const key = (event) => {
      if (event.key === "Escape") clear();
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("pointerup", update);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    const checkSession = () => {
      const active = selectedSession(
        ctx.sessions.list.getSnapshot(),
        ctx.layout?.panelInfo?.getSnapshot().activePanelId ?? null
      );
      setSelection((current) => {
        if (!current || current.sessionId === active) return current;
        locked.current = false;
        return null;
      });
    };
    const unsubscribe = ctx.sessions.list.subscribe(checkSession);
    const unsubscribeLayout = ctx.layout?.panelInfo?.subscribe(checkSession);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("pointerup", update);
      document.removeEventListener("keydown", key);
      document.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
      unsubscribe();
      unsubscribeLayout?.();
    };
  }, [ctx, reader]);
  if (!selection) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
    QuickNote,
    {
      ctx,
      selection,
      lock: (value) => {
        locked.current = value;
      },
      close: () => {
        locked.current = false;
        setSelection(null);
      }
    },
    JSON.stringify([selection.sessionId, selection.messageId, selection.quote])
  );
}

// packages/dsh-px-annotations/src/client.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
function apply(raw) {
  const ctx = createWorkspaceClient(raw);
  ctx.inject(["uiConversation"], (host) => {
    host.slots.inject(
      "shell.overlay",
      () => host.slots.register(
        { name: "shell.overlay", id: "dsh-px-selection", order: 90, registrant: "dsh-px-annotations" },
        () => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(SelectionAction, { ctx, reader: host.uiConversation })
      )
    );
  });
  ctx.inject(["sidebarRight", "sidebarRightTabs"], (host) => {
    if (typeof host.sidebarRightTabs.entries !== "function") return;
    const sidebar = createNativeSidebar(host);
    host.effect(
      () => sidebar.registerTab({
        id: "px-notes",
        title: "\u5F15\u7528\u4E0E\u6279\u6CE8",
        order: 16,
        component: (p) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(NotesPanel, { ...p, ctx }, p.scope.sessionId)
      }),
      "dsh-px-annotations: panel"
    );
    host.slots.inject(
      "conversation.chat.assistant-actions",
      () => host.slots.register(
        {
          name: "conversation.chat.assistant-actions",
          id: "dsh-px-quote",
          order: 95,
          registrant: "dsh-px-annotations"
        },
        (p) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(QuoteAction, { ...p, ctx })
      )
    );
  });
}

		return module.exports;
	}
});
