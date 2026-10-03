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
      (a, b) => b.seq - a.seq || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
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
      messages: page.map((m) => ({ ...m, text: m.text.slice(0, 240) })).reverse(),
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
      const inserted = data.inserted.map((m) => ({ requestId: requestOf(m) }));
      const removed = queue.splice(data.start, data.removedCount ?? 0, ...inserted);
      const replacements = new Set(inserted.map((m) => m.requestId));
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
    const m = e.type === "user/message" ? e.data : e.data?.message;
    if (e.type === "user/message" && m?.source?.kind !== "user") continue;
    if (!m || typeof m.id !== "string" || !Array.isArray(m.content)) continue;
    const text2 = m.content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
    if (text2.trim())
      rows.push({
        id: m.id,
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
function validateWorkspaceState(v) {
  if (v?.version !== 1 || !Array.isArray(v.annotations) || !Array.isArray(v.schedules) || v.annotations.length > 2e3 || v.schedules.length > 100)
    throw new Error("\u5DE5\u4F5C\u533A\u6570\u636E\u683C\u5F0F\u4E0D\u53D7\u652F\u6301");
  const ids = /* @__PURE__ */ new Set();
  for (const a of v.annotations) {
    identifier(a.id);
    identifier(a.sessionId);
    identifier(a.messageId);
    text(a.quote, 8e3);
    text(a.note, 4e3, false);
    if (!Number.isInteger(a.seq) || a.seq < 0 || !["user", "assistant"].includes(a.role) || !/^[a-f0-9]{64}$/.test(a.sourceHash) || !finite(a.updatedAt) || ids.has(a.id))
      throw new Error("\u6279\u6CE8\u6570\u636E\u635F\u574F");
    ids.add(a.id);
  }
  for (const s of v.schedules) {
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
    const all = this.state.annotations.filter((a) => a.sessionId === sessionId).sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
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
    if (source.id !== input.messageId || !source.text.includes(quote))
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
  const v = params.get(key);
  if (!/^\d{1,15}$/.test(v) || params.getAll(key).length !== 1) throw new InputError("\u5206\u9875\u53C2\u6570\u65E0\u6548");
  return Number(v);
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
      const routes = feature === "annotations" ? ["annotations"] : feature === "schedules" ? ["schedules"] : feature === "core" ? ["content", "message", "storage"] : [];
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
                  if (route !== "annotations" && route !== "schedules")
                    throw new InputError("\u6B64\u63A5\u53E3\u53EA\u8BFB", 405);
                  const input = await body(req);
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
                const id = identifier(params.get("sessionId"));
                if (route === "annotations")
                  return send(200, store.annotations(id, params.get("before") ?? void 0));
                const { index } = await content(id);
                if (route === "message") {
                  const m = index.message(params.get("messageId") ?? "");
                  if (!m) throw new InputError("\u6D88\u606F\u4E0D\u5B58\u5728\u6216\u6CA1\u6709\u53EF\u5F15\u7528\u6B63\u6587", 404);
                  const offset = numberParam(params, "offset", 0), length = m.text.length;
                  if (offset > length) throw new InputError("\u6B63\u6587\u504F\u79FB\u8D85\u8FC7\u957F\u5EA6");
                  return send(200, {
                    ...m,
                    text: m.text.slice(offset, offset + 32e3),
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
