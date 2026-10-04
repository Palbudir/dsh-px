window.__ModuleLoader__.load({
	id: "dsh-px-updater",
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

// packages/dsh-px-updater/src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

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

// packages/dsh-px-updater/src/client.tsx
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

// packages/dsh-px-updater/src/client-data.ts
function checkLabel(check, failed) {
  if (failed) return "checkFailed";
  if (!check) return "notChecked";
  if (check.error !== null || !check.latest.pack) return "checkFailed";
  return check.updateAvailable ? "available" : "upToDate";
}
function safeReleaseUrl(value, repository) {
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.port && url.pathname.startsWith(`/${repository}/releases/tag/pack-v`);
  } catch {
    return false;
  }
}

// packages/dsh-px-updater/src/client.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var NS = "dsh-px-updater";
var ROUTE_PREFIX = "/dsh-px-updater";
var inject = ["slots", "locale"];
var DICT = {
  zh: {
    nav: "DSH-PX \u7248\u672C",
    loading: "\u6B63\u5728\u8BFB\u53D6\u7248\u672C\u4FE1\u606F\u2026",
    "section.app": "DSH-PX Pack",
    "section.update": "Pack \u66F4\u65B0",
    pack: "\u63D2\u4EF6\u6574\u5408\u5305",
    host: "\u9002\u914D\u5BBF\u4E3B",
    candidate: "\u5019\u9009\u6784\u5EFA\uFF08\u672A\u7ECF\u53D1\u5E03\u95E8\u7981\uFF09",
    unknown: "\u672A\u77E5",
    check: "\u68C0\u67E5\u66F4\u65B0",
    checking: "\u6B63\u5728\u68C0\u67E5\u2026",
    checkFailed: "\u68C0\u67E5\u5931\u8D25\uFF0C\u53EF\u91CD\u8BD5",
    lastChecked: "\u4E0A\u6B21\u68C0\u67E5",
    notChecked: "\u5C1A\u672A\u68C0\u67E5",
    upToDate: "\u5DF2\u662F\u6700\u65B0\u7248\u672C",
    available: "\u6709\u65B0\u7248\u672C\u53EF\u7528",
    latest: "\u5DF2\u7B7E\u540D\u7684\u6700\u65B0\u7248\u672C",
    openRelease: "\u6253\u5F00\u53D1\u5E03\u9875",
    unavailable: "\u65E0\u6CD5\u8BFB\u53D6\u7248\u672C\u4FE1\u606F",
    manage: "\u4E0B\u8F7D\u4E0E\u5B89\u88C5\u66F4\u65B0",
    managedNote: "\u5728\u72EC\u7ACB\u66F4\u65B0\u7A97\u53E3\u4E2D\u7BA1\u7406\u5BA2\u6237\u7AEF\u548C\u6574\u5408\u5305\u3002\u4E0B\u8F7D\u5B8C\u6210\u540E\u518D\u786E\u8BA4\u91CD\u542F\uFF0C\u4FDD\u7559\u5F53\u524D\u6570\u636E\u548C\u63D2\u4EF6\u9009\u62E9\u3002\u6D4F\u89C8\u5668\u5165\u53E3\u4F1A\u5524\u8D77\u672C\u673A DSH-PX Desktop\u3002",
    note: "Pack \u66F4\u65B0\u53EA\u505A\u63D0\u793A\uFF1A\u5728\u5B98\u65B9\u63D2\u4EF6\u7BA1\u7406\u5668\u4E2D\u5B89\u88C5\u65B0\u7248\u672C\u540E\u6309\u63D0\u793A\u91CD\u542F\u670D\u52A1\u3002\u684C\u9762\u5BA2\u6237\u7AEF\u7684\u66F4\u65B0\u7531\u5BA2\u6237\u7AEF\u81EA\u8EAB\u8D1F\u8D23\uFF0C\u8FD9\u91CC\u4E0D\u63A7\u5236\u7A97\u53E3\u3001\u91CD\u542F\u6216\u5B89\u88C5\u3002"
  },
  en: {
    nav: "DSH-PX version",
    loading: "Reading version information\u2026",
    "section.app": "DSH-PX Pack",
    "section.update": "Pack updates",
    pack: "Plugin pack",
    host: "Target host",
    candidate: "Candidate build (not release-gated)",
    unknown: "Unknown",
    check: "Check for updates",
    checking: "Checking\u2026",
    checkFailed: "Check failed; retry",
    lastChecked: "Last checked",
    notChecked: "Not checked yet",
    upToDate: "Up to date",
    available: "A new version is available",
    latest: "Latest signed version",
    openRelease: "Open release page",
    unavailable: "Could not read version information",
    manage: "Download and install updates",
    managedNote: "Manage the client and Pack separately in the update window. Restart only after confirmation; your data and plugin choices are preserved. The browser link opens DSH-PX Desktop on this computer.",
    note: "Pack updates are announced only: install the new version with the native plugin manager and restart the service when prompted. Desktop client updates belong to the client; this page does not control windows, restarts or installation."
  }
};
function Row({ label, value }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 12, padding: "7px 0", alignItems: "baseline" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { flex: "0 0 132px", opacity: 0.62, fontSize: 13 }, children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 14, wordBreak: "break-all" }, children: value })
  ] });
}
function Heading({ children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    "div",
    {
      style: { fontSize: 13, fontWeight: 600, opacity: 0.75, margin: "18px 0 4px", letterSpacing: ".02em" },
      children
    }
  );
}
function DshPxSection({ t }) {
  const tr = (key) => typeof t === "function" ? t(key) : key;
  const [status, setStatus] = (0, import_react2.useState)(null);
  const [statusError, setStatusError] = (0, import_react2.useState)(null);
  const [check, setCheck] = (0, import_react2.useState)(null);
  const [checking, setChecking] = (0, import_react2.useState)(false);
  const [checkError, setCheckError] = (0, import_react2.useState)(null);
  (0, import_react2.useEffect)(() => {
    let alive = true;
    requestJson(`${ROUTE_PREFIX}/status`).then((v) => {
      if (alive) setStatus(v);
    }).catch((err) => {
      if (alive) setStatusError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      alive = false;
    };
  }, []);
  const doCheck = (0, import_react2.useCallback)(() => {
    setChecking(true);
    setCheck(null);
    setCheckError(null);
    requestJson(`${ROUTE_PREFIX}/check`).then(setCheck).catch((err) => setCheckError(err instanceof Error ? err.message : String(err))).finally(() => setChecking(false));
  }, []);
  const label = checking ? tr("checking") : tr(checkLabel(check, checkError !== null));
  const packVersion = status?.pack.version ?? status?.version;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-ui", style: { padding: "4px 2px 24px", maxWidth: 620 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { style: { margin: "0 0 8px" }, children: tr("section.app") }),
    statusError !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { role: "alert", style: { fontSize: 13, opacity: 0.8 }, children: [
      tr("unavailable"),
      "\uFF08",
      statusError,
      "\uFF09"
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: tr("pack"), value: packVersion ?? tr("loading") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Row,
        {
          label: tr("host"),
          value: status ? status.pack.hostVersion ?? tr("unknown") : tr("loading")
        }
      ),
      status?.pack.candidate ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "status", children: tr("candidate") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Heading, { children: tr("section.update") }),
    status?.managedDesktop ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "button",
      {
        type: "button",
        onClick: () => {
          const desktop = window.dshDesktop;
          if (typeof desktop?.updates?.open === "function") void desktop.updates.open();
          else window.location.href = "dsh-px://updates";
        },
        children: tr("manage")
      }
    ) }) : null,
    !status?.managedDesktop ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: tr("latest"), value: check?.latest.pack ?? "\u2014" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Row,
        {
          label: tr("lastChecked"),
          value: check ? new Date(check.checkedAt).toLocaleString() : tr("notChecked")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "6px 0" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { role: "status", style: { fontSize: 14 }, children: label }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            onClick: doCheck,
            disabled: checking,
            style: {
              cursor: checking ? "default" : "pointer",
              fontSize: 13,
              padding: "4px 12px",
              borderRadius: 8,
              border: "1px solid currentColor",
              background: "transparent",
              color: "inherit",
              opacity: checking ? 0.5 : 0.85
            },
            children: checking ? tr("checking") : tr("check")
          }
        )
      ] }),
      check?.releaseUrl && safeReleaseUrl(check.releaseUrl, status?.repository) ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("a", { href: check.releaseUrl, target: "_blank", rel: "noreferrer", children: tr("openRelease") }) }) : null,
      checkError !== null || check?.error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "alert", style: { fontSize: 12.5, opacity: 0.8, overflowWrap: "anywhere" }, children: check?.error ?? checkError }) : null
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, opacity: 0.55, marginTop: 18, lineHeight: 1.7 }, children: tr(status?.managedDesktop ? "managedNote" : "note") })
  ] });
}
function apply(ctx) {
  installUiStyles(ctx);
  ctx.effect?.(() => {
    const disposers = [ctx.locale.register(NS, "zh", DICT.zh), ctx.locale.register(NS, "en", DICT.en)];
    return () => {
      for (const d of disposers) d();
    };
  }, "dsh-px-updater: dictionaries");
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: "dsh-px",
        order: 100,
        label: () => ctx.locale.bind(NS)("nav"),
        locale: NS
      },
      DshPxSection
    )
  );
}

		return module.exports;
	}
});
