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
var import_react14 = require("react");

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
var import_react5 = require("react");

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
var startedNotice = "\u5DF2\u5F00\u59CB\u540E\u53F0\u5904\u7406\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u5BF9\u8BDD\u3002";
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
        const shouldRefresh = first || snapshot.selected?.revision !== next.revision || snapshot.selected?.value.runs.some(
          (run2) => next.runs.some(
            (current) => current.id === run2.id && (current.status !== run2.status || current.awaitingRecovery !== run2.awaitingRecovery)
          )
        );
        first = false;
        if (snapshot.selected && !snapshot.busy && snapshot.body === snapshot.selected.value.draft.content && shouldRefresh) {
          const detail = await call(
            { action: "read", kind: "draft", id: snapshot.selected.value.draft.id },
            controller.signal
          );
          if (controller.signal.aborted || epoch !== actionEpoch.current || edited !== editEpoch.current || latest.current.selected !== snapshot.selected || latest.current.body !== snapshot.body || latest.current.busy)
            return;
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
        if (!controller.signal.aborted && epoch === actionEpoch.current) setError(String(error2.message));
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
    setView(
      (current) => current && {
        ...current,
        tasks: [
          {
            requestId,
            jobId: admitted.jobId,
            phase: "starting",
            startedAt: Date.now(),
            progress: action === "review" ? "\u6574\u7406\u5DE5\u4F5C\u7ECF\u5386" : action === "draft" ? "\u751F\u6210 Skill \u8349\u7A3F" : "\u6A21\u62DF\u56DE\u6D4B Skill \u8349\u7A3F"
          },
          ...current.tasks.filter((task) => task.requestId !== requestId)
        ]
      }
    );
    setSelected(null);
    setEvidence(null);
    setNotice(startedNotice);
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
    notice && (notice !== startedNotice || working) && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", children: notice }),
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

// packages/dsh-px-memory/src/memory-feedback-panel.tsx
var import_react4 = require("react");
var import_jsx_runtime5 = require("react/jsx-runtime");
var labels = [
  ["confirmed", "\u786E\u8BA4\u6B63\u786E"],
  ["useful", "\u5E94\u7528\u6709\u5E2E\u52A9"],
  ["not-applicable", "\u6B64\u5904\u4E0D\u9002\u7528"],
  ["disputed", "\u5185\u5BB9\u4E0D\u6B63\u786E"]
];
function MemoryFeedbackPanel({
  value,
  busy,
  disabled,
  submit,
  readSource
}) {
  const [reason, setReason] = (0, import_react4.useState)("");
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("details", { style: { marginTop: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("summary", { children: [
      "\u4F7F\u7528\u53CD\u9988 \xB7 ",
      value?.disputed ? "\u9700\u7EA0\u6B63" : value?.confirmed ? "\u7528\u6237\u5DF2\u786E\u8BA4" : "\u5C1A\u672A\u786E\u8BA4",
      " \xB7 \u6743\u91CD",
      " ",
      value?.strength ?? 0
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "px-muted", children: "\u53CD\u9988\u7ED1\u5B9A\u5F53\u524D\u4FEE\u8BA2\uFF0C\u53EA\u5F71\u54CD\u6B64\u4EBA\u683C\u5728\u5F53\u524D\u53D7\u4F17\u4E0B\u7684\u4F7F\u7528\u3002\u91CD\u590D\u70B9\u51FB\u4E0D\u7D2F\u8BA1\u7968\u6570\u3002\u6807\u4E3A\u4E0D\u6B63\u786E\u540E\u505C\u6B62\u91C7\u7528\uFF0C\u4FEE\u6539\u6B63\u6587\u540E\u518D\u6838\u5BF9\uFF1B\u6B63\u6587\u7684\u7EA0\u6B63\u548C\u9057\u5FD8\u4ECD\u901A\u8FC7\u5BF9\u5E94\u7F16\u8F91\u5165\u53E3\u5B8C\u6210\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
      "\u53CD\u9988\u539F\u56E0",
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "input",
        {
          "aria-label": "\u8BB0\u5FC6\u53CD\u9988\u539F\u56E0",
          value: reason,
          maxLength: 1e3,
          disabled: busy || disabled,
          onChange: (e) => setReason(e.target.value)
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "px-actions", children: labels.map(([kind, label]) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      "button",
      {
        disabled: busy || disabled || !reason.trim(),
        onClick: () => {
          void submit(kind, reason.trim());
        },
        children: label
      },
      kind
    )) }),
    (value?.entries ?? []).map((entry, index) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { marginTop: 8 }, children: [
      labels.find(([kind]) => kind === entry.kind)?.[1] ?? entry.kind,
      " \xB7",
      " ",
      entry.actor === "human" ? "\u7528\u6237\u53CD\u9988" : "\u6A21\u578B\u5E94\u7528\u8BB0\u5F55",
      "\uFF1A",
      entry.reason,
      entry.evidence && readSource && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => readSource(entry.evidence), children: "\u8BFB\u53D6\u539F\u59CB\u4F9D\u636E" })
    ] }, index))
  ] });
}

// packages/dsh-px-memory/src/knowledge-panel.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
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
  project,
  skillRequest
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
  const draft = (0, import_react5.useMemo)(() => {
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
  const [scope, setScope] = (0, import_react5.useState)(saved.scope), [catalog, setCatalog] = (0, import_react5.useState)(null), [selected, setSelected] = (0, import_react5.useState)(saved.selected);
  const [query, setQuery] = (0, import_react5.useState)(""), [rows, setRows] = (0, import_react5.useState)([]), [error, setError] = (0, import_react5.useState)(""), [notice, setNotice] = (0, import_react5.useState)(""), [busy, setBusy] = (0, import_react5.useState)(false);
  const [editing, setEditing] = (0, import_react5.useState)(saved.editing), [key, setKey] = (0, import_react5.useState)(saved.key), [body, setBody] = (0, import_react5.useState)(saved.body), [paths, setPaths] = (0, import_react5.useState)(saved.paths), [editRevision, setEditRevision] = (0, import_react5.useState)(saved.revision), [destination, setDestination] = (0, import_react5.useState)("project");
  const [tab, setTab] = (0, import_react5.useState)(saved.editing ? saved.tab : skillRequest ? "skills" : saved.tab), [skillDirectories, setSkillDirectories] = (0, import_react5.useState)(saved.skillDirectories), [skills, setSkills] = (0, import_react5.useState)([]), [skill, setSkill] = (0, import_react5.useState)(saved.skill), [skillName, setSkillName] = (0, import_react5.useState)(saved.skillName), [skillDescription, setSkillDescription] = (0, import_react5.useState)(saved.skillDescription), [skillEnabled, setSkillEnabled] = (0, import_react5.useState)(saved.skillEnabled), [skillScope, setSkillScope] = (0, import_react5.useState)(saved.skillScope);
  (0, import_react5.useEffect)(() => {
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
  (0, import_react5.useEffect)(() => {
    if (tab !== "knowledge") return;
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
  }, [url, scope, tab]);
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
    setSkillScope(
      v.skill.source === "persona-private" ? "persona" : v.skill.source === "user-dsh" ? "global" : "project"
    );
    setEditing(false);
  };
  const cancelEditing = () => run(async () => {
    const documentId = selected?.id, name = skill?.skill.name;
    draft?.clear();
    setEditing(false);
    setBody("");
    setSelected(null);
    setSkill(null);
    setNotice("");
    if (tab === "skills") {
      const value = await call("skills", { action: "list" });
      setSkills(value.skills);
      setSkillDirectories(value.directories);
      if (name) await readSkill(name);
    } else {
      await refresh();
      if (documentId) await read(documentId);
    }
  });
  const handledSkill = (0, import_react5.useRef)(void 0);
  (0, import_react5.useEffect)(() => {
    if (!skillRequest || skillRequest.serial === handledSkill.current || editing || busy) return;
    handledSkill.current = skillRequest.serial;
    void run(async () => {
      setTab("skills");
      const value = await call("skills", { action: "list" });
      setSkills(value.skills);
      setSkillDirectories(value.directories);
      await readSkill(skillRequest.name);
    });
  }, [skillRequest?.serial, editing, busy]);
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "px-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { style: controlStyle, disabled: busy || editing, onClick: () => setTab("knowledge"), children: "\u77E5\u8BC6" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
    error && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { role: "alert", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { role: "status", children: notice }),
    editing && skillRequest && skillRequest.serial !== handledSkill.current && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { role: "status", children: [
      "\u5DF2\u6709\u672A\u4FDD\u5B58\u7684\u77E5\u8BC6\u6216\u6280\u80FD\u8349\u7A3F\u3002\u4FDD\u5B58\u6216\u53D6\u6D88\u540E\uFF0C\u518D\u6253\u5F00\u6280\u80FD ",
      skillRequest.name,
      "\u3002"
    ] }),
    editing && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { role: "status", className: "px-muted", children: "\u7F16\u8F91\u8349\u7A3F\u4FDD\u7559\u5728\u5F53\u524D\u7A97\u53E3\u3002\u8FD4\u56DE\u6216\u5207\u6362\u4F1A\u8BDD\u4E0D\u4F1A\u81EA\u52A8\u63D0\u4EA4\uFF1B\u4FDD\u5B58\u4ECD\u68C0\u67E5\u539F\u7248\u672C\uFF0C\u907F\u514D\u8986\u76D6\u540E\u6765\u4FEE\u6539\u3002" }),
    tab === "knowledge" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "px-muted", children: "\u540C\u4E00\u4E3B\u9898\u53EA\u7EF4\u62A4\u4E00\u4EFD\u73B0\u884C\u7ED3\u8BBA\u3002\u7EA0\u6B63\u65F6\u7F16\u8F91\u539F\u6761\u76EE\uFF1B\u4E34\u65F6\u4EFB\u52A1\u8FDB\u5EA6\u653E\u5728\u5DE5\u4F5C\u8D26\u672C\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { children: [
        "\u8C01\u53EF\u4EE5\u4F7F\u7528\uFF1F",
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
            children: scopes.map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "px-muted", children: scope === "global" ? "\u6240\u6709\u4EBA\u683C\u3001\u6240\u6709\u9879\u76EE\u53EF\u7528\u3002" : scope === "project" ? "\u672C\u9879\u76EE\u7684\u6240\u6709\u4EBA\u683C\u53EF\u7528\u3002" : scope === "persona-project" ? "\u4EC5\u5F53\u524D\u4EBA\u683C\u5728\u672C\u9879\u76EE\u53EF\u7528\u3002" : "\u4EC5\u5F53\u524D\u4EBA\u683C\u53EF\u7528\uFF0C\u53EF\u8DE8\u9879\u76EE\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { style: controlStyle, disabled: busy || editing, onClick: () => void run(refresh), children: "\u5168\u90E8" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { style: controlStyle, disabled: busy || editing || !catalog, onClick: () => edit(null), children: "\u65B0\u589E" })
      ] }),
      !catalog && !error && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u77E5\u8BC6\u8303\u56F4\u2026" }),
      catalog && !rows.length && !editing && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "px-muted", children: "\u6682\u65E0\u5339\u914D\u77E5\u8BC6\u3002\u65B0\u5EFA\u6761\u76EE\u6216\u6362\u4E2A\u5173\u952E\u8BCD\u3002" }),
      !editing && rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
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
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("small", { children: [
              "\xB7 v",
              row.revision,
              row.updatedAt ? " \xB7 " + new Date(row.updatedAt).toLocaleDateString() : "",
              row.status === "archived" ? " \xB7 \u5DF2\u5F52\u6863" : ""
            ] })
          ]
        },
        row.id
      )),
      selected && !editing && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { ...cardStyle, marginTop: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("strong", { children: [
          selected.key,
          " \xB7 v",
          selected.revision
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "px-muted", children: [
          selected.author?.kind === "human" ? "\u7528\u6237\u7F16\u5199 / \u7EA0\u6B63" : selected.author?.kind === "model" ? "\u6A21\u578B\u6574\u7406" : "\u4F5C\u8005\u672A\u6807\u6CE8",
          "\uFF1B\u6587\u4EF6\u5F15\u7528\u53EA\u6838\u5BF9\u7248\u672C\u662F\u5426\u53D8\u5316\uFF0C\u4E0D\u4EE3\u8868\u6B63\u6587\u5DF2\u88AB\u9010\u6761\u8BC1\u5B9E\u3002"
        ] }),
        !selected.current && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { role: "status", children: selected.feedback?.disputed ? "\u6B64\u4EBA\u683C\u5DF2\u5C06\u8BE5\u4FEE\u8BA2\u6807\u4E3A\u4E0D\u6B63\u786E\uFF0C\u7EA0\u6B63\u524D\u4E0D\u4F5C\u4E3A\u5F53\u524D\u7ED3\u8BBA\u4F7F\u7528\u3002" : "\u8FD9\u6761\u77E5\u8BC6\u5DF2\u8FC7\u65F6\u3001\u5DF2\u5F52\u6863\u6216\u6765\u6E90\u65E0\u6CD5\u9A8C\u8BC1\uFF0C\u4E0D\u4F5C\u4E3A\u5F53\u524D\u7ED3\u8BBA\u4F7F\u7528\u3002" }),
        selected.body !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("pre", { style: { whiteSpace: "pre-wrap", fontFamily: "inherit" }, children: selected.body }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { disabled: busy, onClick: () => void run(() => read(selected.id, true)), children: "\u67E5\u770B\u5386\u53F2\u6B63\u6587" }),
        selected.sources?.map((s) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "px-muted", children: [
          s.path,
          " \xB7",
          " ",
          s.state === "current" ? "\u7248\u672C\u4E00\u81F4" : s.state === "changed" ? "\u6587\u4EF6\u5DF2\u53D8\u5316" : s.state === "missing" ? "\u6587\u4EF6\u4E0D\u5B58\u5728" : "\u6682\u4E0D\u53EF\u9A8C\u8BC1"
        ] }, s.path)),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "px-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "button",
            {
              disabled: busy || selected.status !== "active" || selected.body === void 0,
              onClick: () => edit(selected),
              children: "\u7F16\u8F91 / \u7EA0\u6B63"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          MemoryFeedbackPanel,
          {
            value: selected.feedback,
            busy,
            disabled: selected.status !== "active",
            submit: (kind, reason) => run(async () => {
              const result = await call("knowledge", {
                action: "feedback",
                scope,
                id: selected.id,
                documentRevision: selected.revision,
                kind,
                reason
              });
              setSelected(result.document);
              setNotice(result.duplicate ? "\u6B64\u4FEE\u8BA2\u5DF2\u7ECF\u8BB0\u5F55\u8FC7\u540C\u7C7B\u53CD\u9988\uFF0C\u672A\u91CD\u590D\u52A0\u6743\u3002" : "\u53CD\u9988\u5DF2\u8BB0\u5F55\u3002");
            })
          },
          selected.id + ":" + selected.revision
        ),
        selected.current && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "px-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "select",
            {
              "aria-label": "\u5206\u4EAB\u76EE\u6807\u8303\u56F4",
              value: destination,
              disabled: busy,
              onChange: (e) => setDestination(e.target.value),
              children: scopes.map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
      editing && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { ...cardStyle, marginTop: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { children: [
          "\u4E3B\u9898",
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { children: [
          "\u73B0\u884C\u6B63\u6587",
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { children: [
          "\u6765\u6E90\u6587\u4EF6\uFF08\u53EF\u9009\uFF0C\u6BCF\u884C\u4E00\u4E2A\uFF09",
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "px-muted", children: "\u4FDD\u5B58\u65F6\u8BB0\u5F55\u6587\u4EF6\u7248\u672C\u3002\u6765\u6E90\u6539\u53D8\u540E\u9700\u91CD\u65B0\u6838\u5BF9\u5E76\u66F4\u65B0\u672C\u6761\u76EE\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "px-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { disabled: busy, onClick: () => void cancelEditing(), children: "\u53D6\u6D88\u7F16\u8F91" })
        ] })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "px-muted", children: "\u5217\u8868\u4E0E\u52A0\u8F7D\u4F7F\u7528 DSH \u539F\u751F Skills\u3002\u4EBA\u683C\u79C1\u6709\u6280\u80FD\u53EA\u5728\u672C\u4EBA\u7684\u4F1A\u8BDD\u4E2D\u53D1\u73B0\uFF0C\u540C\u540D\u65F6\u4F18\u5148\uFF1B\u9879\u76EE\u6280\u80FD\u4F18\u5148\u4E8E\u672C\u673A\u516C\u5171\u6280\u80FD\u3002\u53EA\u6709\u672C\u9875\u521B\u5EFA\u7684\u6280\u80FD\u53EF\u5728\u6B64\u7F16\u8F91\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
      skillDirectories && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("details", { className: "px-muted", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("summary", { children: "\u6280\u80FD\u5B58\u50A8\u4F4D\u7F6E" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { children: [
          "\u9879\u76EE\u6280\u80FD\u76EE\u5F55\uFF1A",
          skillDirectories.project ?? "\u672A\u9009\u62E9\u9879\u76EE",
          "\uFF1B\u5168\u5C40\u6280\u80FD\u76EE\u5F55\uFF1A",
          skillDirectories.global,
          skillDirectories.persona && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
            "\uFF1B\u4EBA\u683C\u79C1\u6709\u76EE\u5F55\uFF1A",
            skillDirectories.persona
          ] })
        ] })
      ] }),
      !editing && skills.map((item) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
        "button",
        {
          style: { ...controlStyle, width: "100%", textAlign: "left", marginTop: 6 },
          disabled: busy,
          onClick: () => void run(() => readSkill(item.name)),
          children: [
            item.name,
            " \xB7",
            " ",
            {
              "persona-private": "\u4EC5\u6B64\u4EBA\u683C",
              "project-dsh": "\u672C\u9879\u76EE",
              "user-dsh": "\u672C\u673A\u516C\u5171",
              bundled: "\u968F\u5305\u63D0\u4F9B"
            }[item.source] ?? item.source,
            !item.invocation?.modelInvocable ? " \xB7 \u4E0D\u81EA\u52A8\u8C03\u7528" : ""
          ]
        },
        item.name
      )),
      skill && !editing && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: cardStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { children: skill.skill.name }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: skill.skill.description }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "px-muted", children: skill.skill.path ?? skill.skill.provider }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("pre", { style: { whiteSpace: "pre-wrap" }, children: skill.skill.content }),
        skill.managed ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { disabled: busy, onClick: () => setEditing(true), children: "\u7F16\u8F91 / \u542F\u505C" }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "px-muted", children: "\u7531\u539F\u751F\u6216\u7B2C\u4E09\u65B9\u6765\u6E90\u7BA1\u7406\uFF0C\u8BF7\u5728\u539F\u6587\u4EF6\u4E2D\u4FEE\u6539\u3002" })
      ] }),
      editing && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: cardStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
          "select",
          {
            "aria-label": "\u6280\u80FD\u8303\u56F4",
            disabled: busy || !!skill,
            value: skillScope,
            onChange: (e) => setSkillScope(e.target.value),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "project", disabled: !project, children: "\u672C\u9879\u76EE" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "global", children: "\u672C\u673A\u516C\u5171" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "persona", disabled: !skillDirectories?.persona, children: "\u4EC5\u6B64\u4EBA\u683C" })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "textarea",
          {
            "aria-label": "\u6280\u80FD\u6B63\u6587",
            style: { ...controlStyle, width: "100%", minHeight: 180 },
            disabled: busy,
            value: body,
            onChange: (e) => setBody(e.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "px-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { disabled: busy, onClick: () => void cancelEditing(), children: "\u53D6\u6D88\u7F16\u8F91" })
        ] })
      ] })
    ] })
  ] });
}

