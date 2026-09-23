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

		// packages/dsh-px-updater/src/client-data.ts
		function checkLabel(check, failed) {
		  if (failed) return "checkFailed";
		  if (!check) return "notChecked";
		  if (check.errors.length && !check.latest.app && !check.latest.dsh) return "checkFailed";
		  if (check.updateAvailable.app) return "available";
		  if (check.errors.length || !check.latest.app || !check.latest.dsh || check.current.app === "\u672A\u77E5" || check.current.dsh === "\u672A\u77E5")
		    return "checkIncomplete";
		  return "upToDate";
		}
		function desktopCheckLabel(shell, disconnected) {
		  if (disconnected) return "shellDisconnected";
		  if (shell.phase === "error") return "checkFailed";
		  if (shell.phase === "checking") return "checking";
		  if (["ready", "downloading", "installing"].includes(shell.phase)) return "available";
		  if (shell.phase === "idle" && shell.version && shell.lastCheckedAt) return "upToDate";
		  return "notChecked";
		}

		// packages/dsh-px-updater/src/client.tsx
		var import_jsx_runtime2 = require("react/jsx-runtime");
		var NS = "dsh-px-updater";
		var ROUTE_PREFIX = "/dsh-px-updater";
		var inject = ["slots", "locale"];
		var DICT = {
		  zh: {
		    nav: "\u7248\u672C\u4E0E\u66F4\u65B0",
		    loading: "\u6B63\u5728\u8BFB\u53D6\u7248\u672C\u4FE1\u606F\u2026",
		    "section.app": "DSH-PX \u6574\u5408\u5305",
		    "section.dsh": "\u968F\u9644 dsh \u6838\u5FC3",
		    "section.update": "\u66F4\u65B0",
		    check: "\u68C0\u67E5\u66F4\u65B0",
		    checking: "\u6B63\u5728\u68C0\u67E5\u2026",
		    checkFailed: "\u68C0\u67E5\u5931\u8D25\uFF0C\u53EF\u91CD\u8BD5",
		    checkIncomplete: "\u90E8\u5206\u4FE1\u606F\u672A\u80FD\u786E\u8BA4",
		    lastChecked: "\u4E0A\u6B21\u68C0\u67E5",
		    latestCore: "\u4E0A\u6E38 DSH\uFF08\u4F9B\u53C2\u8003\uFF09",
		    platform: "\u5E73\u53F0",
		    requested: "\u5DF2\u53D1\u9001\u8BF7\u6C42",
		    shellDisconnected: "\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5\u684C\u9762\u5BA2\u6237\u7AEF",
		    notChecked: "\u5C1A\u672A\u68C0\u67E5",
		    checkedReadOnly: "\u67E5\u8BE2\u5B8C\u6210\uFF08\u6B64\u73AF\u5883\u4E0D\u652F\u6301\u5B89\u88C5\uFF09",
		    upToDate: "\u5DF2\u662F\u6700\u65B0\u7248\u672C",
		    available: "\u6709\u65B0\u7248\u672C\u53EF\u7528",
		    current: "\u5F53\u524D",
		    latest: "\u6700\u65B0",
		    releaseNotes: "\u53D1\u5E03\u8BF4\u660E",
		    openRelease: "\u6253\u5F00\u53D1\u5E03\u9875",
		    paths: "\u76EE\u5F55",
		    dataDir: "\u6570\u636E\u76EE\u5F55",
		    logFile: "\u65E5\u5FD7\u6587\u4EF6",
		    copyHint: "\u8DEF\u5F84\u53EF\u590D\u5236\uFF0C\u4E5F\u53EF\u4EE5\u76F4\u63A5\u7528\u4E0B\u9762\u7684\u6309\u94AE\u6253\u5F00\u3002",
		    copy: "\u590D\u5236",
		    copied: "\u5DF2\u590D\u5236",
		    openDataDir: "\u6253\u5F00\u6570\u636E\u76EE\u5F55",
		    openLog: "\u6253\u5F00\u65E5\u5FD7",
		    opened: "\u5DF2\u6253\u5F00",
		    openFailed: "\u6253\u5F00\u5931\u8D25",
		    unavailable: "\u65E0\u6CD5\u8BFB\u53D6\u7248\u672C\u4FE1\u606F",
		    shellState: "\u5916\u58F3\u72B6\u6001",
		    readyPrefix: "\u65B0\u7248\u672C\u5DF2\u4E0B\u8F7D\u5B8C\u6210\uFF1A",
		    installNow: "\u91CD\u542F\u5E76\u5B89\u88C5",
		    installing: "\u6B63\u5728\u8BF7\u6C42\u2026",
		    note: "\u6574\u5408\u5305\u5305\u542B\u684C\u9762\u7AEF\u3001DSH \u6838\u5FC3\u548C\u7CBE\u9009 Mods\u3002\u66F4\u65B0\u5728\u540E\u53F0\u4E0B\u8F7D\uFF0C\u4E0B\u8F7D\u5B8C\u6210\u540E\u53EF\u91CD\u542F\u5B89\u88C5\u3002\u81EA\u884C\u6DFB\u52A0\u7684\u63D2\u4EF6\u4E0E\u914D\u7F6E\u4F1A\u4FDD\u7559\u3002\u4E0A\u6E38 DSH \u7248\u672C\u4EC5\u4F9B\u53C2\u8003\uFF0C\u968F\u6574\u5408\u5305\u9A8C\u8BC1\u540E\u5347\u7EA7\u3002"
		  },
		  en: {
		    nav: "Versions & updates",
		    loading: "Reading version information\u2026",
		    "section.app": "Desktop client",
		    "section.dsh": "Bundled dsh core",
		    "section.update": "Updates",
		    check: "Check for updates",
		    checking: "Checking\u2026",
		    checkFailed: "Check failed; retry",
		    checkIncomplete: "Some versions could not be verified",
		    lastChecked: "Last checked",
		    latestCore: "Upstream DSH (reference)",
		    platform: "Platform",
		    requested: "Request sent",
		    shellDisconnected: "Desktop client is unreachable",
		    notChecked: "Not checked yet",
		    checkedReadOnly: "Checked (installation unavailable here)",
		    upToDate: "Up to date",
		    available: "A new version is available",
		    current: "Current",
		    latest: "Latest",
		    releaseNotes: "Release notes",
		    openRelease: "Open release page",
		    paths: "Locations",
		    dataDir: "Data directory",
		    logFile: "Log file",
		    copyHint: "Copy a path, or open it directly with the buttons below.",
		    copy: "Copy",
		    copied: "Copied",
		    openDataDir: "Open data folder",
		    openLog: "Open log",
		    opened: "Opened",
		    openFailed: "Failed",
		    unavailable: "Could not read version information",
		    shellState: "Shell status",
		    readyPrefix: "Update downloaded: ",
		    installNow: "Restart and install",
		    installing: "Requesting\u2026",
		    note: "Updates download in the background. Restart to install when ready, or install automatically when you quit."
		  }
		};
		async function getJson(path) {
		  return requestJson(path);
		}
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
		function PathRow({
		  label,
		  value,
		  copyLabel,
		  copiedLabel
		}) {
		  const [copied, setCopied] = (0, import_react2.useState)(false);
		  const copy = (0, import_react2.useCallback)(() => {
		    void navigator.clipboard?.writeText(value).then(() => {
		      setCopied(true);
		      setTimeout(() => setCopied(false), 1600);
		    }).catch(() => {
		    });
		  }, [value]);
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 12, padding: "7px 0", alignItems: "baseline" }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { flex: "0 0 132px", opacity: 0.62, fontSize: 13 }, children: label }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { style: { fontSize: 12.5, wordBreak: "break-all", flex: 1 }, children: value }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		      "button",
		      {
		        type: "button",
		        onClick: copy,
		        style: {
		          flex: "none",
		          cursor: "pointer",
		          fontSize: 12,
		          padding: "2px 10px",
		          borderRadius: 6,
		          border: "1px solid currentColor",
		          background: "transparent",
		          color: "inherit",
		          opacity: 0.7
		        },
		        children: copied ? copiedLabel : copyLabel
		      }
		    )
		  ] });
		}
		function UpdateBanner({
		  state,
		  onInstall,
		  installing,
		  t
		}) {
		  const tone = state.phase === "error" ? "var(--dsw-alias-state-error-primary,#bc3946)" : "var(--dsw-alias-state-success-primary,#23835d)";
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
		    "div",
		    {
		      style: {
		        display: "flex",
		        flexWrap: "wrap",
		        gap: 12,
		        alignItems: "center",
		        margin: "0 0 16px",
		        padding: "10px 14px",
		        borderRadius: 10,
		        border: `1px solid ${tone}`,
		        background: `color-mix(in srgb, ${tone} 10%, transparent)`
		      },
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
		          "div",
		          {
		            role: "status",
		            style: { flex: "1 1 220px", minWidth: 0, overflowWrap: "anywhere", fontSize: 13, lineHeight: 1.6 },
		            children: [
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { children: state.phase === "ready" ? `${t("readyPrefix")}${state.version ?? ""}` : state.status }),
		              state.phase === "downloading" && state.percent !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { opacity: 0.75, fontSize: 12 }, children: [
		                state.percent,
		                "%"
		              ] }) : null,
		              state.phase === "error" && state.error !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { opacity: 0.75, fontSize: 12 }, children: state.error }) : null
		            ]
		          }
		        ),
		        state.phase === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		          "button",
		          {
		            type: "button",
		            onClick: onInstall,
		            disabled: installing,
		            style: {
		              flex: "none",
		              cursor: installing ? "default" : "pointer",
		              fontSize: 13,
		              padding: "5px 14px",
		              borderRadius: 8,
		              border: "1px solid currentColor",
		              background: "transparent",
		              color: "inherit",
		              opacity: installing ? 0.5 : 0.95
		            },
		            children: installing ? t("installing") : t("installNow")
		          }
		        ) : null
		      ]
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
		  const [checkedAt, setCheckedAt] = (0, import_react2.useState)(null);
		  const [shell, setShell] = (0, import_react2.useState)(null);
		  const [installing, setInstalling] = (0, import_react2.useState)(false);
		  const [installError, setInstallError] = (0, import_react2.useState)(null);
		  const [shellError, setShellError] = (0, import_react2.useState)(false);
		  (0, import_react2.useEffect)(() => {
		    let alive = true;
		    getJson(`${ROUTE_PREFIX}/status`).then((v) => {
		      if (alive) setStatus(v);
		    }).catch((err) => {
		      if (alive) setStatusError(err instanceof Error ? err.message : String(err));
		    });
		    return () => {
		      alive = false;
		    };
		  }, []);
		  (0, import_react2.useEffect)(() => {
		    let alive = true;
		    let timer;
		    const tick = () => {
		      getJson(`${ROUTE_PREFIX}/shell-state`).then((v) => {
		        if (alive) {
		          setShell(v);
		          setShellError(false);
		        }
		      }).catch(() => {
		        if (alive) setShellError(true);
		      }).finally(() => {
		        if (alive) timer = setTimeout(tick, 3e3);
		      });
		    };
		    tick();
		    return () => {
		      alive = false;
		      clearTimeout(timer);
		    };
		  }, []);
		  const doInstall = (0, import_react2.useCallback)(() => {
		    setInstalling(true);
		    setInstallError(null);
		    requestJson(`${ROUTE_PREFIX}/install`, { method: "POST" }).then(() => getJson(`${ROUTE_PREFIX}/shell-state`)).then(setShell).catch((err) => setInstallError(err instanceof Error ? err.message : String(err))).finally(() => setInstalling(false));
		  }, []);
		  const doCheck = (0, import_react2.useCallback)(() => {
		    setChecking(true);
		    setCheck(null);
		    setCheckError(null);
		    const versions = requestJson(`${ROUTE_PREFIX}/check`, {}, true).then(setCheck);
		    const desktop = shell?.available === true && shell.supported !== false ? requestJson(`${ROUTE_PREFIX}/check-shell`, { method: "POST" }) : Promise.resolve();
		    Promise.allSettled([versions, desktop]).then((results) => {
		      const errors = results.filter((r) => r.status === "rejected");
		      if (errors.length)
		        setCheckError(
		          [
		            ...new Set(errors.map((r) => r.reason instanceof Error ? r.reason.message : String(r.reason)))
		          ].join("\uFF1B")
		        );
		    }).finally(() => {
		      setChecking(false);
		      setCheckedAt((/* @__PURE__ */ new Date()).toISOString());
		    });
		  }, [shell?.available, shell?.supported]);
		  const updateLabel = (() => {
		    if (checking) return tr("checking");
		    if (shell?.supported === false && check && check.errors.length === 0) return tr("checkedReadOnly");
		    if (shell?.available && shell.supported !== false) return tr(desktopCheckLabel(shell, shellError));
		    return tr(checkLabel(check, checkError !== null));
		  })();
		  const lastChecked = [checkedAt, shell?.lastCheckedAt].filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "px-ui", style: { padding: "4px 2px 24px", maxWidth: 620 }, children: [
		    shell !== null && ["ready", "error", "downloading", "installing"].includes(shell.phase) ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(UpdateBanner, { state: shell, onInstall: doInstall, installing: installing || shellError, t: tr }) : null,
		    installError !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "alert", style: { overflowWrap: "anywhere" }, children: installError }) : null,
		    shellError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "status", children: tr("shellDisconnected") }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { style: { margin: "0 0 8px" }, children: tr("section.app") }),
		    statusError !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 13, opacity: 0.8 }, children: [
		      tr("unavailable"),
		      "\uFF08",
		      statusError,
		      "\uFF09"
		    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: tr("current"), value: status?.current.app ?? tr("loading") }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Heading, { children: tr("section.dsh") }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: tr("current"), value: status?.current.dsh ?? tr("loading") }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: tr("platform"), value: status?.current.platform ?? "\u2014" }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Heading, { children: tr("section.update") }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		      Row,
		      {
		        label: tr("latest"),
		        value: shell?.available && shell.supported !== false && !shellError ? shell.version ?? "\u2014" : check?.latest.app ?? "\u2014"
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: tr("latestCore"), value: check?.latest.dsh ?? "\u2014" }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		      Row,
		      {
		        label: tr("lastChecked"),
		        value: lastChecked ? new Date(lastChecked).toLocaleString() : tr("notChecked")
		      }
		    ),
		    shell?.available === true ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		      Row,
		      {
		        label: tr("shellState"),
		        value: shell.phase === "downloading" && shell.percent !== null ? `${shell.status} (${shell.percent}%)` : shell.status
		      }
		    ) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "6px 0" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { flex: "0 0 132px", opacity: 0.62, fontSize: 13 }, children: tr("section.update") }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 14 }, children: updateLabel }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		        "button",
		        {
		          type: "button",
		          onClick: doCheck,
		          disabled: checking || shell?.phase === "installing",
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
		    check?.releaseUrl !== null && check?.releaseUrl !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: tr("openRelease"), value: check.releaseUrl }) : null,
		    checkError !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "alert", style: { fontSize: 12.5, opacity: 0.8, overflowWrap: "anywhere" }, children: checkError }) : null,
		    check !== null && check.errors.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "status", style: { fontSize: 12.5, opacity: 0.8, overflowWrap: "anywhere" }, children: check.errors.join("\uFF1B") }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { style: { marginTop: 24, borderTop: "1px solid #8883", paddingTop: 16 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { style: { cursor: "pointer" }, children: tr("paths") }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, opacity: 0.6, marginBottom: 2 }, children: tr("copyHint") }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 8, margin: "8px 0 4px" }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(OpenButton, { what: "open-data", label: tr("openDataDir"), t: tr }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(OpenButton, { what: "open-log", label: tr("openLog"), t: tr })
		      ] }),
		      status?.manifestPath !== null && status?.manifestPath !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		        PathRow,
		        {
		          label: "manifest",
		          value: status.manifestPath,
		          copyLabel: tr("copy"),
		          copiedLabel: tr("copied")
		        }
		      ) : null
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, opacity: 0.55, marginTop: 18, lineHeight: 1.7 }, children: tr("note") })
		  ] });
		}
		function OpenButton({
		  what,
		  label,
		  t
		}) {
		  const [state, setState] = (0, import_react2.useState)("idle");
		  const open = (0, import_react2.useCallback)(() => {
		    setState("idle");
		    fetch(`${ROUTE_PREFIX}/open?what=${what}`, { method: "POST" }).then((r) => {
		      setState(r.ok ? "sent" : "failed");
		    }).catch(() => {
		      setState("failed");
		    });
		  }, [what]);
		  const text = state === "sent" ? t("requested") : state === "failed" ? t("openFailed") : label;
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		    "button",
		    {
		      type: "button",
		      onClick: open,
		      style: {
		        cursor: "pointer",
		        fontSize: 13,
		        padding: "4px 12px",
		        borderRadius: 8,
		        border: "1px solid currentColor",
		        background: "transparent",
		        color: "inherit",
		        opacity: state === "failed" ? 0.5 : 0.85
		      },
		      children: text
		    }
		  );
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
		        // 排在官方分区之后：它们是 dsh 自身的设置，我们这一块是外壳附加信息。
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
