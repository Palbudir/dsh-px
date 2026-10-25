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

// packages/dsh-px-taskflow/src/command-guidance.ts
import { createHash } from "node:crypto";
import { win32 } from "node:path";
var validMode = (value) => typeof value === "string" && ["read-only", "workspace-write", "danger-full-access"].includes(value);
function hasWindowsChildPipeFailure(text) {
  const exit = /\[exit code: (-?\d+)\]\s*$/.exec(text);
  return /\bspawn(?:Sync)? EPERM\b/.test(text) && /node:(?:internal\/)?child_process/.test(text) && Boolean(exit && Number.isSafeInteger(Number(exit[1])) && Number(exit[1]) !== 0);
}
function capture(args, seq, mode) {
  const candidate = {
    seq,
    mode: validMode(args.sandbox_permissions) ? args.sandbox_permissions : mode,
    chars: 0
  };
  if (typeof args.command === "string" && args.command.length <= 2e4)
    candidate.commandKey = "command:" + createHash("sha256").update(args.command).digest("hex");
  if (typeof args.command !== "string" || !args.command.trim() || args.command.length > 2e4 || typeof args.workdir !== "string" || args.workdir.length > 4096 || !/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/])/i.test(args.workdir) || args.run_in_background === true)
    return candidate;
  if (args.timeoutMs !== void 0 && (typeof args.timeoutMs !== "number" || !Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0))
    return candidate;
  candidate.request = {
    command: args.command,
    workdir: args.workdir,
    ...args.timeoutMs === void 0 ? {} : { timeoutMs: args.timeoutMs }
  };
  candidate.key = createHash("sha256").update(win32.normalize(args.workdir).toLowerCase() + "\0" + args.command).digest("hex");
  candidate.chars = args.command.length + args.workdir.length;
  return candidate;
}
var CommandGuidanceIndex = class {
  pending = /* @__PURE__ */ new Map();
  failures = /* @__PURE__ */ new Map();
  approvals = /* @__PURE__ */ new Map();
  blocked = /* @__PURE__ */ new Set();
  returned = /* @__PURE__ */ new Map();
  mode;
  approval;
  chars = 0;
  get cacheCost() {
    return this.chars * 2 + (this.pending.size + this.failures.size + this.approvals.size + this.blocked.size + this.returned.size) * 160;
  }
  observe(type, data) {
    if (type === "sandbox/mode" && validMode(data.mode)) this.mode = data.mode;
    if (type === "approval/policy" && ["ask", "never"].includes(data.policy)) this.approval = data.policy;
    if (type === "approval/asked" && data.toolName === "pwsh" && typeof data.id === "string") {
      const candidate = this.pending.get(data.callId) ?? this.failures.get(data.callId);
      if (candidate?.key || candidate?.commandKey)
        this.approvals.set(data.id, {
          key: candidate.key ?? candidate.commandKey,
          commandKey: candidate.commandKey
        });
    }
    if (type === "approval/decided") {
      const approval = this.approvals.get(data.id);
      if (approval) {
        if (["rejected", "cancelled", "unavailable"].includes(data.outcome)) this.blocked.add(approval.key);
        else if (data.outcome === "allowed-once") {
          this.blocked.delete(approval.key);
          if (approval.commandKey) this.blocked.delete(approval.commandKey);
        }
        this.approvals.delete(data.id);
      }
    }
    if (["turn/start", "turn/end", "session/end-seed"].includes(type)) {
      for (const candidate of this.pending.values()) this.chars -= candidate.chars;
      this.pending.clear();
      this.approvals.clear();
    }
  }
  start(id, tool, args, seq) {
    for (const map of [this.pending, this.failures]) {
      const old = map.get(id);
      if (old) this.chars -= old.chars;
      map.delete(id);
    }
    if (tool !== "pwsh" || !args || typeof args !== "object") return;
    const candidate = capture(args, seq, this.mode);
    this.pending.set(id, candidate);
    this.chars += candidate.chars;
  }
  finish(id, outcome, text) {
    const candidate = this.pending.get(id);
    if (!candidate) return;
    this.pending.delete(id);
    if (outcome === "error" && hasWindowsChildPipeFailure(text)) this.failures.set(id, candidate);
    else {
      this.chars -= candidate.chars;
      if (outcome === "returned" && candidate.key) this.returned.set(candidate.key, candidate.seq);
    }
  }
  guidance(id, platform = process.platform) {
    const candidate = this.failures.get(id);
    if (!candidate || platform !== "win32") return void 0;
    const guide = {
      kind: "windows-child-pipe",
      message: "\u8BB0\u5F55\u5305\u542B\u975E\u96F6\u9000\u51FA\u6807\u8BB0\u548C spawn EPERM\u3002Windows \u53D7\u9650\u73AF\u5883\u4E0D\u652F\u6301\u90E8\u5206\u5B50\u8FDB\u7A0B\u547D\u540D\u7BA1\u9053\u64CD\u4F5C\uFF0C\u9ED8\u8BA4 Node \u6D4B\u8BD5\u7B49\u547D\u4EE4\u53EF\u80FD\u5728\u8FD0\u884C\u65AD\u8A00\u524D\u505C\u6B62\u3002\u4E00\u6B21\u6027\u6279\u51C6\u8DEF\u5F84\u4ECD\u7531 DSH \u539F\u751F\u5BA1\u6279\u5904\u7406\u3002"
    };
    if (!candidate.request)
      guide.unavailableReason = "\u8BB0\u5F55\u7F3A\u5C11\u5B8C\u6574\u539F\u547D\u4EE4\u6216\u660E\u786E\u5DE5\u4F5C\u76EE\u5F55\uFF0C\u4E0D\u80FD\u4ECE\u6458\u8981\u81EA\u52A8\u51C6\u5907\u91CD\u8BD5\u3002";
    else if (candidate.key && this.blocked.has(candidate.key) || candidate.commandKey && this.blocked.has(candidate.commandKey))
      guide.unavailableReason = "\u8BE5\u547D\u4EE4\u7684\u5BA1\u6279\u5DF2\u88AB\u62D2\u7EDD\u3001\u53D6\u6D88\u6216\u672A\u5B8C\u6210\uFF0C\u4FDD\u6301\u505C\u6B62\uFF1B\u4E0D\u4F1A\u7EE7\u7EED\u5EFA\u8BAE\u6388\u6743\u91CD\u8BD5\u3002";
    else if (candidate.key && (this.returned.get(candidate.key) ?? -1) > candidate.seq)
      guide.unavailableReason = "\u4E4B\u540E\u5DF2\u6709\u540C\u547D\u4EE4\u6B63\u5E38\u8FD4\u56DE\u7684\u8BB0\u5F55\uFF0C\u8BF7\u5148\u6838\u5BF9\u540E\u7EED\u7ED3\u679C\uFF0C\u907F\u514D\u91CD\u590D\u6267\u884C\u3002";
    else if (!candidate.mode || !["read-only", "workspace-write"].includes(candidate.mode))
      guide.unavailableReason = "\u65E0\u6CD5\u786E\u8BA4\u8BE5\u8C03\u7528\u5904\u4E8E\u53D7\u9650\u6A21\u5F0F\uFF1B\u6B64\u9519\u8BEF\u4E0D\u80FD\u76F4\u63A5\u4F5C\u4E3A\u6269\u5927\u6743\u9650\u7684\u4F9D\u636E\u3002";
    else if (!this.mode || !["read-only", "workspace-write"].includes(this.mode))
      guide.unavailableReason = "\u5F53\u524D\u4F1A\u8BDD\u4E0D\u5904\u4E8E\u53EF\u786E\u8BA4\u7684\u53D7\u9650\u6A21\u5F0F\uFF0C\u4E0D\u51C6\u5907\u91CD\u590D\u6269\u5927\u6743\u9650\u8BF7\u6C42\u3002";
    else if (this.approval !== "ask")
      guide.unavailableReason = "\u5F53\u524D\u4F1A\u8BDD\u672A\u542F\u7528\u53EF\u786E\u8BA4\u7684\u5BA1\u6279\u6A21\u5F0F\uFF0C\u4FDD\u6301\u547D\u4EE4\u505C\u6B62\u3002";
    else guide.request = { ...candidate.request };
    return guide;
  }
};

