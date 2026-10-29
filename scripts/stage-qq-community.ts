import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import source from '../config/qq-community.json'
import { patchQqModule } from '../src/shared/qq-compatibility'
import type { CommunityBundle } from '../src/shared/distribution'
import { repoRoot } from './paths'

/** Preserve independent package identity and disclose the exact compatibility derivation. */
export function stageQqCommunity(
  archive: Buffer,
  directory: string,
  repository = repoRoot()
): {
  metadata: Omit<CommunityBundle, 'file' | 'sha256'>
  archive: Buffer
} {
  const { buildSync } = createRequire(join(repository, 'package.json'))('esbuild') as typeof import('esbuild')
  if ('sha512-' + createHash('sha512').update(archive).digest('base64') !== source.integrity)
    throw Error('QQ community archive integrity mismatch')
  mkdirSync(directory, { recursive: false })
  writeFileSync(join(directory, 'source.tgz'), archive, { flag: 'wx' })
  execFileSync('tar', ['-xzf', 'source.tgz'], { cwd: directory, windowsHide: true })
  const pkgDir = join(directory, 'package'),
    manifestFile = join(pkgDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (manifest.name !== source.name || manifest.version !== source.version)
    throw Error('QQ community identity mismatch')
  const patches: Record<string, { source: string; patched: string }> = {}
  for (const file of Object.keys(source.files) as Array<keyof typeof source.files>) {
    const location = join(pkgDir, 'lib', file),
      original = readFileSync(location, 'utf8')
    const patched = patchQqModule(file, original)
    writeFileSync(location, patched)
    patches[file] = {
      source: source.files[file],
      patched: createHash('sha256').update(patched).digest('hex')
    }
  }
  const marked = JSON.parse(readFileSync(join(repository, 'node_modules/marked/package.json'), 'utf8'))
  if (marked.version !== '16.4.2') throw Error('QQ Markdown renderer requires the verified marked version')
  const renderer = buildSync({
    absWorkingDir: repository,
    entryPoints: [join(repository, 'src/shared/qq-markdown.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
    legalComments: 'none'
  }).outputFiles[0].text
  writeFileSync(join(pkgDir, 'lib/px-markdown.js'), renderer)
  const persistence = buildSync({
    absWorkingDir: repository,
    entryPoints: [join(repository, 'src/shared/qq-atomic.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
    legalComments: 'none'
  }).outputFiles[0].text
  writeFileSync(join(pkgDir, 'lib/px-persistence.js'), persistence)
  writeFileSync(
    join(pkgDir, 'LICENSE.marked'),
    readFileSync(join(repository, 'node_modules/marked/LICENSE.md'))
  )
  writeFileSync(join(pkgDir, 'LICENSE.PX'), readFileSync(join(repository, 'LICENSE')))
  manifest.version = source.derivedVersion
  manifest.description = '社区 OneBot QQ 通道，含 DSH-PX 人格、权限和会话兼容适配'
  manifest.dependencies = source.dependencies
  manifest.peerDependencies['@deepseek-ai/schemastery'] = '3.18.5'
  delete manifest.dsh.client
  manifest.dshPx = {
    compatibility: 'qq-v1',
    upstreamVersion: source.version,
    upstreamCommit: source.sourceCommit,
    upstreamIntegrity: source.integrity,
    source: source.source,
    patches,
    renderer: {
      name: 'marked',
      version: marked.version,
      sha256: createHash('sha256').update(renderer).digest('hex')
    },
    persistenceSha256: createHash('sha256').update(persistence).digest('hex')
  }
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(
    join(pkgDir, 'cordis.patch.yml'),
    '- insert:\n    - id: dsh-onebot\n      name: dsh-onebot-qq\n'
  )
  writeFileSync(
    join(pkgDir, 'README.PX.md'),
    '# DSH-PX QQ compatibility\n\nThis package derives from ' +
      source.name +
      ' ' +
      source.version +
      ' (' +
      source.sourceCommit +
      '). The original BSD-3-Clause license and source attribution are retained.\n\n' +
      'The native OneBot transport, Agent lifecycle and message delivery remain upstream-owned. ' +
      'PX provides audience boundaries, persona binding, model selection checks, startup restoration and a single settings page. ' +
      'See https://github.com/Palbudir/dsh-px/blob/master/docs/QQ.md for setup, commands and limitations.\n'
  )
  execFileSync('tar', ['-czf', 'derived.tgz', 'package'], { cwd: directory, windowsHide: true })
  const result = readFileSync(join(directory, 'derived.tgz'))
  return {
    metadata: {
      name: source.name,
      version: source.derivedVersion,
      integrity: 'sha512-' + createHash('sha512').update(result).digest('base64')
    },
    archive: result
  }
}
