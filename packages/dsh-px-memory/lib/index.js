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

// packages/dsh-px-memory/src/index.ts
import { join } from "node:path";

// packages/dsh-px-memory/src/store.ts
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
var MemoryError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
function projectKey(cwd) {
  if (!cwd) return null;
  let path = resolve(cwd);
  try {
    path = realpathSync.native(path);
  } catch {
  }
  return process.platform === "win32" ? path.toLowerCase() : path;
}
function text(value, max, required = false) {
  if (typeof value !== "string" || value.length > max || required && !value.trim())
    throw new MemoryError("\u5185\u5BB9\u4E3A\u7A7A\u6216\u8D85\u8FC7\u957F\u5EA6\u9650\u5236");
  return value.trim();
}
function validId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\r\n\0]/.test(value))
    throw new MemoryError("\u6807\u8BC6\u65E0\u6548");
  return value;
}
function config(p) {
  return { revision: p.revision, name: p.name, instructions: p.instructions };
}
function initial() {
  const p = {
    id: "default",
    name: "\u9ED8\u8BA4\u52A9\u624B",
    instructions: "",
    memoryEnabled: true,
    memories: [],
    revision: 1,
    versions: []
  };
  p.versions = [config(p)];
  return { schemaVersion: 2, revision: 0, personas: [p], bindings: /* @__PURE__ */ Object.create(null) };
}
function validate(s) {
  if (!s || s.schemaVersion !== 2 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !Array.isArray(s.personas) || s.personas.length > 30 || !s.bindings || typeof s.bindings !== "object" || Array.isArray(s.bindings))
    throw new MemoryError("\u4EBA\u683C\u914D\u7F6E\u683C\u5F0F\u65E0\u6548", 503);
  const ids = /* @__PURE__ */ new Set();
  for (const p of s.personas) {
    validId(p.id);
    text(p.name, 60, true);
    text(p.instructions, 2e3);
    if (ids.has(p.id) || typeof p.memoryEnabled !== "boolean" || p.archived !== void 0 && typeof p.archived !== "boolean" || !Array.isArray(p.memories) || p.memories.length > 40 || !Number.isSafeInteger(p.revision) || p.revision < 1 || !Array.isArray(p.versions) || p.versions.length > 100)
      throw new MemoryError("\u4EBA\u683C\u914D\u7F6E\u65E0\u6548", 503);
    ids.add(p.id);
    const revisions = /* @__PURE__ */ new Set(), entries = /* @__PURE__ */ new Set();
    for (const v of p.versions) {
      if (!Number.isSafeInteger(v.revision) || v.revision < 1 || v.revision > p.revision || revisions.has(v.revision))
        throw new MemoryError("\u4EBA\u683C\u7248\u672C\u65E0\u6548", 503);
      text(v.name, 60, true);
      text(v.instructions, 2e3);
      revisions.add(v.revision);
    }
    if (!revisions.has(p.revision)) throw new MemoryError("\u7F3A\u5C11\u5F53\u524D\u4EBA\u683C\u7248\u672C", 503);
    for (const m of p.memories) {
      validId(m.id);
      text(m.text, 2e3, true);
      if (entries.has(m.id) || m.project !== null && typeof m.project !== "string" || !Number.isFinite(Date.parse(m.updatedAt)))
        throw new MemoryError("\u8BB0\u5FC6\u6761\u76EE\u65E0\u6548", 503);
      entries.add(m.id);
    }
    if (p.memories.reduce((n, m) => n + m.text.length, 0) > 8e3)
      throw new MemoryError("\u6BCF\u4E2A\u4EBA\u683C\u7684\u8BB0\u5FC6\u5408\u8BA1\u6700\u591A 8000 \u5B57\uFF0C\u8BF7\u7CBE\u7B80\u540E\u4FDD\u5B58");
  }
  if (!ids.has("default") || Object.keys(s.bindings).length > 2e4)
    throw new MemoryError("\u4EBA\u683C\u6216\u4F1A\u8BDD\u7ED1\u5B9A\u65E0\u6548", 503);
  for (const [id, b] of Object.entries(s.bindings)) {
    validId(id);
    if (b.createdFrom !== void 0) {
      validId(b.createdFrom);
      if (b.createdFrom === id) throw new MemoryError("\u4F1A\u8BDD\u521B\u5EFA\u6765\u6E90\u65E0\u6548", 503);
    }
    const p = s.personas.find((p2) => p2.id === b.personaId);
    if (!p?.versions.some((v) => v.revision === b.personaRevision) || typeof b.locked !== "boolean" || b.pending !== void 0 && typeof b.pending !== "boolean" || !Number.isFinite(Date.parse(b.createdAt)))
      throw new MemoryError("\u4F1A\u8BDD\u4EBA\u683C\u7ED1\u5B9A\u65E0\u6548", 503);
    if (b.handoff) {
      validId(b.handoff.sessionId);
      text(b.handoff.summary, 12e3);
      if (b.handoff.sessionId === id || !Number.isSafeInteger(b.handoff.throughSeq) || b.handoff.throughSeq < 0 || !Number.isFinite(Date.parse(b.handoff.createdAt)))
        throw new MemoryError("\u4EA4\u63A5\u8303\u56F4\u65E0\u6548", 503);
    }
  }
}
var MemoryStore = class {
  constructor(path) {
    this.path = path;
  }
  read() {
    if (!existsSync(this.path)) return initial();
    const raw = readFileSync(this.path, "utf8");
    if (raw.length > 12e6) throw new MemoryError("\u4EBA\u683C\u914D\u7F6E\u8D85\u8FC7\u5BB9\u91CF\u9650\u5236", 503);
    let s = JSON.parse(raw);
    if (s?.schemaVersion === 1 && Array.isArray(s.personas) && s.sessions && typeof s.sessions === "object") {
      s = {
        schemaVersion: 2,
        revision: s.revision,
        personas: s.personas.map((p) => ({
          ...p,
          revision: 1,
          versions: [{ revision: 1, name: p.name, instructions: p.instructions }]
        })),
        bindings: Object.fromEntries(
          Object.entries(s.sessions).map(([id, personaId]) => [
            id,
            { personaId, personaRevision: 1, locked: true, createdAt: (/* @__PURE__ */ new Date(0)).toISOString() }
          ])
        )
      };
    }
    if (s?.bindings && typeof s.bindings === "object" && !Array.isArray(s.bindings))
      Object.setPrototypeOf(s.bindings, null);
    validate(s);
    return s;
  }
  change(revision, update) {
    const s = this.read();
    if (revision !== s.revision) throw new MemoryError("\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\uFF1B\u672A\u8986\u76D6\u4F60\u7684\u4FEE\u6539", 409);
    update(s);
    s.revision++;
    validate(s);
    const serialized = JSON.stringify(s, null, 2);
    if (serialized.length > 12e6) throw new MemoryError("\u4EBA\u683C\u914D\u7F6E\u5DF2\u8FBE\u5230\u5BB9\u91CF\u9650\u5236");
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.path + "." + randomUUID() + ".tmp";
    try {
      const fd = openSync(tmp, "wx");
      try {
        writeFileSync(fd, serialized, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, this.path);
    } finally {
      if (existsSync(tmp)) unlinkSync(tmp);
    }
    return s;
  }
  persona(s, sessionId) {
    const b = s.bindings[sessionId], p = s.personas.find((p2) => p2.id === (b?.personaId ?? "default"));
    if (!p) throw new MemoryError("\u4F1A\u8BDD\u7684\u4EBA\u683C\u4E0D\u5B58\u5728", 503);
    const v = b ? p.versions.find((v2) => v2.revision === b.personaRevision) : config(p);
    if (!v) throw new MemoryError("\u4F1A\u8BDD\u7684\u4EBA\u683C\u7248\u672C\u4E0D\u5B58\u5728", 503);
    return { ...p, ...v };
  }
  bind(sessionId, options = {}) {
    validId(sessionId);
    const s = this.read(), existing = s.bindings[sessionId];
    if (existing) {
      if (options.personaId && options.personaId !== existing.personaId)
        throw new MemoryError("\u4F1A\u8BDD\u5DF2\u7ED1\u5B9A\u4EBA\u683C", 409);
      if ((!options.locked || existing.locked) && (!existing.pending || options.pending === true)) return s;
      return this.change(s.revision, (n) => {
        if (options.locked) n.bindings[sessionId].locked = true;
        if (options.pending !== true) n.bindings[sessionId].pending = false;
      });
    }
    const parent = options.parent ? s.bindings[options.parent] : void 0;
    const p = s.personas.find((p2) => p2.id === (options.personaId ?? parent?.personaId ?? "default"));
    if (!p || p.archived) throw new MemoryError("\u4EBA\u683C\u4E0D\u5B58\u5728\u6216\u5DF2\u5F52\u6863");
    return this.change(s.revision, (n) => {
      n.bindings[sessionId] = {
        personaId: p.id,
        personaRevision: !options.personaId && parent ? parent.personaRevision : p.revision,
        locked: options.locked ?? !!parent,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        ...options.pending ? { pending: true } : {},
        ...options.createdFrom ? { createdFrom: options.createdFrom } : {},
        ...options.handoff ? { handoff: options.handoff } : {}
      };
    });
  }
  action(revision, action, sessionId, project) {
    validId(sessionId);
    if (!action || typeof action !== "object" || Array.isArray(action)) throw new MemoryError("\u64CD\u4F5C\u5185\u5BB9\u65E0\u6548");
    return this.change(revision, (s) => {
      const bound = this.persona(s, sessionId), p = s.personas.find((p2) => p2.id === bound.id);
      const binding = () => s.bindings[sessionId] ??= {
        personaId: p.id,
        personaRevision: p.revision,
        locked: false,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      switch (action.type) {
        case "create": {
          const id = randomUUID(), name2 = text(action.name, 60, true);
          s.personas.push({
            id,
            name: name2,
            instructions: "",
            memoryEnabled: true,
            memories: [],
            revision: 1,
            versions: [{ revision: 1, name: name2, instructions: "" }]
          });
          if (!binding().locked) s.bindings[sessionId] = { ...binding(), personaId: id, personaRevision: 1 };
          break;
        }
        case "select": {
          if (binding().locked) throw new MemoryError("\u672C\u4F1A\u8BDD\u5DF2\u56FA\u5B9A\u4EBA\u683C\uFF0C\u8BF7\u65B0\u5EFA\u63A5\u7EED\u4F1A\u8BDD", 409);
          const next = s.personas.find((p2) => p2.id === action.personaId && !p2.archived);
          if (!next) throw new MemoryError("\u4EBA\u683C\u4E0D\u5B58\u5728\u6216\u5DF2\u5F52\u6863");
          s.bindings[sessionId] = { ...binding(), personaId: next.id, personaRevision: next.revision };
          break;
        }
        case "configure": {
          if (p.archived) throw new MemoryError("\u4EBA\u683C\u5DF2\u5F52\u6863");
          const name2 = text(action.name, 60, true), instructions = text(action.instructions, 2e3);
          if (typeof action.memoryEnabled !== "boolean") throw new MemoryError("\u8BB0\u5FC6\u5F00\u5173\u65E0\u6548");
          p.memoryEnabled = action.memoryEnabled;
          if (name2 === p.name && instructions === p.instructions) break;
          p.name = name2;
          p.instructions = instructions;
          const keep = new Set(
            Object.values(s.bindings).filter((b) => b.personaId === p.id).map((b) => b.personaRevision)
          );
          p.versions = p.versions.filter((v) => keep.has(v.revision));
          p.revision++;
          p.versions.push(config(p));
          if (!binding().locked) binding().personaRevision = p.revision;
          break;
        }
        case "adopt-version": {
          if (p.archived) throw new MemoryError("\u4EBA\u683C\u5DF2\u5F52\u6863");
          binding().personaRevision = p.revision;
          break;
        }
        case "archive-persona": {
          if (p.id === "default") throw new MemoryError("\u9ED8\u8BA4\u52A9\u624B\u4E0D\u80FD\u5F52\u6863");
          p.archived = true;
          break;
        }
        case "save": {
          if (p.archived || !p.memoryEnabled) throw new MemoryError("\u4EBA\u683C\u8BB0\u5FC6\u5DF2\u5173\u95ED\u6216\u5F52\u6863");
          const content = text(action.text, 2e3, true);
          if (action.scope !== "persona" && action.scope !== "project") throw new MemoryError("\u8BB0\u5FC6\u8303\u56F4\u65E0\u6548");
          if (action.scope === "project" && !project) throw new MemoryError("\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u9879\u76EE\u76EE\u5F55");
          const old = action.id ? p.memories.find((m) => m.id === validId(action.id)) : void 0;
          if (action.id && !old) throw new MemoryError("\u8BB0\u5FC6\u5DF2\u79FB\u9664\uFF0C\u8BF7\u5237\u65B0", 409);
          if (old?.project && old.project !== project) throw new MemoryError("\u8BB0\u5FC6\u4E0D\u5C5E\u4E8E\u5F53\u524D\u76EE\u5F55");
          const entry = {
            id: old?.id ?? randomUUID(),
            text: content,
            project: action.scope === "project" ? project : null,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          if (old) p.memories[p.memories.indexOf(old)] = entry;
          else p.memories.push(entry);
          break;
        }
        case "forget": {
          const at = p.memories.findIndex((m) => m.id === validId(action.id));
          if (at < 0) throw new MemoryError("\u8BB0\u5FC6\u5DF2\u79FB\u9664\uFF0C\u8BF7\u5237\u65B0", 409);
          if (p.memories[at].project && p.memories[at].project !== project)
            throw new MemoryError("\u8BB0\u5FC6\u4E0D\u5C5E\u4E8E\u5F53\u524D\u76EE\u5F55");
          p.memories.splice(at, 1);
          break;
        }
        default:
          throw new MemoryError("\u64CD\u4F5C\u65E0\u6548");
      }
    });
  }
};
function selectedMemories(persona, project) {
  return persona.memoryEnabled ? persona.memories.filter((m) => m.project === null || m.project === project) : [];
}
function memoryContext(persona, project) {
  return `PX \u672C\u4F1A\u8BDD\u56FA\u5B9A\u4EBA\u683C\uFF1A${persona.name}\uFF08\u914D\u7F6E\u7248\u672C ${persona.revision}\uFF09
\u804C\u8D23\u4E0E\u534F\u4F5C\u65B9\u5F0F\uFF1A${persona.instructions || "\u6CBF\u7528\u5BBF\u4E3B\u9ED8\u8BA4\u65B9\u5F0F"}
\u4EBA\u683C\u4E0D\u6539\u53D8\u5B9E\u9645\u6A21\u578B\u3001\u5DE5\u5177\u6216\u6743\u9650\u3002\u4EE5\u4E0B\u662F\u7528\u6237\u4FDD\u5B58\u7684\u53C2\u8003\u8BB0\u5FC6\uFF1B\u5F53\u524D\u660E\u786E\u6307\u4EE4\u4F18\u5148\uFF0C\u9879\u76EE\u4E0E\u8FD0\u884C\u4E8B\u5B9E\u987B\u6309\u9700\u8981\u91CD\u65B0\u6838\u5B9E\u3002
${persona.memoryEnabled ? JSON.stringify(selectedMemories(persona, project).map((m) => ({ id: m.id, text: m.text, updatedAt: m.updatedAt }))) : "\u672C\u8F6E\u4E0D\u4F7F\u7528\u957F\u671F\u8BB0\u5FC6\u3002"}
\u9700\u8981\u56DE\u5FC6\u672C\u4EBA\u683C\u8FC7\u53BB\u7684\u4EA4\u6D41\u6216\u5DE5\u4F5C\u65F6\uFF0C\u4F7F\u7528 persona_history \u641C\u7D22\u5E76\u6309\u4E8B\u4EF6\u7F16\u53F7\u8BFB\u53D6\u539F\u6587\u3002\u641C\u7D22\u7ED3\u679C\u5305\u542B\u5386\u53F2\u9648\u8FF0\u800C\u975E\u5F53\u524D\u4E8B\u5B9E\uFF1B\u539F\u751F\u76EE\u6807\u3001\u4EFB\u52A1\u548C\u6267\u884C\u56DE\u6267\u5E94\u6309\u65F6\u95F4\u4E0E\u6765\u6E90\u6838\u5BF9\u3002`;
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

// packages/dsh-px-memory/src/identity.ts
var TurnIdentity = class {
  constructor(store, boundary) {
    this.store = store;
    this.boundary = boundary;
  }
  active = /* @__PURE__ */ new WeakMap();
  current(agent) {
    const boundary = this.boundary?.(agent);
    let turnSeq = boundary ? boundary.lastTurn - 1 : -1;
    if (!boundary) {
      const events = agent.session.snapshotEvents?.() ?? [];
      for (let i = events.length - 1; i >= 0; i--)
        if (events[i].type === "turn/start") {
          turnSeq = events[i].seq;
          break;
        }
    }
    const previous = this.active.get(agent);
    if (previous && previous.turnSeq === turnSeq) return previous.persona;
    const state = this.store.bind(agent.session.id, {
      parent: agent.session.header.parentSession,
      locked: turnSeq >= 0
    });
    const persona = this.store.persona(state, agent.session.id);
    if (persona.archived) throw new MemoryError("\u672C\u4F1A\u8BDD\u4EBA\u683C\u5DF2\u5F52\u6863\uFF1B\u8BF7\u65B0\u5EFA\u5176\u4ED6\u4EBA\u683C\u7684\u63A5\u7EED\u4F1A\u8BDD", 409);
    this.active.set(agent, { turnSeq, persona });
    return persona;
  }
};
function hasStarted(events) {
  return events.some(
    (e) => e.type === "turn/start" || e.type === "user/message" && e.data?.source?.kind === "user"
  );
}

// packages/dsh-px-memory/src/history.ts
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync as mkdirSync2, existsSync as existsSync2, renameSync as renameSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
var privateTools = /^(persona_(memory|history)|mnemon_|memory_)/;
var texts = (blocks) => Array.isArray(blocks) ? blocks.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n") : "";
var hash = (event) => createHash("sha256").update(JSON.stringify(event)).digest("hex");
function historyRecord(event, resolveTool) {
  const d = event.data ?? {};
  let kind, text2, toolName;
  if (event.type === "user/message" && d.source?.kind === "user") {
    kind = "user";
    text2 = texts(d.content);
  } else if (event.type === "assistant/message") {
    kind = d.interrupted === true ? "assistant-interrupted" : "assistant";
    text2 = texts(d.message?.content);
  } else if (["tool/call", "tool/ptc-dispatch-start"].includes(event.type)) {
    if (typeof d.name !== "string" || privateTools.test(d.name)) return;
    kind = "tool-call";
    text2 = `${d.name}
${typeof d.arguments === "string" ? d.arguments : JSON.stringify(d.arguments ?? {})}`;
    toolName = d.name;
  } else if (["tool/result", "tool/ptc-dispatch"].includes(event.type)) {
    const blocks = event.type === "tool/ptc-dispatch" ? [d] : d.message?.role === "tool" ? [d.message] : (d.message?.content ?? []).filter((b) => b.type === "tool-result");
    const visible = blocks.flatMap((b) => {
      const name2 = typeof resolveTool === "function" ? resolveTool(b.toolCallId ?? d.subCallId) : blocks.length === 1 ? resolveTool : void 0;
      return name2 && !privateTools.test(name2) ? [{ name: name2, text: `${name2}
${b.isError ? "[error] " : ""}${texts(b.content)}` }] : [];
    });
    if (!visible.length) return;
    toolName = visible.map((b) => b.name).join(", ");
    kind = visible.every((b) => ["task_checkpoint", "task_review"].includes(b.name)) ? "ledger" : "tool-result";
    text2 = visible.map((b) => b.text).join("\n");
  } else if (/^(goal\/|team\/|job\/|turn\/end$)/.test(event.type)) {
    kind = "native-state";
    text2 = `${event.type}
${JSON.stringify(d)}`;
  } else return;
  return text2.trim() ? { seq: event.seq, time: event.time, kind, text: text2, ...toolName ? { tool: toolName } : {} } : void 0;
}
function service(host, name2) {
  return host.get?.(name2) ?? host[name2];
}
async function nativeReader(host, id, signal) {
  const persistence = service(host, "sessionPersistence");
  if (persistence?.open) return persistence.open(id, "read", { signal });
  const live = service(host, "sessions")?.get(id);
  if (live)
    return {
      header: live.header,
      read: async (offset = 0, length) => {
        signal?.throwIfAborted();
        return { events: live.snapshotEvents(offset).slice(0, length) };
      },
      close: async () => {
      }
    };
  throw new MemoryError("\u539F\u751F\u4F1A\u8BDD\u8BFB\u53D6\u670D\u52A1\u4E0D\u53EF\u7528", 503);
}
var HistoryIndex = class {
  constructor(path, store) {
    this.store = store;
    mkdirSync2(dirname2(path), { recursive: true });
    let opened;
    try {
      opened = new DatabaseSync(path);
      const check = opened.prepare("PRAGMA quick_check").get();
      if (check?.quick_check !== "ok") throw Error("malformed history index");
    } catch (error) {
      opened?.close();
      if (!/malformed|not a database|corrupt/i.test(String(error))) throw error;
      const suffix = ".invalid-" + Date.now();
      for (const ext of ["", "-wal", "-shm"])
        if (existsSync2(path + ext)) renameSync2(path + ext, path + ext + suffix);
      opened = new DatabaseSync(path);
    }
    this.db = opened;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,cwd TEXT,title TEXT,lastseq INTEGER NOT NULL DEFAULT -1,lasthash TEXT,updated INTEGER NOT NULL DEFAULT 0,complete INTEGER NOT NULL DEFAULT 0,error TEXT);
      CREATE TABLE IF NOT EXISTS calls(sid TEXT,callid TEXT,name TEXT,seq INTEGER,PRIMARY KEY(sid,callid));
      CREATE TABLE IF NOT EXISTS records(sid TEXT,seq INTEGER,time INTEGER,kind TEXT,part INTEGER,body TEXT,PRIMARY KEY(sid,seq,part));
      CREATE INDEX IF NOT EXISTS records_session_time ON records(sid,time);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(sid UNINDEXED,seq UNINDEXED,part UNINDEXED,body,tokenize='trigram');`);
  }
  db;
  refreshQueue = Promise.resolve();
  disposed = false;
  async close() {
    this.disposed = true;
    await this.refreshQueue.finally(() => this.db.close());
  }
  allowed(sessionId) {
    const s = this.store.read(), b = s.bindings[sessionId];
    if (!b) throw new MemoryError("\u4F1A\u8BDD\u5C1A\u672A\u7ED1\u5B9A\u4EBA\u683C", 409);
    const allowed = Object.fromEntries(
      Object.entries(s.bindings).filter(([, v]) => v.personaId === b.personaId && !v.pending).map(([id]) => [id, Number.MAX_SAFE_INTEGER])
    );
    Object.setPrototypeOf(allowed, null);
    if (b.handoff && !Object.hasOwn(allowed, b.handoff.sessionId))
      allowed[b.handoff.sessionId] = b.handoff.throughSeq;
    return allowed;
  }
  async refresh(host, sessionId, signal) {
    const work = this.refreshQueue.then(() => this.refreshNow(host, sessionId, signal));
    this.refreshQueue = work.catch(() => {
    });
    return work;
  }
  async refreshNow(host, sessionId, signal) {
    if (this.disposed) throw new MemoryError("\u5386\u53F2\u7D22\u5F15\u6B63\u5728\u5173\u95ED", 503);
    const allowed = this.allowed(sessionId), ids = Object.keys(allowed);
    const order = ids.sort((a, b) => {
      const row = (id) => this.db.prepare("SELECT complete,updated FROM sessions WHERE id=?").get(id);
      const x = row(a), y = row(b);
      return (x?.complete ?? 0) - (y?.complete ?? 0) || (x?.updated ?? 0) - (y?.updated ?? 0);
    });
    const errors = [];
    let processed = 0, pages = 0;
    for (const id of order.slice(0, 20)) {
      signal?.throwIfAborted();
      if (pages >= 40) break;
      let reader;
      try {
        reader = await nativeReader(host, id, signal);
        this.db.prepare("INSERT OR IGNORE INTO sessions(id,cwd,title) VALUES(?,?,?)").run(id, projectKey(reader.header.cwd) ?? "", "");
        const saved = this.db.prepare("SELECT * FROM sessions WHERE id=?").get(id);
        if (saved.lastseq >= 0) {
          const at = (await reader.read(saved.lastseq, 1, { signal })).events[0];
          if (!at || hash(at) !== saved.lasthash) {
            this.db.exec("BEGIN");
            try {
              this.db.prepare("DELETE FROM records WHERE sid=?").run(id);
              this.db.prepare("DELETE FROM search WHERE sid=?").run(id);
              this.db.prepare("DELETE FROM calls WHERE sid=?").run(id);
              this.db.prepare("UPDATE sessions SET lastseq=-1,lasthash=NULL,complete=0,title=? WHERE id=?").run("", id);
              this.db.exec("COMMIT");
            } catch (e) {
              this.db.exec("ROLLBACK");
              throw e;
            }
            saved.lastseq = -1;
          }
        }
        let cursor = saved.lastseq + 1, complete2 = false;
        for (let n = 0; n < 8 && pages < 40; n++, pages++) {
          signal?.throwIfAborted();
          const events = (await reader.read(cursor, 256, { signal })).events;
          if (!events.length) {
            complete2 = true;
            break;
          }
          this.append(id, events);
          cursor = events.at(-1).seq + 1;
          if (events.length < 256) {
            complete2 = true;
            break;
          }
        }
        this.db.prepare("UPDATE sessions SET complete=?,error=NULL,updated=? WHERE id=?").run(complete2 ? 1 : 0, Date.now(), id);
        processed++;
      } catch (e) {
        signal?.throwIfAborted();
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ sessionId: id, message });
        this.db.prepare("UPDATE sessions SET complete=0,error=? WHERE id=?").run(message.slice(0, 500), id);
      } finally {
        await reader?.close();
      }
    }
    const complete = this.db.prepare("SELECT count(*) n FROM sessions WHERE id IN (SELECT key FROM json_each(?)) AND complete=1").get(JSON.stringify(allowed));
    return {
      indexedSessions: complete.n,
      totalSessions: ids.length,
      processed,
      partial: complete.n < ids.length,
      errors
    };
  }
  append(id, events) {
    this.db.exec("BEGIN");
    try {
      for (const e of events) {
        const d = e.data ?? {};
        if (["tool/call", "tool/ptc-dispatch-start"].includes(e.type) && typeof d.name === "string")
          this.db.prepare("INSERT OR REPLACE INTO calls VALUES(?,?,?,?)").run(id, d.callId ?? d.subCallId ?? "", d.name, e.seq);
        const row = historyRecord(
          e,
          (callId) => this.db.prepare("SELECT name FROM calls WHERE sid=? AND callid=?").get(id, callId)?.name
        );
        if (row) {
          for (let offset = 0, part = 0; offset < row.text.length; offset += 4e3, part++) {
            const body = row.text.slice(offset, offset + 4128);
            this.db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?)").run(id, e.seq, e.time, row.kind, part, body);
            this.db.prepare("INSERT INTO search(sid,seq,part,body) VALUES(?,?,?,?)").run(id, e.seq, part, body);
          }
          if (row.kind === "user")
            this.db.prepare("UPDATE sessions SET title=CASE WHEN title='' THEN ? ELSE title END WHERE id=?").run(row.text.slice(0, 100), id);
        }
        if (e.type === "session/title" && typeof d.title === "string")
          this.db.prepare("UPDATE sessions SET title=? WHERE id=?").run(d.title.slice(0, 200), id);
      }
      const last = events.at(-1);
      this.db.prepare("UPDATE sessions SET lastseq=?,lasthash=? WHERE id=?").run(last.seq, hash(last), id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  search(sessionId, query, options = {}) {
    const allowed = this.allowed(sessionId), limit = Math.min(20, Math.max(1, options.limit ?? 20));
    if (typeof query !== "string" || query.length > 256) throw new MemoryError("\u641C\u7D22\u5185\u5BB9\u6700\u591A 256 \u5B57");
    const terms = query.trim().split(/\s+/u).filter(Boolean).slice(0, 8);
    const useFts = terms.length > 0 && terms.every((t) => [...t].length >= 3);
    const source = useFts ? "search JOIN records r ON r.sid=search.sid AND r.seq=search.seq AND r.part=search.part" : "records r";
    const predicates = ["r.seq<=a.value"], values = [JSON.stringify(allowed)];
    if (useFts) {
      predicates.push("search MATCH ?");
      values.push(terms.map((t) => '"' + t.replaceAll('"', '""') + '"').join(" AND "));
    } else
      for (const term of terms) {
        predicates.push("r.body LIKE ? ESCAPE '\\'");
        values.push("%" + term.replace(/[\\%_]/g, "\\$&") + "%");
      }
    if (options.project) {
      predicates.push("s.cwd=?");
      values.push(projectKey(options.project));
    }
    if (options.targetSessionId) {
      predicates.push("r.sid=?");
      values.push(options.targetSessionId);
    }
    if (options.beforeTime !== void 0) {
      predicates.push("r.time<?");
      values.push(options.beforeTime);
    }
    values.push(limit);
    const rows = this.db.prepare(
      `SELECT r.sid sessionId,r.seq,r.time,r.kind,r.part,r.body,(SELECT substr(t.body,1,100) FROM records t WHERE t.sid=r.sid AND t.kind='user' AND t.seq<=a.value AND t.part=0 ORDER BY t.seq LIMIT 1) title,s.cwd FROM ${source} JOIN json_each(?) a ON a.key=r.sid JOIN sessions s ON s.id=r.sid WHERE ${predicates.join(" AND ")} ORDER BY ${useFts ? "bm25(search)," : ""} r.time DESC,r.seq DESC LIMIT ?`
    ).all(...values);
    return rows.map(({ body, ...r }) => {
      const at = terms.length ? body.toLocaleLowerCase().indexOf(terms[0].toLocaleLowerCase()) : 0;
      const start = Math.max(0, at - 100);
      return {
        ...r,
        snippet: body.slice(start, start + 700),
        source: "native-session-event",
        historical: true,
        readOffset: r.part * 4e3 + start,
        sourceThroughSeq: allowed[r.sessionId] === Number.MAX_SAFE_INTEGER ? null : allowed[r.sessionId]
      };
    });
  }
  list(sessionId, project) {
    const allowed = this.allowed(sessionId);
    return this.db.prepare(
      `SELECT s.id sessionId,s.cwd,min(s.lastseq,a.value) throughSeq,s.complete,s.error,max(r.time) lastEventAt,count(DISTINCT r.seq) indexedEvents,
        (SELECT substr(t.body,1,100) FROM records t WHERE t.sid=s.id AND t.kind='user' AND t.seq<=a.value AND t.part=0 ORDER BY t.seq LIMIT 1) title,
        (SELECT substr(t.body,1,700) FROM records t WHERE t.sid=s.id AND t.kind='assistant' AND t.seq<=a.value AND t.part=0 ORDER BY t.seq DESC LIMIT 1) lastReply,
        (SELECT substr(t.body,1,1000) FROM records t WHERE t.sid=s.id AND t.kind='native-state' AND t.seq<=a.value AND t.part=0 ORDER BY t.seq DESC LIMIT 1) lastState
        FROM sessions s JOIN json_each(?) a ON a.key=s.id LEFT JOIN records r ON r.sid=s.id AND r.seq<=a.value WHERE (? IS NULL OR s.cwd=?) GROUP BY s.id HAVING count(r.seq)>0 ORDER BY lastEventAt DESC LIMIT 100`
    ).all(JSON.stringify(allowed), projectKey(project) ?? null, projectKey(project) ?? null);
  }
  async read(host, caller, target, seq, offset = 0, signal) {
    const allowed = this.allowed(caller);
    if (!Object.hasOwn(allowed, target) || !Number.isSafeInteger(seq) || seq < 0 || seq > allowed[target])
      throw new MemoryError("\u539F\u6587\u4E0D\u5728\u672C\u4F1A\u8BDD\u5141\u8BB8\u8BFB\u53D6\u7684\u5386\u53F2\u8303\u56F4\u5185", 403);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new MemoryError("\u8BFB\u53D6\u4F4D\u7F6E\u65E0\u6548");
    const reader = await nativeReader(host, target, signal);
    try {
      const event = (await reader.read(seq, 1, { signal })).events[0];
      if (!event) throw new MemoryError("\u539F\u59CB\u4E8B\u4EF6\u4E0D\u5B58\u5728", 404);
      const d = event.data ?? {}, blocks = event.type === "tool/ptc-dispatch" ? [d] : d.message?.role === "tool" ? [d.message] : (d.message?.content ?? []).filter((b) => b.type === "tool-result"), names = /* @__PURE__ */ new Map();
      for (const block of blocks) {
        const callId = block.toolCallId ?? d.subCallId;
        if (typeof callId !== "string") continue;
        const cached = this.db.prepare("SELECT seq FROM calls WHERE sid=? AND callid=?").get(target, callId);
        if (cached && cached.seq <= seq) {
          const source = (await reader.read(cached.seq, 1, { signal })).events[0];
          if (source && ["tool/call", "tool/ptc-dispatch-start"].includes(source.type) && (source.data.callId ?? source.data.subCallId) === callId)
            names.set(callId, source.data.name);
        }
      }
      const wanted = new Set(
        blocks.map((b) => b.toolCallId ?? d.subCallId).filter((id) => typeof id === "string" && !names.has(id))
      );
      for (let cursor = seq - 1, pages = 0; wanted.size && cursor >= 0 && pages < 256; pages++) {
        signal?.throwIfAborted();
        const start = Math.max(0, cursor - 255), earlier = (await reader.read(start, cursor - start + 1, { signal })).events;
        for (let i = earlier.length - 1; i >= 0; i--) {
          const e = earlier[i], id = e.data?.callId ?? e.data?.subCallId;
          if (["tool/call", "tool/ptc-dispatch-start"].includes(e.type) && wanted.has(id)) {
            names.set(id, e.data.name);
            wanted.delete(id);
          }
        }
        cursor = start - 1;
      }
      if (wanted.size) throw new MemoryError("\u5C1A\u672A\u5B9A\u4F4D\u539F\u5DE5\u5177\u8C03\u7528\uFF0C\u8BF7\u7EE7\u7EED\u66F4\u65B0\u5386\u53F2\u7D22\u5F15\u540E\u8BFB\u53D6", 409);
      const row = historyRecord(event, (id) => names.get(id));
      if (!row) throw new MemoryError("\u8BE5\u4E8B\u4EF6\u4E0D\u662F\u53EF\u5171\u4EAB\u7684\u5BF9\u8BDD\u3001\u6267\u884C\u7ED3\u679C\u6216\u539F\u751F\u72B6\u6001", 403);
      return {
        sessionId: target,
        seq,
        time: row.time,
        kind: row.kind,
        tool: row.tool,
        text: row.text.slice(offset, offset + 12e3),
        offset,
        nextOffset: offset + 12e3 < row.text.length ? offset + 12e3 : null,
        totalCharacters: row.text.length,
        historical: true,
        sourceThroughSeq: allowed[target] === Number.MAX_SAFE_INTEGER ? null : allowed[target],
        source: "native-session-event"
      };
    } finally {
      await reader.close();
    }
  }
};

// packages/dsh-px-memory/src/continuation.ts
function handoffFrom(events, sessionId) {
  let open = false, cut = -1;
  for (const e of events) {
    if (e.type === "turn/start") open = true;
    if (e.type === "turn/end") open = false;
    if (!open) cut = e.seq;
  }
  if (cut < 0 || !events.some((e) => e.type === "user/message" && e.data?.source?.kind === "user" && e.seq <= cut))
    throw new MemoryError("\u539F\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u53EF\u4EA4\u63A5\u7684\u5DF2\u5B8C\u6210\u5BF9\u8BDD");
  const calls = /* @__PURE__ */ new Map(), rows = [];
  for (const e of events) {
    if (e.seq > cut) break;
    const d = e.data ?? {};
    if (["tool/call", "tool/ptc-dispatch-start"].includes(e.type) && typeof d.name === "string")
      calls.set(d.callId ?? d.subCallId, d.name);
    const row = historyRecord(e, (id) => calls.get(id));
    if (row && ["user", "assistant", "ledger", "native-state"].includes(row.kind)) rows.push(row);
  }
  const last = (kind, n) => rows.filter((r) => r.kind === kind).slice(-n).map((r) => ({
    seq: r.seq,
    time: r.time,
    kind: r.kind,
    text: r.text.slice(0, kind === "native-state" ? 1500 : 2500),
    truncated: r.text.length > (kind === "native-state" ? 1500 : 2500)
  }));
  const excerpt = {
    sourceSessionId: sessionId,
    throughSeq: cut,
    latestNativeStates: last("native-state", 3),
    ledger: last("ledger", 1),
    requests: last("user", 2),
    reply: last("assistant", 1)
  };
  let summary = JSON.stringify(excerpt);
  while (summary.length > 12e3) {
    const largest = [
      ...excerpt.latestNativeStates,
      ...excerpt.ledger,
      ...excerpt.requests,
      ...excerpt.reply
    ].sort((a, b) => b.text.length - a.text.length)[0];
    largest.text = largest.text.slice(0, Math.floor(largest.text.length / 2));
    largest.truncated = true;
    summary = JSON.stringify(excerpt);
  }
  return { sessionId, throughSeq: cut, summary, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
}
async function createPersonaSession(host, store, sourceId, args, signal) {
  if (typeof args.requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(args.requestId))
    throw new MemoryError("\u7F3A\u5C11\u6709\u6548\u7684\u65B0\u4F1A\u8BDD\u8BF7\u6C42\u6807\u8BC6");
  if (typeof args.personaId !== "string") throw new MemoryError("\u8BF7\u9009\u62E9\u4EBA\u683C");
  if (typeof args.handoff !== "boolean") throw new MemoryError("\u8BF7\u9009\u62E9\u65B0\u5EFA\u6216\u63A5\u7EED\u65B9\u5F0F");
  const controller = service(host, "sessionController");
  if (!controller?.create || !controller?.inspect) throw new MemoryError("\u539F\u751F\u4F1A\u8BDD\u521B\u5EFA\u63A5\u53E3\u4E0D\u53EF\u7528", 503);
  const state = store.read(), persona = state.personas.find((p) => p.id === args.personaId && !p.archived);
  if (!persona) throw new MemoryError("\u4EBA\u683C\u4E0D\u5B58\u5728\u6216\u5DF2\u5F52\u6863");
  const id = "session-" + args.requestId;
  const existing = state.bindings[id];
  if (existing && (existing.personaId !== persona.id || existing.createdFrom !== sourceId || Boolean(existing.handoff) !== Boolean(args.handoff) || existing.handoff && existing.handoff.sessionId !== sourceId))
    throw new MemoryError("\u65B0\u4F1A\u8BDD\u8BF7\u6C42\u5DF2\u7ECF\u7528\u4E8E\u5176\u4ED6\u64CD\u4F5C", 409);
  const source = await controller.inspect(sourceId, signal);
  let handoff = existing?.handoff;
  if (args.handoff && !existing) {
    if (service(host, "agents")?.get(sourceId)?.status === "running")
      throw new MemoryError("\u8BF7\u7B49\u5F85\u539F\u4F1A\u8BDD\u672C\u8F6E\u7ED3\u675F\u6216\u5148\u505C\u6B62\uFF0C\u518D\u521B\u5EFA\u63A5\u7EED\u4F1A\u8BDD", 409);
    handoff = handoffFrom(source.events, sourceId);
  }
  signal?.throwIfAborted();
  store.bind(id, { personaId: persona.id, locked: !!handoff, handoff, pending: true, createdFrom: sourceId });
  const workspace = service(host, "workspaceRegistry")?.list?.().find((w) => w.sessionIds?.includes(sourceId));
  await controller.create({
    sessionId: id,
    ...workspace ? { workspaceId: workspace.id } : { cwd: source.meta.cwd },
    agentPreset: source.meta.agentPreset
  });
  store.bind(id, { personaId: persona.id, locked: !!handoff });
  return id;
}

// packages/dsh-px-memory/src/index.ts
var name = "dsh-px-memory";
var inject = [];
function apply(ctx) {
  const root = process.env.DSH_HOME;
  if (!root) throw new Error("DSH_HOME \u672A\u8BBE\u7F6E\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u4EBA\u683C\u4E0E\u8BB0\u5FC6");
  const store = new MemoryStore(join(root, "storages", name, "memory.json"));
  const identity = new TurnIdentity(
    store,
    (agent) => service(ctx, "sessionProjections")?.stateOf?.(agent.session, "turnBoundary")
  );
  const history = new HistoryIndex(join(root, "storages", name, "history.sqlite"), store);
  ctx.effect(() => () => history.close(), "memory: history index");
  ctx.on("agent/created", ({ agent }) => {
    try {
      store.bind(agent.session.id, {
        parent: agent.session.header.parentSession,
        locked: hasStarted(agent.session.snapshotEvents?.() ?? [])
      });
    } catch (error) {
      ctx.logger?.warn("\u4EBA\u683C\u7ED1\u5B9A\u6682\u4E0D\u53EF\u7528\uFF1B\u8BF7\u6C42\u7EC4\u88C5\u524D\u4ECD\u4F1A\u62D2\u7EDD\u672A\u77E5\u8EAB\u4EFD\uFF1A%s", String(error));
    }
  });
  ctx.on("agent/turn-stopping", ({ agent, signal }) => {
    void history.refresh(ctx, agent.session.id, signal).catch((e) => ctx.logger?.warn("\u5386\u53F2\u7D22\u5F15\u6682\u672A\u66F4\u65B0\uFF1A%s", String(e)));
  });
  const current = (agent) => identity.current(agent);
  ctx.inject(
    ["systemPrompt"],
    (host) => host.effect(
      () => host.systemPrompt.context({
        name: "dsh-px-persona-memory",
        order: 500,
        text: ({ agent }) => {
          if (!agent) return "";
          const p = current(agent), handoff = store.read().bindings[agent.session.id]?.handoff;
          return memoryContext(p, projectKey(agent.session.header.cwd)) + (handoff ? `
\u7528\u6237\u4E3A\u672C\u4F1A\u8BDD\u4EA4\u63A5\u4E86 ${handoff.sessionId} \u622A\u81F3\u4E8B\u4EF6 ${handoff.throughSeq} \u7684\u53EF\u89C1\u5BF9\u8BDD\u4E0E\u6267\u884C\u8BB0\u5F55\u3002\u4EE5\u4E0B\u662F\u6709\u754C\u5386\u53F2\u6458\u5F55\uFF0C\u4E0D\u662F\u5F53\u524D\u4EFB\u52A1\u6388\u6743\u6216\u9A8C\u6536\u7ED3\u8BBA\uFF1B\u65E7\u4EBA\u683C\u79C1\u6709\u8BB0\u5FC6\u672A\u7EE7\u627F\u3002\u4F7F\u7528 persona_history \u6309\u6765\u6E90\u548C\u4E8B\u4EF6\u7F16\u53F7\u8FDB\u4E00\u6B65\u6838\u5BF9\uFF1B\u4E0D\u8981\u6062\u590D\u539F\u4F1A\u8BDD\u7684 Goal \u6216\u91CD\u590D\u4E0D\u786E\u5B9A\u64CD\u4F5C\u3002
${handoff.summary}` : "");
        }
      }),
      "memory: persona context"
    )
  );
  ctx.inject(["tools"], (host) => {
    host.tools.register({
      name: "persona_history",
      description: "\u627E\u56DE\u5F53\u524D\u4EBA\u683C\u8FC7\u53BB\u7684\u4EA4\u6D41\u4E0E\u5DE5\u4F5C\u3002search \u641C\u7D22\u539F\u751F\u7528\u6237/\u52A9\u624B\u6D88\u606F\u3001\u5DE5\u5177\u6267\u884C\u8BB0\u5F55\u4E0E Goal/Team \u72B6\u6001\uFF1Bsessions \u67E5\u770B\u7ECF\u5386\u76EE\u5F55\u7684\u539F\u6587\u6458\u5F55\uFF1Bread \u6309 sessionId\u3001seq\u3001offset \u8BFB\u53D6\u786E\u5207\u539F\u6587\u3002\u81EA\u52A8\u9650\u5236\u5F53\u524D\u4EBA\u683C\u4E0E\u660E\u786E\u4EA4\u63A5\u8303\u56F4\uFF0C\u4E0D\u8BFB\u53D6\u5176\u4ED6\u4EBA\u683C\u7684\u79C1\u6709\u8BB0\u5FC6\u3002\u8FD4\u56DE\u5386\u53F2\u6765\u6E90\u800C\u975E\u5F53\u524D\u4E8B\u5B9E\uFF1Bpartial \u8868\u793A\u7D22\u5F15\u672A\u5B8C\u6210\uFF0C\u53EF\u518D\u6B21\u67E5\u8BE2\u3002\u4E0D\u4F1A\u5524\u9192\u4F1A\u8BDD\u6216\u91CD\u8DD1\u5DE5\u5177\u3002",
      parameters: {
        type: "object",
        required: ["action"],
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["search", "sessions", "read"] },
          query: { type: "string", maxLength: 256 },
          sessionId: { type: "string" },
          seq: { type: "integer", minimum: 0 },
          offset: { type: "integer", minimum: 0 },
          projectOnly: { type: "boolean" }
        }
      },
      output: { schema: { type: "string" }, render: (_, v) => [{ type: "text", text: v }] },
      execute: async (args, run) => {
        run.signal.throwIfAborted();
        if (!run.agent) throw new MemoryError("\u9700\u8981\u5F53\u524D\u4F1A\u8BDD");
        const p = current(run.agent);
        if (!p.memoryEnabled) throw new MemoryError("\u5F53\u524D\u4EBA\u683C\u7684\u8BB0\u5FC6\u5DF2\u5173\u95ED");
        const id = run.agent.session.id, coverage = await history.refresh(ctx, id, run.signal);
        const result = args.action === "read" ? await history.read(ctx, id, validId(args.sessionId), args.seq, args.offset ?? 0, run.signal) : args.action === "sessions" ? history.list(id, args.projectOnly ? run.agent.session.header.cwd : void 0) : args.action === "search" ? history.search(id, args.query ?? "", {
          project: args.projectOnly ? run.agent.session.header.cwd : void 0,
          targetSessionId: args.sessionId
        }) : null;
        if (result === null) throw new MemoryError("\u5386\u53F2\u64CD\u4F5C\u65E0\u6548");
        return JSON.stringify({ coverage, result });
      }
    });
    host.tools.register({
      name: "persona_memory",
      description: "\u8BFB\u53D6\u5F53\u524D\u4EBA\u683C\u7684\u957F\u671F\u8BB0\u5FC6\u3002read \u4E00\u6B21\u8FD4\u56DE\u4EBA\u683C\u901A\u7528\u4E0E\u5F53\u524D\u76EE\u5F55\u7684\u5168\u90E8\u53EF\u89C1\u6761\u76EE\uFF0C\u65E0\u9700\u5206\u522B\u8BFB\u53D6\u4E24\u4E2A\u8303\u56F4\u3002\u4EC5\u7528\u6237\u660E\u786E\u8981\u6C42\u8BB0\u4F4F\u3001\u4FEE\u6539\u6216\u5FD8\u8BB0\u65F6\u5199\u5165\uFF1B\u4E0D\u8981\u4FDD\u5B58\u4E34\u65F6\u8FDB\u5EA6\u3002\u5148 read \u83B7\u53D6 revision\uFF0C\u518D save/forget\u3002scope \u4EC5\u7528\u4E8E save\uFF1Aproject \u4E3A\u5F53\u524D\u76EE\u5F55\uFF0Cpersona \u4E3A\u8DE8\u76EE\u5F55\u3002\u5DF2\u4FDD\u5B58\u5185\u5BB9\u4ECE\u4E0B\u8F6E\u8D77\u4F7F\u7528\u3002",
      parameters: {
        type: "object",
        required: ["action"],
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["read", "save", "forget"] },
          revision: { type: "integer", minimum: 0 },
          id: { type: "string" },
          text: { type: "string", maxLength: 2e3 },
          scope: { type: "string", enum: ["project", "persona"] }
        }
      },
      output: { schema: { type: "string" }, render: (_, v) => [{ type: "text", text: v }] },
      execute: async (args, run) => {
        run.signal.throwIfAborted();
        if (!run.agent) throw new MemoryError("\u9700\u8981\u5F53\u524D\u4F1A\u8BDD");
        const agent = run.agent, p = current(agent), state = store.read(), project = projectKey(agent.session.header.cwd);
        if (args.action === "read")
          return JSON.stringify({
            revision: state.revision,
            persona: p.name,
            memoryEnabled: p.memoryEnabled,
            memories: selectedMemories(state.personas.find((v) => v.id === p.id) ?? p, project)
          });
        if (!p.memoryEnabled) throw new MemoryError("\u5F53\u524D\u4EBA\u683C\u7684\u8BB0\u5FC6\u5DF2\u5173\u95ED");
        if (store.persona(state, agent.session.id).id !== p.id)
          throw new MemoryError("\u4EBA\u683C\u5207\u6362\u5C06\u5728\u4E0B\u4E00\u8F6E\u751F\u6548\uFF0C\u8BF7\u5230\u4E0B\u4E00\u8F6E\u518D\u4FEE\u6539\u8BB0\u5FC6", 409);
        if (args.action !== "save" && args.action !== "forget") throw new MemoryError("\u64CD\u4F5C\u65E0\u6548");
        const entry = state.personas.find((v) => v.id === p.id)?.memories.find((m) => m.id === args.id);
        if (args.id && (!entry || entry.project !== null && entry.project !== project))
          throw new MemoryError("\u8BE5\u6761\u76EE\u4E0D\u5C5E\u4E8E\u5F53\u524D\u53EF\u89C1\u8BB0\u5FC6");
        const next = store.action(args.revision, { ...args, type: args.action }, agent.session.id, project);
        return JSON.stringify({ saved: true, revision: next.revision, applies: "next-turn" });
      }
    });
  });
  ctx.inject(
    ["connection", "webServer", "sessionController"],
    (host) => host.effect(
      () => host.webServer.register({
        kind: "exact",
        path: "/dsh-px-memory",
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
              return send(405, { error: "\u8BF7\u4F7F\u7528 GET \u6216 POST" });
            const id = validId(new URL(req.url, "http://127.0.0.1").searchParams.get("sessionId"));
            const { meta, events = [] } = await host.sessionController.inspect(id);
            const project = projectKey(meta.cwd);
            store.bind(id, { parent: meta.parentSession, locked: hasStarted(events) });
            if (req.method === "POST") {
              if (!String(req.headers["content-type"]).startsWith("application/json"))
                throw new MemoryError("\u8BF7\u4F7F\u7528 JSON", 415);
              const chunks = [];
              let size = 0;
              for await (const chunk of req) {
                size += Buffer.byteLength(chunk);
                if (size > 64e3) throw new MemoryError("\u8BF7\u6C42\u8FC7\u5927", 413);
                chunks.push(Buffer.from(chunk));
              }
              let args;
              try {
                args = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              } catch {
                throw new MemoryError("JSON \u5185\u5BB9\u65E0\u6548");
              }
              if (!args || typeof args !== "object" || Array.isArray(args))
                throw new MemoryError("\u64CD\u4F5C\u5185\u5BB9\u65E0\u6548");
              if (args.type === "new-session") {
                const createdSessionId = await createPersonaSession(host, store, id, args);
                return send(200, { createdSessionId });
              }
              if (args.type === "search-history" || args.type === "read-history") {
                if (args.projectOnly !== void 0 && typeof args.projectOnly !== "boolean")
                  throw new MemoryError("\u9879\u76EE\u8303\u56F4\u65E0\u6548");
                if (args.query !== void 0 && typeof args.query !== "string")
                  throw new MemoryError("\u641C\u7D22\u5185\u5BB9\u5FC5\u987B\u662F\u6587\u5B57");
                if (args.projectOnly && !meta.cwd)
                  throw new MemoryError("\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u9879\u76EE\u76EE\u5F55\uFF0C\u8BF7\u53D6\u6D88\u672C\u9879\u76EE\u9650\u5236");
                const coverage = await history.refresh(host, id);
                const result = args.type === "read-history" ? await history.read(
                  host,
                  id,
                  validId(args.targetSessionId),
                  args.seq,
                  args.offset ?? 0
                ) : args.query?.trim() || args.targetSessionId ? history.search(id, args.query ?? "", {
                  project: args.projectOnly ? meta.cwd : void 0,
                  targetSessionId: args.targetSessionId
                }) : history.list(id, args.projectOnly ? meta.cwd : void 0);
                return send(200, { coverage, result });
              }
              if (["select", "adopt-version"].includes(args.type) && service(host, "agents")?.get(id)?.status === "running")
                throw new MemoryError("\u8BF7\u7B49\u5F53\u524D\u8F6E\u7ED3\u675F\u518D\u66F4\u6539\u914D\u7F6E", 409);
              store.action(args.revision, args, id, project);
            }
            const state = store.read(), persona = store.persona(state, id);
            send(200, {
              revision: state.revision,
              personas: state.personas.map((p) => ({ id: p.id, name: p.name, archived: p.archived })),
              persona,
              template: state.personas.find((p) => p.id === persona.id),
              binding: state.bindings[id],
              project
            });
          } catch (error) {
            send(error instanceof MemoryError ? error.status : 503, {
              error: error instanceof Error ? error.message : "\u8BB0\u5FC6\u6682\u4E0D\u53EF\u7528",
              retryable: false
            });
          }
        }
      }),
      "memory: routes"
    )
  );
}
export {
  apply,
  inject,
  name
};