// packages/dsh-px-taskflow/src/evidence.ts
var reads = /* @__PURE__ */ new Set([
  "read",
  "ls",
  "list",
  "glob",
  "grep",
  "search",
  "web_search",
  "web_fetch",
  "present",
  "job_output",
  "job_list",
  "task_review",
  "task_state",
  "task_evidence"
]);
var writes = /* @__PURE__ */ new Set(["write", "edit"]);
var commands = /* @__PURE__ */ new Set(["pwsh", "bash", "shell"]);
var internal = /* @__PURE__ */ new Set(["task_state", "task_review", "task_evidence", "task_checkpoint"]);
function nativeWorkChanged(event) {
  return ["goal/change", "team/task", "team/member", "team/message/queued", "team/message/delivered"].includes(
    event.type
  ) || event.type === "user/message" && event.data?.source?.kind === "team-message";
}
var clip = (value, length) => typeof value === "string" ? value.slice(0, length) : "";
function parse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
function integerOption(value, fallback, min, max) {
  if (value === void 0) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("\u5206\u9875\u53C2\u6570\u65E0\u6548");
  return value;
}
function readCheckpoint(value) {
  if (!value || typeof value !== "object") return null;
  const v = value;
  if (![v.goal, v.summary, v.nextStep].every((x) => typeof x === "string" && x.length <= 4e3) || !v.goal.trim() || !v.summary.trim() || !["working", "blocked", "ready_for_review"].includes(v.state) || !Array.isArray(v.evidence) || v.evidence.length > 20 || !v.evidence.every((x) => typeof x === "string" && x.length <= 200))
    return null;
  if ([v.constraints, v.decisions].some((x) => x !== void 0 && (typeof x !== "string" || x.length > 2e3)))
    return null;
  if (v.state !== "ready_for_review" && !v.nextStep.trim()) return null;
  const ref = (x) => x && typeof x.id === "string" && x.id.length > 0 && x.id.length <= 200 && Number.isSafeInteger(x.revision) && x.revision >= 0;
  if (v.native !== void 0 && (!v.native || typeof v.native !== "object" || Array.isArray(v.native) || v.native.goal !== void 0 && !ref(v.native.goal) || v.native.team !== void 0 && (!v.native.team || typeof v.native.team.id !== "string" || !v.native.team.id.trim() || v.native.team.id.length > 200 || !Array.isArray(v.native.team.tasks) || v.native.team.tasks.length > 10 || !v.native.team.tasks.every(ref))))
    return null;
  return {
    goal: v.goal,
    summary: v.summary,
    nextStep: v.nextStep,
    state: v.state,
    evidence: [...new Set(v.evidence)],
    ...v.constraints === void 0 ? {} : { constraints: v.constraints },
    ...v.decisions === void 0 ? {} : { decisions: v.decisions },
    ...v.native === void 0 ? {} : {
      native: {
        ...v.native.goal ? { goal: { id: v.native.goal.id, revision: v.native.goal.revision } } : {},
        ...v.native.team ? {
          team: {
            id: v.native.team.id,
            tasks: v.native.team.tasks.map(({ id, revision }) => ({ id, revision }))
          }
        } : {}
      }
    }
  };
}
function effectOf(tool, args) {
  if (reads.has(tool) || tool === "str_replace_editor" && args.command === "view") return "read";
  if (writes.has(tool) || tool === "str_replace_editor" && ["create", "str_replace", "insert", "undo_edit"].includes(args.command))
    return "write";
  return "unknown";
}
function resultStatus(tool, text, isError) {
  if (isError && /^(?:Error:\s*)?tool call aborted\s*$/i.test(text))
    return { outcome: "cancelled", outcomeSource: "tool" };
  if (isError) return { outcome: "error", outcomeSource: "tool" };
  if (commands.has(tool)) {
    const markers = text.trimEnd().split(/\r?\n/).reverse();
    for (const line of markers) {
      if (!/^\[(?:exit code: -?\d+|timed out[^\]]*|killed by signal:[^\]]*|sandbox:[^\]]*)\]$/i.test(line))
        break;
      const exit = /^\[exit code: (-?\d+)\]$/i.exec(line);
      if (exit ? Number(exit[1]) !== 0 : /^\[(?:timed out|killed by signal|sandbox: file access denied)/i.test(line)) {
        return { outcome: "error", outcomeSource: "command_marker" };
      }
    }
  }
  return { outcome: "returned", outcomeSource: "tool" };
}
function emptyFold() {
  return {
    commands: new CommandGuidanceIndex(),
    calls: /* @__PURE__ */ new Map(),
    relevant: [],
    checkpoint: null,
    pending: /* @__PURE__ */ new Set(),
    activeTurn: false,
    changedFiles: /* @__PURE__ */ new Map(),
    changedFileSet: /* @__PURE__ */ new Set(),
    lastNonReadSeq: -1
  };
}
var EvidenceIndex = class {
  folded = emptyFold();
  count = 0;
  first;
  last;
  retainedChars = 0;
  processedEvents = 0;
  get cacheCost() {
    return this.retainedChars * 2 + this.folded.calls.size * 256 + this.folded.commands.cacheCost;
  }
  update(events) {
    if (events.length < this.count || this.count > 0 && (events[0] !== this.first || events[this.count - 1] !== this.last)) {
      this.folded = emptyFold();
      this.count = 0;
      this.retainedChars = 0;
    }
    const { calls, pending, relevant } = this.folded;
    for (let i = this.count; i < events.length; i++) {
      const event = events[i];
      this.processedEvents++;
      const data = event.data ?? {};
      if (nativeWorkChanged(event)) this.folded.lastNonReadSeq = event.seq;
      if (event.type === "user/message" && data.source?.kind === "user") {
        const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
        if (text.trim())
          this.folded.latestRequest = {
            seq: event.seq,
            text: text.slice(0, 3e3),
            truncated: text.length > 3e3
          };
      }
      this.folded.commands.observe(event.type, data);
      if (["turn/start", "turn/end", "session/end-seed"].includes(event.type)) {
        const cancelled = event.type === "turn/end" && data.reason?.kind === "aborted" && data.reason?.reason?.kind === "user";
        for (const call of pending) {
          call.outcome = cancelled ? "cancelled" : "interrupted";
          call.outcomeSource = "turn";
        }
        pending.clear();
        this.folded.activeTurn = event.type === "turn/start";
      }
      if (event.type === "tool/call" || event.type === "tool/ptc-dispatch-start") {
        const raw = typeof data.arguments === "string" ? parse(data.arguments) : data.arguments;
        const args = raw && typeof raw === "object" ? raw : {};
        const id = data.callId ?? data.subCallId;
        if (typeof id !== "string" || typeof data.name !== "string") continue;
        const effect = effectOf(data.name, args);
        this.folded.commands.start(id, data.name, args, event.seq);
        const previous = calls.get(id);
        if (previous) {
          pending.delete(previous);
          this.retainedChars -= previous.input.length + previous.outputLength;
          const oldIndex = relevant.indexOf(previous);
          if (oldIndex >= 0) relevant.splice(oldIndex, 1);
        }
        const call = {
          id,
          seq: event.seq,
          tool: data.name,
          input: clip(args.command ?? args.description ?? args.path ?? args.file_path ?? "", 1200),
          file: effect === "write" ? clip(args.path ?? args.file_path, 1e3) || null : null,
          effect,
          outcome: "running",
          outcomeSource: "pending",
          output: "",
          outputLength: 0,
          outputTruncated: false,
          time: event.time,
          durationMs: null
        };
        calls.set(id, call);
        if (!internal.has(call.tool)) {
          relevant.push(call);
          if (call.effect !== "read") this.folded.lastNonReadSeq = call.seq;
        }
        this.retainedChars += call.input.length;
        pending.add(call);
      }
      if (event.type === "tool/result" || event.type === "tool/ptc-dispatch") {
        const blocks = event.type === "tool/result" ? data.message?.role === "tool" && typeof data.message.toolCallId === "string" ? [data.message] : (data.message?.content ?? []).filter((b) => b.type === "tool-result") : [data];
        for (const block of blocks) {
          const call = calls.get(block.toolCallId ?? data.subCallId);
          if (!call) continue;
          const text = (block.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
          Object.assign(call, resultStatus(call.tool, text, block.isError === true));
          this.folded.commands.finish(call.id, call.outcome, text);
          pending.delete(call);
          this.retainedChars += text.length - call.outputLength;
          call.output = text;
          call.outputLength = text.length;
          call.durationMs = Math.max(0, event.time - call.time);
          if (call.file && call.outcome === "returned") {
            this.folded.changedFileSet.add(call.file);
            this.folded.changedFiles.delete(call.file);
            this.folded.changedFiles.set(call.file, call.seq);
            if (this.folded.changedFiles.size > 200)
              this.folded.changedFiles.delete(this.folded.changedFiles.keys().next().value);
          }
          if (call.tool === "task_checkpoint" && call.outcome === "returned") {
            const value = readCheckpoint(parse(text).checkpoint);
            if (value) this.folded.checkpoint = { ...value, seq: event.seq, time: event.time };
          }
        }
      }
    }
    this.count = events.length;
    this.first = events[0];
    this.last = events.at(-1);
    return this;
  }
  snapshot() {
    return this.folded;
  }
};
var indexes = /* @__PURE__ */ new WeakMap();
function foldEvents(events) {
  if (events instanceof EvidenceIndex) return events.snapshot();
  let index = indexes.get(events);
  if (!index) indexes.set(events, index = new EvidenceIndex());
  return index.update(events).snapshot();
}
function visibleCall(call, fold, live) {
  return (!fold.activeTurn || !live) && fold.pending.has(call) ? { ...call, outcome: "interrupted", outcomeSource: "turn" } : call;
}
function summary(call) {
  return {
    ...call,
    input: clip(call.input, 180),
    output: clip(call.output, 240),
    outputTruncated: call.outputLength > 240
  };
}
function reviewEvents(events, live = true, options = {}) {
  const limit = integerOption(options.limit, 20, 1, 50);
  const before = integerOption(options.beforeSeq, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
  const folded = foldEvents(events);
  const { relevant, checkpoint } = folded;
  let lo = 0, hi = relevant.length;
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (relevant[mid].seq < before) lo = mid + 1;
    else hi = mid;
  }
  const start = Math.max(0, lo - limit), page = relevant.slice(start, lo);
  return {
    ...folded.latestRequest ? { latestRequest: folded.latestRequest } : {},
    checkpoint,
    executions: page.map((call) => summary(visibleCall(call, folded, live))),
    referencedExecutions: checkpoint ? checkpoint.evidence.flatMap((id) => {
      const call = folded.calls.get(id);
      return call && !internal.has(call.tool) ? [summary(visibleCall(call, folded, live))] : [];
    }) : [],
    total: relevant.length,
    truncated: start > 0,
    nextBeforeSeq: start > 0 ? page[0].seq : null,
    changedFiles: [...folded.changedFiles.keys()],
    changedFilesTotal: folded.changedFileSet.size,
    changedFilesTruncated: folded.changedFileSet.size > folded.changedFiles.size,
    checkpointStale: Boolean(
      checkpoint && Math.max(folded.lastNonReadSeq, folded.latestRequest?.seq ?? -1) > checkpoint.seq
    )
  };
}
function evidenceDetail(events, id, live = true, options = {}) {
  if (typeof id !== "string" || !id || id.length > 200) throw new Error("\u6267\u884C\u7F16\u53F7\u65E0\u6548");
  const offset = integerOption(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const size = integerOption(options.maxChars, 4e3, 1, 8e3);
  const folded = foldEvents(events);
  const source = folded.calls.get(id);
  if (!source || internal.has(source.tool)) return null;
  const call = visibleCall(source, folded, live);
  const next = offset + size < call.outputLength ? offset + size : null;
  const commandGuidance = folded.commands.guidance(id);
  return {
    ...call,
    output: call.output.slice(offset, offset + size),
    outputOffset: offset,
    outputTruncated: offset > 0 || next !== null,
    nextOutputOffset: next,
    ...commandGuidance ? { commandGuidance } : {}
  };
}
function validateCheckpoint(args, events) {
  const checkpoint = readCheckpoint(args);
  if (!checkpoint) throw new Error("\u4EFB\u52A1\u8BB0\u5F55\u683C\u5F0F\u65E0\u6548\uFF1B\u8FDB\u884C\u4E2D\u6216\u963B\u585E\u65F6\u5FC5\u987B\u586B\u5199\u4E0B\u4E00\u6B65\u3002");
  const { calls } = foldEvents(events);
  for (const id of checkpoint.evidence) {
    const call = calls.get(id);
    if (!call || internal.has(call.tool) || !["returned", "error"].includes(call.outcome))
      throw new Error(`\u8BC1\u636E ${id} \u4E0D\u5B58\u5728\uFF0C\u6216\u6CA1\u6709\u5DF2\u7ED3\u7B97\u7ED3\u679C\uFF1B\u8BF7\u5148 task_review / task_evidence \u6838\u5BF9\u3002`);
  }
  if (checkpoint.state === "ready_for_review" && checkpoint.evidence.length === 0)
    throw new Error("\u4EA4\u4ED8\u524D\u81F3\u5C11\u5F15\u7528\u4E00\u6761\u5B9E\u9645\u6267\u884C\u8BB0\u5F55\uFF1B\u8FD9\u4E0D\u662F\u6D4B\u8BD5\u8986\u76D6\u7387\u6216\u4EE3\u7801\u6B63\u786E\u6027\u7684\u4FDD\u8BC1\u3002");
  return checkpoint;
}

// packages/dsh-px-taskflow/src/ledger.ts
var LedgerIndex = class {
  count = 0;
  first;
  last;
  pending = /* @__PURE__ */ new Set();
  checkpoint = null;
  latestRequest;
  lastActivity = -1;
  processedEvents = 0;
  update(events) {
    if (events.length < this.count || this.count && (events[0] !== this.first || events[this.count - 1] !== this.last)) {
      this.count = 0;
      this.pending.clear();
      this.checkpoint = null;
      this.latestRequest = void 0;
      this.lastActivity = -1;
    }
    for (let i = this.count; i < events.length; i++) {
      const e = events[i], d = e.data ?? {};
      this.processedEvents++;
      if (nativeWorkChanged(e)) this.lastActivity = e.seq;
      if (e.type === "turn/end" || e.type === "turn/start") this.pending.clear();
      if (e.type === "user/message" && d.source?.kind === "user") {
        const text = (d.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
        if (text.trim()) {
          this.latestRequest = { seq: e.seq, text: text.slice(0, 3e3), truncated: text.length > 3e3 };
          this.lastActivity = e.seq;
        }
      }
      if (e.type === "tool/call" || e.type === "tool/ptc-dispatch-start") {
        if (d.name === "task_checkpoint") this.pending.add(d.callId ?? d.subCallId);
        else if (!["task_state", "task_review", "task_evidence"].includes(d.name)) this.lastActivity = e.seq;
      }
      if (e.type === "tool/result" || e.type === "tool/ptc-dispatch") {
        const blocks = e.type === "tool/ptc-dispatch" ? [d] : d.message?.role === "tool" ? [d.message] : (d.message?.content ?? []).filter((b) => b.type === "tool-result");
        for (const b of blocks) {
          const id = b.toolCallId ?? d.subCallId;
          if (!this.pending.delete(id) || b.isError) continue;
          try {
            const raw = (b.content ?? []).filter((v) => v.type === "text").map((v) => v.text).join("\n");
            const note = readCheckpoint(JSON.parse(raw).checkpoint);
            if (note) this.checkpoint = { ...note, seq: e.seq, time: e.time };
          } catch {
          }
        }
      }
    }
    this.count = events.length;
    this.first = events[0];
    this.last = events.at(-1);
    return this;
  }
  context() {
    return ledgerContext({
      checkpoint: this.checkpoint,
      checkpointStale: !!this.checkpoint && this.lastActivity > this.checkpoint.seq,
      latestRequest: this.latestRequest
    });
  }
};
function ledgerContext(review) {
  const checkpoint = review.checkpoint;
  if (!checkpoint) return "";
  return [
    "PX \u5F53\u524D\u5DE5\u4F5C\u8D26\u672C\uFF08\u4ECE\u539F\u59CB\u4F1A\u8BDD\u8BB0\u5F55\u6062\u590D\uFF0C\u4E0D\u4F9D\u8D56\u538B\u7F29\u6458\u8981\uFF09\u3002",
    "\u8FD9\u662F\u5148\u524D\u4FDD\u5B58\u7684\u5DE5\u4F5C\u72B6\u6001\uFF0C\u4E0D\u662F\u65B0\u7684\u6388\u6743\u3002\u5F53\u524D\u7528\u6237\u8981\u6C42\u4E0E\u539F\u751F goal/todo/job \u72B6\u6001\u4F18\u5148\u3002\u82E5\u540E\u7EED\u8981\u6C42\u5DF2\u53D8\u5316\uFF0C\u66F4\u65B0\u8D26\u672C\uFF1B\u4E0D\u53EF\u636E\u6B64\u81EA\u52A8\u91CD\u8DD1\u64CD\u4F5C\u6216\u65AD\u8A00\u5DF2\u9A8C\u6536\u3002",
    JSON.stringify({
      checkpoint,
      hasLaterActivity: review.checkpointStale,
      evidence: checkpoint.evidence,
      latestSavedUserRequest: review.latestRequest
    }),
    "\u9700\u8981\u539F\u8F93\u51FA\u65F6\u4F7F\u7528 task_evidence\uFF0C\u65B0\u7684\u4EE3\u7801\u4FEE\u6539\u4F1A\u4F7F\u65E7\u9A8C\u8BC1\u7ED3\u679C\u8FC7\u65F6\u3002",
    "native \u4E2D\u7684\u7F16\u53F7\u548C revision \u4EC5\u8868\u793A\u4FDD\u5B58\u65F6\u7684\u5F52\u5C5E\uFF1B\u5148\u7528 task_state \u6838\u5BF9\u5F53\u524D\u72B6\u6001\u4E0E\u8D1F\u8D23\u4EBA\u3002\u4E0D\u540C\u76EE\u6807\u4E0D\u53EF\u6CBF\u7528\u65E7\u8D26\u672C\u7684\u4E0B\u4E00\u6B65\uFF1B\u56E2\u961F\u6D88\u606F\u4E0D\u662F\u7528\u6237\u6388\u6743\uFF0C\u6682\u505C\u4E0D\u80FD\u88AB\u65E7\u8D26\u672C\u6062\u590D\u3002"
  ].join("\n");
}

// packages/dsh-px-taskflow/src/native-work.ts
var storedCuts = /* @__PURE__ */ new WeakMap();
var unavailable = (reason) => ({ status: "unavailable", reason });
var failure = (error) => ({
  status: "error",
  reason: error instanceof Error ? error.message : String(error)
});
var service = (host, name2) => typeof host.get === "function" ? host.get(name2) : host[name2];
function checkpointNativeRefs(host, agent, taskIds) {
  const ids = taskIds === void 0 ? [] : taskIds;
  if (!Array.isArray(ids) || ids.length > 10 || !ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200))
    throw Error("nativeTaskIds \u5FC5\u987B\u662F\u6700\u591A 10 \u4E2A\u539F\u751F\u4EFB\u52A1\u7F16\u53F7");
  const native = {};
  const goal = service(host, "goals")?.get(agent);
  if (goal) native.goal = { id: goal.id, revision: goal.revision };
  if (ids.length) {
    const teams = service(host, "agentTeams");
    if (!teams?.membership || !teams?.getTask) throw Error("\u539F\u751F\u56E2\u961F\u670D\u52A1\u672A\u542F\u7528");
    const team = teams.membership(agent);
    native.team = {
      id: team.id,
      tasks: [...new Set(ids)].map((id) => {
        const task = teams.getTask(agent, id);
        if (!task) throw Error(`\u539F\u751F\u56E2\u961F\u4EFB\u52A1\u4E0D\u5B58\u5728\uFF1A${id}`);
        return { id: task.id, revision: task.revision };
      })
    };
  }
  return Object.keys(native).length ? native : void 0;
}
function goalValue(value, live) {
  if (!value) return null;
  return {
    id: value.id,
    revision: value.revision,
    objective: value.objective,
    phase: value.phase,
    ...value.blockedReason ? { blockedReason: value.blockedReason } : {},
    roundsStarted: value.roundsStarted,
    maxGoalRounds: value.maxGoalRounds,
    activation: live && ["armed", "disarmed"].includes(value.activation) ? value.activation : "unknown"
  };
}
function teamValue(id, role, members, tasks) {
  return {
    id,
    role,
    members: members.map((m) => ({ id: m.id, name: m.name, role: m.role, status: m.status ?? m.phase })),
    tasks: tasks.slice(0, 50).map((t) => ({
      id: t.id,
      revision: t.revision,
      subject: t.subject,
      status: t.status,
      ...t.ownerName ? { ownerName: t.ownerName } : {},
      blockedBy: t.blockedBy,
      ready: t.ready,
      writeScopeWarnings: t.writeScopeWarnings
    })),
    taskCount: tasks.length,
    truncated: tasks.length > 50
  };
}
async function readCut(host, id) {
  const projections = service(host, "sessionProjections");
  if (!projections?.snapshot || !projections?.restore) throw Error("\u5BBF\u4E3B\u672A\u63D0\u4F9B\u539F\u751F\u72B6\u6001\u6295\u5F71\u63A5\u53E3");
  const session = service(host, "sessions")?.get(id);
  if (session) {
    if (session.header?.isSeeded && !Number.isSafeInteger(session.inheritedEventCount))
      throw Error("\u5BBF\u4E3B\u672A\u63D0\u4F9B\u5206\u53C9\u4F1A\u8BDD\u7684\u7EE7\u627F\u8FB9\u754C");
    return {
      header: session.header,
      values: projections.snapshot(session, ["goal", "agentTeam"]).values,
      goalFailure: projections.stateOf?.(session, "goal")?.failure ?? void 0,
      ownedSubagent: session.snapshotEvents(session.inheritedEventCount ?? 0).some((event) => event.type === "subagent/descriptor")
    };
  }
  const persistence = service(host, "sessionPersistence");
  if (!persistence?.open) throw Error("\u5BBF\u4E3B\u672A\u63D0\u4F9B\u4F1A\u8BDD\u5B58\u50A8");
  const goals = service(host, "goals"), teams = service(host, "agentTeams");
  let cache = storedCuts.get(host);
  if (!cache || cache.projections !== projections || cache.goals !== goals || cache.teams !== teams) {
    cache = { projections, goals, teams, entries: /* @__PURE__ */ new Map() };
    storedCuts.set(host, cache);
  }
  const revision = (await persistence.stat?.(id))?.revision;
  const saved = cache.entries.get(id);
  if (revision && saved && saved.revision === revision) {
    cache.entries.delete(id);
    cache.entries.set(id, saved);
    return saved.cut;
  }
  const handle = await persistence.open(id, "read");
  let readFailed = false;
  try {
    const { events } = await handle.read();
    if (handle.header?.isSeeded && !Number.isSafeInteger(handle.inheritedEventCount))
      throw Error("\u5BBF\u4E3B\u672A\u63D0\u4F9B\u5206\u53C9\u4F1A\u8BDD\u7684\u7EE7\u627F\u8FB9\u754C");
    const { snapshot, checkpoint } = projections.restore(
      {},
      events,
      0,
      handle.header,
      handle.inheritedEventCount ?? 0
    );
    const cut = {
      header: handle.header,
      values: { goal: snapshot.values.goal, agentTeam: snapshot.values.agentTeam },
      goalFailure: checkpoint?.goal?.val?.failure ?? void 0,
      // A provider-owned child must not become an implicit team root. The descriptor belongs
      // to this suffix only; inherited descriptors in ordinary forks do not confer membership.
      ownedSubagent: events.slice(handle.inheritedEventCount ?? 0).some((event) => event.type === "subagent/descriptor")
    };
    if (revision && (await persistence.stat?.(id))?.revision === revision) {
      cache.entries.delete(id);
      cache.entries.set(id, { revision, cut });
      while (cache.entries.size > 8) cache.entries.delete(cache.entries.keys().next().value);
    }
    return cut;
  } catch (error) {
    readFailed = true;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      cache.entries.delete(id);
      if (!readFailed) throw error;
    }
  }
}
async function readNativeWork(host, sessionId, suppliedAgent) {
  const agent = suppliedAgent ?? service(host, "agents")?.get(sessionId);
  const result = {
    sessionId,
    source: agent ? "live" : "stored",
    goal: unavailable("\u539F\u751F\u76EE\u6807\u670D\u52A1\u672A\u542F\u7528"),
    team: unavailable("\u667A\u80FD\u4F53\u56E2\u961F\u672A\u542F\u7528")
  };
  if (agent) {
    const goals = service(host, "goals"), teams = service(host, "agentTeams");
    if (goals?.get) {
      try {
        result.goal = { status: "available", value: goalValue(goals.get(agent), true) };
      } catch (error) {
        result.goal = failure(error);
      }
    }
    if (teams?.membership && teams?.listTasks && teams?.listMembers) {
      try {
        const membership = teams.membership(agent);
        result.team = {
          status: "available",
          value: teamValue(membership.id, membership.role, teams.listMembers(agent), teams.listTasks(agent))
        };
      } catch (error) {
        result.team = error?.code === "TEAM_NOT_MEMBER" ? unavailable("\u6B64\u5B50\u667A\u80FD\u4F53\u4E0D\u5C5E\u4E8E\u539F\u751F\u56E2\u961F") : failure(error);
      }
    }
    return result;
  }
  const projections = service(host, "sessionProjections");
  if (!projections) return result;
  let cut;
  try {
    cut = await readCut(host, sessionId);
  } catch (error) {
    return { ...result, goal: failure(error), team: failure(error) };
  }
  if (service(host, "goals") && Object.hasOwn(cut.values, "goal") && cut.values.goal !== void 0) {
    const value = cut.values.goal;
    result.goal = cut.goalFailure ? { status: "error", reason: cut.goalFailure } : {
      status: "available",
      value: value ? goalValue({ ...value.goal, roundsStarted: value.roundsStarted }, false) : null
    };
  }
  if (service(host, "agentTeams") && cut.values.agentTeam !== void 0) {
    try {
      let teamId = sessionId, team = cut.values.agentTeam;
      if (cut.header.parentSession) {
        let parent;
        try {
          parent = await readCut(host, cut.header.parentSession);
        } catch (error) {
          if (cut.ownedSubagent || readFailure(error).status !== 404) throw error;
        }
        const parentTeam = parent?.values.agentTeam;
        if (parentTeam?.failure) throw Error(parentTeam.failure);
        if (parentTeam?.members?.some(
          (m) => m.id === sessionId && ["active", "provisioning"].includes(m.phase)
        )) {
          teamId = cut.header.parentSession;
          team = parentTeam;
        }
      }
      if (teamId === sessionId && cut.ownedSubagent) {
        result.team = unavailable("\u6B64\u5B50\u667A\u80FD\u4F53\u672A\u5F52\u5C5E\u4E8E\u539F\u751F\u56E2\u961F");
        return result;
      }
      if (team?.failure) throw Error(team.failure);
      result.team = {
        status: "available",
        value: team ? teamValue(teamId, "stored", team.members, team.tasks) : null
      };
    } catch (error) {
      result.team = failure(error);
    }
  }
  return result;
}

// packages/dsh-px-taskflow/src/work-wait.ts
var EXECUTION_POLICY = `For substantive tasks, deliver a useful draft or a verified intermediate artifact as soon as it is ready. Report material findings and blockers; do not replace results with repeated status text. Batch independent concurrency-safe reads, and use bounded native PTC programs for deterministic short sequences. Start long commands as native background Jobs and retain their ids; do other ready work while they run. When the user explicitly requests a workflow or large multi-agent orchestration and the native workflow tool is available, prefer run_in_background: true for long workflows; retain its Job id and inspect native progress/output instead of launching a duplicate. Use Team only when permitted. Coordinate native task dependencies, revisions and disjoint write scopes; a ready task does not itself wake its inactive owner. Wake required inactive owners through the native Team tools before waiting. When genuinely blocked on owned Jobs or active teammates, prefer task_wait over long blocking job_output/wait_agent calls: new steering can end this observation. After wake, reconcile current user corrections and task revisions before consuming results with job_output or the native Team tools. Do not restart a job because a wait returned, treat an accepted message as completion, or give a final completion claim before required work and checks settle.`;
var active = (job) => job.status === "running" || job.status === "stopping";
var service2 = (host, name2) => host.get?.(name2) ?? host[name2];
async function waitForNativeWork(host, agent, signal, timeoutMs = 3e4) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1e3 || timeoutMs > 6e4)
    throw Error("\u7B49\u5F85\u65F6\u957F\u987B\u4E3A 1000\uFF5E60000 \u6BEB\u79D2");
  signal.throwIfAborted();
  const started = Date.now(), jobs = service2(host, "jobs"), teams = service2(host, "agentTeams"), local = new AbortController();
  let resolveWake, rejectWake;
  const wake = new Promise((resolve, reject) => {
    resolveWake = resolve;
    rejectWake = reject;
  });
  let settled = false, timer, teamWait;
  const cleanup = [];
  const finish = (reason) => {
    if (settled) return;
    settled = true;
    resolveWake(reason);
  };
  const abort = () => {
    if (settled) return;
    settled = true;
    rejectWake(signal.reason);
  };
  const jobIds = /* @__PURE__ */ new Set();
  try {
    signal.addEventListener("abort", abort, { once: true });
    cleanup.push(() => signal.removeEventListener("abort", abort));
    cleanup.push(
      host.on("agent/inbox/inserted", ({ agent: target, message }) => {
        if (target === agent && agent.inbox?.nextStep?.some((item) => item.id === message.id))
          finish("message");
      })
    );
    if (jobs?.events?.subscribe && jobs.list) {
      cleanup.push(
        jobs.events.subscribe({ owner: agent.id }, (event) => {
          if (jobIds.has(event.job.id) && ["settled", "removed", "stopping"].includes(event.type))
            finish("job-change");
        })
      );
      for (const job of jobs.list(agent.id)) if (active(job)) jobIds.add(job.id);
    }
    let peerActive = false;
    if (teams?.listMembers && teams.waitForChange) {
      try {
        peerActive = teams.listMembers(agent).some(
          (member) => member.id !== agent.id && ["running", "provisioning"].includes(member.status)
        );
      } catch (error) {
        if (error?.code !== "TEAM_NOT_MEMBER") throw error;
      }
      if (peerActive) {
        teamWait = Promise.resolve(teams.waitForChange(agent, Math.max(1e4, timeoutMs), local.signal)).then((result) => {
          if (!result?.timedOut) finish("team-change");
        }).catch((error) => {
          if (!local.signal.aborted && !settled) {
            settled = true;
            rejectWake(error);
          }
        });
      }
    }
    if (agent.inbox?.nextStep?.length) finish("message");
    else if (!jobIds.size && !peerActive) finish("no-progress");
    timer = setTimeout(() => finish("timeout"), timeoutMs);
    if (signal.aborted) abort();
    const reason = await wake;
    signal.throwIfAborted();
    return {
      reason,
      elapsedMs: Math.max(0, Date.now() - started),
      jobIds: [...jobIds],
      note: reason === "no-progress" ? "\u6CA1\u6709\u89C2\u5BDF\u5230\u53EF\u7B49\u5F85\u7684\u539F\u751F\u540E\u53F0\u4F5C\u4E1A\u6216\u6D3B\u52A8\u6210\u5458\u3002\u68C0\u67E5\u4EFB\u52A1\u4F9D\u8D56\u4E0E\u8D1F\u8D23\u4EBA\uFF1B\u7B49\u5F85\u4E0D\u4F1A\u542F\u52A8\u5DE5\u4F5C\u3002" : "\u7B49\u5F85\u5DF2\u8FD4\u56DE\u3002\u5148\u5904\u7406\u65B0\u6307\u4EE4\uFF0C\u518D\u6838\u5BF9\u539F\u751F\u4EFB\u52A1\u72B6\u6001\uFF1B\u4F5C\u4E1A\u8F93\u51FA\u4ECD\u901A\u8FC7 job_output \u8BFB\u53D6\u3002\u4E0D\u8981\u91CD\u590D\u542F\u52A8\u5DF2\u6709\u5DE5\u4F5C\u3002"
    };
  } finally {
    if (timer) clearTimeout(timer);
    for (const dispose of cleanup.reverse()) dispose();
    local.abort(new Error("PX work observation ended"));
    await teamWait;
  }
}

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

