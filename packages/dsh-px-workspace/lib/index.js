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

// packages/dsh-px-workspace/src/index.ts
import { join } from "node:path";

// packages/dsh-px-workspace/src/model.ts
function messages(events) {
  const rows = [];
  for (const e of events) {
    if (e.type !== "user/message" && e.type !== "assistant/message") continue;
    const m = e.type === "user/message" ? e.data : e.data?.message;
    if (e.type === "user/message" && m?.source?.kind !== "user") continue;
    if (!m || typeof m.id !== "string" || !Array.isArray(m.content)) continue;
    const text2 = m.content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
    if (text2.trim()) rows.push({ id: m.id, seq: e.seq, time: e.time, role: e.type === "user/message" ? "user" : "assistant", text: text2 });
  }
  return rows;
}
function artifacts(events) {
  const rows = /* @__PURE__ */ new Map();
  for (const e of events) if (e.type === "deliverables/presented" && Array.isArray(e.data?.files)) {
    for (const f of e.data.files) if (typeof f?.path === "string" && f.path.length > 0 && f.path.length <= 4096) {
      rows.set(f.path, { path: f.path, description: typeof f.description === "string" ? f.description.slice(0, 2e3) : "", time: e.time, seq: e.seq });
    }
  }
  return [...rows.values()].sort((a, b) => b.seq - a.seq);
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
import { mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
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
  if (typeof value !== "string" || value.length > max || required && !value.trim()) throw new InputError(`\u6587\u672C\u4E0D\u80FD\u4E3A\u7A7A\u4E14\u4E0D\u80FD\u8D85\u8FC7 ${max} \u5B57\u7B26`);
  return value;
}
function timing(value) {
  if (value?.kind === "once" && Number.isSafeInteger(value.at) && value.at > 0 && value.at < 864e13) return { kind: "once", at: value.at };
  if (value?.kind === "interval" && Number.isInteger(value.minutes) && value.minutes >= 1 && value.minutes <= 525600) return { kind: "interval", minutes: value.minutes };
  if (value?.kind === "daily" && typeof value.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) return { kind: "daily", time: value.time };
  throw new InputError("\u8BF7\u9009\u62E9\u6709\u6548\u65F6\u95F4\uFF1B\u95F4\u9694\u81F3\u5C11 1 \u5206\u949F");
}
function finite(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}
function validateState(v) {
  if (v?.version !== 1 || !Array.isArray(v.annotations) || !Array.isArray(v.schedules) || v.annotations.length > 2e3 || v.schedules.length > 100) throw new Error("\u5DE5\u4F5C\u533A\u6570\u636E\u683C\u5F0F\u4E0D\u53D7\u652F\u6301");
  const ids = /* @__PURE__ */ new Set();
  for (const a of v.annotations) {
    identifier(a.id);
    identifier(a.sessionId);
    identifier(a.messageId);
    text(a.quote, 8e3);
    text(a.note, 4e3, false);
    if (!Number.isInteger(a.seq) || a.seq < 0 || !["user", "assistant"].includes(a.role) || !/^[a-f0-9]{64}$/.test(a.sourceHash) || !finite(a.updatedAt) || ids.has(a.id)) throw new Error("\u6279\u6CE8\u6570\u636E\u635F\u574F");
    ids.add(a.id);
  }
  for (const s of v.schedules) {
    identifier(s.id);
    identifier(s.sessionId);
    text(s.title, 100);
    text(s.prompt, 4e3);
    timing(s.timing);
    if (typeof s.enabled !== "boolean" || !(s.nextAt === null || finite(s.nextAt)) || s.enabled && s.nextAt === null || !finite(s.updatedAt) || !Array.isArray(s.history) || s.history.length > 20 || ids.has(s.id)) throw new Error("\u5B9A\u65F6\u4EFB\u52A1\u6570\u636E\u635F\u574F");
    if (typeof s.timeZone !== "string") throw new Error("\u4EFB\u52A1\u65F6\u533A\u7F3A\u5931");
    new Intl.DateTimeFormat("en", { timeZone: s.timeZone });
    for (const h of s.history) if (!finite(h.time) || !["dispatching", "queued", "uncertain"].includes(h.status) || typeof h.requestId !== "string" || h.detail !== void 0 && typeof h.detail !== "string") throw new Error("\u6295\u9012\u8BB0\u5F55\u635F\u574F");
    ids.add(s.id);
  }
}
var WorkspaceStore = class {
  constructor(path) {
    this.path = path;
    try {
      if (statSync(path).size > 32 * 1024 * 1024) throw new Error("\u5DE5\u4F5C\u533A\u6570\u636E\u6587\u4EF6\u8FC7\u5927");
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      validateState(parsed);
      this.state = parsed;
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u4F1A\u8BDD\u5DE5\u4F5C\u533A\u6570\u636E\uFF0C\u8BF7\u4FDD\u7559\u539F\u6587\u4EF6\u5E76\u68C0\u67E5\u65E5\u5FD7\u3002" + String(error));
      this.state = { version: 1, annotations: [], schedules: [] };
    }
  }
  state;
  snapshot() {
    return structuredClone(this.state);
  }
  update(fn) {
    const next = this.snapshot();
    fn(next);
    validateState(next);
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > 32 * 1024 * 1024) throw new InputError("\u5DE5\u4F5C\u533A\u8BB0\u5F55\u5DF2\u8FBE 32 MB \u4E0A\u9650\uFF0C\u8BF7\u5148\u6E05\u7406\u65E7\u6279\u6CE8\u6216\u4EFB\u52A1");
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path + ".tmp", serialized, { mode: 384 });
    renameSync(this.path + ".tmp", this.path);
    this.state = next;
  }
  saveAnnotation(input, source, now = Date.now()) {
    const sessionId = identifier(input.sessionId);
    const quote = text(input.quote, 8e3), note = text(input.note, 4e3, false);
    if (source.id !== input.messageId || !source.text.includes(quote)) throw new InputError("\u5F15\u7528\u5FC5\u987B\u662F\u6240\u9009\u6D88\u606F\u4E2D\u7684\u8FDE\u7EED\u539F\u6587");
    const id = input.id === void 0 ? randomUUID() : identifier(input.id);
    const sourceHash = createHash("sha256").update(source.text).digest("hex");
    let saved;
    this.update((state) => {
      const old = state.annotations.find((a) => a.id === id);
      if (input.id !== void 0 && !old) throw new InputError("\u6279\u6CE8\u5DF2\u5220\u9664", 404);
      if (old && (old.sessionId !== sessionId || old.messageId !== source.id || old.updatedAt !== input.updatedAt)) throw new InputError("\u6279\u6CE8\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5", 409);
      if (!old && state.annotations.length >= 2e3) throw new InputError("\u6279\u6CE8\u5DF2\u8FBE\u4E0A\u9650\uFF0C\u8BF7\u5148\u6E05\u7406\u65E7\u6279\u6CE8");
      saved = { id, sessionId, messageId: source.id, seq: source.seq, role: source.role, sourceHash, quote, note, updatedAt: Math.max(now, (old?.updatedAt ?? 0) + 1) };
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
var Scheduler = class {
  constructor(store, deliver, zone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = Date.now) {
    this.store = store;
    this.deliver = deliver;
    this.zone = zone;
    this.now = now;
    const interrupted = store.snapshot().schedules.some((s) => s.history.some((h) => h.status === "dispatching"));
    if (interrupted) store.update((state) => {
      for (const s of state.schedules) if (s.history.some((h) => h.status === "dispatching")) {
        s.enabled = false;
        s.nextAt = null;
        s.updatedAt = this.now();
        for (const h of s.history) if (h.status === "dispatching") {
          h.status = "uncertain";
          h.detail = "\u4E0A\u6B21\u6295\u9012\u671F\u95F4\u670D\u52A1\u4E2D\u65AD\uFF1B\u8BF7\u5148\u68C0\u67E5\u76EE\u6807\u4F1A\u8BDD\uFF0C\u786E\u8BA4\u540E\u518D\u542F\u7528\u6216\u7ACB\u5373\u6295\u9012\u3002";
        }
      }
    });
  }
  busy = /* @__PURE__ */ new Set();
  stopped = false;
  stop() {
    this.stopped = true;
  }
  save(input) {
    const id = input.id === void 0 ? randomUUID() : identifier(input.id);
    this.guard(id);
    const title = text(input.title, 100), prompt = text(input.prompt, 4e3), sessionId = identifier(input.sessionId), rule = timing(input.timing);
    if (typeof input.enabled !== "boolean") throw new InputError("\u542F\u7528\u72B6\u6001\u65E0\u6548");
    const now = this.now();
    if (input.enabled && rule.kind === "once" && rule.at <= now) throw new InputError("\u4E00\u6B21\u6027\u4EFB\u52A1\u8BF7\u9009\u62E9\u5C06\u6765\u7684\u65F6\u95F4");
    let saved;
    this.store.update((state) => {
      const old = state.schedules.find((s) => s.id === id);
      if (input.id !== void 0 && !old) throw new InputError("\u4EFB\u52A1\u5DF2\u5220\u9664", 404);
      if (old && old.updatedAt !== input.updatedAt) throw new InputError("\u4EFB\u52A1\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5", 409);
      if (!old && state.schedules.length >= 100) throw new InputError("\u4EFB\u52A1\u5DF2\u8FBE\u4E0A\u9650\uFF0C\u8BF7\u5148\u6E05\u7406");
      if (input.enabled && state.schedules.filter((s) => s.id !== id && s.enabled).length >= 20) throw new InputError("\u6700\u591A\u540C\u65F6\u542F\u7528 20 \u4E2A\u5B9A\u65F6\u4EFB\u52A1");
      const unchanged = old?.enabled && old.timeZone === this.zone && JSON.stringify(old.timing) === JSON.stringify(rule);
      saved = { id, title, sessionId, prompt, timing: rule, enabled: input.enabled, nextAt: input.enabled ? unchanged ? old.nextAt : nextOccurrence(rule, now) : null, timeZone: this.zone, history: old?.history ?? [], updatedAt: Math.max(now, (old?.updatedAt ?? 0) + 1) };
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
    if (this.stopped) return;
    const due = this.store.snapshot().schedules.filter((s) => s.enabled && s.nextAt !== null && s.nextAt <= this.now() && !this.busy.has(s.id)).slice(0, 3);
    for (const s of due) {
      if (this.stopped) return;
      if (s.timeZone !== this.zone) {
        this.store.update((state) => {
          const row = state.schedules.find((r) => r.id === s.id);
          row.enabled = false;
          row.nextAt = null;
          row.updatedAt = this.now();
          row.history = [{ requestId: randomUUID(), time: this.now(), status: "uncertain", detail: "\u672C\u673A\u65F6\u533A\u5DF2\u53D8\u5316\uFF0C\u4EFB\u52A1\u6682\u505C\uFF1B\u8BF7\u7F16\u8F91\u786E\u8BA4\u65F6\u95F4\u540E\u542F\u7528\u3002" }, ...row.history].slice(0, 20);
        });
      } else await this.run(s.id);
    }
  }
  async run(id) {
    this.guard(identifier(id));
    const schedule = this.store.snapshot().schedules.find((s) => s.id === id);
    if (!schedule) throw new InputError("\u4EFB\u52A1\u4E0D\u5B58\u5728", 404);
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
      return this.store.snapshot().schedules.find((s) => s.id === id);
    } finally {
      this.busy.delete(id);
    }
  }
};

// packages/dsh-px-taskflow/src/index.ts
function readFailure(error) {
  const e = error;
  if (e?.name === "SessionPersistenceNotFoundError" || e?.code === "ENOENT") return { status: 404, code: "SESSION_NOT_FOUND", error: "\u6B64\u4F1A\u8BDD\u8BB0\u5F55\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u4F1A\u8BDD\u3002", retryable: false };
  if (e?.name === "SessionPersistenceCorruptionError" || e instanceof SyntaxError || /^(?:corrupt (?:Zstandard )?session log(?::| ")|empty or header-less (?:Zstandard )?session log$)/.test(e?.message ?? "")) return { status: 422, code: "SESSION_CORRUPT", error: "\u4F1A\u8BDD\u8BB0\u5F55\u635F\u574F\uFF0C\u65E0\u6CD5\u53EF\u9760\u8BFB\u53D6\u3002\u8BF7\u4FDD\u7559\u65E5\u5FD7\u5E76\u68C0\u67E5\u5907\u4EFD\u3002", retryable: false };
  if (e?.name === "SessionFormatUnsupportedError") return { status: 409, code: "SESSION_FORMAT_UNSUPPORTED", error: "\u5F53\u524D\u7248\u672C\u65E0\u6CD5\u8BFB\u53D6\u6B64\u4F1A\u8BDD\u683C\u5F0F\uFF0C\u8BF7\u4F7F\u7528\u517C\u5BB9\u7248\u672C\u3002", retryable: false };
  if (["EACCES", "EPERM"].includes(e?.code ?? "")) return { status: 403, code: "SESSION_ACCESS_DENIED", error: "\u6CA1\u6709\u8BFB\u53D6\u4F1A\u8BDD\u8BB0\u5F55\u7684\u6743\u9650\uFF0C\u8BF7\u68C0\u67E5\u6570\u636E\u76EE\u5F55\u6743\u9650\u3002", retryable: false };
  if (["EBUSY", "EAGAIN", "ETIMEDOUT"].includes(e?.code ?? "") || e?.name === "SessionAlreadyOwnedError") return { status: 503, code: "SESSION_BUSY", error: "\u4F1A\u8BDD\u8BB0\u5F55\u6682\u65F6\u4E0D\u53EF\u8BFB\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", retryable: true };
  return { status: 500, code: "SESSION_READ_FAILED", error: "\u8BFB\u53D6\u4F1A\u8BDD\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u6216\u68C0\u67E5\u670D\u52A1\u65E5\u5FD7\u3002", retryable: true };
}

// packages/dsh-px-workspace/src/index.ts
var name = "dsh-px-workspace";
var inject = [];
var DEFAULTS = { routePrefix: "/dsh-px-workspace" };
async function body(req) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new InputError("\u8BF7\u4F7F\u7528 JSON \u8BF7\u6C42", 415);
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
  const v = params.get(key);
  if (!/^\d{1,15}$/.test(v) || params.getAll(key).length !== 1) throw new InputError("\u5206\u9875\u53C2\u6570\u65E0\u6548");
  return Number(v);
}
function apply(ctx) {
  ctx.inject(["webServer", "sessions", "sessionController"], (host) => {
    const lifetime = new AbortController();
    let store, scheduler, loadError = "";
    const inspect = async (id) => {
      const live = host.sessions.get(identifier(id));
      return live ? { meta: live.header, events: live.snapshotEvents() } : await host.sessionController.inspect(id);
    };
    const target = async (id) => {
      const { meta } = await inspect(id);
      if (meta.origin === "subagent") throw new InputError("\u5B9A\u65F6\u4EFB\u52A1\u8BF7\u9009\u62E9\u666E\u901A\u4F1A\u8BDD\uFF1B\u5B50 Agent \u7531\u5176\u7236\u4EFB\u52A1\u7BA1\u7406");
    };
    try {
      if (!process.env.DSH_HOME) throw new Error("DSH_HOME \u672A\u8BBE\u7F6E");
      store = new WorkspaceStore(join(process.env.DSH_HOME, "storages", name, "workspace.json"));
      scheduler = new Scheduler(store, async (schedule, requestId) => {
        await target(schedule.sessionId);
        const result = await host.sessionController.prompt({
          requestId,
          sessionId: schedule.sessionId,
          mode: "queue",
          clientTimeZone: schedule.timeZone,
          content: [{ type: "text", text: `\u5B9A\u65F6\u4EFB\u52A1\u300C${schedule.title}\u300D
\u8FD9\u662F\u7528\u6237\u4FDD\u5B58\u7684\u5B9A\u65F6\u4EFB\u52A1\uFF0C\u8BF7\u6309\u5F53\u524D\u4F1A\u8BDD\u7684\u6743\u9650\u6267\u884C\uFF1A

${schedule.prompt}` }]
        }, lifetime.signal);
        if (result?.accepted !== true) throw new Error("\u4F1A\u8BDD\u672A\u786E\u8BA4\u63A5\u6536");
      });
    } catch (error) {
      loadError = String(error);
      host.logger?.warn(name, loadError);
    }
    host.effect(() => {
      const timer = setInterval(() => {
        void scheduler?.tick().catch((error) => host.logger?.warn("\u5B9A\u65F6\u4EFB\u52A1\u68C0\u67E5\u5931\u8D25", String(error)));
      }, 2e3);
      timer.unref();
      return () => {
        clearInterval(timer);
        scheduler?.stop();
        lifetime.abort();
      };
    }, "workspace: scheduler");
    for (const route of ["content", "message", "annotations", "schedules"]) host.effect(() => host.webServer.register({ kind: "exact", path: `/${name}/${route}`, handler: async (req, res) => {
      const send = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(data));
      };
      try {
        if (!store || !scheduler) throw new InputError(loadError || "\u4F1A\u8BDD\u5DE5\u4F5C\u533A\u672A\u521D\u59CB\u5316", 503);
        if (req.method !== "GET" && req.method !== "POST") throw new InputError("\u4E0D\u652F\u6301\u6B64\u8BF7\u6C42\u65B9\u6CD5", 405);
        const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
        if (req.method === "POST") {
          if (req.headers["x-dsh-px-request"] !== "1") throw new InputError("\u8BF7\u6C42\u6821\u9A8C\u5931\u8D25", 403);
          if (route !== "annotations" && route !== "schedules") throw new InputError("\u6B64\u63A5\u53E3\u53EA\u8BFB", 405);
          const input = await body(req);
          if (route === "annotations") {
            if (input.action === "delete") {
              store.deleteAnnotation(input);
              return send(200, { ok: true });
            }
            if (input.action !== "save") throw new InputError("\u64CD\u4F5C\u65E0\u6548");
            const { events: events2 } = await inspect(identifier(input.sessionId));
            const source = messages(events2).find((m) => m.id === input.messageId);
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
        if (route === "schedules") return send(200, { schedules: store.snapshot().schedules, timeZone: scheduler.zone });
        const id = identifier(params.get("sessionId"));
        if (route === "annotations") return send(200, { annotations: store.snapshot().annotations.filter((a) => a.sessionId === id).reverse() });
        const { events } = await inspect(id);
        const all = messages(events);
        if (route === "message") {
          const m = all.find((m2) => m2.id === params.get("messageId"));
          if (!m) throw new InputError("\u6D88\u606F\u4E0D\u5B58\u5728\u6216\u6CA1\u6709\u53EF\u5F15\u7528\u6B63\u6587", 404);
          const offset = numberParam(params, "offset", 0), length = m.text.length;
          if (offset > length) throw new InputError("\u6B63\u6587\u504F\u79FB\u8D85\u8FC7\u957F\u5EA6");
          return send(200, { ...m, text: m.text.slice(offset, offset + 32e3), length, offset, nextOffset: offset + 32e3 < length ? offset + 32e3 : null });
        }
        const before = numberParam(params, "before", Number.MAX_SAFE_INTEGER);
        const page = all.filter((m) => m.seq < before).slice(-20);
        send(200, { messages: page.map((m) => ({ ...m, text: m.text.slice(0, 240) })).reverse(), nextBefore: all.some((m) => m.seq < (page[0]?.seq ?? 0)) ? page[0].seq : null, artifacts: artifacts(events) });
      } catch (error) {
        if (error instanceof InputError) send(error.status, { error: error.message, retryable: false });
        else {
          host.logger?.warn(`${name}/${route}`, String(error));
          const failure = readFailure(error);
          send(failure.status, failure);
        }
      }
    } }), `workspace: ${route}`);
  });
}
export {
  DEFAULTS,
  apply,
  inject,
  name
};
