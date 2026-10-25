window.__ModuleLoader__.load({
	id: "dsh-px-memory",
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

// packages/dsh-px-memory/src/client.tsx
var client_exports = {};
__export(client_exports, {
  MemoryPanel: () => MemoryPanel,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react7 = require("react");

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

// packages/shared/ui.tsx
var import_react = require("react");

// packages/shared/owned-style.ts
function installOwnedStyle(ctx, key, css) {
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error("Invalid PX stylesheet key");
  ctx.effect?.(() => {
    const style = document.querySelector(`style[data-dsh-px-style="${key}"]`) ?? document.createElement("style");
    style.dataset.dshPxStyle = key;
    style.setAttribute("data-plugin", `dsh-px-effect:${key}`);
    style.textContent = css;
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
var controlStyle = {
  borderRadius: 8,
  padding: "5px 11px",
  minHeight: 32,
  color: "inherit",
  cursor: "pointer",
  fontSize: 13
};
var cardStyle = { border: "1px solid var(--px-border)", borderRadius: 10, padding: 14, minWidth: 0 };

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

// packages/dsh-px-memory/src/history-panel.tsx
var import_react2 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
var kinds = {
  user: "\u7528\u6237\u539F\u8BDD",
  assistant: "\u52A9\u624B\u5386\u53F2\u56DE\u7B54",
  "assistant-interrupted": "\u52A9\u624B\u4E2D\u65AD\u8F93\u51FA\uFF08\u672A\u5B8C\u6210\uFF09",
  "tool-call": "\u5DE5\u5177\u8C03\u7528",
  "tool-result": "\u5DE5\u5177\u8FD4\u56DE",
  ledger: "\u5DE5\u4F5C\u8D26\u672C\uFF0F\u68C0\u89C6\u6458\u8981\uFF08\u542B\u6A21\u578B\u8BB0\u5F55\uFF09",
  "native-state": "\u539F\u751F\u72B6\u6001\u8BB0\u5F55"
};
function HistoryPanel({
  url,
  visible,
  openSession
}) {
  const [query, setQuery] = (0, import_react2.useState)(""), [projectOnly, setProjectOnly] = (0, import_react2.useState)(true), [busy, setBusy] = (0, import_react2.useState)(false), [error, setError] = (0, import_react2.useState)("");
  const [data, setData] = (0, import_react2.useState)(null), [detail, setDetail] = (0, import_react2.useState)(null), [detailKey, setDetailKey] = (0, import_react2.useState)("");
  const post = async (args) => requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const search = async (targetSessionId) => {
    setBusy(true);
    setError("");
    setDetail(null);
    try {
      setData(
        await post({
          type: "search-history",
          query: targetSessionId ? "" : query,
          projectOnly,
          targetSessionId
        })
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const read = async (row, offset = 0, key) => {
    setBusy(true);
    setError("");
    try {
      const next = await post({ type: "read-history", targetSessionId: row.sessionId, seq: row.seq, offset });
      setDetail(next.result);
      if (key) setDetailKey(key);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  (0, import_react2.useEffect)(() => {
    setData(null);
    setDetail(null);
    setError("");
  }, [url]);
  if (!visible) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "px-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h4", { children: "\u672C\u4EBA\u683C\u7684\u7ECF\u5386\u4E0E\u5386\u53F2" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u6309\u5173\u952E\u8BCD\u627E\u56DE\u4EA4\u6D41\u3001\u6267\u884C\u8BB0\u5F55\u548C\u539F\u751F\u4EFB\u52A1\u72B6\u6001\u3002\u76EE\u5F55\u663E\u793A\u539F\u6587\u6458\u5F55\uFF0C\u4E0D\u628A\u65E7\u56DE\u7B54\u5F53\u6210\u5DF2\u9A8C\u8BC1\u4E8B\u5B9E\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "form",
      {
        onSubmit: (e) => {
          e.preventDefault();
          void search();
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "input",
            {
              "aria-label": "\u641C\u7D22\u4EBA\u683C\u5386\u53F2",
              value: query,
              maxLength: 256,
              placeholder: "\u4F8B\u5982\uFF1A\u66F4\u65B0\u5931\u8D25\uFF0C\u6216\u591A\u4E2A\u5173\u952E\u8BCD\u7528\u7A7A\u683C\u5206\u9694",
              onChange: (e) => setQuery(e.target.value),
              disabled: busy
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "input",
              {
                type: "checkbox",
                checked: projectOnly,
                onChange: (e) => setProjectOnly(e.target.checked),
                disabled: busy
              }
            ),
            "\u4EC5\u672C\u9879\u76EE"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { disabled: busy, type: "submit", children: busy ? "\u6B63\u5728\u67E5\u8BE2\u2026" : query.trim() ? "\u641C\u7D22\u5386\u53F2" : "\u67E5\u770B\u7ECF\u5386\u76EE\u5F55" })
        ]
      }
    ),
    error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "alert", children: error }),
    data?.coverage && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "px-muted", children: [
      "\u5DF2\u7D22\u5F15 ",
      data.coverage.indexedSessions,
      " / ",
      data.coverage.totalSessions,
      " \u4E2A\u53EF\u8BFB\u4F1A\u8BDD\u3002",
      data.coverage.partial ? "\u4ECD\u6709\u672A\u5B8C\u6210\u6216\u4E0D\u53EF\u8BFB\u8BB0\u5F55\uFF1B\u518D\u6B21\u67E5\u8BE2\u4F1A\u7EE7\u7EED\u7D22\u5F15\u3002" : "\u672C\u6B21\u7D22\u5F15\u5DF2\u5B8C\u6210\u3002"
    ] }),
    data?.coverage?.errors?.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", children: "\u90E8\u5206\u539F\u59CB\u4F1A\u8BDD\u4E0D\u53EF\u8BFB\uFF0C\u7ED3\u679C\u53EF\u80FD\u4E0D\u5B8C\u6574\u3002" }),
    data && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "px-muted", children: "\u76EE\u5F55\u6700\u591A\u663E\u793A\u6700\u8FD1 100 \u4E2A\u4F1A\u8BDD\uFF0C\u5173\u952E\u8BCD\u68C0\u7D22\u6BCF\u6B21\u6700\u591A 20 \u6761\u8BB0\u5F55\u3002\u7ED3\u679C\u662F\u5386\u53F2\u7247\u6BB5\uFF0C\u4E0D\u4EE3\u8868\u5F53\u524D\u4ECD\u7136\u6709\u6548\u3002" }),
    data?.result?.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u672A\u627E\u5230\u5339\u914D\u5185\u5BB9\u3002\u53EF\u6362\u5173\u952E\u8BCD\u6216\u53D6\u6D88\u201C\u4EC5\u672C\u9879\u76EE\u201D\uFF1B\u4E0D\u4F1A\u641C\u7D22\u5176\u4ED6\u4EBA\u683C\u7684\u79C1\u6709\u5E93\u3002" }),
    data?.result?.map((row) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("article", { className: "px-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { title: row.title, children: row.title?.length > 80 ? row.title.slice(0, 80) + "\u2026" : row.title || "\u5386\u53F2\u4F1A\u8BDD" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "px-muted", children: [
        row.kind ? kinds[row.kind] ?? row.kind : "\u4F1A\u8BDD\u539F\u6587\u76EE\u5F55",
        " \xB7",
        " ",
        new Date(row.time ?? row.lastEventAt ?? 0).toLocaleString(),
        row.seq !== void 0 ? ` \xB7 \u4E8B\u4EF6 ${row.seq}` : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { style: { whiteSpace: "pre-wrap" }, children: [
        String(row.snippet ?? row.lastReply ?? "\u6682\u65E0\u52A9\u624B\u56DE\u590D").slice(0, 240),
        String(row.snippet ?? row.lastReply ?? "").length > 240 ? "\u2026" : ""
      ] }),
      row.lastState && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u6700\u8FD1\u72B6\u6001\u8BB0\u5F55\uFF08\u5386\u53F2\uFF09" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { style: { whiteSpace: "pre-wrap" }, children: row.lastState })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            disabled: busy,
            onClick: () => row.seq === void 0 ? void search(row.sessionId) : void read(row, row.readOffset ?? 0, `${row.sessionId}:${row.seq}:${row.part ?? 0}`),
            children: row.seq === void 0 ? "\u67E5\u770B\u6700\u8FD1\u8BB0\u5F55" : "\u8BFB\u53D6\u539F\u6587"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { disabled: busy, onClick: () => openSession(row.sessionId), children: "\u6253\u5F00\u539F\u4F1A\u8BDD" })
      ] }),
      detail && detailKey === `${row.sessionId}:${row.seq}:${row.part ?? 0}` && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "px-card", "aria-label": "\u5386\u53F2\u539F\u6587", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("strong", { children: [
          kinds[detail.kind] ?? detail.kind,
          " \xB7 \u4E8B\u4EF6 ",
          detail.seq
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "px-muted", children: [
          "\u539F\u751F\u4F1A\u8BDD ",
          detail.sessionId,
          " \xB7 \u5386\u53F2\u5185\u5BB9"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { style: { whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto" }, children: detail.text }),
        detail.nextOffset !== null && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { disabled: busy, onClick: () => void read(detail, detail.nextOffset), children: "\u4E0B\u4E00\u6BB5\u539F\u6587" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { onClick: () => setDetail(null), children: "\u6536\u8D77\u539F\u6587" })
      ] })
    ] }, `${row.sessionId}:${row.seq ?? "session"}:${row.part ?? 0}`))
  ] });
}

// packages/dsh-px-memory/src/knowledge-panel.tsx
var import_react4 = require("react");

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
  const cells = /* @__PURE__ */ new Map();
  const trim = (reserve = 0) => {
    for (const [key, cell] of cells) {
      if (cells.size + reserve <= limit) break;
      if (cell.subscribers() === 0 && canEvict(key) && (cell.canReleaseMemory() || cell.isEmpty()))
        cells.delete(key);
    }
  };
  return {
    acquire(key, initial, storage, validate) {
      const existing = cells.get(key);
      if (existing) {
        cells.delete(key);
        cells.set(key, existing);
        return existing;
      }
      trim(1);
      if (cells.size >= limit) return null;
      const cell = createDraftCell(key, initial, storage, validate);
      cells.set(key, cell);
      return cell;
    },
    size: () => cells.size,
    release: () => trim()
  };
}