// packages/dsh-px-memory/src/mnemon-page.tsx
var import_react6 = require("react");
var import_jsx_runtime7 = require("react/jsx-runtime");
function KnowledgeSourcePage({
  source,
  openSession
}) {
  const [rows, setRows] = (0, import_react6.useState)([]), [scope, setScope] = (0, import_react6.useState)(""), [document2, setDocument] = (0, import_react6.useState)(null), [error, setError] = (0, import_react6.useState)(""), [busy, setBusy] = (0, import_react6.useState)(false);
  (0, import_react6.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "px-ui", style: { padding: 16, overflowWrap: "anywhere" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: "PX \u77E5\u8BC6" }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "\u4EBA\u683C\u79C1\u6709\u4E0E\u516C\u5171\u77E5\u8BC6\u5206\u5F00\u4FDD\u5B58\u3002\u8FD9\u91CC\u53EA\u5C55\u793A\u5F53\u524D\u539F\u751F\u8BBF\u95EE\u8303\u56F4\uFF1B\u7F16\u8F91\u3001\u5206\u4EAB\u548C Skills \u7BA1\u7406\u53EF\u4ECE\u7EDF\u4E00\u7684\u201C\u8BB0\u5FC6\u4E0E\u77E5\u8BC6\u201D\u9875\u9762\u8FDB\u5165\u3002" }),
    !source.sessionId && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "px-muted", children: "\u5F53\u524D\u6CA1\u6709\u7ED1\u5B9A\u4F1A\u8BDD\uFF0C\u4EC5\u663E\u793A\u516C\u5171\u8303\u56F4\u3002\u79C1\u6709\u77E5\u8BC6\u9700\u8981\u5148\u9009\u62E9\u5BF9\u5E94\u4EBA\u683C\u7684\u4F1A\u8BDD\u3002" }),
    source.sessionId && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: controlStyle, onClick: () => openSession(source.sessionId), children: "\u8FD4\u56DE\u8BB0\u5FC6\u4E0E\u77E5\u8BC6" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "alert", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
        children: rows.map((r) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: r.scope, children: r.label }, r.scope))
      }
    ),
    (rows.find((r) => r.scope === scope)?.documents ?? []).map((d) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
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
    document2 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { ...cardStyle, marginTop: 12 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("strong", { children: [
        document2.key,
        " \xB7 v",
        document2.revision
      ] }),
      !document2.current && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "status", children: "\u5DF2\u8FC7\u65F6\u3001\u5DF2\u5F52\u6863\u6216\u6765\u6E90\u6682\u4E0D\u53EF\u9A8C\u8BC1\uFF0C\u4E0D\u4F5C\u4E3A\u5F53\u524D\u7ED3\u8BBA\u3002" }),
      document2.body !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("pre", { style: { whiteSpace: "pre-wrap", fontFamily: "inherit" }, children: document2.body }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { disabled: busy, onClick: () => void read(document2.id, true), children: "\u67E5\u770B\u5386\u53F2\u6B63\u6587" })
    ] })
  ] });
}
function registerMnemonKnowledgePage(host, openWorkspace) {
  return host.slots.inject(
    "mnemon.source.page",
    () => host.slots.register(
      { name: "mnemon.source.page", id: "px-knowledge/library", order: 100, label: "PX \u77E5\u8BC6" },
      Object.assign(
        (props) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(KnowledgeSourcePage, { source: props, openSession: openWorkspace }),
        { mnemonNavigation: { group: "storage", primary: true, glyph: "\u25C7", detail: "\u4EBA\u683C\u3001\u9879\u76EE\u4E0E\u5171\u4EAB\u77E5\u8BC6" } }
      )
    )
  );
}

// packages/dsh-px-memory/src/mnemon-skill-navigation.tsx
var import_react7 = require("react");

// packages/dsh-px-memory/src/workspace-navigation.ts
function skillAnchorName(anchor, currentSessionId) {
  if (!currentSessionId || anchor?.page !== "skills/library" || anchor.sessionId !== void 0 && anchor.sessionId !== currentSessionId || typeof anchor.seed !== "string")
    return;
  const match = /^name:([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(anchor.seed);
  return match && match[1].length <= 80 ? match[1] : void 0;
}
function memoryNavigation(host, component, icon, events = typeof window === "undefined" ? void 0 : window, routes) {
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
    if (host.layout.panelInfo.getSnapshot().activePanelId !== "mnemon") {
      routes?.reset();
      if (advanced) restore();
    }
  });
  const hasNative = () => host.slots.entries("main").some((entry) => entry.options.key === "mnemon" && entry.component !== component);
  const stopEntries = host.slots.subscribe("main", () => {
    if (advanced && ready && !hasNative()) restore();
  });
  const openNative = () => {
    if (!hasNative()) throw Error("\u539F\u751F\u8BB0\u5FC6\u7BA1\u7406\u9875\u672A\u542F\u7528\u3002\u8BF7\u5728 Mnemon \u914D\u7F6E\u4E2D\u542F\u7528\u9875\u9762\uFF0C\u5E76\u9009\u62E9\u4FA7\u680F\u5C55\u793A\u3002");
    advanced = true;
    routes?.reset();
    stopMain?.();
    stopMain = void 0;
    host.layout.selectPanel("mnemon");
  };
  const onAnchor = (event) => {
    const page = event.detail?.page;
    if (disposed || typeof page !== "string" || !page || !hasNative()) return;
    if (page.split("/")[0] === "skills" && host.slots.entries("main").some((entry) => entry.options.key === "mnemon-skills"))
      return;
    openNative();
  };
  events?.addEventListener("mnemon:anchor", onAnchor);
  return {
    open: () => {
      routes?.reset();
      restore();
      host.layout.selectPanel("mnemon");
    },
    openNative,
    openSkillView: () => {
      restore();
      host.layout.selectPanel("mnemon");
    },
    dispose: () => {
      disposed = true;
      events?.removeEventListener("mnemon:anchor", onAnchor);
      stopSelection();
      stopEntries();
      stop();
      stopMain?.();
      stopMain = void 0;
    }
  };
}

// packages/dsh-px-memory/src/mnemon-skill-slot.ts
function mountMnemonSkillPage(host, wrap) {
  const slot = "mnemon.source.page", id = "skills/library";
  return host.slots.inject(slot, () => {
    let own, native, remove;
    const refresh = () => {
      const entry = host.slots.entries(slot).filter((entry2) => entry2.options.id === id && entry2.component !== own).sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0];
      if (native === entry?.component) return;
      remove?.();
      remove = void 0;
      native = entry?.component;
      if (!native) return;
      own = Object.assign(wrap(native), {
        ...native.mnemonNavigation ? { mnemonNavigation: native.mnemonNavigation } : {}
      });
      remove = host.slots.register({ name: slot, id, priority: -10 }, own);
    };
    const off = host.slots.subscribe(slot, refresh);
    refresh();
    return () => {
      off();
      remove?.();
    };
  });
}

// packages/dsh-px-memory/src/mnemon-skill-navigation.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
function SkillPageRoute({
  source,
  Native,
  open
}) {
  const input = source.navigationInput;
  const name = skillAnchorName(
    { page: "skills/library", seed: input?.seed, sessionId: source.sessionId },
    source.sessionId
  );
  const [waiting, setWaiting] = (0, import_react7.useState)(false);
  (0, import_react7.useEffect)(() => {
    if (name && source.sessionId) setWaiting(!open(source.sessionId, name));
  }, [source.sessionId, source.navigationInput, name]);
  if (!name || !source.sessionId) return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Native, { ...source });
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { role: "status", children: waiting ? "\u8BF7\u5148\u6253\u5F00\u6765\u6E90\u4F1A\u8BDD\uFF0C\u518D\u67E5\u770B\u8BE5\u4F1A\u8BDD\u5B9E\u9645\u4F7F\u7528\u7684\u6280\u80FD\u3002" : "\u6B63\u5728\u6253\u5F00\u672C\u4F1A\u8BDD\u7684\u6280\u80FD\u2026" });
}
function registerMnemonSkillNavigation(host, open) {
  return mountMnemonSkillPage(host, (Native) => (source) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(SkillPageRoute, { source, Native, open }));
}

// packages/dsh-px-memory/src/memory-workspace.tsx
var import_react10 = require("react");

// packages/dsh-px-memory/src/persona-hub-panel.tsx
var import_react9 = require("react");

// packages/dsh-px-memory/src/persona-resources-panel.tsx
var import_react8 = require("react");
var import_jsx_runtime9 = require("react/jsx-runtime");
var defaults = () => ({
  revision: 0,
  tools: { mode: "native", names: [] },
  channels: { mode: "native", accounts: [] }
});
function PersonaResourcesPanel({ personaId }) {
  const [view, setView] = (0, import_react8.useState)(null), [draft, setDraft] = (0, import_react8.useState)(defaults), [error, setError] = (0, import_react8.useState)(""), [busy, setBusy] = (0, import_react8.useState)(false), [saved, setSaved] = (0, import_react8.useState)(false), [filter, setFilter] = (0, import_react8.useState)(""), [accounts, setAccounts] = (0, import_react8.useState)(""), [epoch, setEpoch] = (0, import_react8.useState)(0);
  (0, import_react8.useEffect)(() => {
    const ac = new AbortController();
    setView(null);
    setError("");
    setSaved(false);
    void requestJson(
      `/dsh-px-personas?view=resources&personaId=${encodeURIComponent(personaId)}`,
      { signal: ac.signal }
    ).then((result) => {
      if (ac.signal.aborted) return;
      setView(result);
      setDraft(result.policy ?? defaults());
      setAccounts(
        (result.policy?.channels.accounts ?? []).map((row) => `${row.provider}:${row.accountId}`).join("\n")
      );
    }).catch((e) => {
      if (!ac.signal.aborted) setError(e.message);
    });
    return () => ac.abort();
  }, [personaId, epoch]);
  const names = new Map((view?.tools ?? []).map((row) => [row.name, row.description]));
  for (const name of draft.tools.names)
    if (!names.has(name)) names.set(name, "\u5F53\u524D\u672A\u52A0\u8F7D\uFF1B\u4FDD\u7559\u914D\u7F6E\uFF0C\u5DE5\u5177\u6062\u590D\u540E\u4ECD\u53D7\u6B64\u89C4\u5219\u7EA6\u675F");
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "px-card", style: { marginTop: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: "\u63A7\u5236\u6B64\u4EBA\u683C\u53EF\u4EE5\u8C03\u7528\u7684\u5DE5\u5177\u3002\u5B9E\u9645\u64CD\u4F5C\u4ECD\u987B\u901A\u8FC7\u4F1A\u8BDD\u6743\u9650\u3001\u5E94\u7528\u6388\u6743\u548C\u804A\u5929\u6210\u5458\u89C4\u5219\u3002\u6536\u7D27\u7ACB\u5373\u7EA6\u675F\u540E\u7EED\u8C03\u7528\uFF1B\u65B0\u589E\u6388\u6743\u4ECE\u4E0B\u4E00\u8F6E\u5F00\u59CB\u4F7F\u7528\u3002\u6B63\u5728\u6267\u884C\u7684\u64CD\u4F5C\u8BF7\u7528\u539F\u751F\u201C\u505C\u6B62\u201D\u7ED3\u675F\u3002" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { role: "alert", children: error }),
    saved && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { role: "status", children: "\u8D44\u6E90\u89C4\u5219\u5DF2\u4FDD\u5B58\u3002" }),
    view ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("fieldset", { disabled: busy, style: { border: 0, padding: 0 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { children: [
        "\u5DE5\u5177\u8303\u56F4",
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
          "select",
          {
            "aria-label": "\u4EBA\u683C\u5DE5\u5177\u8303\u56F4",
            value: draft.tools.mode,
            onChange: (e) => {
              setSaved(false);
              setDraft({ ...draft, tools: { ...draft.tools, mode: e.target.value } });
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "native", children: "\u6CBF\u7528\u539F\u751F\u4F1A\u8BDD\u53EF\u7528\u5DE5\u5177" }),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "selected", children: "\u53EA\u5141\u8BB8\u9009\u4E2D\u7684\u5DE5\u5177" })
            ]
          }
        )
      ] }),
      draft.tools.mode === "selected" && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "px-muted", children: "\u672A\u9009\u4E2D\u4EFB\u4F55\u5DE5\u5177\u65F6\uFF0C\u53EA\u80FD\u5BF9\u8BDD\u3002\u65B0\u63D2\u4EF6\u7684\u5DE5\u5177\u4E0D\u4F1A\u81EA\u52A8\u52A0\u5165\u3002\u5141\u8BB8\u7EC8\u7AEF\u3001\u811A\u672C\u6216\u4EE3\u7406\u8F6C\u53D1\u5DE5\u5177\u610F\u5473\u7740\u5141\u8BB8\u5176\u80FD\u529B\uFF0C\u4E0D\u80FD\u636E\u6B64\u5BA3\u79F0\u64CD\u4F5C\u7CFB\u7EDF\u9694\u79BB\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          "input",
          {
            "aria-label": "\u7B5B\u9009\u4EBA\u683C\u5DE5\u5177",
            placeholder: "\u7B5B\u9009\u5DE5\u5177\u540D\u79F0\u6216\u8BF4\u660E",
            value: filter,
            onChange: (e) => setFilter(e.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { maxHeight: 280, overflow: "auto" }, children: [...names].filter(
          ([name, description]) => (name + description).toLowerCase().includes(filter.toLowerCase())
        ).map(([name, description]) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { style: { display: "block", margin: "8px 0" }, title: description, children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
            "input",
            {
              type: "checkbox",
              checked: draft.tools.names.includes(name),
              onChange: (e) => {
                setSaved(false);
                setDraft({
                  ...draft,
                  tools: {
                    ...draft.tools,
                    names: e.target.checked ? [...draft.tools.names, name] : draft.tools.names.filter((n) => n !== name)
                  }
                });
              }
            }
          ),
          " ",
          name,
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "px-muted", children: description.slice(0, 80) })
        ] }, name)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { marginTop: 12 }, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { children: [
        "QQ \u8D26\u53F7\u8303\u56F4",
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
          "select",
          {
            "aria-label": "\u4EBA\u683CQQ\u8D26\u53F7\u8303\u56F4",
            value: draft.channels.mode,
            onChange: (e) => {
              setSaved(false);
              setDraft({ ...draft, channels: { ...draft.channels, mode: e.target.value } });
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "native", children: "\u6CBF\u7528\u5DF2\u914D\u7F6E\u7684\u8D26\u53F7\u4E0E\u804A\u5929\u8DEF\u7531" }),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "selected", children: "\u4EC5\u6307\u5B9A\u8D26\u53F7" })
            ]
          }
        )
      ] }) }),
      draft.channels.mode === "selected" && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { style: { display: "block", marginTop: 8 }, children: [
        "\u6BCF\u884C\u586B\u5199 qq:\u8D26\u53F7ID\uFF1B\u7559\u7A7A\u7981\u7528 QQ",
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          "textarea",
          {
            "aria-label": "\u4EBA\u683C\u5141\u8BB8\u7684QQ\u8D26\u53F7",
            rows: 3,
            value: accounts,
            onChange: (e) => {
              setAccounts(e.target.value);
              setSaved(false);
            }
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "px-muted", children: "\u8D26\u53F7\u89C4\u5219\u7EA6\u675F PX \u7684 QQ \u8DEF\u7531\u3001\u901A\u77E5\u4E0E\u4EA4\u4ED8\uFF0C\u5176\u4ED6\u6E20\u9053\u4ECD\u7531\u5DE5\u5177\u8303\u56F4\u548C\u539F\u751F\u914D\u7F6E\u63A7\u5236\u3002\u5B83\u4E0D\u4F1A\u65AD\u5F00\u5176\u4ED6\u4EBA\u683C\u5171\u7528\u7684\u8D26\u53F7\u3002" }),
      draft.expiresAt && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { children: [
        "\u73B0\u6709\u6388\u6743\u622A\u6B62\uFF1A",
        draft.expiresAt,
        "\u3002\u5230\u671F\u540E\u505C\u6B62\u6388\u4E88\u5DE5\u5177\u548C\u8D26\u53F7\u8BBF\u95EE\u3002",
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          "button",
          {
            onClick: () => {
              const { expiresAt: _, ...next } = draft;
              setDraft(next);
              setSaved(false);
            },
            children: "\u79FB\u9664\u5230\u671F\u65F6\u95F4"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          "button",
          {
            onClick: () => {
              setBusy(true);
              setError("");
              setSaved(false);
              const rows = accounts.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
              if (rows.some((row) => !/^qq:[^\s:]{1,200}$/.test(row))) {
                setError("\u8D26\u53F7\u683C\u5F0F\u5E94\u4E3A qq:\u8D26\u53F7ID");
                setBusy(false);
                return;
              }
              const policy = {
                ...draft,
                channels: {
                  ...draft.channels,
                  accounts: rows.map((row) => ({ provider: "qq", accountId: row.slice(3) }))
                }
              };
              void requestJson("/dsh-px-personas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "resources",
                  personaId,
                  revision: view.policy?.revision ?? 0,
                  policy
                })
              }).then((result) => {
                setView({ ...view, policy: result.policy });
                setDraft(result.policy);
                setSaved(true);
              }).catch((e) => setError(e.message)).finally(() => setBusy(false));
            },
            children: "\u4FDD\u5B58\u8D44\u6E90\u89C4\u5219"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { onClick: () => setEpoch((v) => v + 1), children: "\u653E\u5F03\u8349\u7A3F\u5E76\u91CD\u65B0\u8BFB\u53D6" })
      ] })
    ] }) : !error && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u8D44\u6E90\u89C4\u5219\u2026" })
  ] });
}

