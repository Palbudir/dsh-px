import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  inspectNode,
  inspectDsh,
  inspectManagedPlugin,
  assertPluginIdentity
} from '../src/shared/runtime-integrity'
import { forbiddenPayloadPaths } from '../src/shared/payload-policy'
import { copyBundlePayload } from '../src/shared/bundle-payload'

test('actual Node version, platform and architecture reject mislabeled reuse', () => {
  const actual = inspectNode(process.execPath, {
    version: process.versions.node,
    platform: process.platform,
    arch: process.arch
  })
  assert.match(actual.sha256, /^[0-9a-f]{64}$/)
  assert.throws(() => inspectNode(process.execPath, { version: '0.0.0' }), /version 实际/)
  assert.throws(() => inspectNode(process.execPath, { platform: 'wrong-os' }), /platform 实际/)
  assert.throws(() => inspectNode(process.execPath, { arch: 'wrong-arch' }), /arch 实际/)
})

test('DSH reuse reads the real package manifest and CLI entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-runtime-check-'))
  try {
    mkdirSync(join(root, 'lib'))
    writeFileSync(join(root, 'lib/bin.js'), 'CLI')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '1.0.0' }))
    assert.equal(inspectDsh(root, '1.0.0').version, '1.0.0')
    assert.throws(() => inspectDsh(root, '1.0.1'), /实际为 1.0.0/)
    rmSync(join(root, 'lib/bin.js'))
    assert.throws(() => inspectDsh(root, '1.0.0'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('bundle source identity covers the package, both entries and patch; copied payload excludes source checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-bundle-check-'))
  try {
    const source = join(root, 'source'),
      destination = join(root, 'destination')
    mkdirSync(join(source, 'lib'), { recursive: true })
    const pkg = {
      name: 'dsh-px-example',
      version: '1.0.0',
      type: 'module',
      files: ['lib', 'cordis.patch.yml'],
      exports: { '.': './lib/index.js', './client': './lib/client.js' },
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } }
    }
    writeFileSync(join(source, 'package.json'), JSON.stringify(pkg))
    for (const file of ['lib/index.js', 'lib/client.js'])
      writeFileSync(join(source, file), 'export default {}')
    writeFileSync(join(source, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(source, 'source-only.ts'), 'not a release file')
    const identity = inspectManagedPlugin(source, pkg.name, 'test', pkg.version)
    assert.throws(() => assertPluginIdentity(identity, { ...identity, files: {} }), /四个必需文件/)
    assert.throws(
      () =>
        assertPluginIdentity(identity, {
          ...identity,
          files: { ...identity.files, 'lib/index.js': 'invalid' }
        }),
      /四个必需文件/
    )
    copyBundlePayload(source, destination)
    assertPluginIdentity(inspectManagedPlugin(destination, pkg.name, 'copy'), identity)
    assert.throws(() => readFileSync(join(destination, 'source-only.ts')))
    writeFileSync(join(destination, 'lib/client.js'), 'CORRUPTED')
    assert.throws(
      () => assertPluginIdentity(inspectManagedPlugin(destination, pkg.name, 'copy'), identity),
      /摘要/
    )
    writeFileSync(
      join(source, 'package.json'),
      JSON.stringify({ ...pkg, dependencies: { external: '1.0.0' } })
    )
    assert.throws(() => inspectManagedPlugin(source, pkg.name, 'test'), /外部依赖/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release payload rejects private credentials, sessions, migration backups and traversal', () => {
  const forbidden = [
    'resources/runtime/dsh-home/.credentials.yaml',
    'resources/runtime/dsh-home/.dsh-px-maintenance-transaction.json',
    'resources/runtime/dsh-home/.dsh-px-maintenance-trash/old/profile/package.json',
    'resources/runtime/dsh-home/settings.yaml',
    'resources/runtime/dsh-home/sessions/a.log',
    'resources/runtime/dsh-home/storages/workspace.json',
    'resources/runtime/dsh-home/backups/old/package.json',
    'resources/runtime/dsh-home/.env',
    'resources/runtime/dsh-home/.dsh-px-staging/id/profile/package.json',
    'resources/runtime/_dsh-install/package.json',
    'resources/runtime/dsh-home/profiles/web/.dsh-market/db.json',
    '../outside/secret',
    'resources/runtime/dsh-home/profiles/web/.npmrc'
  ]
  assert.deepEqual(forbiddenPayloadPaths(forbidden), forbidden)
  assert.deepEqual(
    forbiddenPayloadPaths([
      'resources/app.asar',
      'resources/runtime/dsh/package.json',
      'resources/runtime/node/node.exe',
      'resources/runtime/dsh-home/profiles/web/node_modules/@deepseek-ai/dsh-settings/lib/index.js',
      'resources/runtime/dsh-home/profiles/web/.dsh-px-packages/dsh-px-workspace/package.json'
    ]),
    []
  )
})