// packages/dsh-px-memory/src/experience-panel.tsx
var import_react3 = require("react");
var import_jsx_runtime4 = require("react/jsx-runtime");
var drafts = createDraftRegistry(64);
var active = (task) => ["starting", "running", "stopping"].includes(task.phase);
var pendingRun = (run) => run.status === "running" && !run.awaitingRecovery;
var hasActivity = (value) => !!(value?.tasks?.some(active) || value?.runs?.some(pendingRun));
var phase = {
  starting: "\u51C6\u5907\u4E2D",
  running: "\u5904\u7406\u4E2D",
  stopping: "\u6B63\u5728\u505C\u6B62",
  completed: "\u5DF2\u5B8C\u6210",
  failed: "\u5931\u8D25",
  killed: "\u5DF2\u505C\u6B62"
};
function ExperiencePanel({
  sessionId,
  personaId,
  project,
  onAdopted
}) {
  const draft = (0, import_react3.useMemo)(() => {
    let storage;
    try {
      storage = sessionStorage;
    } catch {
    }
    return drafts.acquire(
      "px-experience-form:" + sessionId + ":" + personaId,
      { selected: null, body: "" },
      storage,
      (value) => typeof value.body === "string" && value.body.length <= 16e3 && (!value.selected || typeof value.selected.value?.draft?.content === "string")
    );
  }, [sessionId, personaId]);
  const saved = draft?.getSnapshot();
  const [view, setView] = (0, import_react3.useState)(null), [error, setError] = (0, import_react3.useState)(""), [notice, setNotice] = (0, import_react3.useState)(""), [busy, setBusy] = (0, import_react3.useState)(false), [generation, setGeneration] = (0, import_react3.useState)(0), [selected, setSelected] = (0, import_react3.useState)(saved?.selected ?? null), [body, setBody] = (0, import_react3.useState)(saved?.body ?? ""), [share, setShare] = (0, import_react3.useState)(
    saved?.selected?.value?.draft?.baseKey?.startsWith("user-dsh:") ? "global" : "project"
  ), [evidence, setEvidence] = (0, import_react3.useState)(null);
  const lifetime = (0, import_react3.useRef)(null);
  const actionEpoch = (0, import_react3.useRef)(0);
  const editEpoch = (0, import_react3.useRef)(0);
  const latest = (0, import_react3.useRef)({ selected, body, busy });
  latest.current = { selected, body, busy };
  const url = `/dsh-px-memory?sessionId=${encodeURIComponent(sessionId)}`;
  const call = (input, signal) => requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "experience", input }),
    signal
  });
  (0, import_react3.useEffect)(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, [url]);
  (0, import_react3.useEffect)(() => {
    if (!project) return;
    const controller = new AbortController();
    let timer;
    let first = true;
    const refresh = async () => {
      const epoch = actionEpoch.current;
      let again = false;
      let pendingView;
      try {
        const next = await call({ action: "view" }, controller.signal);
        if (controller.signal.aborted || epoch !== actionEpoch.current) return;
        pendingView = next;
        again = hasActivity(next);
        const snapshot = latest.current, edited = editEpoch.current;
        const shouldRefresh = first || snapshot.selected?.revision !== next.revision || snapshot.selected?.value.runs.some((run2) => next.runs.some((current) => current.id === run2.id && (current.status !== run2.status || current.awaitingRecovery !== run2.awaitingRecovery)));
        first = false;
        if (snapshot.selected && !snapshot.busy && snapshot.body === snapshot.selected.value.draft.content && shouldRefresh) {
          const detail = await call({ action: "read", kind: "draft", id: snapshot.selected.value.draft.id }, controller.signal);
          if (controller.signal.aborted || epoch !== actionEpoch.current || edited !== editEpoch.current || latest.current.selected !== snapshot.selected || latest.current.body !== snapshot.body || latest.current.busy) return;
          if (detail.value.draft.status !== "ready") {
            setSelected(null);
            setBody("");
            setNotice("\u6B64\u8349\u7A3F\u5DF2\u88AB\u5904\u7406\uFF0C\u5217\u8868\u5DF2\u5237\u65B0\u3002");
          } else {
            setSelected(detail);
            setBody(detail.value.draft.content);
            if (detail.value.draft.content !== snapshot.body) setNotice("\u8349\u7A3F\u5DF2\u6709\u65B0\u7248\u672C\uFF0C\u8BF7\u91CD\u65B0\u5BA1\u9605\u5185\u5BB9\u3002");
          }
        }
      } catch (error2) {
        if (!controller.signal.aborted) setError(String(error2.message));
      } finally {
        if (!controller.signal.aborted && epoch === actionEpoch.current) {
          if (pendingView) setView(pendingView);
          if (again) timer = setTimeout(() => void refresh(), 1e3);
        }
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [url, project, generation]);
  const dirty = !!selected && body !== selected.value.draft.content;
  (0, import_react3.useEffect)(() => {
    if (dirty)
      draft?.set({
        selected: { revision: selected.revision, value: { draft: selected.value.draft, runs: [] } },
        body
      });
    else draft?.clear();
  }, [draft, dirty, selected, body]);
  const working = hasActivity(view);
  const disabled = busy || working || dirty || !view;
  const run = async (action) => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    actionEpoch.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action(signal);
    } catch (error2) {
      if (!signal.aborted) setError(String(error2.message));
    } finally {
      if (!signal.aborted) {
        actionEpoch.current++;
        setBusy(false);
        setGeneration((value) => value + 1);
      }
    }
  };
  const start = (action, id) => void run(async (signal) => {
    const requestId = crypto.randomUUID();
    const admitted = await call({ action, id, requestId }, signal);
    if (signal.aborted) return;
    actionEpoch.current++;
    setView((current) => current && { ...current, tasks: [{
      requestId,
      jobId: admitted.jobId,
      phase: "starting",
      startedAt: Date.now(),
      progress: action === "review" ? "\u6574\u7406\u5DE5\u4F5C\u7ECF\u5386" : action === "draft" ? "\u751F\u6210 Skill \u8349\u7A3F" : "\u6A21\u62DF\u56DE\u6D4B Skill \u8349\u7A3F"
    }, ...current.tasks.filter((task) => task.requestId !== requestId)] });
    setSelected(null);
    setEvidence(null);
    setNotice("\u5DF2\u5F00\u59CB\u540E\u53F0\u5904\u7406\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u5BF9\u8BDD\u3002");
  });
  const readDraft = (id) => void run(async (signal) => {
    const next = await call({ action: "read", kind: "draft", id }, signal);
    if (signal.aborted) return;
    setSelected(next);
    setBody(next.value.draft.content);
    setShare(next.value.draft.baseKey?.startsWith("user-dsh:") ? "global" : "project");
    setEvidence(null);
  });
  if (!project) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u9009\u62E9\u9879\u76EE\u540E\uFF0C\u53EF\u5C06\u5DE5\u4F5C\u7ECF\u5386\u6574\u7406\u4E3A Skill\u3002" });
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { style: cardStyle, "aria-label": "\u4ECE\u7ECF\u5386\u6539\u8FDB Skills", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: "\u4ECE\u7ECF\u5386\u6539\u8FDB Skills" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { style: controlStyle, disabled, onClick: () => start("review"), children: "\u6574\u7406\u672C\u6B21\u7ECF\u5386" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "button",
        {
          style: controlStyle,
          disabled: busy || dirty,
          onClick: () => {
            actionEpoch.current++;
            setError("");
            setGeneration((value) => value + 1);
          },
          children: "\u5237\u65B0"
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u4ECE\u5DF2\u7ED3\u675F\u7684\u8F6E\u6B21\u63D0\u70BC\u65B9\u6CD5\uFF0C\u5019\u9009\u4EC5\u6B64\u4EBA\u683C\u5728\u672C\u9879\u76EE\u53EF\u89C1\u3002\u4F7F\u7528\u6765\u6E90\u6A21\u578B\u7684\u8F83\u4F4E\u63A8\u7406\u6863\uFF08\u82E5\u652F\u6301\uFF09\uFF1B\u7531\u4F60\u91C7\u7EB3\u540E\u624D\u5199\u5165\u5171\u4EAB Skill\u3002" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", children: notice }),
    (working ? view?.tasks?.filter(active) : view?.tasks?.slice(0, 1))?.map((task) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { role: "status", children: [
      phase[task.phase] ?? task.phase,
      " \xB7 ",
      task.progress,
      task.error && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: task.error }),
      active(task) && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "button",
        {
          style: controlStyle,
          disabled: busy || task.phase === "stopping",
          onClick: () => void run(async (signal) => {
            await call({ action: "cancel", requestId: task.requestId }, signal);
          }),
          children: "\u505C\u6B62"
        }
      )
    ] }, task.requestId)),
    working && !view?.tasks?.some(active) && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", children: "\u672C\u9879\u76EE\u6709\u56DE\u6D4B\u6B63\u5728\u5904\u7406\uFF0C\u7ED3\u679C\u4F1A\u81EA\u52A8\u5237\u65B0\u3002" }),
    view && !working && !view.suggestions.length && !view.drafts.length && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u8FD8\u6CA1\u6709\u5F85\u5904\u7406\u5EFA\u8BAE\u3002\u5B8C\u6210\u4E00\u9879\u5DE5\u4F5C\u540E\uFF0C\u70B9\u51FB\u201C\u6574\u7406\u672C\u6B21\u7ECF\u5386\u201D\u3002" }),
    view?.suggestions.filter((s) => !view.drafts.some((d) => d.suggestionId === s.id)).map((suggestion) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: cardStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: suggestion.skillName }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: suggestion.summary }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { style: controlStyle, disabled, onClick: () => start("draft", suggestion.id), children: "\u751F\u6210\u8349\u7A3F" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            style: controlStyle,
            disabled: busy || dirty,
            onClick: () => void run(async (signal) => {
              const detail = await call(
                { action: "read", kind: "suggestion", id: suggestion.id },
                signal
              );
              const references = await Promise.all(
                detail.value.suggestion.evidence.slice(0, 3).map(async (ref) => {
                  const result = await call(
                    { action: "read", kind: "trajectory", id: ref.trajectoryId },
                    signal
                  );
                  return result.value.steps.filter((step) => ref.steps.includes(step.index));
                })
              );
              if (!signal.aborted)
                setEvidence({ summary: suggestion.rationale, steps: references.flat() });
            }),
            children: "\u67E5\u770B\u4F9D\u636E"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            style: controlStyle,
            disabled,
            onClick: () => void run(async (signal) => {
              await call({ action: "dismiss", id: suggestion.id, revision: view.revision }, signal);
            }),
            children: "\u5FFD\u7565"
          }
        )
      ] })
    ] }, suggestion.id)),
    evidence && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { open: true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("summary", { children: "\u5EFA\u8BAE\u4F9D\u636E" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: evidence.summary }),
      evidence.steps.map((step, index) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("pre", { style: { whiteSpace: "pre-wrap" }, children: step.text }, index))
    ] }),
    view?.drafts.map((draft2) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "button",
      {
        style: { ...controlStyle, margin: "6px 6px 6px 0" },
        disabled: busy || dirty,
        onClick: () => readDraft(draft2.id),
        children: [
          draft2.skillName,
          " \xB7 \u5BA1\u9605\u8349\u7A3F"
        ]
      },
      draft2.id
    )),
    selected && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { marginTop: 12 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: selected.value.draft.skillName }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: selected.value.draft.notes }),
      selected.value.base && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("summary", { children: "\u5BF9\u7167\u73B0\u6709 Skill" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("pre", { style: { whiteSpace: "pre-wrap" }, children: selected.value.base.content })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "\u5F85\u91C7\u7EB3\u5185\u5BB9",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "textarea",
          {
            "aria-label": "Skill \u8349\u7A3F\u5185\u5BB9",
            style: { ...controlStyle, display: "block", width: "100%", minHeight: 200 },
            maxLength: 16e3,
            value: body,
            disabled: busy || working || !draft,
            onChange: (event) => {
              editEpoch.current++;
              setBody(event.target.value);
            }
          }
        )
      ] }),
      dirty && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u6709\u672A\u4FDD\u5B58\u4FEE\u6539\uFF0C\u4FDD\u7559\u5728\u5F53\u524D\u7A97\u53E3\u3002\u4FDD\u5B58\u540E\u518D\u56DE\u6D4B\u6216\u91C7\u7EB3\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            style: controlStyle,
            disabled: busy || working || !dirty,
            onClick: () => void run(async (signal) => {
              await call(
                {
                  action: "edit",
                  id: selected.value.draft.id,
                  revision: selected.revision,
                  content: body
                },
                signal
              );
              const next = await call(
                { action: "read", kind: "draft", id: selected.value.draft.id },
                signal
              );
              if (!signal.aborted) {
                setSelected(next);
                setBody(next.value.draft.content);
              }
            }),
            children: "\u4FDD\u5B58\u8349\u7A3F"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            style: controlStyle,
            disabled,
            onClick: () => start("backtest", selected.value.draft.id),
            children: "\u6A21\u62DF\u56DE\u6D4B"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            style: controlStyle,
            disabled: busy || working || !dirty,
            onClick: () => {
              editEpoch.current++;
              setBody(selected.value.draft.content);
            },
            children: "\u64A4\u9500\u672C\u6B21\u7F16\u8F91"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u6A21\u62DF\u56DE\u6D4B\u5BF9\u7167\u73B0\u884C\u65B9\u6CD5\u4E0E\u8349\u7A3F\u7684\u65B9\u6848\u548C\u9884\u671F\u7B54\u6848\uFF0C\u6700\u591A\u4E24\u9053\u7528\u4F8B\uFF0C\u4F18\u5148\u4F7F\u7528\u975E\u63A8\u7406\u6863\u3002\u5B83\u4E0D\u6267\u884C\u771F\u5B9E\u5DE5\u5177\uFF0C\u8BC4\u5206\u4E0D\u4EE3\u8868\u5B9E\u9645\u4EFB\u52A1\u5DF2\u901A\u8FC7\u3002" }),
      selected.value.runs.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { open: true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("summary", { children: "\u56DE\u6D4B\u7ED3\u679C" }),
        selected.value.runs.map((result) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: cardStyle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("strong", { children: [
            result.target.kind === "draft" ? "\u8349\u7A3F" : "\u73B0\u884C\u65B9\u6CD5",
            " \xB7",
            " ",
            result.awaitingRecovery ? "\u4E0A\u6B21\u8FD0\u884C\u672A\u7ED3\u7B97" : result.status === "completed" ? "\u6A21\u62DF\u5B8C\u6210" : result.status === "running" ? "\u8FDB\u884C\u4E2D" : "\u672A\u5B8C\u6210"
          ] }),
          result.awaitingRecovery && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", children: "\u8FD9\u6761\u8BB0\u5F55\u6765\u81EA\u4E0A\u6B21\u670D\u52A1\uFF0C\u5F53\u524D\u6CA1\u6709\u5BF9\u5E94\u7684\u7ECF\u9A8C\u4EFB\u52A1\uFF1B\u5DF2\u6709\u7ED3\u679C\u4FDD\u7559\uFF0C\u4E0D\u8BA1\u4E3A\u56DE\u6D4B\u5B8C\u6210\u3002" }),
          (!result.matchesCurrentContent || dirty && result.target.kind === "draft") && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", children: "\u65E7\u7248\u672C\u7ED3\u679C\uFF1A\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u9700\u8981\u91CD\u65B0\u56DE\u6D4B\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
            result.progress.done,
            " / ",
            result.progress.total,
            " \u7528\u4F8B",
            typeof result.passRate === "number" ? ` \xB7 \u65B9\u6848\u68C0\u67E5\u901A\u8FC7\u7387 ${Math.round(result.passRate * 100)}%` : ""
          ] }),
          result.results.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("summary", { children: [
              entry.title,
              " \xB7 ",
              entry.verdict === "pass" ? "\u6A21\u62DF\u901A\u8FC7" : "\u672A\u901A\u8FC7"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: entry.answer }),
            entry.checks.map((check) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
              check.pass ? "\u901A\u8FC7" : "\u672A\u901A\u8FC7",
              "\uFF1A",
              check.note
            ] }, check.checkId))
          ] }, entry.caseId)),
          result.error && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: result.error })
        ] }, result.id))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: cardStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
          "\u91C7\u7EB3\u5230",
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
            "select",
            {
              "aria-label": "Skill \u5171\u4EAB\u8303\u56F4",
              style: controlStyle,
              value: share,
              disabled: disabled || selected.value.draft.action === "update",
              onChange: (event) => setShare(event.target.value),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "project", children: "\u672C\u9879\u76EE\u6240\u6709\u4EBA\u683C" }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "global", children: "\u5168\u90E8\u4EBA\u683C\u4E0E\u9879\u76EE" })
              ]
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u91C7\u7EB3\u4F1A\u5199\u5165\u4E0A\u8FF0\u5171\u4EAB\u8303\u56F4\u7684 SKILL.md\uFF0C\u5E76\u53EF\u4F9B\u6A21\u578B\u8C03\u7528\u3002\u8BF7\u5148\u5BA1\u9605\u5185\u5BB9\uFF1B\u5019\u9009\u4E0E\u539F\u59CB\u7ECF\u5386\u4ECD\u4FDD\u7559\u5728\u6B64\u4EBA\u683C\u4E0B\u3002" }),
        selected.value.draft.action === "update" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "px-muted", children: "\u66F4\u65B0\u5DF2\u6709 Skill \u65F6\u4FDD\u7559\u539F\u6587\u4EF6\u4E0E\u5171\u4EAB\u8303\u56F4\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "px-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "button",
            {
              style: controlStyle,
              disabled,
              onClick: () => void run(async (signal) => {
                const result = await call(
                  { action: "adopt", id: selected.value.draft.id, revision: selected.revision, share },
                  signal
                );
                if (signal.aborted) return;
                setSelected(null);
                setNotice(
                  result.discovery === "ready" ? "\u5DF2\u91C7\u7EB3\uFF0C\u539F\u751F Skills \u5DF2\u53D1\u73B0\u65B0\u5185\u5BB9\u3002" : "\u5DF2\u5199\u5165\u5171\u4EAB Skill\uFF0C\u539F\u751F\u5217\u8868\u5C1A\u672A\u786E\u8BA4\u66F4\u65B0\uFF0C\u8BF7\u7A0D\u540E\u5237\u65B0\u3002"
                );
                await onAdopted();
              }),
              children: "\u91C7\u7EB3\u4E3A\u5171\u4EAB Skill"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "button",
            {
              style: controlStyle,
              disabled,
              onClick: () => void run(async (signal) => {
                await call(
                  { action: "discard", id: selected.value.draft.id, revision: selected.revision },
                  signal
                );
                if (!signal.aborted) setSelected(null);
              }),
              children: "\u653E\u5F03\u8349\u7A3F"
            }
          )
        ] })
      ] })
    ] })
  ] });
}