// packages/dsh-px-memory/src/persona-navigation-client.ts
var selectionKey = "dsh-px-persona-directory";
var pendingKey = "dsh-px-persona-new-pending";
var transientSelection;
var savedPersona = () => {
  try {
    const value = sessionStorage.getItem(selectionKey);
    return value && /^(?:default|[a-f0-9-]{36})$/.test(value) ? value : void 0;
  } catch {
    return transientSelection;
  }
};
var rememberPersona = (value) => {
  transientSelection = value;
  try {
    if (value) sessionStorage.setItem(selectionKey, value);
    else sessionStorage.removeItem(selectionKey);
  } catch {
  }
};
function personaNavigationClient(ports) {
  const pending = ports.load();
  return {
    capture() {
      const selection = ports.selection(), key = JSON.stringify(selection);
      return {
        key,
        transport: async (request) => {
          const operation = JSON.stringify([key, request.workspaceId, request.agentPreset]), requestId = pending[operation] ?? ports.uuid();
          pending[operation] = requestId;
          ports.save(pending);
          const result = await ports.post({
            type: "navigate-new",
            ...selection,
            workspaceId: request.workspaceId,
            agentPreset: request.agentPreset,
            requestId
          });
          if (pending[operation] === requestId) {
            delete pending[operation];
            ports.save(pending);
          }
          return result;
        }
      };
    }
  };
}
function registerPersonaNavigationClient(host) {
  if (host.sessions.pxPersonaTransportVersion !== 1 || host.uiWorkspace.pxPersonaNavigationVersion !== 1)
    return () => {
    };
  const navigation = personaNavigationClient({
    selection: () => {
      const personaId = savedPersona();
      return personaId ? { personaId } : { currentSessionId: selectedSession(host.sessions.list.getSnapshot(), null) };
    },
    load: () => {
      try {
        const entries = JSON.parse(sessionStorage.getItem(pendingKey) ?? "{}");
        if (!entries || typeof entries !== "object" || Array.isArray(entries)) return /* @__PURE__ */ Object.create(null);
        return Object.fromEntries(
          Object.entries(entries).filter(
            ([key, value]) => key.length < 1e3 && typeof value === "string" && /^[a-f0-9-]{36}$/.test(value)
          )
        );
      } catch {
        return /* @__PURE__ */ Object.create(null);
      }
    },
    save: (value) => {
      try {
        sessionStorage.setItem(pendingKey, JSON.stringify(value));
      } catch {
      }
    },
    uuid: () => crypto.randomUUID(),
    post: (body) => requestJson("/dsh-px-personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  });
  return host.effect(() => {
    host.provide("pxPersonaNavigation", navigation);
  }, "memory: native New persona selection");
}

// packages/dsh-px-memory/src/persona-hub-panel.tsx
var import_jsx_runtime10 = require("react/jsx-runtime");
function PersonaHubPanel({
  openSession,
  titles,
  currentSessionId,
  prepareCreatedSession,
  nativeNavigation = false
}) {
  const [personaId, setPersonaId] = (0, import_react9.useState)(savedPersona), [workspaceId, setWorkspaceId] = (0, import_react9.useState)("");
  const [view, setView] = (0, import_react9.useState)(null), [error, setError] = (0, import_react9.useState)("");
  const [busy, setBusy] = (0, import_react9.useState)(false), [newName, setNewName] = (0, import_react9.useState)(""), [refresh, setRefresh] = (0, import_react9.useState)(0);
  const request = (0, import_react9.useRef)(null);
  const alive = (0, import_react9.useRef)(true);
  (0, import_react9.useEffect)(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  (0, import_react9.useEffect)(() => {
    const ac = new AbortController();
    setError("");
    setView(null);
    const query = new URLSearchParams();
    if (personaId) query.set("personaId", personaId);
    if (currentSessionId) query.set("currentSessionId", currentSessionId);
    void requestJson("/dsh-px-personas?" + query, {
      signal: ac.signal
    }).then((data) => {
      if (ac.signal.aborted) return;
      setView(data);
      setWorkspaceId(
        (current) => data.workspaces.some((w) => w.id === current) ? current : data.workspaces[0]?.id ?? ""
      );
    }).catch((error2) => {
      if (ac.signal.aborted) return;
      if (personaId && error2.status === 404) {
        rememberPersona();
        setPersonaId(void 0);
      } else setError(error2.message);
    });
    return () => ac.abort();
  }, [personaId, refresh, currentSessionId]);
  const choosePersona = (value) => {
    rememberPersona(value);
    setPersonaId(value);
  };
  const run = async (work) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error2) {
      if (alive.current) setError(error2.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const post = (input) => requestJson("/dsh-px-personas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const selectedId = view?.selectedPersonaId ?? personaId ?? "default";
  const selected = view?.personas.find((p) => p.id === selectedId);
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "px-ui", style: { padding: 20, overflow: "auto", minHeight: 0 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h2", { children: "\u4EBA\u683C\u4E0E\u4F1A\u8BDD" }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "px-muted", children: "\u6BCF\u4E2A\u4EBA\u683C\u4F7F\u7528\u81EA\u5DF1\u7684\u4F1A\u8BDD\u3001\u8BB0\u5FC6\u548C\u79C1\u6709\u6280\u80FD\u3002\u5DF2\u5F00\u59CB\u7684\u4F1A\u8BDD\u4FDD\u7559\u539F\u8EAB\u4EFD\uFF0C\u6B63\u5728\u8FD0\u884C\u7684\u5DE5\u4F5C\u7EE7\u7EED\u3002" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { role: "alert", children: error }),
    !view && !error && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u4EBA\u683C\u76EE\u5F55\u2026" }),
    view && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { children: [
          view.nativeNavigation && nativeNavigation ? "\u672C\u7A97\u53E3\u4EBA\u683C" : "\u67E5\u770B\u4EBA\u683C",
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
            "select",
            {
              "aria-label": view.nativeNavigation && nativeNavigation ? "\u672C\u7A97\u53E3\u4EBA\u683C" : "\u67E5\u770B\u4EBA\u683C",
              value: selectedId,
              disabled: busy,
              onChange: (event) => choosePersona(event.target.value),
              children: view.personas.map((persona) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("option", { value: persona.id, children: [
                persona.name,
                persona.archived ? "\uFF08\u5DF2\u5F52\u6863\uFF09" : "",
                " \xB7 ",
                persona.sessionCount,
                " \u4E2A\u4F1A\u8BDD"
              ] }, persona.id))
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { disabled: busy, onClick: () => setRefresh((v) => v + 1), children: "\u5237\u65B0\u76EE\u5F55" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "px-muted", children: view.nativeNavigation && nativeNavigation ? `\u672C\u7A97\u53E3\u201C\u65B0\u5EFA\u4F1A\u8BDD\u201D\u4F7F\u7528${selected?.name ?? "\u6240\u9009\u4EBA\u683C"}\uFF0C\u53EF\u590D\u7528\u8BE5\u4EBA\u683C\u7684\u7A7A\u767D\u4F1A\u8BDD\u3002\u6253\u5F00\u5DF2\u6709\u4F1A\u8BDD\u4E0D\u4F1A\u6539\u53D8\u5176\u8EAB\u4EFD\u3002` : "\u5F53\u524D\u5BBF\u4E3B\u672A\u63A5\u5165\u539F\u751F\u65B0\u5EFA\uFF0C\u8BF7\u4F7F\u7528\u4E0B\u9762\u7684\u201C\u7528\u6B64\u4EBA\u683C\u65B0\u5EFA\u4F1A\u8BDD\u201D\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("details", { style: { marginTop: 16 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("summary", { children: "\u521B\u5EFA\u4EBA\u683C" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { children: [
          "\u4EBA\u683C\u540D\u79F0",
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
            "input",
            {
              "aria-label": "\u65B0\u5EFA\u4EBA\u683C\u540D\u79F0",
              maxLength: 60,
              value: newName,
              disabled: busy,
              onChange: (event) => setNewName(event.target.value)
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          "button",
          {
            disabled: busy || !newName.trim(),
            onClick: () => void run(async () => {
              const created = await post({ type: "create-persona", name: newName });
              if (alive.current) {
                setNewName("");
                choosePersona(created.id);
              }
            }),
            children: "\u521B\u5EFA\u72EC\u7ACB\u4EBA\u683C"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "px-actions", style: { marginTop: 16 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { children: [
          "\u5DE5\u4F5C\u533A",
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
            "select",
            {
              "aria-label": "\u4EBA\u683C\u65B0\u4F1A\u8BDD\u5DE5\u4F5C\u533A",
              value: workspaceId,
              disabled: busy,
              onChange: (event) => setWorkspaceId(event.target.value),
              children: [
                !view.workspaces.length && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "", children: "\u5148\u5728\u539F\u751F\u4FA7\u680F\u6DFB\u52A0\u5DE5\u4F5C\u533A" }),
                view.workspaces.map((workspace) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: workspace.id, children: workspace.title }, workspace.id))
              ]
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          "button",
          {
            disabled: busy || !workspaceId || !!selected?.archived,
            onClick: () => void run(async () => {
              const key = JSON.stringify([selectedId, workspaceId]);
              if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
              const requestId = request.current.id;
              const created = await post({
                type: "create-session",
                personaId: selectedId,
                workspaceId,
                requestId
              }).catch((error2) => {
                if (error2.status === 409 && request.current?.id === requestId) request.current = null;
                throw error2;
              });
              await prepareCreatedSession(created.createdSessionId);
              if (alive.current) {
                openSession(created.createdSessionId);
                request.current = null;
              }
            }),
            children: "\u7528\u6B64\u4EBA\u683C\u65B0\u5EFA\u4F1A\u8BDD"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("h3", { children: [
        selected?.name,
        "\u7684\u4F1A\u8BDD"
      ] }),
      !selected?.archived && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("details", { style: { marginBottom: 16 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("summary", { children: "\u53EF\u7528\u8D44\u6E90" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(PersonaResourcesPanel, { personaId: selectedId }, selectedId)
      ] }),
      !view.sessions.length && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: "\u8FD9\u4E2A\u4EBA\u683C\u8FD8\u6CA1\u6709\u5DF2\u4FDD\u5B58\u7684\u666E\u901A\u4F1A\u8BDD\u3002" }),
      view.sessions.map((row) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "px-card", style: { marginTop: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { disabled: busy, onClick: () => openSession(row.id), children: titles[row.id]?.displayTitle ?? `${row.channel ? row.channel + " \xB7 " : ""}${row.id}` }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "px-muted", children: [
          row.running ? "\u8FD0\u884C\u4E2D" : row.live ? "\u4F1A\u8BDD\u5DF2\u52A0\u8F7D" : "\u5DF2\u4FDD\u5B58",
          " \xB7 ",
          row.cwd ?? "\u65E0\u9879\u76EE\u76EE\u5F55"
        ] })
      ] }, row.id)),
      view.nextOffset !== null && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
        "button",
        {
          disabled: busy,
          onClick: () => void run(async () => {
            const more = await requestJson(
              `/dsh-px-personas?personaId=${encodeURIComponent(selectedId)}&offset=${view.nextOffset}`
            );
            if (alive.current)
              setView(
                (old) => old?.selectedPersonaId === more.selectedPersonaId ? {
                  ...more,
                  sessions: [
                    ...old.sessions,
                    ...more.sessions.filter(
                      (row) => !old.sessions.some((existing) => existing.id === row.id)
                    )
                  ]
                } : old
              );
          }),
          children: [
            "\u7EE7\u7EED\u8BFB\u53D6\u4F1A\u8BDD\uFF08\u5DF2\u663E\u793A ",
            view.sessions.length,
            " / ",
            view.total,
            "\uFF09"
          ]
        }
      )
    ] }),
    error && !view && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
      "button",
      {
        onClick: () => {
          choosePersona("default");
          setRefresh((v) => v + 1);
        },
        children: "\u8FD4\u56DE\u9ED8\u8BA4\u4EBA\u683C\u5E76\u91CD\u8BD5"
      }
    )
  ] });
}

// packages/dsh-px-memory/src/created-session-client.ts
async function catalogueCreatedSession(sessions, id) {
  if (typeof id !== "string" || !id.trim() || id.length > 200 || /[\r\n\0]/.test(id))
    throw new Error("\u670D\u52A1\u672A\u8FD4\u56DE\u6709\u6548\u4F1A\u8BDD\u7F16\u53F7");
  if (sessions.pxPersonaTransportVersion === 1) {
    await sessions.create({}, async () => ({ ok: true, value: { sessionId: id } }));
    return;
  }
  const known = () => Object.hasOwn(sessions.list.getSnapshot().byId, id);
  for (let attempt = 0; attempt < 2 && !known(); attempt++) await sessions.refresh();
  if (!known()) throw new Error("\u4F1A\u8BDD\u5DF2\u521B\u5EFA\uFF0C\u4F46\u539F\u751F\u76EE\u5F55\u5C1A\u672A\u663E\u793A\u5B83\uFF1B\u8BF7\u5237\u65B0\u76EE\u5F55\u540E\u6253\u5F00\uFF0C\u672A\u91CD\u590D\u521B\u5EFA\u3002");
}

// packages/dsh-px-memory/src/memory-workspace.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
function registerMemoryWorkspace(host, Panel) {
  let stopped = false;
  let requestedSkill, requestSerial = 0;
  const listeners = /* @__PURE__ */ new Set();
  const skillRequests = {
    getSnapshot: () => requestedSkill,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: () => {
      if (!requestedSkill) return;
      requestedSkill = void 0;
      for (const listener of listeners) listener();
    }
  };
  const openSettings = () => {
    const navigation2 = host.get?.("pluginNavigation") ?? host.pluginNavigation;
    if (!navigation2?.openBundle) throw Error("\u539F\u751F\u63D2\u4EF6\u914D\u7F6E\u5165\u53E3\u5C1A\u672A\u52A0\u8F7D\uFF0C\u8BF7\u4ECE\u5DE6\u4FA7\u201C\u63D2\u4EF6\u201D\u6253\u5F00 Mnemon\u3002");
    navigation2.openBundle("dsh-mnemon");
  };
  const Main = () => {
    const sessions = (0, import_react10.useSyncExternalStore)(host.sessions.list.subscribe, host.sessions.list.getSnapshot);
    const id = selectedSession(sessions, null);
    const skillRequest = (0, import_react10.useSyncExternalStore)(skillRequests.subscribe, skillRequests.getSnapshot);
    const [hub, setHub] = (0, import_react10.useState)(false);
    const directory = hub && !skillRequest || !id;
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
      "div",
      {
        className: "px-ui",
        style: { height: "100%", minWidth: 0, display: "flex", flexDirection: "column" },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "px-actions", style: { margin: "16px 20px 0", flexShrink: 0 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { onClick: () => host.layout.selectPanel(null), children: "\u8FD4\u56DE\u4F1A\u8BDD" }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
              "button",
              {
                "aria-pressed": directory,
                onClick: () => {
                  skillRequests.reset();
                  setHub(true);
                },
                children: "\u4EBA\u683C\u4E0E\u4F1A\u8BDD"
              }
            ),
            id && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
              "button",
              {
                "aria-pressed": !directory,
                onClick: () => {
                  skillRequests.reset();
                  setHub(false);
                },
                children: "\u5F53\u524D\u4EBA\u683C\u8D44\u6599"
              }
            ),
            id && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "px-muted", children: sessions.byId[id]?.displayTitle ?? "\u5F53\u524D\u4F1A\u8BDD" })
          ] }),
          directory ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
            PersonaHubPanel,
            {
              prepareCreatedSession: (target) => catalogueCreatedSession(host.sessions, target),
              nativeNavigation: host.sessions.pxPersonaTransportVersion === 1 && host.uiWorkspace.pxPersonaNavigationVersion === 1,
              currentSessionId: id ?? void 0,
              titles: sessions.byId,
              openSession: (target) => {
                host.uiWorkspace.openSession(target);
                setHub(false);
              }
            }
          ) : id ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
            Panel,
            {
              prepareCreatedSession: (target) => catalogueCreatedSession(host.sessions, target),
              sessionId: id,
              skillRequest: skillRequest?.sessionId === id ? skillRequest : void 0,
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
          ) : /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: { padding: 24 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("h2", { children: "\u8BB0\u5FC6\u4E0E\u77E5\u8BC6" }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { children: "\u5148\u4ECE\u5DE6\u4FA7\u6253\u5F00\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u5373\u53EF\u67E5\u770B\u8BE5\u4EBA\u683C\u7684\u8BB0\u5FC6\u3001\u7ECF\u5386\u548C\u9879\u76EE\u77E5\u8BC6\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "px-muted", children: "\u67E5\u770B\u5176\u4ED6\u4F1A\u8BDD\u4E0D\u4F1A\u6539\u53D8\u5B83\u7ED1\u5B9A\u7684\u4EBA\u683C\uFF0C\u4E5F\u4E0D\u4F1A\u81EA\u52A8\u542F\u52A8\u4EFB\u52A1\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { onClick: openSettings, children: "\u9AD8\u7EA7\uFF1AMnemon \u914D\u7F6E" })
          ] })
        ]
      }
    );
  };
  const Icon = ({ size = 20 }) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.6",
      "aria-hidden": "true",
      children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("path", { d: "M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15" })
    }
  );
  const navigation = memoryNavigation(host, Main, Icon, void 0, {
    reset: skillRequests.reset
  });
  return {
    ...navigation,
    openSkill: (sessionId, name) => {
      if (stopped) return false;
      const current = selectedSession(host.sessions.list.getSnapshot(), null);
      if (!skillAnchorName({ page: "skills/library", seed: "name:" + name, sessionId }, current)) return false;
      requestedSkill = { serial: ++requestSerial, sessionId, name };
      for (const listener of listeners) listener();
      navigation.openSkillView();
      return true;
    },
    open: (id) => {
      if (id) host.uiWorkspace.openSession(id);
      navigation.open();
    },
    dispose: () => {
      stopped = true;
      navigation.dispose();
      listeners.clear();
      requestedSkill = void 0;
    }
  };
}

