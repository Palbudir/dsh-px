globalThis.__DSH_REPO__ = "C:\\Palbudir\\dsh-px";

// scripts/verify-capabilities.ts
import { execFileSync, spawn } from "node:child_process";
import { existsSync as existsSync2, readFileSync, readdirSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";

// scripts/paths.ts
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function repoRoot() {
  const injected = globalThis.__DSH_REPO__;
  if (typeof injected === "string" && injected.length > 0) return injected;
  const fromEnv = process.env.DSH_PX_REPO;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return resolve(fromEnv);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(fileURLToPath(import.meta.url));
}

// scripts/verify-capabilities.ts
function errText(err) {
  return err instanceof Error ? err.stack ?? err.message : String(err);
}
var REPO = repoRoot();
var RUNTIME = join2(REPO, "runtime");
var PROFILE = process.env.DSH_PX_PROFILE ?? "web";
var BOOT = process.argv.includes("--boot");
var AS_JSON = process.argv.includes("--json");
var results = [];
var record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  if (!AS_JSON) process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` \u2014\u2014 ${detail}` : ""}
`);
};
function parseRows(yaml) {
  const rows = [];
  let current = null;
  for (const raw of yaml.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*#\s*==/.test(line)) continue;
    const idMatch = line.match(/^-\s+id:\s*(\S+)\s*$/);
    if (idMatch) {
      if (current) rows.push(current);
      current = { id: idMatch[1], name: null };
      continue;
    }
    const nameMatch = line.match(/^\s+name:\s*'?([^'\s]+)'?\s*$/);
    if (nameMatch && current && current.name === null) current.name = nameMatch[1];
  }
  if (current) rows.push(current);
  return rows;
}
function dump(nodeExe, dshEntry, home) {
  const out = execFileSync(nodeExe, [dshEntry, "--profile", PROFILE, "--dump-config"], {
    encoding: "utf8",
    env: { ...process.env, DSH_HOME: home },
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return parseRows(out);
}
function officialBaseline() {
  if (process.argv.includes("--baseline=manifest")) {
    const forced = join2(REPO, "build", "baseline", "dsh-package.json");
    return existsSync2(forced) ? { kind: "manifest", file: forced } : null;
  }
  const fromNpmInstall = join2(RUNTIME, "_dsh-install", "node_modules", "@deepseek-ai", "dsh");
  if (existsSync2(join2(fromNpmInstall, "lib", "bin.js"))) return { kind: "install", dir: fromNpmInstall };
  try {
    const root = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], {
      encoding: "utf8",
      shell: process.platform === "win32"
    }).trim();
    const dir = join2(root, "@deepseek-ai", "dsh");
    if (existsSync2(join2(dir, "lib", "bin.js"))) return { kind: "install", dir };
  } catch {
  }
  const manifest = join2(REPO, "build", "baseline", "dsh-package.json");
  if (existsSync2(manifest)) return { kind: "manifest", file: manifest };
  return null;
}
async function bootProbe(nodeExe, dshEntry, home) {
  const port = 34e3 + Math.floor(Math.random() * 1e3);
  const child = spawn(nodeExe, [
    dshEntry,
    "--profile",
    PROFILE,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--no-open"
  ], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  child.stdout.on("data", (c) => {
    log += c;
  });
  child.stderr.on("data", (c) => {
    log += c;
  });
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 15e4;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`\u63D0\u524D\u9000\u51FA\uFF08${child.exitCode}\uFF09
${log.slice(-2e3)}`);
      try {
        const res = await fetch(url, { redirect: "manual" });
        return { ok: true, status: res.status, url, log };
      } catch {
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`150 \u79D2\u5185\u672A\u5C31\u7EEA
${log.slice(-2e3)}`);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}
async function main() {
  const nodeExe = process.platform === "win32" ? join2(RUNTIME, "node", "node.exe") : join2(RUNTIME, "node", "bin", "node");
  const dshEntry = join2(RUNTIME, "dsh", "lib", "bin.js");
  const home = join2(RUNTIME, "dsh-home");
  const profileDir = join2(home, "profiles", PROFILE);
  record("\u88C5\u914D\u7684 Node \u8FD0\u884C\u65F6\u5B58\u5728", existsSync2(nodeExe), nodeExe.replace(REPO, "."));
  record("\u88C5\u914D\u7684 dsh \u5B89\u88C5\u5B58\u5728", existsSync2(dshEntry), dshEntry.replace(REPO, "."));
  record("\u79CD\u5B50 profile \u5B58\u5728", existsSync2(join2(profileDir, "package.json")), profileDir.replace(REPO, "."));
  if (!existsSync2(nodeExe) || !existsSync2(dshEntry)) return finish();
  const runtimeManifest = join2(RUNTIME, "runtime-manifest.json");
  if (existsSync2(runtimeManifest)) {
    const m = JSON.parse(readFileSync(runtimeManifest, "utf8"));
    record("\u8FD0\u884C\u65F6 manifest \u5B58\u5728", true, `dsh ${m.dsh?.version} / node ${m.node?.version}`);
  }
  if (!existsSync2(join2(profileDir, "package.json"))) return finish();
  const profileManifest = JSON.parse(readFileSync(join2(profileDir, "package.json"), "utf8"));
  const bundles = profileManifest?.dsh?.profile?.bundles ?? [];
  for (const required of ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]) {
    record(`profile \u58F0\u660E\u4E86 ${required}`, bundles.includes(required), `bundles=${bundles.join(", ")}`);
  }
  const baseline = officialBaseline();
  if (!baseline) {
    record("\u5B98\u65B9 dsh \u57FA\u7EBF\u53EF\u7528", false, "\u65E2\u6CA1\u6709\u5168\u5C40 dsh\uFF0C\u4E5F\u6CA1\u6709 build/baseline/dsh-package.json\uFF1B\u672A\u5EA6\u91CF\u80FD\u529B\u5E73\u4EF7");
  } else {
    let stagedRows;
    try {
      stagedRows = dump(nodeExe, dshEntry, home);
    } catch (err) {
      record("\u88C5\u914D\u7248 --dump-config \u6210\u529F", false, errText(err).slice(0, 400));
    }
    if (stagedRows) {
      record("\u88C5\u914D\u7248\u80FD\u7EC4\u5408\u51FA\u63D2\u4EF6\u6811", stagedRows.length > 100, `${stagedRows.length} \u884C`);
      let missing = [];
      let extra = [];
      let baselineLabel = "";
      if (baseline.kind === "install") {
        baselineLabel = "\u5B98\u65B9\u5B89\u88C5\uFF08\u7EC4\u5408\u6811\u9010\u884C\u5BF9\u6BD4\uFF09";
        const officialHome = process.env.DSH_HOME ?? join2(process.env.USERPROFILE ?? process.env.HOME ?? "", ".dsh");
        try {
          const officialRows = dump(nodeExe, join2(baseline.dir ?? "", "lib", "bin.js"), officialHome);
          const key = (r) => `${r.id}|${r.name}`;
          const stagedSet = new Set(stagedRows.map(key));
          const officialKeys = new Set(officialRows.map(key));
          missing = officialRows.filter((r) => !stagedSet.has(key(r)));
          extra = stagedRows.filter((r) => !officialKeys.has(key(r)));
        } catch (err) {
          record("\u5B98\u65B9\u7248 --dump-config \u6210\u529F", false, errText(err).slice(0, 400));
        }
      } else {
        baselineLabel = "\u5B98\u65B9 manifest\uFF08\u4F9D\u8D56\u5B8C\u6574\u6027\u5BF9\u6BD4\uFF09";
        const manifest = JSON.parse(readFileSync(baseline.file ?? "", "utf8"));
        const deps = Object.keys(manifest.dependencies ?? {});
        const installed = /* @__PURE__ */ new Set();
        const scanScope = (base, prefix) => {
          if (!existsSync2(base)) return;
          for (const entry of readdirSync(base, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (entry.name.startsWith("@")) {
              scanScope(join2(base, entry.name), entry.name + "/");
              continue;
            }
            installed.add(prefix + entry.name);
          }
        };
        const stagedDshDir = dirname2(dirname2(dshEntry));
        const stagedModules = join2(stagedDshDir, "node_modules");
        scanScope(join2(stagedModules, "@deepseek-ai"), "@deepseek-ai/");
        scanScope(stagedModules, "");
        missing = deps.filter((d) => !installed.has(d)).map((d) => ({ id: d, name: d }));
        extra = [];
      }
      if (missing) {
        record(
          `\u80FD\u529B\u5E73\u4EF7\uFF1A\u5B98\u65B9\u7684\u4E1C\u897F\u4E00\u6837\u90FD\u4E0D\u7F3A\uFF08\u57FA\u7EBF\uFF1A${baselineLabel}\uFF09`,
          missing.length === 0,
          missing.length ? `\u7F3A\u5931 ${missing.length} \u9879\uFF1A${missing.slice(0, 10).map((r) => r.id ?? r.name).join("\u3001")}` : "\u5B8C\u5168\u4E00\u81F4\u6216\u4E3A\u5176\u8D85\u96C6"
        );
        if (extra.length) {
          record(
            "\u88C5\u914D\u7248\u662F\u8D85\u96C6\uFF08\u968F\u9644\u63D2\u4EF6\u5E26\u6765\u4E86\u989D\u5916\u884C\uFF09",
            true,
            `+${extra.length}\uFF1A${extra.slice(0, 10).map((r) => r.id).join("\u3001")}`
          );
        }
      }
    }
  }
  if (BOOT) {
    try {
      const probe = await bootProbe(nodeExe, dshEntry, home);
      record("\u88C5\u914D\u7684 harness \u80FD\u542F\u52A8\u4E14 HTTP \u6709\u5E94\u7B54", true, `${probe.url} -> HTTP ${probe.status}`);
    } catch (err) {
      record("\u88C5\u914D\u7684 harness \u80FD\u542F\u52A8\u4E14 HTTP \u6709\u5E94\u7B54", false, errText(err).slice(0, 600));
    }
  }
  return finish();
}
function finish() {
  const failed = results.filter((r) => !r.ok);
  if (AS_JSON) {
    process.stdout.write(JSON.stringify({ ok: failed.length === 0, results }, null, 2) + "\n");
  } else {
    process.stdout.write(`
${results.length - failed.length}/${results.length} \u9879\u68C0\u67E5\u901A\u8FC7
`);
    if (failed.length) process.stdout.write(`beta \u672A\u8FBE\u6807\uFF1A${failed.map((r) => r.name).join("\uFF1B")}
`);
  }
  process.exitCode = failed.length ? 1 : 0;
}
await main();
