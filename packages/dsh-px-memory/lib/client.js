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
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react2 = require("react");

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

// packages/dsh-px-memory/src/client.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var inject = [];
function MemoryPanel({ sessionId, visible }) {
  const [view, setView] = (0, import_react2.useState)(null), [error, setError] = (0, import_react2.useState)(""), [busy, setBusy] = (0, import_react2.useState)(false);
  const [name, setName] = (0, import_react2.useState)(""), [instructions, setInstructions] = (0, import_react2.useState)(""), [enabled, setEnabled] = (0, import_react2.useState)(true);
  const [newName, setNewName] = (0, import_react2.useState)(""), [note, setNote] = (0, import_react2.useState)(""), [editing, setEditing] = (0, import_react2.useState)(void 0);
  const [scope, setScope] = (0, import_react2.useState)("project");
  const dirty = !!note || !!newName || !!(view && (name !== view.persona.name || instructions !== view.persona.instructions || enabled !== view.persona.memoryEnabled));
  const url = `/dsh-px-memory?sessionId=${encodeURIComponent(sessionId)}`;
  const accept = (data) => {
    setView(data);
    setName(data.persona.name);
    setInstructions(data.persona.instructions);
    setEnabled(data.persona.memoryEnabled);
  };
  (0, import_react2.useEffect)(() => {
    if (!visible || busy || dirty) return;
    const ac = new AbortController();
    let timer;
    const refresh = async () => {
      try {
        const data = await requestJson(url, { signal: ac.signal });
        if (!ac.signal.aborted) accept(data);
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
  }, [url, visible, busy, dirty]);
  const act = async (action) => {
    setBusy(true);
    setError("");
    try {
      const data = await requestJson(
        url,
        action ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...action, revision: view?.revision })
        } : {}
      );
      if (!action && dirty && data.persona.id !== view?.persona.id) {
        setError("\u53E6\u4E00\u4E2A\u7A97\u53E3\u5207\u6362\u4E86\u4EBA\u683C\uFF1B\u8BF7\u53D6\u6D88\u5F53\u524D\u7F16\u8F91\u540E\u5237\u65B0\uFF0C\u8349\u7A3F\u672A\u88AB\u8986\u76D6\u3002");
        return false;
      }
      if (!action && dirty || action && ["save", "forget"].includes(action.type))
        setView(data);
      else accept(data);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const edit = (entry) => {
    setEditing(entry.id);
    setNote(entry.text);
    setScope(entry.project ? "project" : "persona");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "div",
    {
      className: "px-ui",
      style: { padding: 16, height: "100%", overflow: "auto", overflowWrap: "anywhere", fontSize: 13 },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: "\u4EBA\u683C\u4E0E\u8BB0\u5FC6" }),
        dirty && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", style: { opacity: 0.7 }, children: "\u6709\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\uFF0C\u81EA\u52A8\u5237\u65B0\u5DF2\u6682\u505C\u3002\u53EF\u624B\u52A8\u5237\u65B0\u8BB0\u5F55\uFF0C\u8349\u7A3F\u4F1A\u4FDD\u7559\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { style: controlStyle, disabled: busy, onClick: () => void act(), children: "\u5237\u65B0\u8BB0\u5F55" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u6BCF\u4E2A\u4EBA\u683C\u6709\u72EC\u7ACB\u7684\u534F\u4F5C\u65B9\u5F0F\u548C\u8BB0\u5FC6\u3002\u5207\u6362\u6216\u4FEE\u6539\u4ECE\u4E0B\u4E00\u8F6E\u751F\u6548\uFF0C\u6A21\u578B\u4E0E\u6743\u9650\u6CBF\u7528\u5F53\u524D\u4F1A\u8BDD\u3002" }),
        error && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { role: "alert", children: [
          error,
          " "
        ] }),
        !view && !error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u2026" }),
        view && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
            "\u5F53\u524D\u4F1A\u8BDD\u7684\u4EBA\u683C",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "select",
              {
                "aria-label": "\u5F53\u524D\u4EBA\u683C",
                style: { ...controlStyle, width: "100%", margin: "8px 0 16px" },
                disabled: busy,
                value: view.persona.id,
                onChange: (e) => {
                  if (name !== view.persona.name || instructions !== view.persona.instructions || enabled !== view.persona.memoryEnabled || note) {
                    setError("\u8BF7\u5148\u4FDD\u5B58\u6216\u6E05\u7A7A\u5F53\u524D\u7F16\u8F91\uFF0C\u518D\u5207\u6362\u4EBA\u683C\u3002");
                    return;
                  }
                  void act({ type: "select", personaId: e.target.value });
                },
                children: view.personas.map((p) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: p.id, children: p.name }, p.id))
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { style: { ...cardStyle, marginBottom: 16 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u7F16\u8F91\u4EBA\u683C" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
              "\u540D\u79F0",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "input",
                {
                  disabled: busy,
                  "aria-label": "\u4EBA\u683C\u540D\u79F0",
                  style: { ...controlStyle, width: "100%" },
                  maxLength: 60,
                  value: name,
                  onChange: (e) => setName(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
              "\u804C\u8D23\u4E0E\u534F\u4F5C\u65B9\u5F0F",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "textarea",
                {
                  disabled: busy,
                  "aria-label": "\u804C\u8D23\u4E0E\u534F\u4F5C\u65B9\u5F0F",
                  rows: 4,
                  maxLength: 2e3,
                  style: { ...controlStyle, width: "100%", resize: "vertical" },
                  placeholder: "\u4F8B\u5982\uFF1A\u5148\u89E3\u91CA\u7ED3\u8BBA\uFF1B\u534F\u52A9\u7814\u7A76\u65F6\u6807\u660E\u6765\u6E90\u548C\u4E0D\u786E\u5B9A\u6027\u3002",
                  value: instructions,
                  onChange: (e) => setInstructions(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "input",
                {
                  disabled: busy,
                  type: "checkbox",
                  checked: enabled,
                  onChange: (e) => setEnabled(e.target.checked)
                }
              ),
              " ",
              "\u4F7F\u7528\u5E76\u5141\u8BB8\u4FDD\u5B58\u6B64\u4EBA\u683C\u7684\u8BB0\u5FC6"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                style: controlStyle,
                disabled: busy || !name.trim(),
                onClick: () => void act({ type: "configure", name, instructions, memoryEnabled: enabled }),
                children: "\u4FDD\u5B58\u4EBA\u683C"
              }
            ) })
          ] }),
          dirty && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
          view.persona.id !== "default" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              style: { ...controlStyle, marginBottom: 16 },
              disabled: busy || !!note,
              onClick: () => {
                if (window.confirm(
                  "\u5220\u9664\u6B64\u4EBA\u683C\u53CA\u5176\u5168\u90E8\u8BB0\u5FC6\uFF1F\u4F7F\u7528\u5B83\u7684\u4F1A\u8BDD\u5C06\u5728\u4E0B\u4E00\u8F6E\u6062\u590D\u9ED8\u8BA4\u52A9\u624B\uFF1B\u5DF2\u6709\u5BF9\u8BDD\u8BB0\u5F55\u4FDD\u7559\u3002"
                ))
                  void act({ type: "delete-persona" });
              },
              children: "\u5220\u9664\u6B64\u4EBA\u683C\u53CA\u8BB0\u5FC6"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { style: { ...cardStyle, marginBottom: 16 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u65B0\u589E\u4EBA\u683C" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u65B0\u5EFA\u540E\u4F7F\u7528\u72EC\u7ACB\u7684\u7A7A\u8BB0\u5FC6\uFF0C\u4E0D\u590D\u5236\u5176\u4ED6\u4EBA\u683C\u7684\u8BB0\u5FC6\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "input",
              {
                disabled: busy,
                "aria-label": "\u65B0\u4EBA\u683C\u540D\u79F0",
                style: controlStyle,
                placeholder: "\u4F8B\u5982\uFF1A\u7814\u7A76\u52A9\u624B",
                value: newName,
                maxLength: 60,
                onChange: (e) => setNewName(e.target.value)
              }
            ),
            " ",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                style: controlStyle,
                disabled: busy || !newName.trim() || !!note || name !== view.persona.name || instructions !== view.persona.instructions || enabled !== view.persona.memoryEnabled,
                onClick: () => void act({ type: "create", name: newName }).then((ok) => {
                  if (ok) setNewName("");
                }),
                children: "\u521B\u5EFA\u5E76\u9009\u62E9"
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h4", { children: "\u4FDD\u5B58\u7684\u8BB0\u5FC6" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { opacity: 0.7 }, children: "\u53EA\u663E\u793A\u672C\u76EE\u5F55\u53CA\u6B64\u4EBA\u683C\u901A\u7528\u7684\u8BB0\u5FC6\u3002\u53EF\u76F4\u63A5\u7F16\u8F91\uFF0C\u4E5F\u53EF\u5728\u5BF9\u8BDD\u4E2D\u660E\u786E\u8981\u6C42 Agent \u8BB0\u4F4F\u6216\u5FD8\u8BB0\u3002" }),
          !view.persona.memoryEnabled && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u8BB0\u5FC6\u5DF2\u5173\u95ED\uFF0C\u6761\u76EE\u4ECD\u4FDD\u7559\u3002" }),
          view.persona.memories.filter((m) => !m.project || m.project === view.project).map((m) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { style: { ...cardStyle, marginBottom: 8 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: m.project ? "\u672C\u76EE\u5F55" : "\u6B64\u4EBA\u683C\u901A\u7528" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { whiteSpace: "pre-wrap" }, children: m.text }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { style: controlStyle, disabled: busy, onClick: () => edit(m), children: "\u7F16\u8F91" }),
            " ",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "textarea",
            {
              disabled: busy,
              "aria-label": "\u8BB0\u5FC6\u5185\u5BB9",
              rows: 3,
              maxLength: 2e3,
              style: { ...controlStyle, width: "100%", resize: "vertical" },
              placeholder: "\u5199\u4E0B\u9700\u8981\u5728\u4EE5\u540E\u7684\u4F1A\u8BDD\u4E2D\u8BB0\u4F4F\u7684\u7EA6\u5B9A\u2026",
              value: note,
              onChange: (e) => setNote(e.target.value)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
              "select",
              {
                disabled: busy,
                "aria-label": "\u8BB0\u5FC6\u8303\u56F4",
                style: controlStyle,
                value: scope,
                onChange: (e) => setScope(e.target.value),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "project", disabled: !view.project, children: "\u672C\u76EE\u5F55" }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "persona", children: "\u6B64\u4EBA\u683C\u901A\u7528" })
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                style: controlStyle,
                disabled: busy || !note.trim() || !view.persona.memoryEnabled,
                onClick: () => void act({ type: "save", id: editing, text: note, scope }).then((ok) => {
                  if (ok) {
                    setNote("");
                    setEditing(void 0);
                  }
                }),
                children: editing ? "\u4FDD\u5B58\u4FEE\u6539" : "\u8BB0\u4F4F"
              }
            ),
            note && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { opacity: 0.65 }, children: "\u6BCF\u6761\u6700\u591A 2000 \u5B57\uFF0C\u6BCF\u4E2A\u4EBA\u683C\u5408\u8BA1\u6700\u591A 8000 \u5B57\u3002\u4E34\u65F6\u4EFB\u52A1\u8FDB\u5EA6\u8BF7\u653E\u5728\u4F1A\u8BDD\u8D26\u672C\u4E2D\u3002" })
        ] })
      ]
    }
  );
}
function apply(ctx) {
  installUiStyles(ctx);
  ctx.inject(
    ["sidebarRight", "sidebarRightTabs", "slots"],
    (host) => host.effect(
      () => createNativeSidebar(host).registerTab({
        id: "dsh-px-memory",
        title: "\u4EBA\u683C\u4E0E\u8BB0\u5FC6",
        order: 17,
        component: ({ scope, visible }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(MemoryPanel, { sessionId: scope.sessionId, visible }, scope.sessionId)
      }),
      "memory: panel"
    )
  );
}

		return module.exports;
	}
});