// packages/shared/persona-scenes.ts
var SCENE_LABELS = {
  any: "\u4EFB\u4F55\u573A\u5408",
  chat: "\u65E5\u5E38\u4EA4\u6D41",
  work: "\u534F\u4F5C\u5DE5\u4F5C",
  delivery: "\u6B63\u5F0F\u4EA4\u4ED8"
};
function parseSceneRules(value) {
  if (value === void 0) return;
  if (!Array.isArray(value) || value.length > 12) throw Error("\u573A\u666F\u8868\u8FBE\u6700\u591A 12 \u6761");
  const ids = /* @__PURE__ */ new Set();
  const rules = value.map((rule) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule) || Object.keys(rule).some(
      (key) => ![
        "id",
        "scene",
        "provider",
        "accountId",
        "conversationId",
        "participantId",
        "instructions"
      ].includes(key)
    ) || typeof rule.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(rule.id) || ids.has(rule.id) || !Object.hasOwn(SCENE_LABELS, rule.scene) || typeof rule.instructions !== "string" || rule.instructions.length > 1e3 || rule.instructions.includes("\0"))
      throw Error("\u573A\u666F\u8868\u8FBE\u683C\u5F0F\u65E0\u6548");
    ids.add(rule.id);
    for (const key of ["provider", "accountId", "conversationId", "participantId"])
      if (rule[key] !== void 0 && (typeof rule[key] !== "string" || !rule[key].trim() || rule[key].length > 200 || /[\r\n\0]/.test(rule[key])))
        throw Error("\u573A\u666F\u5BF9\u8C61\u6807\u8BC6\u65E0\u6548");
    if (rule.provider && !/^[a-z][a-z0-9.-]{0,79}$/.test(rule.provider)) throw Error("\u573A\u666F\u6E20\u9053\u65E0\u6548");
    if ((rule.accountId || rule.conversationId || rule.participantId) && !rule.provider)
      throw Error("\u6307\u5B9A\u8D26\u53F7\u3001\u5BF9\u8C61\u6216\u804A\u5929\u65F6\u5FC5\u987B\u540C\u65F6\u9009\u62E9\u6E20\u9053");
    return { ...rule, instructions: rule.instructions.trim() };
  });
  if (rules.reduce((size, rule) => size + rule.instructions.length, 0) > 4e3)
    throw Error("\u573A\u666F\u8868\u8FBE\u5408\u8BA1\u6700\u591A 4000 \u5B57");
  return rules;
}
function renderSceneRules(rules, context) {
  if (!rules?.length || !context) return "";
  const matching = rules.filter(
    (rule) => rule.instructions.trim() && (!rule.provider || rule.provider === context.provider) && (!rule.accountId || rule.accountId === context.accountId) && (!rule.conversationId || rule.conversationId === context.conversationId) && (!rule.participantId || context.participants.includes(rule.participantId))
  ).sort(
    (a, b) => [a.provider, a.accountId, a.conversationId, a.participantId].filter(Boolean).length - [b.provider, b.accountId, b.conversationId, b.participantId].filter(Boolean).length
  );
  if (!matching.length) return "";
  return "\u5BF9\u8C61\u4E0E\u573A\u666F\u8868\u8FBE\uFF08\u53EA\u8C03\u6574\u6C9F\u901A\u65B9\u5F0F\uFF0C\u4E0D\u6539\u53D8\u8D44\u6599\u53D7\u4F17\u3001\u7A33\u5B9A\u539F\u5219\u6216\u6267\u884C\u6743\u9650\uFF1B\u6309\u5F53\u524D\u5B9E\u9645\u573A\u666F\u5E94\u7528\uFF0C\u5BF9\u8C61\u89C4\u5219\u4EC5\u7528\u4E8E\u4E0E\u8BE5\u5BF9\u8C61\u4EA4\u6D41\uFF09\uFF1A\n" + matching.map(
    (rule) => `${SCENE_LABELS[rule.scene]}${rule.participantId ? "\uFF0C\u5BF9\u8C61 " + rule.participantId : ""}\uFF1A${rule.instructions}`
  ).join("\n");
}

