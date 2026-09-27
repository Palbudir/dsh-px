import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { versionParts } from './release-version.mjs'

const trusted = dirname(fileURLToPath(import.meta.url))
const head = process.env.BUILD_HEAD,
  version = process.env.BUILD_VERSION
if (!/^[a-f0-9]{40}$/.test(head ?? '')) throw new Error('Exact build head required')
versionParts(version)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (pkg.name !== 'dsh-px' || pkg.version !== version)
  throw new Error('Build version does not match candidate')
function run(exe, args, shell = false) {
  const result = spawnSync(exe, args, { shell, windowsHide: true, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error('Read-only release build failed')
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm',
  npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
run(process.execPath, [join(trusted, 'release-quality.mjs')])
for (const script of ['prune', 'icon', 'build']) run(npm, ['run', script], process.platform === 'win32')
run(
  npx,
  ['--no-install', 'electron-builder', '--win', '--dir', '--publish', 'never'],
  process.platform === 'win32'
)
// Pack an explicit update source even when no publishing credentials exist in this job.
writeFileSync(
  'dist/win-unpacked/resources/app-update.yml',
  'provider: github\nowner: Palbudir\nrepo: dsh-px\nupdaterCacheDirName: dsh-px-updater\n'
)
run(
  npx,
  ['--no-install', 'electron-builder', '--win', '--prepackaged', 'dist/win-unpacked', '--publish', 'never'],
  process.platform === 'win32'
)
run(npm, ['run', 'verify:package'], process.platform === 'win32')
const names = readdirSync('dist')
const installer = names.filter(
  (name) => /^DSH-PX.*Setup.*\.exe$/i.test(name) && name.endsWith(version + '.exe')
)
const zip = `DSH-PX-${version}-win.zip`
if (installer.length !== 1 || !names.includes(zip) || !names.includes(installer[0] + '.blockmap'))
  throw new Error('Incomplete release assets')
const setup = readFileSync(join('dist', installer[0])),
  sha512 = createHash('sha512').update(setup).digest('base64')
writeFileSync(
  'dist/latest.yml',
  `version: ${JSON.stringify(version)}\nfiles:\n  - url: ${JSON.stringify(installer[0])}\n    sha512: ${sha512}\n    size: ${setup.length}\npath: ${JSON.stringify(installer[0])}\nsha512: ${sha512}\nreleaseDate: ${JSON.stringify(new Date().toISOString())}\n`
)
const files = [installer[0], installer[0] + '.blockmap', zip, 'latest.yml']
mkdirSync('dist/release-artifacts', { recursive: true })
const manifest = {
  schemaVersion: 1,
  head,
  version,
  controllerSha: process.env.GITHUB_SHA,
  files: files.map((name) => ({
    name,
    size: statSync(join('dist', name)).size,
    sha256: createHash('sha256')
      .update(readFileSync(join('dist', name)))
      .digest('hex')
  }))
}
for (const name of files) copyFileSync(join('dist', name), join('dist/release-artifacts', name))
writeFileSync('dist/release-artifacts/release-manifest.json', JSON.stringify(manifest, null, 2))
