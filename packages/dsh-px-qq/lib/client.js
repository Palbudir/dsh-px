window.__ModuleLoader__.load({
	id: "dsh-px-qq",
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

// packages/dsh-px-qq/src/client.tsx
var client_exports = {};
__export(client_exports, {
  QqSettingsPanel: () => QqSettingsPanel,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react2 = require("react");

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

// packages/dsh-px-qq/src/policy.ts
var DEFAULT_QQ_SETTINGS = {
  enabled: false,
  accountId: "",
  authorizedUsers: [],
  personaId: "",
  workspace: "",
  publicIntroduction: "",
  endpoint: "ws://127.0.0.1:64327",
  secretRef: ""
};

// packages/dsh-px-qq/src/client.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var inject = ["slots"];
var endpoint = "/dsh-px-qq";
var post = (value) => requestJson(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value)
});
function QqSettingsPanel() {
  const [view, setView] = (0, import_react2.useState)(null);
  const [draft, setDraft] = (0, import_react2.useState)({ ...DEFAULT_QQ_SETTINGS });
  const [revision, setRevision] = (0, import_react2.useState)("");
  const [owners, setOwners] = (0, import_react2.useState)("");
  const [secret, setSecret] = (0, import_react2.useState)("");
  const [dirty, setDirty] = (0, import_react2.useState)(false);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [message, setMessage] = (0, import_react2.useState)("");
  const [error, setError] = (0, import_react2.useState)("");
  const [personaName, setPersonaName] = (0, import_react2.useState)("");
  const [catalog, setCatalog] = (0, import_react2.useState)(null);
  const [catalogBusy, setCatalogBusy] = (0, import_react2.useState)(false);
  const [catalogError, setCatalogError] = (0, import_react2.useState)("");
  const [loadError, setLoadError] = (0, import_react2.useState)("");
  const [feedbackAt, setFeedbackAt] = (0, import_react2.useState)(
    "settings"
  );
  const [answers, setAnswers] = (0, import_react2.useState)({});
  const [feedbackInteraction, setFeedbackInteraction] = (0, import_react2.useState)("");
  function adopt(value) {
    setView(value);
    setDraft(value.settings);
    setRevision(value.revision);
    setOwners(value.settings.authorizedUsers.join(", "));
    setSecret("");
    setDirty(false);
  }
  (0, import_react2.useEffect)(() => {
    let active = true, first = true, timer;
    const poll = async () => {
      try {
        const result = await requestJson(endpoint);
        if (!active) return;
        setLoadError("");
        if (first) {
          adopt(result);
          first = false;
        } else setView(result);
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : "\u65E0\u6CD5\u8BFB\u53D6 QQ \u8BBE\u7F6E");
      } finally {
        if (active) timer = setTimeout(poll, 3e3);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  function change(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }
  async function models() {
    setCatalogBusy(true);
    setCatalogError("");
    try {
      setCatalog(await post({ action: "model-catalog" }));
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : "\u6A21\u578B\u76EE\u5F55\u6682\u4E0D\u53EF\u7528");
    } finally {
      setCatalogBusy(false);
    }
  }
  async function action(kind, fields = {}) {
    setFeedbackInteraction(kind === "answer-interaction" ? String(fields.id ?? "") : "");
    setFeedbackAt(kind === "answer-interaction" ? "interaction" : "connection");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await post({ action: kind, ...fields });
      setMessage(result.message ?? "\u64CD\u4F5C\u5B8C\u6210");
      setView(await requestJson(endpoint));
    } catch (e) {
      setError(e instanceof Error ? e.message : "\u64CD\u4F5C\u672A\u5B8C\u6210");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setFeedbackAt("settings");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await post({
        action: "save",
        revision,
        settings: {
          ...draft,
          authorizedUsers: owners.split(/[,，;\s]+/).map((x) => x.trim()).filter(Boolean)
        },
        ...secret ? { secret } : {}
      });
      adopt(result);
      setMessage(
        result.settings.enabled ? result.connection.state === "error" ? "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u63A5\u5165\u5C1A\u672A\u5C31\u7EEA\uFF1B\u8BF7\u6309\u72B6\u6001\u63D0\u793A\u4FEE\u590D\u3002" : "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u6B63\u5728\u8FDE\u63A5 QQ\u3002\u8BF7\u4EE5\u8FDE\u63A5\u72B6\u6001\u548C\u5B9E\u9645\u6536\u53D1\u7ED3\u679C\u4E3A\u51C6\u3002" : "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0CQQ \u63A5\u5165\u4FDD\u6301\u5173\u95ED\u3002"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "\u4FDD\u5B58\u672A\u5B8C\u6210\uFF1B\u586B\u5199\u5185\u5BB9\u5DF2\u4FDD\u7559");
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setFeedbackAt("settings");
    setBusy(true);
    setError("");
    try {
      adopt(await requestJson(endpoint));
      setMessage("\u5DF2\u91CD\u65B0\u52A0\u8F7D\u4FDD\u5B58\u7684\u8BBE\u7F6E");
    } catch (e) {
      setError(e instanceof Error ? e.message : "\u8BFB\u53D6\u672A\u5B8C\u6210");
    } finally {
      setBusy(false);
    }
  }
  async function createPersona() {
    setFeedbackAt("persona");
    setBusy(true);
    setError("");
    try {
      const persona = await post({
        action: "create-persona",
        name: personaName
      });
      setView(await requestJson(endpoint));
      change("personaId", persona.id);
      setPersonaName("");
      setMessage("\u4EBA\u683C\u5DF2\u521B\u5EFA\u5E76\u9009\u4E2D\uFF0C\u8BF7\u4FDD\u5B58 QQ \u8BBE\u7F6E\u3002\u4EBA\u683C\u79C1\u6709\u8BB0\u5FC6\u5728\u201C\u8BB0\u5FC6\u4E0E\u77E5\u8BC6\u201D\u4E2D\u7BA1\u7406\u3002");
    } catch (e) {
      setError(e instanceof Error ? e.message : "\u521B\u5EFA\u672A\u5B8C\u6210");
    } finally {
      setBusy(false);
    }
  }
  const online = !loadError && view?.connection.state === "online";
  const selectedModel = catalog?.groups.find((g) => g.id === draft.model?.provider)?.models.find((m) => m.id === draft.model?.model);
  const modelValue = draft.model ? JSON.stringify([draft.model.provider, draft.model.model]) : "";
  const feedback = (location, interactionId) => feedbackAt === location && (!interactionId || interactionId === feedbackInteraction) && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    location === "interaction" && !interactionId && feedbackInteraction && (error || message) && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "px-muted", children: [
      "\u8BF7\u6C42 ",
      feedbackInteraction,
      " \u7684\u64CD\u4F5C\u7ED3\u679C"
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: error }),
    message && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", className: "px-feedback", children: message })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-ui", style: { minWidth: 0, overflowWrap: "anywhere", paddingBottom: 24 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { style: { marginTop: 0 }, children: "QQ \u8D26\u53F7" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { lineHeight: 1.7, opacity: 0.75 }, children: "\u4F7F\u7528\u666E\u901A QQ \u8D26\u53F7\u63A5\u5165\u3002\u79C1\u804A\u548C\u7FA4\u5185 @ \u53EF\u4EE5\u4EA4\u6D41\uFF1B\u53EA\u6709\u6388\u6743\u6210\u5458\u80FD\u6267\u884C\u672C\u673A\u4EFB\u52A1\u548C\u8BBF\u95EE\u79C1\u6709\u8D44\u6599\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "px-card", "aria-label": "QQ \u8FDE\u63A5\u72B6\u6001", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: loadError ? "\u72B6\u6001\u6682\u4E0D\u53EF\u7528" : !view ? "\u6B63\u5728\u8BFB\u53D6" : view.componentEnabled === false ? "\u7EC4\u4EF6\u672A\u5C31\u7EEA" : view?.connection.state === "error" ? "\u63A5\u5165\u5F02\u5E38" : online ? "\u5DF2\u8FDE\u63A5" : view?.settings.enabled ? "\u7B49\u5F85\u8FDE\u63A5" : "\u672A\u5F00\u542F" }),
      view?.connection.nickname && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
        " \xB7 ",
        view.connection.nickname
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: view?.connection.state === "error" ? "alert" : "status", children: loadError ? "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u63A5\u5165\u72B6\u6001\uFF0C\u5DF2\u4FDD\u7559\u586B\u5199\u5185\u5BB9\u3002" : view?.connection.message ?? "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026" }),
      !!view?.active && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { children: [
        "\u5F53\u524D\u6709 ",
        view.active,
        " \u4E2A\u6D3B\u52A8\u6216\u6392\u961F\u4F1A\u8BDD\u3002\u4FDD\u5B58\u914D\u7F6E\u4F1A\u91CD\u65B0\u8FDE\u63A5\uFF0C\u8BF7\u5148\u7B49\u5F85\u4EFB\u52A1\u5B8C\u6210\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-actions", children: [
        view?.connection.persistenceBlocked && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: controlStyle, disabled: busy, onClick: () => void action("retry-persistence"), children: "\u91CD\u8BD5\u4FDD\u5B58\u63A5\u7EED\u8BB0\u5F55" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            style: controlStyle,
            disabled: busy || !view?.credentialConfigured || view?.componentEnabled === false || dirty,
            onClick: () => void action("test-connection"),
            children: "\u68C0\u67E5\u5DF2\u4FDD\u5B58\u7684\u8FDE\u63A5"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            style: controlStyle,
            disabled: busy || !online || dirty,
            onClick: () => void action("send-test"),
            children: "\u53D1\u6D4B\u8BD5\u6D88\u606F\u7ED9\u8D1F\u8D23\u4EBA"
          }
        ),
        !!view?.active && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: controlStyle, disabled: busy, onClick: () => void action("stop"), children: "\u505C\u6B62\u5F53\u524D\u4EFB\u52A1" })
      ] }),
      dirty && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "px-muted", children: "\u6709\u672A\u4FDD\u5B58\u7684\u8BBE\u7F6E\u3002\u8FDE\u63A5\u68C0\u67E5\u4F7F\u7528\u4FDD\u5B58\u540E\u7684\u914D\u7F6E\u3002" }),
      loadError && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: loadError }),
      feedback("connection"),
      !view?.pendingInteractions?.length && feedback("interaction")
    ] }),
    !!view?.pendingInteractions?.length && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "px-card", "aria-label": "QQ \u5F85\u5904\u7406\u8BF7\u6C42", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: "\u5F85\u5904\u7406\u8BF7\u6C42" }),
      error && !view.pendingInteractions.some((p) => p.id === feedbackInteraction) && feedback("interaction"),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "px-muted", children: "\u4E0E\u5BF9\u5E94\u7684 QQ \u804A\u5929\u662F\u540C\u4E00\u4E2A\u539F\u751F\u8BF7\u6C42\uFF1B\u4EFB\u4E00\u5904\u5904\u7406\u540E\uFF0C\u53E6\u4E00\u5904\u7684\u65E7\u56DE\u590D\u5373\u5931\u6548\u3002" }),
      view.pendingInteractions.map((p) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { borderTop: "1px solid var(--px-border)", padding: "12px 0" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("strong", { children: [
          p.id,
          " \xB7 ",
          p.chatId
        ] }),
        feedback("interaction", p.id),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { style: { whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "inherit" }, children: p.text }),
        p.kind === "approval" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              style: controlStyle,
              disabled: busy,
              onClick: () => void action("answer-interaction", { id: p.id, decision: "allowed-once" }),
              children: "\u6279\u51C6\u4E00\u6B21"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              style: controlStyle,
              disabled: busy,
              onClick: () => void action("answer-interaction", { id: p.id, decision: "rejected" }),
              children: "\u62D2\u7EDD"
            }
          )
        ] }) : p.questions?.map((q, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { marginTop: 10 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
            index + 1,
            ". ",
            q.question,
            p.answered.includes(index) ? "\uFF08\u5DF2\u8BB0\u5F55\uFF0C\u53EF\u91CD\u65B0\u586B\u5199\uFF09" : "",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "input",
              {
                "aria-label": "\u56DE\u7B54\u7B2C " + (index + 1) + " \u9898",
                style: { display: "block", width: "100%", marginTop: 5 },
                value: answers[p.id + ":" + index] ?? "",
                placeholder: "\u9009\u9879\u5E8F\u53F7\u6216\u4F60\u7684\u6587\u5B57",
                onChange: (e) => setAnswers((old) => ({ ...old, [p.id + ":" + index]: e.target.value }))
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              style: controlStyle,
              disabled: busy || !answers[p.id + ":" + index]?.trim(),
              onClick: () => void action("answer-interaction", {
                id: p.id,
                question: index + 1,
                answer: answers[p.id + ":" + index]
              }),
              children: "\u63D0\u4EA4\u672C\u9898"
            }
          )
        ] }, q.id))
      ] }, p.id))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "form",
      {
        onSubmit: (e) => {
          e.preventDefault();
          void save();
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "fieldset",
          {
            disabled: busy || !view?.installed || view?.componentEnabled === false,
            style: { border: 0, padding: 0, margin: 0, minWidth: 0 },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                "section",
                {
                  className: "px-card",
                  style: { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14 },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
                      "\u4EA4\u7ED9 DSH-PX \u7684 QQ \u53F7",
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "input",
                        {
                          "aria-label": "QQ \u8D26\u53F7",
                          inputMode: "numeric",
                          style: { display: "block", width: "100%", marginTop: 5 },
                          value: draft.accountId,
                          onChange: (e) => change("accountId", e.target.value.trim()),
                          placeholder: "\u4F8B\u5982\uFF1A\u673A\u5668\u4EBA\u4E13\u7528 QQ \u53F7"
                        }
                      )
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
                      "\u6388\u6743\u6210\u5458",
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "input",
                        {
                          "aria-label": "\u6388\u6743\u6210\u5458",
                          inputMode: "numeric",
                          style: { display: "block", width: "100%", marginTop: 5 },
                          value: owners,
                          onChange: (e) => {
                            setOwners(e.target.value);
                            setDirty(true);
                          },
                          placeholder: "\u586B\u5199\u4F60\u7684 QQ \u53F7\uFF1B\u591A\u4E2A\u53F7\u7801\u7528\u9017\u53F7\u5206\u9694"
                        }
                      ),
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "px-muted", children: "\u5176\u4ED6\u4EBA\u4ECD\u53EF\u4EA4\u6D41\uFF0C\u4F46\u4E0D\u80FD\u6267\u884C\u672C\u673A\u4EFB\u52A1\u6216\u8BFB\u53D6\u79C1\u6709\u8D44\u6599\u3002\u7FA4\u4EFB\u52A1\u7559\u5728\u539F\u7FA4\uFF1B\u79C1\u6709\u8D44\u6599\u9700\u660E\u786E\u5206\u4EAB\u5230\u8BE5\u7FA4\uFF0C\u624D\u53EF\u7528\u4E8E\u4EFB\u52A1\u3002" })
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
                      "\u72EC\u7ACB\u5DE5\u4F5C\u533A",
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "input",
                        {
                          "aria-label": "QQ \u5DE5\u4F5C\u533A",
                          style: { display: "block", width: "100%", marginTop: 5 },
                          value: draft.workspace,
                          onChange: (e) => change("workspace", e.target.value),
                          placeholder: "\u9009\u62E9\u6216\u586B\u5199\u72EC\u7ACB\u7684\u672C\u673A\u5DE5\u4F5C\u76EE\u5F55"
                        }
                      )
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-actions", children: [
                      view?.suggestedWorkspace && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          style: controlStyle,
                          onClick: () => change("workspace", view.suggestedWorkspace),
                          children: "\u4F7F\u7528\u5EFA\u8BAE\u76EE\u5F55"
                        }
                      ),
                      !!view?.workspaces.length && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                        "select",
                        {
                          "aria-label": "\u4F7F\u7528\u5DF2\u6709\u5DE5\u4F5C\u533A",
                          style: { minWidth: 0, maxWidth: "100%", flex: "1 1 180px" },
                          value: "",
                          onChange: (e) => change("workspace", e.target.value),
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u4F7F\u7528\u5DF2\u6709\u5DE5\u4F5C\u533A\u2026" }),
                            view.workspaces.map((w) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: w.path, children: w.path }, w.id))
                          ]
                        }
                      )
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
                      "\u56FA\u5B9A\u4EBA\u683C",
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                        "select",
                        {
                          "aria-label": "QQ \u4EBA\u683C",
                          style: { display: "block", width: "100%", marginTop: 5 },
                          value: draft.personaId,
                          onChange: (e) => change("personaId", e.target.value),
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u8BF7\u9009\u62E9\u4EBA\u683C" }),
                            draft.personaId && view && !view.personas.some((p) => p.id === draft.personaId) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: draft.personaId, children: "\u539F\u4EBA\u683C\u5DF2\u5F52\u6863\u6216\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9" }),
                            view?.personas.map((p) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: p.id, children: p.name }, p.id))
                          ]
                        }
                      )
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { children: [
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: "\u521B\u5EFA\u65B0\u4EBA\u683C" }),
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-actions", children: [
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                          "input",
                          {
                            "aria-label": "\u65B0\u4EBA\u683C\u540D\u79F0",
                            value: personaName,
                            maxLength: 60,
                            onChange: (e) => setPersonaName(e.target.value),
                            placeholder: "\u4F8B\u5982\uFF1A\u9879\u76EE\u52A9\u624B"
                          }
                        ),
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                          "button",
                          {
                            type: "button",
                            style: controlStyle,
                            disabled: !personaName.trim(),
                            onClick: () => void createPersona(),
                            children: "\u521B\u5EFA\u5E76\u9009\u4E2D"
                          }
                        )
                      ] }),
                      feedback("persona")
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
                      "\u516C\u5F00\u4ECB\u7ECD",
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "textarea",
                        {
                          "aria-label": "QQ \u516C\u5F00\u4ECB\u7ECD",
                          maxLength: 2e3,
                          rows: 3,
                          style: { display: "block", width: "100%", marginTop: 5, resize: "vertical" },
                          value: draft.publicIntroduction,
                          onChange: (e) => change("publicIntroduction", e.target.value),
                          placeholder: "\u7FA4\u804A\u548C\u666E\u901A\u79C1\u804A\u53EF\u89C1\u7684\u8EAB\u4EFD\u3001\u8BED\u6C14\u4E0E\u4EA4\u6D41\u504F\u597D\uFF1B\u8BF7\u52FF\u586B\u5199\u79C1\u6709\u8D44\u6599\u3002"
                        }
                      )
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "px-muted", children: "\u5DF2\u5F00\u59CB\u7684\u4F1A\u8BDD\u56FA\u5B9A\u4EBA\u683C\u548C\u516C\u5F00\u4ECB\u7ECD\u3002\u4FEE\u6539\u9ED8\u8BA4\u503C\u540E\uFF0C\u65B0\u4F1A\u8BDD\u4F7F\u7528\u65B0\u8BBE\u7F6E\uFF1B\u73B0\u6709\u4F1A\u8BDD\u4FDD\u6301\u539F\u6709\u8EAB\u4EFD\u3002" }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
                      "QQ \u65B0\u4F1A\u8BDD\u9ED8\u8BA4\u6A21\u578B",
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                        "select",
                        {
                          "aria-label": "QQ \u9ED8\u8BA4\u6A21\u578B",
                          style: { display: "block", width: "100%", marginTop: 5 },
                          value: modelValue,
                          onFocus: () => {
                            if (!catalog && !catalogBusy) void models();
                          },
                          onChange: (e) => {
                            if (!e.target.value) change("model", void 0);
                            else {
                              const [provider, model] = JSON.parse(e.target.value);
                              change("model", { provider, model });
                            }
                          },
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: "", children: [
                              "\u8DDF\u968F DSH \u9ED8\u8BA4",
                              catalog?.default ? " \xB7 " + catalog.default.provider + "/" + catalog.default.model : ""
                            ] }),
                            draft.model && !selectedModel && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: modelValue, children: [
                              "\u5DF2\u4FDD\u5B58\uFF1A",
                              draft.model.provider,
                              "/",
                              draft.model.model
                            ] }),
                            catalog?.groups.map((g) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("optgroup", { label: g.name, children: g.models.map((m) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: JSON.stringify([g.id, m.id]), children: m.name }, m.id)) }, g.id))
                          ]
                        }
                      )
                    ] }),
                    !!selectedModel?.reasoning?.efforts.length && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
                      "\u63A8\u7406\u5F3A\u5EA6",
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                        "select",
                        {
                          "aria-label": "QQ \u63A8\u7406\u5F3A\u5EA6",
                          style: { marginLeft: 8 },
                          value: draft.model?.reasoningEffort ?? "",
                          onChange: (e) => {
                            const next = { ...draft.model };
                            if (e.target.value) next.reasoningEffort = e.target.value;
                            else delete next.reasoningEffort;
                            change("model", next);
                          },
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u6A21\u578B\u9ED8\u8BA4" }),
                            draft.model?.reasoningEffort && !selectedModel.reasoning.efforts.some((v) => v.id === draft.model.reasoningEffort) && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: draft.model.reasoningEffort, children: [
                              "\u5DF2\u4FDD\u5B58\uFF1A",
                              draft.model.reasoningEffort
                            ] }),
                            selectedModel.reasoning.efforts.map((v) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: v.id, children: v.name }, v.id))
                          ]
                        }
                      )
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "px-actions", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: controlStyle, disabled: catalogBusy, onClick: () => void models(), children: catalogBusy ? "\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u2026" : "\u5237\u65B0\u6A21\u578B\u76EE\u5F55" }) }),
                    catalogError && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: catalogError }),
                    !!catalog?.failures?.length && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "alert", children: [
                      "\u90E8\u5206\u6A21\u578B\u76EE\u5F55\u672A\u80FD\u8BFB\u53D6\uFF1A",
                      catalog.failures.map((f) => f.name).join("\u3001"),
                      "\u3002\u8BF7\u5230\u201C\u6A21\u578B\u201D\u8BBE\u7F6E\u68C0\u67E5\u540E\u91CD\u8BD5\u3002"
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "px-muted", children: "\u8FD9\u91CC\u53EA\u8BBE\u7F6E QQ \u540E\u7EED\u65B0\u4F1A\u8BDD\u7684\u6A21\u578B\uFF0C\u4E0D\u6539\u53D8 DSH \u5168\u5C40\u9ED8\u8BA4\uFF0C\u4E5F\u4E0D\u66FF\u6362\u5DF2\u6709\u4F1A\u8BDD\u7684\u6A21\u578B\u3002" })
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "px-card", open: !view?.credentialConfigured, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: "\u672C\u673A QQ \u6865\u4E0E\u8FDE\u63A5\u8BBE\u7F6E" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u5148\u542F\u52A8\u5E76\u767B\u5F55 NapCat\uFF0C\u542F\u7528\u672C\u673A WebSocket \u670D\u52A1\u3002\u8BE5 QQ \u53F7\u7684\u666E\u901A\u7535\u8111\u5BA2\u6237\u7AEF\u9700\u9000\u51FA\u540C\u8D26\u53F7\uFF0C\u624B\u673A QQ \u53EF\u4EE5\u4FDD\u7559\u767B\u5F55\u3002" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("a", { href: "https://napneko.github.io/guide/boot/Shell", target: "_blank", rel: "noreferrer", children: "\u67E5\u770B NapCat \u5B98\u65B9\u5B89\u88C5\u8BF4\u660E" }) }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: { display: "block", margin: "12px 0" }, children: [
                  "OneBot \u5730\u5740",
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                    "input",
                    {
                      "aria-label": "OneBot \u5730\u5740",
                      style: { display: "block", width: "100%", marginTop: 5 },
                      value: draft.endpoint,
                      onChange: (e) => change("endpoint", e.target.value)
                    }
                  )
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: { display: "block", margin: "12px 0" }, children: [
                  "\u8FDE\u63A5\u4EE4\u724C",
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                    "input",
                    {
                      "aria-label": "OneBot \u8FDE\u63A5\u4EE4\u724C",
                      type: "password",
                      autoComplete: "new-password",
                      style: { display: "block", width: "100%", marginTop: 5 },
                      value: secret,
                      onChange: (e) => {
                        setSecret(e.target.value);
                        setDirty(true);
                      },
                      placeholder: view?.credentialConfigured ? "\u5DF2\u914D\u7F6E\uFF1B\u7559\u7A7A\u4FDD\u7559\uFF0C\u586B\u5199\u65B0\u503C\u66FF\u6362" : "\u586B\u5199 OneBot \u8FDE\u63A5\u4EE4\u724C"
                    }
                  )
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "px-muted", children: "\u4F7F\u7528 OneBot \u4EE4\u724C\uFF0C\u4E0D\u662F NapCat WebUI \u5BC6\u7801\u3002\u4EC5\u8FDE\u63A5\u672C\u673A\u670D\u52A1\uFF0C\u4EE4\u724C\u7531 DSH \u539F\u751F\u51ED\u636E\u670D\u52A1\u4FDD\u5B58\u3002" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: { display: "block", margin: "16px 0" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "input",
                  {
                    type: "checkbox",
                    checked: draft.enabled,
                    onChange: (e) => change("enabled", e.target.checked)
                  }
                ),
                " ",
                "\u5F00\u542F QQ \u63A5\u5165"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-actions", children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "submit", style: controlStyle, className: "px-primary", disabled: !dirty, children: "\u4FDD\u5B58\u8BBE\u7F6E" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: controlStyle, onClick: () => void reload(), children: dirty ? "\u653E\u5F03\u4FEE\u6539\u5E76\u91CD\u65B0\u52A0\u8F7D" : "\u91CD\u65B0\u52A0\u8F7D\u8BBE\u7F6E" })
              ] })
            ]
          }
        )
      }
    ),
    feedback("settings"),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "px-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: "\u4F7F\u7528\u65B9\u6CD5\u4E0E\u8303\u56F4" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("ol", { style: { paddingLeft: 22, lineHeight: 1.9 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { children: "\u51C6\u5907\u5E76\u767B\u5F55\u4E13\u7528 QQ \u6865\uFF0C\u586B\u5199\u4E0A\u9762\u7684\u8D26\u53F7\u3001\u6388\u6743\u6210\u5458\u3001\u72EC\u7ACB\u5DE5\u4F5C\u533A\u548C\u4EBA\u683C\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { children: "\u4FDD\u5B58\u8FDE\u63A5\u914D\u7F6E\uFF0C\u70B9\u51FB\u201C\u68C0\u67E5\u5DF2\u4FDD\u5B58\u7684\u8FDE\u63A5\u201D\uFF0C\u6838\u5BF9\u6210\u529F\u540E\u5F00\u542F\u63A5\u5165\u5E76\u4FDD\u5B58\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { children: "\u70B9\u51FB\u201C\u53D1\u6D4B\u8BD5\u6D88\u606F\u7ED9\u8D1F\u8D23\u4EBA\u201D\uFF0C\u518D\u4ECE\u4F60\u7684 QQ \u79C1\u804A\u56DE\u590D\u4E00\u6761\u6D88\u606F\uFF0C\u9A8C\u8BC1\u6A21\u578B\u56DE\u7B54\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { children: [
          "\u7FA4\u91CC @ \u5B83\u5373\u53EF\u4EA4\u6D41\u3002\u8D1F\u8D23\u4EBA\u53EF\u76F4\u63A5\u79C1\u804A\u5B89\u6392\u4EFB\u52A1\uFF0C\u6216\u5728\u7FA4\u5185\u7528 ",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/task \u5185\u5BB9" }),
          "\uFF1B\u7FA4\u4EFB\u52A1\u7ED3\u679C\u7559\u5728\u539F\u7FA4\uFF0C\u79C1\u6709\u8D44\u6599\u9700\u660E\u786E\u5206\u4EAB\u3002"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u79C1\u804A\u548C\u6BCF\u4E2A\u7FA4\u5206\u522B\u4FDD\u5B58\u4E0A\u4E0B\u6587\u3002\u516C\u5171\u804A\u5929\u53EA\u7528\u516C\u5F00\u4ECB\u7ECD\u548C\u5171\u4EAB\u77E5\u8BC6\uFF0C\u4E0D\u80FD\u8BBF\u95EE\u4EBA\u683C\u79C1\u6709\u8BB0\u5FC6\u6216\u5176\u4ED6\u804A\u5929\u3002\u8D1F\u8D23\u4EBA\u79C1\u804A\u53EF\u4F7F\u7528\u539F\u751F\u4EFB\u52A1\u548C\u5DE5\u5177\u6743\u9650\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { children: [
        "\u8D1F\u8D23\u4EBA\u547D\u4EE4\uFF1A",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/help" }),
        "\u3001",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/new" }),
        "\u3001",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/stop" }),
        "\u3001",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/status" }),
        "\uFF1B\u7FA4\u5185\u7528",
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/newtask" }),
        " \u65B0\u5EFA\u4EFB\u52A1\u4F1A\u8BDD\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { children: [
        "\u5355\u4E2A\u95EE\u9898\u5361\u7247\u53EF\u4EE5\u76F4\u63A5\u56DE\u590D\u9009\u9879\u6216\u6587\u5B57\u3002\u5DE5\u5177\u5BA1\u6279\u6216\u591A\u4E2A\u95EE\u9898\u6309 QQ \u5361\u7247\u4E2D\u7684\u7F16\u53F7\u4F7F\u7528 ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/approve" }),
        "\u3001",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/reject" }),
        "\u3001",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/answer" }),
        "\uFF0C\u4E5F\u53EF\u4EE5\u5728\u672C\u9875\u201C\u5F85\u5904\u7406\u8BF7\u6C42\u201D\u4E2D\u64CD\u4F5C\u3002\u666E\u901A\u6587\u5B57\u4E0D\u4F1A\u88AB\u8BEF\u5F53\u6210\u5DE5\u5177\u5BA1\u6279\uFF1B\u672A\u56DE\u7B54\u7684\u8BF7\u6C42\u53EF\u901A\u8FC7",
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/stop" }),
        " \u53D6\u6D88\u3002"
      ] }),
      view?.sessionModelSelection ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/model" }),
        " \u9009\u62E9\u540C\u6863\u6A21\u578B\uFF1B",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "/continue \u63D0\u4F9B\u5546 \u6A21\u578B" }),
        " ",
        "\u65B0\u5EFA\u8DE8\u6863\u63A5\u7EED\u4F1A\u8BDD\uFF0C\u539F\u4F1A\u8BDD\u4FDD\u7559\u3002"
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "px-muted", children: "\u5F53\u524D\u5BBF\u4E3B\u5C1A\u672A\u63D0\u4F9B\u4EC5\u672C\u4F1A\u8BDD\u7684\u6A21\u578B\u5207\u6362\u63A5\u53E3\u3002QQ \u6A21\u578B\u5207\u6362\u4E0E\u63A5\u7EED\u9700\u5148\u66F4\u65B0\u914D\u5957\u5BA2\u6237\u7AEF\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "px-muted", children: "\u667A\u80FD\u56DE\u590D\u9700\u8981 DSH-PX \u548C QQ \u6865\u4FDD\u6301\u8FD0\u884C\u3002\u666E\u901A\u8D26\u53F7\u901A\u8FC7\u7B2C\u4E09\u65B9\u6865\u63A5\uFF0CQQ \u7248\u672C\u6216\u767B\u5F55\u9A8C\u8BC1\u53D8\u5316\u53EF\u80FD\u5F71\u54CD\u8FDE\u63A5\u3002" })
    ] })
  ] });
}
function apply(ctx) {
  installUiStyles(ctx);
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register({ name: "settings.section", id: "dsh-px-qq", order: 22, label: "QQ \u8D26\u53F7" }, () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(QqSettingsPanel, {}))
  );
}

		return module.exports;
	}
});
