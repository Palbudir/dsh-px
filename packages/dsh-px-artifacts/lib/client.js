window.__ModuleLoader__.load({
	id: "dsh-px-artifacts",
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

// packages/dsh-px-artifacts/src/client.tsx
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
var base = "/dsh-px-workspace";
var errorText = (e) => e instanceof Error ? e.message : String(e);
var stamp = (time) => time === null ? "\u5DF2\u6682\u505C" : new Date(time).toLocaleString();
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

// packages/dsh-px-artifacts/src/client/artifacts.tsx
var import_react4 = require("react");

// packages/dsh-px-workspace/src/client/panel-availability.ts
var import_react3 = require("react");
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
  const [, refresh] = (0, import_react3.useState)(0);
  (0, import_react3.useEffect)(() => {
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

// packages/dsh-px-artifacts/src/client/artifacts.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function ArtifactsPanel({ ctx, scope, visible }) {
  const filePanel = panelAvailability(usePanelCapabilities(ctx), "editor");
  const [openError, setOpenError] = (0, import_react4.useState)("");
  const [pages, setPages] = (0, import_react4.useState)([void 0]);
  const before = pages[pages.length - 1];
  const { data, error, refresh, loading } = useData(
    `${base}/content?sessionId=${encodeURIComponent(scope.sessionId)}${before ? "&artifactBefore=" + encodeURIComponent(before) : ""}`,
    visible
  );
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-ui px-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: "\u4F1A\u8BDD\u4EA7\u7269" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "px-muted", children: "\u6C47\u603B Agent \u4F7F\u7528 present \u58F0\u660E\u7684\u4EA4\u4ED8\u3002\u6253\u5F00\u7684\u662F\u6587\u4EF6\u5F53\u524D\u5185\u5BB9\uFF1B\u539F\u6587\u4EF6\u79FB\u52A8\u6216\u5220\u9664\u540E\u9700\u8981\u91CD\u65B0\u5B9A\u4F4D\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "button",
      {
        disabled: loading,
        onClick: () => {
          setPages([void 0]);
          refresh();
        },
        children: "\u5237\u65B0\u4EA7\u7269"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "px-load-status", role: "status", children: loading ? "\u6B63\u5728\u8BFB\u53D6\u4EA7\u7269\u2026" : "" }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "alert", children: error }) : null,
    !filePanel.enabled ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { role: "status", children: [
      "\u6587\u4EF6\u9884\u89C8\u6682\u4E0D\u53EF\u7528\uFF1A",
      filePanel.reason
    ] }) : null,
    openError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "alert", children: openError }) : null,
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
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "button",
        {
          disabled: !filePanel.enabled,
          title: filePanel.enabled ? "\u6253\u5F00\u4EA7\u7269" : filePanel.reason,
          onClick: () => {
            try {
              const live = ctx.capabilities.getSnapshot();
              const current = panelAvailability(live, "editor");
              if (!current.enabled) throw new Error(current.reason);
              live.sidebar.openFile(scope, a.path);
              setOpenError("");
            } catch (err) {
              setOpenError(errorText(err));
            }
          },
          children: "\u6253\u5F00\u4EA7\u7269"
        }
      )
    ] }, a.path)),
    data ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("small", { children: [
        "\u5171 ",
        data.artifactTotal,
        " \u9879 \xB7 \u7B2C ",
        pages.length,
        " \u9875"
      ] }),
      pages.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { onClick: () => setPages((old) => old.slice(0, -1)), children: "\u8F83\u65B0\u4E00\u9875" }) : null,
      data.nextArtifactBefore ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { onClick: () => setPages((old) => [...old, data.nextArtifactBefore]), children: "\u66F4\u65E9\u4EA7\u7269" }) : null
    ] }) : null
  ] });
}

// packages/dsh-px-artifacts/src/client.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function apply(raw) {
  const ctx = createWorkspaceClient(raw);
  ctx.inject(["sidebarRight", "sidebarRightTabs"], (host) => {
    if (typeof host.sidebarRightTabs.entries !== "function") return;
    const sidebar = createNativeSidebar(host);
    host.effect(
      () => sidebar.registerTab({
        id: "px-artifacts",
        title: "\u4EA7\u7269",
        order: 16,
        component: (p) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ArtifactsPanel, { ...p, ctx }, p.scope.sessionId)
      }),
      "dsh-px-artifacts: panel"
    );
  });
}

		return module.exports;
	}
});
