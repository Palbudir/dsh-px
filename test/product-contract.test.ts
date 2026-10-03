import { test } from 'node:test'
import assert from 'node:assert/strict'
import products from '../config/products.json'
import nativePack from '../config/native-pack.json'
import nativeDesktop from '../config/native-desktop.json'
import {
  assertNativeHostPins,
  assertRuntimeProducts,
  validateProductCatalog,
  versionGeneration
} from '../src/shared/product-contract'

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

test('the active products are official-derived on the pinned 0.2.0-rc.2 host', () => {
  validateProductCatalog(products)
  assert.equal(products.desktop.architecture, 'official-derived')
  assert.equal(products.desktop.hostVersion, '0.2.0-rc.2')
  assert.deepEqual(products.pack.hostVersions, ['0.2.0-rc.2'])
  // The same Pack is qualified against the pinned official Windows installer.
  assert.equal(products.pack.surfaces.includes('official-desktop'), true)
  assertNativeHostPins(products, { pack: nativePack, desktop: nativeDesktop })
})

test('the retired legacy shell and unknown architectures are rejected', () => {
  for (const architecture of ['legacy-shell', 'electron', '']) {
    const c: any = structuredClone(products)
    c.desktop.architecture = architecture
    assert.throws(() => validateProductCatalog(c), /official-derived/)
  }
})

test('native Pack, native Desktop and products must pin one host version and commit', () => {
  const pins = () => ({ pack: structuredClone(nativePack), desktop: structuredClone(nativeDesktop) })
  const wrongDesktop = pins()
  wrongDesktop.desktop.version = '0.2.0-rc.9'
  assert.throws(() => assertNativeHostPins(products, wrongDesktop), /different host versions/)
  const wrongCommit = pins()
  wrongCommit.pack.upstreamCommit = 'f'.repeat(40)
  assert.throws(() => assertNativeHostPins(products, wrongCommit), /different upstream commits/)
  const shortCommit = pins()
  shortCommit.pack.upstreamCommit = shortCommit.desktop.commit = '4878cdab'
  assert.throws(() => assertNativeHostPins(products, shortCommit), /exact upstream commits/)
  const drifted = structuredClone(products)
  drifted.desktop.hostVersion = '0.2.0-rc.9'
  drifted.pack.hostVersions = ['0.2.0-rc.9']
  assert.throws(() => assertNativeHostPins(drifted, pins()), /pinned native Desktop/)
  const packOnly = structuredClone(products)
  packOnly.pack.hostVersions = ['0.2.0-rc.2', '0.2.0-rc.9']
  assertNativeHostPins(packOnly, pins())
})

test('wrong Pack baseline, host, surfaces or runtime identity fail before activation', () => {
  for (const mutate of [
    (c: typeof products) => {
      c.desktop.packVersion = '0.2.99'
    },
    (c: typeof products) => {
      c.desktop.hostVersion = '0.2.0-rc.9'
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
