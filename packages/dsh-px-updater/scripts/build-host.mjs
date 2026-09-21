/**
 * 把插件宿主半边 `src/index.ts` 构建成交付物 `lib/index.js`。
 *
 * ## 为什么要构建，而不是直接交付 TS
 *
 * 交付形态必须与 dsh 官方随附插件一致：**可直接 import 的纯 ESM JavaScript**，
 * 用户机不需要任何构建步骤。写作形态用 TypeScript，才能在改动时得到类型检查
 * —— 客户端半边（`src/client.tsx` → `lib/client.js`）走的是同一套模式。
 *
 * ## 依赖策略
 * semver 在构建期内联；交付物只保留 node: 内置模块引用，
 * 因而 link:/file: 安装不需要解析第三方运行时依赖。
 *
 * ## 为什么构建期校验产物
 *
 * `lib/index.js` 是交付物，形态错了的症状是插件树**整体启动失败**
 * （`Cannot find package`），或者插件静默缺席，都很难定位。
 * 因此在写文件后立刻做结构性校验，并用**真的 import 一次**来验证导出面。
 *
 * 用法：`node scripts/build-host.mjs`
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = process.argv[2] ? resolve(process.argv[2]) : join(HERE, '..')
const pkgName = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).name
const ENTRY = join(PKG, 'src', 'index.ts')
const OUT = join(PKG, 'lib', 'index.js')

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // semver 内联到交付物；产物依然只能引用 node: 内置模块。
  banner: { js: `/*! Bundled semver (ISC)\n${readFileSync(join(PKG, '..', '..', 'node_modules', 'semver', 'LICENSE'), 'utf8')}\n*/` },
  legalComments: 'none',
  logLevel: 'warning'
})

const code = result.outputFiles[0].text
writeFileSync(OUT, code, 'utf8')

// ── 结构性校验 ───────────────────────────────────────────────────────────────
const problems = []

// 1) 产物里只允许 import node: 内置模块。
const importSpecifiers = [...code.matchAll(/(?:^|\n)\s*import\s[^'"\n]*['"]([^'"]+)['"]/g)].map((m) => m[1])
const badImports = importSpecifiers.filter((s) => !s.startsWith('node:'))
if (badImports.length > 0) {
  problems.push(`产物里出现了非 node: 的 import：${badImports.join(', ')}（用户机上会 ERR_MODULE_NOT_FOUND）`)
}

// 2) 真的 import 一次，验证导出面。
let exportsFace = null
try {
  const mod = await import(pathToFileURL(OUT).href)
  exportsFace = mod
  if (typeof mod.apply !== 'function') problems.push('未导出 apply 函数')
  if (!Array.isArray(mod.inject)) problems.push('未导出 inject 数组')
  if (mod.name !== pkgName) problems.push(`name 应为 ${pkgName}，实际为 ${String(mod.name)}`)
  if (typeof mod.DEFAULTS !== 'object' || mod.DEFAULTS === null) problems.push('未导出 DEFAULTS 对象')
  else if (typeof mod.DEFAULTS.routePrefix !== 'string') problems.push('DEFAULTS.routePrefix 缺失')
} catch (err) {
  problems.push(`导入产物失败：${err instanceof Error ? err.message : String(err)}`)
}

if (problems.length > 0) {
  console.error('构建产物校验失败：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

console.log(`已写出 lib/index.js（${String(Buffer.byteLength(code))} 字节，${String(code.split('\n').length)} 行）`)
console.log(`  导出：name=${String(exportsFace.name)} apply=函数 inject=[${exportsFace.inject.join(', ')}]`)
console.log(`  import：${importSpecifiers.length > 0 ? importSpecifiers.join(', ') : '(无)'}`)
