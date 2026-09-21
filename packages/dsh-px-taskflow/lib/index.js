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
var clip = (value, length) => typeof value === "string" ? value.slice(0, length) : "";
var writes = /* @__PURE__ */ new Set(["write", "edit", "str_replace_editor"]);
function parse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
function readCheckpoint(value) {
  if (!value || typeof value !== "object") return null;
  const v = value;
  if (![v.goal, v.summary, v.nextStep].every((x) => typeof x === "string" && x.length <= 4e3) || !v.goal.trim() || !v.summary.trim() || !["working", "blocked", "ready_for_review"].includes(v.state) || !Array.isArray(v.evidence) || v.evidence.length > 20 || !v.evidence.every((x) => typeof x === "string" && x.length <= 200)) return null;
  if (v.state !== "ready_for_review" && !v.nextStep.trim()) return null;
  return { goal: v.goal, summary: v.summary, nextStep: v.nextStep, state: v.state, evidence: [...new Set(v.evidence)] };
}
function reviewEvents(events, live = true) {
  const calls = /* @__PURE__ */ new Map();
  let checkpoint = null;
  let activeTurn = false;
  for (const event of events) {
    const data = event.data;
    if (["turn/start", "turn/end", "session/end-seed"].includes(event.type)) {
      for (const call of calls.values()) if (call.outcome === "running") call.outcome = "interrupted";
      activeTurn = event.type === "turn/start";
    }
    if (event.type === "tool/call" || event.type === "tool/ptc-dispatch-start") {
      const rawArgs = typeof data.arguments === "string" ? parse(data.arguments) : data.arguments;
      const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
      const id = data.callId ?? data.subCallId;
      if (typeof id !== "string" || typeof data.name !== "string") continue;
      calls.set(id, {
        id,
        seq: event.seq,
        tool: data.name,
        input: clip(args.command ?? args.description ?? args.path ?? args.file_path ?? "", 1200),
        file: writes.has(data.name) ? clip(args.path ?? args.file_path, 1e3) || null : null,
        outcome: "running",
        output: "",
        time: event.time,
        durationMs: null
      });
    }
    if (event.type === "tool/result" || event.type === "tool/ptc-dispatch") {
      const block = event.type === "tool/result" ? data.message?.content?.find((b) => b.type === "tool-result") : data;
      if (!block) continue;
      const call = calls.get(block.toolCallId ?? data.subCallId);
      if (!call) continue;
      const text = (block.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const failedExit = [...text.matchAll(/\[exit code:\s*(-?\d+)\]/gi)].some((match) => Number(match[1]) !== 0);
      call.outcome = block.isError || failedExit || /\[sandbox: file access denied|\[timed out/i.test(text) ? "error" : "returned";
      call.output = text.length > 2400 ? text.slice(0, 1600) + "\n\u2026\u8F93\u51FA\u5DF2\u622A\u65AD\uFF0C\u5B8C\u6574\u5185\u5BB9\u89C1\u4F1A\u8BDD\u5DE5\u5177\u8BB0\u5F55\u2026\n" + text.slice(-800) : text;
      call.durationMs = Math.max(0, event.time - call.time);
      if (call.tool === "task_checkpoint" && call.outcome === "returned") {
        const value = readCheckpoint(parse(text).checkpoint);
        if (value) checkpoint = { ...value, seq: event.seq, time: event.time };
      }
    }
  }
  const relevant = [...calls.values()].filter((call) => !["task_review", "task_checkpoint"].includes(call.tool));
  for (const call of relevant) if (call.outcome === "running" && (!activeTurn || !live)) call.outcome = "interrupted";
  return {
    checkpoint,
    executions: relevant.slice(-80),
    total: relevant.length,
    truncated: relevant.length > 80,
    changedFiles: [...new Set(relevant.filter((call) => call.file && call.outcome === "returned").map((call) => call.file))].slice(-200),
    checkpointStale: Boolean(checkpoint && relevant.some((call) => call.seq > checkpoint.seq))
  };
}
function validateCheckpoint(args, events) {
  const checkpoint = readCheckpoint(args);
  if (!checkpoint) throw new Error("\u4EFB\u52A1\u8BB0\u5F55\u683C\u5F0F\u65E0\u6548\uFF1B\u8FDB\u884C\u4E2D\u6216\u963B\u585E\u65F6\u5FC5\u987B\u586B\u5199\u4E0B\u4E00\u6B65\u3002");
  const review = reviewEvents(events);
  for (const id of checkpoint.evidence) {
    const call = review.executions.find((call2) => call2.id === id);
    if (!call || !["returned", "error"].includes(call.outcome)) throw new Error(`\u8BC1\u636E ${id} \u4E0D\u5B58\u5728\u3001\u5DF2\u8D85\u51FA\u8FD1\u671F\u8BB0\u5F55\uFF0C\u6216\u6CA1\u6709\u5DF2\u7ED3\u7B97\u7ED3\u679C\uFF1B\u8BF7\u5148 task_review \u6838\u5BF9\u3002`);
  }
  if (checkpoint.state === "ready_for_review" && checkpoint.evidence.length === 0) throw new Error("\u4EA4\u4ED8\u524D\u81F3\u5C11\u5F15\u7528\u4E00\u6761\u5B9E\u9645\u6267\u884C\u8BB0\u5F55\uFF1B\u8FD9\u4E0D\u662F\u6D4B\u8BD5\u8986\u76D6\u7387\u6216\u4EE3\u7801\u6B63\u786E\u6027\u7684\u4FDD\u8BC1\u3002");
  return checkpoint;
}

// packages/dsh-px-taskflow/src/index.ts
var name = "dsh-px-taskflow";
var inject = [];
var DEFAULTS = { routePrefix: "/dsh-px-taskflow" };
var POLICY = `You are working inside DSH-PX, a local agent product. Respond in the user's language; for Chinese requests, write progress and final delivery in Chinese. For non-trivial implementation tasks, carry the work through inspection, implementation, relevant validation, and a reviewable delivery. Read repository instructions, inspect existing changes, and preserve unrelated work. Use the host's todo, file, shell, permission, and delivery tools; obey plan mode and user instructions. Do not invent a separate execution or approval mechanism.
For a multi-step implementation task, record the goal and next action with task_checkpoint. On resuming or being asked for progress, call task_review to recover the latest checkpoint and actual execution evidence. Before final delivery, inspect the changes with the existing Git/file tools, run the relevant checks, then call task_review and record a ready_for_review checkpoint referencing actual call ids. Tool return success does not prove tests passed: read the output and state what was and was not verified. If blocked, record the concrete blocker and next action. Never retry a possibly mutating interrupted call blindly; reconcile its effect first. Skip checkpoints for simple questions or trivial edits. A checkpoint is a work note, not user approval or permission to continue autonomously in the background.`;
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
      description: "\u8BFB\u53D6\u5F53\u524D\u4EFB\u52A1\u7684\u6301\u4E45\u5DE5\u4F5C\u8BB0\u5F55\u4E0E\u771F\u5B9E\u5DE5\u5177\u6267\u884C\u8BC1\u636E\u3002\u6062\u590D\u5DE5\u4F5C\u3001\u6838\u5BF9\u8FDB\u5EA6\u6216\u4EA4\u4ED8\u524D\u4F7F\u7528\u3002returned \u53EA\u8868\u793A\u5DE5\u5177\u6B63\u5E38\u8FD4\u56DE\uFF0C\u4E0D\u4EE3\u8868\u6D4B\u8BD5\u6216\u4EFB\u52A1\u901A\u8FC7\u3002",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      output,
      execute: async (_, exec) => JSON.stringify(reviewEvents(session(exec).snapshotEvents()))
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
    host.effect(() => host.webServer.register({ kind: "exact", path: `${DEFAULTS.routePrefix}/review`, handler: async (req, res) => {
      const send = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(data));
      };
      if (req.method !== "GET") return send(405, { error: "\u8BF7\u4F7F\u7528 GET" });
      const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
      const id = params.get("sessionId");
      if (!id || id.length > 200 || params.getAll("sessionId").length !== 1 || !/^[a-zA-Z0-9_-]+$/.test(id)) return send(400, { error: "\u4F1A\u8BDD\u6807\u8BC6\u65E0\u6548" });
      try {
        const live = host.sessions.get(id);
        if (live) return send(200, reviewEvents(live.snapshotEvents()));
        const handle = await host.sessionPersistence.open(id, "read");
        try {
          const { events } = await handle.read();
          send(200, reviewEvents(events, false));
        } finally {
          await handle.close();
        }
      } catch {
        send(404, { error: "\u65E0\u6CD5\u8BFB\u53D6\u6B64\u4F1A\u8BDD\uFF0C\u7A0D\u540E\u91CD\u8BD5\u3002" });
      }
    } }), "taskflow: review route");
  });
}
export {
  DEFAULTS,
  apply,
  inject,
  name
};
