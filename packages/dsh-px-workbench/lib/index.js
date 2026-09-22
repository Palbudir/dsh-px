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

// packages/dsh-px-workbench/src/index.ts
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join as join2 } from "node:path";

// packages/dsh-px-workbench/src/status.ts
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
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
function readServiceState(userData = process.env.DSH_PX_USER_DATA) {
  if (!userData) return null;
  try {
    const value = JSON.parse(readFileSync(join(userData, "service-state.json"), "utf8"));
    if (!["starting", "running", "restarting", "error", "stopped"].includes(value.phase) || typeof value.message !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) return null;
    if (Date.now() - Date.parse(value.updatedAt) > 15e3) return null;
    return value;
  } catch {
    return null;
  }
}
function localStatus() {
  const home = process.env.DSH_HOME ?? null;
  const profile = home ? join(home, "profiles", process.env.DSH_PX_PROFILE ?? "web") : null;
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
    if (!profile) throw new Error("\u672A\u63D0\u4F9B DSH_HOME");
    const pkg = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
    for (const [name2, requested] of Object.entries(pkg.dependencies ?? {})) {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name2)) continue;
      let version = null;
      try {
        version = JSON.parse(readFileSync(join(profile, "node_modules", name2, "package.json"), "utf8")).version ?? null;
      } catch {
      }
      plugins.push({ name: name2, requested: String(requested), version, enabled: pkg.dsh?.profile?.bundles?.includes(name2) === true });
    }
    readdirSync(profile);
  } catch (err) {
    profileError = err instanceof Error ? err.message : String(err);
  }
  const service = readServiceState();
  let network = null;
  try {
    const state = JSON.parse(readFileSync(join(process.env.DSH_PX_USER_DATA ?? "", "network-state.json"), "utf8"));
    if (process.env.DSH_PX_USER_DATA && typeof state.message === "string" && typeof state.source === "string" && Number.isFinite(Date.parse(state.checkedAt))) {
      network = { source: state.source, message: state.message, checkedAt: state.checkedAt, protocols: Array.isArray(state.protocols) ? state.protocols : [] };
    }
  } catch {
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
    service,
    canRestart: service?.phase === "running",
    network
  };
}