// packages/shared/persona-expression.ts
var EXPRESSION_STYLES = [
  ["lively", "\u7075\u52A8\u4EA4\u6D41"],
  ["task", "\u4E25\u8C28\u52A9\u624B"],
  ["balanced", "\u81EA\u7136\u534F\u4F5C"],
  ["custom", "\u81EA\u5B9A\u4E49"]
];
function expressionStarter(style) {
  const principles = "\u5C0A\u91CD\u5BF9\u65B9\uFF0C\u9075\u5B88\u660E\u786E\u8FB9\u754C\u3002\u533A\u5206\u4E8B\u5B9E\u3001\u611F\u53D7\u548C\u63A8\u6D4B\uFF0C\u4E0D\u7F16\u9020\u8BB0\u5FC6\u3001\u7EBF\u4E0B\u7ECF\u5386\u6216\u5DF2\u5B8C\u6210\u7684\u5DE5\u4F5C\u3002\u4EFB\u52A1\u7684\u660E\u786E\u683C\u5F0F\u4E0E\u5B9E\u9645\u7ED3\u679C\u4F18\u5148\uFF0C\u4E0D\u56E0\u8BED\u6C14\u6539\u53D8\u5FC5\u987B\u4EA4\u4ED8\u7684\u5185\u5BB9\u3002\u4E0D\u56E0\u804A\u5929\u6C14\u6C1B\u6539\u53D8\u9690\u79C1\u548C\u6267\u884C\u6743\u9650\u3002";
  const starters = {
    lively: {
      style,
      instructions: "\u4EE5\u6709\u4E2A\u6027\u3001\u6709\u60C5\u7EEA\u8272\u5F69\u7684\u81EA\u7136\u4EA4\u6D41\u4E3A\u4E3B\u3002\u53EF\u4EE5\u5E7D\u9ED8\u3001\u597D\u5947\u3001\u8868\u8FBE\u559C\u6B22\u6216\u4E0D\u8D5E\u540C\uFF0C\u63A5\u4F4F\u5BF9\u65B9\u7684\u60C5\u7EEA\u548C\u73A9\u7B11\uFF1B\u4E0D\u7528\u56FA\u5B9A\u5BA2\u670D\u5957\u8BDD\uFF0C\u4E0D\u628A\u6BCF\u53E5\u8BDD\u90FD\u53D8\u6210\u5EFA\u8BAE\u6216\u5F85\u529E\u3002\u6309\u5173\u7CFB\u548C\u573A\u666F\u638C\u63E1\u5206\u5BF8\uFF0C\u4E0D\u523B\u610F\u88C5\u719F\u3002\u613F\u610F\u5E2E\u5FD9\u505A\u4E8B\uFF0C\u83B7\u51C6\u7684\u4EFB\u52A1\u4E3B\u52A8\u5B8C\u6210\uFF0C\u7ED3\u679C\u51C6\u786E\u6E05\u695A\u3002\u53D7\u9650\u6216\u5931\u8D25\u65F6\u4E5F\u81EA\u7136\u76F4\u8BF4\uFF0C\u4E0D\u80CC\u8BF5\u5185\u90E8\u6D41\u7A0B\u548C\u6743\u9650\u672F\u8BED\u3002",
      principles,
      examples: "\u5BF9\u65B9\u8BF4\u201C\u7EC8\u4E8E\u641E\u5B9A\u4E86\u201D\uFF1A\u53EF\u4EE5\u8BF4\u201C\u53EF\u7B97\u62FF\u4E0B\u4E86\uFF01\u6700\u96BE\u5543\u7684\u662F\u54EA\u4E00\u6B65\uFF1F\u201D\n\u5BF9\u65B9\u8BF4\u201C\u957F\u7684\u53D1\u6587\u4EF6\u201D\uFF1A\u53EF\u4EE5\u8BF4\u201C\u884C\uFF0C\u957F\u7684\u6211\u88C5\u8FDB\u6587\u4EF6\u91CC\u3002\u201D\n\u8FD9\u4E9B\u53EA\u662F\u8BED\u6C14\u793A\u4F8B\uFF0C\u4E0D\u80FD\u9010\u6761\u7167\u642C\u6216\u5F53\u6210\u771F\u5B9E\u7ECF\u5386\u3002"
    },
    task: {
      style,
      instructions: "\u4F5C\u4E3A\u4E25\u683C\u3001\u53EF\u9760\u7684\u4EFB\u52A1\u52A9\u624B\u3002\u76F4\u63A5\u7406\u89E3\u76EE\u6807\uFF0C\u6309\u8981\u6C42\u6267\u884C\u3001\u6838\u9A8C\u548C\u4EA4\u4ED8\u3002\u81EA\u8EAB\u4EA4\u6D41\u4F7F\u7528\u7B80\u6D01\u3001\u4E2D\u6027\u7684\u4E66\u9762\u8BED\uFF0C\u4F18\u5148\u9075\u5B88\u6307\u5B9A\u683C\u5F0F\uFF1B\u4E0D\u7528\u4FDA\u8BED\u3001\u62DF\u4EBA\u60C5\u7EEA\u3001\u73A9\u7B11\u6216\u4EB2\u5BC6\u79F0\u547C\u3002\u9762\u5BF9\u95F2\u804A\u6216\u503E\u8BC9\uFF0C\u53EA\u793C\u8C8C\u786E\u8BA4\u9700\u6C42\uFF0C\u4E0D\u626E\u6F14\u966A\u804A\u670B\u53CB\uFF0C\u4E0D\u5F15\u5BFC\u7EE7\u7EED\u95F2\u804A\uFF0C\u4E0D\u6A21\u4EFF\u5BF9\u65B9\u7684\u53E3\u8BED\u3002\u7528\u6237\u6CA1\u6709\u8981\u6C42\u5EFA\u8BAE\u65F6\u4E0D\u8FFD\u52A0\u89E3\u51B3\u6B65\u9AA4\u3002\u5B58\u5728\u4EFB\u52A1\u963B\u788D\u65F6\u8BF4\u660E\u5177\u4F53\u539F\u56E0\u4E0E\u4E0B\u4E00\u6B65\uFF0C\u5FC5\u8981\u65F6\u63D0\u51FA\u7B80\u77ED\u6F84\u6E05\u3002\u7528\u6237\u8981\u6C42\u521B\u4F5C\u3001\u8F6C\u8FF0\u7279\u5B9A\u98CE\u683C\u7684\u5185\u5BB9\u6216\u53D1\u9001\u8868\u60C5\u65F6\uFF0C\u6309\u4EA4\u4ED8\u8981\u6C42\u5B8C\u6210\uFF0C\u4F60\u81EA\u8EAB\u7684\u89E3\u91CA\u4ECD\u4FDD\u6301\u4E2D\u6027\u3002",
      principles,
      examples: "\u5BF9\u65B9\u8BF4\u201C\u957F\u7684\u53D1\u6587\u4EF6\u201D\uFF1A\u53EF\u4EE5\u8BF4\u201C\u6536\u5230\u3002\u8BE6\u7EC6\u5185\u5BB9\u5C06\u4EE5\u6587\u672C\u6587\u4EF6\u4EA4\u4ED8\u3002\u201D\n\u5BF9\u65B9\u6682\u4E0D\u9700\u8981\u5EFA\u8BAE\uFF1A\u53EF\u4EE5\u8BF4\u201C\u6536\u5230\uFF0C\u6682\u4E0D\u63D0\u4F9B\u5EFA\u8BAE\u3002\u9700\u8981\u5904\u7406\u5177\u4F53\u4E8B\u9879\u65F6\uFF0C\u8BF7\u8BF4\u660E\u8981\u6C42\u3002\u201D\n\u4EFB\u52A1\u672A\u5B8C\u6210\uFF1A\u8BF4\u660E\u5DF2\u9A8C\u8BC1\u7684\u8FDB\u5C55\u3001\u963B\u788D\u548C\u5F85\u529E\uFF0C\u4E0D\u5199\u865A\u5047\u7684\u5B8C\u6210\u7ED3\u8BBA\u3002"
    },
    balanced: {
      style,
      instructions: "\u5E73\u65F6\u81EA\u7136\u3001\u7075\u52A8\uFF0C\u50CF\u719F\u6089\u7684\u534F\u4F5C\u8005\u4E00\u6837\u4EA4\u6D41\uFF1A\u6709\u81EA\u5DF1\u7684\u8BED\u6C14\uFF0C\u53EF\u4EE5\u8868\u8FBE\u5173\u5FC3\u3001\u5E7D\u9ED8\u548C\u4E0D\u540C\u610F\u89C1\uFF0C\u4E0D\u7528\u5BA2\u670D\u8BDD\u672F\u3002\u9700\u8981\u505A\u4E8B\u65F6\u8FC5\u901F\u8FDB\u5165\u5DE5\u4F5C\u72B6\u6001\uFF0C\u4E3B\u52A8\u63A8\u8FDB\u5E76\u6E05\u695A\u4EA4\u4ED8\uFF1B\u4E25\u8083\u3001\u7CBE\u786E\u683C\u5F0F\u6216\u7D27\u6025\u573A\u666F\u51CF\u5C11\u73A9\u7B11\u3002\u804A\u5929\u4E0D\u5FC5\u603B\u7ED9\u65B9\u6848\uFF0C\u5DE5\u4F5C\u4E0D\u5FC5\u603B\u62A5\u8FC7\u7A0B\uFF0C\u6309\u5BF9\u65B9\u9700\u8981\u638C\u63E1\u5206\u5BF8\u3002\u53D7\u9650\u6216\u5931\u8D25\u65F6\u4E5F\u81EA\u7136\u76F4\u8BF4\uFF0C\u4E0D\u80CC\u8BF5\u5185\u90E8\u6D41\u7A0B\u548C\u6743\u9650\u672F\u8BED\u3002",
      principles,
      examples: "\u95F2\u804A\u201C\u4ECA\u5929\u8111\u5B50\u8F6C\u4E0D\u52A8\u201D\uFF1A\u53EF\u4EE5\u8BF4\u201C\u90A3\u5148\u522B\u786C\u62E7\u4E86\uFF0C\u7F13\u4E00\u4F1A\u513F\u3002\u8981\u4E0D\u8981\u6362\u4E2A\u8F7B\u677E\u70B9\u7684\u8BDD\u9898\uFF1F\u201D\n\u5DE5\u4F5C\u201C\u5E2E\u6211\u68C0\u67E5\u7ED3\u679C\u201D\uFF1A\u53EF\u4EE5\u8BF4\u201C\u6211\u6838\u5BF9\u4E00\u4E0B\uFF0C\u7B49\u4F1A\u513F\u628A\u7ED3\u8BBA\u548C\u6709\u95EE\u9898\u7684\u5730\u65B9\u7ED9\u4F60\u3002\u201D\n\u53EA\u5728\u5B9E\u9645\u5B8C\u6210\u540E\u8BF4\u660E\u5B8C\u6210\uFF0C\u4E0D\u628A\u793A\u4F8B\u5F53\u4F5C\u5DF2\u7ECF\u91C7\u53D6\u7684\u884C\u52A8\u3002"
    },
    custom: { style, instructions: "", principles: "", examples: "" }
  };
  return starters[style];
}
function parsePersonaExpression(value) {
  if (value === void 0 || value === null) return void 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("\u516C\u5F00\u4EBA\u683C\u8868\u8FBE\u683C\u5F0F\u65E0\u6548");
  const v = value;
  if (Object.keys(v).some(
    (key) => !["style", "instructions", "principles", "examples", "scenes"].includes(key)
  ) || !EXPRESSION_STYLES.some(([key]) => key === v.style))
    throw new Error("\u516C\u5F00\u4EBA\u683C\u8868\u8FBE\u7C7B\u578B\u65E0\u6548");
  for (const [key, limit] of [
    ["instructions", 4e3],
    ["principles", 2e3],
    ["examples", 4e3]
  ])
    if (typeof v[key] !== "string" || v[key].length > limit || v[key].includes("\0"))
      throw new Error("\u516C\u5F00\u4EBA\u683C\u8868\u8FBE\u4E3A\u7A7A\u6216\u8D85\u8FC7\u957F\u5EA6\u9650\u5236");
  return {
    style: v.style,
    instructions: v.instructions.trim(),
    principles: v.principles.trim(),
    examples: v.examples.trim(),
    ...v.scenes !== void 0 ? { scenes: parseSceneRules(v.scenes) } : {}
  };
}
function renderPersonaExpression(expression, context) {
  if (!expression) return "";
  return [
    expression.instructions && "\u6027\u683C\u4E0E\u8868\u8FBE\uFF1A\n" + expression.instructions,
    expression.principles && "\u7A33\u5B9A\u539F\u5219\uFF1A\n" + expression.principles,
    expression.examples && "\u8BF4\u8BDD\u793A\u4F8B\uFF08\u7528\u4E8E\u628A\u63E1\u8BED\u6C14\uFF0C\u4E0D\u662F\u4E8B\u5B9E\u6216\u56FA\u5B9A\u56DE\u590D\uFF09\uFF1A\n" + expression.examples,
    renderSceneRules(expression.scenes, context)
  ].filter(Boolean).join("\n");
}

// packages/shared/persona-expression-editor.tsx
var import_jsx_runtime12 = require("react/jsx-runtime");
function PersonaExpressionEditor({
  value,
  disabled,
  onChange
}) {
  const editScene = (id, patch) => {
    if (value)
      onChange({
        ...value,
        scenes: value.scenes?.map((rule) => rule.id === id ? { ...rule, ...patch } : rule)
      });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("fieldset", { disabled, style: { border: 0, padding: 0, margin: "16px 0" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("legend", { children: "\u6027\u683C\u4E0E\u573A\u666F\u8868\u8FBE" }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { style: { opacity: 0.7 }, children: "\u540C\u4E00\u4EBA\u683C\u53EF\u4EE5\u6309\u5BF9\u8C61\u548C\u573A\u5408\u8C03\u6574\u8BF4\u6CD5\u3002\u8FD9\u91CC\u53EA\u914D\u7F6E\u8868\u8FBE\u4E0E\u534F\u4F5C\u65B9\u5F0F\uFF1B\u8D44\u6599\u53EF\u89C1\u8303\u56F4\u548C\u5B9E\u9645\u5DE5\u5177\u6743\u9650\u5206\u522B\u7BA1\u7406\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { children: [
      "\u8868\u8FBE\u8D77\u70B9",
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
        "select",
        {
          "aria-label": "\u4EBA\u683C\u8868\u8FBE\u8D77\u70B9",
          style: { ...controlStyle, marginLeft: 8 },
          value: value?.style ?? "",
          onChange: (e) => {
            const style = e.target.value;
            if (!style) return onChange(null);
            if (style === "custom") return onChange({ ...value ?? expressionStarter("custom"), style });
            if (value && !window.confirm("\u7528\u6240\u9009\u8D77\u70B9\u66FF\u6362\u5F53\u524D\u5C1A\u672A\u4FDD\u5B58\u7684\u516C\u5F00\u8868\u8FBE\u5185\u5BB9\uFF1F\u79C1\u4EBA\u534F\u4F5C\u8981\u6C42\u548C\u8BB0\u5FC6\u4E0D\u53D8\u3002"))
              return;
            onChange({ ...expressionStarter(style), ...value?.scenes ? { scenes: value.scenes } : {} });
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "", children: "\u6CBF\u7528\u539F\u6709\u914D\u7F6E" }),
            EXPRESSION_STYLES.map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: id, children: label }, id))
          ]
        }
      )
    ] }),
    value && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { style: { opacity: 0.7 }, children: "\u8D77\u70B9\u53EA\u586B\u5165\u4E0B\u9762\u7684\u6587\u5B57\uFF1B\u53EF\u4EE5\u76F4\u63A5\u4FEE\u6539\uFF0C\u4FDD\u5B58\u540E\u7684\u5B9E\u9645\u6587\u5B57\u51B3\u5B9A\u8868\u8FBE\u3002" }),
      [
        ["instructions", "\u6027\u683C\u4E0E\u8BED\u6C14", 4e3, 5],
        ["principles", "\u7A33\u5B9A\u539F\u5219", 2e3, 3],
        ["examples", "\u8BF4\u8BDD\u793A\u4F8B", 4e3, 4]
      ].map(([key, label, max, rows]) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { style: { display: "block", marginTop: 12 }, children: [
        label,
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          "textarea",
          {
            "aria-label": label,
            rows,
            maxLength: max,
            value: value[key],
            style: { ...controlStyle, width: "100%", resize: "vertical" },
            onChange: (e) => onChange({ ...value, [key]: e.target.value })
          }
        )
      ] }, key)),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("details", { style: { marginTop: 16 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("summary", { children: "\u6309\u573A\u666F\u4E0E\u5BF9\u8C61\u8C03\u6574\uFF08\u53EF\u9009\uFF09" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "px-muted", children: "\u57FA\u7840\u8868\u8FBE\u7528\u4E8E\u6240\u6709\u573A\u5408\u3002\u4EE5\u4E0B\u89C4\u5219\u53EA\u7528\u4E8E\u5339\u914D\u7684\u6E20\u9053\u548C\u5BF9\u8C61\uFF1B\u5BF9\u8C61\u4F7F\u7528\u771F\u5B9E\u7F16\u53F7\uFF0C\u4E0D\u6309\u6635\u79F0\u5339\u914D\u3002\u6700\u591A 12 \u6761\u3001\u5408\u8BA1 4000 \u5B57\u3002\u672A\u586B\u5199\u7684\u89C4\u5219\u4E0D\u751F\u6548\uFF0C\u5185\u5BB9\u4F1A\u63D0\u4F9B\u7ED9\u5BF9\u5E94\u573A\u5408\u7684\u6A21\u578B\u3002" }),
        (value.scenes ?? []).map((rule, index) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "px-card", style: { marginTop: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "px-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { children: [
              "\u573A\u5408",
              " ",
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
                "select",
                {
                  "aria-label": `\u573A\u666F ${index + 1} \u573A\u5408`,
                  value: rule.scene,
                  onChange: (event) => editScene(rule.id, { scene: event.target.value }),
                  children: Object.entries(SCENE_LABELS).map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: id, children: label }, id))
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { children: [
              "\u6E20\u9053",
              " ",
              /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
                "select",
                {
                  "aria-label": `\u573A\u666F ${index + 1} \u6E20\u9053`,
                  value: rule.provider ?? "",
                  onChange: (event) => editScene(rule.id, {
                    provider: event.target.value || void 0,
                    accountId: void 0,
                    conversationId: void 0,
                    participantId: void 0
                  }),
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "", children: "\u6240\u6709\u5DF2\u63A5\u5165\u6E20\u9053" }),
                    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "local", children: "\u672C\u673A" }),
                    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "qq", children: "QQ" })
                  ]
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
              "button",
              {
                type: "button",
                onClick: () => onChange({ ...value, scenes: value.scenes?.filter((item) => item.id !== rule.id) }),
                children: "\u79FB\u9664\u6B64\u89C4\u5219"
              }
            )
          ] }),
          rule.provider === "qq" && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { children: [
            "\u5BF9\u8C61 QQ \u53F7\uFF08\u7559\u7A7A\u9002\u7528\u4E8E\u8BE5\u6E20\u9053\uFF09",
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
              "input",
              {
                "aria-label": `\u573A\u666F ${index + 1} \u5BF9\u8C61\u7F16\u53F7`,
                maxLength: 200,
                value: rule.participantId ?? "",
                onChange: (event) => editScene(rule.id, { participantId: event.target.value.trim() || void 0 })
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
            "textarea",
            {
              "aria-label": `\u573A\u666F ${index + 1} \u8868\u8FBE\u8981\u6C42`,
              rows: 3,
              maxLength: 1e3,
              value: rule.instructions,
              placeholder: "\u4F8B\u5982\uFF1A\u4EA4\u4ED8\u5DE5\u4F5C\u65F6\u5148\u8BF4\u7ED3\u679C\uFF0C\u5FC5\u8981\u65F6\u7ED9\u51FA\u4F9D\u636E\uFF1B\u95F2\u804A\u65F6\u53EF\u4EE5\u81EA\u7136\u6D3B\u6CFC\u3002",
              style: { ...controlStyle, width: "100%", marginTop: 8 },
              onChange: (event) => editScene(rule.id, { instructions: event.target.value })
            }
          )
        ] }, rule.id)),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          "button",
          {
            type: "button",
            disabled: (value.scenes?.length ?? 0) >= 12,
            onClick: () => onChange({
              ...value,
              scenes: [
                ...value.scenes ?? [],
                { id: crypto.randomUUID(), scene: "any", instructions: "" }
              ]
            }),
            children: "\u6DFB\u52A0\u573A\u666F\u89C4\u5219"
          }
        )
      ] })
    ] })
  ] });
}

// packages/dsh-px-memory/src/channel-notes-panel.tsx
var import_react12 = require("react");

// packages/dsh-px-memory/src/channel-note-editor.tsx
var import_react11 = require("react");
var import_jsx_runtime13 = require("react/jsx-runtime");
var drafts3 = createDraftRegistry(64);
function ChannelNoteEditor({
  storageKey,
  initial,
  revision,
  documentRevision,
  busy,
  save
}) {
  const entry = (0, import_react11.useMemo)(() => {
    let storage;
    try {
      storage = sessionStorage;
    } catch {
    }
    return drafts3.acquire(
      "px-note-correction:" + storageKey,
      { editing: false, text: "", revision: "", documentRevision: 0 },
      storage,
      (v) => v.text.length <= 4e3 && Number.isSafeInteger(v.documentRevision)
    );
  }, [storageKey]);
  const [draft, setDraft] = (0, import_react11.useState)(
    () => entry?.getSnapshot() ?? { editing: false, text: "", revision: "", documentRevision: 0 }
  );
  (0, import_react11.useEffect)(() => {
    if (draft.editing) entry?.set(draft);
    else entry?.clear();
  }, [draft, entry]);
  if (!draft.editing)
    return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
      "button",
      {
        disabled: busy || !entry,
        onClick: () => setDraft({ editing: true, text: initial, revision, documentRevision }),
        children: "\u7EA0\u6B63\u8FD9\u6761\u8BB0\u5FC6"
      }
    );
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { style: { marginTop: 12 }, children: [
    draft.documentRevision !== documentRevision && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { role: "status", children: "\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u65E7\u8349\u7A3F\u4FDD\u7559\u3002\u8BF7\u5148\u6838\u5BF9\u5F53\u524D\u8BB0\u5F55\uFF0C\u518D\u53D6\u6D88\u65E7\u8349\u7A3F\u5E76\u91CD\u65B0\u7F16\u8F91\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("label", { children: [
      "\u7EA0\u6B63\u540E\u7684\u8BB0\u5FC6",
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
        "textarea",
        {
          "aria-label": "\u7EA0\u6B63\u540E\u7684\u804A\u5929\u8BB0\u5FC6",
          rows: 5,
          style: { width: "100%" },
          value: draft.text,
          maxLength: 4e3,
          disabled: busy,
          onChange: (e) => setDraft({ ...draft, text: e.target.value })
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
      "button",
      {
        disabled: busy || !draft.text.trim() || draft.documentRevision !== documentRevision,
        onClick: () => {
          void save(draft.text.trim(), draft.revision, draft.documentRevision).then((ok) => {
            if (ok) setDraft({ ...draft, editing: false });
          });
        },
        children: "\u4FDD\u5B58\u7EA0\u6B63"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { disabled: busy, onClick: () => setDraft({ ...draft, editing: false }), children: "\u53D6\u6D88\u5E76\u6E05\u9664\u8349\u7A3F" })
  ] });
}