// packages/dsh-px-memory/src/knowledge-panel.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var drafts2 = createDraftRegistry(64);
var newest = (rows) => [...rows].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
var scopes = [
  ["persona", "\u4EC5\u6B64\u4EBA\u683C"],
  ["persona-project", "\u6B64\u4EBA\u683C\u5728\u672C\u9879\u76EE"],
  ["project", "\u672C\u9879\u76EE\u6240\u6709\u4EBA\u683C"],
  ["global", "\u5168\u90E8\u4EBA\u683C\u4E0E\u9879\u76EE"]
];
function KnowledgePanel({
  sessionId,
  personaId,
  project
}) {
  const initial = {
    editing: false,
    scope: project ? "project" : "persona",
    tab: "knowledge",
    key: "",
    body: "",
    paths: "",
    revision: "",
    selected: null,
    skill: null,
    skillDirectories: null,
    skillName: "",
    skillDescription: "",
    skillEnabled: false,
    skillScope: project ? "project" : "global"
  };
  const draft = (0, import_react4.useMemo)(() => {
    let storage;
    try {
      storage = sessionStorage;
    } catch {
    }
    return drafts2.acquire(
      "px-knowledge-form:" + sessionId + ":" + personaId,
      initial,
      storage,
      (v) => v.body.length <= 64e3 && scopes.some((s) => s[0] === v.scope) && ["knowledge", "skills"].includes(v.tab)
    );
  }, [sessionId, personaId]);
  const saved = draft?.getSnapshot() ?? initial;
  const [scope, setScope] = (0, import_react4.useState)(saved.scope), [catalog, setCatalog] = (0, import_react4.useState)(null), [selected, setSelected] = (0, import_react4.useState)(saved.selected);
  const [query, setQuery] = (0, import_react4.useState)(""), [rows, setRows] = (0, import_react4.useState)([]), [error, setError] = (0, import_react4.useState)(""), [notice, setNotice] = (0, import_react4.useState)(""), [busy, setBusy] = (0, import_react4.useState)(false);
  const [editing, setEditing] = (0, import_react4.useState)(saved.editing), [key, setKey] = (0, import_react4.useState)(saved.key), [body, setBody] = (0, import_react4.useState)(saved.body), [paths, setPaths] = (0, import_react4.useState)(saved.paths), [editRevision, setEditRevision] = (0, import_react4.useState)(saved.revision), [destination, setDestination] = (0, import_react4.useState)("project");
  const [tab, setTab] = (0, import_react4.useState)(saved.tab), [skillDirectories, setSkillDirectories] = (0, import_react4.useState)(saved.skillDirectories), [skills, setSkills] = (0, import_react4.useState)([]), [skill, setSkill] = (0, import_react4.useState)(saved.skill), [skillName, setSkillName] = (0, import_react4.useState)(saved.skillName), [skillDescription, setSkillDescription] = (0, import_react4.useState)(saved.skillDescription), [skillEnabled, setSkillEnabled] = (0, import_react4.useState)(saved.skillEnabled), [skillScope, setSkillScope] = (0, import_react4.useState)(saved.skillScope);
  (0, import_react4.useEffect)(() => {
    if (!draft) return;
    if (!editing) {
      draft.clear();
      return;
    }
    draft.set({
      editing,
      scope,
      tab,
      key,
      body,
      paths,
      revision: editRevision,
      selected: selected ? { ...selected, body: void 0 } : null,
      skill: skill ? { ...skill, skill: { ...skill.skill, content: void 0 } } : null,
      skillName,
      skillDescription,
      skillEnabled,
      skillScope,
      skillDirectories
    });
  }, [
    draft,
    editing,
    scope,
    tab,
    key,
    body,
    paths,
    editRevision,
    selected,
    skill,
    skillName,
    skillDescription,
    skillEnabled,
    skillScope,
    skillDirectories
  ]);
  const url = `/dsh-px-memory?sessionId=${encodeURIComponent(sessionId)}`;
  const call = (type, input, signal) => requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, input }),
    signal
  });
  (0, import_react4.useEffect)(() => {
    const ac = new AbortController();
    setCatalog(null);
    setRows([]);
    if (!draft?.getSnapshot().editing) {
      setSelected(null);
      setEditing(false);
    }
    setError("");
    void call("knowledge", { action: "catalog", scope }, ac.signal).then((v) => {
      if (!ac.signal.aborted) {
        setCatalog(v);
        setRows(newest(v.documents));
      }
    }).catch((e) => {
      if (!ac.signal.aborted) setError(String(e.message));
    });
    return () => ac.abort();
  }, [url, scope]);
  const run = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e.message));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const next = await call("knowledge", { action: "catalog", scope });
    setCatalog(next);
    setRows(newest(next.documents));
    setSelected(null);
  };
  const read = async (id, historical = false) => {
    const next = await call("knowledge", { action: "read", scope, id, historical });
    setSelected(next.document);
    setCatalog((old) => ({ ...old, revision: next.revision }));
    setEditing(false);
  };
  const edit = (item) => {
    if (!draft) {
      setError("\u5F53\u524D\u7A97\u53E3\u8349\u7A3F\u8FC7\u591A\uFF0C\u8BF7\u5148\u4FDD\u5B58\u6216\u53D6\u6D88\u5176\u4ED6\u8349\u7A3F\u3002");
      return;
    }
    setSelected(item);
    setKey(item?.key ?? "");
    setBody(item?.body ?? "");
    setPaths(item?.sources?.map((s) => s.path).join("\n") ?? "");
    setEditRevision(catalog.revision);
    setEditing(true);
  };
  const readSkill = async (name) => {
    const v = await call("skills", { action: "read", name });
    setSkill(v);
    setSkillDirectories(v.directories);
    setSkillName(v.skill.name);
    setSkillDescription(v.skill.description);
    setBody(v.skill.content);
    setSkillEnabled(v.skill.invocation?.modelInvocable === true);
    setSkillScope(v.skill.source === "user-dsh" ? "global" : "project");
    setEditing(false);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "px-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { style: controlStyle, disabled: busy || editing, onClick: () => setTab("knowledge"), children: "\u77E5\u8BC6" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          style: controlStyle,
          disabled: busy || editing,
          onClick: () => void run(async () => {
            setTab("skills");
            const value = await call("skills", { action: "list" });
            setSkills(value.skills);
            setSkillDirectories(value.directories);
          }),
          children: "Skills"
        }
      )
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "alert", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "status", children: notice }),
    editing && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "status", className: "px-muted", children: "\u7F16\u8F91\u8349\u7A3F\u4FDD\u7559\u5728\u5F53\u524D\u7A97\u53E3\u3002\u8FD4\u56DE\u6216\u5207\u6362\u4F1A\u8BDD\u4E0D\u4F1A\u81EA\u52A8\u63D0\u4EA4\uFF1B\u4FDD\u5B58\u4ECD\u68C0\u67E5\u539F\u7248\u672C\uFF0C\u907F\u514D\u8986\u76D6\u540E\u6765\u4FEE\u6539\u3002" }),
    tab === "knowledge" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "px-muted", children: "\u540C\u4E00\u4E3B\u9898\u53EA\u7EF4\u62A4\u4E00\u4EFD\u73B0\u884C\u7ED3\u8BBA\u3002\u7EA0\u6B63\u65F6\u7F16\u8F91\u539F\u6761\u76EE\uFF1B\u4E34\u65F6\u4EFB\u52A1\u8FDB\u5EA6\u653E\u5728\u5DE5\u4F5C\u8D26\u672C\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
        "\u8C01\u53EF\u4EE5\u4F7F\u7528\uFF1F",
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "select",
          {
            "aria-label": "\u77E5\u8BC6\u8303\u56F4",
            style: { ...controlStyle, width: "100%" },
            value: scope,
            disabled: busy || editing,
            onChange: (e) => {
              setScope(e.target.value);
              setQuery("");
            },
            children: scopes.map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
              "option",
              {
                value: id,
                disabled: !project && (id === "project" || id === "persona-project"),
                children: label
              },
              id
            ))
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "px-muted", children: scope === "global" ? "\u6240\u6709\u4EBA\u683C\u3001\u6240\u6709\u9879\u76EE\u53EF\u7528\u3002" : scope === "project" ? "\u672C\u9879\u76EE\u7684\u6240\u6709\u4EBA\u683C\u53EF\u7528\u3002" : scope === "persona-project" ? "\u4EC5\u5F53\u524D\u4EBA\u683C\u5728\u672C\u9879\u76EE\u53EF\u7528\u3002" : "\u4EC5\u5F53\u524D\u4EBA\u683C\u53EF\u7528\uFF0C\u53EF\u8DE8\u9879\u76EE\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "input",
          {
            "aria-label": "\u641C\u7D22\u77E5\u8BC6",
            style: controlStyle,
            value: query,
            disabled: busy || editing,
            onChange: (e) => setQuery(e.target.value),
            placeholder: "\u641C\u7D22\u73B0\u884C\u77E5\u8BC6"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "button",
          {
            style: controlStyle,
            disabled: busy || editing || !catalog,
            onClick: () => void run(async () => {
              if (!query.trim()) return refresh();
              const v = await call("knowledge", { action: "search", scope, query });
              setRows(v.results);
              setCatalog((old) => ({ ...old, revision: v.revision }));
              setSelected(null);
            }),
            children: "\u641C\u7D22"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { style: controlStyle, disabled: busy || editing, onClick: () => void run(refresh), children: "\u5168\u90E8" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { style: controlStyle, disabled: busy || editing || !catalog, onClick: () => edit(null), children: "\u65B0\u589E" })
      ] }),
      !catalog && !error && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u77E5\u8BC6\u8303\u56F4\u2026" }),
      catalog && !rows.length && !editing && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "px-muted", children: "\u6682\u65E0\u5339\u914D\u77E5\u8BC6\u3002\u65B0\u5EFA\u6761\u76EE\u6216\u6362\u4E2A\u5173\u952E\u8BCD\u3002" }),
      !editing && rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
        "button",
        {
          style: {
            ...controlStyle,
            width: "100%",
            justifyContent: "flex-start",
            textAlign: "left",
            marginTop: 6
          },
          disabled: busy,
          onClick: () => void run(() => read(row.id)),
          children: [
            row.key,
            " ",
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("small", { children: [
              "\xB7 v",
              row.revision,
              row.updatedAt ? " \xB7 " + new Date(row.updatedAt).toLocaleDateString() : "",
              row.status === "archived" ? " \xB7 \u5DF2\u5F52\u6863" : ""
            ] })
          ]
        },
        row.id
      )),
      selected && !editing && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { ...cardStyle, marginTop: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("strong", { children: [
          selected.key,
          " \xB7 v",
          selected.revision
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { className: "px-muted", children: [
          selected.author?.kind === "human" ? "\u7528\u6237\u7F16\u5199 / \u7EA0\u6B63" : selected.author?.kind === "model" ? "\u6A21\u578B\u6574\u7406" : "\u4F5C\u8005\u672A\u6807\u6CE8",
          "\uFF1B\u6587\u4EF6\u5F15\u7528\u53EA\u6838\u5BF9\u7248\u672C\u662F\u5426\u53D8\u5316\uFF0C\u4E0D\u4EE3\u8868\u6B63\u6587\u5DF2\u88AB\u9010\u6761\u8BC1\u5B9E\u3002"
        ] }),
        !selected.current && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "status", children: "\u8FD9\u6761\u77E5\u8BC6\u5DF2\u8FC7\u65F6\u3001\u5DF2\u5F52\u6863\u6216\u6765\u6E90\u65E0\u6CD5\u9A8C\u8BC1\uFF0C\u4E0D\u4F5C\u4E3A\u5F53\u524D\u7ED3\u8BBA\u4F7F\u7528\u3002" }),
        selected.body !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { style: { whiteSpace: "pre-wrap", fontFamily: "inherit" }, children: selected.body }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => void run(() => read(selected.id, true)), children: "\u67E5\u770B\u5386\u53F2\u6B63\u6587" }),
        selected.sources?.map((s) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { className: "px-muted", children: [
          s.path,
          " \xB7",
          " ",
          s.state === "current" ? "\u7248\u672C\u4E00\u81F4" : s.state === "changed" ? "\u6587\u4EF6\u5DF2\u53D8\u5316" : s.state === "missing" ? "\u6587\u4EF6\u4E0D\u5B58\u5728" : "\u6682\u4E0D\u53EF\u9A8C\u8BC1"
        ] }, s.path)),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "px-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              disabled: busy || selected.status !== "active" || selected.body === void 0,
              onClick: () => edit(selected),
              children: "\u7F16\u8F91 / \u7EA0\u6B63"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              disabled: busy || selected.status !== "active",
              onClick: () => void run(async () => {
                if (!confirm("\u5F52\u6863\u540E\u4E0D\u4F1A\u4F5C\u4E3A\u5F53\u524D\u77E5\u8BC6\u8FD4\u56DE\u3002\u7EE7\u7EED\u5417\uFF1F")) return;
                await call("knowledge", {
                  action: "archive",
                  scope,
                  id: selected.id,
                  revision: catalog.revision,
                  documentRevision: selected.revision
                });
                await refresh();
              }),
              children: "\u5F52\u6863"
            }
          )
        ] }),
        selected.current && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "px-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "select",
            {
              "aria-label": "\u5206\u4EAB\u76EE\u6807\u8303\u56F4",
              value: destination,
              disabled: busy,
              onChange: (e) => setDestination(e.target.value),
              children: scopes.map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "option",
                {
                  value: id,
                  disabled: id === scope || !project && (id === "project" || id === "persona-project"),
                  children: label
                },
                id
              ))
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              disabled: busy || destination === scope,
              onClick: () => void run(async () => {
                if (!confirm(
                  `\u5C06\u8FD9\u4EFD\u77E5\u8BC6\u5FEB\u7167\u5206\u4EAB\u5230\u201C${scopes.find((s) => s[0] === destination)?.[1]}\u201D\uFF1F\u6765\u6E90\u4EE5\u540E\u6539\u53D8\u65F6\uFF0C\u6B64\u526F\u672C\u4F1A\u5931\u6548\u3002`
                ))
                  return;
                const target = await call("knowledge", { action: "catalog", scope: destination });
                await call("knowledge", {
                  action: "share",
                  scope,
                  id: selected.id,
                  targetScope: destination,
                  revision: target.revision,
                  documentRevision: selected.revision
                });
                setScope(destination);
              }),
              children: "\u5206\u4EAB\u5FEB\u7167"
            }
          )
        ] })
      ] }),
      editing && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { ...cardStyle, marginTop: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
          "\u4E3B\u9898",
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "input",
            {
              "aria-label": "\u77E5\u8BC6\u4E3B\u9898",
              style: { ...controlStyle, width: "100%" },
              value: key,
              disabled: busy || !!selected,
              onChange: (e) => setKey(e.target.value),
              maxLength: 160
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
          "\u73B0\u884C\u6B63\u6587",
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "textarea",
            {
              "aria-label": "\u77E5\u8BC6\u6B63\u6587",
              style: { ...controlStyle, width: "100%", minHeight: 180 },
              value: body,
              disabled: busy,
              onChange: (e) => setBody(e.target.value)
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
          "\u6765\u6E90\u6587\u4EF6\uFF08\u53EF\u9009\uFF0C\u6BCF\u884C\u4E00\u4E2A\uFF09",
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "textarea",
            {
              "aria-label": "\u77E5\u8BC6\u6765\u6E90\u6587\u4EF6",
              style: { ...controlStyle, width: "100%" },
              value: paths,
              disabled: busy,
              onChange: (e) => setPaths(e.target.value)
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "px-muted", children: "\u4FDD\u5B58\u65F6\u8BB0\u5F55\u6587\u4EF6\u7248\u672C\u3002\u6765\u6E90\u6539\u53D8\u540E\u9700\u91CD\u65B0\u6838\u5BF9\u5E76\u66F4\u65B0\u672C\u6761\u76EE\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "px-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              disabled: busy || !key.trim() || !body.trim(),
              onClick: () => void run(async () => {
                await call("knowledge", {
                  action: "write",
                  scope,
                  key,
                  body,
                  revision: editRevision,
                  sourcePaths: paths.split("\n").map((s) => s.trim()).filter(Boolean)
                });
                setEditing(false);
                await refresh();
              }),
              children: "\u4FDD\u5B58\u73B0\u884C\u7248\u672C"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => setEditing(false), children: "\u53D6\u6D88\u7F16\u8F91" })
        ] })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        ExperiencePanel,
        {
          sessionId,
          personaId,
          project,
          onAdopted: async () => {
            const value = await call("skills", { action: "list" });
            setSkills(value.skills);
            setSkillDirectories(value.directories);
          }
        },
        sessionId + ":" + personaId
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "px-muted", children: "\u5217\u8868\u4E0E\u52A0\u8F7D\u4F7F\u7528 DSH \u539F\u751F Skills\u3002\u9879\u76EE\u6280\u80FD\u4F18\u5148\u4E8E\u5168\u5C40\u6280\u80FD\uFF1B\u53EA\u6709\u672C\u9875\u521B\u5EFA\u7684\u6280\u80FD\u53EF\u5728\u6B64\u7F16\u8F91\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          disabled: busy || editing || !draft,
          onClick: () => {
            setSkill(null);
            setSkillName("");
            setSkillDescription("");
            setBody("");
            setSkillEnabled(false);
            setEditing(true);
          },
          children: "\u65B0\u5EFA\u6280\u80FD"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          disabled: busy || editing,
          onClick: () => void run(async () => {
            const value = await call("skills", { action: "list" });
            setSkills(value.skills);
            setSkillDirectories(value.directories);
          }),
          children: "\u5237\u65B0\u6280\u80FD\u5217\u8868"
        }
      ),
      skillDirectories && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { className: "px-muted", children: [
        "\u9879\u76EE\u6280\u80FD\u76EE\u5F55\uFF1A",
        skillDirectories.project ?? "\u672A\u9009\u62E9\u9879\u76EE",
        "\uFF1B\u5168\u5C40\u6280\u80FD\u76EE\u5F55\uFF1A",
        skillDirectories.global
      ] }),
      !editing && skills.map((item) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
        "button",
        {
          style: { ...controlStyle, width: "100%", textAlign: "left", marginTop: 6 },
          disabled: busy,
          onClick: () => void run(() => readSkill(item.name)),
          children: [
            item.name,
            " \xB7 ",
            item.source,
            !item.invocation?.modelInvocable ? " \xB7 \u4E0D\u81EA\u52A8\u8C03\u7528" : ""
          ]
        },
        item.name
      )),
      skill && !editing && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: cardStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: skill.skill.name }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: skill.skill.description }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "px-muted", children: skill.skill.path ?? skill.skill.provider }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { style: { whiteSpace: "pre-wrap" }, children: skill.skill.content }),
        skill.managed ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => setEditing(true), children: "\u7F16\u8F91 / \u542F\u505C" }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "px-muted", children: "\u7531\u539F\u751F\u6216\u7B2C\u4E09\u65B9\u6765\u6E90\u7BA1\u7406\uFF0C\u8BF7\u5728\u539F\u6587\u4EF6\u4E2D\u4FEE\u6539\u3002" })
      ] }),
      editing && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: cardStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
          "select",
          {
            "aria-label": "\u6280\u80FD\u8303\u56F4",
            disabled: busy || !!skill,
            value: skillScope,
            onChange: (e) => setSkillScope(e.target.value),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "project", disabled: !project, children: "\u672C\u9879\u76EE" }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "global", children: "\u5168\u5C40" })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "input",
          {
            "aria-label": "\u6280\u80FD\u540D\u79F0",
            style: controlStyle,
            disabled: busy || !!skill,
            value: skillName,
            onChange: (e) => setSkillName(e.target.value),
            placeholder: "\u4F8B\u5982 review-changes"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "input",
          {
            "aria-label": "\u6280\u80FD\u8BF4\u660E",
            style: { ...controlStyle, width: "100%" },
            disabled: busy,
            value: skillDescription,
            onChange: (e) => setSkillDescription(e.target.value),
            placeholder: "\u4F55\u65F6\u4F7F\u7528\u8FD9\u9879\u6280\u80FD"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "textarea",
          {
            "aria-label": "\u6280\u80FD\u6B63\u6587",
            style: { ...controlStyle, width: "100%", minHeight: 180 },
            disabled: busy,
            value: body,
            onChange: (e) => setBody(e.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "input",
            {
              type: "checkbox",
              disabled: busy,
              checked: skillEnabled,
              onChange: (e) => setSkillEnabled(e.target.checked)
            }
          ),
          "\u5141\u8BB8\u539F\u751F Agent \u53D1\u73B0\u548C\u8C03\u7528"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "px-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              disabled: busy || !skillName || !skillDescription || !body,
              onClick: () => void run(async () => {
                const saved2 = await call("skills", {
                  action: "save",
                  scope: skillScope,
                  name: skillName,
                  description: skillDescription,
                  body,
                  enabled: skillEnabled,
                  version: skill?.version,
                  expectedRoot: skillDirectories?.[skillScope]
                });
                setNotice(
                  saved2.discovery === "ready" ? "\u6280\u80FD\u5DF2\u4FDD\u5B58\uFF0C\u539F\u751F\u5217\u8868\u5DF2\u66F4\u65B0\u3002" : "\u6280\u80FD\u5DF2\u4FDD\u5B58\uFF1B\u539F\u751F\u76EE\u5F55\u4ECD\u5728\u5237\u65B0\uFF0C\u53EF\u7A0D\u540E\u70B9\u51FB\u201C\u5237\u65B0\u6280\u80FD\u5217\u8868\u201D\u3002"
                );
                setEditing(false);
                setSkill(null);
                const value = await call("skills", { action: "list" });
                setSkills(value.skills);
                setSkillDirectories(value.directories);
              }),
              children: "\u4FDD\u5B58\u6280\u80FD"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => setEditing(false), children: "\u53D6\u6D88\u7F16\u8F91" })
        ] })
      ] })
    ] })
  ] });
}

