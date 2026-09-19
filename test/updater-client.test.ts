/**
 * `dsh-px-updater` 客户端半边（`lib/client.js`）的产物校验。
 *
 * 为什么需要它：客户端半边是**交付物**，但它的形态错误在开发机上都很难发现 ——
 *
 *   - 忘了包 `window.__ModuleLoader__.load(...)` → 前端整条组合脚本解析失败
 *   - 模块 id 与包名不一致 → 宿主按包名索引不到，设置页静默没有这一项
 *   - 导出面缺 `apply` / `inject` → 前端报 "did not export the bootstrap module face"
 *   - 把 react 内联进产物 → 打破宿主 React 的模块单例，hooks 报错（最难查）
 *   - 残留裸 `import` → 浏览器无法解析
 *
 * 这些都必须**在构建期**炸掉，而不是留到用户机器上。因此本测试既静态检查形态，
 * 也真的在一个沙箱里执行产物工厂，验证导出面与宿主模块请求。
 *
 * 跑法：`npm run test`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..', 'packages', 'dsh-px-updater')
const CLIENT = join(PKG, 'lib', 'client.js')

/** 前端静态模块表提供的模块（实测自 dsh-web-frontend 的 staticModules）。 */
const HOST_PROVIDED = new Set([
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
])

test('客户端半边：产物存在且形态正确', () => {
  assert.ok(existsSync(CLIENT), `缺少产物 ${CLIENT}；请先运行 npm run build:client`)
  const src = readFileSync(CLIENT, 'utf8')

  assert.ok(src.includes('window.__ModuleLoader__.load('), '缺少 __ModuleLoader__.load 包裹')
  assert.ok(src.includes('"dsh-px-updater"') || src.includes("'dsh-px-updater'"), '模块 id 应为包名')
  assert.ok(!/^\s*import\s/m.test(src), '产物里不应残留裸 import（浏览器无法解析）')
  assert.ok(!src.includes('function useState('), '不应把 react 内联进产物（会打破宿主 React 单例）')
  assert.ok(src.includes('react/jsx-runtime'), 'JSX 运行时应由宿主提供（留成 require）')
})

test('客户端半边：工厂可物化，导出 apply/inject，宿主模块请求都在静态表内', () => {
  const src = readFileSync(CLIENT, 'utf8')

  let registration: { id: string, factory: (req: (s: string) => unknown) => Record<string, unknown> } | null = null
  const sandboxWindow = { __ModuleLoader__: { load: (r: never) => { registration = r } } }
  // 只注入 window；不提供 fetch/process 等，确保工厂不依赖 Node 或浏览器全局。
  const run = new Function('window', `${src}; return window.__ModuleLoader__;`)
  run(sandboxWindow)

  assert.ok(registration !== null, '产物没有调用 __ModuleLoader__.load')
  const reg = registration as unknown as { id: string, factory: (req: (s: string) => unknown) => Record<string, unknown> }
  assert.equal(reg.id, 'dsh-px-updater', '模块 id 必须与包名一致，宿主按它索引')
  assert.equal(typeof reg.factory, 'function', '注册里缺少 factory')

  const requested: string[] = []
  const exportsFace = reg.factory((spec: string) => { requested.push(spec); return {} })

  assert.equal(typeof exportsFace.apply, 'function', '导出面必须提供 apply')
  assert.ok(Array.isArray(exportsFace.inject), '导出面必须提供 inject 数组')
  assert.deepEqual(exportsFace.inject, ['slots', 'locale'], 'inject 应声明用到的客户端服务')

  // 请求了静态表外的模块会在浏览器里被拒绝，且症状是整页启动失败，代价很大。
  const unknown = requested.filter((s) => !HOST_PROVIDED.has(s))
  assert.deepEqual(unknown, [], `请求了静态模块表里没有的宿主模块：${unknown.join(', ')}`)
})

test('客户端半边：package.json 的 dsh.client 声明完整', () => {
  const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
  const decl = pkg.dsh?.client
  assert.ok(decl !== undefined, '缺少 dsh.client 声明，宿主不会扫描到客户端半边')
  assert.equal(decl.platform, 'web', 'dsh.client.platform 必须是 web')

  // exports["./client"] 是宿主定位产物的唯一依据。
  const clientExport = pkg.exports?.['./client']
  const rel = typeof clientExport === 'string' ? clientExport : clientExport?.default
  assert.equal(typeof rel, 'string', 'exports["./client"] 必须是字符串或含 default 的对象')
  assert.ok(existsSync(join(PKG, rel)), `exports["./client"] 指向的文件不存在：${rel}`)

  // inject 决定前端模块图顺序，也必须含 ctx.slots 的来源。
  assert.ok(Array.isArray(decl.inject), 'dsh.client.inject 应为数组')
  assert.ok(decl.inject.includes('@deepseek-ai/dsh-client-ui-slots'), 'inject 应包含 slots 提供方')
  assert.ok(decl.inject.includes('@deepseek-ai/dsh-client-ui-settings'), 'inject 应包含设置页提供方')
})
