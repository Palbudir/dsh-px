/**
 * `dsh-px-updater` **宿主半边**（`lib/index.js`）的产物校验。
 *
 * 为什么需要它：宿主半边是**入库的预构建产物**，源在 `src/index.ts`。
 * 入库产物最大的风险是**与源码漂移** —— 改了 TS 却忘了重新构建，
 * 而症状是"插件行为不对"，很难想到是产物过期。客户端半边已有同类测试，
 * 这里补齐宿主半边。
 *
 * 另外两条约束必须钉死：
 *   1. **产物里不能有非 node: 的 import。** 插件以 `link:`/`file:` 安装，
 *      pnpm 不装 peerDependencies，任何宿主包 import 都会在用户机上
 *      `ERR_MODULE_NOT_FOUND`，并让**整棵插件树启动失败**。
 *   2. 导出面必须齐（`name` / `inject` / `DEFAULTS` / `apply`）——
 *      dsh 的 loader 按这些名字认插件。
 *
 * 跑法：`npm run test`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..', 'packages', 'dsh-px-updater')
const HOST = join(PKG, 'lib', 'index.js')
const SOURCE = join(PKG, 'src', 'index.ts')

test('插件宿主半边：产物存在、比源码新，且没有非 node: 的 import', () => {
  assert.ok(existsSync(HOST), `缺少产物 ${HOST}；请先运行 npm run build:plugin-host`)
  assert.ok(existsSync(SOURCE), `缺少源码 ${SOURCE}`)

  const src = readFileSync(HOST, 'utf8')

  // 漂移检测：产物必须比源码新。改了 TS 却忘了构建，这里就会失败。
  const srcMtime = statSync(SOURCE).mtimeMs
  const outMtime = statSync(HOST).mtimeMs
  assert.ok(
    outMtime >= srcMtime,
    `产物比源码旧（源码 ${new Date(srcMtime).toISOString()} / 产物 ${new Date(outMtime).toISOString()}）；` +
    '请重新运行 npm run build:plugins'
  )

  // 只允许 node: 内置模块。
  const specifiers = [...src.matchAll(/(?:^|\n)\s*import\s[^'"\n]*['"]([^'"]+)['"]/g)].map((m) => m[1])
  const bad = specifiers.filter((s) => !s.startsWith('node:'))
  assert.deepEqual(
    bad, [],
    `产物里有非 node: 的 import：${bad.join(', ')}。` +
    '自研插件必须零运行时依赖 —— 宿主 import 会在用户机上 ERR_MODULE_NOT_FOUND。'
  )

  // 类型注解不该出现在产物里（说明构建确实做了擦除）。
  assert.ok(!/:\s*(string|number|boolean)\b/.test(src.replace(/['"`][^'"`]*['"`]/g, '')),
    '产物里疑似残留 TypeScript 类型注解，构建可能没生效')
})

test('插件宿主半边：导出面完整（dsh loader 按这些名字认插件）', async () => {
  const mod = await import(pathToFileURL(HOST).href)

  assert.equal(mod.name, 'dsh-px-updater', 'name 必须与包名一致')
  assert.ok(Array.isArray(mod.inject), 'inject 必须是数组（本插件刻意为空：可选增强）')
  assert.deepEqual(mod.inject, [], 'inject 应为空数组：缺 webServer 时插件仍应能加载')

  assert.equal(typeof mod.apply, 'function', 'apply 必须是函数')

  // DEFAULTS 决定路由前缀，客户端半边硬编码了同一个值依赖它。
  assert.equal(typeof mod.DEFAULTS, 'object')
  assert.equal(mod.DEFAULTS.routePrefix, '/dsh-px-updater',
    'routePrefix 必须与客户端半边里的 ROUTE_PREFIX 一致，否则界面调不到端点')
  assert.equal(typeof mod.DEFAULTS.repository, 'string')
  assert.equal(typeof mod.DEFAULTS.timeoutMs, 'number')
  assert.equal(typeof mod.DEFAULTS.registerTool, 'boolean')
})

test('插件：客户端半边与宿主半边的路由前缀保持一致', () => {
  const clientSrc = readFileSync(join(PKG, 'src', 'client.tsx'), 'utf8')
  const host = readFileSync(HOST, 'utf8')

  const hostPrefix = /routePrefix:\s*["']([^"']+)["']/.exec(host)?.[1]
  const clientPrefix = /const ROUTE_PREFIX = ["']([^"']+)["']/.exec(clientSrc)?.[1]

  assert.ok(hostPrefix !== undefined, '未能从宿主产物里解析出 routePrefix')
  assert.ok(clientPrefix !== undefined, '未能从客户端源码里解析出 ROUTE_PREFIX')
  assert.equal(
    clientPrefix, hostPrefix,
    `两半边的路由前缀不一致：客户端 ${clientPrefix} vs 宿主 ${hostPrefix}。` +
    '界面的取数请求会 404，而界面上只表现为"更新信息不显示"。'
  )
})
