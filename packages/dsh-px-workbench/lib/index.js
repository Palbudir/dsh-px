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

// packages/dsh-px-workbench/src/index.ts
import { isAbsolute as isAbsolute2 } from "node:path";

// packages/dsh-px-workbench/src/status.ts
import { accessSync, constants, existsSync, readFileSync as readFileSync2, readdirSync, statSync as statSync2 } from "node:fs";
import { delimiter, isAbsolute, join as join2 } from "node:path";

// packages/dsh-px-workbench/src/layout.ts
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// packages/shared/session-layout.ts
function parseTabs(raw) {
  try {
    const p = JSON.parse(raw ?? "{}");
    const ids = (v) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && /^[\w-]{1,200}$/.test(x)))] : [];
    const open = ids(p.ids), closed = ids(p.closed).slice(0, 10), titles = {};
    for (const id of [...open, ...closed])
      if (typeof p.titles?.[id] === "string")
        Object.defineProperty(titles, id, {
          value: p.titles[id].slice(0, 160),
          enumerable: true,
          writable: true,
          configurable: true
        });
    return { ids: open, pins: ids(p.pins).filter((id) => open.includes(id)), closed, titles };
  } catch {
    return { ids: [], pins: [], closed: [], titles: {} };
  }
}

// packages/dsh-px-workbench/src/layout.ts
function serviceIdentity(home, platform = process.platform) {
  const path = resolve(home);
  return createHash("sha256").update(platform === "win32" ? path.toLowerCase() : path).digest("hex").slice(0, 24);
}
var LayoutError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
function createLayoutStore(home) {
  const dir = join(home, "storages", "dsh-px-workbench");
  const path = join(dir, "session-layout.json");
  const serviceId = serviceIdentity(home);
  function read() {
    try {
      if (statSync(path).size > 512e3) throw new Error("\u5E03\u5C40\u6587\u4EF6\u8FC7\u5927");
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.layout)
        throw new Error("\u5E03\u5C40\u6587\u4EF6\u683C\u5F0F\u65E0\u6548");
      return { serviceId, revision: value.revision, layout: parseTabs(JSON.stringify(value.layout)) };
    } catch (err) {
      if (err?.code === "ENOENT") return { serviceId, revision: 0, layout: parseTabs(null) };
      throw new LayoutError(
        "\u65E0\u6CD5\u8BFB\u53D6\u4F1A\u8BDD\u5E03\u5C40\uFF0C\u539F\u6587\u4EF6\u5DF2\u4FDD\u7559\u3002\u8BF7\u68C0\u67E5\u8FD0\u884C\u65E5\u5FD7\u6216\u6062\u590D\u6709\u6548\u5907\u4EFD\uFF1B\u5F53\u524D\u7A97\u53E3\u4ECD\u53EF\u4F7F\u7528\u3002",
        503
      );
    }
  }
  return {
    read,
    write(request) {
      const value = request;
      if (!value || value.serviceId !== serviceId || !Number.isSafeInteger(value.revision) || !value.layout)
        throw new LayoutError("\u5E03\u5C40\u670D\u52A1\u8EAB\u4EFD\u6216\u4FEE\u8BA2\u53F7\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5E03\u5C40\u3002");
      if (JSON.stringify(value.layout).length > 48e4 || !Array.isArray(value.layout.ids) || value.layout.ids.length > 1e3)
        throw new LayoutError("\u5DF2\u6253\u5F00\u4F1A\u8BDD\u8FC7\u591A\uFF0C\u8BF7\u5173\u95ED\u90E8\u5206\u6807\u7B7E\u540E\u91CD\u8BD5\u3002", 413);
      const previous = read();
      if (value.revision !== previous.revision)
        throw new LayoutError(
          "\u53E6\u4E00\u4E2A\u7A97\u53E3\u5DF2\u4FDD\u5B58\u65B0\u7684\u5E03\u5C40\u3002\u5F53\u524D\u7A97\u53E3\u6807\u7B7E\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u9009\u62E9\u6062\u590D\u6700\u65B0\u5E03\u5C40\u6216\u4FDD\u5B58\u6B64\u7A97\u53E3\u5E03\u5C40\u3002",
          409
        );
      const next = {
        serviceId,
        revision: previous.revision + 1,
        layout: parseTabs(JSON.stringify(value.layout))
      };
      mkdirSync(dir, { recursive: true });
      const temp = path + "." + randomUUID() + ".tmp";
      writeFileSync(temp, JSON.stringify({ version: 1, ...next }) + "\n");
      renameSync(temp, path);
      return next;
    }
  };
}

