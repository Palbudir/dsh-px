window.__ModuleLoader__.load({
	id: "dsh-px-workspace",
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

		// packages/dsh-px-workspace/src/client.tsx
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

		// packages/dsh-px-workspace/src/model.ts
		function quoteDraft(a) {
		  return `\u5F15\u7528\u5386\u53F2\u5185\u5BB9\uFF08\u6765\u6E90 ${a.sessionId}\uFF0C\u8BB0\u5F55 ${a.seq}\uFF1B\u4EE5\u4E0B\u662F\u80CC\u666F\u8D44\u6599\uFF09\uFF1A
		${a.quote.split("\n").map((line) => "> " + line).join("\n")}

		${a.note ? "\u6211\u7684\u6279\u6CE8\uFF1A" + a.note + "\n" : ""}`;
		}

		// packages/dsh-px-workspace/src/client-input.ts
		function insertQuote(ctx, target, note) {
		  const actx = ctx.sessions.scope(target);
		  if (!actx) throw new Error("\u8BF7\u5148\u6253\u5F00\u76EE\u6807\u4F1A\u8BDD");
		  const input = ctx.conversation.input.for(actx), state = input.state.getSnapshot();
		  if (state.phase !== "plain") throw new Error("\u8F93\u5165\u6846\u6B63\u5728\u63D0\u4EA4\u6216\u5904\u4E8E\u547D\u4EE4\u6A21\u5F0F\uFF0C\u8BF7\u7A0D\u540E\u5F15\u7528");
		  const accepted = actx.bail(actx, "slash/input-insert-text", { text: (state.draft ? "\n\n" : "") + quoteDraft(note), span: { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev } });
		  if (accepted !== true) throw new Error("\u8F93\u5165\u6846\u5C1A\u672A\u5C31\u7EEA\u6216\u8349\u7A3F\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5");
		  input.notify("info", "\u5F15\u7528\u5DF2\u52A0\u5165\u8349\u7A3F\uFF0C\u8BF7\u68C0\u67E5\u540E\u53D1\u9001\u3002");
		}

		// packages/dsh-px-workspace/src/client.tsx
		var import_jsx_runtime = require("react/jsx-runtime");
		var inject = ["slots", "sessions", "uiWorkspace", "conversation", "betterSidebar"];
		var base = "/dsh-px-workspace";
		var errorText = (e) => e instanceof Error ? e.message : String(e);
		var stamp = (time) => time === null ? "\u5DF2\u6682\u505C" : new Date(time).toLocaleString();
		var post = (route, value) => requestJson(`${base}/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
		var quoteSelections = {};
		var quoteRevision = 0;
		var quoteListeners = /* @__PURE__ */ new Set();
		var quoteRequests = { getSnapshot: () => quoteSelections, subscribe: (cb) => {
		  quoteListeners.add(cb);
		  return () => {
		    quoteListeners.delete(cb);
		  };
		} };
		function requestQuote(sessionId, messageId) {
		  quoteSelections = { ...quoteSelections, [sessionId]: { messageId, revision: ++quoteRevision } };
		  for (const cb of quoteListeners) cb();
		}
		function useSnapshot(store) {
		  const [value, set] = (0, import_react.useState)(store.getSnapshot);
		  (0, import_react.useEffect)(() => {
		    const refresh = () => set(store.getSnapshot());
		    refresh();
		    return store.subscribe(refresh);
		  }, [store]);
		  return value;
		}
		function useData(url, enabled) {
		  const [data, set] = (0, import_react.useState)(null), [error, setError] = (0, import_react.useState)(""), [revision, revise] = (0, import_react.useState)(0);
		  (0, import_react.useEffect)(() => {
		    let alive = true, timer;
		    set(null);
		    setError("");
		    if (!enabled) return;
		    const read = async () => {
		      try {
		        const value = await requestJson(url);
		        if (alive) {
		          set(value);
		          setError("");
		        }
		      } catch (e) {
		        if (alive) setError(errorText(e));
		      }
		      if (alive) timer = setTimeout(() => void read(), 5e3);
		    };
		    void read();
		    return () => {
		      alive = false;
		      clearTimeout(timer);
		    };
		  }, [url, enabled, revision]);
		  return { data, error, refresh: () => revise((n) => n + 1) };
		}
		var css = `
		body[data-dsh-px-workspace] div:has(> [data-shell-overlay]){padding-top:82px;box-sizing:border-box}
		body[data-dsh-px-workspace] div[data-rightbar-fullscreen]:has(> [data-shell-overlay]){padding-top:0}
		[data-rightbar-fullscreen] .px-bar{display:none}
		.px-bar{position:absolute;left:0;right:0;top:0;height:82px;box-sizing:border-box;pointer-events:auto;background:var(--dsw-alias-bg-base,#fff);border-bottom:1px solid #8883;color:inherit;font-size:12px;display:flex;flex-direction:column;padding:4px 10px;gap:4px}
		.px-tabs,.px-tools,.px-actions{display:flex;align-items:center;gap:6px;min-width:0}
		.px-tabs{height:37px}.px-tabstrip{display:flex;flex:1;overflow:auto;gap:4px;min-width:60px}
		.px-tab{display:flex;align-items:center;flex:none;max-width:230px;border:1px solid #8883;border-radius:7px;background:#8881}
		.px-tab[data-active=true]{border-color:#4b7fe9;background:#4b7fe917}.px-tab>button{border:0;background:transparent;padding:6px;white-space:nowrap}
		.px-tab>button[role=tab]{overflow:hidden;text-overflow:ellipsis;max-width:175px}.px-tab>button:focus-visible{outline:2px solid #4b7fe9}
		.px-tools{height:31px;overflow-x:auto;flex:none}.px-status{margin-left:auto;white-space:nowrap;opacity:.65}
		.px-bar button,.px-panel button,.px-quote-action{font:inherit;color:inherit;cursor:pointer;border:1px solid #8885;border-radius:6px;padding:4px 8px;background:transparent;white-space:nowrap}
		.px-bar button:disabled,.px-panel button:disabled{opacity:.45;cursor:default}.px-bar select{color:inherit;background:var(--dsw-alias-bg-base,#fff);border:1px solid #8885;border-radius:6px;max-width:135px;padding:4px}
		.px-panel{font-size:13px;line-height:1.6;padding:16px;height:100%;overflow:auto;overflow-wrap:anywhere;box-sizing:border-box}
		.px-panel h3{margin:0 0 8px}.px-panel h4{margin:4px 0}.px-muted{opacity:.65;font-size:12px}.px-card{border:1px solid #8884;border-radius:9px;padding:12px;margin:10px 0}
		.px-panel textarea,.px-panel input,.px-panel select{box-sizing:border-box;display:block;width:100%;font:inherit;color:inherit;background:var(--dsw-alias-bg-base,#fff);border:1px solid #8886;border-radius:6px;padding:7px;margin:4px 0 10px}
		.px-panel textarea{resize:vertical;min-height:75px}.px-panel label{display:block}.px-panel label.px-check{display:flex;gap:6px;align-items:center}.px-panel input[type=checkbox]{display:inline;width:auto;margin:0}
		.px-panel pre,.px-panel blockquote{white-space:pre-wrap;margin:8px 0;max-height:240px;overflow:auto;font:inherit}.px-panel blockquote{border-left:3px solid #4b7fe9;padding-left:10px}
		.px-panel [role=alert]{color:var(--dsw-alias-text-error,#c34747)}.px-actions{flex-wrap:wrap;margin:6px 0}.px-primary{background:#4b7fe915!important;border-color:#4b7fe9!important}
		@media(max-width:800px){.px-status{display:none}.px-tabs>select{max-width:95px}.px-bar{padding-left:5px;padding-right:5px}}
		`;
		var tabKey = "dsh-px.session-tabs.v1";
		function loadTabs() {
		  try {
		    const p = JSON.parse(localStorage.getItem(tabKey) ?? "{}");
		    const ids = (v) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && /^[\w-]{1,200}$/.test(x)))].slice(0, 60) : [];
		    return { ids: ids(p.ids), pins: ids(p.pins), closed: ids(p.closed).slice(0, 10) };
		  } catch {
		    return { ids: [], pins: [], closed: [] };
		  }
		}
		function SessionBar({ ctx }) {
		  const sessions = useSnapshot(ctx.sessions.list), [tabs, setTabs] = (0, import_react.useState)(loadTabs), [error, setError] = (0, import_react.useState)("");
		  const current = sessions.current;
		  (0, import_react.useEffect)(() => {
		    if (!current) return;
		    setTabs((old) => old.ids.includes(current) ? old : { ...old, ids: [...old.ids, current], closed: old.closed.filter((id) => id !== current) });
		  }, [current]);
		  (0, import_react.useEffect)(() => {
		    try {
		      localStorage.setItem(tabKey, JSON.stringify(tabs));
		    } catch {
		      setError("\u65E0\u6CD5\u4FDD\u5B58\u6807\u7B7E\u72B6\u6001\uFF1B\u672C\u6B21\u6253\u5F00\u7684\u6807\u7B7E\u4ECD\u53EF\u4F7F\u7528\u3002");
		    }
		  }, [tabs]);
		  const open = (id) => {
		    try {
		      ctx.uiWorkspace.openSession(id);
		      setError("");
		    } catch (e) {
		      setError(errorText(e));
		    }
		  };
		  const close = (id) => {
		    const index = tabs.ids.indexOf(id), remaining = tabs.ids.filter((x) => x !== id);
		    setTabs((old) => ({ ids: old.ids.filter((x) => x !== id), pins: old.pins.filter((x) => x !== id), closed: [id, ...old.closed.filter((x) => x !== id)].slice(0, 10) }));
		    if (id === current) {
		      const next = remaining.slice(index).concat(remaining.slice(0, index).reverse()).find((x) => sessions.byId[x]);
		      if (next) open(next);
		      else ctx.sessions.clear();
		    }
		  };
		  const reopen = () => {
		    const id = tabs.closed.find((id2) => sessions.byId[id2]);
		    if (id) open(id);
		  };
		  (0, import_react.useEffect)(() => {
		    const keydown = (e) => {
		      if (!e.ctrlKey || !e.altKey || document.querySelector("[role=dialog],[role=alertdialog]")) return;
		      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
		        const ids2 = tabs.ids.filter((id) => sessions.byId[id]), at = ids2.indexOf(current ?? "");
		        if (!ids2.length) return;
		        e.preventDefault();
		        open(ids2[(at + (e.key === "ArrowRight" ? 1 : -1) + ids2.length) % ids2.length]);
		      } else if (e.key.toLowerCase() === "t") {
		        e.preventDefault();
		        reopen();
		      }
		    };
		    window.addEventListener("keydown", keydown);
		    return () => window.removeEventListener("keydown", keydown);
		  }, [tabs, current, sessions]);
		  const scope = current ? { sessionId: current, cwd: sessions.byId[current]?.cwd } : void 0;
		  const panel = (type, bottom = false) => {
		    if (!scope) return;
		    try {
		      ctx.betterSidebar.openTab({ type, ...bottom ? { target: "bottom" } : {} }, scope);
		      setError("");
		    } catch (e) {
		      setError(errorText(e));
		    }
		  };
		  const ids = [...tabs.ids.filter((id) => tabs.pins.includes(id)), ...tabs.ids.filter((id) => !tabs.pins.includes(id))];
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-bar", "aria-label": "DSH-PX \u4F1A\u8BDD\u5DE5\u4F5C\u533A", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-tabs", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: { flex: "none", padding: "0 5px" }, children: "DSH-PX" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "px-tabstrip", role: "tablist", "aria-label": "\u5DF2\u6253\u5F00\u4F1A\u8BDD", children: ids.map((id) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-tab", "data-active": id === current, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { role: "tab", "aria-selected": id === current, disabled: !sessions.byId[id], title: `${sessions.byId[id]?.displayTitle ?? "\u6682\u4E0D\u53EF\u7528\u7684\u4F1A\u8BDD"} \xB7 Ctrl+Alt+\u65B9\u5411\u952E\u5207\u6362`, onClick: () => open(id), children: [
		          sessions.byId[id]?.running ? "\u25C9 " : sessions.byId[id]?.completed ? "\u2713 " : "",
		          sessions.byId[id]?.displayTitle ?? id
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { title: tabs.pins.includes(id) ? "\u53D6\u6D88\u56FA\u5B9A" : "\u56FA\u5B9A\u6807\u7B7E", "aria-label": `${tabs.pins.includes(id) ? "\u53D6\u6D88\u56FA\u5B9A" : "\u56FA\u5B9A"} ${sessions.byId[id]?.displayTitle ?? id}`, onClick: () => setTabs((old) => ({ ...old, pins: old.pins.includes(id) ? old.pins.filter((x) => x !== id) : [...old.pins, id] })), children: tabs.pins.includes(id) ? "\u25C6" : "\u25C7" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { title: "\u5173\u95ED\u6807\u7B7E\uFF08\u4EFB\u52A1\u7EE7\u7EED\u8FD0\u884C\uFF09", "aria-label": `\u5173\u95ED\u6807\u7B7E ${sessions.byId[id]?.displayTitle ?? id}`, onClick: () => close(id), children: "\xD7" })
		      ] }, id)) }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => ctx.uiWorkspace.startSession(), title: "\u5728\u5F53\u524D\u5DE5\u4F5C\u533A\u65B0\u5EFA\u4F1A\u8BDD", children: "\uFF0B \u65B0\u4F1A\u8BDD" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": "\u6253\u5F00\u5DF2\u6709\u4F1A\u8BDD", value: "", onChange: (e) => open(e.target.value), children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u6253\u5F00\u4F1A\u8BDD\u2026" }),
		        sessions.ids.filter((id) => sessions.byId[id]?.origin !== "subagent").map((id) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: id, children: sessions.byId[id].displayTitle }, id))
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: !tabs.closed.some((id) => sessions.byId[id]), onClick: reopen, title: "\u6062\u590D\u6700\u8FD1\u5173\u95ED\u7684\u6807\u7B7E \xB7 Ctrl+Alt+T", children: "\u21B6" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-tools", children: [
		      [["editor", "\u6587\u4EF6"], ["terminal", "\u7EC8\u7AEF"], ["px-artifacts", "\u4EA7\u7269"], ["git", "\u53D8\u66F4"], ["subagent", "\u540E\u53F0\u4EFB\u52A1"], ["px-notes", "\u5F15\u7528\u4E0E\u6279\u6CE8"], ["px-schedules", "\u5B9A\u65F6\u4EFB\u52A1"]].map(([type, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: !scope, onClick: () => panel(type, type === "terminal"), children: label }, type)),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "px-status", role: error ? "alert" : "status", children: error || (current ? sessions.byId[current]?.running ? "Agent \u6B63\u5728\u6267\u884C \xB7 \u53EF\u5207\u6362\u4F1A\u8BDD" : "\u5173\u95ED\u6807\u7B7E\u4F1A\u4FDD\u7559\u4F1A\u8BDD\u4E0E\u540E\u53F0\u4EFB\u52A1" : "\u9009\u62E9\u6216\u65B0\u5EFA\u4E00\u4E2A\u4F1A\u8BDD\u5F00\u59CB") })
		    ] })
		  ] });
		}
		function ArtifactsPanel({ ctx, scope, visible }) {
		  const { data, error, refresh } = useData(`${base}/content?sessionId=${encodeURIComponent(scope.sessionId)}`, visible);
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-panel", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "\u4F1A\u8BDD\u4EA7\u7269" }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "px-muted", children: "\u6C47\u603B Agent \u4F7F\u7528 present \u58F0\u660E\u7684\u4EA4\u4ED8\u3002\u6253\u5F00\u7684\u662F\u6587\u4EF6\u5F53\u524D\u5185\u5BB9\uFF1B\u539F\u6587\u4EF6\u79FB\u52A8\u6216\u5220\u9664\u540E\u9700\u8981\u91CD\u65B0\u5B9A\u4F4D\u3002" }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: refresh, children: "\u5237\u65B0\u4EA7\u7269" }),
		    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: error }) : null,
		    !data && !error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u2026" }) : null,
		    data?.artifacts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u5C1A\u65E0\u5DF2\u58F0\u660E\u7684\u4EA7\u7269\u3002\u53EF\u4EE5\u8BA9 Agent \u5B8C\u6210\u4EFB\u52A1\u540E\u4F7F\u7528 present \u4EA4\u4ED8\u6587\u4EF6\u3002" }) : null,
		    data?.artifacts.map((a) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "px-card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: a.path.split(/[\\/]/).pop() }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: a.description || "\u672A\u586B\u5199\u8BF4\u660E" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "px-muted", children: [
		        a.path,
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
		        stamp(a.time)
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => ctx.betterSidebar.openFile(scope, a.path), children: "\u6253\u5F00\u4EA7\u7269" })
		    ] }, a.path))
		  ] });
		}
		function NotesPanel({ ctx, scope, visible, tab }) {
		  const selection = useSnapshot(quoteRequests)[scope.sessionId];
		  const [before, setBefore] = (0, import_react.useState)(null);
		  const { data, error, refresh } = useData(`${base}/content?sessionId=${encodeURIComponent(scope.sessionId)}${before === null ? "" : "&before=" + before}`, visible);
		  const notes = useData(`${base}/annotations?sessionId=${encodeURIComponent(scope.sessionId)}`, visible);
		  const [source, setSource] = (0, import_react.useState)(null), [quote, setQuote] = (0, import_react.useState)(""), [note, setNote] = (0, import_react.useState)(""), [editing, setEditing] = (0, import_react.useState)(null);
		  const [notice, setNotice] = (0, import_react.useState)(""), [failure, setFailure] = (0, import_react.useState)(""), [busy, setBusy] = (0, import_react.useState)(false);
		  const revision = (0, import_react.useRef)(0);
		  async function choose(id, existing = null, offset = 0) {
		    const rev = ++revision.current;
		    setBusy(true);
		    setFailure("");
		    setNotice("");
		    try {
		      const value = await requestJson(`${base}/message?sessionId=${encodeURIComponent(scope.sessionId)}&messageId=${encodeURIComponent(id)}&offset=${offset}`);
		      if (rev !== revision.current) return;
		      setSource(value);
		      setEditing(existing);
		      setQuote(existing?.quote ?? value.text.slice(0, 8e3));
		      setNote(existing?.note ?? "");
		    } catch (e) {
		      if (rev === revision.current) setFailure(errorText(e));
		    } finally {
		      if (rev === revision.current) setBusy(false);
		    }
		  }
		  (0, import_react.useEffect)(() => {
		    const id = selection?.messageId ?? tab.meta?.messageId;
		    if (id) void choose(id);
		  }, [selection, tab.meta?.messageId]);
		  const draft = source ? { sessionId: scope.sessionId, messageId: source.id, seq: source.seq, quote, note } : null;
		  const validQuote = !!quote && (!!source?.text.includes(quote) || editing?.quote === quote);
		  async function action(fn, success) {
		    setBusy(true);
		    setFailure("");
		    setNotice("");
		    try {
		      await fn();
		      notes.refresh();
		      setNotice(success);
		    } catch (e) {
		      setFailure(errorText(e));
		    } finally {
		      setBusy(false);
		    }
		  }
		  function insert(a) {
		    try {
		      insertQuote(ctx, scope.sessionId, a);
		      setFailure("");
		      setNotice("\u5DF2\u52A0\u5165\u8349\u7A3F\uFF0C\u68C0\u67E5\u540E\u53D1\u9001\u3002");
		    } catch (e) {
		      setFailure(errorText(e));
		    }
		  }
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-panel", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "\u5F15\u7528\u4E0E\u6279\u6CE8" }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "px-muted", children: "\u9009\u62E9\u7528\u6237\u6216\u52A9\u624B\u6B63\u6587\uFF0C\u4FDD\u5B58\u539F\u6587\u7247\u6BB5\u4E0E\u6279\u6CE8\u3002\u6279\u6CE8\u4FDD\u5B58\u5728\u672C\u673A\uFF0C\u70B9\u51FB\u5F15\u7528\u624D\u4F1A\u52A0\u5165\u8F93\u5165\u6846\u3002" }),
		    failure || error || notes.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: failure || error || notes.error }) : null,
		    notice ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: notice }) : null,
		    source ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "px-card", "aria-label": "\u6279\u6CE8\u7F16\u8F91\u5668", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h4", { children: [
		        source.role === "user" ? "\u7528\u6237" : "\u52A9\u624B",
		        " \xB7 \u8BB0\u5F55 ",
		        source.seq
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
		        "\u6D88\u606F\u539F\u6587\uFF08\u53EF\u9009\u4E2D\u4E00\u6BB5\u4F5C\u4E3A\u5F15\u7528\uFF09",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { "aria-label": "\u6D88\u606F\u539F\u6587", readOnly: true, rows: 5, value: source.text, onSelect: (e) => {
		          const el = e.currentTarget;
		          if (el.selectionEnd > el.selectionStart) setQuote(source.text.slice(el.selectionStart, el.selectionEnd).slice(0, 8e3));
		        } })
		      ] }),
		      source.length > source.text.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "px-muted", children: [
		        "\u663E\u793A ",
		        source.offset + 1,
		        "\u2013",
		        source.offset + source.text.length,
		        " / ",
		        source.length,
		        " \u5B57\u7B26\u3002",
		        source.nextOffset !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => void choose(source.id, null, source.nextOffset), children: "\u540E\u7EED\u6B63\u6587" }) : null,
		        source.offset > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => void choose(source.id), children: "\u8FD4\u56DE\u5F00\u5934" }) : null
		      ] }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
		        "\u5F15\u7528\u7247\u6BB5 \xB7 ",
		        quote.length,
		        " \u5B57\u7B26\uFF08\u6700\u591A 8000\uFF09",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { "aria-label": "\u5F15\u7528\u7247\u6BB5", rows: 3, maxLength: 8e3, value: quote, onInput: (e) => setQuote(e.currentTarget.value), onChange: (e) => setQuote(e.target.value) })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "px-muted", children: "\u53EF\u9009\u4E2D\u4E0A\u65B9\u539F\u6587\uFF0C\u4E5F\u53EF\u5728\u8FD9\u91CC\u5220\u53BB\u4E0D\u9700\u8981\u7684\u90E8\u5206\uFF1B\u987B\u4FDD\u7559\u8FDE\u7EED\u7684\u539F\u6587\u3002" }),
		      quote && !validQuote ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: "\u6B64\u7247\u6BB5\u4E0D\u5728\u5F53\u524D\u539F\u6587\u4E2D\uFF0C\u8BF7\u6062\u590D\u539F\u6587\uFF1B\u8865\u5145\u610F\u89C1\u8BF7\u5199\u5728\u6279\u6CE8\u91CC\u3002" }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
		        "\u6211\u7684\u6279\u6CE8",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { "aria-label": "\u6211\u7684\u6279\u6CE8", maxLength: 4e3, value: note, onChange: (e) => setNote(e.target.value), placeholder: "\u9700\u8981\u4FEE\u6539\u7684\u5730\u65B9\u3001\u8865\u5145\u8981\u6C42\u6216\u5F85\u6838\u5BF9\u7684\u95EE\u9898\u2026" })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-actions", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "px-primary", disabled: busy || !validQuote, onClick: () => void action(async () => {
		          const saved = await post("annotations", { action: "save", ...draft, ...editing ? { id: editing.id, updatedAt: editing.updatedAt } : {} });
		          setEditing(saved);
		        }, "\u6279\u6CE8\u5DF2\u4FDD\u5B58"), children: editing ? "\u66F4\u65B0\u6279\u6CE8" : "\u4FDD\u5B58\u6279\u6CE8" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || !validQuote, onClick: () => draft && insert(draft), children: "\u5F15\u7528\u5230\u8F93\u5165\u6846" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => {
		          setSource(null);
		          setEditing(null);
		        }, children: "\u6536\u8D77\u7F16\u8F91\u5668" })
		      ] })
		    ] }) : null,
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h4", { children: [
		      "\u5DF2\u4FDD\u5B58 \xB7 ",
		      notes.data?.annotations.length ?? 0
		    ] }),
		    notes.data?.annotations.map((a) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "px-card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { className: "px-muted", children: [
		        "\u8BB0\u5F55 ",
		        a.seq,
		        " \xB7 ",
		        stamp(a.updatedAt)
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("blockquote", { children: a.quote }),
		      a.note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: a.note }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-actions", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => insert(a), children: "\u5F15\u7528\u5230\u8F93\u5165\u6846" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => void choose(a.messageId, a), children: "\u67E5\u770B\u539F\u6587 / \u7F16\u8F91" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => void action(async () => {
		          await post("annotations", { action: "delete", id: a.id, updatedAt: a.updatedAt });
		          if (editing?.id === a.id) {
		            setEditing(null);
		            setSource(null);
		          }
		        }, "\u6279\u6CE8\u5DF2\u5220\u9664"), children: "\u5220\u9664\u6279\u6CE8" })
		      ] })
		    ] }, a.id)),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: "\u4F1A\u8BDD\u6B63\u6587" }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-actions", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => {
		        setBefore(null);
		        refresh();
		      }, children: "\u6700\u65B0\u6B63\u6587" }),
		      data?.nextBefore !== null && data?.nextBefore !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => setBefore(data.nextBefore), children: "\u66F4\u65E9\u6B63\u6587" }) : null
		    ] }),
		    data?.messages.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u8FD8\u6CA1\u6709\u53EF\u5F15\u7528\u7684\u6B63\u6587\u3002" }) : null,
		    data?.messages.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "px-card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
		        m.role === "user" ? "\u7528\u6237" : "\u52A9\u624B",
		        " \xB7 ",
		        stamp(m.time)
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: m.text }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => void choose(m.id), children: "\u5F15\u7528 / \u6279\u6CE8\u6B64\u6D88\u606F" })
		    ] }, m.id))
		  ] });
		}
		function localTime(time) {
		  const d = new Date(time);
		  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
		}
		function SchedulesPanel({ ctx, scope, visible }) {
		  const sessions = useSnapshot(ctx.sessions.list), { data, error, refresh } = useData(`${base}/schedules`, visible);
		  const [editing, setEditing] = (0, import_react.useState)(null), [form, setForm] = (0, import_react.useState)(false), [title, setTitle] = (0, import_react.useState)(""), [prompt, setPrompt] = (0, import_react.useState)("");
		  const [sessionId, setSessionId] = (0, import_react.useState)(scope.sessionId), [kind, setKind] = (0, import_react.useState)("once"), [at, setAt] = (0, import_react.useState)(localTime(Date.now() + 3e5)), [minutes, setMinutes] = (0, import_react.useState)("60"), [daily, setDaily] = (0, import_react.useState)("09:00"), [enabled, setEnabled] = (0, import_react.useState)(true);
		  const [busy, setBusy] = (0, import_react.useState)(false), [failure, setFailure] = (0, import_react.useState)(""), [notice, setNotice] = (0, import_react.useState)("");
		  const begin = (s) => {
		    setEditing(s);
		    setTitle(s?.title ?? "");
		    setPrompt(s?.prompt ?? "");
		    setSessionId(s?.sessionId ?? scope.sessionId);
		    setKind(s?.timing.kind ?? "once");
		    setEnabled(s?.enabled ?? true);
		    setAt(localTime(s?.timing.kind === "once" ? s.timing.at : Date.now() + 3e5));
		    setMinutes(String(s?.timing.kind === "interval" ? s.timing.minutes : 60));
		    setDaily(s?.timing.kind === "daily" ? s.timing.time : "09:00");
		    setForm(true);
		    setFailure("");
		    setNotice("");
		  };
		  async function action(fn, success) {
		    setBusy(true);
		    setFailure("");
		    setNotice("");
		    try {
		      await fn();
		      refresh();
		      setNotice(success);
		    } catch (e) {
		      setFailure(errorText(e));
		    } finally {
		      setBusy(false);
		    }
		  }
		  const rule = () => kind === "once" ? { kind, at: new Date(at).getTime() } : kind === "interval" ? { kind, minutes: Number(minutes) } : { kind, time: daily };
		  const timingText = (t) => t.kind === "once" ? "\u4E00\u6B21 \xB7 " + stamp(t.at) : t.kind === "interval" ? `\u6BCF ${t.minutes} \u5206\u949F` : `\u6BCF\u5929 ${t.time}`;
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-panel", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "\u5B9A\u65F6\u4EFB\u52A1" }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "px-muted", children: [
		      "\u5E94\u7528\u8FD0\u884C\u65F6\u5411\u6307\u5B9A\u4F1A\u8BDD\u6295\u9012\uFF0C\u6CBF\u7528\u8BE5\u4F1A\u8BDD\u7684\u6A21\u578B\u4E0E\u6743\u9650\u3002\u5FD9\u788C\u65F6\u8FDB\u5165\u961F\u5217\uFF1B\u9000\u51FA\u671F\u95F4\u4E0D\u6267\u884C\uFF0C\u6062\u590D\u540E\u91CD\u590D\u4EFB\u52A1\u53EA\u8865\u6700\u65B0\u4E00\u6B21\u3002\u65F6\u533A\uFF1A",
		      data?.timeZone ?? "\u8BFB\u53D6\u4E2D",
		      "\u3002"
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-actions", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "px-primary", disabled: busy, onClick: () => begin(null), children: "\u65B0\u5EFA\u5B9A\u65F6\u4EFB\u52A1" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: refresh, children: "\u5237\u65B0\u4EFB\u52A1" })
		    ] }),
		    failure || error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: failure || error }) : null,
		    notice ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: notice }) : null,
		    form ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "px-card", "aria-label": "\u5B9A\u65F6\u4EFB\u52A1\u7F16\u8F91\u5668", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: editing ? "\u7F16\u8F91\u4EFB\u52A1" : "\u65B0\u5EFA\u4EFB\u52A1" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
		        "\u4EFB\u52A1\u540D\u79F0",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { "aria-label": "\u4EFB\u52A1\u540D\u79F0", maxLength: 100, value: title, onChange: (e) => setTitle(e.target.value) })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
		        "\u76EE\u6807\u4F1A\u8BDD",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": "\u76EE\u6807\u4F1A\u8BDD", value: sessionId, onChange: (e) => setSessionId(e.target.value), children: [
		          !sessions.byId[sessionId] ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: sessionId, children: [
		            sessionId,
		            "\uFF08\u6682\u4E0D\u53EF\u7528\uFF09"
		          ] }) : null,
		          sessions.ids.filter((id) => sessions.byId[id]?.origin !== "subagent").map((id) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: id, children: sessions.byId[id].displayTitle }, id))
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
		        "\u6267\u884C\u8981\u6C42",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { "aria-label": "\u6267\u884C\u8981\u6C42", rows: 4, maxLength: 4e3, value: prompt, onChange: (e) => setPrompt(e.target.value), placeholder: "\u4F8B\u5982\uFF1A\u68C0\u67E5\u9879\u76EE\u6D4B\u8BD5\uFF0C\u6C47\u62A5\u65B0\u589E\u5931\u8D25\u548C\u5BF9\u5E94\u6587\u4EF6\u3002" })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
		        "\u89E6\u53D1\u65B9\u5F0F",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": "\u89E6\u53D1\u65B9\u5F0F", value: kind, onChange: (e) => setKind(e.target.value), children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "once", children: "\u6307\u5B9A\u65F6\u95F4\u6267\u884C\u4E00\u6B21" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "interval", children: "\u56FA\u5B9A\u95F4\u9694" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "daily", children: "\u6BCF\u5929" })
		        ] })
		      ] }),
		      kind === "once" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
		        "\u672C\u673A\u65F6\u95F4",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { "aria-label": "\u672C\u673A\u65F6\u95F4", type: "datetime-local", value: at, onInput: (e) => setAt(e.currentTarget.value), onChange: (e) => setAt(e.target.value) })
		      ] }) : kind === "interval" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
		        "\u95F4\u9694\uFF08\u5206\u949F\uFF09",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { "aria-label": "\u95F4\u9694\u5206\u949F", type: "number", min: 1, max: 525600, value: minutes, onInput: (e) => setMinutes(e.currentTarget.value), onChange: (e) => setMinutes(e.target.value) })
		      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
		        "\u6BCF\u65E5\u65F6\u95F4",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { "aria-label": "\u6BCF\u65E5\u65F6\u95F4", type: "time", value: daily, onInput: (e) => setDaily(e.currentTarget.value), onChange: (e) => setDaily(e.target.value) })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "px-check", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: enabled, onChange: (e) => setEnabled(e.target.checked) }),
		        "\u542F\u7528\u6B64\u4EFB\u52A1"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-actions", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "px-primary", disabled: busy || !title.trim() || !prompt.trim(), onClick: () => void action(async () => {
		          await post("schedules", { action: "save", ...editing ? { id: editing.id, updatedAt: editing.updatedAt } : {}, title, prompt, sessionId, timing: rule(), enabled });
		          setForm(false);
		        }, "\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u4FDD\u5B58"), children: "\u4FDD\u5B58\u5B9A\u65F6\u4EFB\u52A1" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => setForm(false), children: "\u53D6\u6D88\u7F16\u8F91" })
		      ] })
		    ] }) : null,
		    data?.schedules.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u5C1A\u672A\u914D\u7F6E\u5B9A\u65F6\u4EFB\u52A1\u3002" }) : null,
		    data?.schedules.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "px-card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h4", { children: [
		        s.title,
		        " \xB7 ",
		        s.enabled ? "\u5DF2\u542F\u7528" : "\u5DF2\u6682\u505C"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: s.prompt }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "px-muted", children: [
		        "\u4F1A\u8BDD\uFF1A",
		        sessions.byId[s.sessionId]?.displayTitle ?? s.sessionId,
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
		        timingText(s.timing),
		        " \xB7 ",
		        s.timeZone,
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
		        "\u4E0B\u6B21\uFF1A",
		        stamp(s.nextAt)
		      ] }),
		      s.history[0]?.status === "uncertain" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", children: [
		        s.history[0].detail,
		        " \u68C0\u67E5\u4F1A\u8BDD\u540E\u518D\u624B\u52A8\u6295\u9012\u6216\u542F\u7528\u3002"
		      ] }) : null,
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "px-actions", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => ctx.uiWorkspace.openSession(s.sessionId), children: "\u6253\u5F00\u4F1A\u8BDD" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => begin(s), children: "\u7F16\u8F91\u4EFB\u52A1" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => void action(() => post("schedules", { ...s, action: "save", enabled: !s.enabled }), s.enabled ? "\u4EFB\u52A1\u5DF2\u6682\u505C" : "\u4EFB\u52A1\u5DF2\u542F\u7528"), children: s.enabled ? "\u6682\u505C\u4EFB\u52A1" : "\u542F\u7528\u4EFB\u52A1" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => void action(async () => {
		          const result = await post("schedules", { action: "run", id: s.id });
		          if (result.history[0]?.status !== "queued") throw new Error(result.history[0]?.detail ?? "\u6295\u9012\u5C1A\u672A\u786E\u8BA4");
		        }, "\u5DF2\u6295\u9012\u5230\u76EE\u6807\u4F1A\u8BDD\uFF1B\u8FD9\u4E0D\u4EE3\u8868 Agent \u5DF2\u5B8C\u6210\u3002"), children: "\u7ACB\u5373\u6295\u9012\u4E00\u6B21" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => void action(() => post("schedules", { action: "delete", id: s.id, updatedAt: s.updatedAt }), "\u4EFB\u52A1\u5DF2\u5220\u9664\uFF1B\u5DF2\u6295\u9012\u7684\u4F1A\u8BDD\u6D88\u606F\u4F1A\u4FDD\u7559\u3002"), children: "\u5220\u9664\u4EFB\u52A1" })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { children: [
		          "\u6700\u8FD1\u6295\u9012 \xB7 ",
		          s.history.length,
		          " \u6B21"
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "px-muted", children: "\u201C\u5DF2\u6295\u9012\u201D\u8868\u793A\u4F1A\u8BDD\u63A5\u6536\u3002\u6267\u884C\u8FDB\u5C55\u548C\u6700\u7EC8\u7ED3\u679C\u8BF7\u6253\u5F00\u76EE\u6807\u4F1A\u8BDD\u67E5\u770B\u3002" }),
		        s.history.map((h) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
		          stamp(h.time),
		          " \xB7 ",
		          h.status === "queued" ? "\u5DF2\u6295\u9012" : h.status === "dispatching" ? "\u6295\u9012\u4E2D" : "\u672A\u786E\u8BA4 / \u5DF2\u6682\u505C",
		          h.detail ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
		            h.detail
		          ] }) : null
		        ] }, h.requestId))
		      ] })
		    ] }, s.id))
		  ] });
		}
		function apply(ctx) {
		  ctx.effect(() => {
		    const style = document.createElement("style");
		    style.textContent = css;
		    document.head.appendChild(style);
		    document.body.setAttribute("data-dsh-px-workspace", "");
		    return () => {
		      style.remove();
		      document.body.removeAttribute("data-dsh-px-workspace");
		    };
		  }, "workspace: layout");
		  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-px-workspace", order: 0, registrant: "dsh-px-workspace" }, () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SessionBar, { ctx })));
		  ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({ name: "conversation.chat.assistant-actions", id: "dsh-px-quote", order: 95, registrant: "dsh-px-workspace" }, (p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "px-quote-action", title: "\u5F15\u7528\u6216\u6279\u6CE8\u8FD9\u6761\u6D88\u606F", onClick: () => {
		    requestQuote(p.sessionId, p.messageId);
		    ctx.betterSidebar.openTab({ type: "px-notes", meta: { messageId: p.messageId } }, { sessionId: p.sessionId });
		  }, children: "\u5F15\u7528 / \u6279\u6CE8" })));
		  for (const [id, title, component, icon] of [
		    ["px-artifacts", "\u4EA7\u7269", ArtifactsPanel, "\u25A3"],
		    ["px-notes", "\u5F15\u7528\u4E0E\u6279\u6CE8", NotesPanel, "\u275E"],
		    ["px-schedules", "\u5B9A\u65F6\u4EFB\u52A1", SchedulesPanel, "\u25F7"]
		  ]) ctx.effect(() => ctx.betterSidebar.registerTab({ id, title, order: 16, single: true, icon, component: (p) => {
		    const Component = component;
		    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Component, { ...p, ctx }, p.scope.sessionId);
		  } }), `workspace: ${id}`);
		}

		return module.exports;
	}
});
