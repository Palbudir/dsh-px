globalThis.__DSH_REPO__ = "C:\\Palbudir\\dsh-px";

// scripts/check-entry-artifacts.ts
import { existsSync as existsSync2, statSync } from "node:fs";
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

// scripts/check-entry-artifacts.ts
var REPO = repoRoot();
var REQUIRED = [
  ["out/main/index.js", "Electron \u4E3B\u8FDB\u7A0B\uFF08package.json \u7684 main \u6307\u5411\u5B83\uFF09"],
  ["out/renderer/index.html", "\u9996\u542F/\u91CD\u542F\u8FDB\u5EA6\u9875\uFF08\u4E3B\u8FDB\u7A0B\u7528 loadFile \u52A0\u8F7D\u5B83\uFF09"],
  ["out/preload/index.mjs", "\u8FDB\u5EA6\u9875 preload"],
  [join2("packages", "dsh-px-updater", "lib", "index.js"), "\u81EA\u7814\u63D2\u4EF6\u7684\u5BBF\u4E3B\u534A\u8FB9"],
  [join2("packages", "dsh-px-updater", "lib", "client.js"), "\u81EA\u7814\u63D2\u4EF6\u7684\u5BA2\u6237\u7AEF\u534A\u8FB9\uFF08\u8BBE\u7F6E\u9875\u5206\u533A\uFF09"]
];
var failed = false;
for (const [rel, why] of REQUIRED) {
  const abs = join2(REPO, rel);
  if (!existsSync2(abs)) {
    process.stderr.write(`\u7F3A\u5C11\u6784\u5EFA\u4EA7\u7269 ${rel}\uFF08${why}\uFF09
`);
    failed = true;
    continue;
  }
  const size = statSync(abs).size;
  if (size === 0) {
    process.stderr.write(`\u6784\u5EFA\u4EA7\u7269 ${rel} \u662F\u7A7A\u6587\u4EF6\uFF08${why}\uFF09
`);
    failed = true;
    continue;
  }
  process.stdout.write(`OK  ${rel}  ${size} \u5B57\u8282  \u2014\u2014 ${why}
`);
}
if (failed) {
  process.stderr.write(
    '\n\u8FD9\u4E9B\u4E0D\u662F\u5165\u5E93\u6587\u4EF6\uFF0C\u5FC5\u987B\u5148\u5728\u6253\u5305\u524D\u6784\u5EFA\uFF1A\n  npm run build        # = build:client + build:main\n\n\u6CE8\u610F electron-builder **\u53EA\u6253\u5305\u3001\u4E0D\u6784\u5EFA**\uFF1A\u76F4\u63A5\u8C03\u5B83\u4F1A\u5728 asar \u5065\u5168\u6027\u68C0\u67E5\u91CC\n\u62A5 "Application entry file ... is corrupted"\uFF0C\u90A3\u4E2A\u63AA\u8F9E\u4F1A\u628A\u4EBA\u5F80\u9519\u8BEF\u65B9\u5411\u5E26\u3002\n'
  );
  process.exit(1);
}
process.stdout.write("\n\u5165\u53E3\u4EA7\u7269\u9F50\u5907\uFF0C\u53EF\u4EE5\u6253\u5305\u3002\n");
