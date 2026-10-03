/** Assemble a native installable bundle from release files and a verified upstream archive. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { repoRoot } from './paths'
import { copyBundlePayload } from '../src/shared/bundle-payload'
import { MANAGED_PLUGIN_NAMES, PACK_VERSION, PRODUCT_CATALOG } from '../src/shared/plugin-catalog'
import { patchSidebarAuthentication, SIDEBAR_AUTH_SOURCE } from '../src/shared/sidebar-auth-compatibility'
import { buildDistribution } from './pack-distribution'

const root = repoRoot()
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true
}).trim()
const sourceDirty =
  execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  }).trim().length > 0
const destination = process.argv[2]
if (!destination || destination.startsWith('--'))
  throw new Error('Usage: build-native-pack <new output directory> [--candidate | --expect-head=<sha>]')
const catalog = JSON.parse(readFileSync(join(root, 'config/native-pack.json'), 'utf8'))
const candidate = process.argv.includes('--candidate')
const expectedHead = process.argv
  .find((arg) => arg.startsWith('--expect-head='))
  ?.slice('--expect-head='.length)
// A release Pack must describe exactly one reviewed, clean commit; validation stays in --candidate.
if (!candidate) {
  if (
    !PRODUCT_CATALOG.pack.hostVersions.includes(catalog.hostVersion) ||
    PRODUCT_CATALOG.desktop.hostVersion !== catalog.hostVersion
  )
    throw new Error('Native host is not the active product contract')
  if (sourceDirty)
    throw new Error('Release Pack requires a clean checkout; use --candidate only for isolated validation')
  if (!expectedHead || !/^[a-f0-9]{40}$/.test(expectedHead) || expectedHead !== sourceCommit)
    throw new Error('Release Pack requires --expect-head=<exact SHA> equal to the checked-out HEAD')
}
const output = resolve(destination)
// Fail instead of overwriting artifacts or another test run.
mkdirSync(output, { recursive: false })
const bundle = join(output, 'package')
mkdirSync(bundle)
const sidebar = SIDEBAR_AUTH_SOURCE
const url = `https://registry.npmjs.org/${sidebar.name}/-/${sidebar.name}-${sidebar.version}.tgz`
const cachedArchive = process.argv
  .find((arg) => arg.startsWith('--sidebar-archive='))
  ?.slice('--sidebar-archive='.length)
async function downloadSource(): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`Sidebar download failed: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}
const archive = cachedArchive ? readFileSync(resolve(cachedArchive)) : await downloadSource()
if ('sha512-' + createHash('sha512').update(archive).digest('base64') !== sidebar.integrity)
  throw new Error('Sidebar registry archive integrity mismatch')
const archivePath = join(output, 'sidebar-source.tgz')
writeFileSync(archivePath, archive, { flag: 'wx' })
const source = join(output, 'upstream')
mkdirSync(source)
execFileSync('tar', ['-xzf', '../sidebar-source.tgz'], { cwd: source, windowsHide: true })
const modules = join(bundle, 'node_modules')
mkdirSync(modules)
for (const name of MANAGED_PLUGIN_NAMES) {
  const directory = join(root, 'packages', name)
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== name || manifest.version !== PACK_VERSION) throw new Error(`Wrong member: ${name}`)
  copyBundlePayload(directory, join(modules, name))
}
const sidebarDirectory = join(modules, sidebar.name)
renameSync(join(source, 'package'), sidebarDirectory)
const sidebarManifest = JSON.parse(readFileSync(join(sidebarDirectory, 'package.json'), 'utf8'))
if (sidebarManifest.name !== sidebar.name || sidebarManifest.version !== sidebar.version)
  throw new Error('Sidebar identity mismatch')
const patched = patchSidebarAuthentication(readFileSync(join(sidebarDirectory, 'lib/index.js'), 'utf8'))
writeFileSync(join(sidebarDirectory, 'lib/index.js'), patched.code)
const members = [...MANAGED_PLUGIN_NAMES, sidebar.name]
// Native module discovery requires exact package names for client halves.
const exports: Record<string, string> = {
  '.': './index.js',
  './package.json': './package.json',
  './cordis.patch.yml': './cordis.patch.yml',
  './locale/*.json': './locale/*.json'
}
mkdirSync(join(bundle, 'locale'))
writeFileSync(
  join(bundle, 'locale/zh.json'),
  JSON.stringify({
    meta: {
      title: 'DSH-PX 插件整合包',
      description: '为 DSH 提供工作区、执行记录、产物、引用批注和定时任务。'
    }
  }) + '\n'
)
writeFileSync(
  join(bundle, 'locale/en.json'),
  JSON.stringify({
    meta: {
      title: 'DSH-PX Pack',
      description: 'Workspace tools, execution records, artifacts, annotations and scheduled tasks.'
    }
  }) + '\n'
)
copyFileSync(join(modules, 'dsh-px-workspace/icon.svg'), join(bundle, 'icon.svg'))
copyFileSync(join(root, 'LICENSE'), join(bundle, 'LICENSE'))
buildDistribution(bundle, PACK_VERSION, catalog.dependencies, {
  candidate,
  sourceCommit,
  sourceDirty,
  hostVersion: catalog.hostVersion,
  upstreamCommit: catalog.upstreamCommit,
  protocolGeneration: PRODUCT_CATALOG.protocolGeneration
})
const dependencies = { ...catalog.dependencies }
for (const name of MANAGED_PLUGIN_NAMES) dependencies[name] = PACK_VERSION
dependencies[sidebar.name] = sidebar.version
writeFileSync(
  join(bundle, 'package.json'),
  JSON.stringify(
    {
      name: 'dsh-px-pack',
      version: PACK_VERSION,
      private: true,
      type: 'module',
      main: 'index.js',
      license: 'MIT',
      description: 'DSH-PX: sessions, files, execution evidence and scheduled work for native DSH hosts.',
      icon: './icon.svg',
      exports,
      dependencies,
      bundledDependencies: members,
      peerDependencies: catalog.peerDependencies,
      peerDependenciesMeta: catalog.peerDependenciesMeta,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      dshPx: {
        candidate,
        sourceCommit,
        sourceDirty,
        hostVersion: catalog.hostVersion,
        upstreamCommit: catalog.upstreamCommit,
        protocolGeneration: PRODUCT_CATALOG.protocolGeneration,
        distribution: './distribution.json',
        patches: [sidebar]
      }
    },
    null,
    2
  ) + '\n'
)
// The native manager refreshes package resolution before the next Host boot.
writeFileSync(
  join(bundle, 'cordis.patch.yml'),
  '- insert:\n' +
    members
      .map((name) => `    - id: ${name === sidebar.name ? 'better-sidebar' : name}\n      name: ${name}\n`)
      .join('')
)
writeFileSync(join(bundle, 'index.js'), 'export function apply() {}\n')
copyFileSync(join(root, 'LICENSE'), join(bundle, 'LICENSE'))
const artifactName = `dsh-px-pack-${PACK_VERSION}.tgz`,
  artifact = join(output, artifactName)
// Relative names keep GNU tar from reading a Windows drive-letter colon as a remote host.
execFileSync('tar', ['-czf', artifactName, 'package'], { cwd: output, windowsHide: true })
const bytes = readFileSync(artifact)
writeFileSync(
  join(output, 'artifact.json'),
  JSON.stringify(
    {
      version: PACK_VERSION,
      candidate,
      sourceCommit,
      sourceDirty,
      hostVersion: catalog.hostVersion,
      upstreamCommit: catalog.upstreamCommit,
      protocolGeneration: PRODUCT_CATALOG.protocolGeneration,
      // A file name only: published metadata must not carry build-machine paths.
      artifact: artifactName,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sha512: createHash('sha512').update(bytes).digest('base64')
    },
    null,
    2
  ) + '\n'
)
console.log(`Native Pack prepared: ${artifact}`)