// packages/dsh-px-memory/src/mnemon-page.tsx
var import_react5 = require("react");
var import_jsx_runtime6 = require("react/jsx-runtime");
function KnowledgeSourcePage({
  source,
  openSession
}) {
  const [rows, setRows] = (0, import_react5.useState)([]), [scope, setScope] = (0, import_react5.useState)(""), [document2, setDocument] = (0, import_react5.useState)(null), [error, setError] = (0, import_react5.useState)(""), [busy, setBusy] = (0, import_react5.useState)(false);
  (0, import_react5.useEffect)(() => {
    let active2 = true;
    setDocument(null);
    setError("");
    void source.management?.read("snapshot").then((r) => {
      if (!active2) return;
      const scopes2 = r.value.scopes ?? [];
      setRows(scopes2);
      setScope((old) => scopes2.some((s) => s.scope === old) ? old : scopes2[0]?.scope ?? "");
    }).catch((e) => {
      if (active2) setError(String(e.message));
    });
    return () => {
      active2 = false;
    };
  }, [source.management, source.refreshKey]);
  const read = async (id, historical = false) => {
    setBusy(true);
    setError("");
    try {
      const r = await source.management?.read("query", { action: "read", scope, id, historical });
      setDocument(r?.value?.document);
    } catch (e) {
      setError(String(e.message));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "px-ui", style: { padding: 16, overflowWrap: "anywhere" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { children: "PX \u77E5\u8BC6" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: "\u4EBA\u683C\u79C1\u6709\u4E0E\u516C\u5171\u77E5\u8BC6\u5206\u5F00\u4FDD\u5B58\u3002\u8FD9\u91CC\u53EA\u5C55\u793A\u5F53\u524D\u539F\u751F\u8BBF\u95EE\u8303\u56F4\uFF1B\u7F16\u8F91\u3001\u5206\u4EAB\u548C Skills \u7BA1\u7406\u53EF\u4ECE\u7EDF\u4E00\u7684\u201C\u8BB0\u5FC6\u4E0E\u77E5\u8BC6\u201D\u9875\u9762\u8FDB\u5165\u3002" }),
    !source.sessionId && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "px-muted", children: "\u5F53\u524D\u6CA1\u6709\u7ED1\u5B9A\u4F1A\u8BDD\uFF0C\u4EC5\u663E\u793A\u516C\u5171\u8303\u56F4\u3002\u79C1\u6709\u77E5\u8BC6\u9700\u8981\u5148\u9009\u62E9\u5BF9\u5E94\u4EBA\u683C\u7684\u4F1A\u8BDD\u3002" }),
    source.sessionId && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { style: controlStyle, onClick: () => openSession(source.sessionId), children: "\u8FD4\u56DE\u8BB0\u5FC6\u4E0E\u77E5\u8BC6" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { role: "alert", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      "select",
      {
        "aria-label": "Mnemon \u77E5\u8BC6\u8303\u56F4",
        style: controlStyle,
        value: scope,
        disabled: busy,
        onChange: (e) => {
          setScope(e.target.value);
          setDocument(null);
        },
        children: rows.map((r) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: r.scope, children: r.label }, r.scope))
      }
    ),
    (rows.find((r) => r.scope === scope)?.documents ?? []).map((d) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "button",
      {
        style: { ...controlStyle, display: "block", marginTop: 8 },
        disabled: busy,
        onClick: () => void read(d.id),
        children: [
          d.key,
          " \xB7 v",
          d.revision,
          d.status === "archived" ? " \xB7 \u5DF2\u5F52\u6863" : ""
        ]
      },
      d.id
    )),
    document2 && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { ...cardStyle, marginTop: 12 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("strong", { children: [
        document2.key,
        " \xB7 v",
        document2.revision
      ] }),
      !document2.current && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { role: "status", children: "\u5DF2\u8FC7\u65F6\u3001\u5DF2\u5F52\u6863\u6216\u6765\u6E90\u6682\u4E0D\u53EF\u9A8C\u8BC1\uFF0C\u4E0D\u4F5C\u4E3A\u5F53\u524D\u7ED3\u8BBA\u3002" }),
      document2.body !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("pre", { style: { whiteSpace: "pre-wrap", fontFamily: "inherit" }, children: document2.body }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { disabled: busy, onClick: () => void read(document2.id, true), children: "\u67E5\u770B\u5386\u53F2\u6B63\u6587" })
    ] })
  ] });
}
function registerMnemonKnowledgePage(host, openWorkspace) {
  return host.slots.inject(
    "mnemon.source.page",
    () => host.slots.register(
      { name: "mnemon.source.page", id: "px-knowledge/library", order: 100, label: "PX \u77E5\u8BC6" },
      Object.assign(
        (props) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(KnowledgeSourcePage, { source: props, openSession: openWorkspace }),
        { mnemonNavigation: { group: "storage", primary: true, glyph: "\u25C7", detail: "\u4EBA\u683C\u3001\u9879\u76EE\u4E0E\u5171\u4EAB\u77E5\u8BC6" } }
      )
    )
  );
}