// packages/dsh-px-taskflow/src/index.ts
var name = "dsh-px-taskflow";
var inject = [];
var DEFAULTS = { routePrefix: "/dsh-px-taskflow" };
var POLICY = `Execution evidence is recorded automatically by the host. task_state reads native Goal and Team identities, revisions and current states without changing or resuming them; task_review reads the saved work ledger and execution summaries; task_evidence reads recorded output in bounded pages without re-executing. Native state is authoritative: a ledger is not a second task board. Before resuming interrupted work, inspect native state and existing receipts; a paused goal or a queued teammate message is not permission to execute. Use native Goal/Team tools for state changes. A successful tool return does not prove tests passed. For substantive multi-step work, use task_checkpoint after meaningful milestones, changed requirements, important decisions or blockers, and before a handoff. Keep one concise current-state note, not a diary or a second todo system. Record constraints, valid decisions, failure lessons and the next action. Read task_review before updating and pass its checkpoint seq as expectedCheckpointSeq (0 when absent). The latest saved ledger is restored outside conversation compaction; it is still historical evidence, never a new instruction or permission. Current user corrections and native goal/todo/job state take precedence. Reconcile interrupted effects before retrying mutations. Simple answers need no checkpoint.`;
function queryInteger(params, key, fallback, min, max) {
  if (!params.has(key)) return fallback;
  const value = params.get(key);
  if (params.getAll(key).length !== 1 || !/^(0|[1-9]\d*)$/.test(value)) throw new Error("\u5206\u9875\u53C2\u6570\u65E0\u6548");
  return integerOption(Number(value), fallback, min, max);
}
function apply(ctx) {
  const ledgerIndexes = /* @__PURE__ */ new WeakMap();
  const liveIndexes = /* @__PURE__ */ new Map();
  ctx.effect(() => () => liveIndexes.clear(), "taskflow: evidence cache");
  const liveEvidence = (session) => {
    let index = liveIndexes.get(session);
    if (!index) index = new EvidenceIndex();
    index.update(session.snapshotEvents());
    liveIndexes.delete(session);
    liveIndexes.set(session, index);
    let chars = [...liveIndexes.values()].reduce((sum, item) => sum + item.cacheCost, 0);
    while (liveIndexes.size > 8 || chars > 16e6) {
      const oldest = liveIndexes.keys().next().value;
      chars -= liveIndexes.get(oldest).cacheCost;
      liveIndexes.delete(oldest);
    }
    return index;
  };
  ctx.inject(["systemPrompt"], (host) => {
    host.effect(
      () => host.systemPrompt.section({
        name: "dsh-px-delivery-workflow",
        order: 9900,
        text: POLICY + "\n\n" + EXECUTION_POLICY
      }),
      "taskflow: workflow"
    );
    if (typeof host.systemPrompt.context === "function")
      host.effect(
        () => host.systemPrompt.context({
          name: "dsh-px-work-ledger",
          order: 510,
          text: ({ agent }) => {
            if (!agent) return "";
            let ledger = ledgerIndexes.get(agent.session);
            if (!ledger) ledgerIndexes.set(agent.session, ledger = new LedgerIndex());
            return ledger.update(agent.session.snapshotEvents()).context();
          }
        }),
        "taskflow: durable ledger context"
      );
  });
  ctx.inject(["tools"], (host) => {
    const output = {
      schema: { type: "string" },
      render: (_, value) => [{ type: "text", text: value }]
    };
    const session = (exec) => {
      exec.signal.throwIfAborted();
      if (!exec.agent) throw new Error("\u6B64\u5DE5\u5177\u9700\u8981\u5F53\u524D\u4F1A\u8BDD");
      return exec.agent.session;
    };
    if (typeof host.on === "function")
      host.tools.register({
        name: "task_wait",
        description: "\u6CA1\u6709\u53EF\u72EC\u7ACB\u63A8\u8FDB\u7684\u5DE5\u4F5C\u65F6\uFF0C\u7B49\u5F85\u5F53\u524D\u4F1A\u8BDD\u7684\u539F\u751F Job/Team \u6216\u65B0\u7528\u6237\u6307\u4EE4\u3002\u65B0\u6D88\u606F\u4F1A\u53CA\u65F6\u7ED3\u675F\u7B49\u5F85\uFF1B\u4E0D\u8BFB\u53D6\u6216\u6D88\u8017\u4F5C\u4E1A\u8F93\u51FA\u3001\u4E0D\u5524\u9192\u6210\u5458\u3001\u4E0D\u53D6\u6D88\u5DE5\u4F5C\u3002\u8FD4\u56DE\u540E\u7528 task_state/job_output \u6838\u5BF9\uFF1B\u65E0\u6D3B\u52A8\u5DE5\u4F5C\u4F1A\u7ACB\u5373\u8FD4\u56DE\u3002",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { timeout_ms: { type: "integer", minimum: 1e3, maximum: 6e4 } }
        },
        output,
        execute: async (args, exec) => {
          session(exec);
          const agent = exec.agent;
          if (typeof agent.id !== "string" || !agent.id) throw Error("\u5F53\u524D\u4F1A\u8BDD\u8EAB\u4EFD\u4E0D\u53EF\u7528");
          return JSON.stringify(await waitForNativeWork(host, agent, exec.signal, args.timeout_ms));
        }
      });
    host.tools.register({
      name: "task_state",
      // Model calls always supply their live Agent; this path reads native snapshots without awaiting I/O.
      isConcurrencySafe: () => true,
      description: "\u53EA\u8BFB\u67E5\u770B\u5F53\u524D\u4F1A\u8BDD\u7684\u539F\u751F Goal \u548C Team\uFF1A\u7A33\u5B9A\u4EFB\u52A1\u7F16\u53F7\u3001revision\u3001\u72B6\u6001\u3001\u8D1F\u8D23\u4EBA\u3001\u4F9D\u8D56\u4E0E\u6210\u5458\u3002\u4E0D\u4F1A\u521B\u5EFA\u4EFB\u52A1\u3001\u6062\u590D\u76EE\u6807\u6216\u5524\u9192\u6210\u5458\uFF1Bpaused \u548C completed \u4E0E\u5DE5\u4F5C\u6458\u8981\u5206\u5F00\u5224\u65AD\u3002",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      output,
      execute: async (_args, exec) => {
        const own = session(exec);
        const id = exec.agent?.id ?? own.header.id;
        if (!id) throw Error("\u4F1A\u8BDD\u6807\u8BC6\u4E0D\u53EF\u7528");
        return JSON.stringify(await readNativeWork(host, id, exec.agent));
      }
    });
    host.tools.register({
      name: "task_review",
      // The shared index is updated and serialized synchronously; no mutable cursor is consumed.
      isConcurrencySafe: () => true,
      description: "\u8BFB\u53D6\u5F53\u524D\u4EFB\u52A1\u5DE5\u4F5C\u8BB0\u5F55\u4E0E\u6267\u884C\u6458\u8981\uFF0C\u9ED8\u8BA4\u6700\u8FD1 20 \u6761\u3002\u7528 nextBeforeSeq \u4F5C\u4E3A beforeSeq \u7FFB\u9605\u5386\u53F2\uFF1B\u9700\u8F93\u51FA\u6B63\u6587\u65F6\u7528 task_evidence\u3002returned \u4E0D\u4EE3\u8868\u6D4B\u8BD5\u901A\u8FC7\u3002",
      parameters: {
        type: "object",
        properties: {
          beforeSeq: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 50 }
        },
        additionalProperties: false
      },
      output,
      execute: async (args, exec) => JSON.stringify(reviewEvents(liveEvidence(session(exec)), true, args))
    });
    host.tools.register({
      name: "task_evidence",
      isConcurrencySafe: () => true,
      description: "\u6309\u771F\u5B9E callId \u8BFB\u53D6\u5F53\u524D\u4F1A\u8BDD\u7684\u4E00\u6761\u6267\u884C\u53CA\u5176\u6301\u4E45\u8F93\u51FA\uFF0C\u652F\u6301\u5386\u53F2\u8BB0\u5F55\u3002\u9ED8\u8BA4 4000 \u5B57\u7B26\uFF0C\u7528 nextOutputOffset \u7EE7\u7EED\u8BFB\u53D6\u3002\u53EA\u8BFB\u53D6\u65E5\u5FD7\uFF0C\u4E0D\u91CD\u8DD1\u547D\u4EE4\uFF1B\u4E0A\u6E38\u5DF2\u622A\u65AD\u6216\u672A\u4FDD\u5B58\u7684\u5185\u5BB9\u65E0\u6CD5\u6062\u590D\u3002",
      parameters: {
        type: "object",
        required: ["callId"],
        properties: {
          callId: { type: "string", minLength: 1, maxLength: 200 },
          offset: { type: "integer", minimum: 0 },
          maxChars: { type: "integer", minimum: 1, maximum: 8e3 }
        },
        additionalProperties: false
      },
      output,
      execute: async (args, exec) => {
        const value = evidenceDetail(liveEvidence(session(exec)), args.callId, true, args);
        if (!value) throw new Error("\u6B64\u4F1A\u8BDD\u6CA1\u6709\u8FD9\u6761\u6267\u884C\u8BB0\u5F55\uFF0C\u8BF7\u5148 task_review \u6838\u5BF9\u7F16\u53F7\u3002");
        return JSON.stringify(value);
      }
    });
    host.tools.register({
      name: "task_checkpoint",
      description: "\u4FDD\u5B58\u591A\u6B65\u9AA4\u4EFB\u52A1\u7684\u76EE\u6807\u3001\u8FDB\u5C55\u3001\u4E0B\u4E00\u6B65\u548C\u6267\u884C\u8BC1\u636E\u5F15\u7528\u5230\u5F53\u524D\u4F1A\u8BDD\u3002\u4E0D\u80FD\u66FF\u4EE3\u6D4B\u8BD5\u6216\u6279\u51C6\uFF1B\u5F15\u7528 task_review \u8FD4\u56DE\u7684\u5B9E\u9645 call id\uFF0C\u53EF\u5F15\u7528\u6210\u529F\u6216\u5931\u8D25\u7684\u5DF2\u7ED3\u7B97\u8BB0\u5F55\uFF08\u4F8B\u5982\u590D\u73B0\u5931\u8D25\u7684\u6D4B\u8BD5\uFF09\uFF0C\u4F46\u4E0D\u80FD\u5F15\u7528\u8FDB\u884C\u4E2D\u6216\u7ED3\u679C\u672A\u77E5\u7684\u8C03\u7528\u3002",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["goal", "summary", "nextStep", "state", "evidence"],
        properties: {
          goal: { type: "string" },
          summary: { type: "string" },
          nextStep: { type: "string" },
          state: { type: "string", enum: ["working", "blocked", "ready_for_review"] },
          evidence: { type: "array", items: { type: "string" } },
          constraints: { type: "string", maxLength: 2e3 },
          decisions: { type: "string", maxLength: 2e3 },
          nativeTaskIds: {
            type: "array",
            maxItems: 10,
            items: { type: "string", maxLength: 200 },
            description: "\u672C\u8D26\u672C\u6D89\u53CA\u7684\u539F\u751F Team \u4EFB\u52A1\u7F16\u53F7\uFF0C\u6765\u81EA task_state \u6216 team_task_list\uFF1B\u5BBF\u4E3B\u6838\u5BF9\u5E76\u4FDD\u5B58\u5BF9\u5E94 revision"
          },
          expectedCheckpointSeq: { type: "integer", minimum: 0 }
        }
      },
      output,
      execute: async (args, exec) => {
        const index = liveEvidence(session(exec));
        if (args?.expectedCheckpointSeq !== void 0 && args.expectedCheckpointSeq !== (reviewEvents(index).checkpoint?.seq ?? 0))
          throw new Error("\u8D26\u672C\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u5148 task_review \u8BFB\u53D6\u6700\u65B0\u72B6\u6001");
        const checkpoint = validateCheckpoint(args, index);
        delete checkpoint.native;
        const native = checkpointNativeRefs(host, exec.agent, args?.nativeTaskIds);
        if (native) checkpoint.native = native;
        return JSON.stringify({ checkpoint });
      }
    });
  });
  ctx.inject(["connection", "webServer", "sessions", "sessionPersistence"], (host) => {
    host.effect(
      () => host.webServer.register({
        kind: "exact",
        path: `${DEFAULTS.routePrefix}/state`,
        handler: async (req, res) => {
          if (rejectUnauthenticatedRequest(req, res, host.connection)) return;
          const send = (status, value) => {
            res.writeHead(status, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store"
            });
            res.end(JSON.stringify(value));
          };
          if (req.method !== "GET") return send(405, { error: "\u8BF7\u4F7F\u7528 GET" });
          const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
          const id = params.get("sessionId");
          if (!id || id.length > 200 || params.getAll("sessionId").length !== 1 || [...params.keys()].some((k) => k !== "sessionId"))
            return send(400, { error: "\u4F1A\u8BDD\u6807\u8BC6\u65E0\u6548", retryable: false });
          try {
            send(200, await readNativeWork(host, id));
          } catch (error) {
            const failure2 = readFailure(error);
            send(failure2.status, failure2);
          }
        }
      }),
      "taskflow: native state route"
    );
    const coldIndexes = /* @__PURE__ */ new Map();
    host.effect(() => () => coldIndexes.clear(), "taskflow: stored evidence cache");
    for (const kind of ["review", "evidence"])
      host.effect(
        () => host.webServer.register({
          kind: "exact",
          path: `${DEFAULTS.routePrefix}/${kind}`,
          handler: async (req, res) => {
            if (rejectUnauthenticatedRequest(req, res, host.connection)) return;
            const send = (status, data) => {
              res.writeHead(status, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
              });
              res.end(JSON.stringify(data));
            };
            if (req.method !== "GET") return send(405, { error: "\u8BF7\u4F7F\u7528 GET" });
            const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
            const id = params.get("sessionId");
            const invalid = (error) => send(400, { error, code: "INVALID_REQUEST", retryable: false });
            if (!id || id.length > 200 || params.getAll("sessionId").length !== 1)
              return invalid("\u4F1A\u8BDD\u6807\u8BC6\u65E0\u6548");
            let select;
            try {
              const allowed = kind === "review" ? ["sessionId", "beforeSeq", "limit"] : ["sessionId", "callId", "offset", "maxChars"];
              for (const key of params.keys())
                if (!allowed.includes(key)) return invalid("\u5B58\u5728\u4E0D\u652F\u6301\u7684\u67E5\u8BE2\u53C2\u6570");
              if (kind === "review") {
                const options = {
                  beforeSeq: queryInteger(
                    params,
                    "beforeSeq",
                    Number.MAX_SAFE_INTEGER,
                    0,
                    Number.MAX_SAFE_INTEGER
                  ),
                  limit: queryInteger(params, "limit", 20, 1, 50)
                };
                select = (events, live) => reviewEvents(events, live, options);
              } else {
                const callId = params.get("callId");
                if (!callId || callId.length > 200 || params.getAll("callId").length !== 1)
                  return invalid("\u6267\u884C\u7F16\u53F7\u65E0\u6548");
                const options = {
                  offset: queryInteger(params, "offset", 0, 0, Number.MAX_SAFE_INTEGER),
                  maxChars: queryInteger(params, "maxChars", 4e3, 1, 8e3)
                };
                select = (events, live) => evidenceDetail(events, callId, live, options);
              }
            } catch {
              return invalid("\u5206\u9875\u53C2\u6570\u65E0\u6548");
            }
            const respond = (events, live) => {
              const value = select(events, live);
              if (value === null)
                send(404, {
                  code: "EVIDENCE_NOT_FOUND",
                  error: "\u6B64\u4F1A\u8BDD\u6CA1\u6709\u8FD9\u6761\u6267\u884C\u8BB0\u5F55\u3002",
                  retryable: false
                });
              else send(200, value);
            };
            try {
              const live = host.sessions.get(id);
              if (live) {
                coldIndexes.delete(id);
                return respond(liveEvidence(live), true);
              }
              const revision = (await host.sessionPersistence.stat?.(id))?.revision;
              const cached = coldIndexes.get(id);
              if (revision && cached && cached.revision === revision) {
                coldIndexes.delete(id);
                coldIndexes.set(id, cached);
                return respond(cached.index, false);
              }
              const handle = await host.sessionPersistence.open(id, "read");
              let events;
              let readFailed = false;
              try {
                ;
                ({ events } = await handle.read());
              } catch (error) {
                readFailed = true;
                throw error;
              } finally {
                try {
                  await handle.close();
                } catch (closeError) {
                  if (!readFailed) throw closeError;
                }
              }
              const index = new EvidenceIndex().update(events);
              const after = (await host.sessionPersistence.stat?.(id))?.revision;
              coldIndexes.delete(id);
              if (revision && revision === after && index.cacheCost <= 16e6) {
                coldIndexes.set(id, { revision, index });
                let chars = [...coldIndexes.values()].reduce((sum, entry) => sum + entry.index.cacheCost, 0);
                while (coldIndexes.size > 8 || chars > 16e6) {
                  const oldest = coldIndexes.keys().next().value;
                  chars -= coldIndexes.get(oldest).index.cacheCost;
                  coldIndexes.delete(oldest);
                }
              }
              respond(index, false);
            } catch (error) {
              const failure2 = readFailure(error);
              send(failure2.status, failure2);
            }
          }
        }),
        `taskflow: ${kind} route`
      );
  });
}
export {
  DEFAULTS,
  POLICY,
  apply,
  inject,
  name,
  readFailure
};
