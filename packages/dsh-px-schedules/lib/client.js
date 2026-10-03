window.__ModuleLoader__.load({
	id: "dsh-px-schedules",
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

// packages/dsh-px-schedules/src/client.tsx
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

// packages/dsh-px-schedules/src/client/schedules.tsx
var import_react5 = require("react");

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
function validScheduleDraft(value) {
  if (!["once", "interval", "daily"].includes(value.kind)) return false;
  const editing = value.editing;
  if (editing === null) return true;
  if (!record(editing) || typeof editing.id !== "string" || typeof editing.sessionId !== "string" || typeof editing.title !== "string" || typeof editing.prompt !== "string" || typeof editing.enabled !== "boolean" || !finite(editing.updatedAt) || !record(editing.timing))
    return false;
  const rule = editing.timing;
  return rule.kind === "once" ? finite(rule.at) : rule.kind === "interval" ? finite(rule.minutes) : rule.kind === "daily" && typeof rule.time === "string";
}

// packages/dsh-px-schedules/src/client/schedules.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function localTime(time) {
  const d = new Date(time);
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
}
function SchedulesPanel({ ctx, scope, visible }) {
  const sessions = useSnapshot(ctx.sessions.list), { data, error, refresh } = useData(
    `${base}/schedules`,
    visible
  );
  const [draft, setDraft, draftWarning, draftAvailable, clearDraft, unreadableDraft] = useDraft(
    `schedules:${scope.sessionId}`,
    () => ({
      editing: null,
      form: false,
      title: "",
      prompt: "",
      sessionId: scope.sessionId,
      kind: "once",
      at: localTime(Date.now() + 3e5),
      minutes: "60",
      daily: "09:00",
      enabled: true,
      dirty: false
    }),
    validScheduleDraft
  );
  const { editing, form, title, prompt, sessionId, kind, at, minutes, daily, enabled } = draft;
  const setEditing = (editing2) => setDraft((old) => ({ ...old, editing: editing2 }));
  const setForm = (form2) => setDraft((old) => ({ ...old, form: form2 }));
  const setTitle = (title2) => setDraft((old) => ({ ...old, title: title2, dirty: true }));
  const setPrompt = (prompt2) => setDraft((old) => ({ ...old, prompt: prompt2, dirty: true }));
  const setSessionId = (sessionId2) => setDraft((old) => ({ ...old, sessionId: sessionId2, dirty: true }));
  const setKind = (kind2) => setDraft((old) => ({ ...old, kind: kind2, dirty: true }));
  const setAt = (at2) => setDraft((old) => ({ ...old, at: at2, dirty: true }));
  const setMinutes = (minutes2) => setDraft((old) => ({ ...old, minutes: minutes2, dirty: true }));
  const setDaily = (daily2) => setDraft((old) => ({ ...old, daily: daily2, dirty: true }));
  const setEnabled = (enabled2) => setDraft((old) => ({ ...old, enabled: enabled2, dirty: true }));
  const [localBusy, setBusy] = (0, import_react5.useState)(false), [failure, setFailure] = (0, import_react5.useState)(""), [notice, setNotice] = (0, import_react5.useState)("");
  const [replacement, setReplacement] = (0, import_react5.useState)(null);
  const begin = (s, replace = false) => {
    if (!draftAvailable) return;
    if ((draft.dirty || title.trim() || prompt.trim()) && !replace) {
      setReplacement({ schedule: s });
      return;
    }
    setReplacement(null);
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
    setDraft((old) => ({ ...old, dirty: false }));
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
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-ui px-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: "\u5B9A\u65F6\u4EFB\u52A1" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "px-muted", children: [
      "\u5E94\u7528\u8FD0\u884C\u65F6\u5411\u6307\u5B9A\u4F1A\u8BDD\u6295\u9012\uFF0C\u6CBF\u7528\u8BE5\u4F1A\u8BDD\u7684\u6A21\u578B\u4E0E\u6743\u9650\u3002\u5FD9\u788C\u65F6\u8FDB\u5165\u961F\u5217\uFF1B\u9000\u51FA\u671F\u95F4\u4E0D\u6267\u884C\uFF0C\u6062\u590D\u540E\u91CD\u590D\u4EFB\u52A1\u53EA\u8865\u6700\u65B0\u4E00\u6B21\u3002\u65F6\u533A\uFF1A",
      data?.timeZone ?? "\u8BFB\u53D6\u4E2D",
      "\u3002"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "px-primary", disabled: busy || !draftAvailable, onClick: () => begin(null), children: "\u65B0\u5EFA\u5B9A\u65F6\u4EFB\u52A1" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: refresh, children: "\u5237\u65B0\u4EFB\u52A1" })
    ] }),
    draftWarning ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: draftWarning }) : null,
    unreadableDraft ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ConfirmDelete, { label: "\u653E\u5F03\u65E0\u6CD5\u6062\u590D\u7684\u8349\u7A3F", onConfirm: async () => clearDraft() }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(StorageNotice, { visible, onRestored: refresh }),
    !form && (draft.dirty || title.trim() || prompt.trim()) ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => setForm(true), children: "\u7EE7\u7EED\u7F16\u8F91\u8349\u7A3F" }) : null,
    replacement ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "px-card", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u5F53\u524D\u7A97\u53E3\u5DF2\u6709\u5B9A\u65F6\u4EFB\u52A1\u8349\u7A3F\u3002\u8BF7\u5148\u4FDD\u5B58\uFF0C\u6216\u660E\u786E\u653E\u5F03\u540E\u518D\u6253\u5F00\u53E6\u4E00\u9879\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            onClick: () => {
              setReplacement(null);
              setForm(true);
            },
            children: "\u4FDD\u7559\u5F53\u524D\u8349\u7A3F"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => begin(replacement.schedule, true), children: "\u653E\u5F03\u8349\u7A3F\u5E76\u6253\u5F00" })
      ] })
    ] }) : null,
    failure || error ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: failure || error }) : null,
    notice ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", className: "px-feedback", children: notice }) : null,
    form ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("section", { className: "px-card", "aria-label": "\u5B9A\u65F6\u4EFB\u52A1\u7F16\u8F91\u5668", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("fieldset", { disabled: busy || !draftAvailable, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: editing ? "\u7F16\u8F91\u4EFB\u52A1" : "\u65B0\u5EFA\u4EFB\u52A1" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "\u4EFB\u52A1\u540D\u79F0",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "input",
          {
            "aria-label": "\u4EFB\u52A1\u540D\u79F0",
            maxLength: 100,
            value: title,
            onChange: (e) => setTitle(e.target.value)
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "\u76EE\u6807\u4F1A\u8BDD",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
          "select",
          {
            "aria-label": "\u76EE\u6807\u4F1A\u8BDD",
            value: sessionId,
            onChange: (e) => setSessionId(e.target.value),
            children: [
              !sessions.byId[sessionId] ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("option", { value: sessionId, children: [
                sessionId,
                "\uFF08\u6682\u4E0D\u53EF\u7528\uFF09"
              ] }) : null,
              sessions.ids.filter((id) => sessions.byId[id]?.origin !== "subagent").map((id) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: id, children: sessions.byId[id].displayTitle }, id))
            ]
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "\u6267\u884C\u8981\u6C42",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "\u89E6\u53D1\u65B9\u5F0F",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("select", { "aria-label": "\u89E6\u53D1\u65B9\u5F0F", value: kind, onChange: (e) => setKind(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "once", children: "\u6307\u5B9A\u65F6\u95F4\u6267\u884C\u4E00\u6B21" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "interval", children: "\u56FA\u5B9A\u95F4\u9694" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "daily", children: "\u6BCF\u5929" })
        ] })
      ] }),
      kind === "once" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "\u672C\u673A\u65F6\u95F4",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "input",
          {
            "aria-label": "\u672C\u673A\u65F6\u95F4",
            type: "datetime-local",
            value: at,
            onInput: (e) => setAt(e.currentTarget.value),
            onChange: (e) => setAt(e.target.value)
          }
        )
      ] }) : kind === "interval" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "\u95F4\u9694\uFF08\u5206\u949F\uFF09",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "\u6BCF\u65E5\u65F6\u95F4",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "px-check", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "checkbox", checked: enabled, onChange: (e) => setEnabled(e.target.checked) }),
        "\u542F\u7528\u6B64\u4EFB\u52A1"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
              clearDraft();
            }, "\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u4FDD\u5B58"),
            children: "\u4FDD\u5B58\u5B9A\u65F6\u4EFB\u52A1"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy, onClick: () => setForm(false), children: "\u6536\u8D77\u7F16\u8F91\u5668\uFF08\u4FDD\u7559\u8349\u7A3F\uFF09" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          ConfirmDelete,
          {
            label: "\u653E\u5F03\u8349\u7A3F",
            disabled: busy,
            onConfirm: async () => {
              clearDraft();
              setReplacement(null);
            }
          }
        )
      ] })
    ] }) }) : null,
    data?.schedules.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u5C1A\u672A\u914D\u7F6E\u5B9A\u65F6\u4EFB\u52A1\u3002" }) : null,
    data?.schedules.map((s) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("article", { className: "px-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("h4", { children: [
        s.title,
        " \xB7 ",
        s.enabled ? "\u5DF2\u542F\u7528" : "\u5DF2\u6682\u505C"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: s.prompt }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "px-muted", children: [
        "\u4F1A\u8BDD\uFF1A",
        sessions.byId[s.sessionId]?.displayTitle ?? s.sessionId,
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("br", {}),
        timingText(s.timing),
        " \xB7 ",
        s.timeZone,
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("br", {}),
        "\u4E0B\u6B21\uFF1A",
        stamp(s.nextAt)
      ] }),
      s.history[0]?.status === "uncertain" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { role: "alert", children: [
        s.history[0].detail,
        " \u68C0\u67E5\u4F1A\u8BDD\u540E\u518D\u624B\u52A8\u6295\u9012\u6216\u542F\u7528\u3002"
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            disabled: !sessions.byId[s.sessionId],
            onClick: () => ctx.uiWorkspace.openSession(s.sessionId),
            children: "\u6253\u5F00\u4F1A\u8BDD"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy, onClick: () => begin(s), children: "\u7F16\u8F91\u4EFB\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            disabled: busy,
            onClick: () => void action(async () => {
              const result = await post("schedules", { action: "run", id: s.id });
              if (!["queued", "running", "completed"].includes(result.history[0]?.status))
                throw new Error(result.history[0]?.detail ?? "\u6295\u9012\u5C1A\u672A\u786E\u8BA4");
            }, "\u5DF2\u6295\u9012\u5230\u76EE\u6807\u4F1A\u8BDD\uFF1B\u8FD9\u4E0D\u4EE3\u8868 Agent \u5DF2\u5B8C\u6210\u3002"),
            children: "\u7ACB\u5373\u6295\u9012\u4E00\u6B21"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("summary", { children: [
          "\u6700\u8FD1\u89E6\u53D1 \xB7 ",
          s.history.length,
          " \u6B21"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u5DF2\u5165\u961F\u8868\u793A\u4F1A\u8BDD\u5DF2\u63A5\u6536\uFF1B\u8F6E\u6B21\u7ED3\u675F\u4E0D\u4EE3\u8868\u4EFB\u52A1\u5185\u5BB9\u9A8C\u8BC1\u901A\u8FC7\u3002\u8BF7\u6253\u5F00\u76EE\u6807\u4F1A\u8BDD\u6838\u5BF9\u8F93\u51FA\u3002" }),
        s.history.map((h) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
          stamp(h.time),
          " \xB7",
          " ",
          {
            queued: "\u5DF2\u5165\u961F",
            dispatching: "\u6295\u9012\u4E2D",
            uncertain: "\u672A\u786E\u8BA4 / \u5DF2\u6682\u505C",
            running: "\u6267\u884C\u4E2D",
            completed: "\u8F6E\u6B21\u7ED3\u675F",
            failed: "\u6267\u884C\u5931\u8D25",
            cancelled: "\u5DF2\u53D6\u6D88",
            interrupted: "\u6267\u884C\u4E2D\u65AD"
          }[h.status],
          h.turn !== void 0 ? ` \xB7 \u7B2C ${h.turn} \u8F6E` : "",
          h.finishedAt ? ` \xB7 \u7ED3\u675F\u4E8E ${stamp(h.finishedAt)}` : "",
          h.detail ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("small", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("br", {}),
            h.detail
          ] }) : null
        ] }, h.requestId))
      ] })
    ] }, s.id))
  ] });
}

// packages/dsh-px-schedules/src/client.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function apply(raw) {
  const ctx = createWorkspaceClient(raw);
  ctx.inject(["sidebarRight", "sidebarRightTabs"], (host) => {
    if (typeof host.sidebarRightTabs.entries !== "function") return;
    const sidebar = createNativeSidebar(host);
    host.effect(
      () => sidebar.registerTab({
        id: "px-schedules",
        title: "\u5B9A\u65F6\u4EFB\u52A1",
        order: 16,
        component: (p) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(SchedulesPanel, { ...p, ctx }, p.scope.sessionId)
      }),
      "dsh-px-schedules: panel"
    );
  });
}

		return module.exports;
	}
});