// packages/dsh-px-workbench/src/status.ts
var startedAt = (/* @__PURE__ */ new Date()).toISOString();
function findCommand(name2, path = process.env.PATH ?? "") {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const ext of process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]) {
      const candidate = join2(dir.replace(/^"|"$/g, ""), name2 + ext);
      try {
        if (statSync2(candidate).isFile()) return candidate;
      } catch {
      }
    }
  }
  return null;
}
function profileDirectory(home, running) {
  if (running && isAbsolute(running.dir)) return running.dir;
  const profiles = join2(home, "profiles");
  let names = [];
  try {
    names = readdirSync(profiles).filter((name2) => existsSync(join2(profiles, name2, "package.json")));
  } catch {
  }
  return names.length === 1 ? join2(profiles, names[0]) : null;
}
function localStatus(activity = { known: false, runningAgents: 0, queuedInputs: 0, runningJobs: 0, openTerminals: 0 }, running) {
  const home = process.env.DSH_HOME ?? null;
  const profile = home ? profileDirectory(home, running) : null;
  const plugins = [];
  let profileError = null;
  let writable = false;
  if (home) {
    try {
      accessSync(home, constants.W_OK);
      writable = true;
    } catch {
    }
  }
  try {
    if (!home) throw new Error("\u672A\u63D0\u4F9B DSH_HOME");
    if (!profile) throw new Error("\u5BBF\u4E3B\u672A\u63D0\u4F9B\u5F53\u524D Profile\uFF0C\u4E14\u6570\u636E\u76EE\u5F55\u4E2D\u4E0D\u6B62\u4E00\u4E2A Profile\uFF0C\u65E0\u6CD5\u786E\u5B9A\u63D2\u4EF6\u6E05\u5355");
    const pkg = JSON.parse(readFileSync2(join2(profile, "package.json"), "utf8"));
    for (const [name2, requested] of Object.entries(pkg.dependencies ?? {})) {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name2)) continue;
      let version = null;
      try {
        version = JSON.parse(readFileSync2(join2(profile, "node_modules", name2, "package.json"), "utf8")).version ?? null;
      } catch {
      }
      plugins.push({
        name: name2,
        requested: String(requested),
        version,
        enabled: pkg.dsh?.profile?.bundles?.includes(name2) === true
      });
    }
    readdirSync(profile);
  } catch (err) {
    profileError = err instanceof Error ? err.message : String(err);
  }
  return {
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    startedAt,
    node: { version: process.version, path: process.execPath },
    home,
    writable,
    tools: ["git", "pnpm"].map((name2) => ({ name: name2, path: findCommand(name2) })),
    plugins,
    profileError,
    credentialsFile: Boolean(home && existsSync(join2(home, ".credentials.yaml"))),
    serviceId: home ? serviceIdentity(home) : null,
    runtime: {
      mode: "native",
      owner: "native-host",
      shared: true,
      capabilities: { restart: false, install: false }
    },
    activity
  };
}

