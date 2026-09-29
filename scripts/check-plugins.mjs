import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { assertNativeHostPins, validateProductCatalog } from '../src/shared/product-contract.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => JSON.parse(readFileSync(join(repo, file), 'utf8'))
const root = read('package.json'),
  catalog = read('config/plugins.json')
const lock = read('package-lock.json')
const products = read('config/products.json')
const nativePack = read('config/native-pack.json'),
  nativeDesktop = read('config/native-desktop.json')
validateProductCatalog(products)
// native-pack.json and native-desktop.json are the only sources of the pinned official host.
assertNativeHostPins(products, { pack: nativePack, desktop: nativeDesktop })
assert.equal(nativePack.schemaVersion, 1, 'native Pack 清单版本')
assert.equal(nativeDesktop.schemaVersion, 1, 'native Desktop 清单版本')
assert.equal(root.version, products.desktop.version, 'Desktop 版本漂移')
assert.equal(lock.packages[''].version, root.version, '根锁文件版本漂移')
assert.deepEqual(lock.packages[''].engines, root.engines, '开发 Node 版本声明漂移')
assert.equal(root.build, undefined, '旧 electron-builder 外壳配置不得回到根 package.json')
assert.equal(catalog.schemaVersion, 2)
assert.deepEqual(
  Object.keys(catalog).sort(),
  ['deferredCommunity', 'managed', 'schemaVersion'],
  '插件清单只描述自制插件与待迁移社区插件'
)
assert.equal(new Set(catalog.managed).size, catalog.managed.length)
assert.ok(
  Array.isArray(catalog.deferredCommunity) &&
    catalog.deferredCommunity.every((name) => typeof name === 'string' && !catalog.managed.includes(name)),
  '待迁移社区插件清单无效'
)
const packages = readdirSync(join(repo, 'packages')).filter((name) =>
  existsSync(join(repo, 'packages', name, 'package.json'))
)
assert.deepEqual(packages.sort(), [...catalog.managed].sort(), '自制插件目录和统一清单不一致')
for (const name of catalog.managed) {
  const p = read(`packages/${name}/package.json`)
  assert.equal(p.name, name)
  assert.equal(p.version, products.pack.version, `${name} Pack 版本漂移`)
  assert.equal(p.main, 'lib/index.js')
  assert.equal(p.exports['./client'], './lib/client.js')
  assert.equal(p.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(p.dsh.client.platform, 'web')
  const patch = readFileSync(join(repo, 'packages', name, 'cordis.patch.yml'), 'utf8')
  const field = (key) => {
    const value = patch.match(new RegExp(`^\\s*(?:-\\s*)?${key}:\\s*(.+?)\\s*$`, 'm'))?.[1]
    return value?.replace(/^['"]|['"]$/g, '')
  }
  assert.ok(field('id') === name && field('name') === name, `${name} 的组合包身份不一致`)
  for (const file of ['src/index.ts', 'src/client.tsx', 'lib/index.js', 'lib/client.js'])
    assert.ok(existsSync(join(repo, 'packages', name, file)), `${name} 缺少 ${file}`)
}
console.log(
  `插件清单、版本、入口与组合包：${catalog.managed.length} 项通过（Pack ${products.pack.version} / Desktop ${root.version} / Host ${nativeDesktop.version}@${nativeDesktop.commit.slice(0, 8)}）`
)