// packages/dsh-px-memory/src/memory-workspace.tsx
var import_react6 = require("react");

// packages/dsh-px-memory/src/workspace-navigation.ts
function memoryNavigation(host, component, icon) {
  let stopMain;
  let advanced = false;
  let disposed = false;
  let ready = false;
  const install = () => {
    if (!disposed && !advanced && ready && !stopMain)
      stopMain = host.slots.register({ name: "main", key: "mnemon", priority: -10 }, component);
  };
  const stop = host.slots.inject(
    "main",
    () => host.slots.inject("sidebar.panellist", () => {
      ready = true;
      install();
      const stopIcon = host.slots.register(
        { name: "sidebar.panellist", id: "mnemon", priority: -10, order: 30, label: "\u8BB0\u5FC6\u4E0E\u77E5\u8BC6" },
        icon
      );
      return () => {
        ready = false;
        stopIcon();
        stopMain?.();
        stopMain = void 0;
      };
    })
  );
  const restore = () => {
    advanced = false;
    install();
  };
  const stopSelection = host.layout.panelInfo.subscribe(() => {
    if (advanced && host.layout.panelInfo.getSnapshot().activePanelId !== "mnemon") restore();
  });
  const hasNative = () => host.slots.entries("main").some((entry) => entry.options.key === "mnemon" && entry.component !== component);
  const stopEntries = host.slots.subscribe("main", () => {
    if (advanced && ready && !hasNative()) restore();
  });
  return {
    open: () => {
      restore();
      host.layout.selectPanel("mnemon");
    },
    openNative: () => {
      if (!hasNative()) throw Error("\u539F\u751F\u8BB0\u5FC6\u7BA1\u7406\u9875\u672A\u542F\u7528\u3002\u8BF7\u5728 Mnemon \u914D\u7F6E\u4E2D\u542F\u7528\u9875\u9762\uFF0C\u5E76\u9009\u62E9\u4FA7\u680F\u5C55\u793A\u3002");
      advanced = true;
      stopMain?.();
      stopMain = void 0;
      host.layout.selectPanel("mnemon");
    },
    dispose: () => {
      disposed = true;
      stopSelection();
      stopEntries();
      stop();
      stopMain?.();
      stopMain = void 0;
    }
  };
}

