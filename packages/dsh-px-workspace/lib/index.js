/*! Bundled semver (ISC)
The ISC License

Copyright (c) Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

*/

// packages/shared/request-trust.ts
function rejectUnauthenticatedRequest(req, res, connection) {
  const rejection = connection?.requestRejection({ headers: req.headers ?? {} });
  if (!connection || rejection !== void 0) {
    res.writeHead(connection ? rejection : 503, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(
      JSON.stringify({
        code: connection ? "HOST_AUTH_REQUIRED" : "HOST_AUTH_UNAVAILABLE",
        error: "\u8BF7\u901A\u8FC7\u5BBF\u4E3B\u63D0\u4F9B\u7684\u767B\u5F55\u5165\u53E3\u8FDE\u63A5\u6B64\u670D\u52A1\u3002"
      })
    );
    return true;
  }
  return rejectUntrustedRequest(req, res);
}
function trustedLocalRequest(req) {
  const headers = req.headers ?? {}, host = headers.host, origin = headers.origin;
  if (typeof host !== "string" || headers["sec-fetch-site"] === "cross-site") return false;
  try {
    const target = new URL("http://" + host);
    if (target.username || target.password || target.pathname !== "/" || target.search || target.hash)
      return false;
    const parts = target.hostname.split(".");
    const loopback = target.hostname === "localhost" || target.hostname === "[::1]" || parts.length === 4 && parts[0] === "127" && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
    if (!loopback) return false;
    if (origin === void 0) return true;
    if (typeof origin !== "string") return false;
    const source = new URL(origin);
    return ["http:", "https:"].includes(source.protocol) && source.hostname === target.hostname && (!source.port || source.port === target.port);
  } catch {
    return false;
  }
}
function rejectUntrustedRequest(req, res) {
  if (trustedLocalRequest(req)) return false;
  res.writeHead(403, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(
    JSON.stringify({
      code: "UNTRUSTED_REQUEST",
      error: "\u6B64\u8BF7\u6C42\u7684\u6765\u6E90\u4E0D\u53D7\u4FE1\u4EFB\uFF0C\u8BF7\u4ECE\u672C\u673A DSH-PX \u754C\u9762\u91CD\u8BD5\u3002",
      retryable: false
    })
  );
  return true;
}

// packages/dsh-px-workspace/src/index.ts
import { join as join2 } from "node:path";

// packages/dsh-px-workspace/src/model.ts
var SessionContentIndex = class {
  count = 0;
  first;
  last;
  rows = [];
  byId = /* @__PURE__ */ new Map();
  files = /* @__PURE__ */ new Map();
  orderedFiles;
  inbox = /* @__PURE__ */ new Map();
  openTurn;
  turnRequests = /* @__PURE__ */ new Map();
  enteredRequests = /* @__PURE__ */ new Set();
  execution = /* @__PURE__ */ new Map();
  retainedChars = 0;
  processedEvents = 0;
  get cacheCost() {
    return this.retainedChars * 2 + (this.rows.length + this.files.size + this.execution.size) * 256;
  }
  update(events) {
    if (events.length < this.count || this.count > 0 && (events[0] !== this.first || events[this.count - 1] !== this.last)) {
      this.count = 0;
      this.rows = [];
      this.byId.clear();
      this.files.clear();
      this.orderedFiles = void 0;
      this.inbox.clear();
      this.openTurn = void 0;
      this.turnRequests.clear();
      this.enteredRequests.clear();
      this.execution.clear();
      this.retainedChars = 0;
    }
    for (let i = this.count; i < events.length; i++) {
      const event = events[i];
      this.processedEvents++;
      for (const message of messages([event])) {
        this.rows.push(message);
        this.byId.set(message.id, message);
        this.retainedChars += message.text.length;
      }
      for (const file of artifacts([event])) {
        const previous = this.files.get(file.path);
        this.retainedChars += file.path.length + file.description.length - (previous ? previous.path.length + previous.description.length : 0);
        this.files.set(file.path, file);
        this.orderedFiles = void 0;
      }
      this.foldDispatch(event);
    }
    this.count = events.length;
    this.first = events[0];
    this.last = events.at(-1);
    return this;
  }
  message(id) {
    return this.byId.get(id);
  }
  content(before = Number.MAX_SAFE_INTEGER, artifactBefore) {
    let lo = 0, hi = this.rows.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (this.rows[mid].seq < before) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.max(0, lo - 20), page = this.rows.slice(start, lo);
    const allFiles = this.orderedFiles ??= [...this.files.values()].sort(
      (a, b2) => b2.seq - a.seq || (a.path < b2.path ? -1 : a.path > b2.path ? 1 : 0)
    );
    let fileStart = 0;
    if (artifactBefore !== void 0) {
      let cursor;
      try {
        cursor = JSON.parse(decodeURIComponent(artifactBefore));
      } catch {
        throw new Error("\u4EA7\u7269\u5206\u9875\u53C2\u6570\u65E0\u6548");
      }
      if (!Array.isArray(cursor) || cursor.length !== 2 || !Number.isSafeInteger(cursor[0]) || cursor[0] < 0 || typeof cursor[1] !== "string" || cursor[1].length > 4096)
        throw new Error("\u4EA7\u7269\u5206\u9875\u53C2\u6570\u65E0\u6548");
      let end = allFiles.length;
      while (fileStart < end) {
        const mid = fileStart + end >>> 1, file = allFiles[mid];
        if (file.seq > cursor[0] || file.seq === cursor[0] && file.path <= cursor[1]) fileStart = mid + 1;
        else end = mid;
      }
    }
    const files = allFiles.slice(fileStart, fileStart + 20), last = files.at(-1);
    return {
      messages: page.map((m2) => ({ ...m2, text: m2.text.slice(0, 240) })).reverse(),
      nextBefore: start > 0 ? page[0].seq : null,
      artifacts: files.map((f) => ({ ...f })),
      nextArtifactBefore: last && fileStart + files.length < allFiles.length ? encodeURIComponent(JSON.stringify([last.seq, last.path])) : null,
      artifactTotal: allFiles.length
    };
  }
  dispatch(requestId) {
    const value = this.execution.get(requestId);
    return value && { ...value };
  }
  foldDispatch(event) {
    const data = event.data ?? {};
    const requestOf = (message) => message?.source?.kind === "user" && typeof message.source.rpcId === "string" ? message.source.rpcId : void 0;
    const running = (id, turn) => {
      const existing = this.execution.get(id);
      this.execution.set(id, {
        time: existing?.time ?? event.time,
        status: "running",
        turn,
        startedAt: existing?.startedAt ?? event.time
      });
      let requests = this.turnRequests.get(turn);
      if (!requests) this.turnRequests.set(turn, requests = /* @__PURE__ */ new Set());
      requests.add(id);
    };
    if (event.type === "turn/start" && Number.isSafeInteger(data.turn)) this.openTurn = data.turn;
    if (event.type === "agent/inbox/spliced" && typeof data.target === "string" && Number.isInteger(data.start) && Array.isArray(data.inserted)) {
      const queue = this.inbox.get(data.target) ?? [];
      this.inbox.set(data.target, queue);
      const inserted = data.inserted.map((m2) => ({ requestId: requestOf(m2) }));
      const removed = queue.splice(data.start, data.removedCount ?? 0, ...inserted);
      const replacements = new Set(inserted.map((m2) => m2.requestId));
      for (const item of inserted)
        if (item.requestId) this.execution.set(item.requestId, { time: event.time, status: "queued" });
      for (const item of removed)
        if (item.requestId && !replacements.has(item.requestId)) {
          if (data.outcome === "canceled")
            this.execution.set(item.requestId, {
              time: this.execution.get(item.requestId)?.time ?? event.time,
              status: "cancelled",
              finishedAt: event.time,
              detail: "\u4EFB\u52A1\u5728\u539F\u751F\u4F1A\u8BDD\u961F\u5217\u4E2D\u88AB\u53D6\u6D88\uFF0C\u672A\u5F00\u59CB\u6267\u884C\u3002"
            });
          else if (this.openTurn !== void 0) running(item.requestId, this.openTurn);
        }
    }
    if (event.type === "user/message") {
      const id = requestOf(data);
      if (id && this.openTurn !== void 0) {
        this.enteredRequests.add(id);
        running(id, this.openTurn);
      }
    }
    if (event.type === "turn/end") {
      const reason = data.reason?.kind;
      const status = reason === "completed" ? "completed" : reason === "aborted" ? ["user", "parent", "hook"].includes(data.reason.reason?.kind) ? "cancelled" : "interrupted" : reason === "interrupted" ? "interrupted" : "failed";
      const detail = reason === "completed" ? "\u4F1A\u8BDD\u8F6E\u6B21\u5DF2\u7ED3\u675F\uFF1B\u4E0D\u4EE3\u8868\u4EFB\u52A1\u5185\u5BB9\u5DF2\u7ECF\u9A8C\u8BC1\u901A\u8FC7\u3002" : reason === "blocked" ? "\u539F\u751F\u4F1A\u8BDD\u5728\u6267\u884C\u524D\u88AB\u963B\u6B62\uFF0C\u8BF7\u67E5\u770B\u76EE\u6807\u4F1A\u8BDD\u3002" : reason === "max-tokens" ? "\u539F\u751F\u4F1A\u8BDD\u8FBE\u5230\u8F93\u51FA\u9650\u5236\uFF0C\u8BF7\u67E5\u770B\u76EE\u6807\u4F1A\u8BDD\u3002" : reason === "error" ? "\u539F\u751F\u4F1A\u8BDD\u6267\u884C\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u76EE\u6807\u4F1A\u8BDD\u7684\u9519\u8BEF\u4FE1\u606F\u3002" : reason === "aborted" ? "\u539F\u751F\u4F1A\u8BDD\u7684\u6267\u884C\u5DF2\u88AB\u4E2D\u6B62\u3002" : "\u539F\u751F\u4F1A\u8BDD\u672A\u6B63\u5E38\u7ED3\u675F\uFF0C\u8BF7\u6838\u5BF9\u6267\u884C\u7ED3\u679C\u540E\u91CD\u8BD5\u3002";
      for (const id of this.turnRequests.get(data.turn) ?? []) {
        const previous = this.execution.get(id);
        const entered = this.enteredRequests.delete(id);
        this.execution.set(id, {
          ...previous,
          status: status === "completed" && !entered ? "cancelled" : status,
          finishedAt: event.time,
          detail: status === "completed" && !entered ? "\u8BF7\u6C42\u88AB\u53D6\u51FA\u961F\u5217\u4F46\u6CA1\u6709\u8FDB\u5165\u6A21\u578B\u6267\u884C\uFF1B\u8BF7\u6838\u5BF9\u76EE\u6807\u4F1A\u8BDD\u4E2D\u7684\u961F\u5217\u8C03\u6574\u3002" : detail
        });
      }
      this.turnRequests.delete(data.turn);
      if (this.openTurn === data.turn) this.openTurn = void 0;
    }
  }
};
function messages(events) {
  const rows = [];
  for (const e of events) {
    if (e.type !== "user/message" && e.type !== "assistant/message") continue;
    const m2 = e.type === "user/message" ? e.data : e.data?.message;
    if (e.type === "user/message" && m2?.source?.kind !== "user") continue;
    if (!m2 || typeof m2.id !== "string" || !Array.isArray(m2.content)) continue;
    const text2 = m2.content.filter((b2) => b2?.type === "text" && typeof b2.text === "string").map((b2) => b2.text).join("\n");
    if (text2.trim())
      rows.push({
        id: m2.id,
        seq: e.seq,
        time: e.time,
        role: e.type === "user/message" ? "user" : "assistant",
        text: text2
      });
  }
  return rows;
}
function artifacts(events) {
  const rows = /* @__PURE__ */ new Map();
  for (const e of events)
    if (e.type === "deliverables/presented" && Array.isArray(e.data?.files)) {
      for (const f of e.data.files)
        if (typeof f?.path === "string" && f.path.length > 0 && f.path.length <= 4096) {
          rows.set(f.path, {
            path: f.path,
            description: typeof f.description === "string" ? f.description.slice(0, 2e3) : "",
            time: e.time,
            seq: e.seq
          });
        }
    }
  return [...rows.values()].sort((a, b2) => b2.seq - a.seq);
}
function nextOccurrence(timing2, now) {
  if (timing2.kind === "once") return timing2.at;
  if (timing2.kind === "interval") return now + timing2.minutes * 6e4;
  const [hours, minutes] = timing2.time.split(":").map(Number);
  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= now) date.setDate(date.getDate() + 1);
  return date.getTime();
}

// packages/dsh-px-workspace/src/store.ts
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  statSync,
  copyFileSync,
  existsSync,
  unlinkSync,
  constants
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";

// packages/shared/diagnostics.ts
function diagnostic(event, fields) {
  console.info(`[dsh-px-event] ${JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), event, ...fields })}`);
}

// node_modules/marked/lib/marked.esm.js
function L() {
  return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
}
var T = L();
function G(l3) {
  T = l3;
}
var E = { exec: () => null };
function d(l3, e = "") {
  let t = typeof l3 == "string" ? l3 : l3.source, n = { replace: (r, i) => {
    let s = typeof i == "string" ? i : i.source;
    return s = s.replace(m.caret, "$1"), t = t.replace(r, s), n;
  }, getRegex: () => new RegExp(t, e) };
  return n;
}
var be = (() => {
  try {
    return !!new RegExp("(?<=1)(?<!1)");
  } catch {
    return false;
  }
})();
var m = { codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceTabs: /^\t+/, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] /, listReplaceTask: /^\[[ xX]\] +/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, unescapeTest: /&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (l3) => new RegExp(`^( {0,3}${l3})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: (l3) => new RegExp(`^ {0,${Math.min(3, l3 - 1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`), hrRegex: (l3) => new RegExp(`^ {0,${Math.min(3, l3 - 1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`), fencesBeginRegex: (l3) => new RegExp(`^ {0,${Math.min(3, l3 - 1)}}(?:\`\`\`|~~~)`), headingBeginRegex: (l3) => new RegExp(`^ {0,${Math.min(3, l3 - 1)}}#`), htmlBeginRegex: (l3) => new RegExp(`^ {0,${Math.min(3, l3 - 1)}}<(?:[a-z].*>|!--)`, "i") };
var Re = /^(?:[ \t]*(?:\n|$))+/;
var Te = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var Oe = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var I = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var we = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var F = /(?:[*+-]|\d{1,9}[.)])/;
var ie = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var oe = d(ie).replace(/bull/g, F).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var ye = d(ie).replace(/bull/g, F).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var j = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/;
var Pe = /^[^\n]+/;
var Q = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var Se = d(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", Q).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var $e = d(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g, F).getRegex();
var v = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var U = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var _e = d("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", U).replace("tag", v).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var ae = d(j).replace("hr", I).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", v).getRegex();
var Le = d(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", ae).getRegex();
var K = { blockquote: Le, code: Te, def: Se, fences: Oe, heading: we, hr: I, html: _e, lheading: oe, list: $e, newline: Re, paragraph: ae, table: E, text: Pe };
var re = d("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", I).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", v).getRegex();
var Me = { ...K, lheading: ye, table: re, paragraph: d(j).replace("hr", I).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", re).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", v).getRegex() };
var ze = { ...K, html: d(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", U).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: E, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: d(j).replace("hr", I).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", oe).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
var Ae = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var Ee = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var le = /^( {2,}|\\)\n(?!\s*$)/;
var Ie = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var D = /[\p{P}\p{S}]/u;
var W = /[\s\p{P}\p{S}]/u;
var ue = /[^\s\p{P}\p{S}]/u;
var Ce = d(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, W).getRegex();
var pe = /(?!~)[\p{P}\p{S}]/u;
var Be = /(?!~)[\s\p{P}\p{S}]/u;
var qe = /(?:[^\s\p{P}\p{S}]|~)/u;
var ve = d(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", be ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var ce = /^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/;
var De = d(ce, "u").replace(/punct/g, D).getRegex();
var He = d(ce, "u").replace(/punct/g, pe).getRegex();
var he = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var Ze = d(he, "gu").replace(/notPunctSpace/g, ue).replace(/punctSpace/g, W).replace(/punct/g, D).getRegex();
var Ge = d(he, "gu").replace(/notPunctSpace/g, qe).replace(/punctSpace/g, Be).replace(/punct/g, pe).getRegex();
var Ne = d("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, ue).replace(/punctSpace/g, W).replace(/punct/g, D).getRegex();
var Fe = d(/\\(punct)/, "gu").replace(/punct/g, D).getRegex();
var je = d(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var Qe = d(U).replace("(?:-->|$)", "-->").getRegex();
var Ue = d("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", Qe).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var q = /(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/;
var Ke = d(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label", q).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var de = d(/^!?\[(label)\]\[(ref)\]/).replace("label", q).replace("ref", Q).getRegex();
var ke = d(/^!?\[(ref)\](?:\[\])?/).replace("ref", Q).getRegex();
var We = d("reflink|nolink(?!\\()", "g").replace("reflink", de).replace("nolink", ke).getRegex();
var se = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var X = { _backpedal: E, anyPunctuation: Fe, autolink: je, blockSkip: ve, br: le, code: Ee, del: E, emStrongLDelim: De, emStrongRDelimAst: Ze, emStrongRDelimUnd: Ne, escape: Ae, link: Ke, nolink: ke, punctuation: Ce, reflink: de, reflinkSearch: We, tag: Ue, text: Ie, url: E };
var Xe = { ...X, link: d(/^!?\[(label)\]\((.*?)\)/).replace("label", q).getRegex(), reflink: d(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", q).getRegex() };
var N = { ...X, emStrongRDelimAst: Ge, emStrongLDelim: He, url: d(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol", se).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: d(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol", se).getRegex() };
var Je = { ...N, br: d(le).replace("{2,}", "*").getRegex(), text: d(N.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
var C = { normal: K, gfm: Me, pedantic: ze };
var M = { normal: X, gfm: N, breaks: Je, pedantic: Xe };
var Ve = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var ge = (l3) => Ve[l3];
function w(l3, e) {
  if (e) {
    if (m.escapeTest.test(l3)) return l3.replace(m.escapeReplace, ge);
  } else if (m.escapeTestNoEncode.test(l3)) return l3.replace(m.escapeReplaceNoEncode, ge);
  return l3;
}
function J(l3) {
  try {
    l3 = encodeURI(l3).replace(m.percentDecode, "%");
  } catch {
    return null;
  }
  return l3;
}
function V(l3, e) {
  let t = l3.replace(m.findPipe, (i, s, a) => {
    let o = false, p = s;
    for (; --p >= 0 && a[p] === "\\"; ) o = !o;
    return o ? "|" : " |";
  }), n = t.split(m.splitPipe), r = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
  else for (; n.length < e; ) n.push("");
  for (; r < n.length; r++) n[r] = n[r].trim().replace(m.slashPipe, "|");
  return n;
}
function z(l3, e, t) {
  let n = l3.length;
  if (n === 0) return "";
  let r = 0;
  for (; r < n; ) {
    let i = l3.charAt(n - r - 1);
    if (i === e && !t) r++;
    else if (i !== e && t) r++;
    else break;
  }
  return l3.slice(0, n - r);
}
function fe(l3, e) {
  if (l3.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < l3.length; n++) if (l3[n] === "\\") n++;
  else if (l3[n] === e[0]) t++;
  else if (l3[n] === e[1] && (t--, t < 0)) return n;
  return t > 0 ? -2 : -1;
}
function me(l3, e, t, n, r) {
  let i = e.href, s = e.title || null, a = l3[1].replace(r.other.outputLinkReplace, "$1");
  n.state.inLink = true;
  let o = { type: l3[0].charAt(0) === "!" ? "image" : "link", raw: t, href: i, title: s, text: a, tokens: n.inlineTokens(a) };
  return n.state.inLink = false, o;
}
function Ye(l3, e, t) {
  let n = l3.match(t.other.indentCodeCompensation);
  if (n === null) return e;
  let r = n[1];
  return e.split(`
`).map((i) => {
    let s = i.match(t.other.beginningSpace);
    if (s === null) return i;
    let [a] = s;
    return a.length >= r.length ? i.slice(r.length) : i;
  }).join(`
`);
}
var y = class {
  options;
  rules;
  lexer;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    let t = this.rules.block.newline.exec(e);
    if (t && t[0].length > 0) return { type: "space", raw: t[0] };
  }
  code(e) {
    let t = this.rules.block.code.exec(e);
    if (t) {
      let n = t[0].replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: t[0], codeBlockStyle: "indented", text: this.options.pedantic ? n : z(n, `
`) };
    }
  }
  fences(e) {
    let t = this.rules.block.fences.exec(e);
    if (t) {
      let n = t[0], r = Ye(n, t[3] || "", this.rules);
      return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: r };
    }
  }
  heading(e) {
    let t = this.rules.block.heading.exec(e);
    if (t) {
      let n = t[2].trim();
      if (this.rules.other.endingHash.test(n)) {
        let r = z(n, "#");
        (this.options.pedantic || !r || this.rules.other.endingSpaceChar.test(r)) && (n = r.trim());
      }
      return { type: "heading", raw: t[0], depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
    }
  }
  hr(e) {
    let t = this.rules.block.hr.exec(e);
    if (t) return { type: "hr", raw: z(t[0], `
`) };
  }
  blockquote(e) {
    let t = this.rules.block.blockquote.exec(e);
    if (t) {
      let n = z(t[0], `
`).split(`
`), r = "", i = "", s = [];
      for (; n.length > 0; ) {
        let a = false, o = [], p;
        for (p = 0; p < n.length; p++) if (this.rules.other.blockquoteStart.test(n[p])) o.push(n[p]), a = true;
        else if (!a) o.push(n[p]);
        else break;
        n = n.slice(p);
        let u = o.join(`
`), c = u.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        r = r ? `${r}
${u}` : u, i = i ? `${i}
${c}` : c;
        let g = this.lexer.state.top;
        if (this.lexer.state.top = true, this.lexer.blockTokens(c, s, true), this.lexer.state.top = g, n.length === 0) break;
        let h = s.at(-1);
        if (h?.type === "code") break;
        if (h?.type === "blockquote") {
          let R = h, f = R.raw + `
` + n.join(`
`), O = this.blockquote(f);
          s[s.length - 1] = O, r = r.substring(0, r.length - R.raw.length) + O.raw, i = i.substring(0, i.length - R.text.length) + O.text;
          break;
        } else if (h?.type === "list") {
          let R = h, f = R.raw + `
` + n.join(`
`), O = this.list(f);
          s[s.length - 1] = O, r = r.substring(0, r.length - h.raw.length) + O.raw, i = i.substring(0, i.length - R.raw.length) + O.raw, n = f.substring(s.at(-1).raw.length).split(`
`);
          continue;
        }
      }
      return { type: "blockquote", raw: r, tokens: s, text: i };
    }
  }
  list(e) {
    let t = this.rules.block.list.exec(e);
    if (t) {
      let n = t[1].trim(), r = n.length > 1, i = { type: "list", raw: "", ordered: r, start: r ? +n.slice(0, -1) : "", loose: false, items: [] };
      n = r ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = r ? n : "[*+-]");
      let s = this.rules.other.listItemRegex(n), a = false;
      for (; e; ) {
        let p = false, u = "", c = "";
        if (!(t = s.exec(e)) || this.rules.block.hr.test(e)) break;
        u = t[0], e = e.substring(u.length);
        let g = t[2].split(`
`, 1)[0].replace(this.rules.other.listReplaceTabs, (H) => " ".repeat(3 * H.length)), h = e.split(`
`, 1)[0], R = !g.trim(), f = 0;
        if (this.options.pedantic ? (f = 2, c = g.trimStart()) : R ? f = t[1].length + 1 : (f = t[2].search(this.rules.other.nonSpaceChar), f = f > 4 ? 1 : f, c = g.slice(f), f += t[1].length), R && this.rules.other.blankLine.test(h) && (u += h + `
`, e = e.substring(h.length + 1), p = true), !p) {
          let H = this.rules.other.nextBulletRegex(f), ee = this.rules.other.hrRegex(f), te = this.rules.other.fencesBeginRegex(f), ne = this.rules.other.headingBeginRegex(f), xe = this.rules.other.htmlBeginRegex(f);
          for (; e; ) {
            let Z = e.split(`
`, 1)[0], A;
            if (h = Z, this.options.pedantic ? (h = h.replace(this.rules.other.listReplaceNesting, "  "), A = h) : A = h.replace(this.rules.other.tabCharGlobal, "    "), te.test(h) || ne.test(h) || xe.test(h) || H.test(h) || ee.test(h)) break;
            if (A.search(this.rules.other.nonSpaceChar) >= f || !h.trim()) c += `
` + A.slice(f);
            else {
              if (R || g.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || te.test(g) || ne.test(g) || ee.test(g)) break;
              c += `
` + h;
            }
            !R && !h.trim() && (R = true), u += Z + `
`, e = e.substring(Z.length + 1), g = A.slice(f);
          }
        }
        i.loose || (a ? i.loose = true : this.rules.other.doubleBlankLine.test(u) && (a = true));
        let O = null, Y;
        this.options.gfm && (O = this.rules.other.listIsTask.exec(c), O && (Y = O[0] !== "[ ] ", c = c.replace(this.rules.other.listReplaceTask, ""))), i.items.push({ type: "list_item", raw: u, task: !!O, checked: Y, loose: false, text: c, tokens: [] }), i.raw += u;
      }
      let o = i.items.at(-1);
      if (o) o.raw = o.raw.trimEnd(), o.text = o.text.trimEnd();
      else return;
      i.raw = i.raw.trimEnd();
      for (let p = 0; p < i.items.length; p++) if (this.lexer.state.top = false, i.items[p].tokens = this.lexer.blockTokens(i.items[p].text, []), !i.loose) {
        let u = i.items[p].tokens.filter((g) => g.type === "space"), c = u.length > 0 && u.some((g) => this.rules.other.anyLine.test(g.raw));
        i.loose = c;
      }
      if (i.loose) for (let p = 0; p < i.items.length; p++) i.items[p].loose = true;
      return i;
    }
  }
  html(e) {
    let t = this.rules.block.html.exec(e);
    if (t) return { type: "html", block: true, raw: t[0], pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: t[0] };
  }
  def(e) {
    let t = this.rules.block.def.exec(e);
    if (t) {
      let n = t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " "), r = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", i = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
      return { type: "def", tag: n, raw: t[0], href: r, title: i };
    }
  }
  table(e) {
    let t = this.rules.block.table.exec(e);
    if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
    let n = V(t[1]), r = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), i = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], s = { type: "table", raw: t[0], header: [], align: [], rows: [] };
    if (n.length === r.length) {
      for (let a of r) this.rules.other.tableAlignRight.test(a) ? s.align.push("right") : this.rules.other.tableAlignCenter.test(a) ? s.align.push("center") : this.rules.other.tableAlignLeft.test(a) ? s.align.push("left") : s.align.push(null);
      for (let a = 0; a < n.length; a++) s.header.push({ text: n[a], tokens: this.lexer.inline(n[a]), header: true, align: s.align[a] });
      for (let a of i) s.rows.push(V(a, s.header.length).map((o, p) => ({ text: o, tokens: this.lexer.inline(o), header: false, align: s.align[p] })));
      return s;
    }
  }
  lheading(e) {
    let t = this.rules.block.lheading.exec(e);
    if (t) return { type: "heading", raw: t[0], depth: t[2].charAt(0) === "=" ? 1 : 2, text: t[1], tokens: this.lexer.inline(t[1]) };
  }
  paragraph(e) {
    let t = this.rules.block.paragraph.exec(e);
    if (t) {
      let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
      return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
    }
  }
  text(e) {
    let t = this.rules.block.text.exec(e);
    if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
  }
  escape(e) {
    let t = this.rules.inline.escape.exec(e);
    if (t) return { type: "escape", raw: t[0], text: t[1] };
  }
  tag(e) {
    let t = this.rules.inline.tag.exec(e);
    if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
  }
  link(e) {
    let t = this.rules.inline.link.exec(e);
    if (t) {
      let n = t[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(n)) {
        if (!this.rules.other.endAngleBracket.test(n)) return;
        let s = z(n.slice(0, -1), "\\");
        if ((n.length - s.length) % 2 === 0) return;
      } else {
        let s = fe(t[2], "()");
        if (s === -2) return;
        if (s > -1) {
          let o = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + s;
          t[2] = t[2].substring(0, s), t[0] = t[0].substring(0, o).trim(), t[3] = "";
        }
      }
      let r = t[2], i = "";
      if (this.options.pedantic) {
        let s = this.rules.other.pedanticHrefTitle.exec(r);
        s && (r = s[1], i = s[3]);
      } else i = t[3] ? t[3].slice(1, -1) : "";
      return r = r.trim(), this.rules.other.startAngleBracket.test(r) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(n) ? r = r.slice(1) : r = r.slice(1, -1)), me(t, { href: r && r.replace(this.rules.inline.anyPunctuation, "$1"), title: i && i.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
    }
  }
  reflink(e, t) {
    let n;
    if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
      let r = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), i = t[r.toLowerCase()];
      if (!i) {
        let s = n[0].charAt(0);
        return { type: "text", raw: s, text: s };
      }
      return me(n, i, n[0], this.lexer, this.rules);
    }
  }
  emStrong(e, t, n = "") {
    let r = this.rules.inline.emStrongLDelim.exec(e);
    if (!r || r[3] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
    if (!(r[1] || r[2] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let s = [...r[0]].length - 1, a, o, p = s, u = 0, c = r[0][0] === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      for (c.lastIndex = 0, t = t.slice(-1 * e.length + s); (r = c.exec(t)) != null; ) {
        if (a = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !a) continue;
        if (o = [...a].length, r[3] || r[4]) {
          p += o;
          continue;
        } else if ((r[5] || r[6]) && s % 3 && !((s + o) % 3)) {
          u += o;
          continue;
        }
        if (p -= o, p > 0) continue;
        o = Math.min(o, o + p + u);
        let g = [...r[0]][0].length, h = e.slice(0, s + r.index + g + o);
        if (Math.min(s, o) % 2) {
          let f = h.slice(1, -1);
          return { type: "em", raw: h, text: f, tokens: this.lexer.inlineTokens(f) };
        }
        let R = h.slice(2, -2);
        return { type: "strong", raw: h, text: R, tokens: this.lexer.inlineTokens(R) };
      }
    }
  }
  codespan(e) {
    let t = this.rules.inline.code.exec(e);
    if (t) {
      let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), r = this.rules.other.nonSpaceChar.test(n), i = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
      return r && i && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
    }
  }
  br(e) {
    let t = this.rules.inline.br.exec(e);
    if (t) return { type: "br", raw: t[0] };
  }
  del(e) {
    let t = this.rules.inline.del.exec(e);
    if (t) return { type: "del", raw: t[0], text: t[2], tokens: this.lexer.inlineTokens(t[2]) };
  }
  autolink(e) {
    let t = this.rules.inline.autolink.exec(e);
    if (t) {
      let n, r;
      return t[2] === "@" ? (n = t[1], r = "mailto:" + n) : (n = t[1], r = n), { type: "link", raw: t[0], text: n, href: r, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  url(e) {
    let t;
    if (t = this.rules.inline.url.exec(e)) {
      let n, r;
      if (t[2] === "@") n = t[0], r = "mailto:" + n;
      else {
        let i;
        do
          i = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
        while (i !== t[0]);
        n = t[0], t[1] === "www." ? r = "http://" + t[0] : r = t[0];
      }
      return { type: "link", raw: t[0], text: n, href: r, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  inlineText(e) {
    let t = this.rules.inline.text.exec(e);
    if (t) {
      let n = this.lexer.state.inRawBlock;
      return { type: "text", raw: t[0], text: t[0], escaped: n };
    }
  }
};
var x = class l {
  tokens;
  options;
  state;
  tokenizer;
  inlineQueue;
  constructor(e) {
    this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e || T, this.options.tokenizer = this.options.tokenizer || new y(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, top: true };
    let t = { other: m, block: C.normal, inline: M.normal };
    this.options.pedantic ? (t.block = C.pedantic, t.inline = M.pedantic) : this.options.gfm && (t.block = C.gfm, this.options.breaks ? t.inline = M.breaks : t.inline = M.gfm), this.tokenizer.rules = t;
  }
  static get rules() {
    return { block: C, inline: M };
  }
  static lex(e, t) {
    return new l(t).lex(e);
  }
  static lexInline(e, t) {
    return new l(t).inlineTokens(e);
  }
  lex(e) {
    e = e.replace(m.carriageReturn, `
`), this.blockTokens(e, this.tokens);
    for (let t = 0; t < this.inlineQueue.length; t++) {
      let n = this.inlineQueue[t];
      this.inlineTokens(n.src, n.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(e, t = [], n = false) {
    for (this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, "")); e; ) {
      let r;
      if (this.options.extensions?.block?.some((s) => (r = s.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false)) continue;
      if (r = this.tokenizer.space(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        r.raw.length === 1 && s !== void 0 ? s.raw += `
` : t.push(r);
        continue;
      }
      if (r = this.tokenizer.code(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.at(-1).src = s.text) : t.push(r);
        continue;
      }
      if (r = this.tokenizer.fences(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.heading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.hr(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.blockquote(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.list(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.html(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.def(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.raw, this.inlineQueue.at(-1).src = s.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
        continue;
      }
      if (r = this.tokenizer.table(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.lheading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      let i = e;
      if (this.options.extensions?.startBlock) {
        let s = 1 / 0, a = e.slice(1), o;
        this.options.extensions.startBlock.forEach((p) => {
          o = p.call({ lexer: this }, a), typeof o == "number" && o >= 0 && (s = Math.min(s, o));
        }), s < 1 / 0 && s >= 0 && (i = e.substring(0, s + 1));
      }
      if (this.state.top && (r = this.tokenizer.paragraph(i))) {
        let s = t.at(-1);
        n && s?.type === "paragraph" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r), n = i.length !== e.length, e = e.substring(r.raw.length);
        continue;
      }
      if (r = this.tokenizer.text(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r);
        continue;
      }
      if (e) {
        let s = "Infinite loop on byte: " + e.charCodeAt(0);
        if (this.options.silent) {
          console.error(s);
          break;
        } else throw new Error(s);
      }
    }
    return this.state.top = true, t;
  }
  inline(e, t = []) {
    return this.inlineQueue.push({ src: e, tokens: t }), t;
  }
  inlineTokens(e, t = []) {
    let n = e, r = null;
    if (this.tokens.links) {
      let o = Object.keys(this.tokens.links);
      if (o.length > 0) for (; (r = this.tokenizer.rules.inline.reflinkSearch.exec(n)) != null; ) o.includes(r[0].slice(r[0].lastIndexOf("[") + 1, -1)) && (n = n.slice(0, r.index) + "[" + "a".repeat(r[0].length - 2) + "]" + n.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex));
    }
    for (; (r = this.tokenizer.rules.inline.anyPunctuation.exec(n)) != null; ) n = n.slice(0, r.index) + "++" + n.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
    let i;
    for (; (r = this.tokenizer.rules.inline.blockSkip.exec(n)) != null; ) i = r[2] ? r[2].length : 0, n = n.slice(0, r.index + i) + "[" + "a".repeat(r[0].length - i - 2) + "]" + n.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
    n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
    let s = false, a = "";
    for (; e; ) {
      s || (a = ""), s = false;
      let o;
      if (this.options.extensions?.inline?.some((u) => (o = u.call({ lexer: this }, e, t)) ? (e = e.substring(o.raw.length), t.push(o), true) : false)) continue;
      if (o = this.tokenizer.escape(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.tag(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.link(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.reflink(e, this.tokens.links)) {
        e = e.substring(o.raw.length);
        let u = t.at(-1);
        o.type === "text" && u?.type === "text" ? (u.raw += o.raw, u.text += o.text) : t.push(o);
        continue;
      }
      if (o = this.tokenizer.emStrong(e, n, a)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.codespan(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.br(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.del(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.autolink(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (!this.state.inLink && (o = this.tokenizer.url(e))) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      let p = e;
      if (this.options.extensions?.startInline) {
        let u = 1 / 0, c = e.slice(1), g;
        this.options.extensions.startInline.forEach((h) => {
          g = h.call({ lexer: this }, c), typeof g == "number" && g >= 0 && (u = Math.min(u, g));
        }), u < 1 / 0 && u >= 0 && (p = e.substring(0, u + 1));
      }
      if (o = this.tokenizer.inlineText(p)) {
        e = e.substring(o.raw.length), o.raw.slice(-1) !== "_" && (a = o.raw.slice(-1)), s = true;
        let u = t.at(-1);
        u?.type === "text" ? (u.raw += o.raw, u.text += o.text) : t.push(o);
        continue;
      }
      if (e) {
        let u = "Infinite loop on byte: " + e.charCodeAt(0);
        if (this.options.silent) {
          console.error(u);
          break;
        } else throw new Error(u);
      }
    }
    return t;
  }
};
var P = class {
  options;
  parser;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    return "";
  }
  code({ text: e, lang: t, escaped: n }) {
    let r = (t || "").match(m.notSpaceStart)?.[0], i = e.replace(m.endingNewline, "") + `
`;
    return r ? '<pre><code class="language-' + w(r) + '">' + (n ? i : w(i, true)) + `</code></pre>
` : "<pre><code>" + (n ? i : w(i, true)) + `</code></pre>
`;
  }
  blockquote({ tokens: e }) {
    return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
  }
  html({ text: e }) {
    return e;
  }
  def(e) {
    return "";
  }
  heading({ tokens: e, depth: t }) {
    return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
  }
  hr(e) {
    return `<hr>
`;
  }
  list(e) {
    let t = e.ordered, n = e.start, r = "";
    for (let a = 0; a < e.items.length; a++) {
      let o = e.items[a];
      r += this.listitem(o);
    }
    let i = t ? "ol" : "ul", s = t && n !== 1 ? ' start="' + n + '"' : "";
    return "<" + i + s + `>
` + r + "</" + i + `>
`;
  }
  listitem(e) {
    let t = "";
    if (e.task) {
      let n = this.checkbox({ checked: !!e.checked });
      e.loose ? e.tokens[0]?.type === "paragraph" ? (e.tokens[0].text = n + " " + e.tokens[0].text, e.tokens[0].tokens && e.tokens[0].tokens.length > 0 && e.tokens[0].tokens[0].type === "text" && (e.tokens[0].tokens[0].text = n + " " + w(e.tokens[0].tokens[0].text), e.tokens[0].tokens[0].escaped = true)) : e.tokens.unshift({ type: "text", raw: n + " ", text: n + " ", escaped: true }) : t += n + " ";
    }
    return t += this.parser.parse(e.tokens, !!e.loose), `<li>${t}</li>
`;
  }
  checkbox({ checked: e }) {
    return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox">';
  }
  paragraph({ tokens: e }) {
    return `<p>${this.parser.parseInline(e)}</p>
`;
  }
  table(e) {
    let t = "", n = "";
    for (let i = 0; i < e.header.length; i++) n += this.tablecell(e.header[i]);
    t += this.tablerow({ text: n });
    let r = "";
    for (let i = 0; i < e.rows.length; i++) {
      let s = e.rows[i];
      n = "";
      for (let a = 0; a < s.length; a++) n += this.tablecell(s[a]);
      r += this.tablerow({ text: n });
    }
    return r && (r = `<tbody>${r}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + r + `</table>
`;
  }
  tablerow({ text: e }) {
    return `<tr>
${e}</tr>
`;
  }
  tablecell(e) {
    let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
    return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
  }
  strong({ tokens: e }) {
    return `<strong>${this.parser.parseInline(e)}</strong>`;
  }
  em({ tokens: e }) {
    return `<em>${this.parser.parseInline(e)}</em>`;
  }
  codespan({ text: e }) {
    return `<code>${w(e, true)}</code>`;
  }
  br(e) {
    return "<br>";
  }
  del({ tokens: e }) {
    return `<del>${this.parser.parseInline(e)}</del>`;
  }
  link({ href: e, title: t, tokens: n }) {
    let r = this.parser.parseInline(n), i = J(e);
    if (i === null) return r;
    e = i;
    let s = '<a href="' + e + '"';
    return t && (s += ' title="' + w(t) + '"'), s += ">" + r + "</a>", s;
  }
  image({ href: e, title: t, text: n, tokens: r }) {
    r && (n = this.parser.parseInline(r, this.parser.textRenderer));
    let i = J(e);
    if (i === null) return w(n);
    e = i;
    let s = `<img src="${e}" alt="${n}"`;
    return t && (s += ` title="${w(t)}"`), s += ">", s;
  }
  text(e) {
    return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : w(e.text);
  }
};
var $ = class {
  strong({ text: e }) {
    return e;
  }
  em({ text: e }) {
    return e;
  }
  codespan({ text: e }) {
    return e;
  }
  del({ text: e }) {
    return e;
  }
  html({ text: e }) {
    return e;
  }
  text({ text: e }) {
    return e;
  }
  link({ text: e }) {
    return "" + e;
  }
  image({ text: e }) {
    return "" + e;
  }
  br() {
    return "";
  }
};
var b = class l2 {
  options;
  renderer;
  textRenderer;
  constructor(e) {
    this.options = e || T, this.options.renderer = this.options.renderer || new P(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new $();
  }
  static parse(e, t) {
    return new l2(t).parse(e);
  }
  static parseInline(e, t) {
    return new l2(t).parseInline(e);
  }
  parse(e, t = true) {
    let n = "";
    for (let r = 0; r < e.length; r++) {
      let i = e[r];
      if (this.options.extensions?.renderers?.[i.type]) {
        let a = i, o = this.options.extensions.renderers[a.type].call({ parser: this }, a);
        if (o !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "html", "def", "paragraph", "text"].includes(a.type)) {
          n += o || "";
          continue;
        }
      }
      let s = i;
      switch (s.type) {
        case "space": {
          n += this.renderer.space(s);
          continue;
        }
        case "hr": {
          n += this.renderer.hr(s);
          continue;
        }
        case "heading": {
          n += this.renderer.heading(s);
          continue;
        }
        case "code": {
          n += this.renderer.code(s);
          continue;
        }
        case "table": {
          n += this.renderer.table(s);
          continue;
        }
        case "blockquote": {
          n += this.renderer.blockquote(s);
          continue;
        }
        case "list": {
          n += this.renderer.list(s);
          continue;
        }
        case "html": {
          n += this.renderer.html(s);
          continue;
        }
        case "def": {
          n += this.renderer.def(s);
          continue;
        }
        case "paragraph": {
          n += this.renderer.paragraph(s);
          continue;
        }
        case "text": {
          let a = s, o = this.renderer.text(a);
          for (; r + 1 < e.length && e[r + 1].type === "text"; ) a = e[++r], o += `
` + this.renderer.text(a);
          t ? n += this.renderer.paragraph({ type: "paragraph", raw: o, text: o, tokens: [{ type: "text", raw: o, text: o, escaped: true }] }) : n += o;
          continue;
        }
        default: {
          let a = 'Token with "' + s.type + '" type was not found.';
          if (this.options.silent) return console.error(a), "";
          throw new Error(a);
        }
      }
    }
    return n;
  }
  parseInline(e, t = this.renderer) {
    let n = "";
    for (let r = 0; r < e.length; r++) {
      let i = e[r];
      if (this.options.extensions?.renderers?.[i.type]) {
        let a = this.options.extensions.renderers[i.type].call({ parser: this }, i);
        if (a !== false || !["escape", "html", "link", "image", "strong", "em", "codespan", "br", "del", "text"].includes(i.type)) {
          n += a || "";
          continue;
        }
      }
      let s = i;
      switch (s.type) {
        case "escape": {
          n += t.text(s);
          break;
        }
        case "html": {
          n += t.html(s);
          break;
        }
        case "link": {
          n += t.link(s);
          break;
        }
        case "image": {
          n += t.image(s);
          break;
        }
        case "strong": {
          n += t.strong(s);
          break;
        }
        case "em": {
          n += t.em(s);
          break;
        }
        case "codespan": {
          n += t.codespan(s);
          break;
        }
        case "br": {
          n += t.br(s);
          break;
        }
        case "del": {
          n += t.del(s);
          break;
        }
        case "text": {
          n += t.text(s);
          break;
        }
        default: {
          let a = 'Token with "' + s.type + '" type was not found.';
          if (this.options.silent) return console.error(a), "";
          throw new Error(a);
        }
      }
    }
    return n;
  }
};
var S = class {
  options;
  block;
  constructor(e) {
    this.options = e || T;
  }
  static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(e) {
    return e;
  }
  postprocess(e) {
    return e;
  }
  processAllTokens(e) {
    return e;
  }
  emStrongMask(e) {
    return e;
  }
  provideLexer() {
    return this.block ? x.lex : x.lexInline;
  }
  provideParser() {
    return this.block ? b.parse : b.parseInline;
  }
};
var B = class {
  defaults = L();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = b;
  Renderer = P;
  TextRenderer = $;
  Lexer = x;
  Tokenizer = y;
  Hooks = S;
  constructor(...e) {
    this.use(...e);
  }
  walkTokens(e, t) {
    let n = [];
    for (let r of e) switch (n = n.concat(t.call(this, r)), r.type) {
      case "table": {
        let i = r;
        for (let s of i.header) n = n.concat(this.walkTokens(s.tokens, t));
        for (let s of i.rows) for (let a of s) n = n.concat(this.walkTokens(a.tokens, t));
        break;
      }
      case "list": {
        let i = r;
        n = n.concat(this.walkTokens(i.items, t));
        break;
      }
      default: {
        let i = r;
        this.defaults.extensions?.childTokens?.[i.type] ? this.defaults.extensions.childTokens[i.type].forEach((s) => {
          let a = i[s].flat(1 / 0);
          n = n.concat(this.walkTokens(a, t));
        }) : i.tokens && (n = n.concat(this.walkTokens(i.tokens, t)));
      }
    }
    return n;
  }
  use(...e) {
    let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
    return e.forEach((n) => {
      let r = { ...n };
      if (r.async = this.defaults.async || r.async || false, n.extensions && (n.extensions.forEach((i) => {
        if (!i.name) throw new Error("extension name required");
        if ("renderer" in i) {
          let s = t.renderers[i.name];
          s ? t.renderers[i.name] = function(...a) {
            let o = i.renderer.apply(this, a);
            return o === false && (o = s.apply(this, a)), o;
          } : t.renderers[i.name] = i.renderer;
        }
        if ("tokenizer" in i) {
          if (!i.level || i.level !== "block" && i.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
          let s = t[i.level];
          s ? s.unshift(i.tokenizer) : t[i.level] = [i.tokenizer], i.start && (i.level === "block" ? t.startBlock ? t.startBlock.push(i.start) : t.startBlock = [i.start] : i.level === "inline" && (t.startInline ? t.startInline.push(i.start) : t.startInline = [i.start]));
        }
        "childTokens" in i && i.childTokens && (t.childTokens[i.name] = i.childTokens);
      }), r.extensions = t), n.renderer) {
        let i = this.defaults.renderer || new P(this.defaults);
        for (let s in n.renderer) {
          if (!(s in i)) throw new Error(`renderer '${s}' does not exist`);
          if (["options", "parser"].includes(s)) continue;
          let a = s, o = n.renderer[a], p = i[a];
          i[a] = (...u) => {
            let c = o.apply(i, u);
            return c === false && (c = p.apply(i, u)), c || "";
          };
        }
        r.renderer = i;
      }
      if (n.tokenizer) {
        let i = this.defaults.tokenizer || new y(this.defaults);
        for (let s in n.tokenizer) {
          if (!(s in i)) throw new Error(`tokenizer '${s}' does not exist`);
          if (["options", "rules", "lexer"].includes(s)) continue;
          let a = s, o = n.tokenizer[a], p = i[a];
          i[a] = (...u) => {
            let c = o.apply(i, u);
            return c === false && (c = p.apply(i, u)), c;
          };
        }
        r.tokenizer = i;
      }
      if (n.hooks) {
        let i = this.defaults.hooks || new S();
        for (let s in n.hooks) {
          if (!(s in i)) throw new Error(`hook '${s}' does not exist`);
          if (["options", "block"].includes(s)) continue;
          let a = s, o = n.hooks[a], p = i[a];
          S.passThroughHooks.has(s) ? i[a] = (u) => {
            if (this.defaults.async && S.passThroughHooksRespectAsync.has(s)) return (async () => {
              let g = await o.call(i, u);
              return p.call(i, g);
            })();
            let c = o.call(i, u);
            return p.call(i, c);
          } : i[a] = (...u) => {
            if (this.defaults.async) return (async () => {
              let g = await o.apply(i, u);
              return g === false && (g = await p.apply(i, u)), g;
            })();
            let c = o.apply(i, u);
            return c === false && (c = p.apply(i, u)), c;
          };
        }
        r.hooks = i;
      }
      if (n.walkTokens) {
        let i = this.defaults.walkTokens, s = n.walkTokens;
        r.walkTokens = function(a) {
          let o = [];
          return o.push(s.call(this, a)), i && (o = o.concat(i.call(this, a))), o;
        };
      }
      this.defaults = { ...this.defaults, ...r };
    }), this;
  }
  setOptions(e) {
    return this.defaults = { ...this.defaults, ...e }, this;
  }
  lexer(e, t) {
    return x.lex(e, t ?? this.defaults);
  }
  parser(e, t) {
    return b.parse(e, t ?? this.defaults);
  }
  parseMarkdown(e) {
    return (n, r) => {
      let i = { ...r }, s = { ...this.defaults, ...i }, a = this.onError(!!s.silent, !!s.async);
      if (this.defaults.async === true && i.async === false) return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof n > "u" || n === null) return a(new Error("marked(): input parameter is undefined or null"));
      if (typeof n != "string") return a(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
      if (s.hooks && (s.hooks.options = s, s.hooks.block = e), s.async) return (async () => {
        let o = s.hooks ? await s.hooks.preprocess(n) : n, u = await (s.hooks ? await s.hooks.provideLexer() : e ? x.lex : x.lexInline)(o, s), c = s.hooks ? await s.hooks.processAllTokens(u) : u;
        s.walkTokens && await Promise.all(this.walkTokens(c, s.walkTokens));
        let h = await (s.hooks ? await s.hooks.provideParser() : e ? b.parse : b.parseInline)(c, s);
        return s.hooks ? await s.hooks.postprocess(h) : h;
      })().catch(a);
      try {
        s.hooks && (n = s.hooks.preprocess(n));
        let p = (s.hooks ? s.hooks.provideLexer() : e ? x.lex : x.lexInline)(n, s);
        s.hooks && (p = s.hooks.processAllTokens(p)), s.walkTokens && this.walkTokens(p, s.walkTokens);
        let c = (s.hooks ? s.hooks.provideParser() : e ? b.parse : b.parseInline)(p, s);
        return s.hooks && (c = s.hooks.postprocess(c)), c;
      } catch (o) {
        return a(o);
      }
    };
  }
  onError(e, t) {
    return (n) => {
      if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
        let r = "<p>An error occurred:</p><pre>" + w(n.message + "", true) + "</pre>";
        return t ? Promise.resolve(r) : r;
      }
      if (t) return Promise.reject(n);
      throw n;
    };
  }
};
var _ = new B();
function k(l3, e) {
  return _.parse(l3, e);
}
k.options = k.setOptions = function(l3) {
  return _.setOptions(l3), k.defaults = _.defaults, G(k.defaults), k;
};
k.getDefaults = L;
k.defaults = T;
k.use = function(...l3) {
  return _.use(...l3), k.defaults = _.defaults, G(k.defaults), k;
};
k.walkTokens = function(l3, e) {
  return _.walkTokens(l3, e);
};
k.parseInline = _.parseInline;
k.Parser = b;
k.parser = b.parse;
k.Renderer = P;
k.TextRenderer = $;
k.Lexer = x;
k.lexer = x.lex;
k.Tokenizer = y;
k.Hooks = S;
k.parse = k;
var Zt = k.options;
var Gt = k.setOptions;
var Nt = k.use;
var Ft = k.walkTokens;
var jt = k.parseInline;
var Ut = b.parse;
var Kt = x.lex;

// packages/shared/quote-whitespace.ts
var quoteWhitespace = (text2) => text2.replace(/\s+/gu, " ").trim();

// packages/dsh-px-workspace/src/quote-text.ts
function decode(text2) {
  const names = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text2.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, name2) => {
    if (name2[0] !== "#") return names[name2.toLowerCase()] ?? whole;
    const value = name2[1].toLowerCase() === "x" ? parseInt(name2.slice(2), 16) : Number(name2.slice(1));
    return value > 0 && value <= 1114111 ? String.fromCodePoint(value) : whole;
  });
}
function visible(tokens) {
  return tokens.map((token) => {
    if (token.type === "code" || token.type === "codespan")
      return token.text + (token.type === "code" ? "\n" : "");
    if (token.type === "br" || token.type === "space" || token.type === "hr") return "\n";
    if (token.type === "def") return "";
    if (token.type === "list") return token.items.map((item) => visible(item.tokens)).join("\n");
    if (token.type === "table")
      return [token.header, ...token.rows].map((row) => row.map((cell) => visible(cell.tokens)).join("	")).join("\n");
    if (token.type === "html")
      return decode(token.text.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, ""));
    const text2 = token.tokens ? visible(token.tokens) : decode(token.text ?? "");
    return text2 + (["paragraph", "heading", "blockquote"].includes(token.type) ? "\n\n" : "");
  }).join("");
}
function visibleMessageText(source) {
  if (source.length > 1e6) return void 0;
  try {
    return visible(x.lex(source, { gfm: true }));
  } catch {
    return void 0;
  }
}
function quoteMatches(source, quote) {
  if (source.includes(quote)) return true;
  const rendered = visibleMessageText(source);
  return rendered !== void 0 && !!quoteWhitespace(quote) && quoteWhitespace(rendered).includes(quoteWhitespace(quote));
}
function visibleQuoteOffset(source, quote) {
  const chars = [], offsets = [];
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (/\s/u.test(character)) {
      if (chars.length && chars.at(-1) !== " ") {
        chars.push(" ");
        offsets.push(index);
      }
    } else {
      chars.push(character);
      offsets.push(index);
    }
  }
  const found = chars.join("").indexOf(quoteWhitespace(quote));
  return found < 0 ? -1 : offsets[found];
}

// packages/dsh-px-workspace/src/store.ts
var InputError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
function identifier(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new InputError("\u8BB0\u5F55\u6807\u8BC6\u65E0\u6548");
  return value;
}
function text(value, max, required = true) {
  if (typeof value !== "string" || value.length > max || required && !value.trim())
    throw new InputError(`\u6587\u672C\u4E0D\u80FD\u4E3A\u7A7A\u4E14\u4E0D\u80FD\u8D85\u8FC7 ${max} \u5B57\u7B26`);
  return value;
}
function timing(value) {
  if (value?.kind === "once" && Number.isSafeInteger(value.at) && value.at > 0 && value.at < 864e13)
    return { kind: "once", at: value.at };
  if (value?.kind === "interval" && Number.isInteger(value.minutes) && value.minutes >= 1 && value.minutes <= 525600)
    return { kind: "interval", minutes: value.minutes };
  if (value?.kind === "daily" && typeof value.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))
    return { kind: "daily", time: value.time };
  throw new InputError("\u8BF7\u9009\u62E9\u6709\u6548\u65F6\u95F4\uFF1B\u95F4\u9694\u81F3\u5C11 1 \u5206\u949F");
}
function finite(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}
function validateWorkspaceState(v2) {
  if (v2?.version !== 1 || !Array.isArray(v2.annotations) || !Array.isArray(v2.schedules) || v2.annotations.length > 2e3 || v2.schedules.length > 100)
    throw new Error("\u5DE5\u4F5C\u533A\u6570\u636E\u683C\u5F0F\u4E0D\u53D7\u652F\u6301");
  const ids = /* @__PURE__ */ new Set();
  for (const a of v2.annotations) {
    identifier(a.id);
    identifier(a.sessionId);
    identifier(a.messageId);
    text(a.quote, 8e3);
    text(a.note, 4e3, false);
    if (!Number.isInteger(a.seq) || a.seq < 0 || !["user", "assistant"].includes(a.role) || !/^[a-f0-9]{64}$/.test(a.sourceHash) || !finite(a.updatedAt) || ids.has(a.id))
      throw new Error("\u6279\u6CE8\u6570\u636E\u635F\u574F");
    ids.add(a.id);
  }
  for (const s of v2.schedules) {
    identifier(s.id);
    identifier(s.sessionId);
    text(s.title, 100);
    text(s.prompt, 4e3);
    timing(s.timing);
    if (typeof s.enabled !== "boolean" || !(s.nextAt === null || finite(s.nextAt)) || s.enabled && s.nextAt === null || !finite(s.updatedAt) || !Array.isArray(s.history) || s.history.length > 20 || ids.has(s.id))
      throw new Error("\u5B9A\u65F6\u4EFB\u52A1\u6570\u636E\u635F\u574F");
    if (typeof s.timeZone !== "string") throw new Error("\u4EFB\u52A1\u65F6\u533A\u7F3A\u5931");
    new Intl.DateTimeFormat("en", { timeZone: s.timeZone });
    for (const h of s.history)
      if (!finite(h.time) || ![
        "dispatching",
        "queued",
        "uncertain",
        "running",
        "completed",
        "failed",
        "cancelled",
        "interrupted"
      ].includes(h.status) || typeof h.requestId !== "string" || h.detail !== void 0 && typeof h.detail !== "string" || h.turn !== void 0 && (!Number.isSafeInteger(h.turn) || h.turn < 0) || h.startedAt !== void 0 && !finite(h.startedAt) || h.finishedAt !== void 0 && !finite(h.finishedAt))
        throw new Error("\u6295\u9012\u8BB0\u5F55\u635F\u574F");
    ids.add(s.id);
  }
}
var maxBytes = 32 * 1024 * 1024;
function readState(path) {
  if (statSync(path).size > maxBytes) throw new Error("\u5DE5\u4F5C\u533A\u6570\u636E\u6587\u4EF6\u8FC7\u5927");
  const state = JSON.parse(readFileSync(path, "utf8"));
  validateWorkspaceState(state);
  return state;
}
function writeAtomic(path, value) {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, value, { mode: 384, flag: "wx", flush: true });
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}
function fileRevision(path) {
  try {
    const stat = statSync(path);
    return createHash("sha256").update(
      stat.size <= maxBytes ? readFileSync(path) : `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`
    ).digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}
var WorkspaceStore = class _WorkspaceStore {
  constructor(path) {
    this.path = path;
    try {
      this.state = readState(path);
    } catch (error) {
      if (error?.code !== "ENOENT" || ["last-good", "previous"].some((id) => existsSync(`${path}.${id}.json`)))
        throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u4F1A\u8BDD\u5DE5\u4F5C\u533A\u6570\u636E\uFF0C\u8BF7\u4FDD\u7559\u539F\u6587\u4EF6\u5E76\u68C0\u67E5\u65E5\u5FD7\u3002" + String(error));
      this.state = { version: 1, annotations: [], schedules: [] };
    }
    this.revision = fileRevision(path);
    if (this.revision !== "missing") {
      try {
        writeAtomic(this.path + ".last-good.json", JSON.stringify(this.state));
      } catch {
        diagnostic("workspace.backup-failed", { path: this.path });
      }
    }
  }
  state;
  revision;
  static status(path) {
    let ready = true, error;
    try {
      readState(path);
    } catch (failure) {
      if (failure?.code !== "ENOENT") {
        ready = false;
        error = "\u6279\u6CE8\u4E0E\u5B9A\u65F6\u914D\u7F6E\u65E0\u6CD5\u8BFB\u53D6\u3002\u539F\u6587\u4EF6\u5DF2\u4FDD\u7559\uFF1B\u53EF\u6062\u590D\u6709\u6548\u5FEB\u7167\uFF0C\u4F1A\u8BDD\u6B63\u6587\u548C\u4EA7\u7269\u4ECD\u53EF\u67E5\u770B\u3002";
      }
    }
    const snapshots = [];
    for (const id of ["last-good", "previous"]) {
      const snapshotPath = `${path}.${id}.json`;
      try {
        const state = readState(snapshotPath);
        snapshots.push({
          id,
          createdAt: statSync(snapshotPath).mtimeMs,
          annotations: state.annotations.length,
          schedules: state.schedules.length
        });
      } catch {
      }
    }
    if (!existsSync(path) && ["last-good", "previous"].some((id) => existsSync(`${path}.${id}.json`))) {
      ready = false;
      error = "\u6279\u6CE8\u4E0E\u5B9A\u65F6\u914D\u7F6E\u6587\u4EF6\u7F3A\u5931\u3002\u73B0\u6709\u5FEB\u7167\u5DF2\u4FDD\u7559\uFF0C\u53EF\u6062\u590D\u540E\u7EE7\u7EED\u4F7F\u7528\u3002";
    }
    return { ready, revision: fileRevision(path), ...error ? { error } : {}, snapshots };
  }
  static restore(path, snapshotId, revision, now = Date.now()) {
    if (snapshotId !== "last-good" && snapshotId !== "previous") throw new InputError("\u6062\u590D\u5FEB\u7167\u65E0\u6548");
    const status = this.status(path);
    if (status.ready) throw new InputError("\u5F53\u524D\u6570\u636E\u53EF\u8BFB\u53D6\uFF0C\u65E0\u9700\u6062\u590D", 409);
    if (typeof revision !== "string" || revision !== status.revision)
      throw new InputError("\u5B58\u50A8\u6587\u4EF6\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5", 409);
    const recovered = readState(`${path}.${snapshotId}.json`);
    for (const schedule of recovered.schedules) {
      schedule.enabled = false;
      schedule.nextAt = null;
      schedule.updatedAt = Math.max(now, schedule.updatedAt + 1);
      for (const dispatch of schedule.history)
        if (["dispatching", "queued", "running"].includes(dispatch.status)) {
          dispatch.status = "uncertain";
          dispatch.detail = "\u4ECE\u5907\u4EFD\u6062\u590D\uFF1B\u8BF7\u5148\u68C0\u67E5\u76EE\u6807\u4F1A\u8BDD\u7684\u6267\u884C\u7ED3\u679C\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u7EE7\u7EED\u3002";
        }
    }
    validateWorkspaceState(recovered);
    if (revision !== "missing")
      copyFileSync(path, `${path}.corrupt-${now}-${randomUUID()}.json`, constants.COPYFILE_EXCL);
    if (fileRevision(path) !== revision) throw new InputError("\u5B58\u50A8\u6587\u4EF6\u5728\u6062\u590D\u524D\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5", 409);
    writeAtomic(path, JSON.stringify(recovered));
    return new _WorkspaceStore(path);
  }
  snapshot() {
    return structuredClone(this.state);
  }
  schedules() {
    return structuredClone(this.state.schedules);
  }
  annotations(sessionId, before) {
    const all = this.state.annotations.filter((a) => a.sessionId === sessionId).sort((a, b2) => b2.updatedAt - a.updatedAt || (a.id < b2.id ? 1 : a.id > b2.id ? -1 : 0));
    let rows = all;
    if (before !== void 0) {
      const match = /^(\d{1,15}):([a-zA-Z0-9_-]{1,200})$/.exec(before);
      if (!match) throw new InputError("\u6279\u6CE8\u5206\u9875\u53C2\u6570\u65E0\u6548");
      const time = Number(match[1]), id = match[2];
      rows = rows.filter((a) => a.updatedAt < time || a.updatedAt === time && a.id < id);
    }
    const page = rows.slice(0, 20), last = page[page.length - 1];
    return {
      annotations: structuredClone(page),
      total: all.length,
      nextBefore: rows.length > 20 ? `${last.updatedAt}:${last.id}` : null
    };
  }
  update(fn) {
    const next = this.snapshot();
    fn(next);
    validateWorkspaceState(next);
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > 32 * 1024 * 1024)
      throw new InputError("\u5DE5\u4F5C\u533A\u8BB0\u5F55\u5DF2\u8FBE 32 MB \u4E0A\u9650\uFF0C\u8BF7\u5148\u6E05\u7406\u65E7\u6279\u6CE8\u6216\u4EFB\u52A1");
    mkdirSync(dirname(this.path), { recursive: true });
    if (fileRevision(this.path) !== this.revision)
      throw new InputError("\u5B58\u50A8\u6587\u4EF6\u5DF2\u88AB\u5176\u4ED6\u64CD\u4F5C\u4FEE\u6539\uFF1B\u4E3A\u4FDD\u7559\u6570\u636E\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u670D\u52A1\u540E\u91CD\u8BD5\u3002", 409);
    try {
      const disk = readState(this.path);
      writeAtomic(this.path + ".previous.json", JSON.stringify(disk));
    } catch (error) {
      if (error?.code !== "ENOENT")
        throw new InputError("\u73B0\u6709\u6570\u636E\u6216\u5907\u4EFD\u65E0\u6CD5\u8BFB\u53D6\uFF1B\u672A\u5199\u5165\u4FEE\u6539\uFF0C\u8BF7\u68C0\u67E5\u6570\u636E\u76EE\u5F55\u3002", 503);
    }
    writeAtomic(this.path, serialized);
    this.state = next;
    this.revision = createHash("sha256").update(serialized).digest("hex");
    try {
      writeAtomic(this.path + ".last-good.json", serialized);
    } catch {
      diagnostic("workspace.backup-failed", { path: this.path });
    }
  }
  saveAnnotation(input, source, now = Date.now()) {
    const sessionId = identifier(input.sessionId);
    const quote = text(input.quote, 8e3), note = text(input.note, 4e3, false);
    if (source.id !== input.messageId || !quoteMatches(source.text, quote))
      throw new InputError("\u5F15\u7528\u5FC5\u987B\u662F\u6240\u9009\u6D88\u606F\u4E2D\u7684\u8FDE\u7EED\u539F\u6587");
    const id = input.id === void 0 ? randomUUID() : identifier(input.id);
    const sourceHash = createHash("sha256").update(source.text).digest("hex");
    let saved;
    this.update((state) => {
      const old = state.annotations.find((a) => a.id === id);
      if (input.id !== void 0 && !old) throw new InputError("\u6279\u6CE8\u5DF2\u5220\u9664", 404);
      if (old && (old.sessionId !== sessionId || old.messageId !== source.id || old.updatedAt !== input.updatedAt))
        throw new InputError("\u6279\u6CE8\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5", 409);
      if (!old && state.annotations.length >= 2e3) throw new InputError("\u6279\u6CE8\u5DF2\u8FBE\u4E0A\u9650\uFF0C\u8BF7\u5148\u6E05\u7406\u65E7\u6279\u6CE8");
      saved = {
        id,
        sessionId,
        messageId: source.id,
        seq: source.seq,
        role: source.role,
        sourceHash,
        quote,
        note,
        updatedAt: Math.max(now, (old?.updatedAt ?? 0) + 1)
      };
      state.annotations = [...state.annotations.filter((a) => a.id !== id), saved];
    });
    return saved;
  }
  deleteAnnotation(input) {
    const id = identifier(input.id);
    this.update((state) => {
      const old = state.annotations.find((a) => a.id === id);
      if (!old) throw new InputError("\u6279\u6CE8\u5DF2\u5220\u9664", 404);
      if (old.updatedAt !== input.updatedAt) throw new InputError("\u6279\u6CE8\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0", 409);
      state.annotations = state.annotations.filter((a) => a.id !== id);
    });
  }
};
function withFact(previous, fact) {
  return {
    ...previous,
    status: fact.status,
    detail: fact.detail,
    turn: fact.turn,
    startedAt: fact.startedAt,
    finishedAt: fact.finishedAt
  };
}
var Scheduler = class {
  constructor(store, deliver, zoneSource = () => Intl.DateTimeFormat().resolvedOptions().timeZone, now = Date.now, observe) {
    this.store = store;
    this.deliver = deliver;
    this.zoneSource = zoneSource;
    this.now = now;
    this.observe = observe;
    const interrupted = store.schedules().some((s) => s.history.some((h) => h.status === "dispatching"));
    if (interrupted)
      store.update((state) => {
        for (const s of state.schedules)
          if (s.history.some((h) => h.status === "dispatching")) {
            s.enabled = false;
            s.nextAt = null;
            s.updatedAt = this.now();
            for (const h of s.history)
              if (h.status === "dispatching") {
                h.status = "uncertain";
                h.detail = "\u4E0A\u6B21\u6295\u9012\u671F\u95F4\u670D\u52A1\u4E2D\u65AD\uFF1B\u8BF7\u5148\u68C0\u67E5\u76EE\u6807\u4F1A\u8BDD\uFF0C\u786E\u8BA4\u540E\u518D\u542F\u7528\u6216\u7ACB\u5373\u6295\u9012\u3002";
              }
          }
      });
  }
  busy = /* @__PURE__ */ new Set();
  stopped = false;
  ticking = false;
  get zone() {
    return typeof this.zoneSource === "function" ? this.zoneSource() : this.zoneSource;
  }
  stop() {
    this.stopped = true;
  }
  save(input) {
    const id = input.id === void 0 ? randomUUID() : identifier(input.id);
    this.guard(id);
    const title = text(input.title, 100), prompt = text(input.prompt, 4e3), sessionId = identifier(input.sessionId), rule = timing(input.timing);
    if (typeof input.enabled !== "boolean") throw new InputError("\u542F\u7528\u72B6\u6001\u65E0\u6548");
    const now = this.now();
    if (input.enabled && rule.kind === "once" && rule.at <= now)
      throw new InputError("\u4E00\u6B21\u6027\u4EFB\u52A1\u8BF7\u9009\u62E9\u5C06\u6765\u7684\u65F6\u95F4");
    let saved;
    this.store.update((state) => {
      const old = state.schedules.find((s) => s.id === id);
      if (input.id !== void 0 && !old) throw new InputError("\u4EFB\u52A1\u5DF2\u5220\u9664", 404);
      if (old && old.updatedAt !== input.updatedAt) throw new InputError("\u4EFB\u52A1\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5", 409);
      if (old && old.sessionId !== sessionId && old.history.some((h) => h.status === "queued" || h.status === "running" || h.status === "uncertain"))
        throw new InputError(
          "\u4E0A\u6B21\u89E6\u53D1\u5C1A\u672A\u786E\u8BA4\u7ED3\u675F\uFF0C\u4E0D\u80FD\u66F4\u6539\u76EE\u6807\u4F1A\u8BDD\uFF1B\u8BF7\u5148\u6838\u5BF9\u539F\u4F1A\u8BDD\u3002\u7ED3\u679C\u4ECD\u4E0D\u786E\u5B9A\u65F6\uFF0C\u8BF7\u4E3A\u65B0\u76EE\u6807\u65B0\u5EFA\u4EFB\u52A1\u3002",
          409
        );
      if (!old && state.schedules.length >= 100) throw new InputError("\u4EFB\u52A1\u5DF2\u8FBE\u4E0A\u9650\uFF0C\u8BF7\u5148\u6E05\u7406");
      if (input.enabled && state.schedules.filter((s) => s.id !== id && s.enabled).length >= 20)
        throw new InputError("\u6700\u591A\u540C\u65F6\u542F\u7528 20 \u4E2A\u5B9A\u65F6\u4EFB\u52A1");
      const unchanged = old?.enabled && old.timeZone === this.zone && JSON.stringify(old.timing) === JSON.stringify(rule);
      saved = {
        id,
        title,
        sessionId,
        prompt,
        timing: rule,
        enabled: input.enabled,
        nextAt: input.enabled ? unchanged ? old.nextAt : nextOccurrence(rule, now) : null,
        timeZone: this.zone,
        history: old?.history ?? [],
        updatedAt: Math.max(now, (old?.updatedAt ?? 0) + 1)
      };
      state.schedules = [...state.schedules.filter((s) => s.id !== id), saved];
    });
    return saved;
  }
  remove(input) {
    this.guard(identifier(input.id));
    this.store.update((state) => {
      const s = state.schedules.find((s2) => s2.id === input.id);
      if (!s) throw new InputError("\u4EFB\u52A1\u5DF2\u5220\u9664", 404);
      if (s.updatedAt !== input.updatedAt) throw new InputError("\u4EFB\u52A1\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0", 409);
      state.schedules = state.schedules.filter((s2) => s2.id !== input.id);
    });
  }
  guard(id) {
    if (this.stopped) throw new InputError("\u8C03\u5EA6\u670D\u52A1\u5DF2\u505C\u6B62", 503);
    if (this.busy.has(id)) throw new InputError("\u4EFB\u52A1\u6B63\u5728\u6295\u9012\uFF0C\u8BF7\u7A0D\u540E\u64CD\u4F5C", 409);
  }
  async tick() {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      await this.reconcile();
      if (this.stopped) return;
      const due = this.store.schedules().filter(
        (s) => s.enabled && (s.timeZone !== this.zone || s.nextAt !== null && s.nextAt <= this.now() && !s.history.some((h) => h.status === "queued" || h.status === "running")) && !this.busy.has(s.id)
      ).slice(0, 3);
      for (const snapshot of due) {
        if (this.stopped) return;
        const s = this.store.schedules().find((s2) => s2.id === snapshot.id);
        if (!s || !s.enabled || s.updatedAt !== snapshot.updatedAt || s.nextAt !== snapshot.nextAt || this.busy.has(s.id))
          continue;
        if (s.timeZone !== this.zone) {
          this.store.update((state) => {
            const row = state.schedules.find((r) => r.id === s.id);
            row.enabled = false;
            row.nextAt = null;
            row.updatedAt = Math.max(this.now(), row.updatedAt + 1);
            row.history = [
              {
                requestId: randomUUID(),
                time: this.now(),
                status: "uncertain",
                detail: "\u672C\u673A\u65F6\u533A\u5DF2\u53D8\u5316\uFF0C\u4EFB\u52A1\u6682\u505C\uFF1B\u8BF7\u7F16\u8F91\u786E\u8BA4\u65F6\u95F4\u540E\u542F\u7528\u3002"
              },
              ...row.history
            ].slice(0, 20);
          });
        } else if (s.nextAt !== null && s.nextAt <= this.now()) await this.run(s.id);
      }
    } finally {
      this.ticking = false;
    }
  }
  async reconcile() {
    if (!this.observe || this.stopped) return;
    const candidates = this.store.schedules().filter((s) => s.history.some((h) => ["queued", "running", "uncertain"].includes(h.status)));
    for (const schedule of candidates) {
      if (this.stopped) return;
      let facts;
      try {
        facts = await this.observe(schedule);
      } catch (error) {
        if (error?.status !== 404 && error?.code !== "SESSION_NOT_FOUND") continue;
        facts = schedule.history.filter((h) => ["queued", "running"].includes(h.status)).map((h) => ({
          ...h,
          status: "interrupted",
          finishedAt: this.now(),
          detail: "\u76EE\u6807\u4F1A\u8BDD\u5DF2\u4E0D\u5B58\u5728\uFF1B\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u6682\u505C\uFF0C\u8BF7\u9009\u62E9\u6709\u6548\u4F1A\u8BDD\u3002"
        }));
      }
      if (this.stopped) return;
      const current = this.store.schedules().find((s) => s.id === schedule.id);
      if (!current || this.busy.has(current.id)) continue;
      const changed = facts.filter((fact) => {
        const old = current.history.find((h) => h.requestId === fact.requestId);
        return old && ["queued", "running", "uncertain"].includes(old.status) && JSON.stringify(withFact(old, fact)) !== JSON.stringify(old);
      });
      if (!changed.length) continue;
      this.store.update((state) => {
        const row = state.schedules.find((s) => s.id === schedule.id);
        for (const fact of changed) {
          const old = row.history.find((h) => h.requestId === fact.requestId);
          Object.assign(old, withFact(old, fact));
          if (["failed", "interrupted"].includes(fact.status)) {
            row.enabled = false;
            row.nextAt = null;
          }
        }
        row.updatedAt = Math.max(this.now(), row.updatedAt + 1);
      });
    }
  }
  async run(id) {
    this.guard(identifier(id));
    const schedule = this.store.schedules().find((s) => s.id === id);
    if (!schedule) throw new InputError("\u4EFB\u52A1\u4E0D\u5B58\u5728", 404);
    if (schedule.history.some((h) => h.status === "queued" || h.status === "running"))
      throw new InputError("\u4E0A\u6B21\u89E6\u53D1\u4ECD\u5728\u961F\u5217\u6216\u6267\u884C\u4E2D\uFF0C\u8BF7\u5148\u67E5\u770B\u76EE\u6807\u4F1A\u8BDD\u3002", 409);
    const now = this.now(), requestId = randomUUID();
    this.busy.add(id);
    try {
      this.store.update((state) => {
        const s = state.schedules.find((s2) => s2.id === id);
        s.history = [{ requestId, time: now, status: "dispatching" }, ...s.history].slice(0, 20);
        s.updatedAt = Math.max(now, s.updatedAt + 1);
        if (s.timing.kind === "once") {
          s.enabled = false;
          s.nextAt = null;
        } else if (s.enabled && (s.nextAt ?? 0) <= now) s.nextAt = nextOccurrence(s.timing, now);
      });
      diagnostic("schedule.dispatching", { taskId: id, sessionId: schedule.sessionId, requestId });
      let detail;
      try {
        await this.deliver(schedule, requestId);
      } catch (error) {
        detail = "\u6295\u9012\u672A\u786E\u8BA4\uFF0C\u8BF7\u5148\u68C0\u67E5\u76EE\u6807\u4F1A\u8BDD\u518D\u91CD\u8BD5\u3002" + String(error).slice(0, 500);
      }
      if (this.stopped) throw new InputError("\u670D\u52A1\u5728\u6295\u9012\u671F\u95F4\u505C\u6B62\uFF1B\u91CD\u542F\u540E\u8BF7\u5148\u68C0\u67E5\u76EE\u6807\u4F1A\u8BDD\u3002", 503);
      try {
        this.store.update((state) => {
          const s = state.schedules.find((s2) => s2.id === id);
          const h = s.history.find((h2) => h2.requestId === requestId);
          h.status = detail ? "uncertain" : "queued";
          h.detail = detail;
          s.updatedAt = Math.max(this.now(), s.updatedAt + 1);
          if (detail) {
            s.enabled = false;
            s.nextAt = null;
          }
        });
      } catch {
        this.stop();
        throw new InputError("\u6295\u9012\u7ED3\u679C\u65E0\u6CD5\u4FDD\u5B58\uFF1B\u8C03\u5EA6\u5DF2\u505C\u6B62\u3002\u8BF7\u68C0\u67E5\u76EE\u6807\u4F1A\u8BDD\u4E0E\u6570\u636E\u76EE\u5F55\u540E\u91CD\u542F\u5E94\u7528\u3002", 503);
      }
      diagnostic("schedule.settled", {
        taskId: id,
        sessionId: schedule.sessionId,
        requestId,
        status: detail ? "uncertain" : "queued"
      });
      return this.store.schedules().find((s) => s.id === id);
    } finally {
      this.busy.delete(id);
    }
  }
};

// packages/shared/session-errors.ts
function readFailure(error) {
  const e = error;
  if (e?.name === "SessionPersistenceNotFoundError" || e?.code === "ENOENT")
    return {
      status: 404,
      code: "SESSION_NOT_FOUND",
      error: "\u6B64\u4F1A\u8BDD\u8BB0\u5F55\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u4F1A\u8BDD\u3002",
      retryable: false
    };
  if (e?.name === "SessionPersistenceCorruptionError" || e instanceof SyntaxError || /^(?:corrupt (?:Zstandard )?session log(?::| ")|empty or header-less (?:Zstandard )?session log$)/.test(
    e?.message ?? ""
  ))
    return {
      status: 422,
      code: "SESSION_CORRUPT",
      error: "\u4F1A\u8BDD\u8BB0\u5F55\u635F\u574F\uFF0C\u65E0\u6CD5\u53EF\u9760\u8BFB\u53D6\u3002\u8BF7\u4FDD\u7559\u65E5\u5FD7\u5E76\u68C0\u67E5\u5907\u4EFD\u3002",
      retryable: false
    };
  if (e?.name === "SessionFormatUnsupportedError")
    return {
      status: 409,
      code: "SESSION_FORMAT_UNSUPPORTED",
      error: "\u5F53\u524D\u7248\u672C\u65E0\u6CD5\u8BFB\u53D6\u6B64\u4F1A\u8BDD\u683C\u5F0F\uFF0C\u8BF7\u4F7F\u7528\u517C\u5BB9\u7248\u672C\u3002",
      retryable: false
    };
  if (["EACCES", "EPERM"].includes(e?.code ?? ""))
    return {
      status: 403,
      code: "SESSION_ACCESS_DENIED",
      error: "\u6CA1\u6709\u8BFB\u53D6\u4F1A\u8BDD\u8BB0\u5F55\u7684\u6743\u9650\uFF0C\u8BF7\u68C0\u67E5\u6570\u636E\u76EE\u5F55\u6743\u9650\u3002",
      retryable: false
    };
  if (["EBUSY", "EAGAIN", "ETIMEDOUT"].includes(e?.code ?? "") || e?.name === "SessionAlreadyOwnedError")
    return { status: 503, code: "SESSION_BUSY", error: "\u4F1A\u8BDD\u8BB0\u5F55\u6682\u65F6\u4E0D\u53EF\u8BFB\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", retryable: true };
  return {
    status: 500,
    code: "SESSION_READ_FAILED",
    error: "\u8BFB\u53D6\u4F1A\u8BDD\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u6216\u68C0\u67E5\u670D\u52A1\u65E5\u5FD7\u3002",
    retryable: true
  };
}

// packages/dsh-px-workspace/src/import-index.ts
import { existsSync as existsSync3, lstatSync as lstatSync2, readFileSync as readFileSync2, readdirSync } from "node:fs";
import { basename, join } from "node:path";

// src/main/native-atomic.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import {
  closeSync,
  existsSync as existsSync2,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync as renameSync2,
  rmSync,
  writeFileSync as writeFileSync2
} from "node:fs";
var TRANSIENT_CODES = /* @__PURE__ */ new Set(["EACCES", "EBUSY", "EPERM"]);
var RETRY_LIMIT = 8;
var RETRY_INITIAL_MS = 20;
var RETRY_MAX_MS = 200;
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function retryTransient(operation, windows = process.platform === "win32") {
  let delay = RETRY_INITIAL_MS;
  for (let retries = 0; ; retries++) {
    try {
      return operation();
    } catch (error) {
      const code = error?.code ?? "";
      if (!windows || !TRANSIENT_CODES.has(code) || retries >= RETRY_LIMIT) throw error;
    }
    sleepSync(delay);
    delay = Math.min(delay * 2, RETRY_MAX_MS);
  }
}
function renameWithRetry(from, to) {
  retryTransient(() => renameSync2(from, to));
}
function assertRegularOrAbsent(path, label = "Target") {
  if (existsSync2(path) && !lstatSync(path).isFile()) throw new Error(`${label} must be a regular file`);
}
var defaultOperations = {
  rename: renameWithRetry,
  remove: (path) => rmSync(path, { force: true })
};
function writeAtomic2(file, bytes, operations = defaultOperations) {
  assertRegularOrAbsent(file);
  const temporary = `${file}.${randomUUID2()}.tmp`;
  let renamed = false;
  try {
    const fd = openSync(temporary, "wx", 384);
    try {
      writeFileSync2(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    operations.rename(temporary, file);
    renamed = true;
  } finally {
    if (!renamed) operations.remove(temporary);
  }
}

// packages/dsh-px-workspace/src/import-index.ts
async function indexImportedSessions(home, host, signal) {
  const root = join(home, "backups");
  if (!existsSync3(root) || lstatSync2(root).isSymbolicLink()) return;
  for (const name2 of readdirSync(root)) {
    if (!/^px-import-[a-f0-9-]{36}$/.test(name2)) continue;
    const dir = join(root, name2), file = join(dir, "import.json");
    if (lstatSync2(dir).isSymbolicLink() || !existsSync3(file) || lstatSync2(file).isSymbolicLink()) continue;
    const report = JSON.parse(readFileSync2(file, "utf8"));
    if (report.complete !== true || report.indexed === true && report.indexVersion === 1 || !Array.isArray(report.sessions) || report.sessions.length > 1e4)
      continue;
    const errors = [], skipped = [];
    let indexed = 0;
    for (const item of report.sessions) {
      signal.throwIfAborted();
      if (typeof item !== "string") throw new Error("\u5BFC\u5165\u8BB0\u5F55\u683C\u5F0F\u65E0\u6548");
      const id = basename(item.replaceAll("\\", "/"));
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error("\u5BFC\u5165\u8BB0\u5F55\u4F1A\u8BDD\u6807\u8BC6\u65E0\u6548");
      try {
        const { meta } = await host.sessionController.inspect(id, signal);
        signal.throwIfAborted();
        if (!meta.cwd || meta.origin === "subagent" || !existsSync3(meta.cwd)) {
          skipped.push(id);
          continue;
        }
        await host.sessionController.projections({ sessionId: id }, signal);
        signal.throwIfAborted();
        const workspace = await host.workspaceRegistry.create(meta.cwd);
        signal.throwIfAborted();
        await workspace.attachSession(id);
        indexed++;
      } catch (error) {
        signal.throwIfAborted();
        errors.push(id + ": " + String(error));
      }
    }
    writeAtomic2(
      file,
      JSON.stringify(
        {
          ...report,
          indexed: errors.length === 0,
          indexVersion: 1,
          indexedSessions: indexed,
          skippedSessions: skipped,
          indexErrors: errors
        },
        null,
        2
      )
    );
  }
}

// packages/dsh-px-workspace/src/selection-source.ts
function selectionSource(source, quote) {
  if (!source) throw new InputError("\u6D88\u606F\u5C1A\u672A\u4FDD\u5B58\u6216\u6CA1\u6709\u53EF\u5F15\u7528\u7684\u6B63\u6587", 404);
  if (typeof quote !== "string" || !quote.trim() || quote.length > 8e3)
    throw new InputError("\u5F15\u7528\u7247\u6BB5\u987B\u4E3A 1\u20138000 \u5B57\u7B26");
  let body2 = source.text, found = body2.indexOf(quote), rendered = false;
  if (found < 0) {
    const projected = visibleMessageText(source.text);
    if (projected !== void 0) {
      body2 = projected;
      found = visibleQuoteOffset(body2, quote);
      rendered = true;
    }
  }
  if (found < 0)
    throw new InputError("\u9009\u533A\u8DE8\u8D8A\u4E86\u6B63\u6587\u683C\u5F0F\u6216\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u8BF7\u4F7F\u7528\u6D88\u606F\u4E0B\u65B9\u201C\u5F15\u7528 / \u6279\u6CE8\u201D\u5728\u539F\u6587\u4E2D\u9009\u62E9");
  const offset = Math.max(0, found - 1e3);
  return {
    ...source,
    text: body2.slice(offset, offset + 32e3),
    rendered,
    offset,
    length: body2.length,
    nextOffset: !rendered && offset + 32e3 < body2.length ? offset + 32e3 : null
  };
}

// packages/dsh-px-workspace/src/index.ts
var name = "dsh-px-workspace";
var inject = [];
var DEFAULTS = { routePrefix: "/dsh-px-workspace" };
async function body(req) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
    throw new InputError("\u8BF7\u4F7F\u7528 JSON \u8BF7\u6C42", 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 64e3) throw new InputError("\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new InputError("JSON \u5185\u5BB9\u65E0\u6548");
  }
}
function numberParam(params, key, fallback) {
  if (!params.has(key)) return fallback;
  const v2 = params.get(key);
  if (!/^\d{1,15}$/.test(v2) || params.getAll(key).length !== 1) throw new InputError("\u5206\u9875\u53C2\u6570\u65E0\u6548");
  return Number(v2);
}
function apply(ctx) {
  ctx.inject(["workspaceRegistry", "sessionController"], (host) => {
    const controller = new AbortController();
    host.effect(() => () => controller.abort(), "workspace: imported history index");
    if (process.env.DSH_HOME)
      void indexImportedSessions(process.env.DSH_HOME, host, controller.signal).catch((error) => {
        if (!controller.signal.aborted) host.logger?.warn("\u5BFC\u5165\u4F1A\u8BDD\u7D22\u5F15\u672A\u5B8C\u6210", String(error));
      });
  });
  ctx.inject(["connection", "webServer", "sessions", "sessionController", "sessionPersistence"], (host) => {
    const lifetime = new AbortController();
    let delivery = new AbortController();
    let store, scheduler, loadError = "";
    const path = process.env.DSH_HOME ? join2(process.env.DSH_HOME, "storages", name, "workspace.json") : void 0;
    const contentCache = /* @__PURE__ */ new Map();
    const inspect = async (id) => {
      const live = host.sessions.get(identifier(id));
      if (live) return { meta: live.header, events: live.snapshotEvents() };
      try {
        return await host.sessionController.inspect(id);
      } catch (error) {
        if (error?.constructor?.name === "ApiSessionNotFound" || error?.code === "SESSION_QUERY_SESSION_NOT_FOUND")
          throw new InputError("\u6B64\u4F1A\u8BDD\u8BB0\u5F55\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u4F1A\u8BDD\u3002", 404);
        throw error;
      }
    };
    const content = async (id) => {
      identifier(id);
      const live = host.sessions.get(id), cached = contentCache.get(id);
      let value;
      if (live) {
        value = {
          index: cached?.live === live ? cached.index : new SessionContentIndex(),
          live,
          meta: live.header
        };
        value.index.update(live.snapshotEvents());
      } else {
        const revision = (await host.sessionPersistence?.stat(id))?.revision;
        if (revision && cached && !cached.live && cached.revision === revision) return cached;
        const snapshot = await inspect(id);
        const after = (await host.sessionPersistence?.stat(id))?.revision;
        value = {
          index: new SessionContentIndex().update(snapshot.events),
          meta: snapshot.meta,
          revision: revision && revision === after ? revision : void 0
        };
      }
      contentCache.delete(id);
      contentCache.set(id, value);
      let chars = [...contentCache.values()].reduce((sum, item) => sum + item.index.cacheCost, 0);
      while (contentCache.size > 8 || chars > 16e6) {
        const oldest = contentCache.keys().next().value;
        chars -= contentCache.get(oldest).index.cacheCost;
        contentCache.delete(oldest);
      }
      return value;
    };
    const target = async (id) => {
      const { meta } = await inspect(id);
      if (meta.origin === "subagent") throw new InputError("\u5B9A\u65F6\u4EFB\u52A1\u8BF7\u9009\u62E9\u666E\u901A\u4F1A\u8BDD\uFF1B\u5B50 Agent \u7531\u5176\u7236\u4EFB\u52A1\u7BA1\u7406");
    };
    const initialize = (nextStore) => {
      if (!path) throw new Error("DSH_HOME \u672A\u8BBE\u7F6E");
      scheduler?.stop();
      delivery.abort();
      delivery = new AbortController();
      const signal = delivery.signal;
      store = nextStore ?? new WorkspaceStore(path);
      scheduler = new Scheduler(
        store,
        async (schedule, requestId) => {
          await target(schedule.sessionId);
          const result = await host.sessionController.prompt(
            {
              requestId,
              sessionId: schedule.sessionId,
              mode: "queue",
              clientTimeZone: schedule.timeZone,
              content: [
                {
                  type: "text",
                  text: `\u5B9A\u65F6\u4EFB\u52A1\u300C${schedule.title}\u300D
\u8FD9\u662F\u7528\u6237\u4FDD\u5B58\u7684\u5B9A\u65F6\u4EFB\u52A1\uFF0C\u8BF7\u6309\u5F53\u524D\u4F1A\u8BDD\u7684\u6743\u9650\u6267\u884C\uFF1A

${schedule.prompt}`
                }
              ]
            },
            signal
          );
          if (result?.accepted !== true) throw new Error("\u4F1A\u8BDD\u672A\u786E\u8BA4\u63A5\u6536");
        },
        void 0,
        Date.now,
        async (schedule) => {
          try {
            const { index } = await content(schedule.sessionId);
            return schedule.history.flatMap((h) => {
              const fact = index.dispatch(h.requestId);
              return fact ? [{ ...fact, requestId: h.requestId }] : [];
            });
          } catch (error) {
            if (error instanceof InputError && error.status === 404) throw error;
            const failure = readFailure(error);
            if (failure.status === 404) throw new InputError("\u76EE\u6807\u4F1A\u8BDD\u4E0D\u5B58\u5728", 404);
            throw error;
          }
        }
      );
      loadError = "";
    };
    try {
      initialize();
    } catch (error) {
      loadError = String(error);
      host.logger?.warn(name, loadError);
    }
    host.effect(
      () => () => {
        scheduler?.stop();
        delivery.abort();
        contentCache.clear();
        lifetime.abort();
      },
      "workspace: lifetime"
    );
    const mount = (owner, feature) => {
      if (feature === "schedules") {
        if (store) initialize(store);
        owner.effect(() => {
          const timer = setInterval(() => {
            void scheduler?.tick().catch((error) => host.logger?.warn("\u5B9A\u65F6\u4EFB\u52A1\u68C0\u67E5\u5931\u8D25", String(error)));
          }, 2e3);
          timer.unref();
          return () => {
            clearInterval(timer);
            scheduler?.stop();
            delivery.abort();
          };
        }, "schedules: timer");
      }
      const routes = feature === "annotations" ? ["annotations", "selection"] : feature === "schedules" ? ["schedules"] : feature === "core" ? ["content", "message", "storage"] : [];
      for (const route of routes)
        owner.effect(
          () => host.webServer.register({
            kind: "exact",
            path: `/${name}/${route}`,
            handler: async (req, res) => {
              if (rejectUnauthenticatedRequest(req, res, host.connection)) return;
              const send = (status, data) => {
                res.writeHead(status, {
                  "Content-Type": "application/json; charset=utf-8",
                  "Cache-Control": "no-store"
                });
                res.end(JSON.stringify(data));
              };
              try {
                if (req.method !== "GET" && req.method !== "POST")
                  throw new InputError("\u4E0D\u652F\u6301\u6B64\u8BF7\u6C42\u65B9\u6CD5", 405);
                const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
                if (route === "storage") {
                  if (!path) throw new InputError("\u5DE5\u4F5C\u533A\u6570\u636E\u76EE\u5F55\u672A\u8BBE\u7F6E", 503);
                  if (req.method === "POST") {
                    if (req.headers["x-dsh-px-request"] !== "1") throw new InputError("\u8BF7\u6C42\u6821\u9A8C\u5931\u8D25", 403);
                    const input = await body(req);
                    if (input.action !== "restore") throw new InputError("\u64CD\u4F5C\u65E0\u6548");
                    initialize(WorkspaceStore.restore(path, input.snapshotId, input.revision));
                  }
                  const status = WorkspaceStore.status(path);
                  if (!status.ready) scheduler?.stop();
                  return send(200, status);
                }
                if ((route === "annotations" || route === "schedules") && (!store || !scheduler))
                  throw new InputError("\u6279\u6CE8\u4E0E\u5B9A\u65F6\u914D\u7F6E\u4E0D\u53EF\u7528\uFF1B\u53EF\u5728\u5B58\u50A8\u6062\u590D\u4E2D\u67E5\u770B\u6709\u6548\u5FEB\u7167\u3002", 503);
                if (req.method === "POST") {
                  if (req.headers["x-dsh-px-request"] !== "1") throw new InputError("\u8BF7\u6C42\u6821\u9A8C\u5931\u8D25", 403);
                  if (route !== "annotations" && route !== "schedules" && route !== "selection")
                    throw new InputError("\u6B64\u63A5\u53E3\u53EA\u8BFB", 405);
                  const input = await body(req);
                  if (route === "selection") {
                    const { index: index2 } = await content(identifier(input.sessionId));
                    return send(
                      200,
                      selectionSource(index2.message(identifier(input.messageId)), input.quote)
                    );
                  }
                  if (route === "annotations") {
                    if (input.action === "delete") {
                      store.deleteAnnotation(input);
                      return send(200, { ok: true });
                    }
                    if (input.action !== "save") throw new InputError("\u64CD\u4F5C\u65E0\u6548");
                    const { index: index2 } = await content(identifier(input.sessionId));
                    const source = index2.message(input.messageId);
                    if (!source) throw new InputError("\u5F15\u7528\u7684\u6D88\u606F\u4E0D\u5B58\u5728\u6216\u6CA1\u6709\u53EF\u5F15\u7528\u7684\u6B63\u6587", 404);
                    return send(200, store.saveAnnotation(input, source));
                  }
                  if (input.action === "save") {
                    await target(identifier(input.sessionId));
                    return send(200, scheduler.save(input));
                  }
                  if (input.action === "delete") {
                    scheduler.remove(input);
                    return send(200, { ok: true });
                  }
                  if (input.action === "run") return send(200, await scheduler.run(identifier(input.id)));
                  throw new InputError("\u64CD\u4F5C\u65E0\u6548");
                }
                if (route === "schedules")
                  return send(200, { schedules: store.schedules(), timeZone: scheduler.zone });
                if (route === "selection") throw new InputError("\u9009\u533A\u63A5\u53E3\u9700\u8981 POST", 405);
                const id = identifier(params.get("sessionId"));
                if (route === "annotations")
                  return send(200, store.annotations(id, params.get("before") ?? void 0));
                const { index } = await content(id);
                if (route === "message") {
                  const m2 = index.message(params.get("messageId") ?? "");
                  if (!m2) throw new InputError("\u6D88\u606F\u4E0D\u5B58\u5728\u6216\u6CA1\u6709\u53EF\u5F15\u7528\u6B63\u6587", 404);
                  const offset = numberParam(params, "offset", 0), length = m2.text.length;
                  if (offset > length) throw new InputError("\u6B63\u6587\u504F\u79FB\u8D85\u8FC7\u957F\u5EA6");
                  return send(200, {
                    ...m2,
                    text: m2.text.slice(offset, offset + 32e3),
                    length,
                    offset,
                    nextOffset: offset + 32e3 < length ? offset + 32e3 : null
                  });
                }
                const before = numberParam(params, "before", Number.MAX_SAFE_INTEGER);
                if (params.getAll("artifactBefore").length > 1) throw new InputError("\u4EA7\u7269\u5206\u9875\u53C2\u6570\u65E0\u6548");
                try {
                  send(200, index.content(before, params.get("artifactBefore") ?? void 0));
                } catch {
                  throw new InputError("\u4EA7\u7269\u5206\u9875\u53C2\u6570\u65E0\u6548");
                }
              } catch (error) {
                if (error instanceof InputError)
                  send(error.status, { error: error.message, retryable: false });
                else {
                  host.logger?.warn(`${name}/${route}`, String(error));
                  const failure = readFailure(error);
                  send(failure.status, failure);
                }
              }
            }
          }),
          `workspace: ${route}`
        );
    };
    mount(host, "core");
    host.provide("pxWorkspace", { mount });
  });
}
export {
  DEFAULTS,
  apply,
  inject,
  name
};
