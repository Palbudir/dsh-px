import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import source from '../config/im-community.json'
import { patchImModule } from '../src/shared/im-compatibility'
import type { CommunityBundle } from '../src/shared/distribution'
import { repoRoot } from './paths'

/** Patch the fixed upstream bundle without rebuilding or replacing its embedded SDK dependencies. */
export function stageImCommunity(
  archive: Buffer,
  directory: string,
  repository = repoRoot()
): {
  metadata: Omit<CommunityBundle, 'file' | 'sha256'>
  archive: Buffer
} {
  if ('sha512-' + createHash('sha512').update(archive).digest('base64') !== source.integrity)
    throw Error('IM community archive integrity mismatch')
  mkdirSync(directory, { recursive: false })
  writeFileSync(join(directory, 'source.tgz'), archive, { flag: 'wx' })
  execFileSync('tar', ['-xzf', 'source.tgz'], { cwd: directory, windowsHide: true })
  const pkg = join(directory, 'package'),
    file = join(pkg, 'package.json'),
    manifest = JSON.parse(readFileSync(file, 'utf8')),
    patches: Record<string, { source: string; patched: string }> = {}
  if (
    manifest.name !== source.name ||
    manifest.version !== source.version ||
    manifest.license !== source.license
  )
    throw Error('IM upstream package identity mismatch')
  for (const name of Object.keys(source.files) as Array<keyof typeof source.files>) {
    const output = patchImModule(name, readFileSync(join(pkg, name), 'utf8'))
    writeFileSync(join(pkg, name), output)
    patches[name] = { source: source.files[name], patched: createHash('sha256').update(output).digest('hex') }
  }
  execFileSync(process.execPath, ['--check', join(pkg, 'lib/index.js')], { windowsHide: true })
  execFileSync(process.execPath, [join(repository, 'scripts/verify-im-mode.mjs'), pkg], {
    windowsHide: true,
    stdio: 'pipe',
    maxBuffer: 1024 * 1024
  })
  const { buildSync } = createRequire(join(repository, 'package.json'))('esbuild') as typeof import('esbuild')
  const panelFile = join(repository, 'packages/shared/im-reception-panel.tsx')
  const panel = buildSync({
    entryPoints: [panelFile],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    external: ['react'],
    target: 'chrome100',
    write: false,
    legalComments: 'none'
  }).outputFiles[0].text
  writeFileSync(join(pkg, 'plugin-src/client/channels/feishu/px-reception.js'), panel)
  writeFileSync(join(pkg, 'plugin-src/client/channels/feishu/px-reception.tsx'), readFileSync(panelFile))
  const client = buildSync({
    entryPoints: [join(pkg, 'plugin-src/client/index.js')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'chrome100',
    external: ['react', 'react-dom'],
    nodePaths: [join(repository, 'node_modules')],
    // Do not let the staging directory's ancestor tsconfig alter the generated client bytes.
    tsconfigRaw: { compilerOptions: { alwaysStrict: true } },
    write: false,
    minify: true,
    legalComments: 'none'
  }).outputFiles[0].text
  const wrapped = `window.__ModuleLoader__.load({id:${JSON.stringify(source.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${client}\nreturn module.exports;}});\n`
  writeFileSync(join(pkg, 'lib/client.js'), wrapped)
  manifest.version = source.derivedVersion
  manifest.dshPx = {
    compatibility: source.compatibility,
    upstreamVersion: source.version,
    upstreamIntegrity: source.integrity,
    source: source.source,
    patches,
    panelSourceSha256: createHash('sha256').update(readFileSync(panelFile)).digest('hex'),
    clientSha256: createHash('sha256').update(wrapped).digest('hex')
  }
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(pkg, 'LICENSE.PX'), readFileSync(join(repository, 'LICENSE')))
  writeFileSync(
    join(pkg, 'README.PX.md'),
    '# DSH-PX IM compatibility\n\n' +
      `Derived from ${source.name} ${source.version}. Original authorship, MIT license and embedded SDKs are retained.\n\n` +
      'The bounded patch adds verified reception state and explicit restoration to native Feishu processing. ' +
      'The native IM settings retain this recovery entry when PX is disabled. Active consumers must release ownership first. ' +
      'Other channels, account credentials and native execution remain upstream-owned.\n'
  )
  execFileSync('tar', ['-czf', 'derived.tgz', 'package'], { cwd: directory, windowsHide: true })
  const result = readFileSync(join(directory, 'derived.tgz'))
  return {
    archive: result,
    metadata: {
      name: source.name,
      version: source.derivedVersion,
      integrity: 'sha512-' + createHash('sha512').update(result).digest('base64')
    }
  }
}
