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

// packages/dsh-px-taskflow/src/evidence.ts
var reads = /* @__PURE__ */ new Set(["read", "ls", "list", "glob", "grep", "search", "web_search", "web_fetch", "present", "job_output", "job_list", "task_review", "task_evidence"]);
var writes = /* @__PURE__ */ new Set(["write", "edit"]);
var commands = /* @__PURE__ */ new Set(["pwsh", "bash", "shell"]);
var internal = /* @__PURE__ */ new Set(["task_review", "task_evidence", "task_checkpoint"]);
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
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error("\u5206\u9875\u53C2\u6570\u65E0\u6548");
  return value;
}
function readCheckpoint(value) {
  if (!value || typeof value !== "object") return null;
  const v = value;
  if (![v.goal, v.summary, v.nextStep].every((x) => typeof x === "string" && x.length <= 4e3) || !v.goal.trim() || !v.summary.trim() || !["working", "blocked", "ready_for_review"].includes(v.state) || !Array.isArray(v.evidence) || v.evidence.length > 20 || !v.evidence.every((x) => typeof x === "string" && x.length <= 200)) return null;
  if (v.state !== "ready_for_review" && !v.nextStep.trim()) return null;
  return { goal: v.goal, summary: v.summary, nextStep: v.nextStep, state: v.state, evidence: [...new Set(v.evidence)] };
}
function effectOf(tool, args) {
  if (reads.has(tool) || tool === "str_replace_editor" && args.command === "view") return "read";
  if (writes.has(tool) || tool === "str_replace_editor" && ["create", "str_replace", "insert", "undo_edit"].includes(args.command)) return "write";
  return "unknown";
}
function resultStatus(tool, text, isError) {
  if (isError && /^(?:Error:\s*)?tool call aborted\s*$/i.test(text)) return { outcome: "cancelled", outcomeSource: "tool" };
  if (isError) return { outcome: "error", outcomeSource: "tool" };
  if (commands.has(tool)) {
    const markers = text.trimEnd().split(/\r?\n/).reverse();
    for (const line of markers) {
      if (!/^\[(?:exit code: -?\d+|timed out[^\]]*|killed by signal:[^\]]*|sandbox:[^\]]*)\]$/i.test(line)) break;
      const exit = /^\[exit code: (-?\d+)\]$/i.exec(line);
      if (exit ? Number(exit[1]) !== 0 : /^\[(?:timed out|killed by signal|sandbox: file access denied)/i.test(line)) {
        return { outcome: "error", outcomeSource: "command_marker" };
      }
    }
  }
  return { outcome: "returned", outcomeSource: "tool" };
}
function foldEvents(events, live) {
  const calls = /* @__PURE__ */ new Map();
  const pending = /* @__PURE__ */ new Set();
  let checkpoint = null;
  let activeTurn = false;
  for (const event of events) {
    const data = event.data ?? {};
    if (["turn/start", "turn/end", "session/end-seed"].includes(event.type)) {
      const cancelled = event.type === "turn/end" && data.reason?.kind === "aborted" && data.reason?.reason?.kind === "user";
      for (const call of pending) {
        call.outcome = cancelled ? "cancelled" : "interrupted";
        call.outcomeSource = "turn";
      }
      pending.clear();
      activeTurn = event.type === "turn/start";
    }
    if (event.type === "tool/call" || event.type === "tool/ptc-dispatch-start") {
      const raw = typeof data.arguments === "string" ? parse(data.arguments) : data.arguments;
      const args = raw && typeof raw === "object" ? raw : {};
      const id = data.callId ?? data.subCallId;
      if (typeof id !== "string" || typeof data.name !== "string") continue;
      const effect = effectOf(data.name, args);
      const previous = calls.get(id);
      if (previous) pending.delete(previous);
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
      pending.add(call);
    }
    if (event.type === "tool/result" || event.type === "tool/ptc-dispatch") {
      const blocks = event.type === "tool/result" ? (data.message?.content ?? []).filter((b) => b.type === "tool-result") : [data];
      for (const block of blocks) {
        const call = calls.get(block.toolCallId ?? data.subCallId);
        if (!call) continue;
        const text = (block.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
        Object.assign(call, resultStatus(call.tool, text, block.isError === true));
        pending.delete(call);
        call.output = text;
        call.outputLength = text.length;
        call.durationMs = Math.max(0, event.time - call.time);
        if (call.tool === "task_checkpoint" && call.outcome === "returned") {
          const value = readCheckpoint(parse(text).checkpoint);
          if (value) checkpoint = { ...value, seq: event.seq, time: event.time };
        }
      }
    }
  }
  if (!activeTurn || !live) for (const call of pending) {
    call.outcome = "interrupted";
    call.outcomeSource = "turn";
  }
  return { calls, relevant: [...calls.values()].filter((call) => !internal.has(call.tool)), checkpoint };
}
function summary(call) {
  return { ...call, input: clip(call.input, 180), output: clip(call.output, 240), outputTruncated: call.outputLength > 240 };
}
function reviewEvents(events, live = true, options = {}) {
  const limit = integerOption(options.limit, 20, 1, 50);
  const before = integerOption(options.beforeSeq, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
  const { relevant, checkpoint } = foldEvents(events, live);
  const eligible = relevant.filter((call) => call.seq < before);
  const page = eligible.slice(-limit);
  return {
    checkpoint,
    executions: page.map(summary),
    referencedExecutions: checkpoint ? relevant.filter((call) => checkpoint.evidence.includes(call.id)).map(summary) : [],
    total: relevant.length,
    truncated: eligible.length > page.length,
    nextBeforeSeq: eligible.length > page.length ? page[0].seq : null,
    changedFiles: [...new Set(relevant.filter((call) => call.file && call.outcome === "returned").map((call) => call.file))].slice(-200),
    checkpointStale: Boolean(checkpoint && relevant.some((call) => call.seq > checkpoint.seq && call.effect !== "read"))
  };
}
function evidenceDetail(events, id, live = true, options = {}) {
  if (typeof id !== "string" || !id || id.length > 200) throw new Error("\u6267\u884C\u7F16\u53F7\u65E0\u6548");
  const offset = integerOption(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const size = integerOption(options.maxChars, 4e3, 1, 8e3);
  const call = foldEvents(events, live).relevant.find((call2) => call2.id === id);
  if (!call) return null;
  const next = offset + size < call.outputLength ? offset + size : null;
  return {
    ...call,
    output: call.output.slice(offset, offset + size),
    outputOffset: offset,
    outputTruncated: offset > 0 || next !== null,
    nextOutputOffset: next
  };
}
function validateCheckpoint(args, events) {
  const checkpoint = readCheckpoint(args);
  if (!checkpoint) throw new Error("\u4EFB\u52A1\u8BB0\u5F55\u683C\u5F0F\u65E0\u6548\uFF1B\u8FDB\u884C\u4E2D\u6216\u963B\u585E\u65F6\u5FC5\u987B\u586B\u5199\u4E0B\u4E00\u6B65\u3002");
  const { calls } = foldEvents(events, true);
  for (const id of checkpoint.evidence) {
    const call = calls.get(id);
    if (!call || internal.has(call.tool) || !["returned", "error"].includes(call.outcome)) throw new Error(`\u8BC1\u636E ${id} \u4E0D\u5B58\u5728\uFF0C\u6216\u6CA1\u6709\u5DF2\u7ED3\u7B97\u7ED3\u679C\uFF1B\u8BF7\u5148 task_review / task_evidence \u6838\u5BF9\u3002`);
  }
  if (checkpoint.state === "ready_for_review" && checkpoint.evidence.length === 0) throw new Error("\u4EA4\u4ED8\u524D\u81F3\u5C11\u5F15\u7528\u4E00\u6761\u5B9E\u9645\u6267\u884C\u8BB0\u5F55\uFF1B\u8FD9\u4E0D\u662F\u6D4B\u8BD5\u8986\u76D6\u7387\u6216\u4EE3\u7801\u6B63\u786E\u6027\u7684\u4FDD\u8BC1\u3002");
  return checkpoint;
}

// packages/dsh-px-taskflow/src/index.ts
var name = "dsh-px-taskflow";
var inject = [];
var DEFAULTS = { routePrefix: "/dsh-px-taskflow" };
var POLICY = `You are working inside DSH-PX, a local agent product. Respond in the user's language; for Chinese requests, write progress and final delivery in Chinese. For non-trivial implementation tasks, carry the work through inspection, implementation, relevant validation, and a reviewable delivery. Read repository instructions, inspect existing changes, and preserve unrelated work. Use the host's todo, file, shell, permission, and delivery tools; obey plan mode and user instructions. Do not invent a separate execution or approval mechanism.
For a multi-step implementation task, record the goal and next action with task_checkpoint. On resuming or being asked for progress, call task_review to recover the latest checkpoint and compact execution summaries. Follow nextBeforeSeq to page older calls. Use task_evidence with a callId to read its recorded output in bounded pages; a summary may omit essential test output. Before final delivery, inspect the changes with the existing Git/file tools, run the relevant checks, then call task_review and record a ready_for_review checkpoint referencing actual call ids. Any settled non-internal call in this session may be cited, including older pages. Tool return success does not prove tests passed: read the output and state what was and was not verified. If blocked, record the concrete blocker and next action. Never retry a possibly mutating interrupted call blindly; reconcile its effect first. Skip checkpoints for simple questions or trivial edits. A checkpoint is a work note, not user approval or permission to continue autonomously in the background.`;
function readFailure(error) {
  const e = error;
  if (e?.name === "SessionPersistenceNotFoundError" || e?.code === "ENOENT") return { status: 404, code: "SESSION_NOT_FOUND", error: "\u6B64\u4F1A\u8BDD\u8BB0\u5F55\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u4F1A\u8BDD\u3002", retryable: false };
  if (e?.name === "SessionPersistenceCorruptionError" || e instanceof SyntaxError || /^(?:corrupt (?:Zstandard )?session log(?::| ")|empty or header-less (?:Zstandard )?session log$)/.test(e?.message ?? "")) return { status: 422, code: "SESSION_CORRUPT", error: "\u4F1A\u8BDD\u8BB0\u5F55\u635F\u574F\uFF0C\u65E0\u6CD5\u53EF\u9760\u8BFB\u53D6\u3002\u8BF7\u4FDD\u7559\u65E5\u5FD7\u5E76\u68C0\u67E5\u5907\u4EFD\u3002", retryable: false };
  if (e?.name === "SessionFormatUnsupportedError") return { status: 409, code: "SESSION_FORMAT_UNSUPPORTED", error: "\u5F53\u524D\u7248\u672C\u65E0\u6CD5\u8BFB\u53D6\u6B64\u4F1A\u8BDD\u683C\u5F0F\uFF0C\u8BF7\u4F7F\u7528\u517C\u5BB9\u7248\u672C\u3002", retryable: false };
  if (["EACCES", "EPERM"].includes(e?.code ?? "")) return { status: 403, code: "SESSION_ACCESS_DENIED", error: "\u6CA1\u6709\u8BFB\u53D6\u4F1A\u8BDD\u8BB0\u5F55\u7684\u6743\u9650\uFF0C\u8BF7\u68C0\u67E5\u6570\u636E\u76EE\u5F55\u6743\u9650\u3002", retryable: false };
  if (["EBUSY", "EAGAIN", "ETIMEDOUT"].includes(e?.code ?? "") || e?.name === "SessionAlreadyOwnedError") return { status: 503, code: "SESSION_BUSY", error: "\u4F1A\u8BDD\u8BB0\u5F55\u6682\u65F6\u4E0D\u53EF\u8BFB\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", retryable: true };
  return { status: 500, code: "SESSION_READ_FAILED", error: "\u8BFB\u53D6\u4F1A\u8BDD\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u6216\u68C0\u67E5\u670D\u52A1\u65E5\u5FD7\u3002", retryable: true };
}
function queryInteger(params, key, fallback, min, max) {
  if (!params.has(key)) return fallback;
  const value = params.get(key);
  if (params.getAll(key).length !== 1 || !/^(0|[1-9]\d*)$/.test(value)) throw new Error("\u5206\u9875\u53C2\u6570\u65E0\u6548");
  return integerOption(Number(value), fallback, min, max);
}
function apply(ctx) {
  ctx.inject(["systemPrompt"], (host) => {
    host.effect(() => host.systemPrompt.section({ name: "dsh-px-delivery-workflow", order: 9900, text: POLICY }), "taskflow: workflow");
  });
  ctx.inject(["tools"], (host) => {
    const output = { schema: { type: "string" }, render: (_, value) => [{ type: "text", text: value }] };
    const session = (exec) => {
      exec.signal.throwIfAborted();
      if (!exec.agent) throw new Error("\u6B64\u5DE5\u5177\u9700\u8981\u5F53\u524D\u4F1A\u8BDD");
      return exec.agent.session;
    };
    host.tools.register({
      name: "task_review",
      description: "\u8BFB\u53D6\u5F53\u524D\u4EFB\u52A1\u5DE5\u4F5C\u8BB0\u5F55\u4E0E\u6267\u884C\u6458\u8981\uFF0C\u9ED8\u8BA4\u6700\u8FD1 20 \u6761\u3002\u7528 nextBeforeSeq \u4F5C\u4E3A beforeSeq \u7FFB\u9605\u5386\u53F2\uFF1B\u9700\u8F93\u51FA\u6B63\u6587\u65F6\u7528 task_evidence\u3002returned \u4E0D\u4EE3\u8868\u6D4B\u8BD5\u901A\u8FC7\u3002",
      parameters: { type: "object", properties: { beforeSeq: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
      output,
      execute: async (args, exec) => JSON.stringify(reviewEvents(session(exec).snapshotEvents(), true, args))
    });
    host.tools.register({
      name: "task_evidence",
      description: "\u6309\u771F\u5B9E callId \u8BFB\u53D6\u5F53\u524D\u4F1A\u8BDD\u7684\u4E00\u6761\u6267\u884C\u53CA\u5176\u6301\u4E45\u8F93\u51FA\uFF0C\u652F\u6301\u5386\u53F2\u8BB0\u5F55\u3002\u9ED8\u8BA4 4000 \u5B57\u7B26\uFF0C\u7528 nextOutputOffset \u7EE7\u7EED\u8BFB\u53D6\u3002\u53EA\u8BFB\u53D6\u65E5\u5FD7\uFF0C\u4E0D\u91CD\u8DD1\u547D\u4EE4\uFF1B\u4E0A\u6E38\u5DF2\u622A\u65AD\u6216\u672A\u4FDD\u5B58\u7684\u5185\u5BB9\u65E0\u6CD5\u6062\u590D\u3002",
      parameters: { type: "object", required: ["callId"], properties: { callId: { type: "string", minLength: 1, maxLength: 200 }, offset: { type: "integer", minimum: 0 }, maxChars: { type: "integer", minimum: 1, maximum: 8e3 } }, additionalProperties: false },
      output,
      execute: async (args, exec) => {
        const value = evidenceDetail(session(exec).snapshotEvents(), args.callId, true, args);
        if (!value) throw new Error("\u6B64\u4F1A\u8BDD\u6CA1\u6709\u8FD9\u6761\u6267\u884C\u8BB0\u5F55\uFF0C\u8BF7\u5148 task_review \u6838\u5BF9\u7F16\u53F7\u3002");
        return JSON.stringify(value);
      }
    });
    host.tools.register({
      name: "task_checkpoint",
      description: "\u4FDD\u5B58\u591A\u6B65\u9AA4\u4EFB\u52A1\u7684\u76EE\u6807\u3001\u8FDB\u5C55\u3001\u4E0B\u4E00\u6B65\u548C\u6267\u884C\u8BC1\u636E\u5F15\u7528\u5230\u5F53\u524D\u4F1A\u8BDD\u3002\u4E0D\u80FD\u66FF\u4EE3\u6D4B\u8BD5\u6216\u6279\u51C6\uFF1B\u5F15\u7528 task_review \u8FD4\u56DE\u7684\u5B9E\u9645 call id\uFF0C\u53EF\u5F15\u7528\u6210\u529F\u6216\u5931\u8D25\u7684\u5DF2\u7ED3\u7B97\u8BB0\u5F55\uFF08\u4F8B\u5982\u590D\u73B0\u5931\u8D25\u7684\u6D4B\u8BD5\uFF09\uFF0C\u4F46\u4E0D\u80FD\u5F15\u7528\u8FDB\u884C\u4E2D\u6216\u7ED3\u679C\u672A\u77E5\u7684\u8C03\u7528\u3002",
      parameters: { type: "object", additionalProperties: false, required: ["goal", "summary", "nextStep", "state", "evidence"], properties: {
        goal: { type: "string" },
        summary: { type: "string" },
        nextStep: { type: "string" },
        state: { type: "string", enum: ["working", "blocked", "ready_for_review"] },
        evidence: { type: "array", items: { type: "string" } }
      } },
      output,
      execute: async (args, exec) => JSON.stringify({ checkpoint: validateCheckpoint(args, session(exec).snapshotEvents()) })
    });
  });
  ctx.inject(["webServer", "sessions", "sessionPersistence"], (host) => {
    for (const kind of ["review", "evidence"]) host.effect(() => host.webServer.register({ kind: "exact", path: `${DEFAULTS.routePrefix}/${kind}`, handler: async (req, res) => {
      const send = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(data));
      };
      if (req.method !== "GET") return send(405, { error: "\u8BF7\u4F7F\u7528 GET" });
      const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
      const id = params.get("sessionId");
      const invalid = (error) => send(400, { error, code: "INVALID_REQUEST", retryable: false });
      if (!id || id.length > 200 || params.getAll("sessionId").length !== 1 || !/^[a-zA-Z0-9_-]+$/.test(id)) return invalid("\u4F1A\u8BDD\u6807\u8BC6\u65E0\u6548");
      let select;
      try {
        const allowed = kind === "review" ? ["sessionId", "beforeSeq", "limit"] : ["sessionId", "callId", "offset", "maxChars"];
        for (const key of params.keys()) if (!allowed.includes(key)) return invalid("\u5B58\u5728\u4E0D\u652F\u6301\u7684\u67E5\u8BE2\u53C2\u6570");
        if (kind === "review") {
          const options = { beforeSeq: queryInteger(params, "beforeSeq", Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER), limit: queryInteger(params, "limit", 20, 1, 50) };
          select = (events, live) => reviewEvents(events, live, options);
        } else {
          const callId = params.get("callId");
          if (!callId || callId.length > 200 || params.getAll("callId").length !== 1) return invalid("\u6267\u884C\u7F16\u53F7\u65E0\u6548");
          const options = { offset: queryInteger(params, "offset", 0, 0, Number.MAX_SAFE_INTEGER), maxChars: queryInteger(params, "maxChars", 4e3, 1, 8e3) };
          select = (events, live) => evidenceDetail(events, callId, live, options);
        }
      } catch {
        return invalid("\u5206\u9875\u53C2\u6570\u65E0\u6548");
      }
      const respond = (events, live) => {
        const value = select(events, live);
        if (value === null) send(404, { code: "EVIDENCE_NOT_FOUND", error: "\u6B64\u4F1A\u8BDD\u6CA1\u6709\u8FD9\u6761\u6267\u884C\u8BB0\u5F55\u3002", retryable: false });
        else send(200, value);
      };
      try {
        const live = host.sessions.get(id);
        if (live) return respond(live.snapshotEvents(), true);
        const handle = await host.sessionPersistence.open(id, "read");
        let events;
        let readFailed = false;
        try {
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
        respond(events, false);
      } catch (error) {
        const failure = readFailure(error);
        send(failure.status, failure);
      }
    } }), `taskflow: ${kind} route`);
  });
}
export {
  DEFAULTS,
  apply,
  inject,
  name,
  readFailure
};
