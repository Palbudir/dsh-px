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
  writeFileSync,
  unlinkSync,
  openSync,
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
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new MemoryError("\u6807\u8BC6\u65E0\u6548");
  return value;
}
function initial() {
  return {
    schemaVersion: 1,
    revision: 0,
    personas: [{ id: "default", name: "\u9ED8\u8BA4\u52A9\u624B", instructions: "", memoryEnabled: true, memories: [] }],
    sessions: {}
  };
}
function validate(value) {
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.personas) || value.personas.length > 30 || !value.sessions || typeof value.sessions !== "object" || Array.isArray(value.sessions))
    throw new MemoryError("\u8BB0\u5FC6\u6587\u4EF6\u683C\u5F0F\u4E0D\u517C\u5BB9\uFF1B\u8BF7\u4FDD\u7559\u539F\u6587\u4EF6", 503);
  const ids = /* @__PURE__ */ new Set();
  for (const p of value.personas) {
    validId(p.id);
    text(p.name, 60, true);
    text(p.instructions, 2e3);
    if (ids.has(p.id) || typeof p.memoryEnabled !== "boolean" || !Array.isArray(p.memories) || p.memories.length > 40)
      throw new MemoryError("\u4EBA\u683C\u914D\u7F6E\u65E0\u6548", 503);
    ids.add(p.id);
    const entries = /* @__PURE__ */ new Set();
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
  if (!ids.has("default") || Object.keys(value.sessions).length > 2e4)
    throw new MemoryError("\u4EBA\u683C\u6216\u4F1A\u8BDD\u7ED1\u5B9A\u65E0\u6548", 503);
  for (const [id, persona] of Object.entries(value.sessions)) {
    validId(id);
    if (!ids.has(persona)) throw new MemoryError("\u4F1A\u8BDD\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u4EBA\u683C", 503);
  }
}
var MemoryStore = class {
  constructor(path) {
    this.path = path;
  }
  read() {
    if (!existsSync(this.path)) return initial();
    const raw = readFileSync(this.path, "utf8");
    if (raw.length > 3e6) throw new MemoryError("\u8BB0\u5FC6\u6587\u4EF6\u8FC7\u5927\uFF0C\u8BF7\u4FDD\u7559\u539F\u6587\u4EF6\u5E76\u68C0\u67E5", 503);
    const state = JSON.parse(raw);
    validate(state);
    return state;
  }
  change(revision, update) {
    const state = this.read();
    if (revision !== state.revision) throw new MemoryError("\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\uFF1B\u672A\u8986\u76D6\u4F60\u7684\u4FEE\u6539", 409);
    update(state);
    state.revision++;
    validate(state);
    const serialized = JSON.stringify(state, null, 2);
    if (serialized.length > 3e6) throw new MemoryError("\u8BB0\u5FC6\u914D\u7F6E\u5DF2\u8FBE\u5230\u5BB9\u91CF\u9650\u5236\uFF0C\u672A\u4FDD\u5B58\u672C\u6B21\u4FEE\u6539");
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = this.path + "." + randomUUID() + ".tmp";
    try {
      const fd = openSync(temporary, "wx");
      try {
        writeFileSync(fd, serialized, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, this.path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return state;
  }
  persona(state, sessionId) {
    return state.personas.find((p) => p.id === state.sessions[sessionId]) ?? state.personas.find((p) => p.id === "default");
  }
  action(revision, action, sessionId, project) {
    validId(sessionId);
    if (!action || typeof action !== "object" || Array.isArray(action)) throw new MemoryError("\u64CD\u4F5C\u5185\u5BB9\u65E0\u6548");
    return this.change(revision, (state) => {
      const p = this.persona(state, sessionId);
      switch (action.type) {
        case "create": {
          const id = randomUUID();
          state.personas.push({
            id,
            name: text(action.name, 60, true),
            instructions: "",
            memoryEnabled: true,
            memories: []
          });
          state.sessions[sessionId] = id;
          break;
        }
        case "select": {
          if (!state.personas.some((p2) => p2.id === action.personaId)) throw new MemoryError("\u4EBA\u683C\u4E0D\u5B58\u5728");
          state.sessions[sessionId] = action.personaId;
          break;
        }
        case "configure": {
          p.name = text(action.name, 60, true);
          p.instructions = text(action.instructions, 2e3);
          if (typeof action.memoryEnabled !== "boolean") throw new MemoryError("\u8BB0\u5FC6\u5F00\u5173\u65E0\u6548");
          p.memoryEnabled = action.memoryEnabled;
          break;
        }
        case "delete-persona": {
          if (p.id === "default") throw new MemoryError("\u9ED8\u8BA4\u52A9\u624B\u4E0D\u80FD\u5220\u9664");
          state.personas = state.personas.filter((item) => item.id !== p.id);
          for (const id of Object.keys(state.sessions))
            if (state.sessions[id] === p.id) state.sessions[id] = "default";
          break;
        }
        case "save": {
          const content = text(action.text, 2e3, true);
          if (action.scope !== "persona" && action.scope !== "project") throw new MemoryError("\u8BB0\u5FC6\u8303\u56F4\u65E0\u6548");
          if (action.scope === "project" && !project) throw new MemoryError("\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u9879\u76EE\u76EE\u5F55");
          const old = action.id ? p.memories.find((m) => m.id === validId(action.id)) : void 0;
          if (action.id && !old) throw new MemoryError("\u8BB0\u5FC6\u5DF2\u79FB\u9664\uFF0C\u8BF7\u5237\u65B0", 409);
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
  return `PX \u5F53\u524D\u4EBA\u683C\uFF1A${persona.name}
\u804C\u8D23\u4E0E\u534F\u4F5C\u65B9\u5F0F\uFF1A${persona.instructions || "\u6CBF\u7528\u5BBF\u4E3B\u9ED8\u8BA4\u65B9\u5F0F"}
\u4EBA\u683C\u4E0D\u6539\u53D8\u5B9E\u9645\u6A21\u578B\u3001\u5DE5\u5177\u6216\u6743\u9650\u3002\u4EE5\u4E0B\u662F\u7528\u6237\u4FDD\u5B58\u7684\u53C2\u8003\u8BB0\u5FC6\uFF1B\u5F53\u524D\u660E\u786E\u6307\u4EE4\u4F18\u5148\uFF0C\u9879\u76EE\u4E0E\u8FD0\u884C\u4E8B\u5B9E\u987B\u6309\u9700\u8981\u91CD\u65B0\u6838\u5B9E\u3002
${persona.memoryEnabled ? JSON.stringify(selectedMemories(persona, project).map((m) => ({ id: m.id, text: m.text, updatedAt: m.updatedAt }))) : "\u672C\u8F6E\u4E0D\u4F7F\u7528\u957F\u671F\u8BB0\u5FC6\u3002"}`;
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

// packages/dsh-px-memory/src/index.ts
var name = "dsh-px-memory";
var inject = [];
function apply(ctx) {
  const root = process.env.DSH_HOME;
  if (!root) throw new Error("DSH_HOME \u672A\u8BBE\u7F6E\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u4EBA\u683C\u4E0E\u8BB0\u5FC6");
  const store = new MemoryStore(join(root, "storages", name, "memory.json"));
  const active = /* @__PURE__ */ new WeakMap();
  ctx.on("agent/created", ({ agent }) => {
    const parent = agent.session.header.parentSession;
    if (!parent) return;
    try {
      const state = store.read();
      if (!Object.hasOwn(state.sessions, agent.session.id) && state.sessions[parent])
        store.change(state.revision, (next) => {
          next.sessions[agent.session.id] = state.sessions[parent];
        });
    } catch (error) {
      ctx.logger?.warn("\u65E0\u6CD5\u7EE7\u627F\u4EBA\u683C\u914D\u7F6E\uFF1A%s", String(error));
    }
  });
  ctx.on("agent/pre-step", ({ agent, turn }, next) => {
    try {
      if (active.get(agent)?.turn !== turn)
        active.set(agent, { turn, persona: store.persona(store.read(), agent.session.id) });
    } catch {
      active.delete(agent);
    }
    return next();
  });
  const current = (agent) => active.get(agent)?.persona ?? store.persona(store.read(), agent.session.id);
  ctx.inject(
    ["systemPrompt"],
    (host) => host.effect(
      () => host.systemPrompt.context({
        name: "dsh-px-persona-memory",
        order: 500,
        text: ({ agent }) => {
          if (!agent) return "";
          try {
            return memoryContext(current(agent), projectKey(agent.session.header.cwd));
          } catch {
            return "PX \u4EBA\u683C\u4E0E\u8BB0\u5FC6\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u3002\u8BF7\u544A\u77E5\u7528\u6237\u68C0\u67E5\u4EBA\u683C\u4E0E\u8BB0\u5FC6\u9762\u677F\uFF0C\u4E0D\u63A8\u6D4B\u5DF2\u4FDD\u5B58\u7684\u5185\u5BB9\u3002\u539F\u751F\u4F1A\u8BDD\u53EF\u7EE7\u7EED\u4F7F\u7528\u3002";
          }
        }
      }),
      "memory: persona context"
    )
  );
  ctx.inject(["tools"], (host) => {
    host.tools.register({
      name: "persona_memory",
      description: "\u8BFB\u53D6\u5F53\u524D\u4EBA\u683C\u7684\u957F\u671F\u8BB0\u5FC6\u3002\u4EC5\u7528\u6237\u660E\u786E\u8981\u6C42\u8BB0\u4F4F\u3001\u4FEE\u6539\u6216\u5FD8\u8BB0\u65F6\u5199\u5165\uFF1B\u4E0D\u8981\u4FDD\u5B58\u4E34\u65F6\u8FDB\u5EA6\u3002\u5148 read \u83B7\u53D6 revision\uFF0C\u518D save/forget\u3002scope=project \u4EC5\u5F53\u524D\u76EE\u5F55\uFF1Bpersona \u8DE8\u76EE\u5F55\u3002\u5DF2\u4FDD\u5B58\u5185\u5BB9\u4ECE\u4E0B\u8F6E\u8D77\u4F7F\u7528\u3002",
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
        const agent = run.agent, state = store.read(), p = current(agent), project = projectKey(agent.session.header.cwd);
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
            const { meta } = await host.sessionController.inspect(id);
            const project = projectKey(meta.cwd);
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
              store.action(args.revision, args, id, project);
            }
            const state = store.read(), persona = store.persona(state, id);
            send(200, {
              revision: state.revision,
              personas: state.personas.map((p) => ({ id: p.id, name: p.name })),
              persona,
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
