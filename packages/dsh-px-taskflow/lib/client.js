window.__ModuleLoader__.load({
	id: "dsh-px-taskflow",
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

		// packages/dsh-px-taskflow/src/client.tsx
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

		// packages/dsh-px-taskflow/src/client.tsx
		var import_react2 = require("react");

		// packages/shared/client-http.ts
		var RequestError = class extends Error {
		  constructor(message2, status, code, retryable = true) {
		    super(message2);
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

		// packages/dsh-px-taskflow/src/client.tsx
		var import_jsx_runtime2 = require("react/jsx-runtime");
		var inject = ["betterSidebar"];
		var card = { ...cardStyle, marginBottom: 12 };
		var button = controlStyle;
		var labels = {
		  returned: "\u5DF2\u8FD4\u56DE",
		  error: "\u6267\u884C\u5F02\u5E38",
		  cancelled: "\u5DF2\u53D6\u6D88",
		  interrupted: "\u7ED3\u679C\u672A\u8BB0\u5F55",
		  running: "\u6267\u884C\u4E2D"
		};
		var states = { working: "\u8FDB\u884C\u4E2D", blocked: "\u9047\u5230\u963B\u788D", ready_for_review: "\u5F85\u68C0\u67E5\u4EA4\u4ED8" };
		var message = (err) => err instanceof Error ? err.message : String(err);
		function ExecutionCard({ call, sessionId }) {
		  const [open, setOpen] = (0, import_react2.useState)(false);
		  const [detail, setDetail] = (0, import_react2.useState)(null);
		  const [output, setOutput] = (0, import_react2.useState)("");
		  const [error, setError] = (0, import_react2.useState)("");
		  const [busy, setBusy] = (0, import_react2.useState)(false);
		  const [retry, setRetry] = (0, import_react2.useState)(0);
		  const url = `/dsh-px-taskflow/evidence?sessionId=${encodeURIComponent(sessionId)}&callId=${encodeURIComponent(call.id)}`;
		  (0, import_react2.useEffect)(() => {
		    if (!open) return;
		    let active = true;
		    setBusy(true);
		    setError("");
		    setDetail(null);
		    setOutput("");
		    void requestJson(url).then((value) => {
		      if (active) {
		        setDetail(value);
		        setOutput(value.output);
		      }
		    }).catch((err) => {
		      if (active) setError(message(err));
		    }).finally(() => {
		      if (active) setBusy(false);
		    });
		    return () => {
		      active = false;
		    };
		  }, [url, open, call.outcome, call.durationMs, retry]);
		  async function more() {
		    if (detail?.nextOutputOffset === null || detail?.nextOutputOffset === void 0 || busy) return;
		    setBusy(true);
		    setError("");
		    try {
		      const value = await requestJson(url + `&offset=${detail.nextOutputOffset}`);
		      setDetail(value);
		      setOutput((old) => old + value.output);
		    } catch (err) {
		      setError(message(err));
		    } finally {
		      setBusy(false);
		    }
		  }
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
		    "details",
		    {
		      style: card,
		      onToggle: (event) => setOpen(event.currentTarget.open),
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("summary", { style: { cursor: "pointer" }, children: [
		          labels[call.outcome],
		          " \xB7 ",
		          call.tool,
		          call.durationMs !== null ? ` \xB7 ${(call.durationMs / 1e3).toFixed(1)} \u79D2` : ""
		        ] }),
		        open ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
		          detail?.input ?? call.input ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { style: { whiteSpace: "pre-wrap", fontSize: 12 }, children: detail?.input ?? call.input }) : null,
		          error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "alert", children: [
		            error,
		            " ",
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		              "button",
		              {
		                style: button,
		                disabled: busy,
		                onClick: () => detail ? void more() : setRetry((v) => v + 1),
		                children: "\u91CD\u8BD5\u8BFB\u53D6"
		              }
		            )
		          ] }) : null,
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { style: { whiteSpace: "pre-wrap", fontSize: 12 }, children: output || (busy ? "\u6B63\u5728\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u7684\u8F93\u51FA\u2026" : detail ? "\u5C1A\u65E0\u6587\u672C\u8F93\u51FA\u8BB0\u5F55" : call.output) }),
		          detail ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: { fontSize: 12, opacity: 0.7 }, children: [
		            "\u5DF2\u8BFB\u53D6 ",
		            output.length,
		            " / ",
		            detail.outputLength,
		            " \u5B57\u7B26",
		            call.outcomeSource === "command_marker" ? " \xB7 \u72B6\u6001\u4F9D\u636E\u547D\u4EE4\u8F93\u51FA\u672B\u5C3E\u6807\u8BB0" : ""
		          ] }) : null,
		          detail?.nextOutputOffset !== null && detail?.nextOutputOffset !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: button, disabled: busy, onClick: () => void more(), children: busy ? "\u8BFB\u53D6\u4E2D\u2026" : "\u8BFB\u53D6\u540E\u7EED\u8F93\u51FA" }) : null,
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("small", { children: [
		            "\u8BC1\u636E\u7F16\u53F7\uFF1A",
		            call.id
		          ] }) }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { style: { opacity: 0.65 }, children: "\u8BFB\u53D6\u7684\u662F\u4F1A\u8BDD\u5DF2\u4FDD\u5B58\u7684\u6587\u672C\uFF0C\u4E0D\u4F1A\u91CD\u65B0\u6267\u884C\u5DE5\u5177\uFF1B\u4E0A\u6E38\u5DE5\u5177\u672A\u4FDD\u5B58\u7684\u5185\u5BB9\u65E0\u6CD5\u4ECE\u8FD9\u91CC\u6062\u590D\u3002" })
		        ] }) : null
		      ]
		    }
		  );
		}
		function SessionTaskPanel({ scope, visible }) {
		  const [data, setData] = (0, import_react2.useState)(null);
		  const [error, setError] = (0, import_react2.useState)("");
		  const [retryable, setRetryable] = (0, import_react2.useState)(true);
		  const [pages, setPages] = (0, import_react2.useState)([void 0]);
		  const [refresh, setRefresh] = (0, import_react2.useState)(0);
		  const beforeSeq = pages[pages.length - 1];
		  (0, import_react2.useEffect)(() => {
		    let active = true;
		    let timer;
		    setData(null);
		    setError("");
		    setRetryable(true);
		    if (!visible) return;
		    const poll = async () => {
		      let retry = true;
		      try {
		        const query = beforeSeq === void 0 ? "" : `&beforeSeq=${beforeSeq}`;
		        const value = await requestJson(
		          `/dsh-px-taskflow/review?sessionId=${encodeURIComponent(scope.sessionId)}${query}`
		        );
		        if (active) {
		          setData(value);
		          setError("");
		        }
		      } catch (err) {
		        retry = !(err instanceof RequestError) || err.retryable;
		        if (active) {
		          setError(message(err));
		          setRetryable(retry);
		        }
		      }
		      if (active && retry && beforeSeq === void 0) timer = setTimeout(() => void poll(), 2500);
		    };
		    void poll();
		    return () => {
		      active = false;
		      clearTimeout(timer);
		    };
		  }, [scope.sessionId, visible, beforeSeq, refresh]);
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
		    "div",
		    {
		      className: "px-ui",
		      style: {
		        padding: 16,
		        height: "100%",
		        overflowY: "auto",
		        minWidth: 0,
		        overflowWrap: "anywhere",
		        fontSize: 13,
		        lineHeight: 1.6
		      },
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { style: { marginTop: 0 }, children: "\u4EFB\u52A1\u8FDB\u5C55\u4E0E\u4EA4\u4ED8" }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { opacity: 0.65 }, children: "\u8BB0\u5F55\u968F\u4F1A\u8BDD\u4FDD\u5B58\u3002\u5217\u8868\u663E\u793A\u6458\u8981\uFF0C\u5C55\u5F00\u6267\u884C\u53EF\u6309\u9700\u8BFB\u53D6\u8F93\u51FA\u3002" }),
		        error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "alert", children: [
		          error,
		          " ",
		          data ? "\u4E0B\u65B9\u662F\u4E0A\u6B21\u8BFB\u53D6\u7684\u8BB0\u5F55\u3002" : null,
		          " ",
		          retryable && beforeSeq === void 0 ? "\u6B63\u5728\u91CD\u8BD5\u3002" : "\u81EA\u52A8\u91CD\u8BD5\u5DF2\u505C\u6B62\u3002"
		        ] }) : null,
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: button, onClick: () => setRefresh((v) => v + 1), children: "\u91CD\u65B0\u8BFB\u53D6" }),
		          beforeSeq !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: button, onClick: () => setPages([void 0]), children: "\u8FD4\u56DE\u6700\u65B0\u8BB0\u5F55" }) : null
		        ] }),
		        !data && !error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u4EFB\u52A1\u8BB0\u5F55\u2026" }) : null,
		        data ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("section", { style: card, "aria-label": "\u4EFB\u52A1\u8BB0\u5F55", children: data.checkpoint ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: states[data.checkpoint.state] }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { style: { margin: "8px 0" }, children: data.checkpoint.goal }),
		            data.checkpoint.summary.length > 240 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { children: [
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("summary", { style: { cursor: "pointer" }, children: [
		                data.checkpoint.summary.slice(0, 240),
		                "\u2026"
		              ] }),
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: data.checkpoint.summary })
		            ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: data.checkpoint.summary }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { children: [
		              "\u4E0B\u4E00\u6B65\uFF1A",
		              data.checkpoint.nextStep || "\u68C0\u67E5\u4FEE\u6539\u4E0E\u9A8C\u8BC1\u7ED3\u679C"
		            ] }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("small", { style: { opacity: 0.65 }, children: [
		              "Agent \u5DE5\u4F5C\u8BB0\u5F55 \xB7 ",
		              new Date(data.checkpoint.time).toLocaleString()
		            ] }),
		            data.checkpointStale ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", children: "\u8BB0\u5F55\u4E4B\u540E\u8FD8\u6709\u53EF\u80FD\u5F71\u54CD\u7ED3\u8BBA\u7684\u6267\u884C\uFF0C\u8BF7\u6838\u5BF9\u6700\u65B0\u7ED3\u679C\u3002" }) : null,
		            data.checkpoint.evidence.length ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { children: [
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: "\u5F15\u7528\u7684\u6267\u884C\u8BC1\u636E" }),
		              data.checkpoint.evidence.map((id) => {
		                const call = data.referencedExecutions.find((c) => c.id === id);
		                return call ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ExecutionCard, { call, sessionId: scope.sessionId }, id) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
		                  "\u6B64\u6761\u5F15\u7528\u672A\u627E\u5230\uFF1A",
		                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: id })
		                ] }, id);
		              })
		            ] }) : null
		          ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "\u5C1A\u65E0\u5DE5\u4F5C\u8BB0\u5F55" }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u591A\u6B65\u9AA4\u4EFB\u52A1\u5F00\u59CB\u540E\uFF0CAgent \u53EF\u4EE5\u8BB0\u5F55\u76EE\u6807\u548C\u4EA4\u63A5\u70B9\u3002\u6267\u884C\u8BB0\u5F55\u81EA\u52A8\u4EA7\u751F\u3002" })
		          ] }) }),
		          data.changedFiles.length ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { style: card, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("strong", { children: [
		              "\u5DF2\u8BB0\u5F55\u7684\u6587\u4EF6\u5199\u5165 \xB7 ",
		              data.changedFiles.length,
		              " \u4E2A\u8DEF\u5F84"
		            ] }),
		            data.changedFiles.map((path) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { paddingTop: 6 }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: path }) }, path)),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { marginBottom: 0, opacity: 0.65 }, children: "\u6765\u81EA\u6210\u529F\u8FD4\u56DE\u7684\u6587\u4EF6\u5199\u5DE5\u5177\uFF0C\u4E0D\u5305\u542B\u53EA\u8BFB\u67E5\u770B\u3002\u547D\u4EE4\u884C\u6539\u52A8\u3001\u6700\u7EC8\u5DEE\u5F02\u4E0E\u4EBA\u5DE5\u5DF2\u6709\u4FEE\u6539\u8BF7\u5728\u6587\u4EF6\u53D8\u52A8\u9762\u677F\u6838\u5BF9\u3002" })
		          ] }) : null,
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-label": "\u5B9E\u9645\u6267\u884C\u8BB0\u5F55", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("h4", { children: [
		              "\u5B9E\u9645\u6267\u884C\u8BB0\u5F55 \xB7 \u5171 ",
		              data.total,
		              " \u6761"
		            ] }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { opacity: 0.65 }, children: "\u201C\u5DF2\u8FD4\u56DE\u201D\u53EA\u4EE3\u8868\u5DE5\u5177\u6B63\u5E38\u8FD4\u56DE\uFF0C\u6D4B\u8BD5\u7ED3\u679C\u4ECD\u9700\u6838\u5BF9\u8F93\u51FA\u3002" }),
		            beforeSeq !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { children: [
		              "\u6B63\u5728\u67E5\u770B\u5386\u53F2\u9875\uFF08\u7B2C ",
		              pages.length,
		              " \u9875\uFF09\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u8DF3\u56DE\u6700\u65B0\u8BB0\u5F55\u3002"
		            ] }) : null,
		            data.executions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u5F53\u524D\u9875\u6CA1\u6709\u5DE5\u5177\u6267\u884C\u8BB0\u5F55\u3002" }) : null,
		            [...data.executions].reverse().map((call) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ExecutionCard, { call, sessionId: scope.sessionId }, call.id)),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: [
		              pages.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: button, onClick: () => setPages((old) => old.slice(0, -1)), children: "\u8F83\u65B0\u4E00\u9875" }) : null,
		              data.nextBeforeSeq !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: button, onClick: () => setPages((old) => [...old, data.nextBeforeSeq]), children: "\u66F4\u65E9\u8BB0\u5F55" }) : null
		            ] })
		          ] })
		        ] }) : null
		      ]
		    }
		  );
		}
		function TaskPanel(props) {
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SessionTaskPanel, { ...props }, props.scope.sessionId);
		}
		function apply(ctx) {
		  installUiStyles(ctx);
		  ctx.effect(
		    () => ctx.betterSidebar.registerTab({
		      id: "dsh-px-taskflow",
		      title: "\u4EFB\u52A1\u8FDB\u5C55",
		      description: "\u76EE\u6807\u3001\u4EA4\u63A5\u70B9\u4E0E\u5B9E\u9645\u6267\u884C\u8BC1\u636E",
		      order: 15,
		      single: true,
		      icon: "\u2713",
		      component: TaskPanel
		    }),
		    "taskflow: task panel"
		  );
		}

		return module.exports;
	}
});
