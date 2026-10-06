window.__ModuleLoader__.load({
	id: "dsh-px-computer",
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

// packages/dsh-px-computer/src/client.tsx
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

// packages/dsh-px-computer/src/client.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var inject = [];
var BROWSER_LABEL = {
  off: "\u5173\u95ED",
  isolated: "\u72EC\u7ACB\u6D4F\u89C8\u5668\uFF08\u4E0D\u4FDD\u5B58\u767B\u5F55\uFF09",
  profile: "PX \u4E13\u7528\u6D4F\u89C8\u5668\uFF08\u4FDD\u5B58\u5728\u5176\u4E2D\u7684\u767B\u5F55\uFF09",
  extension: "\u63A5\u7BA1\u6211\u7684 Edge\uFF08\u9700 Playwright \u6269\u5C55\uFF09"
};
var OUTCOME = {
  ok: "\u5B8C\u6210",
  error: "\u5931\u8D25",
  denied: "\u5DF2\u62E6\u622A",
  rejected: "\u672A\u83B7\u5141\u8BB8"
};
var EXTENSION_URL = "https://microsoftedge.microsoft.com/addons/search/playwright%20extension";
function time(at) {
  return new Date(at).toLocaleTimeString("zh-CN", { hour12: false });
}
function ComputerPanel({ sessionId, visible }) {
  const [view, setView] = (0, import_react2.useState)(null), [error, setError] = (0, import_react2.useState)(""), [busy, setBusy] = (0, import_react2.useState)(false);
  const url = `/dsh-px-computer?sessionId=${encodeURIComponent(sessionId)}`;
  (0, import_react2.useEffect)(() => {
    if (!visible) return;
    const ac = new AbortController();
    let timer;
    const refresh = async () => {
      try {
        const data = await requestJson(url, { signal: ac.signal });
        if (!ac.signal.aborted) {
          setView(data);
          setError("");
        }
      } catch (e) {
        if (!ac.signal.aborted) setError(String(e.message));
      }
      if (!ac.signal.aborted) timer = setTimeout(() => void refresh(), 2500);
    };
    void refresh();
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [url, visible]);
  const act = async (action) => {
    setBusy(true);
    setError("");
    try {
      setView(
        await requestJson(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...action, revision: view?.settings.revision })
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const s = view?.settings;
  const supported = view?.status.platform === "win32";
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "div",
    {
      className: "px-ui",
      style: { padding: 16, height: "100%", overflow: "auto", overflowWrap: "anywhere", fontSize: 13 },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: "\u7535\u8111\u64CD\u4F5C" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "px-muted", children: "\u5F00\u542F\u540E\uFF0Cagent \u53EF\u4EE5\u5728\u4F60\u6388\u6743\u7684\u8303\u56F4\u5185\u67E5\u770B\u5E76\u64CD\u4F5C\u672C\u673A\u5E94\u7528\u548C\u7F51\u9875\u3002\u7B2C\u4E00\u6B21\u64CD\u4F5C\u67D0\u4E2A\u5E94\u7528\u90FD\u4F1A\u5148\u8BE2\u95EE\uFF1B\u5220\u9664\u3001\u53D1\u9001\u3001\u4ED8\u6B3E\u7B49\u52A8\u4F5C\u4F1A\u518D\u6B21\u786E\u8BA4\u3002\u7EC8\u7AEF\u3001\u5BC6\u7801\u7BA1\u7406\u5668\u3001\u5B89\u5168\u8F6F\u4EF6\u3001\u8FDC\u7A0B\u63A7\u5236\u8F6F\u4EF6\u548C DSH \u672C\u8EAB\u59CB\u7EC8\u4E0D\u80FD\u64CD\u4F5C\u3002" }),
        error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "alert", children: error }),
        !view && !error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u2026" }),
        view && !supported && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "px-empty", children: "\u7535\u8111\u64CD\u4F5C\u76EE\u524D\u53EA\u652F\u6301 Windows\u3002" }),
        view && s && supported && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...cardStyle, margin: "12px 0" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { style: { display: "block", marginBottom: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "input",
                {
                  type: "checkbox",
                  disabled: busy,
                  checked: s.desktop,
                  onChange: (e) => void act({ action: "settings", desktop: e.target.checked })
                }
              ),
              " ",
              "\u64CD\u4F5C\u684C\u9762\u5E94\u7528"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { style: { display: "block" }, children: [
              "\u6D4F\u89C8\u5668",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "select",
                {
                  "aria-label": "\u6D4F\u89C8\u5668\u6A21\u5F0F",
                  style: { ...controlStyle, width: "100%", marginTop: 6 },
                  disabled: busy,
                  value: s.browser,
                  onChange: (e) => void act({ action: "settings", browser: e.target.value }),
                  children: Object.entries(BROWSER_LABEL).map(([value, label]) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value, children: label }, value))
                }
              )
            ] }),
            s.browser !== "off" && s.browser !== "extension" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { style: { display: "block", marginTop: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "input",
                {
                  type: "checkbox",
                  disabled: busy,
                  checked: s.headless,
                  onChange: (e) => void act({ action: "settings", headless: e.target.checked })
                }
              ),
              " ",
              "\u540E\u53F0\u8FD0\u884C\u6D4F\u89C8\u5668\uFF08\u4E0D\u663E\u793A\u7A97\u53E3\uFF09"
            ] }),
            s.browser === "extension" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "px-muted", children: [
              view.status.edgeExtension ? "\u5DF2\u68C0\u6D4B\u5230 Playwright \u6269\u5C55\u3002\u6BCF\u6B21\u8FDE\u63A5\u65F6 Edge \u4F1A\u6253\u5F00\u786E\u8BA4\u9875\uFF0C\u7531\u4F60\u9009\u62E9\u5171\u4EAB\u54EA\u4E2A\u6807\u7B7E\u9875\u3002" : "\u5C1A\u672A\u5728 Edge \u4E2D\u68C0\u6D4B\u5230 Playwright \u6269\u5C55\u3002\u8BF7\u5148\u4ECE Edge \u6269\u5C55\u5546\u5E97\u5B89\u88C5 \u201CPlaywright Extension\u201D\uFF0C\u5B89\u88C5\u7531\u4F60\u81EA\u5DF1\u5B8C\u6210\u3002",
              " ",
              !view.status.edgeExtension && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("a", { href: EXTENSION_URL, target: "_blank", rel: "noreferrer", children: "\u6253\u5F00\u6269\u5C55\u5546\u5E97" })
            ] }),
            s.browser !== "off" && s.browser !== "isolated" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "px-muted", children: "\u8FD9\u4E2A\u6A21\u5F0F\u5305\u542B\u767B\u5F55\u72B6\u6001\uFF1A\u6BCF\u4E2A\u4F1A\u8BDD\u7B2C\u4E00\u6B21\u8BBF\u95EE\u67D0\u4E2A\u7F51\u7AD9\u524D\u4F1A\u5148\u8BE2\u95EE\u3002" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-actions", children: [
            view.session.paused ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                className: "px-primary",
                style: controlStyle,
                disabled: busy,
                onClick: () => void act({ action: "resume" }),
                children: "\u6062\u590D\u672C\u4F1A\u8BDD\u7684\u7535\u8111\u64CD\u4F5C"
              }
            ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                className: "px-danger",
                style: controlStyle,
                disabled: busy || !s.desktop && s.browser === "off",
                onClick: () => void act({ action: "pause" }),
                children: "\u505C\u6B62\u5E76\u6682\u505C\u672C\u4F1A\u8BDD"
              }
            ),
            view.status.browserHeldElsewhere && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                style: controlStyle,
                disabled: busy,
                onClick: () => void act({ action: "release-browser" }),
                children: "\u91CA\u653E\u88AB\u5176\u4ED6\u4F1A\u8BDD\u5360\u7528\u7684\u6D4F\u89C8\u5668"
              }
            )
          ] }),
          view.session.paused && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", children: "\u5DF2\u6682\u505C\uFF1Aagent \u5728\u672C\u4F1A\u8BDD\u4E2D\u7684\u7535\u8111\u548C\u6D4F\u89C8\u5668\u64CD\u4F5C\u90FD\u4F1A\u88AB\u62D2\u7EDD\u3002" }),
          (view.session.apps.length > 0 || view.session.sites.length > 0) && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { style: { ...cardStyle, margin: "12px 0" }, open: true, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u672C\u4F1A\u8BDD\u5DF2\u5141\u8BB8" }),
            view.session.apps.map((app) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1 }, children: app.label }),
              s.alwaysAllowApps.some((a) => a.key === app.key) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "px-muted", children: "\u59CB\u7EC8\u5141\u8BB8" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  style: controlStyle,
                  disabled: busy,
                  onClick: () => void act({ action: "always-allow-app", key: app.key, label: app.label }),
                  children: "\u8BBE\u4E3A\u59CB\u7EC8\u5141\u8BB8"
                }
              )
            ] }, app.key)),
            view.session.sites.map((site) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1 }, children: site }),
              s.alwaysAllowSites.includes(site) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "px-muted", children: "\u59CB\u7EC8\u5141\u8BB8" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  style: controlStyle,
                  disabled: busy,
                  onClick: () => void act({ action: "always-allow-site", site }),
                  children: "\u8BBE\u4E3A\u59CB\u7EC8\u5141\u8BB8"
                }
              )
            ] }, site))
          ] }),
          (s.alwaysAllowApps.length > 0 || s.alwaysAllowSites.length > 0) && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { style: { ...cardStyle, margin: "12px 0" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u59CB\u7EC8\u5141\u8BB8\uFF08\u6240\u6709\u4F1A\u8BDD\uFF09" }),
            s.alwaysAllowApps.map((app) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1 }, children: app.label }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  style: controlStyle,
                  disabled: busy,
                  onClick: () => void act({ action: "forget-app", key: app.key }),
                  children: "\u64A4\u9500"
                }
              )
            ] }, app.key)),
            s.alwaysAllowSites.map((site) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1 }, children: site }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  style: controlStyle,
                  disabled: busy,
                  onClick: () => void act({ action: "forget-site", site }),
                  children: "\u64A4\u9500"
                }
              )
            ] }, site))
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h4", { children: "\u64CD\u4F5C\u8BB0\u5F55" }),
          view.session.log.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "px-empty", children: "\u672C\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u7535\u8111\u64CD\u4F5C\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ol", { style: { listStyle: "none", padding: 0, margin: 0 }, children: view.session.log.map((entry, index) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "li",
            {
              style: { borderBottom: "1px solid var(--px-border)", padding: "6px 0" },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "px-actions", style: { margin: 0 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "px-muted", children: time(entry.at) }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("code", { children: entry.tool }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: entry.outcome === "ok" ? "px-muted" : "px-danger", children: OUTCOME[entry.outcome] })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: entry.target }),
                entry.detail && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "px-muted", children: entry.detail }),
                entry.message && entry.outcome !== "ok" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "px-muted", children: entry.message })
              ]
            },
            `${entry.at}-${index}`
          )) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "px-muted", children: "\u8BB0\u5F55\u53EA\u4FDD\u5B58\u5728\u672C\u6B21\u8FD0\u884C\u4E2D\uFF0C\u6700\u591A 200 \u6761\uFF1B\u786E\u8BA4\u4E0E\u62D2\u7EDD\u4E5F\u5199\u5165\u4F1A\u8BDD\u65E5\u5FD7\u3002" })
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
        id: "dsh-px-computer",
        title: "\u7535\u8111\u64CD\u4F5C",
        order: 18,
        component: ({ scope, visible }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ComputerPanel, { sessionId: scope.sessionId, visible }, scope.sessionId)
      }),
      "computer: panel"
    )
  );
}

		return module.exports;
	}
});
