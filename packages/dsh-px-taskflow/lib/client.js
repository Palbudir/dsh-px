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
		var import_react = require("react");

		// packages/dsh-px-updater/src/client-data.ts
		async function requestJson(path, init = {}, allowCheckFailure = false) {
		  const controller = new AbortController();
		  const timer = setTimeout(() => controller.abort(), 2e4);
		  try {
		    const response = await fetch(path, {
		      ...init,
		      signal: controller.signal,
		      headers: { accept: "application/json", "x-dsh-px-request": "1", ...init.headers }
		    });
		    const body = await response.json();
		    if (!response.ok && !(allowCheckFailure && response.status === 502 && Array.isArray(body?.errors))) {
		      throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`);
		    }
		    return body;
		  } catch (error) {
		    if (controller.signal.aborted) throw new Error("\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5");
		    if (error instanceof TypeError && /fetch|network/i.test(error.message)) throw new Error("\u65E0\u6CD5\u8FDE\u63A5\u670D\u52A1\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5");
		    throw error;
		  } finally {
		    clearTimeout(timer);
		  }
		}

		// packages/dsh-px-taskflow/src/client.tsx
		var import_jsx_runtime = require("react/jsx-runtime");
		var inject = ["betterSidebar"];
		var card = { border: "1px solid #8884", borderRadius: 10, padding: 12, marginBottom: 12 };
		var labels = { returned: "\u5DF2\u8FD4\u56DE", error: "\u6267\u884C\u5F02\u5E38", interrupted: "\u7ED3\u679C\u672A\u8BB0\u5F55", running: "\u6267\u884C\u4E2D" };
		var states = { working: "\u8FDB\u884C\u4E2D", blocked: "\u9047\u5230\u963B\u788D", ready_for_review: "\u5F85\u68C0\u67E5\u4EA4\u4ED8" };
		function TaskPanel({ scope, visible }) {
		  const [data, setData] = (0, import_react.useState)(null);
		  const [error, setError] = (0, import_react.useState)("");
		  (0, import_react.useEffect)(() => {
		    let active = true;
		    let timer;
		    setData(null);
		    setError("");
		    if (!visible) return;
		    const poll = async () => {
		      try {
		        const value = await requestJson(`/dsh-px-taskflow/review?sessionId=${encodeURIComponent(scope.sessionId)}`);
		        if (active) {
		          setData(value);
		          setError("");
		        }
		      } catch (e) {
		        if (active) setError(e instanceof Error ? e.message : String(e));
		      }
		      if (active) timer = setTimeout(() => void poll(), 2500);
		    };
		    void poll();
		    return () => {
		      active = false;
		      clearTimeout(timer);
		    };
		  }, [scope.sessionId, visible]);
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: 16, height: "100%", overflowY: "auto", minWidth: 0, overflowWrap: "anywhere", fontSize: 13, lineHeight: 1.6 }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: { marginTop: 0 }, children: "\u4EFB\u52A1\u8FDB\u5C55\u4E0E\u4EA4\u4ED8" }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { opacity: 0.65 }, children: "\u5728\u8FD9\u91CC\u6838\u5BF9 Agent \u505A\u8FC7\u4EC0\u4E48\u3001\u4E0B\u4E00\u6B65\u662F\u4EC0\u4E48\u3002\u8BB0\u5F55\u968F\u4F1A\u8BDD\u4FDD\u5B58\uFF0C\u91CD\u65B0\u6253\u5F00\u4ECD\u53EF\u67E5\u770B\u3002" }),
		    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", children: [
		      error,
		      " ",
		      data ? "\u4E0B\u65B9\u662F\u4E0A\u6B21\u8BFB\u53D6\u7684\u8BB0\u5F55\u3002" : "\u6B63\u5728\u91CD\u8BD5\u3002"
		    ] }) : null,
		    !data && !error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u4EFB\u52A1\u8BB0\u5F55\u2026" }) : null,
		    data ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { style: card, "aria-label": "\u4EFB\u52A1\u8BB0\u5F55", children: data.checkpoint ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: states[data.checkpoint.state] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { style: { margin: "8px 0" }, children: data.checkpoint.goal }),
		        data.checkpoint.summary.length > 240 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { style: { cursor: "pointer" }, children: [
		            data.checkpoint.summary.slice(0, 240),
		            "\u2026"
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: data.checkpoint.summary })
		        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: data.checkpoint.summary }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
		          "\u4E0B\u4E00\u6B65\uFF1A",
		          data.checkpoint.nextStep || "\u68C0\u67E5\u4FEE\u6539\u4E0E\u9A8C\u8BC1\u7ED3\u679C"
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { style: { opacity: 0.65 }, children: [
		          "Agent \u5DE5\u4F5C\u8BB0\u5F55 \xB7 ",
		          new Date(data.checkpoint.time).toLocaleString()
		        ] }),
		        data.checkpointStale ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: "\u8BB0\u5F55\u4E4B\u540E\u8FD8\u6709\u65B0\u7684\u6267\u884C\uFF0C\u8BF7\u7ED3\u5408\u4E0B\u65B9\u6267\u884C\u8BB0\u5F55\u5224\u65AD\u5F53\u524D\u8FDB\u5EA6\u3002" }) : null,
		        data.checkpoint.evidence.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "\u5F15\u7528\u7684\u6267\u884C\u8BC1\u636E" }),
		          data.checkpoint.evidence.map((id) => {
		            const call = data.executions.find((c) => c.id === id);
		            return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		              call ? `${labels[call.outcome]} \xB7 ${call.tool} \xB7 ` : "\u8F83\u65E9\u8BB0\u5F55 \xB7 ",
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: id })
		            ] }, id);
		          })
		        ] }) : null
		      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u5C1A\u65E0\u5DE5\u4F5C\u8BB0\u5F55" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u591A\u6B65\u9AA4\u4EFB\u52A1\u5F00\u59CB\u540E\uFF0CAgent \u53EF\u4EE5\u8BB0\u5F55\u76EE\u6807\u3001\u8FDB\u5EA6\u548C\u4EA4\u63A5\u70B9\u3002\u4E0B\u9762\u7684\u6267\u884C\u8BB0\u5F55\u81EA\u52A8\u4EA7\u751F\u3002" })
		      ] }) }),
		      data.changedFiles.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: card, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
		          "\u6587\u4EF6\u64CD\u4F5C\u6D89\u53CA ",
		          data.changedFiles.length,
		          " \u4E2A\u8DEF\u5F84"
		        ] }),
		        data.changedFiles.map((path) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { paddingTop: 6 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: path }) }, path)),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { marginBottom: 0, opacity: 0.65 }, children: "\u6765\u81EA\u6210\u529F\u8FD4\u56DE\u7684\u6587\u4EF6\u5DE5\u5177\u3002\u547D\u4EE4\u884C\u6539\u52A8\u3001\u6700\u7EC8\u5DEE\u5F02\u4E0E\u539F\u6709\u4FEE\u6539\u8BF7\u5728\u6587\u4EF6\u53D8\u52A8\u9762\u677F\u6838\u5BF9\u3002" })
		      ] }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "\u5B9E\u9645\u6267\u884C\u8BB0\u5F55", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h4", { children: [
		          "\u5B9E\u9645\u6267\u884C\u8BB0\u5F55 \xB7 ",
		          data.total
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { opacity: 0.65 }, children: "\u201C\u5DF2\u8FD4\u56DE\u201D\u53EA\u4EE3\u8868\u5DE5\u5177\u6B63\u5E38\u8FD4\u56DE\u3002\u6D4B\u8BD5\u662F\u5426\u901A\u8FC7\u3001\u8986\u76D6\u662F\u5426\u8DB3\u591F\uFF0C\u9700\u8981\u6838\u5BF9\u8F93\u51FA\u3002" }),
		        data.truncated ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u663E\u793A\u6700\u8FD1 80 \u6761\uFF0C\u5176\u4F59\u8BB0\u5F55\u4FDD\u7559\u5728\u4F1A\u8BDD\u4E2D\u3002" }) : null,
		        data.executions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u5F53\u524D\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u5DE5\u5177\u6267\u884C\u8BB0\u5F55\u3002" }) : null,
		        [...data.executions].reverse().map((call) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: card, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { style: { cursor: "pointer" }, children: [
		            labels[call.outcome],
		            " \xB7 ",
		            call.tool,
		            call.durationMs !== null ? ` \xB7 ${(call.durationMs / 1e3).toFixed(1)} \u79D2` : ""
		          ] }),
		          call.input ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { style: { whiteSpace: "pre-wrap", fontSize: 12 }, children: call.input }) : null,
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { style: { whiteSpace: "pre-wrap", fontSize: 12 }, children: call.output || "\u5C1A\u65E0\u8F93\u51FA\u8BB0\u5F55" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
		            "\u8BC1\u636E\u7F16\u53F7\uFF1A",
		            call.id
		          ] })
		        ] }, call.id))
		      ] })
		    ] }) : null
		  ] });
		}
		function apply(ctx) {
		  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-px-taskflow", title: "\u4EFB\u52A1\u8FDB\u5C55", description: "\u76EE\u6807\u3001\u4EA4\u63A5\u70B9\u4E0E\u5B9E\u9645\u6267\u884C\u8BC1\u636E", order: 15, single: true, icon: "\u2713", component: TaskPanel }), "taskflow: task panel");
		}

		return module.exports;
	}
});
