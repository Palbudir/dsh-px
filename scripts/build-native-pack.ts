/** Assemble a native installable bundle from release files and a verified upstream archive. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { repoRoot } from './paths'
import { copyBundlePayload } from '../src/shared/bundle-payload'
import { MANAGED_PLUGIN_NAMES, PACK_VERSION, PRODUCT_CATALOG } from '../src/shared/plugin-catalog'
import { patchSidebarAuthentication, SIDEBAR_AUTH_SOURCE } from '../src/shared/sidebar-auth-compatibility'

const root = repoRoot()
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true
}).trim()
const sourceDirty =
  execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
    .length > 0
const destination = process.argv[2]
if (!destination) throw new Error('Usage: build-native-pack <new output directory>')
const output = resolve(destination)
// Fail instead of overwriting artifacts or another test run.
mkdirSync(output, { recursive: false })
const bundle = join(output, 'package')
mkdirSync(bundle)
const catalog = JSON.parse(readFileSync(join(root, 'config/native-pack.json'), 'utf8'))
const candidate = process.argv.includes('--candidate')
if (
  !candidate &&
  (!PRODUCT_CATALOG.pack.hostVersions.includes(catalog.hostVersion) ||
    PRODUCT_CATALOG.desktop.hostVersion !== catalog.hostVersion)
)
  throw new Error(
    'Native host is not the active product contract; use --candidate only for isolated validation'
  )
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
execFileSync('tar', ['-xf', archivePath, '-C', source], { windowsHide: true })
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
        patches: [sidebar]
      }
    },
    null,
    2
  ) + '\n'
)
// Explicit real member paths work before the host rebuilds its nested package resolution table.
writeFileSync(
  join(bundle, 'cordis.patch.yml'),
  '- insert:\n' +
    members
      .map(
        (name) =>
          `    - id: ${name === sidebar.name ? 'better-sidebar' : name}\n      name: ./node_modules/${name}/lib/index.js\n`
      )
      .join('')
)
writeFileSync(join(bundle, 'index.js'), 'export function apply() {}\n')
copyFileSync(join(root, 'LICENSE'), join(bundle, 'LICENSE'))
const artifact = join(output, `dsh-px-pack-${PACK_VERSION}.tgz`)
execFileSync('tar', ['-czf', artifact, '-C', output, 'package'], { windowsHide: true })
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
      artifact,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sha512: createHash('sha512').update(bytes).digest('base64')
    },
    null,
    2
  ) + '\n'
)
console.log(`Native Pack prepared: ${artifact}`)
