import { test } from 'node:test'
import assert from 'node:assert/strict'
import products from '../config/products.json'
import {
  assertRuntimeProducts,
  validateProductCatalog,
  versionGeneration
} from '../src/shared/product-contract'
import { runtimeContentIdentity } from '../src/shared/runtime-identity'

test('independent patches and prereleases retain the same generation', () => {
  const c = structuredClone(products)
  c.pack.version = c.desktop.packVersion = '0.2.4'
  c.desktop.version = '0.2.1'
  validateProductCatalog(c)
  assertRuntimeProducts(c, c, '0.2.1', c.desktop.hostVersion)
  for (const v of ['0.2.0', '0.2.32', '0.2.0-alpha.12']) assert.equal(versionGeneration(v), 2)
  for (const v of ['1.2.0', 'v0.2.0', '0.02.0', '0.2.0-01', '0.2.0+other', '', '0.2.0/../'])
    assert.throws(() => versionGeneration(v))
  const next = structuredClone(c)
  next.desktop.version = '0.3.0'
  assert.throws(() => validateProductCatalog(next), /generation/)
  next.protocolGeneration = 3
  next.pack.version = next.desktop.packVersion = '0.3.0'
  validateProductCatalog(next)
})

test('wrong Pack baseline, host, surfaces or runtime identity fail before activation', () => {
  validateProductCatalog(products)
  for (const mutate of [
    (c: typeof products) => {
      c.desktop.packVersion = '0.2.99'
    },
    (c: typeof products) => {
      c.desktop.hostVersion = '0.2.0-rc.1'
    },
    (c: typeof products) => {
      c.pack.dataSchemaVersion = 0
    },
    (c: typeof products) => {
      c.pack.surfaces = ['px-desktop']
    },
    (c: typeof products) => {
      c.schemaVersion = 99
    }
  ]) {
    const c = structuredClone(products)
    mutate(c)
    assert.throws(() => validateProductCatalog(c))
  }
  assert.throws(() =>
    assertRuntimeProducts(undefined, products, products.desktop.version, products.desktop.hostVersion)
  )
  assert.throws(() => assertRuntimeProducts(products, products, '0.2.99', products.desktop.hostVersion))
  const substituted = structuredClone(products)
  substituted.pack.version = substituted.desktop.packVersion = '0.2.99'
  assert.throws(() =>
    assertRuntimeProducts(substituted, products, products.desktop.version, products.desktop.hostVersion)
  )
})

test('Desktop-only changes do not migrate a profile; Pack or host changes do', () => {
  validateProductCatalog(products)
  const m = {
    app: { version: products.desktop.version },
    products,
    platform: 'win32',
    arch: 'x64',
    profile: 'web',
    node: { version: '24.16.0' },
    dsh: { version: products.desktop.hostVersion },
    integrity: { payload: 'same' }
  }
  const original = runtimeContentIdentity(m)
  const desktop = structuredClone(m)
  desktop.app.version = desktop.products.desktop.version = '0.2.9'
  assert.equal(runtimeContentIdentity(desktop), original)
  const pack = structuredClone(m)
  pack.products.pack.version = pack.products.desktop.packVersion = '0.2.9'
  assert.notEqual(runtimeContentIdentity(pack), original)
  assert.notEqual(runtimeContentIdentity({ ...m, dsh: { version: '0.2.0-rc.1' } }), original)
})
