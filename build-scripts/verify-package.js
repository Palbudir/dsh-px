globalThis.__DSH_REPO__ = "C:\\Palbudir\\dsh-px";

// scripts/verify-package.ts
import { existsSync as existsSync3, mkdirSync, readdirSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { basename, dirname as dirname2, join as join2, resolve as resolve2 } from "node:path";

// scripts/unzip-list.ts
import { readFileSync, existsSync } from "node:fs";
function listZipEntries(zipPath) {
  const buf = readFileSync(zipPath);
  const EOCD_SIG = 101010256;
  const CD_SIG = 33639248;
  const maxBack = Math.min(buf.length, 22 + 65535);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack; i -= 1) {
    if (i < 0) break;
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("\u4E0D\u662F\u6709\u6548\u7684 ZIP\uFF1A\u627E\u4E0D\u5230 EOCD \u8BB0\u5F55");
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === 65535 || cdOffset === 4294967295) {
    throw new Error("\u8BE5 ZIP \u4F7F\u7528\u4E86 ZIP64 \u7ED3\u6784\uFF0C\u672C\u89E3\u6790\u5668\u672A\u652F\u6301\uFF08\u8BF7\u6539\u7528 7-Zip\uFF09");
  }
  if (cdOffset + cdSize > buf.length) throw new Error("ZIP \u4E2D\u592E\u76EE\u5F55\u8D8A\u754C\uFF0C\u6587\u4EF6\u53EF\u80FD\u635F\u574F");
  const names = [];
  let p = cdOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) {
      throw new Error(`\u4E2D\u592E\u76EE\u5F55\u7B2C ${i} \u6761\u8BB0\u5F55\u635F\u574F\uFF08\u504F\u79FB ${p}\uFF09`);
    }
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    names.push(name.replace(/\\/g, "/"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}
if (process.argv[1] && process.argv[1].endsWith("unzip-list.mjs")) {
  const target = process.argv[2];
  if (!target || !existsSync(target)) {
    console.error("\u7528\u6CD5\uFF1Anode scripts/unzip-list.mjs <zip \u8DEF\u5F84>");
    process.exit(1);
  }
  const names = listZipEntries(target);
  console.log(`\u6761\u76EE\u6570\uFF1A${names.length}`);
  console.log("\u524D 10 \u6761\uFF1A");
  for (const n of names.slice(0, 10)) console.log("  ", n);
  const res = names.filter((n) => n.toLowerCase().startsWith("resources/"));
  console.log(`resources/ \u4E0B\u6761\u76EE\uFF1A${res.length}`);
}

// scripts/paths.ts
import { existsSync as existsSync2 } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function repoRoot() {
  const injected = globalThis.__DSH_REPO__;
  if (typeof injected === "string" && injected.length > 0) return injected;
  const fromEnv = process.env.DSH_PX_REPO;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return resolve(fromEnv);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync2(join(dir, "package.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(fileURLToPath(import.meta.url));
}

// scripts/verify-package.ts
function errText(err) {
  return err instanceof Error ? err.stack ?? err.message : String(err);
}
var REPO = repoRoot();
var DIST = join2(REPO, "dist");
var TOOLS = join2(REPO, "build", "tools");
var log = (m) => process.stdout.write(`[pkg] ${m}
`);
var REQUIRED = [
  "resources/app.asar",
  "resources/app-update.yml",
  "resources/runtime/runtime-manifest.json",
  "resources/runtime/node/node.exe",
  "resources/runtime/dsh/lib/bin.js",
  "resources/runtime/dsh-home/profiles/web/package.json"
];
var FORBIDDEN = [
  "resources/runtime/_dsh-install"
];
function ensure7z() {
  if (process.env.DSH_PX_7Z) {
    if (existsSync3(process.env.DSH_PX_7Z)) return process.env.DSH_PX_7Z;
    throw new Error(`DSH_PX_7Z \u6307\u5411\u7684\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${process.env.DSH_PX_7Z}`);
  }
  const vendored = join2(TOOLS, "7zr.exe");
  if (existsSync3(vendored)) return vendored;
  for (const p of ["C:\\Program Files\\7-Zip\\7z.exe", "C:\\Program Files (x86)\\7-Zip\\7z.exe"]) {
    if (existsSync3(p)) return p;
  }
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["7z"], { encoding: "utf8" });
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim().split(/\r?\n/)[0].trim();
  if (process.platform !== "win32") return "7z";
  mkdirSync(TOOLS, { recursive: true });
  log("\u672C\u5730\u6CA1\u6709 7-Zip\uFF0C\u5C1D\u8BD5\u4E0B\u8F7D 7zr.exe\uFF08\u7EA6 600 KB\uFF09");
  try {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Invoke-WebRequest 'https://www.7-zip.org/a/7zr.exe' -OutFile '${vendored}' -UseBasicParsing`
      ],
      { stdio: "inherit" }
    );
  } catch (err) {
    throw new Error(
      `\u65E0\u6CD5\u83B7\u5F97 7-Zip\uFF0C\u56E0\u6B64\u4E0D\u80FD\u6821\u9A8C\u5B89\u88C5\u5305\u5185\u5BB9\u3002
  \u81EA\u52A8\u4E0B\u8F7D\u5931\u8D25\uFF1A${errText(err)}
  \u89E3\u51B3\uFF1A\u5B89\u88C5 7-Zip\uFF08CI \u4E0A\u53EF choco install 7zip -y\uFF09\uFF0C\u6216\u8BBE\u7F6E DSH_PX_7Z \u6307\u5411 7z \u53EF\u6267\u884C\u6587\u4EF6\u3002`
    );
  }
  if (!existsSync3(vendored)) throw new Error("7zr.exe \u4E0B\u8F7D\u540E\u4ECD\u4E0D\u5B58\u5728");
  return vendored;
}
function pickInstaller(argPath) {
  if (argPath) return resolve2(argPath);
  const candidates = readdirSync(DIST).filter((f) => /Setup.*\.exe$/i.test(f)).map((f) => join2(DIST, f));
  if (candidates.length === 0) throw new Error(`dist \u4E0B\u6CA1\u6709\u627E\u5230\u5B89\u88C5\u5305\uFF1A${DIST}`);
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
function main() {
  const installer = pickInstaller(process.argv[2]);
  log(`\u5B89\u88C5\u5305\uFF1A${installer}`);
  log(`\u5927\u5C0F\uFF1A${(statSync(installer).size / 1048576).toFixed(1)} MB`);
  const dir = dirname2(installer);
  const versionMatch = basename(installer).match(/(\d+\.\d+\.\d+)/);
  const version = versionMatch ? versionMatch[1] : null;
  const zips = existsSync3(dir) ? readdirSync(dir).filter((f) => /\.zip$/i.test(f) && (!version || f.includes(version))) : [];
  const foundZip = zips.length ? join2(dir, zips[0]) : null;
  if (foundZip) log(`\u540C\u6E90 ZIP\uFF1A${basename(foundZip)}`);
  if (foundZip) {
    log(`\u6821\u9A8C\u76EE\u6807\uFF1A${foundZip}\uFF08\u4E0E\u5B89\u88C5\u5305\u540C\u6E90\uFF0C\u7EAF JS \u89E3\u6790\uFF09`);
    const names = listZipEntries(foundZip);
    log(`\u89E3\u6790\u5230\u8F7D\u8377\u6761\u76EE\uFF1A${names.length}`);
    if (names.length < 1e3) {
      throw new Error(`ZIP \u53EA\u89E3\u6790\u5230 ${names.length} \u4E2A\u6761\u76EE\uFF0C\u8FDC\u5C11\u4E8E\u9884\u671F\uFF08\u7EA6 4 \u4E07\uFF09\uFF0C\u6587\u4EF6\u53EF\u80FD\u635F\u574F`);
    }
    const normalized = new Set(names.map((p) => p.toLowerCase().replace(/\/+$/, "")));
    return report(normalized, `${names.length} \u6761\uFF08\u6765\u81EA ZIP\uFF09`);
  }
  log("\u672A\u627E\u5230\u540C\u6E90 ZIP\uFF0C\u6539\u7528 7-Zip \u8BFB\u53D6\u5B89\u88C5\u5305");
  const seven = ensure7z();
  const raw = execFileSync(seven, ["l", "-slt", installer], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const paths = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const m = line.match(/^Path = (.+)$/);
    if (!m) continue;
    const p = m[1].trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (!p || !p.includes("/")) continue;
    paths.push(p);
  }
  log(`\u89E3\u6790\u5230\u8F7D\u8377\u6761\u76EE\uFF1A${paths.length}`);
  if (paths.length < 1e3) {
    const sample = raw.split("\n").slice(0, 12).map((l) => "    | " + l.replace(/\r$/, "")).join("\n");
    throw new Error(
      `\u53EA\u89E3\u6790\u5230 ${paths.length} \u4E2A\u8F7D\u8377\u6761\u76EE\uFF0C\u8FDC\u5C11\u4E8E\u9884\u671F\uFF08\u7EA6 4 \u4E07\uFF09\u2014\u2014 \u8FD9\u8BF4\u660E 7-Zip \u6CA1\u80FD\u6309\u9884\u671F\u5217\u51FA\u5B89\u88C5\u5305\u5185\u5BB9\uFF0C\u800C\u4E0D\u662F\u6587\u4EF6\u7F3A\u5931\u3002
  \u4F7F\u7528\u7684 7-Zip\uFF1A${seven}
  \u8F93\u51FA\u5F00\u5934\uFF1A
${sample}`
    );
  }
  return report(new Set(paths.map((p) => p.toLowerCase())), `${paths.length} \u6761\uFF08\u6765\u81EA 7-Zip\uFF09`);
}
function report(normalized, source) {
  const failures = [];
  for (const req of REQUIRED) {
    const hit = [...normalized].some((p) => p === req.toLowerCase() || p.startsWith(req.toLowerCase() + "/"));
    if (hit) log(`PASS  \u542B ${req}`);
    else {
      log(`FAIL  \u7F3A\u5C11 ${req}`);
      failures.push(`\u7F3A\u5C11 ${req}`);
    }
  }
  for (const bad of FORBIDDEN) {
    const hit = [...normalized].some((p) => p === bad.toLowerCase() || p.startsWith(bad.toLowerCase() + "/"));
    if (hit) {
      log(`FAIL  \u542B\u4E0D\u8BE5\u6253\u8FDB\u53BB\u7684\u6784\u5EFA\u4EA7\u7269 ${bad}`);
      failures.push(`\u542B ${bad}`);
    } else log(`PASS  \u4E0D\u542B ${bad}`);
  }
  const runtimePrefix = "resources/runtime/";
  const runtimeEntries = [...normalized].filter((p) => p.startsWith(runtimePrefix));
  const leftoverMaps = runtimeEntries.filter((p) => p.endsWith(".map"));
  const leftoverTests = runtimeEntries.filter((p) => /\/tests?\//.test(p));
  if (leftoverMaps.length > 0) {
    log(`FAIL  \u4EA4\u4ED8\u7269\u91CC\u4ECD\u6709 ${leftoverMaps.length} \u4E2A *.map \u2014\u2014 \u6253\u5305\u524D\u662F\u5426\u6F0F\u8DD1 npm run prune\uFF1F`);
    for (const s of leftoverMaps.slice(0, 3)) log(`       \u4F8B\u5982 ${s}`);
    failures.push(`${leftoverMaps.length} \u4E2A *.map \u672A\u88C1\u526A`);
  } else {
    log("PASS  \u4E0D\u542B *.map\uFF08\u5DF2\u88C1\u526A\uFF09");
  }
  if (leftoverTests.length > 0) {
    log(`FAIL  \u4EA4\u4ED8\u7269\u91CC\u4ECD\u6709 ${leftoverTests.length} \u4E2A tests/ \u6761\u76EE \u2014\u2014 \u6253\u5305\u524D\u662F\u5426\u6F0F\u8DD1 npm run prune\uFF1F`);
    for (const s of leftoverTests.slice(0, 3)) log(`       \u4F8B\u5982 ${s}`);
    failures.push(`${leftoverTests.length} \u4E2A tests/ \u6761\u76EE\u672A\u88C1\u526A`);
  } else {
    log("PASS  \u4E0D\u542B tests/\uFF08\u5DF2\u88C1\u526A\uFF09");
  }
  log(`\u8F7D\u8377\u89C4\u6A21\uFF1A${source}`);
  if (failures.length) {
    process.stderr.write(`
[pkg] \u6821\u9A8C\u5931\u8D25\uFF1A
  - ${failures.join("\n  - ")}
`);
    process.exitCode = 1;
  } else {
    process.stdout.write("\n[pkg] \u4EA4\u4ED8\u7269\u5185\u5BB9\u6821\u9A8C\u901A\u8FC7\n");
  }
}
try {
  main();
} catch (err) {
  process.stderr.write(`[pkg] \u51FA\u9519\uFF1A${errText(err)}
`);
  process.exit(1);
}
