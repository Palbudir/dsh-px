globalThis.__DSH_REPO__ = "C:\\Palbudir\\dsh-px";

// scripts/prune-seed-home.ts
import { existsSync as existsSync2, readdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join as join2 } from "node:path";

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

// scripts/prune-seed-home.ts
var REPO = repoRoot();
var RUNTIME = join2(REPO, "runtime");
var HOME = join2(RUNTIME, "dsh-home");
var PROFILE = process.env.DSH_PX_PROFILE ?? "web";
var log = (m) => {
  process.stdout.write(`[prune] ${m}
`);
};
if (!existsSync2(HOME)) {
  log(`\u6CA1\u6709\u79CD\u5B50 home\uFF08${HOME}\uFF09\uFF0C\u65E0\u9700\u6E05\u7406`);
  process.exit(0);
}
function dirSize(p) {
  let total = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join2(dir, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try {
          total += statSync(full).size;
        } catch {
        }
      }
    }
  };
  try {
    if (statSync(p).isDirectory()) walk(p);
  } catch {
  }
  return total;
}
function rmTree(target) {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    spawnSync(
      process.platform === "win32" ? "cmd" : "sh",
      process.platform === "win32" ? ["/c", "attrib", "-R", join2(target, "*"), "/S", "/D"] : ["-c", `chmod -R u+w '${target}'`],
      { stdio: "ignore" }
    );
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  }
}
var TARGETS = [
  ["profiles/node_modules", join2(HOME, "profiles", "node_modules")],
  ["profiles/<name>/.dsh-module-fallback", join2(HOME, "profiles", PROFILE, ".dsh-module-fallback")],
  ["profiles/<name>/.dsh-market", join2(HOME, "profiles", PROFILE, ".dsh-market")],
  ["storages", join2(HOME, "storages")],
  ["sessions", join2(HOME, "sessions")],
  [".credentials.yaml", join2(HOME, ".credentials.yaml")],
  ["settings.yaml", join2(HOME, "settings.yaml")]
];
var freed = 0;
for (const [label, path] of TARGETS) {
  if (!existsSync2(path)) continue;
  const before = dirSize(path) || statSync(path).size;
  rmTree(path);
  freed += before;
  log(`\u5DF2\u6E05\u7406 ${label}\uFF08${(before / 1048576).toFixed(1)} MB\uFF09`);
}
var remaining = dirSize(HOME);
log(freed > 0 ? `\u5171\u7626\u8EAB ${(freed / 1048576).toFixed(1)} MB` : "\u6CA1\u6709\u9700\u8981\u6E05\u7406\u7684\u5185\u5BB9");
var mapFreed = 0;
var mapCount = 0;
var testsDirs = [];
var trim = (dir, depth) => {
  if (depth > 24) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join2(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (depth === 0 && e.isDirectory() && e.name === "node") continue;
    if (e.isDirectory()) {
      if (e.name === "tests" || e.name === "test") {
        const sz = dirSize(full);
        rmTree(full);
        mapFreed += sz;
        testsDirs.push(full);
        continue;
      }
      trim(full, depth + 1);
      continue;
    }
    if (e.name.endsWith(".map")) {
      try {
        const sz = statSync(full).size;
        rmSync(full, { force: true, maxRetries: 2 });
        mapFreed += sz;
        mapCount += 1;
      } catch {
      }
    }
  }
};
log("\u88C1\u526A *.map \u4E0E tests/ \u2026");
trim(RUNTIME, 0);
log(`\u5DF2\u5220\u9664 ${String(mapCount)} \u4E2A *.map\u3001${String(testsDirs.length)} \u4E2A\u6D4B\u8BD5\u76EE\u5F55\uFF08\u5171 ${(mapFreed / 1048576).toFixed(1)} MB\uFF09`);
freed += mapFreed;
var afterTrim = dirSize(HOME);
log(`\u79CD\u5B50 home \u73B0\u5728 ${(afterTrim / 1048576).toFixed(1)} MB`);
if (afterTrim > 500 * 1048576) {
  process.stderr.write(
    `[prune] \u8B66\u544A\uFF1A\u79CD\u5B50 home \u4ECD\u6709 ${(afterTrim / 1048576).toFixed(0)} MB\uFF0C\u8D85\u51FA\u9884\u671F\uFF08\u5E72\u51C0\u65F6\u5E94\u7EA6 300 MB\uFF09\u3002\u53EF\u80FD\u6709\u65B0\u7684 dsh \u751F\u6210\u7269\u6CA1\u88AB\u8BC6\u522B\uFF0C\u8BF7\u68C0\u67E5\u3002
`
  );
}
