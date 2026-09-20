globalThis.__DSH_REPO__ = "C:\\Palbudir\\dsh-px";

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
if (import.meta.url.endsWith("/unzip-list.js") && (process.argv[2] ?? "").length > 0) {
  const target = process.argv[2];
  if (!existsSync(target)) {
    console.error(`\u627E\u4E0D\u5230\u6587\u4EF6\uFF1A${target}`);
    process.exit(1);
  }
  const names = listZipEntries(target);
  console.log(`\u6761\u76EE\u6570\uFF1A${names.length}`);
  console.log("\u524D 10 \u6761\uFF1A");
  for (const n of names.slice(0, 10)) console.log("  ", n);
  const res = names.filter((n) => n.toLowerCase().startsWith("resources/"));
  console.log(`resources/ \u4E0B\u6761\u76EE\uFF1A${res.length}`);
}
export {
  listZipEntries
};
