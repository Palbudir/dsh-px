globalThis.__DSH_REPO__ = "C:\\Palbudir\\dsh-px";

// scripts/stage-runtime.ts
import { execFileSync, spawnSync } from "node:child_process";
import { createWriteStream, existsSync as existsSync2, mkdirSync, readdirSync, rmSync, statSync, cpSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { join as join2, resolve as resolve2, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

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

// scripts/stage-runtime.ts
var REPO = repoRoot();
var OUT = join2(REPO, "runtime");
var DSH_VERSION = process.env.DSH_PX_DSH_VERSION ?? "0.1.5-rc.2";
var NODE_VERSION = process.env.DSH_PX_NODE_VERSION ?? "24.16.0";
var PROFILE = process.env.DSH_PX_PROFILE ?? "web";
var DEFAULT_PLUGINS = [
  "dshmarket",
  "dsh-better-sidebar",
  "dsh-mermaid-render",
  "dsh-find-plugin",
  "file:packages/dsh-px-updater"
];
var LOCAL_PLUGIN_NAMES = ["dsh-px-updater"];
var USE_LINK_FOR_LOCAL = true;
var args = new Set(process.argv.slice(2));
var log = (msg) => process.stdout.write(`[stage] ${msg}
`);
function run(cmd, cmdArgs, opts = {}) {
  log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (res.status !== 0) throw new Error(`${cmd} exited with ${res.status}`);
  return res;
}
function shim(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}
function copyTree(src, dest, { skip = SKIP_IN_PROFILE_TREE, skipEntry = null } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const from = join2(src, entry.name);
    if (skipEntry && skipEntry(entry, from)) continue;
    const to = join2(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to, { skip, skipEntry });
    } else {
      cpSync(from, to, { recursive: true, dereference: true, force: true });
    }
  }
}
var SKIP_IN_PROFILE_TREE = /* @__PURE__ */ new Set(["@deepseek-ai"]);
function makeDshFallbackFilter(dshDir) {
  if (!dshDir) return () => false;
  const prefix = (join2(dshDir, "node_modules") + sep).toLowerCase();
  return (entry, fullPath) => {
    if (entry.name.startsWith(".dsh-")) return true;
    if (!entry.isSymbolicLink()) return false;
    let target;
    try {
      target = realpathSync(fullPath);
    } catch {
      return true;
    }
    return (target + sep).toLowerCase().startsWith(prefix);
  };
}
function rmTree(target) {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    const res = spawnSync(
      process.platform === "win32" ? "cmd" : "sh",
      process.platform === "win32" ? ["/c", "attrib", "-R", join2(target, "*"), "/S", "/D"] : ["-c", `chmod -R u+w '${target}'`],
      { stdio: "ignore" }
    );
    void res;
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  }
}
function resolvePnpm() {
  if (process.env.DSH_PX_PNPM) return { cmd: process.env.DSH_PX_PNPM, pre: [] };
  const probe = spawnSync(shim("pnpm"), ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (probe.status === 0) return { cmd: shim("pnpm"), pre: [] };
  log(`PATH \u4E0A\u6CA1\u6709\u53EF\u7528\u7684 pnpm\uFF0C\u56DE\u9000\u5230 npx pnpm@${PNPM_VERSION}`);
  return { cmd: shim("npx"), pre: ["--yes", `pnpm@${PNPM_VERSION}`] };
}
var PNPM_VERSION = process.env.DSH_PX_PNPM_VERSION ?? "10";
function findGlobalDsh() {
  const root = execFileSync(shim("npm"), ["root", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32"
  }).trim();
  const candidate = join2(root, "@deepseek-ai", "dsh");
  if (existsSync2(join2(candidate, "lib", "bin.js"))) return candidate;
  return null;
}
function installDshFromNpm() {
  const prefix = join2(OUT, "_dsh-install");
  const dshDir = join2(prefix, "node_modules", "@deepseek-ai", "dsh");
  if (existsSync2(join2(dshDir, "lib", "bin.js"))) {
    log(`\u5DF2\u4ECE npm \u5B89\u88C5 dsh ${DSH_VERSION}\uFF1A${dshDir}`);
    return dshDir;
  }
  log(`\u6B63\u5728\u4ECE npm \u5B89\u88C5 dsh@${DSH_VERSION}\uFF08\u5E72\u51C0\u673A\u5668/CI \u7684\u8DEF\u5F84\uFF09`);
  mkdirSync(prefix, { recursive: true });
  run(shim("npm"), [
    "install",
    "--prefix",
    prefix,
    "--no-audit",
    "--no-fund",
    "--loglevel",
    "error",
    `@deepseek-ai/dsh@${DSH_VERSION}`
  ], { cwd: prefix });
  if (!existsSync2(join2(dshDir, "lib", "bin.js"))) {
    throw new Error(`npm \u5B89\u88C5\u540E\u4ECD\u627E\u4E0D\u5230 ${join2(dshDir, "lib", "bin.js")}`);
  }
  log(`\u5DF2\u4ECE npm \u5B89\u88C5 dsh -> ${dshDir}`);
  return dshDir;
}
async function downloadNode() {
  const dir = join2(OUT, "node");
  const exe = process.platform === "win32" ? join2(dir, "node.exe") : join2(dir, "bin", "node");
  if (existsSync2(exe)) {
    log(`Node \u5DF2\u88C5\u914D\uFF1A${exe}`);
    return exe;
  }
  mkdirSync(dir, { recursive: true });
  const platform = { win32: "win", darwin: "darwin", linux: "linux" }[process.platform];
  if (!platform) throw new Error(`\u4E0D\u652F\u6301\u7684\u5E73\u53F0 ${process.platform}`);
  const arch = { x64: "x64", arm64: "arm64" }[process.arch];
  if (!arch) throw new Error(`\u4E0D\u652F\u6301\u7684\u67B6\u6784 ${process.arch}`);
  const ext = process.platform === "win32" ? "zip" : "tar.gz";
  const base = `node-v${NODE_VERSION}-${platform}-${arch}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${base}.${ext}`;
  const archive = join2(OUT, `${base}.${ext}`);
  log(`\u6B63\u5728\u4E0B\u8F7D ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`\u4E0B\u8F7D\u5931\u8D25\uFF1AHTTP ${res.status}`);
  if (res.body === null) throw new Error("\u5F52\u6863\u54CD\u5E94\u6CA1\u6709 body");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));
  log(`\u6B63\u5728\u89E3\u538B ${base}`);
  if (ext === "zip") {
    const tar = spawnSync("tar", ["-xf", archive, "-C", OUT], { stdio: "inherit" });
    if (tar.status !== 0) {
      run("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${OUT}' -Force`
      ]);
    }
  } else {
    run("tar", ["-xzf", archive, "-C", OUT]);
  }
  const extracted = join2(OUT, base);
  if (!existsSync2(extracted)) throw new Error(`\u89E3\u538B\u540E\u672C\u5E94\u5B58\u5728 ${extracted}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(extracted, dir, { recursive: true, dereference: true });
  rmSync(extracted, { recursive: true, force: true });
  rmSync(archive, { force: true });
  if (!existsSync2(exe)) throw new Error(`\u88C5\u914D\u540E\u7F3A\u5C11 node \u4E8C\u8FDB\u5236\uFF1A${exe}`);
  log(`\u5DF2\u88C5\u914D node -> ${exe}`);
  return exe;
}
function stageDsh() {
  const dest = join2(OUT, "dsh");
  if (existsSync2(join2(dest, "lib", "bin.js"))) {
    log(`dsh \u5DF2\u88C5\u914D\uFF1A${dest}`);
    return dest;
  }
  const globalSrc = findGlobalDsh();
  if (globalSrc) {
    log(`\u6B63\u5728\u4ECE ${globalSrc} \u590D\u5236 dsh ${DSH_VERSION}\uFF08\u81EA\u5305\u542B\uFF0C\u53EF\u80FD\u9700\u8981\u4E00\u5206\u949F\uFF09`);
    mkdirSync(OUT, { recursive: true });
    cpSync(globalSrc, dest, { recursive: true, dereference: true });
    log(`\u5DF2\u88C5\u914D dsh -> ${dest}`);
    return dest;
  }
  const src = installDshFromNpm();
  const prefixModules = join2(OUT, "_dsh-install", "node_modules");
  log("\u6B63\u5728\u7EC4\u88C5\u81EA\u5305\u542B\u7684 dsh \u76EE\u5F55\uFF08\u63D0\u5347\u5B89\u88C5 -> \u5D4C\u5957\u5E03\u5C40\uFF09");
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, dereference: true });
  copyTree(prefixModules, join2(dest, "node_modules"), { skip: /* @__PURE__ */ new Set(), skipEntry: null });
  const baselineDir = join2(REPO, "build", "baseline");
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(join2(baselineDir, "dsh-package.json"), readFileSync(join2(src, "package.json")));
  log(`\u5DF2\u7559\u5B58\u5B98\u65B9 dsh manifest \u4F5C\u4E3A\u80FD\u529B\u5E73\u4EF7\u57FA\u7EBF\uFF08build/baseline/dsh-package.json\uFF09`);
  rmTree(join2(OUT, "_dsh-install"));
  log("\u5DF2\u6E05\u7406 _dsh-install\uFF08\u6784\u5EFA\u4E2D\u95F4\u4EA7\u7269\uFF0C\u4E0D\u8FDB\u4EA4\u4ED8\u7269\uFF09");
  log(`\u5DF2\u88C5\u914D dsh -> ${dest}`);
  return dest;
}
function stageHome(nodeExe, dshDir, { withPlugins, fromExisting }) {
  const home = join2(OUT, "dsh-home");
  const profileDir = join2(home, "profiles", PROFILE);
  const dshEntry = join2(dshDir, "lib", "bin.js");
  const env = { ...process.env, DSH_HOME: home };
  const installedBundles = (dir) => {
    const names = [];
    const scan = (base, prefix) => {
      if (!existsSync2(base)) return;
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name.startsWith("@")) {
          scan(join2(base, entry.name), entry.name + "/");
          continue;
        }
        const full = prefix + entry.name;
        if (full.startsWith("@deepseek-ai/")) continue;
        try {
          const manifest = JSON.parse(readFileSync(join2(base, entry.name, "package.json"), "utf8"));
          if (manifest?.dsh?.bundle?.patch) names.push(full);
        } catch {
        }
      }
    };
    scan(dir, "");
    return [...new Set(names)].sort();
  };
  const buildFresh = () => {
    mkdirSync(profileDir, { recursive: true });
    if (!withPlugins) {
      log("\u6B63\u5728\u4ECE\u968F\u9644\u6A21\u677F\u521D\u59CB\u5316 profile\uFF08\u4E0D\u542B\u63D2\u4EF6\uFF09");
      writeFileSync(join2(profileDir, "package.json"), JSON.stringify({
        name: `dsh-profile-${PROFILE}`,
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], patchReload: "live" } }
      }, null, 2) + "\n");
    } else {
      log(`\u6B63\u5728\u5B89\u88C5\u63D2\u4EF6\uFF1A${DEFAULT_PLUGINS.join("\u3001")}`);
      const deps = Object.fromEntries(DEFAULT_PLUGINS.map((p) => {
        if (p.startsWith("file:")) {
          const rel = p.slice("file:".length);
          const abs = resolve2(REPO, rel);
          return [LOCAL_PLUGIN_NAMES[0], `${USE_LINK_FOR_LOCAL ? "link" : "file"}:${abs}`];
        }
        return [p, "latest"];
      }));
      writeFileSync(join2(profileDir, "package.json"), JSON.stringify({
        name: `dsh-profile-${PROFILE}`,
        private: true,
        dependencies: deps,
        dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], patchReload: "live" } }
      }, null, 2) + "\n");
      writeFileSync(
        join2(profileDir, "pnpm-workspace.yaml"),
        "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n# pnpm >= 10 \u4F1A\u62E6\u622A\u4F9D\u8D56\u7684\u6784\u5EFA\u811A\u672C\uFF1Bnode-pty \u9700\u8981\u5B83\u7684 conpty postinstall\uFF0C\n# \u5426\u5219\u4FA7\u680F\u7EC8\u7AEF\u4F1A\u5728\u8FD0\u884C\u65F6\u9759\u9ED8\u5931\u8D25\u3002\nallowBuilds:\n  node-pty: true\n"
      );
      const pnpm = resolvePnpm();
      run(pnpm.cmd, [...pnpm.pre, "install"], { cwd: profileDir, env });
      run(pnpm.cmd, [...pnpm.pre, "rebuild", "node-pty"], { cwd: profileDir, env });
      const pkgPath = join2(profileDir, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const found = installedBundles(join2(profileDir, "node_modules"));
      pkg.dsh.profile.bundles = [.../* @__PURE__ */ new Set([...pkg.dsh.profile.bundles, ...found])];
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      log(`bundles \u5DF2\u534F\u8C03\uFF1A${pkg.dsh.profile.bundles.join("\u3001")}`);
    }
    writeFileSync(
      join2(profileDir, "cordis.patch.yml"),
      "# dsh-px profile \u8865\u4E01\u5C42\uFF1B\u5728\u6BCF\u4E2A\u7EC4\u5408\u5305\u5C42\u4E4B\u540E\u5E94\u7528\u3002\n[]\n"
    );
    writeFileSync(
      join2(profileDir, "cordis.yml"),
      "# dsh profile \u6839 \u2014\u2014 \u4E00\u4E2A\u7A7A\u7684\u6761\u76EE\u5217\u8868\u3002\u6574\u68F5\u6811\u662F\u7531\u8865\u4E01\u7EC4\u5408\u51FA\u6765\u7684\u3002\n[]\n"
    );
    if (!existsSync2(join2(profileDir, "pnpm-workspace.yaml"))) {
      writeFileSync(
        join2(profileDir, "pnpm-workspace.yaml"),
        "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n"
      );
    }
    if (!existsSync2(join2(profileDir, "package.json"))) {
      throw new Error(`profile \u672A\u80FD\u5728 ${profileDir} \u521D\u59CB\u5316`);
    }
  };
  if (fromExisting) {
    const srcHome = process.env.DSH_PX_SOURCE_HOME ?? process.env.DSH_HOME ?? join2(process.env.USERPROFILE ?? process.env.HOME ?? "", ".dsh");
    if (!existsSync2(join2(srcHome, "profiles", PROFILE, "package.json"))) {
      throw new Error(`--from-existing\uFF1A${join2(srcHome, "profiles", PROFILE)} \u4E0B\u6CA1\u6709 profile`);
    }
    if (!existsSync2(join2(profileDir, "package.json"))) {
      log(`\u6B63\u5728\u4ECE ${srcHome} \u590D\u5236\u53EF\u7528\u7684 profile\uFF08\u5FEB\u8DEF\u5F84\uFF09`);
      log("  \u6392\u9664 @deepseek-ai/* \u2014\u2014 \u90A3\u68F5\u6811\u7531 dsh \u81EA\u5DF1\u7BA1\u7406\uFF0C\u4E14\u968F\u9644\u7684 dsh \u5DF2\u7ECF\u63D0\u4F9B\u5B83");
      mkdirSync(join2(home, "profiles"), { recursive: true });
      for (const f of ["package.json", "cordis.patch.yml", "cordis.yml", "pnpm-workspace.yaml"]) {
        const from = join2(srcHome, "profiles", PROFILE, f);
        if (existsSync2(from)) cpSync(from, join2(profileDir, f), { force: true });
      }
      const isDshFallback = makeDshFallbackFilter(dshDir ?? null);
      const srcWebModules = join2(srcHome, "profiles", PROFILE, "node_modules");
      if (existsSync2(srcWebModules)) {
        copyTree(srcWebModules, join2(profileDir, "node_modules"), { skipEntry: isDshFallback });
      }
      const strayTop = join2(home, "profiles", "node_modules");
      if (existsSync2(strayTop)) {
        rmTree(strayTop);
        log("\u5DF2\u79FB\u9664\u9876\u5C42 profiles/node_modules\uFF08dsh \u6258\u7BA1\u7684 fallback \u6811\uFF0C\u4F1A\u81EA\u884C\u91CD\u5EFA\uFF09");
      }
    } else {
      log(`\u79CD\u5B50 home \u5DF2\u586B\u5145\uFF0C\u4FDD\u7559\u73B0\u72B6\uFF1A${profileDir}`);
    }
    const strayProxy = join2(home, "profiles", "node_modules", "@deepseek-ai");
    if (existsSync2(strayProxy)) {
      rmTree(strayProxy);
      log("\u5DF2\u4ECE\u79CD\u5B50 home \u79FB\u9664\u6B8B\u7559\u7684 @deepseek-ai fallback \u6811\uFF08dsh \u4F1A\u81EA\u884C\u91CD\u5EFA\uFF09");
    }
  } else if (existsSync2(join2(profileDir, "package.json"))) {
    log(`\u79CD\u5B50 home \u5DF2\u586B\u5145\uFF1A${profileDir}`);
  } else {
    mkdirSync(home, { recursive: true });
    buildFresh();
  }
  return home;
}
async function main() {
  log(`\u4ED3\u5E93=${REPO}`);
  log(`\u76EE\u6807 runtime=${OUT}`);
  rmSync(join2(OUT, "dsh-home", ".dsh-px-seeded"), { force: true });
  const nodeExe = await downloadNode();
  const dshDir = stageDsh();
  const home = stageHome(nodeExe, dshDir, {
    withPlugins: args.has("--with-plugins"),
    fromExisting: args.has("--from-existing")
  });
  pruneSeedHome(home);
  const appManifest = JSON.parse(readFileSync(join2(REPO, "package.json"), "utf8"));
  const manifest = {
    stagedAt: (/* @__PURE__ */ new Date()).toISOString(),
    app: { name: appManifest.name, version: appManifest.version },
    platform: process.platform,
    arch: process.arch,
    node: { version: NODE_VERSION, path: nodeExe.replace(REPO, ".") },
    dsh: { version: DSH_VERSION, path: dshDir.replace(REPO, ".") },
    profile: PROFILE,
    plugins: args.has("--with-plugins") ? DEFAULT_PLUGINS : [],
    home: home.replace(REPO, ".")
  };
  writeFileSync(join2(OUT, "runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  log("\u5DF2\u5199\u5165 runtime/runtime-manifest.json");
  log("\u5B8C\u6210\u3002\u4E0B\u4E00\u6B65\uFF1Anpm run verify");
}
function pruneSeedHome(home) {
  const targets = [
    join2(home, "profiles", "node_modules"),
    // dsh 重建的顶层 fallback
    join2(home, "profiles", PROFILE, ".dsh-module-fallback"),
    // profile 内 fallback
    join2(home, "profiles", PROFILE, ".dsh-market"),
    // 市场状态
    join2(home, "storages"),
    // 构建期 KV 落盘
    join2(home, "sessions"),
    // 构建期会话（verify 会写）
    join2(home, ".credentials.yaml"),
    // 绝不外带任何凭据
    join2(home, "settings.yaml")
    // 构建机上的设置
  ];
  let freed = 0;
  for (const t of targets) {
    if (!existsSync2(t)) continue;
    const before = dirSize(t);
    rmTree(t);
    freed += before;
    log(`\u5DF2\u6E05\u7406\u79CD\u5B50\u6811\u4E2D\u7684 ${t.replace(home, "<home>")}\uFF08${(before / 1048576).toFixed(1)} MB\uFF09`);
  }
  if (freed > 0) log(`\u79CD\u5B50\u6811\u5171\u7626\u8EAB ${(freed / 1048576).toFixed(1)} MB`);
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
main().catch((err) => {
  process.stderr.write(`[stage] \u5931\u8D25\uFF1A${err?.stack ?? err}
`);
  process.exit(1);
});
