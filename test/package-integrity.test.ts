import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { sourceFingerprint } from '../src/shared/build-identity'
import { MANAGED_PLUGIN_NAMES } from '../src/shared/plugin-catalog'
import { verifyBuiltApplication, verifyManagedPackageSources } from '../scripts/package-integrity'

const runNode = promisify(execFile)
const asarModule = pathToFileURL(createRequire(import.meta.url).resolve('@electron/asar')).href
async function createArchive(source: string, destination: string): Promise<void> {
  // asar 3.4.1 resolves after out.end(), before the destination's finish event.
  // Natural child exit drains pending filesystem writes before the parent reads.
  await runNode(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      'const { createPackage } = await import(process.argv[1]); await createPackage(process.argv[2], process.argv[3]);',
      asarModule,
      source,
      destination
    ],
    { windowsHide: true, timeout: 30000, maxBuffer: 512000 }
  )
}

function write(path: string, contents: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}
function syntheticRepository() {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-package-integrity-'))
  const repository = join(root, 'repo')
  for (const name of ['src', 'packages', 'config']) mkdirSync(join(repository, name), { recursive: true })
  write(join(repository, 'package.json'), JSON.stringify({ name: 'dsh-px', version: '1.0.0' }))
  write(join(repository, 'src/main.ts'), 'export const answer = 1')
  for (const entry of ['main/index.js', 'preload/index.cjs', 'renderer/index.html'])
    write(join(repository, 'out', entry), 'BUILT ' + entry)
  write(join(repository, 'out/renderer/assets/recovery.js'), 'CURRENT RECOVERY RESOURCE')
  const identity = {
    version: '1.0.0',
    sourceFingerprint: sourceFingerprint(repository),
    outputs: Object.fromEntries(
      ['main/index.js', 'preload/index.cjs', 'renderer/index.html'].map((entry) => [
        entry,
        createHash('sha256')
          .update(readFileSync(join(repository, 'out', entry)))
          .digest('hex')
      ])
    )
  }
  write(join(repository, 'out/build-info.json'), JSON.stringify(identity))
  const cleanup = (): void => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  }
  return { root, repository, identity, cleanup }
}

test('same-version package must match current source fingerprint and actual local/packed build outputs', async () => {
  const f = syntheticRepository()
  try {
    const packed = join(f.root, 'packed')
    cpSync(f.repository, packed, { recursive: true })
    const archive = join(f.root, 'app.asar')
    await createArchive(packed, archive)
    assert.doesNotThrow(() => verifyBuiltApplication(archive, f.repository, '1.0.0'))
    write(join(f.repository, 'out/renderer/assets/recovery.js'), 'NEW RECOVERY RESOURCE')
    assert.throws(() => verifyBuiltApplication(archive, f.repository, '1.0.0'), /应用资源/)
    write(join(f.repository, 'out/renderer/assets/recovery.js'), 'CURRENT RECOVERY RESOURCE')
    write(join(f.repository, 'src/main.ts'), 'export const answer = 2')
    assert.throws(() => verifyBuiltApplication(archive, f.repository, '1.0.0'), /当前源码/)
    write(join(f.repository, 'src/main.ts'), 'export const answer = 1')
    write(join(f.repository, 'out/main/index.js'), 'NEW LOCAL BUILD')
    assert.throws(() => verifyBuiltApplication(archive, f.repository, '1.0.0'), /应用入口/)
    write(join(f.repository, 'out/main/index.js'), 'BUILT main/index.js')
    write(join(packed, 'out/preload/index.cjs'), 'TAMPERED PACKED BUILD')
    const changed = join(f.root, 'changed.asar')
    await createArchive(packed, changed)
    assert.throws(() => verifyBuiltApplication(changed, f.repository, '1.0.0'), /应用入口/)
    write(join(packed, 'out/build-info.json'), JSON.stringify({ ...f.identity, outputs: {} }))
    const missing = join(f.root, 'missing.asar')
    await createArchive(packed, missing)
    assert.throws(() => verifyBuiltApplication(missing, f.repository, '1.0.0'), /摘要不完整/)
  } finally {
    f.cleanup()
  }
})

test('a self-consistent same-version runtime cannot hide stale managed entry artifacts', () => {
  const f = syntheticRepository()
  try {
    const runtime = join(f.root, 'runtime')
    for (const name of MANAGED_PLUGIN_NAMES) {
      const source = join(f.repository, 'packages', name)
      write(
        join(source, 'package.json'),
        JSON.stringify({
          name,
          version: '1.0.0',
          type: 'module',
          exports: { '.': './lib/index.js', './client': './lib/client.js' },
          dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } }
        })
      )
      for (const file of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml'])
        write(join(source, file), 'ORIGINAL')
      cpSync(source, join(runtime, 'dsh-home/profiles/web/node_modules', name), { recursive: true })
    }
    assert.doesNotThrow(() => verifyManagedPackageSources(runtime, f.repository, 'web', '1.0.0'))
    write(join(f.repository, 'packages', MANAGED_PLUGIN_NAMES[0], 'lib/client.js'), 'NEW CLIENT SAME VERSION')
    assert.throws(() => verifyManagedPackageSources(runtime, f.repository, 'web', '1.0.0'), /文件摘要/)
  } finally {
    f.cleanup()
  }
})