// packages/dsh-px-memory/src/channel-notes-panel.tsx
var import_jsx_runtime14 = require("react/jsx-runtime");
function ChannelNotesPanel({ url }) {
  const [catalog, setCatalog] = (0, import_react12.useState)(null), [note, setNote] = (0, import_react12.useState)(null);
  const [error, setError] = (0, import_react12.useState)(""), [busy, setBusy] = (0, import_react12.useState)(false), [refresh, setRefresh] = (0, import_react12.useState)(0), [original, setOriginal] = (0, import_react12.useState)(null);
  const [noteRevision, setNoteRevision] = (0, import_react12.useState)("");
  const request = (input, signal) => requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({ type: "conversation-memory", input })
  });
  (0, import_react12.useEffect)(() => {
    const ac = new AbortController();
    setError("");
    setNote(null);
    setOriginal(null);
    void request({ action: "catalog" }, ac.signal).then((value) => {
      if (!ac.signal.aborted) setCatalog(value);
    }).catch((error2) => {
      if (!ac.signal.aborted) setError(error2.message);
    });
    return () => ac.abort();
  }, [url, refresh]);
  let body;
  try {
    body = note?.body ? JSON.parse(note.body) : null;
  } catch {
    body = { observation: note?.body };
  }
  const run = async (work) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error2) {
      setError(error2.message);
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { children: "\u672C\u804A\u5929\u8BB0\u5FC6" }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "px-muted", children: "\u53EA\u5C5E\u4E8E\u6B64\u4EBA\u683C\u5728\u5F53\u524D\u804A\u5929\u4E2D\u7684\u7ECF\u5386\u4E0E\u7EA6\u5B9A\u3002\u9879\u76EE\u5171\u4EAB\u77E5\u8BC6\u4ECD\u5728\u201C\u77E5\u8BC6\u4E0E Skills\u201D\u4E2D\u7BA1\u7406\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { disabled: busy, onClick: () => setRefresh((value) => value + 1), children: "\u5237\u65B0\u804A\u5929\u8BB0\u5FC6" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { role: "alert", children: error }),
    catalog?.total === 0 && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: "\u6B64\u4EBA\u683C\u5728\u8FD9\u4E2A\u804A\u5929\u4E2D\u8FD8\u6CA1\u6709\u4FDD\u5B58\u7684\u8BB0\u5FC6\u3002" }),
    (catalog?.notes ?? []).map((row) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(
      "button",
      {
        style: { display: "block", marginTop: 8 },
        disabled: busy,
        onClick: () => void run(async () => {
          const value = await request({ action: "read", id: row.id });
          setNote(value.note);
          setNoteRevision(value.revision);
          setOriginal(null);
        }),
        children: [
          row.topic,
          row.current === false ? "\uFF08\u5F85\u7EA0\u6B63\uFF09" : ""
        ]
      },
      row.id
    )),
    catalog?.nextOffset != null && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      "button",
      {
        disabled: busy,
        onClick: () => void run(async () => {
          const value = await request({
            action: "catalog",
            offset: catalog.nextOffset,
            revision: catalog.revision
          });
          setCatalog({ ...value, notes: [...catalog.notes, ...value.notes] });
        }),
        children: "\u7EE7\u7EED\u8BFB\u53D6\u8BB0\u5FC6"
      }
    ),
    note && /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { style: cardStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: note.topic }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { style: { whiteSpace: "pre-wrap" }, children: body?.observation ?? note.body }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { className: "px-muted", children: [
        "\u4FEE\u8BA2 ",
        note.revision,
        " \xB7 ",
        note.current ? "\u73B0\u884C\u8BB0\u5F55" : "\u5386\u53F2\u8BB0\u5F55\uFF0C\u4F7F\u7528\u524D\u9700\u6838\u5BF9"
      ] }),
      note.status === "active" && /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_jsx_runtime14.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
          ChannelNoteEditor,
          {
            storageKey: url + ":" + note.id,
            initial: body?.observation ?? note.body ?? "",
            revision: noteRevision,
            documentRevision: note.revision,
            busy,
            save: async (text, revision, documentRevision) => {
              let saved = false;
              await run(async () => {
                const result = await request({
                  action: "correct",
                  id: note.id,
                  text,
                  revision,
                  documentRevision
                });
                setNote(result.note);
                setNoteRevision(result.revision);
                saved = true;
              });
              return saved;
            }
          },
          note.id
        ),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
          "button",
          {
            disabled: busy,
            onClick: () => {
              if (confirm("\u5F52\u6863\u540E\u4E0D\u518D\u4F7F\u7528\u8FD9\u6761\u804A\u5929\u8BB0\u5FC6\u3002\u7EE7\u7EED\u5417\uFF1F"))
                void run(async () => {
                  await request({
                    action: "archive",
                    id: note.id,
                    revision: noteRevision,
                    documentRevision: note.revision
                  });
                  setRefresh((value) => value + 1);
                });
            },
            children: "\u5F52\u6863\u8FD9\u6761\u8BB0\u5FC6"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
        MemoryFeedbackPanel,
        {
          value: note.feedback,
          busy,
          disabled: note.status !== "active",
          submit: (kind, reason) => run(async () => {
            const result = await request({
              action: "feedback",
              id: note.id,
              documentRevision: note.revision,
              kind,
              reason
            });
            setNote(result.note);
            setNoteRevision(result.revision);
          })
        },
        note.id + ":" + note.revision
      ),
      (body?.evidence ?? []).map((evidence, index) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(
        "button",
        {
          disabled: busy,
          onClick: () => void run(async () => {
            const value = await requestJson(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                type: "read-history",
                targetSessionId: evidence.sessionId,
                seq: evidence.seq,
                offset: 0
              })
            });
            setOriginal(value.result);
          }),
          children: [
            "\u8BFB\u53D6\u4F9D\u636E ",
            index + 1,
            "\uFF08\u4E8B\u4EF6 ",
            evidence.seq,
            "\uFF09"
          ]
        },
        index
      )),
      original && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("pre", { style: { whiteSpace: "pre-wrap" }, children: original.text ?? JSON.stringify(original, null, 2) })
    ] })
  ] });
}

// packages/dsh-px-memory/src/segment-panel.tsx
var import_react13 = require("react");
var import_jsx_runtime15 = require("react/jsx-runtime");
var labels2 = {
  preparing: "\u540E\u53F0\u6574\u7406\u4E2D",
  stopping: "\u6B63\u5728\u505C\u6B62\uFF0C\u7B49\u5F85\u540E\u53F0\u8C03\u7528\u7ED3\u675F",
  ready: "\u6458\u8981\u5DF2\u51C6\u5907\uFF0C\u7B49\u5F85\u4E0B\u6B21\u5B89\u5168\u6B65\u9AA4",
  committing: "\u6B63\u5728\u6838\u5BF9\u539F\u751F\u63D0\u4EA4",
  committed: "\u5DF2\u538B\u7F29\uFF0C\u539F\u6587\u4FDD\u7559",
  failed: "\u6574\u7406\u5931\u8D25\uFF0C\u539F\u6587\u4FDD\u7559",
  cancelled: "\u5DF2\u505C\u6B62",
  discarded: "\u5019\u9009\u5931\u6548\uFF0C\u672A\u91CD\u590D\u63D0\u4EA4"
};
function SegmentPanel({ url, visible }) {
  const [view, setView] = (0, import_react13.useState)(null), [error, setError] = (0, import_react13.useState)(""), [loadError, setLoadError] = (0, import_react13.useState)(""), [busy, setBusy] = (0, import_react13.useState)(false), [original, setOriginal] = (0, import_react13.useState)(null);
  const request = (input, signal) => requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "segments", input }),
    signal
  });
  (0, import_react13.useEffect)(() => {
    if (!visible || busy) return;
    const ac = new AbortController();
    let timer;
    const refresh = async () => {
      try {
        const value = await request({ action: "status" }, ac.signal);
        if (!ac.signal.aborted) {
          setView(value);
          setLoadError("");
        }
      } catch (e) {
        if (!ac.signal.aborted) setLoadError(e.message);
      }
      if (!ac.signal.aborted) timer = setTimeout(refresh, 4e3);
    };
    void refresh();
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [url, visible, busy]);
  const run = async (work) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const action = (input) => run(async () => setView(await request(input)));
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("details", { className: "px-card", style: { marginBottom: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("summary", { children: [
      "\u672C\u4F1A\u8BDD\u7684\u4E0A\u4E0B\u6587\u6574\u7406",
      view?.records?.some(
        (row) => ["preparing", "stopping", "ready", "committing"].includes(row.phase)
      ) ? " \xB7 \u6709\u540E\u53F0\u7247\u6BB5" : ""
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: "\u5B9A\u671F\u5728\u540E\u53F0\u6574\u7406\u5DF2\u7ED3\u675F\u7684\u65E7\u6BB5\uFF0C\u4FDD\u7559\u8FD1\u671F\u539F\u6587\uFF0C\u5E76\u5728\u5B89\u5168\u6B65\u9AA4\u63D0\u4EA4\u3002\u751F\u6210\u6458\u8981\u671F\u95F4\u4E3B\u4F1A\u8BDD\u53EF\u4EE5\u7EE7\u7EED\u5DE5\u4F5C\uFF1B\u63A5\u8FD1\u5BB9\u91CF\u4E0A\u9650\u65F6\uFF0C\u4ECD\u53EF\u80FD\u7B49\u5F85\u539F\u751F\u538B\u7F29\u3002" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { role: "alert", children: error }),
    loadError && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { role: "alert", children: loadError }),
    view && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("label", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
          "input",
          {
            type: "checkbox",
            checked: view.settings.enabled,
            disabled: busy,
            onChange: (e) => void action({
              action: "configure",
              revision: view.settings.revision,
              enabled: e.target.checked
            })
          }
        ),
        " ",
        "\u540E\u53F0\u6574\u7406\u8F83\u65E9\u5BF9\u8BDD"
      ] }),
      view.settings.inheritedNativeAutoOff && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "px-muted", children: "\u539F\u751F\u81EA\u52A8\u538B\u7F29\u5DF2\u5173\u95ED\uFF0C\u56E0\u6B64\u6682\u4E0D\u81EA\u52A8\u6574\u7406\u3002\u53EF\u5355\u72EC\u4E3A\u672C\u4F1A\u8BDD\u5F00\u542F\u4E0A\u65B9\u5F00\u5173\u3002" }),
      view.settings.inheritedNativeAutoUnknown && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "px-muted", children: "\u5C1A\u672A\u8BFB\u53D6\u6B64\u4F1A\u8BDD\u7684\u81EA\u52A8\u538B\u7F29\u8BBE\u7F6E\uFF0C\u5F00\u59CB\u4F1A\u8BDD\u540E\u4F1A\u91CD\u65B0\u6838\u5BF9\uFF1B\u4E5F\u53EF\u5355\u72EC\u5F00\u542F\u540E\u53F0\u6574\u7406\u3002" }),
      !view.ready && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { role: "status", children: "\u540E\u53F0\u63D0\u4EA4\u670D\u52A1\u6682\u672A\u5C31\u7EEA\uFF0C\u539F\u751F\u538B\u7F29\u4ECD\u53EF\u7EE7\u7EED\u3002" }),
      view.problem && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { role: "status", children: view.problem }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "px-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { disabled: busy, onClick: () => void action({ action: "stop" }), children: "\u505C\u6B62\u672C\u6B21\u540E\u53F0\u6574\u7406" }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
          "button",
          {
            disabled: busy || !view.settings.enabled || view.records.some(
              (row) => ["preparing", "stopping", "ready", "committing"].includes(row.phase)
            ),
            onClick: () => void action({ action: "retry" }),
            children: "\u91CD\u65B0\u6574\u7406\u7B26\u5408\u6761\u4EF6\u7684\u65E7\u6BB5"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { className: "px-muted", children: [
        "\u540E\u53F0\u8C03\u7528\uFF1A",
        view.cost.measuredJobs,
        " \u6B21\u6709\u7528\u91CF\u8BB0\u5F55\uFF0C",
        view.cost.unknownJobs,
        " ",
        "\u6B21\u7528\u91CF\u672A\u77E5\u3002\u5F53\u524D\u9875\u5408\u8BA1\u8F93\u5165 ",
        view.cost.usage.inputTokens ?? 0,
        "\u3001\u8F93\u51FA",
        " ",
        view.cost.usage.outputTokens ?? 0,
        "\u3001\u7F13\u5B58\u8BFB\u53D6 ",
        view.cost.usage.cacheReadTokens ?? 0,
        " ",
        "token\u3002\u6B64\u5904\u4EC5\u5217\u540E\u53F0\u5F00\u9500\u3002"
      ] }),
      view.preparingAdmission && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { role: "status", children: "\u6B63\u5728\u68C0\u67E5\u53EF\u6574\u7406\u7684\u65E7\u6BB5\uFF0C\u4E0D\u5F71\u54CD\u5F53\u524D\u4F1A\u8BDD\u7EE7\u7EED\u3002" }),
      !view.records.length && !view.preparingAdmission && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: "\u5C1A\u65E0\u7B26\u5408\u6761\u4EF6\u7684\u65E7\u6BB5\u3002\u6D88\u606F\u8F83\u5C11\u65F6\u4FDD\u7559\u539F\u6587\uFF1B\u8FC7\u5927\u7684\u5355\u6761\u5185\u5BB9\u548C\u5A92\u4F53\u4FDD\u6301\u539F\u6837\uFF0C\u540E\u9762\u7684\u72EC\u7ACB\u6587\u672C\u4ECD\u53EF\u6574\u7406\u3002" }),
      view.records.map((row) => /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("details", { style: { marginTop: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("summary", { children: [
          labels2[row.phase] ?? row.phase,
          " \xB7 ",
          new Date(row.createdAt).toLocaleTimeString(),
          " \xB7",
          " ",
          row.source.seqs.length,
          " \u6761\u539F\u59CB\u4E8B\u4EF6"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { className: "px-muted", children: [
          row.route.provider,
          " / ",
          row.route.model,
          row.jobId ? ` \xB7 \u539F\u751F\u4F5C\u4E1A ${row.jobId}` : ""
        ] }),
        row.error && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { role: "status", children: row.error }),
        row.prepared && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("pre", { style: { whiteSpace: "pre-wrap", fontFamily: "inherit" }, children: row.prepared.summary }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("summary", { children: "\u539F\u59CB\u4EA4\u6D41\u4E0E\u6267\u884C\u56DE\u6267" }),
          (row.source.readableSeqs ?? []).map((seq) => /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(
            "button",
            {
              disabled: busy,
              onClick: () => void run(async () => {
                const result = await requestJson(url, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ type: "read-history", targetSessionId: row.sessionId, seq })
                });
                setOriginal(result.result);
              }),
              children: [
                "\u4E8B\u4EF6 ",
                seq
              ]
            },
            seq
          )),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { className: "px-muted", children: [
            "\u539F\u751F\u6765\u6E90\u5171 ",
            row.source.seqs.length,
            " ",
            "\u6761\uFF1B\u8FD9\u91CC\u53EA\u63D0\u4F9B\u53EF\u4ECE\u666E\u901A\u5386\u53F2\u5165\u53E3\u8BFB\u53D6\u7684\u4EA4\u6D41\u548C\u56DE\u6267\uFF0C\u8FD0\u884C\u4E0A\u4E0B\u6587\u4ECD\u4FDD\u7559\u5728\u539F\u751F\u65E5\u5FD7\u4E2D\u3002"
          ] })
        ] }),
        !!row.prepared?.memories.length && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { children: [
          "\u4ECE\u672C\u6BB5\u6574\u7406\u7684\u8BB0\u5FC6\u5EFA\u8BAE\uFF1A",
          row.memoryTarget?.conversation ? "\u4FDD\u5B58\u5230\u6B64\u4EBA\u683C\u7684\u672C\u804A\u5929\u8BB0\u5FC6" : row.memoryTarget?.scope === "persona-project" ? "\u4FDD\u5B58\u5230\u201C\u6B64\u4EBA\u683C\u5728\u672C\u9879\u76EE\u201D\u7684\u77E5\u8BC6" : "\u4FDD\u5B58\u5230\u6B64\u4EBA\u683C\u7684\u901A\u7528\u77E5\u8BC6",
          "\u3002\u540C\u4E3B\u9898\u4F1A\u66F4\u65B0\u73B0\u884C\u6B63\u6587\u3002"
        ] }),
        row.prepared?.memories.map((memory, index) => /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "px-card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("strong", { children: memory.key }),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { style: { whiteSpace: "pre-wrap" }, children: memory.body }),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { className: "px-muted", children: [
            "\u4F9D\u636E\u4E8B\u4EF6\uFF1A",
            memory.seqs.join(", "),
            "\u3002",
            row.memoryDecisions?.[index]?.status === "accepted" ? "\u5DF2\u91C7\u7EB3" : row.memoryDecisions?.[index]?.status === "dismissed" ? "\u5DF2\u5FFD\u7565" : "\u5C1A\u672A\u786E\u8BA4\u91C7\u7EB3"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
            "button",
            {
              disabled: busy || row.nativeJobPending || !!row.memoryDecisions?.[index] || !["ready", "committed"].includes(row.phase),
              onClick: () => void action({ action: "accept", id: row.id, index }),
              children: "\u91C7\u7EB3\u5230\u8BB0\u5FC6"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
            "button",
            {
              disabled: busy || row.nativeJobPending || !!row.memoryDecisions?.[index] || !["ready", "committed"].includes(row.phase),
              onClick: () => void action({ action: "dismiss", id: row.id, index }),
              children: "\u5FFD\u7565\u5EFA\u8BAE"
            }
          )
        ] }, index))
      ] }, row.id))
    ] }),
    original && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { children: [
        "\u4E8B\u4EF6 ",
        original.seq,
        " \xB7 \u5DF2\u663E\u793A ",
        original.text.length,
        " / ",
        original.totalCharacters,
        " \u5B57\u7B26"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("pre", { style: { whiteSpace: "pre-wrap" }, children: original.text }),
      original.nextOffset !== null && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
        "button",
        {
          disabled: busy,
          onClick: () => void run(async () => {
            const result = await requestJson(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                type: "read-history",
                targetSessionId: original.sessionId,
                seq: original.seq,
                offset: original.nextOffset
              })
            });
            setOriginal({ ...result.result, text: original.text + result.result.text });
          }),
          children: "\u7EE7\u7EED\u8BFB\u53D6\u8FD9\u6761\u539F\u6587"
        }
      )
    ] })
  ] });
}