// packages/dsh-px-workbench/src/network.ts
var targets = ["https://nodejs.org/api/test.html", "https://www.typescriptlang.org/docs/"];
function explanation(error) {
  const code = error?.code;
  if (code === "WEB_BLOCKED_URL") return "\u516C\u5F00\u9875\u9762\u7684\u5730\u5740\u88AB\u7F51\u7EDC\u7B56\u7565\u62D2\u7EDD\u3002\u8BF7\u68C0\u67E5\u4EE3\u7406\u6765\u6E90\uFF1B\u4E0D\u8981\u5173\u95ED\u5730\u5740\u4FDD\u62A4\u3002";
  if (code === "WEB_ABORTED" || code === "WEB_FETCH_TIMEOUT" || error?.name === "TimeoutError")
    return "\u8BFB\u53D6\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u672C\u673A\u4EE3\u7406\u662F\u5426\u8FD0\u884C\u3002";
  if (code?.startsWith("WEB_PROVIDER")) return "\u7F51\u9875\u8BFB\u53D6\u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u8BF7\u68C0\u67E5\u5F53\u524D DSH \u7EC4\u5408\u3002";
  return "\u7F51\u9875\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u4EE3\u7406\u8FDE\u63A5\u4E0E\u670D\u52A1\u65E5\u5FD7\u3002";
}
async function checkWebAccess(fetchPage) {
  return {
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    checks: await Promise.all(
      targets.map(async (url) => {
        try {
          const result = await fetchPage({ url }, AbortSignal.timeout(1e4));
          const ok = result.statusCode >= 200 && result.statusCode < 300 && result.body.content.length > 0;
          return {
            url,
            ok,
            status: result.statusCode,
            chars: result.body.content.length,
            truncated: result.truncated,
            message: ok ? "\u7F51\u9875\u6B63\u6587\u8BFB\u53D6\u6210\u529F" : `\u670D\u52A1\u8FD4\u56DE HTTP ${result.statusCode}\uFF0C\u5C1A\u672A\u53D6\u5F97\u53EF\u7528\u6B63\u6587`
          };
        } catch (error) {
          return { url, ok: false, status: null, chars: 0, truncated: false, message: explanation(error) };
        }
      })
    )
  };
}

// packages/dsh-px-workbench/src/http.ts
async function readJsonBody(req, limit = 512e3) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
    throw new Error("\u8BF7\u4F7F\u7528 JSON \u8BF7\u6C42");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > limit) throw new Error("\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927");
    chunks.push(Buffer.from(chunk));
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON \u5185\u5BB9\u65E0\u6548");
  return value;
}

// packages/dsh-px-workbench/src/terminal-activity.ts
function createTerminalActivityReader() {
  const nativeOwners = /* @__PURE__ */ new Map();
  return (owners, sources) => {
    const result = { known: false, openTerminals: 0 };
    if (!sources) return result;
    try {
      for (const owner of owners) {
        const registry = sources.native(owner);
        if (registry) {
          let registries = nativeOwners.get(owner);
          if (!registries) nativeOwners.set(owner, registries = /* @__PURE__ */ new Map());
          const original = registry[Symbol.for("cordis.original")];
          registries.set(original ?? registry, registry);
        }
        if (typeof owner.id !== "string") return result;
        const shells = sources.browser.list(owner.id);
        if (!Array.isArray(shells)) return result;
        result.openTerminals += shells.length;
      }
      for (const [owner, registries] of nativeOwners) {
        for (const [identity, registry] of registries) {
          const active = registry.hasOwnerActivity(owner);
          if (typeof active !== "boolean") return result;
          if (!active) {
            registries.delete(identity);
            continue;
          }
          const sessions = registry.list(owner);
          if (!Array.isArray(sessions)) return result;
          result.openTerminals += Math.max(1, sessions.length);
        }
        if (!registries.size) nativeOwners.delete(owner);
      }
      result.known = Number.isSafeInteger(result.openTerminals) && result.openTerminals >= 0;
    } catch (error) {
      void error;
    }
    return result;
  };
}
function registerTerminalActivity(ctx) {
  const read = createTerminalActivityReader();
  let native;
  let nativeBound = false;
  let browser;
  ctx.inject(["terminals"], (host) => {
    const value = host.terminals;
    native = value;
    nativeBound = true;
    host.effect?.(
      () => () => {
        if (native === value) {
          native = void 0;
          nativeBound = false;
        }
      },
      "workbench: native terminal activity source"
    );
  });
  ctx.inject(["terminalController"], (host) => {
    const value = host.terminalController;
    browser = value;
    host.effect?.(
      () => () => {
        if (browser === value) browser = void 0;
      },
      "workbench: browser terminal activity source"
    );
  });
  return (owners) => read(
    owners,
    nativeBound && browser ? {
      native: (owner) => owner.ctx?.get("terminals") ?? native,
      browser
    } : void 0
  );
}

