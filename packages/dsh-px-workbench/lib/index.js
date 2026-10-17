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
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
var startedAt = (/* @__PURE__ */ new Date()).toISOString();
function findCommand(name2, path = process.env.PATH ?? "") {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const ext of process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]) {
      const candidate = join(dir.replace(/^"|"$/g, ""), name2 + ext);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
      }
    }
  }
  return null;
}
function profileDirectory(home, running) {
  if (running && isAbsolute(running.dir)) return running.dir;
  const profiles = join(home, "profiles");
  let names = [];
  try {
    names = readdirSync(profiles).filter((name2) => existsSync(join(profiles, name2, "package.json")));
  } catch {
  }
  return names.length === 1 ? join(profiles, names[0]) : null;
}
function localStatus(activity = {
  known: false,
  observedKnown: false,
  scope: "observed-sessions",
  runningAgents: 0,
  queuedInputs: 0,
  runningJobs: 0,
  openTerminals: 0
}, running) {
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
    const pkg = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
    for (const [name2, requested] of Object.entries(pkg.dependencies ?? {})) {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name2)) continue;
      let version2 = null;
      try {
        version2 = JSON.parse(readFileSync(join(profile, "node_modules", name2, "package.json"), "utf8")).version ?? null;
      } catch {
      }
      plugins.push({
        name: name2,
        requested: String(requested),
        version: version2,
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
    credentialsFile: Boolean(home && existsSync(join(home, ".credentials.yaml"))),
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
function serviceIdentity(home, platform = process.platform) {
  const path = resolve(home);
  return createHash("sha256").update(platform === "win32" ? path.toLowerCase() : path).digest("hex").slice(0, 24);
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

// packages/dsh-px-workbench/src/terminal-activity.ts
function createTerminalActivityReader() {
  const nativeOwners = /* @__PURE__ */ new Map();
  const browserSessions = /* @__PURE__ */ new Set();
  return (owners, sources) => {
    const result = {
      known: false,
      observedKnown: false,
      scope: "observed-sessions",
      openTerminals: 0
    };
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
        browserSessions.add(owner.id);
      }
      for (const sessionId of browserSessions) {
        const shells = sources.browser.list(sessionId);
        if (!Array.isArray(shells)) return result;
        if (!shells.length && !owners.some((owner) => owner.id === sessionId))
          browserSessions.delete(sessionId);
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
      result.observedKnown = Number.isSafeInteger(result.openTerminals) && result.openTerminals >= 0;
    } catch (error) {
      void error;
    }
    return result;
  };
}
function registerTerminalActivity(ctx) {
  const read = createTerminalActivityReader();
  let native;
  let browser;
  let presets;
  ctx.inject(["agentPresets"], (host) => {
    const value = host.agentPresets;
    presets = value;
    host.effect?.(
      () => () => {
        if (presets === value) presets = void 0;
      },
      "workbench: agent preset terminal lookup"
    );
  });
  ctx.inject(["terminals"], (host) => {
    const value = host.terminals;
    native = value;
    host.effect?.(
      () => () => {
        if (native === value) native = void 0;
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
    browser ? {
      native: (owner) => (owner.ctx && typeof presets?.serviceFor === "function" ? presets.serviceFor(owner, "terminals") : void 0) ?? owner.ctx?.get("terminals") ?? native,
      browser
    } : void 0
  );
}

// packages/dsh-px-workbench/src/activity.ts
function activitySnapshot(services) {
  const result = {
    known: false,
    observedKnown: false,
    scope: "observed-sessions",
    runningAgents: 0,
    queuedInputs: 0,
    runningJobs: 0,
    openTerminals: 0
  };
  if (!services) return result;
  try {
    const agents = services.agents.list();
    const jobs = new Map(services.jobs.list().map((job) => [job.id, job]));
    for (const agent of agents) {
      if (!["running", "idle"].includes(agent.status) || !Array.isArray(agent.inbox.nextTurn) || !Array.isArray(agent.inbox.nextStep))
        return result;
      result.runningAgents += Number(agent.status === "running");
      result.queuedInputs += agent.inbox.nextTurn.length + agent.inbox.nextStep.length;
      for (const job of services.jobs.list(agent.id)) jobs.set(job.id, job);
    }
    result.runningJobs = [...jobs.values()].filter(
      (job) => job.status === "running" || job.status === "stopping"
    ).length;
    const terminals = services.terminalActivity(agents);
    result.openTerminals = terminals.openTerminals;
    result.observedKnown = terminals.observedKnown === true && [result.runningAgents, result.queuedInputs, result.runningJobs, result.openTerminals].every(
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

// packages/dsh-px-workbench/src/file-edit.ts
var FileEditError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
};
async function saveObservedFile(fs, cwd, path, content, expectedContent, limit = 2 * 1024 * 1024) {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > limit)
    throw new FileEditError("\u4FDD\u5B58\u5185\u5BB9\u65E0\u6548\u6216\u8D85\u8FC7\u7F16\u8F91\u5927\u5C0F\u9650\u5236", 400);
  if (expectedContent !== void 0 && (typeof expectedContent !== "string" || Buffer.byteLength(expectedContent, "utf8") > limit))
    throw new FileEditError("\u6587\u4EF6\u8BFB\u53D6\u57FA\u7EBF\u65E0\u6548", 400);
  const target = await fs.resolve(path, { cwd }), before = await fs.stat(target);
  let guard;
  if (before) {
    if (before.type !== "file" || typeof before.version !== "string" || (before.size ?? 0) > limit)
      throw new FileEditError("\u6B64\u6587\u4EF6\u6682\u4E0D\u80FD\u5728\u4FA7\u680F\u5B89\u5168\u7F16\u8F91", 400);
    if (typeof expectedContent !== "string" || await fs.readText(target) !== expectedContent)
      throw new FileEditError(
        "\u6587\u4EF6\u5DF2\u88AB\u5176\u4ED6\u64CD\u4F5C\u4FEE\u6539\u3002\u4F60\u7684\u8349\u7A3F\u4ECD\u4FDD\u7559\uFF1B\u8BF7\u5148\u590D\u5236\u9700\u8981\u7684\u6539\u52A8\uFF0C\u518D\u91CD\u65B0\u8BFB\u53D6\u5E76\u5408\u5E76\u540E\u4FDD\u5B58\u3002",
        409
      );
    guard = { kind: "replaceIfVersion", version: before.version };
  } else {
    if (expectedContent !== void 0)
      throw new FileEditError("\u539F\u6587\u4EF6\u5DF2\u88AB\u5220\u9664\u6216\u79FB\u52A8\uFF0C\u672A\u91CD\u65B0\u521B\u5EFA\u3002\u4F60\u7684\u8349\u7A3F\u4ECD\u4FDD\u7559\u3002", 409);
    guard = { kind: "createIfAbsent" };
  }
  try {
    await fs.writeText(target, content, guard, void 0, { mode: "danger-full-access", workspaceRoot: cwd });
  } catch (e) {
    if (["FS_STALE_VERSION", "FS_NOT_OBSERVED"].includes(e?.code))
      throw new FileEditError("\u6587\u4EF6\u5728\u4FDD\u5B58\u524D\u518D\u6B21\u53D8\u5316\uFF0C\u672A\u8986\u76D6\uFF1B\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5E76\u5408\u5E76\u6539\u52A8\u3002", 409);
    throw e;
  }
  return { ok: true };
}
function installFileEditing(ctx) {
  ctx.inject(
    ["fs"],
    (host) => host.provide("pxFileEditing", {
      save: (cwd, path, content, expected, limit) => saveObservedFile(host.fs, cwd, path, content, expected, limit)
    })
  );
}

// packages/shared/context-policy.ts
var TIER_LABELS = {
  minimum: "\u6700\u4F4E\u9650\u5EA6",
  brief: "\u7B80\u7565",
  full: "\u5B8C\u6574"
};
function positiveCapacity(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : void 0;
}
function contextTier(capacity) {
  return !capacity || capacity <= 65536 ? "minimum" : capacity <= 262144 ? "brief" : "full";
}
function contextBudget(capacity) {
  const tier = contextTier(capacity);
  const planningWindow = capacity ?? 32768;
  return {
    tier,
    capacity,
    outputTokens: Math.max(1, Math.floor(Math.min(planningWindow / 8, tier === "full" ? 131072 : 16384))),
    headroomTokens: Math.max(1, Math.floor(Math.min(planningWindow / 16, 65536))),
    summaryTokens: Math.max(1, Math.floor(Math.min(planningWindow / 16, 32768))),
    retainRatio: 0.12,
    thresholdRatio: 0.75,
    memoryChars: tier === "minimum" ? 2048 : tier === "brief" ? 8192 : 24e3,
    handoffChars: tier === "minimum" ? 2e3 : tier === "brief" ? 6e3 : 12e3,
    ledgerChars: tier === "minimum" ? 2400 : tier === "brief" ? 8e3 : 24e3
  };
}
function assertSameTier(bound, target) {
  if (bound && bound !== target)
    throw Object.assign(
      new Error(
        `\u672C\u4F1A\u8BDD\u56FA\u5B9A\u4E3A\u300C${TIER_LABELS[bound]}\u300D\u6863\u3002\u6240\u9009\u6A21\u578B\u5C5E\u4E8E\u300C${TIER_LABELS[target]}\u300D\u6863\uFF0C\u8BF7\u65B0\u5EFA\u63A5\u7EED\u4F1A\u8BDD\u3002`
      ),
      { code: "PX_CONTEXT_TIER_CHANGE" }
    );
}

// node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
var Cached = class {
  constructor(getter) {
    this._getter = getter;
    this._value = void 0;
  }
  get value() {
    const getter = this._getter;
    if (getter !== void 0) {
      this._value = getter();
      this._getter = void 0;
    }
    return this._value;
  }
};
function cached(getter) {
  return new Cached(getter);
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a2;
    (_a2 = iss).path ?? (_a2.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function attachSchema(issues, start, inst) {
  var _a2;
  for (let i = start; i < issues.length; i++) {
    (_a2 = issues[i]).schema ?? (_a2.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config2) {
  var _a2;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a2 = iss).schema ?? (_a2.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? void 0 : proto;
}
var installing;
var broke = false;
var breaker = {
  configurable: true,
  get() {
    broke = true;
    return void 0;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = void 0;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: void 0 };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}

// node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: void 0, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition();
      }
      try {
        return new Definition();
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition();
}
// @__NO_SIDE_EFFECTS__
function $constructor(name2, initializer2, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = /* @__PURE__ */ new Set();
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    } else if (inst._zod.traits.has(name2)) {
      return;
    }
    inst._zod.traits.add(name2);
    initializer2(inst, def);
    if (initialized) {
      const own2 = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own2;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own2;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto2 = _.prototype;
    for (const k in proto2) {
      if (!Object.prototype.hasOwnProperty.call(proto2, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto2[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name2 });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = void 0;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name2);
    }
  });
  Object.defineProperty(_, "name", { value: name2 });
  return _;
}
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: void 0, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = void 0;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, void 0, {
  Parent: Error
});

// node_modules/zod/v4/core/parse.js
var _parse = (_Err) => {
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError();
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var parse = /* @__PURE__ */ _parse($ZodRealError);
var _parseAsync = (_Err) => {
  const fn = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var parseAsync = /* @__PURE__ */ _parseAsync($ZodRealError);
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
function failure(Err, issues, ctx) {
  let error;
  return {
    success: false,
    get error() {
      if (!error) {
        error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = void 0;
        ctx = void 0;
      }
      return error;
    },
    set error(e) {
      error = e;
      issues = void 0;
      ctx = void 0;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);

// node_modules/zod/v4/core/regexes.js
var anyString = /^[\s\S]{0,}$/;
var number = /^-?\d+(?:\.\d+)?$/;

// node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a2;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a2 = inst._zod).onattach ?? (_a2.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});

// node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 7
};

// node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a2;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
var toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {
      }
      return validateAsync(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== void 0 && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === void 0) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      // Describes the shape of the input, not the validity of the parsed value, so it never aborts. The parse still fails; the schema's own checks just get to run first, and an enclosing intersection can reconcile the key against a sibling operand.
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get2 = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get2.raw = newSh;
      return newSh;
    };
    get2.raw = sh;
    Object.defineProperty(def, "shape", { get: get2 });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, /* @__PURE__ */ new Set());
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== void 0)
          propValues[key].add(void 0);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const values = new Set(def.values);
  inst._zod.values = values;
  defineLazyInternal(inst, "pattern", (zod) => {
    const vals = zod.def.values;
    return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? void 0 : result.value;
  return payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result2) => handleOptionalResult(payload, result2));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});

// node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
  return new Class(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}

// node_modules/zod/v4/mini/schemas.js
var ZodMiniType = /* @__PURE__ */ $constructor("ZodMiniType", (inst, def) => {
  if (!inst._zod)
    throw new Error("Uninitialized schema in ZodMiniType.");
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
}, {
  // `with` is an alias for `check`: the same function object, not a wrapper.
  get with() {
    return this.check;
  },
  set with(value) {
    own(this, "with", value);
  },
  parse(data, params) {
    return parse(this, data, params, { callee: this.parse });
  },
  parseAsync(data, params) {
    return parseAsync(this, data, params, { callee: this.parseAsync });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  check(...checks) {
    const def = this.def;
    return this.clone({
      ...def,
      checks: [
        ...def.checks ?? [],
        ...checks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }, { parent: true });
  },
  clone(_def, params) {
    return clone(this, _def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta2) {
    reg.add(this, meta2);
    return this;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  }
});
var ZodMiniString = /* @__PURE__ */ $constructor("ZodMiniString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function string2(params) {
  return _string(ZodMiniString, params);
}
var ZodMiniNumber = /* @__PURE__ */ $constructor("ZodMiniNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodMiniType.init(inst, def);
});
var ZodMiniNumberFormat = /* @__PURE__ */ $constructor("ZodMiniNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodMiniNumber.init(inst, def);
});
function int(params) {
  return _int(ZodMiniNumberFormat, params);
}
var ZodMiniObject = /* @__PURE__ */ $constructor("ZodMiniObject", (inst, def) => {
  $ZodObject.init(inst, def);
  ZodMiniType.init(inst, def);
  installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
});
// @__NO_SIDE_EFFECTS__
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodMiniObject(def);
}
var ZodMiniEnum = /* @__PURE__ */ $constructor("ZodMiniEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodMiniType.init(inst, def);
  inst.options = [...inst._zod.values];
});
// @__NO_SIDE_EFFECTS__
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodMiniEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodMiniLiteral = /* @__PURE__ */ $constructor("ZodMiniLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function literal(value, params) {
  return new ZodMiniLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
var ZodMiniOptional = /* @__PURE__ */ $constructor("ZodMiniOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function optional(innerType) {
  return new ZodMiniOptional({
    type: "optional",
    innerType
  });
}

// packages/dsh-px-workbench/src/context-state.ts
var route = { provider: string2(), model: string2(), reasoningEffort: optional(string2()) };
var binding = object({
  version: literal(1),
  tier: _enum(["minimum", "brief", "full"]),
  ...route,
  capacity: optional(int().check(_gte(1)))
});
var continuation = object({ sourceSessionId: string2(), ...route });
function contextState(ctx) {
  let opened;
  const domain = () => {
    if (!opened) {
      const facility = ctx.get?.("storageDomain") ?? ctx.storageDomain;
      if (!facility) throw Error("\u539F\u751F\u4E0A\u4E0B\u6587\u6863\u4F4D\u5B58\u50A8\u5C1A\u672A\u5C31\u7EEA");
      opened = facility.open({
        name: "px_context_policy",
        version: 1,
        layout: "per-record",
        tables: { bindings: { valueSchema: binding }, continuations: { valueSchema: continuation } }
      });
    }
    return opened;
  };
  ctx.effect?.(
    () => () => opened?.then(
      (d) => d.close(),
      () => {
      }
    ),
    "workbench: native context policy storage"
  );
  return {
    async get(id) {
      return (await domain()).table("bindings").get(id);
    },
    async bind(id, value) {
      await (await domain()).table("bindings").put(id, binding.parse(value));
    },
    async continuation(id) {
      return (await domain()).table("continuations").get(id);
    },
    async rememberContinuation(id, value) {
      await (await domain()).table("continuations").put(id, continuation.parse(value));
    }
  };
}

// packages/dsh-px-workbench/src/context-policy.ts
var get = (ctx, key) => ctx.get?.(key) ?? ctx[key];
async function modelCapacity(ctx, route2, signal) {
  const llm = get(ctx, "llm");
  const info = await llm.resolveModelInfo(route2.provider, route2.model, signal);
  let capacity = positiveCapacity(info.context?.contextWindow);
  const directory = llm.listConfigurableProviders?.().find((p) => p.provider === route2.provider);
  if (directory) {
    const row = get(ctx, "configEditor")?.configuration?.().find((r) => r.entry.options.id === directory.settingsNs);
    const walk = (value) => directory.settingsPath.reduce((v, k) => v?.[k], value);
    const inherited = walk(row?.inherited), override = walk(row?.override);
    const models = override?.models ?? inherited?.models;
    const entry = models?.find((m) => m.id === route2.model);
    if (directory.declared || entry) {
      capacity = positiveCapacity(entry?.contextWindow) ?? positiveCapacity(override?.defaultContextWindow ?? inherited?.defaultContextWindow);
    }
  }
  signal?.throwIfAborted();
  return { ...route2, capacity, declared: capacity !== void 0, tier: contextTier(capacity) };
}
function ownRequestContext(session) {
  return session.snapshotEvents().findLast((e) => e.seq >= (session.inheritedEventCount ?? 0) && e.type === "request/context")?.data;
}
function installContextPolicy(ctx) {
  const state = contextState(ctx);
  const assembling = /* @__PURE__ */ new WeakMap();
  async function describe2(agent, route2, signal) {
    return modelCapacity(ctx, route2, signal);
  }
  async function validate2(agent, route2, signal) {
    const value = await describe2(agent, route2, signal);
    let bound = (await state.get(agent.session.id))?.tier;
    const prior = ownRequestContext(agent.session);
    if (!bound && prior) {
      const previous = await modelCapacity(ctx, prior, signal);
      bound = previous.tier;
      assertSameTier(bound, value.tier);
      await state.bind(agent.session.id, {
        version: 1,
        tier: bound,
        provider: prior.provider,
        model: prior.model,
        ...previous.capacity ? { capacity: previous.capacity } : {}
      });
    }
    assertSameTier(bound, value.tier);
    return value;
  }
  const policy = {
    state,
    describe: describe2,
    budget: (agent) => contextBudget(assembling.get(agent)?.capacity),
    async compaction(config2, agent, target, signal, summary = false) {
      const route2 = summary ? {
        provider: config2.summarizationProvider || target.provider,
        model: config2.summarizationModel || target.model
      } : target;
      const value = await modelCapacity(ctx, route2, signal);
      const b = contextBudget(value.capacity);
      const retention = config2.retainTokens === void 0 ? { retainRatio: Math.min(config2.retainRatio ?? b.retainRatio, b.retainRatio) } : {
        retainTokens: Math.min(
          config2.retainTokens,
          Math.floor((value.capacity ?? 32768) * b.retainRatio)
        )
      };
      return {
        ...config2,
        ...retention,
        headroomTokens: Math.min(config2.headroomTokens, b.headroomTokens),
        thresholdRatio: Math.min(config2.thresholdRatio, b.thresholdRatio),
        maxTokens: Math.min(config2.maxTokens, b.summaryTokens)
      };
    },
    async select(agent, route2) {
      const effective = assembling.get(agent) ?? agent.options;
      if (agent.status === "running" && (effective.provider !== route2.provider || effective.model !== route2.model))
        throw Error("\u8BF7\u7B49\u5F85\u672C\u8F6E\u7ED3\u675F\u6216\u505C\u6B62\u540E\u518D\u5207\u6362\u6A21\u578B");
      const value = await validate2(agent, route2);
      const prior = agent.session.requestContext?.();
      if (prior && (prior.provider !== route2.provider || prior.model !== route2.model) && value.capacity) {
        const tokens = get(ctx, "tokenMeter")?.measure(agent.session)?.totalTokens;
        const budget = contextBudget(value.capacity);
        if (typeof tokens === "number" && tokens + budget.outputTokens + budget.headroomTokens >= value.capacity)
          throw Error("\u5F53\u524D\u4E0A\u4E0B\u6587\u653E\u4E0D\u8FDB\u6240\u9009\u6A21\u578B\u3002\u8BF7\u5148\u538B\u7F29\uFF0C\u6216\u65B0\u5EFA\u63A5\u7EED\u4F1A\u8BDD\u3002");
      }
    },
    /** Applied only to this request, without editing stored model settings. */
    async request(agent, config2, signal) {
      const value = await validate2(agent, config2, signal);
      const assembled = assembling.get(agent);
      if (assembled && (assembled.provider !== value.provider || assembled.model !== value.model))
        throw Error("\u6A21\u578B\u8DEF\u7531\u5728\u4E0A\u4E0B\u6587\u7EC4\u88C5\u671F\u95F4\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5\u672C\u8F6E");
      const budget = contextBudget(value.capacity);
      const cap = positiveCapacity(config2.maxTokens);
      const info = await get(ctx, "llm").resolveModelInfo(value.provider, value.model, signal);
      const configuredCap = cap ?? positiveCapacity(info.defaultMaxTokens);
      signal?.throwIfAborted();
      if (!await state.get(agent.session.id))
        await state.bind(agent.session.id, {
          version: 1,
          tier: value.tier,
          provider: value.provider,
          model: value.model,
          ...value.capacity ? { capacity: value.capacity } : {}
        });
      return { ...config2, maxTokens: Math.min(configuredCap ?? budget.outputTokens, budget.outputTokens) };
    }
  };
  ctx.provide("pxContextPolicy", policy);
  ctx.on(
    "system-prompt/assemble",
    async (_assembly, context, next) => {
      const agent = context.agent;
      if (!agent) return next();
      const assembly = await next();
      const route2 = {
        provider: assembly.variables.provider || agent.options.provider,
        model: assembly.variables.model || agent.options.model
      };
      const value = await validate2(agent, route2, context.signal);
      assembling.set(agent, value);
      const b = contextBudget(value.capacity);
      return {
        ...assembly,
        contexts: assembly.contexts.map((entry) => {
          if (entry.name === "dsh-px-persona-memory" && get(ctx, "pxMemoryContext"))
            return { ...entry, text: get(ctx, "pxMemoryContext").render(agent, b) };
          if (entry.name !== "dsh-px-work-ledger" || entry.text.length <= b.ledgerChars) return entry;
          return {
            ...entry,
            text: "PX \u5DE5\u4F5C\u8D26\u672C\u5DF2\u4FDD\u5B58\u3002\u672C\u6863\u6309\u9700\u8BFB\u53D6\uFF1A\u7EE7\u7EED\u590D\u6742\u5DE5\u4F5C\u524D\u4F7F\u7528 task_review \u83B7\u53D6\u6700\u65B0\u8D26\u672C\u3001task_state \u6838\u5BF9\u539F\u751F\u4EFB\u52A1\uFF0C\u6309\u9700\u7528 task_evidence \u8BFB\u53D6\u56DE\u6267\u3002\u8D26\u672C\u662F\u5386\u53F2\u4F9D\u636E\uFF0C\u4E0D\u662F\u65B0\u7684\u6388\u6743\u3002"
          };
        })
      };
    },
    { prepend: true }
  );
  ctx.on(
    "agent/request",
    async ({ agent, signal }, next) => policy.request(agent, await next(), signal),
    { prepend: true }
  );
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
  installFileEditing(ctx);
  installContextPolicy(ctx);
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
        path: `${DEFAULTS.routePrefix}/context-policy`,
        handler: async (req, res) => {
          if (rejectUnauthenticatedRequest(req, res, ctx2.connection)) return;
          if (req.method !== "GET") return json(res, 405, { error: "\u8BF7\u4F7F\u7528 GET" });
          try {
            const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
            const id = params.get("sessionId"), provider = params.get("provider"), model = params.get("model");
            if (!id || id.length > 160 || !provider || !model || provider.length > 256 || model.length > 512)
              throw Error("\u4F1A\u8BDD\u6216\u6A21\u578B\u53C2\u6570\u65E0\u6548");
            const host = ctx2, controller = host.get("sessionController");
            const snapshot = await controller.inspect(id);
            let bound = (await host.get("pxContextPolicy").state.get(id))?.tier;
            const prior = ownRequestContext({
              snapshotEvents: () => snapshot.events,
              inheritedEventCount: snapshot.inheritedEventCount ?? 0
            });
            if (!bound && prior) bound = (await modelCapacity(host, prior)).tier;
            const target = await modelCapacity(host, { provider, model });
            json(res, 200, {
              bound,
              target,
              requiresContinuation: !!bound && bound !== target.tier,
              nativeGuard: controller.pxModelSelectionGuardVersion === 1,
              canContinue: !!host.get("pxMemoryContext")
            });
          } catch (e) {
            json(res, 400, { error: e instanceof Error ? e.message : String(e) });
          }
        }
      }),
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