// packages/dsh-px-memory/src/client.tsx
var import_jsx_runtime16 = require("react/jsx-runtime");
var personaDrafts = createDraftRegistry(64);
var inject = [];
function MemoryPanel({
  sessionId,
  visible,
  openKnowledge,
  openSession,
  prepareCreatedSession,
  openSettings,
  openTasks,
  skillRequest
}) {
  const draft = (0, import_react14.useMemo)(() => {
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
        expression: null,
        enabled: true,
        newName: "",
        note: "",
        editing: "",
        scope: "project"
      },
      storage,
      (v) => {
        try {
          parsePersonaExpression(v.expression);
        } catch {
          return false;
        }
        return v.note.length <= 2e3 && v.instructions.length <= 2e3 && v.name.length <= 60 && v.newName.length <= 60 && Number.isSafeInteger(v.revision) && v.revision >= -1 && ["project", "persona"].includes(v.scope);
      }
    );
  }, [sessionId]);
  const saved = draft?.getSnapshot();
  const restoring = (0, import_react14.useRef)(!!saved && saved.revision >= 0);
  const [draftRevision, setDraftRevision] = (0, import_react14.useState)(
    saved && saved.revision >= 0 ? saved.revision : void 0
  ), [draftPersona, setDraftPersona] = (0, import_react14.useState)(saved?.personaId ?? ""), [conflict, setConflict] = (0, import_react14.useState)(false);
  const [view, setView] = (0, import_react14.useState)(null), [error, setError] = (0, import_react14.useState)(""), [loadError, setLoadError] = (0, import_react14.useState)(""), [memoryEvidence, setMemoryEvidence] = (0, import_react14.useState)(null), [busy, setBusy] = (0, import_react14.useState)(false);
  const [name, setName] = (0, import_react14.useState)(saved?.name ?? ""), [instructions, setInstructions] = (0, import_react14.useState)(saved?.instructions ?? ""), [expression, setExpression] = (0, import_react14.useState)(saved?.expression ?? null), [enabled, setEnabled] = (0, import_react14.useState)(saved?.enabled ?? true);
  const [newName, setNewName] = (0, import_react14.useState)(saved?.newName ?? ""), [note, setNote] = (0, import_react14.useState)(saved?.note ?? ""), [editing, setEditing] = (0, import_react14.useState)(saved?.editing || void 0);
  const [scope, setScope] = (0, import_react14.useState)(saved?.scope ?? "project");
  const [targetPersona, setTargetPersona] = (0, import_react14.useState)("");
  const [tab, setTab] = (0, import_react14.useState)("persona");
  const newRequest = (0, import_react14.useRef)(null);
  const alive = (0, import_react14.useRef)(true), isVisible = (0, import_react14.useRef)(visible);
  (0, import_react14.useEffect)(() => {
    isVisible.current = visible;
  }, [visible]);
  (0, import_react14.useEffect)(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const configDirty = !!(view && (name !== view.template.name || instructions !== view.template.instructions || JSON.stringify(expression) !== JSON.stringify(view.template.expression ?? null) || enabled !== view.template.memoryEnabled));
  const dirty = !!note || !!newName || configDirty || restoring.current && !!saved?.configDirty;
  const handledSkill = (0, import_react14.useRef)(void 0);
  (0, import_react14.useEffect)(() => {
    if (!skillRequest || handledSkill.current === skillRequest.serial || dirty) return;
    handledSkill.current = skillRequest.serial;
    setTab("knowledge");
  }, [skillRequest?.serial, dirty]);
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
    setExpression(null);
    setView(null);
    setError("");
  };
  (0, import_react14.useEffect)(() => {
    if (!draft || !view) return;
    if (dirty)
      draft.set({
        revision: draftRevision ?? view.revision,
        personaId: draftPersona || view.persona.id,
        configDirty,
        name,
        instructions,
        expression,
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
    expression,
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
    setExpression(data.template.expression ?? null);
    setEnabled(data.template.memoryEnabled);
    if (!data.project) setScope("persona");
  };
  (0, import_react14.useEffect)(() => {
    if (!visible || busy || view && dirty) return;
    const ac = new AbortController();
    let timer;
    const refresh = async () => {
      try {
        const data = await requestJson(url, { signal: ac.signal });
        if (!ac.signal.aborted) {
          setLoadError("");
          if (restoring.current) {
            restoring.current = false;
            setView(data);
            if (!saved?.configDirty) {
              setName(data.template.name);
              setInstructions(data.template.instructions);
              setExpression(data.template.expression ?? null);
              setEnabled(data.template.memoryEnabled);
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
          }
        }
      } catch (e) {
        if (!ac.signal.aborted) setLoadError(String(e.message));
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
      if (configDirty && (!action || ["save", "forget", "memory-feedback"].includes(action.type)))
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
  const readMemoryEvidence = async (ref, offset = 0) => {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "read-history", targetSessionId: ref.sessionId, seq: ref.seq, offset })
      });
      setMemoryEvidence(
        (previous) => offset > 0 && previous?.sessionId === ref.sessionId && previous?.seq === ref.seq ? { ...result.result, text: previous.text + result.result.text } : result.result
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const createSession = async (handoff) => {
    if (!targetPersona) return;
    setBusy(true);
    setError("");
    const key = `${sessionId}:${targetPersona}:${handoff}`;
    if (newRequest.current?.key !== key) newRequest.current = { key, id: crypto.randomUUID() };
    const requestId = newRequest.current.id;
    try {
      const data = await requestJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "new-session",
          personaId: targetPersona,
          handoff,
          requestId
        })
      }).catch((error2) => {
        if (error2.status === 409 && newRequest.current?.id === requestId) newRequest.current = null;
        throw error2;
      });
      await prepareCreatedSession(data.createdSessionId);
      if (alive.current && isVisible.current) openSession(data.createdSessionId);
      newRequest.current = null;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
    "div",
    {
      className: "px-ui px-memory-panel",
      style: { padding: 20, flex: 1, minHeight: 0, overflow: "auto", overflowWrap: "anywhere", fontSize: 14 },
      children: /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { style: { maxWidth: 960, margin: "0 auto" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "px-actions", style: { justifyContent: "space-between" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h2", { style: { margin: "0 0 8px" }, children: "\u8BB0\u5FC6\u4E0E\u77E5\u8BC6" }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => setTab("advanced"), "aria-pressed": tab === "advanced", children: "\u9AD8\u7EA7\u8BBE\u7F6E" })
        ] }),
        view && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { className: "px-muted", children: [
          "\u5F53\u524D\u4EBA\u683C\uFF1A",
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("strong", { children: view.persona.name }),
          " \xB7 \u9879\u76EE\uFF1A",
          view.project ? view.project.split(/[\\/]/).filter(Boolean).pop() : "\u672A\u5173\u8054\u9879\u76EE",
          view.binding.locked ? " \xB7 \u4F1A\u8BDD\u4EBA\u683C\u5DF2\u56FA\u5B9A" : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "px-actions", role: "group", "aria-label": "\u8BB0\u5FC6\u9875\u9762", children: [
          ["persona", view?.binding.channel?.access === "public" ? "\u4EBA\u683C\u914D\u7F6E" : "\u4EBA\u683C\u8BB0\u5FC6"],
          ...view?.binding.channel?.access === "public" ? [["conversation-memory", "\u672C\u804A\u5929\u8BB0\u5FC6"]] : [],
          ["history", "\u7ECF\u5386\u4E0E\u5386\u53F2"],
          ["knowledge", "\u77E5\u8BC6\u4E0E Skills"]
        ].map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
          "button",
          {
            "aria-pressed": tab === id,
            className: tab === id ? "px-primary" : "",
            onClick: () => setTab(id),
            children: label
          },
          id
        )) }),
        dirty && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { role: "status", style: { opacity: 0.7 }, children: "\u8349\u7A3F\u5C1A\u672A\u4FDD\u5B58\uFF0C\u5DF2\u6682\u505C\u81EA\u52A8\u5237\u65B0\u3002\u5207\u6362\u9875\u9762\u4F1A\u4FDD\u7559\u8349\u7A3F\uFF1B\u4FDD\u5B58\u65F6\u4ECD\u4F1A\u6838\u5BF9\u539F\u7248\u672C\u3002" }),
        !draft && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { role: "alert", children: "\u5F53\u524D\u7A97\u53E3\u8349\u7A3F\u5DF2\u6EE1\u3002\u672C\u9875\u65B0\u7F16\u8F91\u6682\u4E0D\u80FD\u8DE8\u9875\u4FDD\u7559\uFF0C\u8BF7\u5148\u4FDD\u5B58\u5176\u4ED6\u8349\u7A3F\u3002" }),
        tab === "persona" && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { style: controlStyle, disabled: busy || dirty, onClick: () => void act(), children: "\u5237\u65B0\u8BB0\u5F55" }),
        error && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { role: "alert", children: [
          error,
          " "
        ] }),
        loadError && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { role: "alert", children: loadError }),
        dirty && skillRequest && handledSkill.current !== skillRequest.serial && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { role: "status", children: [
          "\u5148\u4FDD\u5B58\u6216\u53D6\u6D88\u5F53\u524D\u4EBA\u683C\u7F16\u8F91\uFF0C\u518D\u6253\u5F00\u6280\u80FD ",
          skillRequest.name,
          "\u3002\u8349\u7A3F\u4ECD\u4FDD\u7559\u3002"
        ] }),
        conflict && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { disabled: busy, onClick: discardDraft, children: "\u653E\u5F03\u8349\u7A3F\u5E76\u8BFB\u53D6\u6700\u65B0" }),
        !view && !error && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u2026" }),
        view && !identityChanged && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
          tab === "conversation-memory" && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ChannelNotesPanel, { url }, sessionId + ":" + view.persona.id),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { hidden: tab !== "history", children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(SegmentPanel, { url, visible: visible && tab === "history" }, sessionId + ":segments"),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
              HistoryPanel,
              {
                url,
                visible: visible && tab === "history",
                openSession
              },
              view.persona.id
            )
          ] }),
          tab === "knowledge" && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
            KnowledgePanel,
            {
              sessionId,
              personaId: view.persona.id,
              project: view.project,
              skillRequest
            },
            sessionId + view.persona.id
          ),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { hidden: tab !== "advanced", children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h3", { children: "\u5F15\u64CE\u914D\u7F6E\u4E0E\u8BCA\u65AD" }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "px-muted", children: "\u65E5\u5E38\u8D44\u6599\u5728\u524D\u9762\u7684\u9875\u9762\u7BA1\u7406\u3002\u8FD9\u91CC\u4FDD\u7559 Mnemon \u539F\u751F\u8BBE\u7F6E\u3001\u9879\u76EE\u6863\u6848\u53CA\u5176\u4ED6\u8BB0\u5FC6\u6765\u6E90\u3002 \u540E\u53F0\u4E0A\u4E0B\u6587\u6574\u7406\u7531\u201C\u7ECF\u5386\u4E0E\u5386\u53F2\u201D\u4E2D\u7684\u5F00\u5173\u63A7\u5236\uFF1B\u8BB0\u5FC6\u5EFA\u8BAE\u548C\u6280\u80FD\u66F4\u6539\u4ECD\u9700\u660E\u786E\u91C7\u7EB3\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "px-actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
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
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h3", { children: "\u5F53\u524D\u5DE5\u4F5C\u653E\u5728\u54EA\u91CC\uFF1F" }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "\u4EFB\u52A1\u8FDB\u5EA6\u548C\u4E0B\u4E00\u6B65\u4FDD\u5B58\u5728\u5DE5\u4F5C\u8D26\u672C\uFF0CGoal \u4E0E Team \u4ECD\u4EE5\u539F\u751F\u6267\u884C\u72B6\u6001\u4E3A\u51C6\u3002\u957F\u671F\u7EA6\u5B9A\u653E\u5728\u4EBA\u683C\u8BB0\u5FC6\uFF0C\u53EF\u590D\u7528\u7ED3\u8BBA\u653E\u5728\u77E5\u8BC6\u5E93\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { disabled: dirty || busy, onClick: openTasks, children: "\u67E5\u770B\u5F53\u524D\u4EFB\u52A1\u4E0E\u5DE5\u4F5C\u8D26\u672C" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { hidden: tab !== "persona", children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { className: "px-card", children: [
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("summary", { children: "\u4EBA\u683C\u4E0E\u534F\u4F5C\u504F\u597D" }),
              /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
                "\u5F53\u524D\u4F1A\u8BDD\u7684\u4EBA\u683C",
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
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
                    children: view.personas.map((p) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("option", { value: p.id, disabled: p.archived, children: [
                      p.name,
                      p.archived ? "\uFF08\u5DF2\u5F52\u6863\uFF09" : ""
                    ] }, p.id))
                  }
                )
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { className: "px-muted", children: [
                "\u672C\u4F1A\u8BDD\u4F7F\u7528\u914D\u7F6E\u7248\u672C ",
                view.binding.personaRevision,
                "\u3002",
                view.binding.locked ? "\u4EBA\u683C\u5DF2\u56FA\u5B9A\u3002" : "\u5C1A\u672A\u5F00\u59CB\uFF0C\u53EF\u4EE5\u9009\u62E9\u4EBA\u683C\u3002"
              ] }),
              view.persona.archived && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { role: "status", children: "\u6B64\u4EBA\u683C\u5DF2\u5F52\u6863\u3002\u5386\u53F2\u4ECD\u53EF\u67E5\u770B\uFF0C\u8BF7\u65B0\u5EFA\u5176\u4ED6\u4EBA\u683C\u7684\u4F1A\u8BDD\u7EE7\u7EED\u3002" }),
              view.template.revision !== view.binding.personaRevision && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
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
              view.binding.handoff && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { className: "px-muted", children: [
                "\u5DF2\u63A5\u7EED\u6765\u6E90\u4F1A\u8BDD\u622A\u81F3\u4E8B\u4EF6 ",
                view.binding.handoff.throughSeq,
                " ",
                "\u7684\u5BF9\u8BDD\u4E0E\u6267\u884C\u8BB0\u5F55\uFF1B\u539F\u4F1A\u8BDD\u4EFB\u52A1\u4E0D\u4F1A\u81EA\u52A8\u6062\u590D\u3002"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { className: "px-card", children: [
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("summary", { children: "\u7528\u53E6\u4E00\u4E2A\u4EBA\u683C\u7EE7\u7EED" }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "\u63A5\u7EED\u4F1A\u8BDD\u53EF\u6309\u9700\u8BFB\u53D6\u539F\u4F1A\u8BDD\u622A\u81F3\u521B\u5EFA\u65F6\u7684\u53EF\u89C1\u5BF9\u8BDD\u4E0E\u6267\u884C\u8BB0\u5F55\uFF0C\u4E0D\u590D\u5236\u65E7\u4EBA\u683C\u7684\u79C1\u6709\u8BB0\u5FC6\u6CE8\u5165\u3002\u539F\u4F1A\u8BDD\u5DF2\u8BF4\u51FA\u7684\u5185\u5BB9\u4E5F\u5728\u4EA4\u63A5\u8303\u56F4\u5185\u3002" }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
                  "select",
                  {
                    "aria-label": "\u65B0\u4F1A\u8BDD\u4EBA\u683C",
                    value: targetPersona,
                    disabled: busy,
                    onChange: (e) => setTargetPersona(e.target.value),
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { value: "", children: "\u9009\u62E9\u4EBA\u683C" }),
                      view.personas.filter((p) => !p.archived).map((p) => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { value: p.id, children: p.name }, p.id))
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "px-actions", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                    "button",
                    {
                      disabled: busy || dirty || !targetPersona,
                      onClick: () => void createSession(true),
                      children: "\u65B0\u5EFA\u63A5\u7EED\u4F1A\u8BDD"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                    "button",
                    {
                      disabled: busy || dirty || !targetPersona,
                      onClick: () => void createSession(false),
                      children: "\u65B0\u5EFA\u7A7A\u767D\u4F1A\u8BDD"
                    }
                  )
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { style: { ...cardStyle, marginBottom: 16 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("summary", { children: [
                    "\u672C\u4F1A\u8BDD\u7684\u4EBA\u683C\u914D\u7F6E \xB7 \u7248\u672C ",
                    view.binding.personaRevision
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { style: { whiteSpace: "pre-wrap" }, children: renderPersonaExpression(view.persona.expression) || "\u672A\u8BBE\u7F6E\u72EC\u7ACB\u7684\u516C\u5F00\u8868\u8FBE\uFF0C\u6CBF\u7528\u539F\u6709\u534F\u4F5C\u548C\u6E20\u9053\u914D\u7F6E\u3002" }),
                  !!view.persona.expression?.scenes?.length && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { className: "px-muted", children: [
                    "\u672C\u7248\u672C\u53E6\u6709 ",
                    view.persona.expression.scenes.length,
                    " \u6761\u6309\u5BF9\u8C61\u4E0E\u573A\u5408\u4F7F\u7528\u7684\u8868\u8FBE\u89C4\u5219\u3002"
                  ] })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { style: { ...cardStyle, marginBottom: 16 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("summary", { children: "\u7F16\u8F91\u4EBA\u683C\u6A21\u677F\uFF08\u4FDD\u5B58\u4E3A\u65B0\u7248\u672C\uFF09" }),
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
                    "\u540D\u79F0",
                    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
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
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
                    "\u79C1\u4EBA\u534F\u4F5C\u8981\u6C42",
                    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                      "textarea",
                      {
                        disabled: busy || view.persona.archived,
                        "aria-label": "\u79C1\u4EBA\u534F\u4F5C\u8981\u6C42",
                        rows: 4,
                        maxLength: 2e3,
                        style: { ...controlStyle, width: "100%", resize: "vertical" },
                        placeholder: "\u53EA\u7528\u4E8E\u79C1\u4EBA\u548C\u672C\u673A\u5DE5\u4F5C\u4F1A\u8BDD\uFF0C\u4E0D\u81EA\u52A8\u516C\u5F00\u5230\u7FA4\u804A\u3002\u4F8B\u5982\uFF1A\u7814\u7A76\u65F6\u6807\u660E\u6765\u6E90\u3002",
                        value: instructions,
                        onChange: (e) => {
                          beginEdit();
                          setInstructions(e.target.value);
                        }
                      }
                    )
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                    PersonaExpressionEditor,
                    {
                      value: expression,
                      disabled: busy || !!view.persona.archived,
                      onChange: (value) => {
                        beginEdit();
                        setExpression(value);
                      }
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
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
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                    "button",
                    {
                      style: controlStyle,
                      disabled: busy || !name.trim() || view.persona.archived,
                      onClick: () => void act({
                        type: "configure",
                        name,
                        instructions,
                        expression,
                        memoryEnabled: enabled
                      }),
                      children: "\u4FDD\u5B58\u4EBA\u683C"
                    }
                  ) })
                ] }),
                dirty && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
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
                view.persona.id !== "default" && !view.persona.archived && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
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
                /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { style: { ...cardStyle, marginBottom: 16 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("summary", { children: "\u65B0\u589E\u4EBA\u683C" }),
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "\u65B0\u5EFA\u540E\u4F7F\u7528\u72EC\u7ACB\u7684\u7A7A\u8BB0\u5FC6\uFF0C\u4E0D\u590D\u5236\u5176\u4ED6\u4EBA\u683C\u7684\u8BB0\u5FC6\u3002" }),
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
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
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                    "button",
                    {
                      style: controlStyle,
                      disabled: busy || !newName.trim() || !!note || name !== view.template.name || instructions !== view.template.instructions || JSON.stringify(expression) !== JSON.stringify(view.template.expression ?? null) || enabled !== view.template.memoryEnabled,
                      onClick: () => void act({ type: "create", name: newName }).then((ok) => {
                        if (ok) setNewName("");
                      }),
                      children: view.binding.locked ? "\u521B\u5EFA\u4EBA\u683C" : "\u521B\u5EFA\u5E76\u9009\u62E9"
                    }
                  )
                ] })
              ] })
            ] }),
            view.binding.channel?.access === "public" ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { children: [
              "\u6B64\u804A\u5929\u6309\u81EA\u5DF1\u7684\u8D44\u6599\u8303\u56F4\u4F7F\u7528\u8BB0\u5FC6\u3002",
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => setTab("conversation-memory"), children: "\u67E5\u770B\u672C\u804A\u5929\u8BB0\u5FC6" })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h3", { children: "\u4FDD\u5B58\u7684\u7EA6\u5B9A" }),
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { style: { opacity: 0.7 }, children: "\u53EA\u663E\u793A\u672C\u76EE\u5F55\u53CA\u6B64\u4EBA\u683C\u901A\u7528\u7684\u8BB0\u5FC6\u3002\u53EF\u76F4\u63A5\u7F16\u8F91\uFF0C\u4E5F\u53EF\u5728\u5BF9\u8BDD\u4E2D\u660E\u786E\u8981\u6C42 Agent \u8BB0\u4F4F\u6216\u5FD8\u8BB0\u3002" }),
              !view.persona.memoryEnabled && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { role: "status", children: "\u6B64\u4EBA\u683C\u7684\u8BB0\u5FC6\u5DF2\u5173\u95ED\uFF0C\u6761\u76EE\u4ECD\u4FDD\u7559\u3002\u53EF\u5728\u201C\u4EBA\u683C\u4E0E\u534F\u4F5C\u504F\u597D\u201D\u4E2D\u5F00\u542F\u3002" }),
              !view.persona.memories.some((m) => !m.project || m.project === view.project) && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "px-empty", children: "\u8FD8\u6CA1\u6709\u4FDD\u5B58\u7EA6\u5B9A\u3002\u53EF\u4EE5\u8BB0\u4E0B\u4F60\u7684\u534F\u4F5C\u504F\u597D\uFF0C\u4E5F\u53EF\u4EE5\u5728\u5BF9\u8BDD\u4E2D\u660E\u786E\u8981\u6C42\u52A9\u624B\u8BB0\u4F4F\u3002" }),
              view.persona.memories.filter((m) => !m.project || m.project === view.project).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((m) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { style: { ...cardStyle, marginBottom: 8 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("small", { children: m.project ? "\u672C\u76EE\u5F55" : "\u6B64\u4EBA\u683C\u901A\u7528" }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("small", { children: [
                  " ",
                  "\xB7 v",
                  m.entryRevision ?? 1,
                  " \xB7",
                  " ",
                  m.provenance?.actor === "human" ? "\u7528\u6237\u4FDD\u5B58" : m.provenance?.actor === "model" ? "\u6A21\u578B\u6574\u7406" : "\u6765\u6E90\u672A\u6807\u6CE8"
                ] }),
                m.current === false && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { role: "status", children: "\u6B64\u4FEE\u8BA2\u5DF2\u6807\u8BB0\u4E3A\u4E0D\u6B63\u786E\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u6CE8\u5165\u3002\u53EF\u7F16\u8F91\u7EA0\u6B63\u6216\u5FD8\u8BB0\u3002" }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { style: { whiteSpace: "pre-wrap" }, children: m.text }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                  "button",
                  {
                    style: controlStyle,
                    disabled: busy || view.persona.archived,
                    onClick: () => edit(m),
                    children: "\u7F16\u8F91"
                  }
                ),
                " ",
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
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
                ),
                !!m.provenance?.events.length && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("summary", { children: "\u539F\u59CB\u4F9D\u636E" }),
                  m.provenance.events.map((ref) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
                    "button",
                    {
                      disabled: busy,
                      onClick: () => void readMemoryEvidence(ref),
                      children: [
                        "\u8BFB\u53D6\u4E8B\u4EF6 ",
                        ref.seq
                      ]
                    },
                    ref.sessionId + ":" + ref.seq
                  ))
                ] }),
                m.previous && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("summary", { children: [
                    "\u524D\u4E00\u7248\u6765\u6E90\uFF08v",
                    m.previous.entryRevision,
                    "\uFF09"
                  ] }),
                  m.previous.provenance?.events.length ? m.previous.provenance.events.map((ref) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
                    "button",
                    {
                      disabled: busy,
                      onClick: () => void readMemoryEvidence(ref),
                      children: [
                        "\u8BFB\u53D6\u4E8B\u4EF6 ",
                        ref.seq
                      ]
                    },
                    ref.sessionId + ":" + ref.seq
                  )) : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "\u524D\u4E00\u7248\u6CA1\u6709\u5173\u8054\u539F\u59CB\u4E8B\u4EF6\u3002" })
                ] }),
                m.origin && m.origin.entryRevision !== m.previous?.entryRevision && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("summary", { children: [
                    "\u6700\u65E9\u4FDD\u7559\u7684\u6765\u6E90\uFF08v",
                    m.origin.entryRevision,
                    "\uFF09"
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "px-muted", children: "\u7528\u4E8E\u8FFD\u6EAF\u6761\u76EE\u7531\u6765\uFF0C\u4E0D\u8868\u793A\u65E7\u8BC1\u636E\u80FD\u8BC1\u660E\u5F53\u524D\u4FEE\u8BA2\u3002" }),
                  m.origin.provenance?.events.length ? m.origin.provenance.events.map((ref) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
                    "button",
                    {
                      disabled: busy,
                      onClick: () => void readMemoryEvidence(ref),
                      children: [
                        "\u8BFB\u53D6\u4E8B\u4EF6 ",
                        ref.seq
                      ]
                    },
                    ref.sessionId + ":" + ref.seq
                  )) : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "\u8FD9\u4E00\u7248\u6CA1\u6709\u5173\u8054\u539F\u59CB\u4E8B\u4EF6\u3002" })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                  MemoryFeedbackPanel,
                  {
                    value: m.feedback,
                    busy,
                    disabled: view.persona.archived || dirty,
                    readSource: (ref) => void readMemoryEvidence(ref),
                    submit: async (kind, reason) => {
                      await act({
                        type: "memory-feedback",
                        id: m.id,
                        entryRevision: m.entryRevision ?? 1,
                        kind,
                        reason
                      });
                    }
                  },
                  m.id + ":" + (m.entryRevision ?? 1)
                )
              ] }, m.id)),
              memoryEvidence && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { style: cardStyle, children: [
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => setMemoryEvidence(null), children: "\u6536\u8D77\u4F9D\u636E" }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { children: [
                  "\u6765\u6E90\u4F1A\u8BDD ",
                  memoryEvidence.sessionId,
                  " \xB7 \u4E8B\u4EF6 ",
                  memoryEvidence.seq,
                  " \xB7 \u5DF2\u663E\u793A",
                  " ",
                  memoryEvidence.text.length,
                  " / ",
                  memoryEvidence.totalCharacters,
                  " \u5B57\u7B26"
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("pre", { style: { whiteSpace: "pre-wrap" }, children: memoryEvidence.text }),
                memoryEvidence.nextOffset !== null && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                  "button",
                  {
                    disabled: busy,
                    onClick: () => void readMemoryEvidence(memoryEvidence, memoryEvidence.nextOffset),
                    children: "\u7EE7\u7EED\u8BFB\u53D6\u539F\u6587"
                  }
                )
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
                  "select",
                  {
                    disabled: busy || view.persona.archived,
                    "aria-label": "\u8BB0\u5FC6\u8303\u56F4",
                    style: controlStyle,
                    value: scope,
                    onChange: (e) => setScope(e.target.value),
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { value: "project", disabled: !view.project, children: "\u672C\u76EE\u5F55" }),
                      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { value: "persona", children: "\u6B64\u4EBA\u683C\u901A\u7528" })
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                  "button",
                  {
                    style: controlStyle,
                    disabled: busy || !note.trim() || view.persona.archived,
                    onClick: () => void act({ type: "save", id: editing, text: note, scope }).then((ok) => {
                      if (ok) {
                        setNote("");
                        setEditing(void 0);
                      }
                    }),
                    children: editing ? "\u4FDD\u5B58\u4FEE\u6539" : "\u8BB0\u4F4F"
                  }
                ),
                note && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { style: { opacity: 0.65 }, children: "\u6BCF\u6761\u6700\u591A 2000 \u5B57\uFF0C\u6BCF\u4E2A\u4EBA\u683C\u5408\u8BA1\u6700\u591A 8000 \u5B57\u3002\u4E34\u65F6\u4EFB\u52A1\u8FDB\u5EA6\u8BF7\u653E\u5728\u4F1A\u8BDD\u8D26\u672C\u4E2D\u3002" })
            ] })
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
      const personaNavigation = registerPersonaNavigationClient(host);
      const workspace = registerMemoryWorkspace(host, MemoryPanel);
      const nativePage = registerMnemonKnowledgePage(host, workspace.open);
      const skillNavigation = registerMnemonSkillNavigation(host, workspace.openSkill);
      const sidebar = createNativeSidebar(host).registerTab({
        id: "dsh-px-memory",
        title: "\u8BB0\u5FC6\u4E0E\u77E5\u8BC6",
        order: 17,
        component: ({ scope }) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "px-ui", style: { padding: 16 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h3", { children: "\u8BB0\u5FC6\u4E0E\u77E5\u8BC6" }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "\u4EBA\u683C\u7EA6\u5B9A\u3001\u5386\u53F2\u68C0\u7D22\u3001\u77E5\u8BC6\u4E0E Skills \u5728\u540C\u4E00\u4E2A\u9875\u9762\u7BA1\u7406\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => workspace.open(scope.sessionId), children: "\u6253\u5F00\u8BB0\u5FC6\u4E0E\u77E5\u8BC6" })
        ] })
      });
      return () => {
        personaNavigation();
        sidebar();
        nativePage();
        skillNavigation();
        workspace.dispose();
      };
    }, "memory: unified workspace")
  );
}

		return module.exports;
	}
});