// packages/dsh-px-workbench/src/activity.ts
function activitySnapshot(services) {
  const result = { known: false, runningAgents: 0, queuedInputs: 0, runningJobs: 0, openTerminals: 0 };
  if (!services) return result;
  try {
    const agents = services.agents.list();
    const jobs = new Map(services.jobs.list().map((job) => [job.id, job]));
    for (const agent of agents) {
      if (!["running", "idle"].includes(agent.status) || !Array.isArray(agent.inbox.nextTurn) || !Array.isArray(agent.inbox.nextStep))
        return result;
      result.runningAgents += Number(agent.status === "running");
      result.queuedInputs += agent.inbox.nextTurn.length + agent.inbox.nextStep.length;
      for (const job of services.jobs.list(agent)) jobs.set(job.id, job);
    }
    result.runningJobs = [...jobs.values()].filter(
      (job) => job.status === "running" || job.status === "stopping"
    ).length;
    const terminals = services.terminalActivity(agents);
    result.openTerminals = terminals.openTerminals;
    result.known = terminals.known === true && [result.runningAgents, result.queuedInputs, result.runningJobs, result.openTerminals].every(
      (value) => Number.isSafeInteger(value) && value >= 0
    );
  } catch {
  }
  return result;
}
function registerActivity(ctx) {
  let services;
  const terminalActivity = registerTerminalActivity(ctx);
  ctx.inject(["agents", "jobs"], (host) => {
    const current = { agents: host.agents, jobs: host.jobs, terminalActivity };
    services = current;
    host.effect?.(
      () => () => {
        if (services === current) services = void 0;
      },
      "workbench: activity sources"
    );
  });
  const read = () => activitySnapshot(services);
  ctx.inject(["connection", "webServer"], (host) => {
    if (!host.webServer) return;
    const json2 = (res, code, value) => {
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(value));
    };
    host.effect?.(
      () => host.webServer.register({
        kind: "exact",
        path: "/dsh-px-workbench/activity",
        handler: (req, res) => {
          if (rejectUnauthenticatedRequest(req, res, host.connection)) return;
          if (req.method !== "GET") return json2(res, 405, { error: "\u8BF7\u4F7F\u7528 GET" });
          json2(res, 200, read());
        }
      }),
      "workbench: activity route"
    );
  });
  return read;
}

