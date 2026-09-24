import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtimeContentIdentity } from '../src/shared/runtime-identity'

test('restaging identical content preserves migration identity; payload and runtime changes do not', () => {
  const manifest = {
    app: { version: '0.1.0-beta.re.0.11' },
    platform: 'win32',
    arch: 'x64',
    profile: 'web',
    node: { version: '24.16.0' },
    dsh: { version: '0.1.5-rc.2' },
    stagedAt: 'first',
    integrity: { nodeSha256: 'a', managedPlugins: [{ name: 'plugin', files: { host: 'b', client: 'c' } }] }
  }
  const first = runtimeContentIdentity(manifest)
  assert.equal(runtimeContentIdentity({ ...manifest, stagedAt: 'later' } as typeof manifest), first)
  assert.equal(
    runtimeContentIdentity({
      ...manifest,
      integrity: { managedPlugins: manifest.integrity.managedPlugins, nodeSha256: 'a' }
    }),
    first
  )
  assert.notEqual(runtimeContentIdentity({ ...manifest, node: { version: '24.17.0' } }), first)
  assert.notEqual(
    runtimeContentIdentity({ ...manifest, integrity: { ...manifest.integrity, nodeSha256: 'changed' } }),
    first
  )
  assert.notEqual(
    runtimeContentIdentity({
      ...manifest,
      integrity: {
        ...manifest.integrity,
        managedPlugins: [{ name: 'plugin', files: { host: 'b', client: 'updated' } }]
      }
    }),
    first
  )
})