// packages/dsh-px-memory/src/memory-workspace.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
function registerMemoryWorkspace(host, Panel) {
  const openSettings = () => {
    const navigation2 = host.get?.("pluginNavigation") ?? host.pluginNavigation;
    if (!navigation2?.openBundle) throw Error("\u539F\u751F\u63D2\u4EF6\u914D\u7F6E\u5165\u53E3\u5C1A\u672A\u52A0\u8F7D\uFF0C\u8BF7\u4ECE\u5DE6\u4FA7\u201C\u63D2\u4EF6\u201D\u6253\u5F00 Mnemon\u3002");
    navigation2.openBundle("dsh-mnemon");
  };
  const Main = () => {
    const sessions = (0, import_react6.useSyncExternalStore)(host.sessions.list.subscribe, host.sessions.list.getSnapshot);
    const id = selectedSession(sessions, null);
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
      "div",
      {
        className: "px-ui",
        style: { height: "100%", minWidth: 0, display: "flex", flexDirection: "column" },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "px-actions", style: { margin: "16px 20px 0", flexShrink: 0 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => host.layout.selectPanel(null), children: "\u8FD4\u56DE\u4F1A\u8BDD" }),
            id && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "px-muted", children: sessions.byId[id]?.displayTitle ?? "\u5F53\u524D\u4F1A\u8BDD" })
          ] }),
          id ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
            Panel,
            {
              sessionId: id,
              visible: true,
              openSession: (target) => host.uiWorkspace.openSession(target),
              openKnowledge: () => navigation.openNative(),
              openSettings,
              openTasks: () => {
                host.uiWorkspace.openSession(id);
                host.sidebarRight.openTabIn(id, "dsh-px-taskflow");
              }
            },
            id
          ) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { padding: 24 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h2", { children: "\u8BB0\u5FC6\u4E0E\u77E5\u8BC6" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "\u5148\u4ECE\u5DE6\u4FA7\u6253\u5F00\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u5373\u53EF\u67E5\u770B\u8BE5\u4EBA\u683C\u7684\u8BB0\u5FC6\u3001\u7ECF\u5386\u548C\u9879\u76EE\u77E5\u8BC6\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "px-muted", children: "\u67E5\u770B\u5176\u4ED6\u4F1A\u8BDD\u4E0D\u4F1A\u6539\u53D8\u5B83\u7ED1\u5B9A\u7684\u4EBA\u683C\uFF0C\u4E5F\u4E0D\u4F1A\u81EA\u52A8\u542F\u52A8\u4EFB\u52A1\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: openSettings, children: "\u9AD8\u7EA7\uFF1AMnemon \u914D\u7F6E" })
          ] })
        ]
      }
    );
  };
  const Icon = ({ size = 20 }) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.6",
      "aria-hidden": "true",
      children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("path", { d: "M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15" })
    }
  );
  const navigation = memoryNavigation(host, Main, Icon);
  return {
    ...navigation,
    open: (id) => {
      if (id) host.uiWorkspace.openSession(id);
      navigation.open();
    }
  };
}