// packages/dsh-px-workbench/src/index.ts
var name = "dsh-px-workbench";
var inject = [];
var DEFAULTS = { routePrefix: "/dsh-px-workbench" };
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
function apply(ctx) {
  const activity = registerActivity(ctx);
  let runningProfile;
  ctx.inject(["profileContext"], (host) => {
    const value = host.profileContext;
    if (typeof value?.name !== "string" || typeof value.dir !== "string") return;
    const current = { name: value.name, dir: value.dir };
    runningProfile = current;
    host.effect?.(
      () => () => {
        if (runningProfile === current) runningProfile = void 0;
      },
      "workbench: running profile"
    );
  });
  let workspaceController;
  ctx.inject(["workspaceController"], (host) => {
    const current = host.workspaceController;
    workspaceController = current;
    host.effect?.(
      () => () => {
        if (workspaceController === current) workspaceController = void 0;
      },
      "workbench: workspace capability"
    );
  });
  ctx.inject(["connection", "webServer", "web"], (host) => {
    const web = host.web;
    if (!host.webServer || !web) return;
    let pending = null;
    host.effect?.(
      () => host.webServer.register({
        kind: "exact",
        path: `${DEFAULTS.routePrefix}/network-check`,
        handler: async (req, res) => {
          if (rejectUnauthenticatedRequest(req, res, host.connection)) return;
          if (req.method !== "POST") return json(res, 405, { error: "\u8BF7\u4F7F\u7528 POST" });
          if (req.headers?.["x-dsh-px-request"] !== "1")
            return json(res, 403, { error: "\u8BF7\u4ECE\u672C\u673A\u5DE5\u4F5C\u53F0\u63D0\u4EA4\u8BF7\u6C42" });
          if (new URL(req.url ?? "/", "http://127.0.0.1").search)
            return json(res, 400, { error: "\u7F51\u7EDC\u68C0\u67E5\u4EC5\u4F7F\u7528\u56FA\u5B9A\u7684\u516C\u5F00\u6587\u6863\u5730\u5740" });
          pending ??= checkWebAccess((request, signal) => web.fetch(request, signal)).finally(() => {
            pending = null;
          });
          json(res, 200, await pending);
        }
      }),
      "dsh-px-workbench: network check"
    );
  });
  ctx.inject(["connection", "webServer"], (ctx2) => {
    if (!ctx2.webServer) return;
    const dispose = [
      ctx2.webServer.register({
        kind: "exact",
        path: `${DEFAULTS.routePrefix}/status`,
        handler: (req, res) => {
          if (rejectUnauthenticatedRequest(req, res, ctx2.connection)) return;
          if (req.method !== "GET") return json(res, 405, { error: "\u8BF7\u4F7F\u7528 GET" });
          json(res, 200, localStatus(activity(), runningProfile));
        }
      }),
      ctx2.webServer.register({
        kind: "exact",
        path: `${DEFAULTS.routePrefix}/layout`,
        handler: async (req, res) => {
          if (rejectUnauthenticatedRequest(req, res, ctx2.connection)) return;
          if (!process.env.DSH_HOME)
            return json(res, 503, { error: "\u670D\u52A1\u672A\u63D0\u4F9B\u6570\u636E\u76EE\u5F55\uFF0C\u6807\u7B7E\u4ECD\u53EF\u5728\u5F53\u524D\u7A97\u53E3\u4F7F\u7528\u3002" });
          const store = createLayoutStore(process.env.DSH_HOME);
          try {
            if (req.method === "GET") return json(res, 200, store.read());
            if (req.method !== "POST") return json(res, 405, { error: "\u8BF7\u4F7F\u7528 GET \u6216 POST" });
            if (req.headers?.["x-dsh-px-request"] !== "1")
              return json(res, 403, { error: "\u8BF7\u4ECE\u672C\u673A\u9875\u9762\u4FDD\u5B58\u5E03\u5C40" });
            json(res, 200, store.write(await readJsonBody(req)));
          } catch (err) {
            json(res, err instanceof LayoutError ? err.status : 400, {
              error: err instanceof Error ? err.message : "\u5E03\u5C40\u64CD\u4F5C\u5931\u8D25"
            });
          }
        }
      }),
      ctx2.webServer.register({
        kind: "exact",
        path: `${DEFAULTS.routePrefix}/workspace`,
        handler: async (req, res) => {
          if (rejectUnauthenticatedRequest(req, res, ctx2.connection)) return;
          if (req.method !== "POST") return json(res, 405, { error: "\u8BF7\u4F7F\u7528 POST" });
          if (req.headers?.["x-dsh-px-request"] !== "1")
            return json(res, 403, { error: "\u8BF7\u4ECE\u672C\u673A\u5DE5\u4F5C\u53F0\u63D0\u4EA4\u8BF7\u6C42" });
          const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
          const path = params.get("path")?.trim();
          if (!path || path.length > 4096 || params.getAll("path").length !== 1 || !isAbsolute2(path)) {
            return json(res, 400, { error: "\u8BF7\u8F93\u5165\u5DF2\u5B58\u5728\u6587\u4EF6\u5939\u7684\u5B8C\u6574\u8DEF\u5F84\uFF0C\u4F8B\u5982 C:\\Projects\\demo" });
          }
          const controller = workspaceController;
          if (!controller) return json(res, 503, { error: "DSH \u5DE5\u4F5C\u533A\u670D\u52A1\u672A\u5C31\u7EEA" });
          try {
            const value = await controller.create({ path });
            json(res, 200, {
              message: value.created ? "\u5DE5\u4F5C\u533A\u5DF2\u6DFB\u52A0\u3002\u5173\u95ED\u8BBE\u7F6E\u540E\u53EF\u5728\u9009\u62E9\u5DE5\u4F5C\u533A\u83DC\u5355\u4E2D\u5F00\u59CB\u4F1A\u8BDD\u3002" : "\u6B64\u5DE5\u4F5C\u533A\u5DF2\u5B58\u5728\u3002\u5173\u95ED\u8BBE\u7F6E\u540E\u53EF\u9009\u62E9\u5B83\u5E76\u5F00\u59CB\u4F1A\u8BDD\u3002"
            });
          } catch (err) {
            json(res, 400, {
              error: `\u65E0\u6CD5\u6DFB\u52A0\u5DE5\u4F5C\u533A\uFF0C\u8BF7\u786E\u8BA4\u6587\u4EF6\u5939\u5B58\u5728\u5E76\u53EF\u8BBF\u95EE\uFF1A${err instanceof Error ? err.message : String(err)}`
            });
          }
        }
      })
    ];
    ctx2.effect?.(() => () => dispose.forEach((fn) => fn()), "dsh-px-workbench: routes");
  });
}
export {
  DEFAULTS,
  apply,
  inject,
  name
};
