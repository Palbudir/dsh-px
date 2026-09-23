window.__ModuleLoader__.load({
	id: "dsh-px-workbench",
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

		// packages/dsh-px-workbench/src/client.tsx
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
		var controlStyle = {
		  borderRadius: 8,
		  padding: "5px 11px",
		  minHeight: 32,
		  color: "inherit",
		  cursor: "pointer",
		  fontSize: 13
		};
		var cardStyle = { border: "1px solid var(--px-border)", borderRadius: 10, padding: 14, minWidth: 0 };

		// packages/dsh-px-workbench/src/client.tsx
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

		// packages/dsh-px-workbench/src/client.tsx
		var import_jsx_runtime2 = require("react/jsx-runtime");
		var inject = ["slots", "locale"];
		var prefix = "/dsh-px-workbench";
		var button = controlStyle;
		var card = { ...cardStyle, marginBottom: 12 };
		var prompts = [
		  {
		    title: "\u719F\u6089\u9879\u76EE",
		    text: "\u5148\u9605\u8BFB\u5F53\u524D\u5DE5\u4F5C\u533A\u7684\u8BF4\u660E\u548C\u4EE3\u7801\uFF0C\u89E3\u91CA\u9879\u76EE\u7684\u7528\u9014\u3001\u8FD0\u884C\u65B9\u5F0F\u4E0E\u6700\u503C\u5F97\u4FEE\u590D\u7684\u4E00\u4E2A\u95EE\u9898\u3002\u8BF7\u7ED9\u51FA\u6587\u4EF6\u4F9D\u636E\uFF0C\u8FD9\u4E00\u6B65\u5148\u4E0D\u8981\u4FEE\u6539\u4EE3\u7801\u3002"
		  },
		  {
		    title: "\u5B8C\u6210\u4E00\u6B21\u4FEE\u6539",
		    text: "\u5728\u5F53\u524D\u5DE5\u4F5C\u533A\u5B8C\u6210\u4E0B\u9762\u7684\u4FEE\u6539\uFF1A[\u586B\u5199\u9700\u6C42]\u3002\u5148\u8BFB\u9879\u76EE\u7EA6\u5B9A\uFF0C\u8BF4\u660E\u5F71\u54CD\u8303\u56F4\uFF0C\u518D\u5B9E\u73B0\u5E76\u8FD0\u884C\u76F8\u5173\u9A8C\u8BC1\uFF1B\u6700\u540E\u5217\u51FA\u4FEE\u6539\u6587\u4EF6\u3001\u9A8C\u8BC1\u7ED3\u679C\u548C\u672A\u89E3\u51B3\u7684\u95EE\u9898\u3002"
		  },
		  {
		    title: "\u9A8C\u8BC1\u5DE5\u5177\u53EF\u7528",
		    text: "\u5728\u5F53\u524D\u5DE5\u4F5C\u533A\u521B\u5EFA agent-smoke.txt\uFF0C\u5199\u5165 DSH-PX agent smoke OK\u3002\u5FC5\u987B\u5B9E\u9645\u8C03\u7528\u6587\u4EF6\u5DE5\u5177\u5199\u5165\uFF0C\u518D\u7528 Shell \u8BFB\u53D6\u9A8C\u8BC1\uFF0C\u62A5\u544A\u5B9E\u9645\u8DEF\u5F84\u4E0E\u8BFB\u53D6\u5185\u5BB9\u3002\u4E0D\u8981\u4FEE\u6539\u5176\u4ED6\u6587\u4EF6\u3002"
		  }
		];
		function Workbench() {
		  const [data, setData] = (0, import_react2.useState)(null);
		  const [error, setError] = (0, import_react2.useState)(null);
		  const [busy, setBusy] = (0, import_react2.useState)(false);
		  const [message, setMessage] = (0, import_react2.useState)("");
		  const [confirm, setConfirm] = (0, import_react2.useState)(false);
		  const [restarting, setRestarting] = (0, import_react2.useState)(false);
		  const [path, setPath] = (0, import_react2.useState)("");
		  const [adding, setAdding] = (0, import_react2.useState)(false);
		  const [workspaceMessage, setWorkspaceMessage] = (0, import_react2.useState)("");
		  const [networkCheck, setNetworkCheck] = (0, import_react2.useState)(null);
		  const [networkBusy, setNetworkBusy] = (0, import_react2.useState)(false);
		  const [networkError, setNetworkError] = (0, import_react2.useState)("");
		  async function checkNetwork() {
		    setNetworkBusy(true);
		    setNetworkError("");
		    try {
		      setNetworkCheck(await requestJson(`${prefix}/network-check`, { method: "POST" }));
		    } catch (err) {
		      setNetworkError(err instanceof Error ? err.message : String(err));
		    } finally {
		      setNetworkBusy(false);
		    }
		  }
		  async function addWorkspace() {
		    setAdding(true);
		    setWorkspaceMessage("");
		    try {
		      const result = await requestJson(
		        `${prefix}/workspace?path=${encodeURIComponent(path.trim())}`,
		        { method: "POST" }
		      );
		      setWorkspaceMessage(result.message);
		    } catch (err) {
		      setWorkspaceMessage(err instanceof Error ? err.message : String(err));
		    } finally {
		      setAdding(false);
		    }
		  }
		  async function refresh() {
		    setBusy(true);
		    try {
		      setData(await requestJson(`${prefix}/status`));
		      setError(null);
		    } catch (err) {
		      setError(err instanceof Error ? err.message : String(err));
		    } finally {
		      setBusy(false);
		    }
		  }
		  (0, import_react2.useEffect)(() => {
		    let active = true;
		    let timer;
		    const poll = async () => {
		      try {
		        const value = await requestJson(`${prefix}/status`);
		        if (active) {
		          setData(value);
		          setError(null);
		        }
		      } catch (err) {
		        if (active) setError(err instanceof Error ? err.message : String(err));
		      }
		      if (active) timer = setTimeout(() => void poll(), 5e3);
		    };
		    void poll();
		    return () => {
		      active = false;
		      clearTimeout(timer);
		    };
		  }, []);
		  async function restart() {
		    setRestarting(true);
		    setConfirm(false);
		    try {
		      const result = await requestJson(`${prefix}/restart`, { method: "POST" });
		      setMessage(result.message);
		    } catch (err) {
		      setError(err instanceof Error ? err.message : String(err));
		    } finally {
		      setRestarting(false);
		    }
		  }
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
		    "div",
		    {
		      className: "px-ui",
		      style: { display: "grid", gap: 16, minWidth: 0, overflowWrap: "anywhere", paddingBottom: 20 },
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { style: { margin: "0 0 8px" }, children: "\u8FD0\u884C\u4E0E\u5E2E\u52A9" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { margin: 0, opacity: 0.7, lineHeight: 1.7 }, children: "\u4ECE\u5DE5\u4F5C\u533A\u5F00\u59CB\uFF0C\u8BA9 Agent \u8BFB\u53D6\u6587\u4EF6\u3001\u6267\u884C\u5DE5\u5177\u5E76\u4EA4\u4ED8\u53EF\u68C0\u67E5\u7684\u7ED3\u679C\u3002" })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { style: card, "aria-label": "\u5F00\u59CB\u4EFB\u52A1", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { style: { marginTop: 0 }, children: "\u5F00\u59CB\u4E00\u4E2A\u4EFB\u52A1" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("ol", { style: { paddingLeft: 22, lineHeight: 1.9 }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { children: "\u5728\u8BBE\u7F6E\u7684\u6A21\u578B\u63D0\u4F9B\u5546\u4E2D\u914D\u7F6E\u6A21\u578B\u548C\u5BC6\u94A5\u3002" }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { children: "\u5173\u95ED\u8BBE\u7F6E\uFF0C\u5728\u4FA7\u680F\u6DFB\u52A0\u672C\u673A\u9879\u76EE\u6587\u4EF6\u5939\uFF0C\u518D\u65B0\u5EFA\u4F1A\u8BDD\u3002" }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { children: "\u9009\u62E9\u6807\u51C6\u6A21\u5F0F\u4E0E\u6A21\u578B\uFF0C\u63CF\u8FF0\u9700\u6C42\uFF1B\u6309\u63D0\u793A\u5BA1\u9605\u5DE5\u5177\u6743\u9650\u548C\u4FEE\u6539\u7ED3\u679C\u3002" })
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { htmlFor: "dsh-px-workspace", style: { fontSize: 13 }, children: "\u672C\u673A\u9879\u76EE\u6587\u4EF6\u5939" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0 16px" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		              "input",
		              {
		                id: "dsh-px-workspace",
		                value: path,
		                placeholder: "C:\\Projects\\demo",
		                onChange: (e) => setPath(e.target.value),
		                style: { ...button, minWidth: 0, flex: "1 1 240px", cursor: "text" }
		              }
		            ),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: button, disabled: adding || !path.trim(), onClick: () => void addWorkspace(), children: adding ? "\u6DFB\u52A0\u4E2D\u2026" : "\u6DFB\u52A0\u5DE5\u4F5C\u533A" })
		          ] }),
		          workspaceMessage ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", style: { fontSize: 13 }, children: workspaceMessage }) : null,
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: prompts.map((p) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
		            "button",
		            {
		              style: button,
		              onClick: () => {
		                void navigator.clipboard.writeText(p.text).then(() => setMessage(`\u5DF2\u590D\u5236\u201C${p.title}\u201D\uFF0C\u7C98\u8D34\u5230\u65B0\u4F1A\u8BDD\u5373\u53EF\u3002`)).catch(() => setMessage(`\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u590D\u5236\uFF1A${p.text}`));
		              },
		              children: [
		                "\u590D\u5236\uFF1A",
		                p.title
		              ]
		            },
		            p.title
		          )) }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { fontSize: 12, opacity: 0.65, marginBottom: 0 }, children: "\u9996\u6B21\u9A8C\u8BC1\u5EFA\u8BAE\u4F7F\u7528\u7A7A\u6587\u4EF6\u5939\u3002\u6A21\u578B\u80FD\u5426\u8FDE\u63A5\u4EE5\u771F\u5B9E\u4EFB\u52A1\u7ED3\u679C\u4E3A\u51C6\u3002" })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { style: card, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { style: { cursor: "pointer" }, children: "\u672C\u673A\u8FD0\u884C\u8BCA\u65AD\u4E0E\u670D\u52A1\u6062\u590D" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-label": "\u672C\u673A\u8FD0\u884C\u68C0\u67E5", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }, children: [
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: "\u672C\u673A\u8FD0\u884C\u68C0\u67E5" }),
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: button, disabled: busy, onClick: () => void refresh(), children: busy ? "\u68C0\u67E5\u4E2D\u2026" : "\u91CD\u65B0\u68C0\u67E5" })
		            ] }),
		            error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "alert", children: [
		              "\u68C0\u67E5\u5931\u8D25\uFF1A",
		              error,
		              "\u3002\u53EF\u91CD\u65B0\u68C0\u67E5\uFF0C\u6216\u5230\u684C\u9762\u7A97\u53E3\u6062\u590D\u670D\u52A1\u3002"
		            ] }) : null,
		            !data ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u672C\u673A\u72B6\u6001\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
		                "dl",
		                {
		                  style: {
		                    display: "grid",
		                    gridTemplateColumns: "100px minmax(0,1fr)",
		                    gap: "10px 12px",
		                    fontSize: 13,
		                    lineHeight: 1.6
		                  },
		                  children: [
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dt", { children: "Agent \u670D\u52A1" }),
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("dd", { style: { margin: 0 }, children: [
		                      error ? "\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u4EE5\u4E0B\u4E3A\u4E0A\u6B21\u68C0\u67E5\u7ED3\u679C" : "\u5DF2\u8FDE\u63A5",
		                      " \xB7 \u542F\u52A8\u4E8E",
		                      " ",
		                      new Date(data.startedAt).toLocaleTimeString()
		                    ] }),
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dt", { children: "\u684C\u9762\u5916\u58F3" }),
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dd", { style: { margin: 0 }, children: data.service?.message ?? "\u672A\u8FDE\u63A5\uFF08\u53EF\u7EE7\u7EED\u4F7F\u7528\u6D4F\u89C8\u5668\u4E2D\u7684 Agent\uFF09" }),
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dt", { children: "Node" }),
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("dd", { style: { margin: 0 }, children: [
		                      data.node.version,
		                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("br", {}),
		                      data.node.path
		                    ] }),
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dt", { children: "\u6570\u636E\u76EE\u5F55" }),
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("dd", { style: { margin: 0 }, children: [
		                      data.home ?? "\u672A\u77E5",
		                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("br", {}),
		                      data.writable ? "\u76EE\u5F55\u6743\u9650\u5141\u8BB8\u5199\u5165" : "\u76EE\u5F55\u4E0D\u53EF\u5199\uFF0C\u8BF7\u68C0\u67E5\u6743\u9650"
		                    ] }),
		                    data.tools.map((t) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "contents" }, children: [
		                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dt", { children: t.name }),
		                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dd", { style: { margin: 0 }, children: t.path ? `\u5DF2\u627E\u5230\uFF1A${t.path}` : "PATH \u4E2D\u672A\u627E\u5230\uFF0C\u8BF7\u5B89\u88C5\u6216\u8C03\u6574\u672C\u673A\u73AF\u5883\u540E\u91CD\u542F" })
		                    ] }, t.name)),
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dt", { children: "\u6A21\u578B\u51ED\u636E" }),
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dd", { style: { margin: 0 }, children: data.credentialsFile ? "\u5B58\u5728\u51ED\u636E\u6587\u4EF6\uFF0C\u8FDE\u63A5\u80FD\u529B\u9700\u5B9E\u9645\u8FD0\u884C\u4EFB\u52A1\u9A8C\u8BC1" : "\u672A\u53D1\u73B0\u51ED\u636E\u6587\u4EF6\uFF0C\u8BF7\u5728\u6A21\u578B\u8BBE\u7F6E\u4E2D\u914D\u7F6E\uFF08\u73AF\u5883\u53D8\u91CF\u914D\u7F6E\u4E5F\u53EF\u80FD\u53EF\u7528\uFF09" }),
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dt", { children: "\u7F51\u9875\u7F51\u7EDC" }),
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("dd", { style: { margin: 0 }, children: [
		                      data.network?.message ?? "\u5C1A\u65E0\u684C\u9762\u7F51\u7EDC\u8BCA\u65AD\u3002\u53EF\u6267\u884C\u4E0B\u65B9\u7F51\u9875\u8BFB\u53D6\u68C0\u67E5\u3002",
		                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("br", {}),
		                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: "\u4EE3\u7406\u8BBE\u7F6E\u5728\u670D\u52A1\u542F\u52A8\u65F6\u751F\u6548\uFF1B\u7CFB\u7EDF\u4EE3\u7406\u6539\u53D8\u540E\u9700\u91CD\u542F\u670D\u52A1\u3002" })
		                    ] })
		                  ]
		                }
		              ),
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-label": "\u7F51\u9875\u8BFB\u53D6\u68C0\u67E5", style: { margin: "16px 0" }, children: [
		                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		                  "button",
		                  {
		                    style: button,
		                    disabled: networkBusy || Boolean(error),
		                    onClick: () => void checkNetwork(),
		                    children: networkBusy ? "\u6B63\u5728\u8BFB\u53D6\u516C\u5F00\u6587\u6863\u2026" : "\u68C0\u67E5\u7F51\u9875\u8BFB\u53D6"
		                  }
		                ),
		                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { fontSize: 12, opacity: 0.7 }, children: "\u4F7F\u7528 Agent \u540C\u4E00\u7F51\u9875\u670D\u52A1\u8BFB\u53D6 Node.js \u4E0E TypeScript \u5B98\u65B9\u6587\u6863\uFF0C\u4E0D\u8C03\u7528\u6A21\u578B\u3002" }),
		                networkError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "alert", children: [
		                  networkError,
		                  networkCheck ? " \u4E0B\u65B9\u4E3A\u4E0A\u6B21\u68C0\u67E5\u7ED3\u679C\u3002" : ""
		                ] }) : null,
		                networkCheck ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { role: "status", children: [
		                  networkCheck.checks.map((check) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { marginTop: 8 }, children: [
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: check.ok ? "\u53EF\u8BFB\u53D6" : "\u672A\u901A\u8FC7" }),
		                    " \xB7 ",
		                    check.message,
		                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: check.url }) }),
		                    check.ok ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("small", { children: [
		                      "HTTP ",
		                      check.status,
		                      " \xB7 \u5DF2\u53D6\u5F97 ",
		                      check.chars,
		                      " \u5B57\u7B26",
		                      check.truncated ? "\uFF08\u670D\u52A1\u5DF2\u622A\u65AD\uFF09" : ""
		                    ] }) : null
		                  ] }, check.url)),
		                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("small", { children: [
		                    "\u68C0\u67E5\u4E8E ",
		                    new Date(networkCheck.checkedAt).toLocaleString()
		                  ] })
		                ] }) : null
		              ] }),
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		                "button",
		                {
		                  style: button,
		                  disabled: !data.canRestart || Boolean(error) || restarting,
		                  onClick: () => setConfirm(true),
		                  children: "\u91CD\u542F\u672C\u673A\u670D\u52A1"
		                }
		              ) }),
		              confirm ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { role: "alert", style: { marginTop: 12 }, children: [
		                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u91CD\u542F\u4F1A\u4E2D\u65AD\u6B63\u5728\u6267\u884C\u7684\u4EFB\u52A1\u3002\u8BF7\u5148\u7B49\u5F85\u4EFB\u52A1\u7ED3\u675F\uFF1B\u5DF2\u6709\u4F1A\u8BDD\u4E0E\u914D\u7F6E\u4F1A\u4FDD\u7559\u3002" }),
		                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: button, disabled: restarting, onClick: () => void restart(), children: "\u786E\u8BA4\u91CD\u542F" }),
		                " ",
		                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: button, onClick: () => setConfirm(false), children: "\u53D6\u6D88" })
		              ] }) : null,
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: { fontSize: 12, opacity: 0.6 }, children: [
		                "\u68C0\u67E5\u65F6\u95F4\uFF1A",
		                new Date(data.checkedAt).toLocaleString(),
		                " \xB7 \u5DE5\u5177\u8DEF\u5F84\u68C0\u67E5\u4E0D\u4EE3\u8868\u547D\u4EE4\u5DF2\u6267\u884C\u6210\u529F\u3002"
		              ] })
		            ] })
		          ] })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { style: card, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { style: { cursor: "pointer" }, children: "\u9AD8\u7EA7\uFF1A\u63D2\u4EF6\u8BCA\u65AD\u6E05\u5355" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-label": "\u63D2\u4EF6\u6E05\u5355", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { style: { marginTop: 0 }, children: "\u5F53\u524D Profile \u7684\u63D2\u4EF6" }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { fontSize: 12, opacity: 0.7 }, children: "\u6CBF\u7528 DSH \u63D2\u4EF6\u5E02\u573A\u7BA1\u7406\u63D2\u4EF6\u3002\u5B89\u88C5\u6216\u66F4\u6539\u7EC4\u5408\u5305\u540E\u91CD\u542F\u670D\u52A1\u751F\u6548\uFF1B\u8FD9\u91CC\u663E\u793A\u5B89\u88C5\u4E0E\u6E05\u5355\u72B6\u6001\uFF0C\u4E0D\u4EE3\u8868\u6BCF\u4E2A\u63D2\u4EF6\u8FD0\u884C\u6B63\u5E38\u3002" }),
		            data?.profileError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "alert", children: [
		              "\u65E0\u6CD5\u8BFB\u53D6\u63D2\u4EF6\u6E05\u5355\uFF1A",
		              data.profileError
		            ] }) : null,
		            data?.plugins.map((p) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { padding: "10px 0", borderTop: "1px solid #8883", fontSize: 13 }, children: [
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: p.name }),
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { opacity: 0.7, marginTop: 4 }, children: [
		                p.version ?? "\u672A\u5B89\u88C5\u6216\u5305\u4E0D\u53EF\u8BFB",
		                " \xB7 ",
		                p.enabled ? "\u5DF2\u52A0\u5165\u7EC4\u5408\u5305" : "\u672A\u52A0\u5165\u7EC4\u5408\u5305"
		              ] })
		            ] }, p.name)),
		            data && !data.profileError && data.plugins.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u6B64 Profile \u6682\u65E0\u989D\u5916\u63D2\u4EF6\u3002" }) : null
		          ] })
		        ] }),
		        message ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", style: { ...card, margin: 0 }, children: message }) : null
		      ]
		    }
		  );
		}
		function apply(ctx) {
		  installUiStyles(ctx);
		  ctx.slots.inject(
		    "settings.section",
		    () => ctx.slots.register(
		      { name: "settings.section", id: "dsh-px-workbench", order: 110, label: "\u8FD0\u884C\u4E0E\u5E2E\u52A9" },
		      Workbench
		    )
		  );
		}

		return module.exports;
	}
});