// packages/dsh-px-memory/src/client.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
var personaDrafts = createDraftRegistry(64);
var inject = [];
function MemoryPanel({
  sessionId,
  visible,
  openKnowledge,
  openSession,
  openSettings,
  openTasks
}) {
  const draft = (0, import_react7.useMemo)(() => {
    let storage;
    try {
      storage = sessionStorage;
    } catch {
    }
    return personaDrafts.acquire(
      "px-persona-form-v2:" + sessionId,
      {
        revision: -1,
        personaId: "",
        configDirty: false,
        name: "",
        instructions: "",
        enabled: true,
        newName: "",
        note: "",
        editing: "",
        scope: "project"
      },
      storage,
      (v) => v.note.length <= 2e3 && v.instructions.length <= 2e3 && v.name.length <= 60 && v.newName.length <= 60 && Number.isSafeInteger(v.revision) && v.revision >= -1 && ["project", "persona"].includes(v.scope)
    );
  }, [sessionId]);
  const saved = draft?.getSnapshot();
  const restoring = (0, import_react7.useRef)(!!saved && saved.revision >= 0);
  const [draftRevision, setDraftRevision] = (0, import_react7.useState)(
    saved && saved.revision >= 0 ? saved.revision : void 0
  ), [draftPersona, setDraftPersona] = (0, import_react7.useState)(saved?.personaId ?? ""), [conflict, setConflict] = (0, import_react7.useState)(false);
  const [view, setView] = (0, import_react7.useState)(null), [error, setError] = (0, import_react7.useState)(""), [busy, setBusy] = (0, import_react7.useState)(false);
  const [name, setName] = (0, import_react7.useState)(saved?.name ?? ""), [instructions, setInstructions] = (0, import_react7.useState)(saved?.instructions ?? ""), [enabled, setEnabled] = (0, import_react7.useState)(saved?.enabled ?? true);
  const [newName, setNewName] = (0, import_react7.useState)(saved?.newName ?? ""), [note, setNote] = (0, import_react7.useState)(saved?.note ?? ""), [editing, setEditing] = (0, import_react7.useState)(saved?.editing || void 0);
  const [scope, setScope] = (0, import_react7.useState)(saved?.scope ?? "project");
  const [targetPersona, setTargetPersona] = (0, import_react7.useState)("");
  const [tab, setTab] = (0, import_react7.useState)("persona");
  const newRequest = (0, import_react7.useRef)(null);
  const alive = (0, import_react7.useRef)(true), isVisible = (0, import_react7.useRef)(visible);
  (0, import_react7.useEffect)(() => {
    isVisible.current = visible;
  }, [visible]);
  (0, import_react7.useEffect)(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const configDirty = !!(view && (name !== view.template.name || instructions !== view.template.instructions || enabled !== view.persona.memoryEnabled));
  const dirty = !!note || !!newName || configDirty || restoring.current && !!saved?.configDirty;
  const identityChanged = !!(view && draftPersona && draftPersona !== view.persona.id);
  const beginEdit = () => {
    if (draftRevision === void 0 && view) {
      setDraftRevision(view.revision);
      setDraftPersona(view.persona.id);
    }
  };
  const discardDraft = () => {
    restoring.current = false;
    draft?.clear();
    setDraftRevision(void 0);
    setDraftPersona("");
    setConflict(false);
    setNote("");
    setNewName("");
    setEditing(void 0);
    setName("");
    setInstructions("");
    setView(null);
    setError("");
  };
  (0, import_react7.useEffect)(() => {
    if (!draft || !view) return;
    if (dirty)
      draft.set({
        revision: draftRevision ?? view.revision,
        personaId: draftPersona || view.persona.id,
        configDirty,
        name,
        instructions,
        enabled,
        newName,
        note,
        editing: editing ?? "",
        scope
      });
    else {
      draft.clear();
      setDraftRevision(void 0);
      setDraftPersona("");
    }
  }, [
    draft,
    dirty,
    view,
    name,
    instructions,
    enabled,
    newName,
    note,
    editing,
    scope,
    draftRevision,
    draftPersona,
    configDirty
  ]);
  const url = `/dsh-px-memory?sessionId=${encodeURIComponent(sessionId)}`;
  const accept = (data) => {
    setView(data);
    setName(data.template.name);
    setInstructions(data.template.instructions);
    setEnabled(data.persona.memoryEnabled);
    if (!data.project) setScope("persona");
  };
  (0, import_react7.useEffect)(() => {
    if (!visible || busy || view && dirty) return;
    const ac = new AbortController();
    let timer;
    const refresh = async () => {
      try {
        const data = await requestJson(url, { signal: ac.signal });
        if (!ac.signal.aborted) {
          if (restoring.current) {
            restoring.current = false;
            setView(data);
            if (!saved?.configDirty) {
              setName(data.template.name);
              setInstructions(data.template.instructions);
              setEnabled(data.persona.memoryEnabled);
            }
            if (saved?.personaId !== data.persona.id) {
              setConflict(true);
              setError("\u6B64\u4F1A\u8BDD\u7684\u4EBA\u683C\u5DF2\u6539\u53D8\u3002\u65E7\u4EBA\u683C\u8349\u7A3F\u672A\u63D0\u4EA4\uFF0C\u8BF7\u653E\u5F03\u8349\u7A3F\u540E\u67E5\u770B\u5F53\u524D\u4EBA\u683C\u3002");
            } else if (saved?.revision !== data.revision) {
              setConflict(true);
              setError("\u8FD9\u4EFD\u8349\u7A3F\u7684\u539F\u7248\u672C\u5DF2\u53D8\u5316\uFF0C\u4E0D\u80FD\u76F4\u63A5\u8986\u76D6\u3002\u8BF7\u5148\u4FDD\u7559\u9700\u8981\u7684\u6587\u5B57\uFF0C\u518D\u653E\u5F03\u8349\u7A3F\u5E76\u8BFB\u53D6\u6700\u65B0\u5185\u5BB9\u3002");
            }
          } else {
            accept(data);
            setError("");
            setConflict(false);
          }
        }
      } catch (e) {
        if (!ac.signal.aborted) setError(String(e.message));
      }
      if (!ac.signal.aborted) timer = setTimeout(() => void refresh(), 5e3);
    };
    void refresh();
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [url, visible, busy, dirty, !!view]);
  const act = async (action) => {
    if (action && identityChanged) {
      setConflict(true);
      setError("\u4EBA\u683C\u5DF2\u6539\u53D8\uFF0C\u65E7\u8349\u7A3F\u672A\u63D0\u4EA4\u3002\u8BF7\u653E\u5F03\u8349\u7A3F\u540E\u91CD\u65B0\u8BFB\u53D6\u3002");
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const data = await requestJson(
        url,
        action ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...action, revision: draftRevision ?? view?.revision })
        } : {}
      );
      if (!action && dirty && data.persona.id !== view?.persona.id) {
        setError("\u53E6\u4E00\u4E2A\u7A97\u53E3\u5207\u6362\u4E86\u4EBA\u683C\uFF1B\u8BF7\u53D6\u6D88\u5F53\u524D\u7F16\u8F91\u540E\u5237\u65B0\uFF0C\u8349\u7A3F\u672A\u88AB\u8986\u76D6\u3002");
        return false;
      }
      if (configDirty && (!action || ["save", "forget"].includes(action.type)))
        setView(data);
      else accept(data);
      setDraftRevision(void 0);
      setDraftPersona("");
      setConflict(false);
      return true;
    } catch (e) {
      if (e.status === 409) setConflict(true);
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const edit = (entry) => {
    beginEdit();
    setEditing(entry.id);
    setNote(entry.text);
    setScope(entry.project ? "project" : "persona");
  };
  const createSession = async (handoff) => {
    if (!targetPersona) return;
    setBusy(true);
    setError("");
    const key = `${sessionId}:${targetPersona}:${handoff}`;
    if (newRequest.current?.key !== key) newRequest.current = { key, id: crypto.randomUUID() };
    try {
      const data = await requestJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "new-session",
          personaId: targetPersona,
          handoff,
          requestId: newRequest.current.id
        })
      });
      if (alive.current && isVisible.current) openSession(data.createdSessionId);
      newRequest.current = null;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    "div",
    {
      className: "px-ui px-memory-panel",
      style: { padding: 20, flex: 1, minHeight: 0, overflow: "auto", overflowWrap: "anywhere", fontSize: 14 },
      children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { maxWidth: 960, margin: "0 auto" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "px-actions", style: { justifyContent: "space-between" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h2", { style: { margin: "0 0 8px" }, children: "\u8BB0\u5FC6\u4E0E\u77E5\u8BC6" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { onClick: () => setTab("advanced"), "aria-pressed": tab === "advanced", children: "\u9AD8\u7EA7\u8BBE\u7F6E" })
        ] }),
        view && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "px-muted", children: [
          "\u5F53\u524D\u4EBA\u683C\uFF1A",
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("strong", { children: view.persona.name }),
          " \xB7 \u9879\u76EE\uFF1A",
          view.project ? view.project.split(/[\\/]/).filter(Boolean).pop() : "\u672A\u5173\u8054\u9879\u76EE",
          view.binding.locked ? " \xB7 \u4F1A\u8BDD\u4EBA\u683C\u5DF2\u56FA\u5B9A" : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "px-actions", role: "group", "aria-label": "\u8BB0\u5FC6\u9875\u9762", children: [
          ["persona", "\u4EBA\u683C\u8BB0\u5FC6"],
          ["history", "\u7ECF\u5386\u4E0E\u5386\u53F2"],
          ["knowledge", "\u77E5\u8BC6\u4E0E Skills"]
        ].map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "button",
          {
            "aria-pressed": tab === id,
            className: tab === id ? "px-primary" : "",
            onClick: () => setTab(id),
            children: label
          },
          id
        )) }),
        dirty && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { role: "status", style: { opacity: 0.7 }, children: "\u8349\u7A3F\u5C1A\u672A\u4FDD\u5B58\uFF0C\u5DF2\u6682\u505C\u81EA\u52A8\u5237\u65B0\u3002\u5207\u6362\u9875\u9762\u4F1A\u4FDD\u7559\u8349\u7A3F\uFF1B\u4FDD\u5B58\u65F6\u4ECD\u4F1A\u6838\u5BF9\u539F\u7248\u672C\u3002" }),
        !draft && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { role: "alert", children: "\u5F53\u524D\u7A97\u53E3\u8349\u7A3F\u5DF2\u6EE1\u3002\u672C\u9875\u65B0\u7F16\u8F91\u6682\u4E0D\u80FD\u8DE8\u9875\u4FDD\u7559\uFF0C\u8BF7\u5148\u4FDD\u5B58\u5176\u4ED6\u8349\u7A3F\u3002" }),
        tab === "persona" && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { style: controlStyle, disabled: busy || dirty, onClick: () => void act(), children: "\u5237\u65B0\u8BB0\u5F55" }),
        error && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { role: "alert", children: [
          error,
          " "
        ] }),
        conflict && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { disabled: busy, onClick: discardDraft, children: "\u653E\u5F03\u8349\u7A3F\u5E76\u8BFB\u53D6\u6700\u65B0" }),
        !view && !error && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u2026" }),
        view && !identityChanged && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { hidden: tab !== "history", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            HistoryPanel,
            {
              url,
              visible: visible && tab === "history",
              openSession
            },
            view.persona.id
          ) }),
          tab === "knowledge" && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            KnowledgePanel,
            {
              sessionId,
              personaId: view.persona.id,
              project: view.project
            },
            sessionId + view.persona.id
          ),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { hidden: tab !== "advanced", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: "\u5F15\u64CE\u914D\u7F6E\u4E0E\u8BCA\u65AD" }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "px-muted", children: "\u65E5\u5E38\u8D44\u6599\u5728\u524D\u4E09\u4E2A\u9875\u9762\u7BA1\u7406\u3002\u4E0B\u9762\u4FDD\u7559 Mnemon \u539F\u751F\u8BBE\u7F6E\u3001\u9879\u76EE\u6863\u6848\u53CA\u5176\u4ED6\u8BB0\u5FC6\u6765\u6E90\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u5F00\u542F\u540E\u53F0\u63D0\u70BC\u6216\u8FC1\u79FB\u8D44\u6599\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "px-actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "button",
                {
                  disabled: dirty || busy,
                  onClick: () => {
                    try {
                      openKnowledge();
                    } catch (e) {
                      setError(e.message);
                    }
                  },
                  children: "\u6253\u5F00\u539F\u751F\u8BB0\u5FC6\u7BA1\u7406"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "button",
                {
                  disabled: dirty || busy,
                  onClick: () => {
                    try {
                      openSettings();
                    } catch (e) {
                      setError(e.message);
                    }
                  },
                  children: "\u6253\u5F00 Mnemon \u914D\u7F6E"
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: "\u5F53\u524D\u5DE5\u4F5C\u653E\u5728\u54EA\u91CC\uFF1F" }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: "\u4EFB\u52A1\u8FDB\u5EA6\u548C\u4E0B\u4E00\u6B65\u4FDD\u5B58\u5728\u5DE5\u4F5C\u8D26\u672C\uFF0CGoal \u4E0E Team \u4ECD\u4EE5\u539F\u751F\u6267\u884C\u72B6\u6001\u4E3A\u51C6\u3002\u957F\u671F\u7EA6\u5B9A\u653E\u5728\u4EBA\u683C\u8BB0\u5FC6\uFF0C\u53EF\u590D\u7528\u7ED3\u8BBA\u653E\u5728\u77E5\u8BC6\u5E93\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { disabled: dirty || busy, onClick: openTasks, children: "\u67E5\u770B\u5F53\u524D\u4EFB\u52A1\u4E0E\u5DE5\u4F5C\u8D26\u672C" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { hidden: tab !== "persona", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("details", { className: "px-card", children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("summary", { children: "\u4EBA\u683C\u4E0E\u534F\u4F5C\u504F\u597D" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { children: [
                "\u5F53\u524D\u4F1A\u8BDD\u7684\u4EBA\u683C",
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  "select",
                  {
                    "aria-label": "\u5F53\u524D\u4EBA\u683C",
                    style: { ...controlStyle, width: "100%", margin: "8px 0 16px" },
                    disabled: busy || view.binding.locked,
                    value: view.persona.id,
                    onChange: (e) => {
                      if (dirty) {
                        setError("\u8BF7\u5148\u4FDD\u5B58\u6216\u6E05\u7A7A\u5F53\u524D\u7F16\u8F91\uFF0C\u518D\u5207\u6362\u4EBA\u683C\u3002");
                        return;
                      }
                      void act({ type: "select", personaId: e.target.value });
                    },
                    children: view.personas.map((p) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("option", { value: p.id, disabled: p.archived, children: [
                      p.name,
                      p.archived ? "\uFF08\u5DF2\u5F52\u6863\uFF09" : ""
                    ] }, p.id))
                  }
                )
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "px-muted", children: [
                "\u672C\u4F1A\u8BDD\u4F7F\u7528\u914D\u7F6E\u7248\u672C ",
                view.binding.personaRevision,
                "\u3002",
                view.binding.locked ? "\u4EBA\u683C\u5DF2\u56FA\u5B9A\u3002" : "\u5C1A\u672A\u5F00\u59CB\uFF0C\u53EF\u4EE5\u9009\u62E9\u4EBA\u683C\u3002"
              ] }),
              view.persona.archived && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { role: "status", children: "\u6B64\u4EBA\u683C\u5DF2\u5F52\u6863\u3002\u5386\u53F2\u4ECD\u53EF\u67E5\u770B\uFF0C\u8BF7\u65B0\u5EFA\u5176\u4ED6\u4EBA\u683C\u7684\u4F1A\u8BDD\u7EE7\u7EED\u3002" }),
              view.template.revision !== view.binding.personaRevision && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
                "button",
                {
                  disabled: busy || view.persona.archived,
                  onClick: () => void act({ type: "adopt-version" }),
                  children: [
                    "\u672C\u4F1A\u8BDD\u91C7\u7528\u6700\u65B0\u4EBA\u683C\u914D\u7F6E\uFF08\u7248\u672C ",
                    view.template.revision,
                    "\uFF09"
                  ]
                }
              ),
              view.binding.handoff && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "px-muted", children: [
                "\u5DF2\u63A5\u7EED\u6765\u6E90\u4F1A\u8BDD\u622A\u81F3\u4E8B\u4EF6 ",
                view.binding.handoff.throughSeq,
                " ",
                "\u7684\u5BF9\u8BDD\u4E0E\u6267\u884C\u8BB0\u5F55\uFF1B\u539F\u4F1A\u8BDD\u4EFB\u52A1\u4E0D\u4F1A\u81EA\u52A8\u6062\u590D\u3002"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("details", { className: "px-card", children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("summary", { children: "\u7528\u53E6\u4E00\u4E2A\u4EBA\u683C\u7EE7\u7EED" }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: "\u63A5\u7EED\u4F1A\u8BDD\u53EF\u6309\u9700\u8BFB\u53D6\u539F\u4F1A\u8BDD\u622A\u81F3\u521B\u5EFA\u65F6\u7684\u53EF\u89C1\u5BF9\u8BDD\u4E0E\u6267\u884C\u8BB0\u5F55\uFF0C\u4E0D\u590D\u5236\u65E7\u4EBA\u683C\u7684\u79C1\u6709\u8BB0\u5FC6\u6CE8\u5165\u3002\u539F\u4F1A\u8BDD\u5DF2\u8BF4\u51FA\u7684\u5185\u5BB9\u4E5F\u5728\u4EA4\u63A5\u8303\u56F4\u5185\u3002" }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
                  "select",
                  {
                    "aria-label": "\u65B0\u4F1A\u8BDD\u4EBA\u683C",
                    value: targetPersona,
                    disabled: busy,
                    onChange: (e) => setTargetPersona(e.target.value),
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "", children: "\u9009\u62E9\u4EBA\u683C" }),
                      view.personas.filter((p) => !p.archived).map((p) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: p.id, children: p.name }, p.id))
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "px-actions", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    "button",
                    {
                      disabled: busy || dirty || !targetPersona,
                      onClick: () => void createSession(true),
                      children: "\u65B0\u5EFA\u63A5\u7EED\u4F1A\u8BDD"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    "button",
                    {
                      disabled: busy || dirty || !targetPersona,
                      onClick: () => void createSession(false),
                      children: "\u65B0\u5EFA\u7A7A\u767D\u4F1A\u8BDD"
                    }
                  )
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("details", { style: { ...cardStyle, marginBottom: 16 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("summary", { children: "\u7F16\u8F91\u4EBA\u683C\u6A21\u677F\uFF08\u4FDD\u5B58\u4E3A\u65B0\u7248\u672C\uFF09" }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { children: [
                    "\u540D\u79F0",
                    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                      "input",
                      {
                        disabled: busy || view.persona.archived,
                        "aria-label": "\u4EBA\u683C\u540D\u79F0",
                        style: { ...controlStyle, width: "100%" },
                        maxLength: 60,
                        value: name,
                        onChange: (e) => {
                          beginEdit();
                          setName(e.target.value);
                        }
                      }
                    )
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { children: [
                    "\u804C\u8D23\u4E0E\u534F\u4F5C\u65B9\u5F0F",
                    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                      "textarea",
                      {
                        disabled: busy || view.persona.archived,
                        "aria-label": "\u804C\u8D23\u4E0E\u534F\u4F5C\u65B9\u5F0F",
                        rows: 4,
                        maxLength: 2e3,
                        style: { ...controlStyle, width: "100%", resize: "vertical" },
                        placeholder: "\u4F8B\u5982\uFF1A\u5148\u89E3\u91CA\u7ED3\u8BBA\uFF1B\u534F\u52A9\u7814\u7A76\u65F6\u6807\u660E\u6765\u6E90\u548C\u4E0D\u786E\u5B9A\u6027\u3002",
                        value: instructions,
                        onChange: (e) => {
                          beginEdit();
                          setInstructions(e.target.value);
                        }
                      }
                    )
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                      "input",
                      {
                        disabled: busy || view.persona.archived,
                        type: "checkbox",
                        checked: enabled,
                        onChange: (e) => {
                          beginEdit();
                          setEnabled(e.target.checked);
                        }
                      }
                    ),
                    " ",
                    "\u4F7F\u7528\u5E76\u5141\u8BB8\u4FDD\u5B58\u6B64\u4EBA\u683C\u7684\u8BB0\u5FC6"
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    "button",
                    {
                      style: controlStyle,
                      disabled: busy || !name.trim() || view.persona.archived,
                      onClick: () => void act({ type: "configure", name, instructions, memoryEnabled: enabled }),
                      children: "\u4FDD\u5B58\u4EBA\u683C"
                    }
                  ) })
                ] }),
                dirty && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  "button",
                  {
                    style: controlStyle,
                    disabled: busy,
                    onClick: () => {
                      accept(view);
                      setNewName("");
                      setNote("");
                      setEditing(void 0);
                    },
                    children: "\u53D6\u6D88\u672A\u4FDD\u5B58\u7684\u7F16\u8F91"
                  }
                ),
                view.persona.id !== "default" && !view.persona.archived && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  "button",
                  {
                    style: { ...controlStyle, marginBottom: 16 },
                    disabled: busy || !!note,
                    onClick: () => {
                      if (window.confirm(
                        "\u5F52\u6863\u6B64\u4EBA\u683C\uFF1F\u5386\u53F2\u4E0E\u8BB0\u5FC6\u4ECD\u53EF\u67E5\u770B\uFF0C\u5B83\u5C06\u4E0D\u80FD\u7528\u4E8E\u65B0\u7684\u6A21\u578B\u8F6E\u6B21\uFF1B\u5DF2\u6709\u4F1A\u8BDD\u4E0D\u4F1A\u53D8\u6210\u5176\u4ED6\u4EBA\u683C\u3002"
                      ))
                        void act({ type: "archive-persona" });
                    },
                    children: "\u5F52\u6863\u6B64\u4EBA\u683C"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("details", { style: { ...cardStyle, marginBottom: 16 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("summary", { children: "\u65B0\u589E\u4EBA\u683C" }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: "\u65B0\u5EFA\u540E\u4F7F\u7528\u72EC\u7ACB\u7684\u7A7A\u8BB0\u5FC6\uFF0C\u4E0D\u590D\u5236\u5176\u4ED6\u4EBA\u683C\u7684\u8BB0\u5FC6\u3002" }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    "input",
                    {
                      disabled: busy,
                      "aria-label": "\u65B0\u4EBA\u683C\u540D\u79F0",
                      style: controlStyle,
                      placeholder: "\u4F8B\u5982\uFF1A\u7814\u7A76\u52A9\u624B",
                      value: newName,
                      maxLength: 60,
                      onChange: (e) => {
                        beginEdit();
                        setNewName(e.target.value);
                      }
                    }
                  ),
                  " ",
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    "button",
                    {
                      style: controlStyle,
                      disabled: busy || !newName.trim() || !!note || name !== view.template.name || instructions !== view.template.instructions || enabled !== view.persona.memoryEnabled,
                      onClick: () => void act({ type: "create", name: newName }).then((ok) => {
                        if (ok) setNewName("");
                      }),
                      children: view.binding.locked ? "\u521B\u5EFA\u4EBA\u683C" : "\u521B\u5EFA\u5E76\u9009\u62E9"
                    }
                  )
                ] })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: "\u4FDD\u5B58\u7684\u7EA6\u5B9A" }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: { opacity: 0.7 }, children: "\u53EA\u663E\u793A\u672C\u76EE\u5F55\u53CA\u6B64\u4EBA\u683C\u901A\u7528\u7684\u8BB0\u5FC6\u3002\u53EF\u76F4\u63A5\u7F16\u8F91\uFF0C\u4E5F\u53EF\u5728\u5BF9\u8BDD\u4E2D\u660E\u786E\u8981\u6C42 Agent \u8BB0\u4F4F\u6216\u5FD8\u8BB0\u3002" }),
            !view.persona.memoryEnabled && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { role: "status", children: "\u6B64\u4EBA\u683C\u7684\u8BB0\u5FC6\u5DF2\u5173\u95ED\uFF0C\u6761\u76EE\u4ECD\u4FDD\u7559\u3002\u53EF\u5728\u201C\u4EBA\u683C\u4E0E\u534F\u4F5C\u504F\u597D\u201D\u4E2D\u5F00\u542F\u3002" }),
            !view.persona.memories.some((m) => !m.project || m.project === view.project) && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "px-empty", children: "\u8FD8\u6CA1\u6709\u4FDD\u5B58\u7EA6\u5B9A\u3002\u53EF\u4EE5\u8BB0\u4E0B\u4F60\u7684\u534F\u4F5C\u504F\u597D\uFF0C\u4E5F\u53EF\u4EE5\u5728\u5BF9\u8BDD\u4E2D\u660E\u786E\u8981\u6C42\u52A9\u624B\u8BB0\u4F4F\u3002" }),
            view.persona.memories.filter((m) => !m.project || m.project === view.project).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((m) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { style: { ...cardStyle, marginBottom: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("small", { children: m.project ? "\u672C\u76EE\u5F55" : "\u6B64\u4EBA\u683C\u901A\u7528" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: { whiteSpace: "pre-wrap" }, children: m.text }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "button",
                {
                  style: controlStyle,
                  disabled: busy || view.persona.archived,
                  onClick: () => edit(m),
                  children: "\u7F16\u8F91"
                }
              ),
              " ",
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "button",
                {
                  style: controlStyle,
                  disabled: busy,
                  onClick: () => void act({ type: "forget", id: m.id }).then((ok) => {
                    if (ok && editing === m.id) {
                      setEditing(void 0);
                      setNote("");
                    }
                  }),
                  children: "\u5FD8\u8BB0"
                }
              )
            ] }, m.id)),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              "textarea",
              {
                disabled: busy || view.persona.archived,
                "aria-label": "\u8BB0\u5FC6\u5185\u5BB9",
                rows: 3,
                maxLength: 2e3,
                style: { ...controlStyle, width: "100%", resize: "vertical" },
                placeholder: "\u5199\u4E0B\u9700\u8981\u5728\u4EE5\u540E\u7684\u4F1A\u8BDD\u4E2D\u8BB0\u4F4F\u7684\u7EA6\u5B9A\u2026",
                value: note,
                onChange: (e) => {
                  beginEdit();
                  setNote(e.target.value);
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
                "select",
                {
                  disabled: busy || view.persona.archived,
                  "aria-label": "\u8BB0\u5FC6\u8303\u56F4",
                  style: controlStyle,
                  value: scope,
                  onChange: (e) => setScope(e.target.value),
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "project", disabled: !view.project, children: "\u672C\u76EE\u5F55" }),
                    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "persona", children: "\u6B64\u4EBA\u683C\u901A\u7528" })
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "button",
                {
                  style: controlStyle,
                  disabled: busy || !note.trim() || !view.persona.memoryEnabled || view.persona.archived,
                  onClick: () => void act({ type: "save", id: editing, text: note, scope }).then((ok) => {
                    if (ok) {
                      setNote("");
                      setEditing(void 0);
                    }
                  }),
                  children: editing ? "\u4FDD\u5B58\u4FEE\u6539" : "\u8BB0\u4F4F"
                }
              ),
              note && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "button",
                {
                  style: controlStyle,
                  onClick: () => {
                    setNote("");
                    setEditing(void 0);
                  },
                  children: "\u53D6\u6D88\u7F16\u8F91"
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: { opacity: 0.65 }, children: "\u6BCF\u6761\u6700\u591A 2000 \u5B57\uFF0C\u6BCF\u4E2A\u4EBA\u683C\u5408\u8BA1\u6700\u591A 8000 \u5B57\u3002\u4E34\u65F6\u4EFB\u52A1\u8FDB\u5EA6\u8BF7\u653E\u5728\u4F1A\u8BDD\u8D26\u672C\u4E2D\u3002" })
          ] })
        ] })
      ] })
    }
  );
}
function apply(ctx) {
  installUiStyles(ctx);
  ctx.inject(
    ["slots", "layout", "sessions", "uiWorkspace", "sidebarRight", "sidebarRightTabs"],
    (host) => host.effect(() => {
      const workspace = registerMemoryWorkspace(host, MemoryPanel);
      const nativePage = registerMnemonKnowledgePage(host, workspace.open);
      const sidebar = createNativeSidebar(host).registerTab({
        id: "dsh-px-memory",
        title: "\u8BB0\u5FC6\u4E0E\u77E5\u8BC6",
        order: 17,
        component: ({ scope }) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "px-ui", style: { padding: 16 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: "\u8BB0\u5FC6\u4E0E\u77E5\u8BC6" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: "\u4EBA\u683C\u7EA6\u5B9A\u3001\u5386\u53F2\u68C0\u7D22\u3001\u77E5\u8BC6\u4E0E Skills \u5728\u540C\u4E00\u4E2A\u9875\u9762\u7BA1\u7406\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { onClick: () => workspace.open(scope.sessionId), children: "\u6253\u5F00\u8BB0\u5FC6\u4E0E\u77E5\u8BC6" })
        ] })
      });
      return () => {
        sidebar();
        nativePage();
        workspace.dispose();
      };
    }, "memory: unified workspace")
  );
}

		return module.exports;
	}
});
