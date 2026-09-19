/**
 * 把客户端半边 `src/client.tsx` 构建成 dsh 客户端插件约定的 `lib/client.js`。
 *
 * ## 产物形态（与官方客户端插件一致）
 *
 * ```js
 * window.__ModuleLoader__.load({
 *   id: '<包名>',
 *   factory: (require) => { var module = {exports:{}}, exports = module.exports; ...; return module.exports }
 * })
 * ```
 *
 * 宿主（`@deepseek-ai/dsh-client-modules`）扫描 Loader 条目里声明 `dsh.client`
 * 的包，读取 `exports["./client"]` 指向的文件，经 `/plugins/??…` 组合路由送到
 * 浏览器；浏览器里先执行本文件**只是注册工厂**，真正的模块体在首次 import 时才
 * 物化（所以 CSS 之类副作用要留在工厂闭包内 —— 官方文档明确要求）。
 *
 * ## 为什么用 `--format=cjs` 再包一层
 *
 * 我们需要的正是"把 import 变成 require"：`react` / `react/jsx-runtime` 必须由宿主
 * 提供（前端静态模块表里有），自带一份会打破 React 的模块单例。esbuild 在
 * `--format=cjs` 下会把 `import { useState } from 'react'` 编译成
 * `require('react')`，而 `--external:` 保证它不被内联 —— 正好落在宿主的
 * `require` 参数上。用 `--format=esm` 反而会留下裸 `import`，浏览器无法解析。
 *
 * 构建**不引入任何依赖**：只用仓库已装的 esbuild，不需要 react/slots 的运行时或
 * 类型（类型由 `src/host-modules.d.ts` 的最小声明面提供）。
 *
 * ## 为什么构建期校验产物
 *
 * `lib/client.js` 是交付物，一旦形态错了，症状是"设置页没有这一项"或
 * 前端静默报 `did not export ...`，都很难定位。所以在写完文件后立刻做结构性校验，
 * 让错误在构建期就炸出来，而不是留到用户机器上。
 *
 * 用法：`node scripts/build-client.mjs`
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const ENTRY = join(PKG, 'src', 'client.tsx')
const OUT = join(PKG, 'lib', 'client.js')

const pkgJson = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
const id = pkgJson.name
const clientRel = typeof pkgJson.exports?.['./client'] === 'string'
  ? pkgJson.exports['./client']
  : pkgJson.exports?.['./client']?.default

if (typeof clientRel !== 'string') {
  throw new Error('package.json 缺少 exports["./client"] 字符串，宿主将无法定位客户端产物')
}

// 交给宿主静态模块表解析的模块。**不要**加进这里不存在于静态表的名字 ——
// 那会在浏览器里抛 "requested external ... before the module system existed"。
const HOST_PROVIDED = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
  '@deepseek-ai/dsh-client-locale'
]

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  // 自动 JSX 运行时：产出 require('react/jsx-runtime')。
  jsx: 'automatic',
  external: HOST_PROVIDED,
  legalComments: 'none',
  logLevel: 'warning'
})

const body = result.outputFiles[0].text

// 与官方产物同样的包裹形态。刻意保持可读（不做 minify）：客户端插件是排查前端
// 问题时唯一能看的源码，压掉得不偿失。
const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(id)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body.split('\n').map((line) => (line ? '\t\t' + line : line)).join('\n')}
\t\treturn module.exports;
\t}
});
`

writeFileSync(OUT, wrapped, 'utf8')

// ── 结构性校验：不只是匹配字符串，而是**真的执行一遍工厂** ──────────────────
//
// 为什么值得这么做：`lib/client.js` 是交付物，形态错了的症状是"设置页没有这一项"
// 或前端静默报 `did not export ...`，都很难定位。用字符串匹配又太脆 ——
// esbuild 用 `__export` 辅助函数定义导出，产物里并不出现字面 `exports.apply =`。
// 真正执行工厂（require 用桩函数）能同时验证：包裹形态、导出面、
// 以及"工厂是惰性的、不 require 宿主模块就能物化"。
const problems = []
if (!wrapped.includes('window.__ModuleLoader__.load(')) problems.push('缺少 __ModuleLoader__.load 包裹')
if (/^\s*import\s/m.test(body)) problems.push('产物里残留裸 import（浏览器无法解析）')
if (wrapped.includes('function useState(') || wrapped.includes('var React =')) {
  problems.push('疑似把 react 内联进了产物（自带 React 会打破宿主单例）')
}

let exportsFace = null
let requiredHostModules = []
try {
  let registration = null
  const sandboxWindow = {
    __ModuleLoader__: { load: (r) => { registration = r } }
  }
  // 只把 window 注入作用域；不提供 fetch/process 等，确保工厂在 Node 侧也能物化。
  const factoryOf = new Function('window', `${wrapped}; return window.__ModuleLoader__;`)
  factoryOf(sandboxWindow)
  if (registration === null) throw new Error('注册未被调用')
  if (registration.id !== id) throw new Error(`模块 id 为 ${registration.id}，应为 ${id}`)
  if (typeof registration.factory !== 'function') throw new Error('注册里没有 factory 函数')
  // require 的桩：记录宿主模块请求，并返回空对象命名空间。
  const stubRequire = (spec) => { requiredHostModules.push(spec); return {} }
  exportsFace = registration.factory(stubRequire)
  if (exportsFace === null || typeof exportsFace !== 'object') throw new Error('工厂未返回模块对象')
  if (typeof exportsFace.apply !== 'function') throw new Error('导出面缺少 apply 函数')
  if (!Array.isArray(exportsFace.inject)) throw new Error('导出面缺少 inject 数组')
  // 顶层 require 是**正常且必需**的：官方客户端插件同样如此。工厂只在首次 import
  // 时被物化，那时模块图（含我们的 dsh.client.inject 依赖）已经就绪。
  // 这里只确认请求的宿主模块都在前端的静态模块表里 —— 表外的名字会在浏览器里
  // 抛 "requested external ... before the module system existed"。
  const unknown = requiredHostModules.filter((s) => !HOST_PROVIDED.includes(s))
  if (unknown.length > 0) {
    throw new Error(`请求了静态模块表里没有的宿主模块：${unknown.join(', ')}（会被浏览器拒绝）`)
  }
} catch (err) {
  problems.push(`执行工厂失败：${err instanceof Error ? err.message : String(err)}`)
}

if (problems.length > 0) {
  console.error('构建产物校验失败：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

const bytes = Buffer.byteLength(wrapped)
console.log(`已写出 ${clientRel}（${bytes} 字节，${wrapped.split('\n').length} 行）`)
console.log(`  导出面：apply=函数 inject=[${exportsFace.inject.join(', ')}]`)
console.log(`  宿主模块：${requiredHostModules.join(', ') || '(无)'}`)
