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
		var import_react = require("react");
		var import_jsx_runtime = require("react/jsx-runtime");
		var NS = "dsh-px-updater";
		var ROUTE_PREFIX = "/dsh-px-updater";
		var inject = ["slots", "locale"];
		var DICT = {
		  zh: {
		    "nav": "DSH-PX",
		    "loading": "\u6B63\u5728\u8BFB\u53D6\u7248\u672C\u4FE1\u606F\u2026",
		    "section.app": "\u684C\u9762\u5BA2\u6237\u7AEF",
		    "section.dsh": "\u968F\u9644 dsh \u6838\u5FC3",
		    "section.update": "\u66F4\u65B0",
		    "check": "\u68C0\u67E5\u66F4\u65B0",
		    "checking": "\u6B63\u5728\u68C0\u67E5\u2026",
		    "notChecked": "\u5C1A\u672A\u68C0\u67E5",
		    "upToDate": "\u5DF2\u662F\u6700\u65B0\u7248\u672C",
		    "available": "\u6709\u65B0\u7248\u672C\u53EF\u7528",
		    "current": "\u5F53\u524D",
		    "latest": "\u6700\u65B0",
		    "releaseNotes": "\u53D1\u5E03\u8BF4\u660E",
		    "openRelease": "\u6253\u5F00\u53D1\u5E03\u9875",
		    "paths": "\u76EE\u5F55",
		    "dataDir": "\u6570\u636E\u76EE\u5F55",
		    "logFile": "\u65E5\u5FD7\u6587\u4EF6",
		    "copyHint": "\u628A\u4E0B\u9762\u7684\u8DEF\u5F84\u590D\u5236\u5230\u8D44\u6E90\u7BA1\u7406\u5668\u5373\u53EF\u6253\u5F00\u3002",
		    "copy": "\u590D\u5236",
		    "copied": "\u5DF2\u590D\u5236",
		    "unavailable": "\u65E0\u6CD5\u8BFB\u53D6\u7248\u672C\u4FE1\u606F",
		    "shellState": "\u5916\u58F3\u72B6\u6001",
		    "readyPrefix": "\u65B0\u7248\u672C\u5DF2\u4E0B\u8F7D\u5B8C\u6210\uFF1A",
		    "installNow": "\u91CD\u542F\u5E76\u5B89\u88C5",
		    "installing": "\u6B63\u5728\u8BF7\u6C42\u2026",
		    "note": "\u66F4\u65B0\u7531\u684C\u9762\u5BA2\u6237\u7AEF\u6267\u884C\u4E0B\u8F7D\u4E0E\u5B89\u88C5\uFF1B\u8FD9\u91CC\u53EA\u8D1F\u8D23\u663E\u793A\u4E0E\u68C0\u67E5\u3002"
		  },
		  en: {
		    "nav": "DSH-PX",
		    "loading": "Reading version information\u2026",
		    "section.app": "Desktop client",
		    "section.dsh": "Bundled dsh core",
		    "section.update": "Updates",
		    "check": "Check for updates",
		    "checking": "Checking\u2026",
		    "notChecked": "Not checked yet",
		    "upToDate": "Up to date",
		    "available": "A new version is available",
		    "current": "Current",
		    "latest": "Latest",
		    "releaseNotes": "Release notes",
		    "openRelease": "Open release page",
		    "paths": "Locations",
		    "dataDir": "Data directory",
		    "logFile": "Log file",
		    "copyHint": "Copy a path below into your file manager to open it.",
		    "copy": "Copy",
		    "copied": "Copied",
		    "unavailable": "Could not read version information",
		    "shellState": "Shell status",
		    "readyPrefix": "Update downloaded: ",
		    "installNow": "Restart and install",
		    "installing": "Requesting\u2026",
		    "note": "The desktop client performs the download and install; this page only displays and checks."
		  }
		};
		async function getJson(path) {
		  const res = await fetch(path, { headers: { accept: "application/json" } });
		  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
		  return await res.json();
		}
		function Row({ label, value }) {
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 12, padding: "7px 0", alignItems: "baseline" }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: "0 0 132px", opacity: 0.62, fontSize: 13 }, children: label }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 14, wordBreak: "break-all" }, children: value })
		  ] });
		}
		function Heading({ children }) {
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 13, fontWeight: 600, opacity: 0.75, margin: "18px 0 4px", letterSpacing: ".02em" }, children });
		}
		function PathRow({ label, value, copyLabel, copiedLabel }) {
		  const [copied, setCopied] = (0, import_react.useState)(false);
		  const copy = (0, import_react.useCallback)(() => {
		    void navigator.clipboard?.writeText(value).then(() => {
		      setCopied(true);
		      setTimeout(() => setCopied(false), 1600);
		    }).catch(() => {
		    });
		  }, [value]);
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 12, padding: "7px 0", alignItems: "baseline" }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: "0 0 132px", opacity: 0.62, fontSize: 13 }, children: label }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { style: { fontSize: 12.5, wordBreak: "break-all", flex: 1 }, children: value }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: copy, style: {
		      flex: "none",
		      cursor: "pointer",
		      fontSize: 12,
		      padding: "2px 10px",
		      borderRadius: 6,
		      border: "1px solid currentColor",
		      background: "transparent",
		      color: "inherit",
		      opacity: 0.7
		    }, children: copied ? copiedLabel : copyLabel })
		  ] });
		}
		function UpdateBanner({ state, onInstall, installing, t }) {
		  const tone = state.phase === "error" ? "#c0392b" : "#2e7d32";
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
		    display: "flex",
		    gap: 12,
		    alignItems: "center",
		    margin: "0 0 16px",
		    padding: "10px 14px",
		    borderRadius: 10,
		    border: `1px solid ${tone}`,
		    background: `${tone}1a`
		  }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { flex: 1, fontSize: 13, lineHeight: 1.6 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: state.phase === "ready" ? `${t("readyPrefix")}${state.version ?? ""}` : state.status }),
		      state.phase === "downloading" && state.percent !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { opacity: 0.75, fontSize: 12 }, children: [
		        state.percent,
		        "%"
		      ] }) : null,
		      state.phase === "error" && state.error !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { opacity: 0.75, fontSize: 12 }, children: state.error }) : null
		    ] }),
		    state.phase === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: onInstall, disabled: installing, style: {
		      flex: "none",
		      cursor: installing ? "default" : "pointer",
		      fontSize: 13,
		      padding: "5px 14px",
		      borderRadius: 8,
		      border: "1px solid currentColor",
		      background: "transparent",
		      color: "inherit",
		      opacity: installing ? 0.5 : 0.95
		    }, children: installing ? t("installing") : t("installNow") }) : null
		  ] });
		}
		function DshPxSection({ t }) {
		  const tr = (key) => typeof t === "function" ? t(key) : key;
		  const [status, setStatus] = (0, import_react.useState)(null);
		  const [statusError, setStatusError] = (0, import_react.useState)(null);
		  const [check, setCheck] = (0, import_react.useState)(null);
		  const [checking, setChecking] = (0, import_react.useState)(false);
		  const [checkError, setCheckError] = (0, import_react.useState)(null);
		  const [shell, setShell] = (0, import_react.useState)(null);
		  const [installing, setInstalling] = (0, import_react.useState)(false);
		  (0, import_react.useEffect)(() => {
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
		  (0, import_react.useEffect)(() => {
		    let alive = true;
		    const tick = () => {
		      getJson(`${ROUTE_PREFIX}/shell-state`).then((v) => {
		        if (alive) setShell(v);
		      }).catch(() => {
		      });
		    };
		    tick();
		    const timer = setInterval(tick, 3e3);
		    return () => {
		      alive = false;
		      clearInterval(timer);
		    };
		  }, []);
		  const doInstall = (0, import_react.useCallback)(() => {
		    setInstalling(true);
		    fetch(`${ROUTE_PREFIX}/install`, { method: "POST" }).then(() => {
		    }).catch(() => {
		      setInstalling(false);
		    });
		  }, []);
		  const doCheck = (0, import_react.useCallback)(() => {
		    setChecking(true);
		    setCheckError(null);
		    getJson(`${ROUTE_PREFIX}/check`).then(setCheck).catch((err) => setCheckError(err instanceof Error ? err.message : String(err))).finally(() => setChecking(false));
		  }, []);
		  const updateLabel = (() => {
		    if (checking) return tr("checking");
		    if (!check) return tr("notChecked");
		    return check.updateAvailable.app || check.updateAvailable.dsh ? tr("available") : tr("upToDate");
		  })();
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "4px 2px 24px", maxWidth: 620 }, children: [
		    shell !== null && (shell.phase === "ready" || shell.phase === "error") ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UpdateBanner, { state: shell, onInstall: doInstall, installing, t: tr }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Heading, { children: tr("section.app") }),
		    statusError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 13, opacity: 0.8 }, children: [
		      tr("unavailable"),
		      "\uFF08",
		      statusError,
		      "\uFF09"
		    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, { label: tr("current"), value: status?.current.app ?? tr("loading") }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Heading, { children: tr("section.dsh") }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, { label: tr("current"), value: status?.current.dsh ?? tr("loading") }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, { label: "platform", value: status?.current.platform ?? "\u2014" }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Heading, { children: tr("section.update") }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, { label: tr("latest"), value: check?.latest.app ?? "\u2014" }),
		    shell?.available === true ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, { label: tr("shellState"), value: shell.phase === "downloading" && shell.percent !== null ? `${shell.status} (${shell.percent}%)` : shell.status }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 12, alignItems: "center", padding: "6px 0" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: "0 0 132px", opacity: 0.62, fontSize: 13 }, children: tr("section.update") }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 14 }, children: updateLabel }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: doCheck, disabled: checking, style: {
		        cursor: checking ? "default" : "pointer",
		        fontSize: 13,
		        padding: "4px 12px",
		        borderRadius: 8,
		        border: "1px solid currentColor",
		        background: "transparent",
		        color: "inherit",
		        opacity: checking ? 0.5 : 0.85
		      }, children: checking ? tr("checking") : tr("check") })
		    ] }),
		    check?.releaseUrl !== null && check?.releaseUrl !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, { label: tr("openRelease"), value: check.releaseUrl }) : null,
		    checkError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12.5, opacity: 0.8 }, children: checkError }) : null,
		    check !== null && check.errors.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12.5, opacity: 0.8 }, children: check.errors.join("\uFF1B") }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Heading, { children: tr("paths") }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.6, marginBottom: 2 }, children: tr("copyHint") }),
		    status?.manifestPath !== null && status?.manifestPath !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PathRow, { label: "manifest", value: status.manifestPath, copyLabel: tr("copy"), copiedLabel: tr("copied") }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.55, marginTop: 18, lineHeight: 1.7 }, children: tr("note") })
		  ] });
		}
		function apply(ctx) {
		  ctx.effect?.(() => {
		    const disposers = [
		      ctx.locale.register(NS, "zh", DICT.zh),
		      ctx.locale.register(NS, "en", DICT.en)
		    ];
		    return () => {
		      for (const d of disposers) d();
		    };
		  }, "dsh-px-updater: dictionaries");
		  ctx.slots.inject("settings.section", () => ctx.slots.register({
		    name: "settings.section",
		    id: "dsh-px",
		    // 排在官方分区之后：它们是 dsh 自身的设置，我们这一块是外壳附加信息。
		    order: 100,
		    label: () => ctx.locale.bind(NS)("nav"),
		    locale: NS
		  }, DshPxSection));
		}

		return module.exports;
	}
});
