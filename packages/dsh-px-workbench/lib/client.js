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
		var import_react = require("react");

		// packages/dsh-px-updater/src/client-data.ts
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
		  const timer = setTimeout(() => controller.abort(), 2e4);
		  try {
		    const response = await fetch(path, {
		      ...init,
		      signal: controller.signal,
		      headers: { accept: "application/json", "x-dsh-px-request": "1", ...init.headers }
		    });
		    const body = await response.json();
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
		    if (controller.signal.aborted) throw new Error("\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5");
		    if (error instanceof TypeError && /fetch|network/i.test(error.message)) throw new Error("\u65E0\u6CD5\u8FDE\u63A5\u670D\u52A1\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5");
		    throw error;
		  } finally {
		    clearTimeout(timer);
		  }
		}

		// packages/dsh-px-workbench/src/client.tsx
		var import_jsx_runtime = require("react/jsx-runtime");
		var inject = ["slots", "locale"];
		var prefix = "/dsh-px-workbench";
		var button = { border: "1px solid currentColor", borderRadius: 8, padding: "7px 12px", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 13 };
		var card = { border: "1px solid #8884", borderRadius: 12, padding: 16, minWidth: 0 };
		var prompts = [
		  { title: "\u719F\u6089\u9879\u76EE", text: "\u5148\u9605\u8BFB\u5F53\u524D\u5DE5\u4F5C\u533A\u7684\u8BF4\u660E\u548C\u4EE3\u7801\uFF0C\u89E3\u91CA\u9879\u76EE\u7684\u7528\u9014\u3001\u8FD0\u884C\u65B9\u5F0F\u4E0E\u6700\u503C\u5F97\u4FEE\u590D\u7684\u4E00\u4E2A\u95EE\u9898\u3002\u8BF7\u7ED9\u51FA\u6587\u4EF6\u4F9D\u636E\uFF0C\u8FD9\u4E00\u6B65\u5148\u4E0D\u8981\u4FEE\u6539\u4EE3\u7801\u3002" },
		  { title: "\u5B8C\u6210\u4E00\u6B21\u4FEE\u6539", text: "\u5728\u5F53\u524D\u5DE5\u4F5C\u533A\u5B8C\u6210\u4E0B\u9762\u7684\u4FEE\u6539\uFF1A[\u586B\u5199\u9700\u6C42]\u3002\u5148\u8BFB\u9879\u76EE\u7EA6\u5B9A\uFF0C\u8BF4\u660E\u5F71\u54CD\u8303\u56F4\uFF0C\u518D\u5B9E\u73B0\u5E76\u8FD0\u884C\u76F8\u5173\u9A8C\u8BC1\uFF1B\u6700\u540E\u5217\u51FA\u4FEE\u6539\u6587\u4EF6\u3001\u9A8C\u8BC1\u7ED3\u679C\u548C\u672A\u89E3\u51B3\u7684\u95EE\u9898\u3002" },
		  { title: "\u9A8C\u8BC1\u5DE5\u5177\u53EF\u7528", text: "\u5728\u5F53\u524D\u5DE5\u4F5C\u533A\u521B\u5EFA agent-smoke.txt\uFF0C\u5199\u5165 DSH-PX agent smoke OK\u3002\u5FC5\u987B\u5B9E\u9645\u8C03\u7528\u6587\u4EF6\u5DE5\u5177\u5199\u5165\uFF0C\u518D\u7528 Shell \u8BFB\u53D6\u9A8C\u8BC1\uFF0C\u62A5\u544A\u5B9E\u9645\u8DEF\u5F84\u4E0E\u8BFB\u53D6\u5185\u5BB9\u3002\u4E0D\u8981\u4FEE\u6539\u5176\u4ED6\u6587\u4EF6\u3002" }
		];
		function Workbench() {
		  const [data, setData] = (0, import_react.useState)(null);
		  const [error, setError] = (0, import_react.useState)(null);
		  const [busy, setBusy] = (0, import_react.useState)(false);
		  const [message, setMessage] = (0, import_react.useState)("");
		  const [confirm, setConfirm] = (0, import_react.useState)(false);
		  const [restarting, setRestarting] = (0, import_react.useState)(false);
		  const [path, setPath] = (0, import_react.useState)("");
		  const [adding, setAdding] = (0, import_react.useState)(false);
		  const [workspaceMessage, setWorkspaceMessage] = (0, import_react.useState)("");
		  const [networkCheck, setNetworkCheck] = (0, import_react.useState)(null);
		  const [networkBusy, setNetworkBusy] = (0, import_react.useState)(false);
		  const [networkError, setNetworkError] = (0, import_react.useState)("");
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
		      const result = await requestJson(`${prefix}/workspace?path=${encodeURIComponent(path.trim())}`, { method: "POST" });
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
		  (0, import_react.useEffect)(() => {
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
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gap: 16, minWidth: 0, overflowWrap: "anywhere", paddingBottom: 20 }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: { margin: "0 0 8px" }, children: "\u8FD0\u884C\u4E0E\u5E2E\u52A9" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: 0, opacity: 0.7, lineHeight: 1.7 }, children: "\u4ECE\u5DE5\u4F5C\u533A\u5F00\u59CB\uFF0C\u8BA9 Agent \u8BFB\u53D6\u6587\u4EF6\u3001\u6267\u884C\u5DE5\u5177\u5E76\u4EA4\u4ED8\u53EF\u68C0\u67E5\u7684\u7ED3\u679C\u3002" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: card, "aria-label": "\u5F00\u59CB\u4EFB\u52A1", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: { marginTop: 0 }, children: "\u5F00\u59CB\u4E00\u4E2A\u4EFB\u52A1" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", { style: { paddingLeft: 22, lineHeight: 1.9 }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "\u5728\u8BBE\u7F6E\u7684\u6A21\u578B\u63D0\u4F9B\u5546\u4E2D\u914D\u7F6E\u6A21\u578B\u548C\u5BC6\u94A5\u3002" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "\u5173\u95ED\u8BBE\u7F6E\uFF0C\u5728\u4FA7\u680F\u6DFB\u52A0\u672C\u673A\u9879\u76EE\u6587\u4EF6\u5939\uFF0C\u518D\u65B0\u5EFA\u4F1A\u8BDD\u3002" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "\u9009\u62E9\u6807\u51C6\u6A21\u5F0F\u4E0E\u6A21\u578B\uFF0C\u63CF\u8FF0\u9700\u6C42\uFF1B\u6309\u63D0\u793A\u5BA1\u9605\u5DE5\u5177\u6743\u9650\u548C\u4FEE\u6539\u7ED3\u679C\u3002" })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: "dsh-px-workspace", style: { fontSize: 13 }, children: "\u672C\u673A\u9879\u76EE\u6587\u4EF6\u5939" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0 16px" }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: "dsh-px-workspace", value: path, placeholder: "C:\\Projects\\demo", onChange: (e) => setPath(e.target.value), style: { ...button, minWidth: 0, flex: "1 1 240px", cursor: "text" } }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, disabled: adding || !path.trim(), onClick: () => void addWorkspace(), children: adding ? "\u6DFB\u52A0\u4E2D\u2026" : "\u6DFB\u52A0\u5DE5\u4F5C\u533A" })
		      ] }),
		      workspaceMessage ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", style: { fontSize: 13 }, children: workspaceMessage }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: prompts.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { style: button, onClick: () => {
		        void navigator.clipboard.writeText(p.text).then(() => setMessage(`\u5DF2\u590D\u5236\u201C${p.title}\u201D\uFF0C\u7C98\u8D34\u5230\u65B0\u4F1A\u8BDD\u5373\u53EF\u3002`)).catch(() => setMessage(`\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u590D\u5236\uFF1A${p.text}`));
		      }, children: [
		        "\u590D\u5236\uFF1A",
		        p.title
		      ] }, p.title)) }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { fontSize: 12, opacity: 0.65, marginBottom: 0 }, children: "\u9996\u6B21\u9A8C\u8BC1\u5EFA\u8BAE\u4F7F\u7528\u7A7A\u6587\u4EF6\u5939\u3002\u6A21\u578B\u80FD\u5426\u8FDE\u63A5\u4EE5\u771F\u5B9E\u4EFB\u52A1\u7ED3\u679C\u4E3A\u51C6\u3002" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: card, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { style: { cursor: "pointer" }, children: "\u672C\u673A\u8FD0\u884C\u8BCA\u65AD\u4E0E\u670D\u52A1\u6062\u590D" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "\u672C\u673A\u8FD0\u884C\u68C0\u67E5", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "\u672C\u673A\u8FD0\u884C\u68C0\u67E5" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, disabled: busy, onClick: () => void refresh(), children: busy ? "\u68C0\u67E5\u4E2D\u2026" : "\u91CD\u65B0\u68C0\u67E5" })
		        ] }),
		        error ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", children: [
		          "\u68C0\u67E5\u5931\u8D25\uFF1A",
		          error,
		          "\u3002\u53EF\u91CD\u65B0\u68C0\u67E5\uFF0C\u6216\u5230\u684C\u9762\u7A97\u53E3\u6062\u590D\u670D\u52A1\u3002"
		        ] }) : null,
		        !data ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u672C\u673A\u72B6\u6001\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", { style: { display: "grid", gridTemplateColumns: "100px minmax(0,1fr)", gap: "10px 12px", fontSize: 13, lineHeight: 1.6 }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Agent \u670D\u52A1" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", { style: { margin: 0 }, children: [
		              error ? "\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u4EE5\u4E0B\u4E3A\u4E0A\u6B21\u68C0\u67E5\u7ED3\u679C" : "\u5DF2\u8FDE\u63A5",
		              " \xB7 \u542F\u52A8\u4E8E ",
		              new Date(data.startedAt).toLocaleTimeString()
		            ] }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "\u684C\u9762\u5916\u58F3" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { style: { margin: 0 }, children: data.service?.message ?? "\u672A\u8FDE\u63A5\uFF08\u53EF\u7EE7\u7EED\u4F7F\u7528\u6D4F\u89C8\u5668\u4E2D\u7684 Agent\uFF09" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Node" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", { style: { margin: 0 }, children: [
		              data.node.version,
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
		              data.node.path
		            ] }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "\u6570\u636E\u76EE\u5F55" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", { style: { margin: 0 }, children: [
		              data.home ?? "\u672A\u77E5",
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
		              data.writable ? "\u76EE\u5F55\u6743\u9650\u5141\u8BB8\u5199\u5165" : "\u76EE\u5F55\u4E0D\u53EF\u5199\uFF0C\u8BF7\u68C0\u67E5\u6743\u9650"
		            ] }),
		            data.tools.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "contents" }, children: [
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t.name }),
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { style: { margin: 0 }, children: t.path ? `\u5DF2\u627E\u5230\uFF1A${t.path}` : "PATH \u4E2D\u672A\u627E\u5230\uFF0C\u8BF7\u5B89\u88C5\u6216\u8C03\u6574\u672C\u673A\u73AF\u5883\u540E\u91CD\u542F" })
		            ] }, t.name)),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "\u6A21\u578B\u51ED\u636E" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { style: { margin: 0 }, children: data.credentialsFile ? "\u5B58\u5728\u51ED\u636E\u6587\u4EF6\uFF0C\u8FDE\u63A5\u80FD\u529B\u9700\u5B9E\u9645\u8FD0\u884C\u4EFB\u52A1\u9A8C\u8BC1" : "\u672A\u53D1\u73B0\u51ED\u636E\u6587\u4EF6\uFF0C\u8BF7\u5728\u6A21\u578B\u8BBE\u7F6E\u4E2D\u914D\u7F6E\uFF08\u73AF\u5883\u53D8\u91CF\u914D\u7F6E\u4E5F\u53EF\u80FD\u53EF\u7528\uFF09" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "\u7F51\u9875\u7F51\u7EDC" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", { style: { margin: 0 }, children: [
		              data.network?.message ?? "\u5C1A\u65E0\u684C\u9762\u7F51\u7EDC\u8BCA\u65AD\u3002\u53EF\u6267\u884C\u4E0B\u65B9\u7F51\u9875\u8BFB\u53D6\u68C0\u67E5\u3002",
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "\u4EE3\u7406\u8BBE\u7F6E\u5728\u670D\u52A1\u542F\u52A8\u65F6\u751F\u6548\uFF1B\u7CFB\u7EDF\u4EE3\u7406\u6539\u53D8\u540E\u9700\u91CD\u542F\u670D\u52A1\u3002" })
		            ] })
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "\u7F51\u9875\u8BFB\u53D6\u68C0\u67E5", style: { margin: "16px 0" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, disabled: networkBusy || Boolean(error), onClick: () => void checkNetwork(), children: networkBusy ? "\u6B63\u5728\u8BFB\u53D6\u516C\u5F00\u6587\u6863\u2026" : "\u68C0\u67E5\u7F51\u9875\u8BFB\u53D6" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { fontSize: 12, opacity: 0.7 }, children: "\u4F7F\u7528 Agent \u540C\u4E00\u7F51\u9875\u670D\u52A1\u8BFB\u53D6 Node.js \u4E0E TypeScript \u5B98\u65B9\u6587\u6863\uFF0C\u4E0D\u8C03\u7528\u6A21\u578B\u3002" }),
		            networkError ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", children: [
		              networkError,
		              networkCheck ? " \u4E0B\u65B9\u4E3A\u4E0A\u6B21\u68C0\u67E5\u7ED3\u679C\u3002" : ""
		            ] }) : null,
		            networkCheck ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "status", children: [
		              networkCheck.checks.map((check) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 8 }, children: [
		                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: check.ok ? "\u53EF\u8BFB\u53D6" : "\u672A\u901A\u8FC7" }),
		                " \xB7 ",
		                check.message,
		                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: check.url }) }),
		                check.ok ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
		                  "HTTP ",
		                  check.status,
		                  " \xB7 \u5DF2\u53D6\u5F97 ",
		                  check.chars,
		                  " \u5B57\u7B26",
		                  check.truncated ? "\uFF08\u670D\u52A1\u5DF2\u622A\u65AD\uFF09" : ""
		                ] }) : null
		              ] }, check.url)),
		              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
		                "\u68C0\u67E5\u4E8E ",
		                new Date(networkCheck.checkedAt).toLocaleString()
		              ] })
		            ] }) : null
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, disabled: !data.canRestart || Boolean(error) || restarting, onClick: () => setConfirm(true), children: "\u91CD\u542F\u672C\u673A\u670D\u52A1" }) }),
		          confirm ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "alert", style: { marginTop: 12 }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u91CD\u542F\u4F1A\u4E2D\u65AD\u6B63\u5728\u6267\u884C\u7684\u4EFB\u52A1\u3002\u8BF7\u5148\u7B49\u5F85\u4EFB\u52A1\u7ED3\u675F\uFF1B\u5DF2\u6709\u4F1A\u8BDD\u4E0E\u914D\u7F6E\u4F1A\u4FDD\u7559\u3002" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, disabled: restarting, onClick: () => void restart(), children: "\u786E\u8BA4\u91CD\u542F" }),
		            " ",
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: () => setConfirm(false), children: "\u53D6\u6D88" })
		          ] }) : null,
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: { fontSize: 12, opacity: 0.6 }, children: [
		            "\u68C0\u67E5\u65F6\u95F4\uFF1A",
		            new Date(data.checkedAt).toLocaleString(),
		            " \xB7 \u5DE5\u5177\u8DEF\u5F84\u68C0\u67E5\u4E0D\u4EE3\u8868\u547D\u4EE4\u5DF2\u6267\u884C\u6210\u529F\u3002"
		          ] })
		        ] })
		      ] })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: card, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { style: { cursor: "pointer" }, children: "\u9AD8\u7EA7\uFF1A\u63D2\u4EF6\u8BCA\u65AD\u6E05\u5355" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "\u63D2\u4EF6\u6E05\u5355", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: { marginTop: 0 }, children: "\u5F53\u524D Profile \u7684\u63D2\u4EF6" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { fontSize: 12, opacity: 0.7 }, children: "\u6CBF\u7528 DSH \u63D2\u4EF6\u5E02\u573A\u7BA1\u7406\u63D2\u4EF6\u3002\u5B89\u88C5\u6216\u66F4\u6539\u7EC4\u5408\u5305\u540E\u91CD\u542F\u670D\u52A1\u751F\u6548\uFF1B\u8FD9\u91CC\u663E\u793A\u5B89\u88C5\u4E0E\u6E05\u5355\u72B6\u6001\uFF0C\u4E0D\u4EE3\u8868\u6BCF\u4E2A\u63D2\u4EF6\u8FD0\u884C\u6B63\u5E38\u3002" }),
		        data?.profileError ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", children: [
		          "\u65E0\u6CD5\u8BFB\u53D6\u63D2\u4EF6\u6E05\u5355\uFF1A",
		          data.profileError
		        ] }) : null,
		        data?.plugins.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "10px 0", borderTop: "1px solid #8883", fontSize: 13 }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: p.name }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { opacity: 0.7, marginTop: 4 }, children: [
		            p.version ?? "\u672A\u5B89\u88C5\u6216\u5305\u4E0D\u53EF\u8BFB",
		            " \xB7 ",
		            p.enabled ? "\u5DF2\u52A0\u5165\u7EC4\u5408\u5305" : "\u672A\u52A0\u5165\u7EC4\u5408\u5305"
		          ] })
		        ] }, p.name)),
		        data && !data.profileError && data.plugins.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6B64 Profile \u6682\u65E0\u989D\u5916\u63D2\u4EF6\u3002" }) : null
		      ] })
		    ] }),
		    message ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", style: { ...card, margin: 0 }, children: message }) : null
		  ] });
		}
		function apply(ctx) {
		  ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "dsh-px-workbench", order: 110, label: "\u8FD0\u884C\u4E0E\u5E2E\u52A9" }, Workbench));
		}

		return module.exports;
	}
});