// packages/dsh-px-workbench/src/network.ts
var targets = ["https://nodejs.org/api/test.html", "https://www.typescriptlang.org/docs/"];
function explanation(error) {
  const code = error?.code;
  if (code === "WEB_BLOCKED_URL") return "\u516C\u5F00\u9875\u9762\u7684\u5730\u5740\u88AB\u7F51\u7EDC\u7B56\u7565\u62D2\u7EDD\u3002\u8BF7\u68C0\u67E5\u4EE3\u7406\u6765\u6E90\uFF1B\u4E0D\u8981\u5173\u95ED\u5730\u5740\u4FDD\u62A4\u3002";
  if (code === "WEB_ABORTED" || code === "WEB_FETCH_TIMEOUT" || error?.name === "TimeoutError") return "\u8BFB\u53D6\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u672C\u673A\u4EE3\u7406\u662F\u5426\u8FD0\u884C\u3002";
  if (code?.startsWith("WEB_PROVIDER")) return "\u7F51\u9875\u8BFB\u53D6\u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u8BF7\u68C0\u67E5\u5F53\u524D DSH \u7EC4\u5408\u3002";
  return "\u7F51\u9875\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u4EE3\u7406\u8FDE\u63A5\u4E0E\u670D\u52A1\u65E5\u5FD7\u3002";
}
async function checkWebAccess(fetchPage) {
  return { checkedAt: (/* @__PURE__ */ new Date()).toISOString(), checks: await Promise.all(targets.map(async (url) => {
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
  })) };
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
  ctx.inject(["webServer", "web"], (host) => {
    const web = host.web;
    if (!host.webServer || !web) return;
    let pending = null;
    host.effect?.(() => host.webServer.register({ kind: "exact", path: `${DEFAULTS.routePrefix}/network-check`, handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "\u8BF7\u4F7F\u7528 POST" });
      if (req.headers?.["x-dsh-px-request"] !== "1") return json(res, 403, { error: "\u8BF7\u4ECE\u672C\u673A\u5DE5\u4F5C\u53F0\u63D0\u4EA4\u8BF7\u6C42" });
      if (new URL(req.url ?? "/", "http://127.0.0.1").search) return json(res, 400, { error: "\u7F51\u7EDC\u68C0\u67E5\u4EC5\u4F7F\u7528\u56FA\u5B9A\u7684\u516C\u5F00\u6587\u6863\u5730\u5740" });
      pending ??= checkWebAccess((request, signal) => web.fetch(request, signal)).finally(() => {
        pending = null;
      });
      json(res, 200, await pending);
    } }), "dsh-px-workbench: network check");
  });
  ctx.inject(["webServer", "workspaceController"], (ctx2) => {
    if (!ctx2.webServer) return;
    const dispose = [
      ctx2.webServer.register({ kind: "exact", path: `${DEFAULTS.routePrefix}/status`, handler: (req, res) => {
        if (req.method !== "GET") return json(res, 405, { error: "\u8BF7\u4F7F\u7528 GET" });
        json(res, 200, localStatus());
      } }),
      ctx2.webServer.register({ kind: "exact", path: `${DEFAULTS.routePrefix}/restart`, handler: (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "\u8BF7\u4F7F\u7528 POST" });
        if (req.headers?.["x-dsh-px-request"] !== "1") return json(res, 403, { error: "\u8BF7\u4ECE\u672C\u673A\u5DE5\u4F5C\u53F0\u63D0\u4EA4\u8BF7\u6C42" });
        if (!localStatus().canRestart) return json(res, 409, { error: "\u684C\u9762\u670D\u52A1\u672A\u5C31\u7EEA\u6216\u6B63\u5728\u91CD\u542F\uFF0C\u8BF7\u5728\u684C\u9762\u7A97\u53E3\u91CD\u8BD5\u3002" });
        try {
          const dir = join2(process.env.DSH_PX_USER_DATA, "update-bridge");
          mkdirSync(dir, { recursive: true });
          const dest = join2(dir, "restart.req");
          writeFileSync(dest + ".tmp", (/* @__PURE__ */ new Date()).toISOString());
          renameSync(dest + ".tmp", dest);
          json(res, 202, { message: "\u5DF2\u63D0\u4EA4\u91CD\u542F\u8BF7\u6C42\uFF1B\u684C\u9762\u7A97\u53E3\u5C06\u91CD\u65B0\u8FDE\u63A5\u3002" });
        } catch {
          json(res, 503, { error: "\u65E0\u6CD5\u63D0\u4EA4\u91CD\u542F\u8BF7\u6C42\uFF0C\u8BF7\u901A\u8FC7\u684C\u9762\u6258\u76D8\u91CD\u8BD5\u3002" });
        }
      } }),
      ctx2.webServer.register({ kind: "exact", path: `${DEFAULTS.routePrefix}/workspace`, handler: async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "\u8BF7\u4F7F\u7528 POST" });
        if (req.headers?.["x-dsh-px-request"] !== "1") return json(res, 403, { error: "\u8BF7\u4ECE\u672C\u673A\u5DE5\u4F5C\u53F0\u63D0\u4EA4\u8BF7\u6C42" });
        const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
        const path = params.get("path")?.trim();
        if (!path || path.length > 4096 || params.getAll("path").length !== 1 || !isAbsolute(path)) {
          return json(res, 400, { error: "\u8BF7\u8F93\u5165\u5DF2\u5B58\u5728\u6587\u4EF6\u5939\u7684\u5B8C\u6574\u8DEF\u5F84\uFF0C\u4F8B\u5982 C:\\Projects\\demo" });
        }
        const controller = ctx2.workspaceController;
        if (!controller) return json(res, 503, { error: "DSH \u5DE5\u4F5C\u533A\u670D\u52A1\u672A\u5C31\u7EEA" });
        try {
          const value = await controller.create({ path });
          json(res, 200, { message: value.created ? "\u5DE5\u4F5C\u533A\u5DF2\u6DFB\u52A0\u3002\u5173\u95ED\u8BBE\u7F6E\u540E\u53EF\u5728\u9009\u62E9\u5DE5\u4F5C\u533A\u83DC\u5355\u4E2D\u5F00\u59CB\u4F1A\u8BDD\u3002" : "\u6B64\u5DE5\u4F5C\u533A\u5DF2\u5B58\u5728\u3002\u5173\u95ED\u8BBE\u7F6E\u540E\u53EF\u9009\u62E9\u5B83\u5E76\u5F00\u59CB\u4F1A\u8BDD\u3002" });
        } catch (err) {
          json(res, 400, { error: `\u65E0\u6CD5\u6DFB\u52A0\u5DE5\u4F5C\u533A\uFF0C\u8BF7\u786E\u8BA4\u6587\u4EF6\u5939\u5B58\u5728\u5E76\u53EF\u8BBF\u95EE\uFF1A${err instanceof Error ? err.message : String(err)}` });
        }
      } })
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
