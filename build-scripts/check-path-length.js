globalThis.__DSH_REPO__ = "C:\\Palbudir\\dsh-px";

// scripts/check-path-length.ts
import { readdirSync, statSync } from "node:fs";
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

// scripts/check-path-length.ts
var REPO = repoRoot();
var RUNTIME = join2(REPO, "runtime");
var MAX_PATH = 260;
var longest = { rel: "", len: 0 };
var over = 0;
var scanned = 0;
function walk(dir, rel) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const childRel = rel ? `${rel}\\${e.name}` : e.name;
    scanned += 1;
    if (childRel.length > longest.len) longest = { rel: childRel, len: childRel.length };
    if (e.isDirectory()) walk(join2(dir, e.name), childRel);
    else {
      if (childRel.length > MAX_PATH) over += 1;
    }
  }
}
try {
  if (!statSync(RUNTIME).isDirectory()) throw new Error("not a dir");
} catch {
  console.error(`[paths] \u627E\u4E0D\u5230 runtime/\uFF1A${RUNTIME}
  \u8BF7\u5148\u8FD0\u884C npm run stage`);
  process.exit(1);
}
console.log("[paths] \u6B63\u5728\u626B\u63CF runtime/\uFF08\u7EA6 30 \u4E07\u4E2A\u6761\u76EE\uFF0C\u7A0D\u5019\uFF09\u2026");
walk(RUNTIME, "");
console.log(`
\u626B\u63CF\u6761\u76EE\uFF1A${scanned}`);
console.log(`\u6700\u957F\u76F8\u5BF9\u8DEF\u5F84\uFF1A${longest.len} \u5B57\u7B26`);
console.log(`  ${longest.rel}`);
console.log(`\u8D85\u8FC7 ${MAX_PATH} \u7684\u6587\u4EF6\u6570\uFF1A${over}`);
console.log(`runtime/ \u76F8\u5BF9\u524D\u7F00\uFF1A${"runtime\\".length} \u5B57\u7B26\uFF08\u5F53\u524D\u6240\u5728\u4F4D\u7F6E\u4E0D\u8BA1\u5165\u5B89\u88C5\u8DEF\u5F84\uFF09`);
var wrap = "\\resources\\runtime\\".length;
var budget = MAX_PATH - longest.len - wrap;
console.log("\n\u7ED3\u8BBA\uFF1A");
console.log(`  \u5B89\u88C5\u540E\u8DEF\u5F84 = <\u5B89\u88C5\u76EE\u5F55> + "\\resources\\runtime\\" + <\u76F8\u5BF9\u8DEF\u5F84>`);
console.log(`  \u8981\u8BA9\u6700\u957F\u8DEF\u5F84\u4E0D\u8D85\u8FC7 ${MAX_PATH}\uFF0C\u5B89\u88C5\u76EE\u5F55\u672C\u8EAB\u4E0D\u80FD\u8D85\u8FC7 ${budget} \u5B57\u7B26\u3002`);
console.log(`  \u4F8B\uFF1AC:\\Users\\Administrator\\AppData\\Local\\Programs\\dsh-px \u957F\u5EA6\u7EA6 ${"C:\\Users\\Administrator\\AppData\\Local\\Programs\\dsh-px".length} \u5B57\u7B26`);
if (over > 0) {
  console.log(
    `
\u8B66\u544A\uFF1A\u6709 ${over} \u4E2A\u6587\u4EF6\u7684\u76F8\u5BF9\u8DEF\u5F84\u672C\u8EAB\u5DF2\u8D85\u8FC7 ${MAX_PATH} \u5B57\u7B26\u3002
  \u8FD9\u610F\u5473\u7740\u65E0\u8BBA\u88C5\u5230\u54EA\u91CC\uFF0C\u8FD9\u4E9B\u6587\u4EF6\u90FD\u65E0\u6CD5\u5728\u4E0D\u542F\u7528\u957F\u8DEF\u5F84\u652F\u6301\u7684\u60C5\u51B5\u4E0B\u88AB\u6B63\u5E38\u5904\u7406\u3002
  \u5E94\u5BF9\uFF1A\u5728\u6253\u5305\u65F6\u88C1\u526A\u8FD9\u7C7B\u6DF1\u5C42\u5F00\u53D1\u7528\u6587\u4EF6\uFF08\u5982 *.d.ts / *.js.map / tests\uFF09\uFF0C
  \u6216\u8981\u6C42\u7528\u6237\u542F\u7528 Windows \u957F\u8DEF\u5F84\u652F\u6301\u3002`
  );
} else {
  console.log("\n\u672A\u53D1\u73B0\u76F8\u5BF9\u8DEF\u5F84\u8D85\u9650\u7684\u6587\u4EF6\uFF1B\u98CE\u9669\u4EC5\u53D6\u51B3\u4E8E\u7528\u6237\u9009\u62E9\u7684\u5B89\u88C5\u76EE\u5F55\u957F\u5EA6\u3002");
}
