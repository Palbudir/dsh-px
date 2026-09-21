// packages/dsh-px-updater/src/index.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var name = "dsh-px-updater";
var inject = [];
var DEFAULTS = {
  repository: "Palbudir/dsh-px",
  timeoutMs: 8e3,
  registerTool: true,
  routePrefix: "/dsh-px-updater"
};
function resourcesPath() {
  const v = process.resourcesPath;
  return typeof v === "string" && v.length > 0 ? v : null;
}
function readAppInfo() {
  const empty = { appVersion: null, dshVersion: null, platform: null, manifestPath: null };
  const candidates = [];
  if (process.env.DSH_PX_RUNTIME_ROOT) candidates.push(process.env.DSH_PX_RUNTIME_ROOT);
  const res = resourcesPath();
  if (res !== null) candidates.push(join(res, "runtime"));
  let here = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    candidates.push(here);
    const parent = dirname(here);
    if (parent === here) break;
    here = parent;
  }
  for (const root of candidates) {
    const manifestPath = join(root, "runtime-manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf8"));
      return {
        // 应用版本来自装配时写入的 manifest —— 这是唯一可靠的来源。
        // 不用 `app.getVersion()`（那是外壳的事，且开发态会返回 Electron 版本）。
        appVersion: m.app?.version ?? null,
        dshVersion: m.dsh?.version ?? null,
        platform: m.platform ?? null,
        manifestPath
      };
    } catch {
    }
  }
  return empty;
}
function shellUserData() {
  const fromEnv = process.env.DSH_PX_USER_DATA;
  return typeof fromEnv === "string" && fromEnv.length > 0 ? fromEnv : null;
}
function readShellState() {
  const dir = shellUserData();
  if (dir === null) return null;
  try {
    const raw = readFileSync(join(dir, "update-bridge", "state.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return { ...parsed, available: true };
  } catch {
    return null;
  }
}
function requestShellAction(action) {
  const dir = shellUserData();
  if (dir === null) return false;
  try {
    const bridgeDir = join(dir, "update-bridge");
    mkdirSync(bridgeDir, { recursive: true });
    writeFileSync(join(bridgeDir, `${action}.req`), `${(/* @__PURE__ */ new Date()).toISOString()}
`);
    return true;
  } catch {
    return false;
  }
}
async function fetchJson(url, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { accept: "application/json", "user-agent": "dsh-px-updater" }
    });
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
function parseVersion(v) {
  if (typeof v !== "string" || v.length === 0) return null;
  const m = v.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}
async function checkUpdates(config) {
  const info = readAppInfo();
  const result = {
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    current: {
      app: info.appVersion ?? "\u672A\u77E5",
      dsh: info.dshVersion ?? "\u672A\u77E5",
      platform: info.platform ?? process.platform
    },
    latest: { app: null, dsh: null },
    updateAvailable: { app: false, dsh: false },
    releaseUrl: null,
    releaseNotes: null,
    errors: []
  };
  try {
    const rel = await fetchJson(`https://api.github.com/repos/${config.repository}/releases/latest`, config.timeoutMs);
    result.latest.app = typeof rel.tag_name === "string" ? rel.tag_name : null;
    result.releaseUrl = typeof rel.html_url === "string" ? rel.html_url : null;
    result.releaseNotes = typeof rel.body === "string" ? rel.body : null;
    result.updateAvailable.app = isNewer(rel.tag_name ?? null, info.appVersion);
  } catch (err) {
    result.errors.push(`\u67E5\u8BE2 GitHub Releases \u5931\u8D25\uFF1A${errText(err)}`);
  }
  try {
    const pkg = await fetchJson("https://registry.npmjs.org/@deepseek-ai%2Fdsh", config.timeoutMs);
    const distTags = pkg["dist-tags"];
    const latest = distTags?.latest ?? null;
    result.latest.dsh = latest;
    result.updateAvailable.dsh = isNewer(latest, info.dshVersion);
  } catch (err) {
    result.errors.push(`\u67E5\u8BE2 npm \u4E0A\u7684 dsh \u7248\u672C\u5931\u8D25\uFF1A${errText(err)}`);
  }
  return result;
}
function errText(err) {
  return err instanceof Error ? err.message : String(err);
}
function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...rawConfig ?? {} };
  const info = readAppInfo();
  const say = (msg) => {
    try {
      const sink = ctx.logger?.info ?? ctx.logger?.debug ?? console.log;
      sink.call(ctx.logger ?? console, `[dsh-px-updater] ${msg}`);
    } catch {
    }
  };
  say(`\u5DF2\u52A0\u8F7D\uFF08dsh ${info.dshVersion ?? "\u672A\u77E5"}\uFF0C${info.platform ?? process.platform}\uFF09`);
  ctx.inject(["webServer"], (hostCtx) => {
    const webServer = hostCtx.webServer;
    if (webServer?.register === void 0) {
      say("webServer \u5DF2\u6CE8\u5165\u4F46\u6CA1\u6709 register \u65B9\u6CD5\uFF0C\u8DF3\u8FC7 HTTP \u7AEF\u70B9");
      return;
    }
    const sendJson = (res, code, body) => {
      res.writeHead(code, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify(body, null, 2));
    };
    const disposeStatus = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/status`,
      handler: (_req, res) => {
        sendJson(res, 200, {
          plugin: name,
          version: "0.1.0",
          current: { app: info.appVersion, dsh: info.dshVersion, platform: info.platform },
          manifestPath: info.manifestPath,
          repository: config.repository
        });
      }
    });
    const disposeCheck = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/check`,
      handler: async (_req, res) => {
        const outcome = await checkUpdates(config);
        const bothFailed = outcome.errors.length >= 2;
        sendJson(res, bothFailed ? 502 : 200, outcome);
      }
    });
    const disposeShellState = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/shell-state`,
      handler: (_req, res) => {
        const bridge = readShellState();
        sendJson(res, 200, bridge ?? {
          phase: "idle",
          status: "\u5916\u58F3\u672A\u63D0\u4F9B\u66F4\u65B0\u72B6\u6001\uFF08\u5F00\u53D1\u6001\u6B63\u5E38\uFF09",
          version: null,
          percent: null,
          error: null,
          available: false
        });
      }
    });
    const disposeInstall = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/install`,
      handler: (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "\u53EA\u63A5\u53D7 POST" });
          return;
        }
        const ok = requestShellAction("install");
        sendJson(res, ok ? 202 : 503, ok ? { ok: true, message: "\u5DF2\u8BF7\u6C42\u5916\u58F3\u91CD\u542F\u5E76\u5B89\u88C5" } : { ok: false, error: "\u627E\u4E0D\u5230\u5916\u58F3\u6570\u636E\u76EE\u5F55\uFF0C\u65E0\u6CD5\u8BF7\u6C42\u5B89\u88C5" });
      }
    });
    const disposeOpen = webServer.register({
      kind: "exact",
      path: `${config.routePrefix}/open`,
      handler: (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "\u53EA\u63A5\u53D7 POST" });
          return;
        }
        const raw = /[?&]what=(open-data|open-log)\b/.exec(req.url ?? "")?.[1];
        if (raw !== "open-data" && raw !== "open-log") {
          sendJson(res, 400, { ok: false, error: "what \u5FC5\u987B\u662F open-data \u6216 open-log" });
          return;
        }
        const ok = requestShellAction(raw);
        sendJson(res, ok ? 202 : 503, ok ? { ok: true, message: `\u5DF2\u8BF7\u6C42\u5916\u58F3\u6253\u5F00${raw === "open-data" ? "\u6570\u636E\u76EE\u5F55" : "\u65E5\u5FD7"}` } : { ok: false, error: "\u627E\u4E0D\u5230\u5916\u58F3\u6570\u636E\u76EE\u5F55" });
      }
    });
    say(`\u5DF2\u6CE8\u518C HTTP \u7AEF\u70B9 ${config.routePrefix}/{status,check,shell-state,install,open}`);
    hostCtx.effect?.(() => () => {
      disposeStatus();
      disposeCheck();
      disposeShellState();
      disposeInstall();
      disposeOpen();
    }, "dsh-px-updater: http routes");
  });
  if (config.registerTool) {
    ctx.inject(["tools"], (toolCtx) => {
      toolCtx.tools?.register({
        name: "dsh_px_version",
        description: "\u67E5\u8BE2\u5F53\u524D DSH-PX \u684C\u9762\u5BA2\u6237\u7AEF\u7684\u7248\u672C\u4FE1\u606F\uFF0C\u5E76\u68C0\u67E5\u662F\u5426\u6709\u65B0\u7248\u672C\u53EF\u7528\uFF08\u540C\u65F6\u68C0\u67E5\u5916\u58F3\u4E0E\u968F\u9644\u7684 dsh \u6838\u5FC3\uFF09\u3002",
        // parameters 必须是**标准 JSON Schema**（ToolSchema.parameters 的类型是
        // Record<string, unknown>，由 assertObjectJsonSchema 校验）。
        //
        // 这里曾写错：用了 `{ checkRemote: { type: 'boolean', required: false } }`
        // 这种"属性表"简写 —— 那是 defineTool 的**输入**格式，不是 ToolSchema。
        // JSON Schema 里 `required` 是**根级字符串数组**，不是属性上的布尔值；
        // 传错会让宿主报
        //   Invalid schema for function 'dsh_px_version': schema must be a JSON Schema
        //   of 'type: "object"', got 'type: "null"'
        // 并导致**整轮对话失败**（不只是本工具不可用），代价很大，故把原因写明。
        //
        // 本插件刻意不 import defineTool：见文件顶部说明 —— 自研插件保持零运行时
        // 依赖，避免 pnpm file:/link: 不装 peer 依赖导致的 ERR_MODULE_NOT_FOUND。
        parameters: {
          type: "object",
          properties: {
            checkRemote: {
              type: "boolean",
              description: "\u662F\u5426\u8054\u7F51\u67E5\u8BE2\u6700\u65B0\u7248\u672C\u3002\u4F20 false \u65F6\u53EA\u8FD4\u56DE\u672C\u5730\u7248\u672C\u4FE1\u606F\u3002"
            }
          },
          additionalProperties: false
        },
        output: {
          schema: { type: "string" },
          render: (_args, value) => [{ type: "text", text: value }]
        },
        async execute(args) {
          if (args?.checkRemote === false) {
            return `\u672C\u5730\u7248\u672C\uFF1Adsh ${info.dshVersion ?? "\u672A\u77E5"}\uFF08${info.platform ?? process.platform}\uFF09`;
          }
          const r = await checkUpdates(config);
          const lines = [
            `\u5F53\u524D\uFF1Adsh \u6838\u5FC3 ${r.current.dsh}`,
            `\u6700\u65B0\uFF1A\u5916\u58F3 ${r.latest.app ?? "\u672A\u77E5"}\uFF0Cdsh ${r.latest.dsh ?? "\u672A\u77E5"}`,
            `\u53EF\u66F4\u65B0\uFF1A\u5916\u58F3 ${r.updateAvailable.app ? "\u662F" : "\u5426"}\uFF0Cdsh \u6838\u5FC3 ${r.updateAvailable.dsh ? "\u662F" : "\u5426"}`
          ];
          if (r.releaseUrl !== null) lines.push(`\u53D1\u5E03\u9875\uFF1A${r.releaseUrl}`);
          if (r.errors.length > 0) lines.push(`\u6CE8\u610F\uFF1A${r.errors.join("\uFF1B")}`);
          return lines.join("\n");
        }
      });
    });
  }
}
export {
  DEFAULTS,
  apply,
  inject,
  name
};
