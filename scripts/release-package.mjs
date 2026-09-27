import { createHash } from 'node:crypto'
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  statSync,
  existsSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { versionParts, releaseAssetNames } from './release-version.mjs'
function run(exe, args, shell = false) {
  const result = spawnSync(exe, args, { shell, windowsHide: true, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error('Read-only release build failed')
}
function main() {
  const trusted = dirname(fileURLToPath(import.meta.url))
  const head = process.env.BUILD_HEAD,
    version = process.env.BUILD_VERSION
  if (!/^[a-f0-9]{40}$/.test(head ?? '')) throw new Error('Exact build head required')
  versionParts(version)
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  if (pkg.name !== 'dsh-px' || pkg.version !== version)
    throw new Error('Build version does not match candidate')
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
  prepareReleaseArtifacts('dist', { head, version, controllerSha: process.env.GITHUB_SHA })
}

/** Copy verified local outputs under their publication names; never rewrite the raw build feed. */
export function prepareReleaseArtifacts(
  dist,
  { head, version, controllerSha },
  date = new Date().toISOString()
) {
  if (!/^[a-f0-9]{40}$/.test(head ?? '') || !/^[a-f0-9]{40}$/.test(controllerSha ?? ''))
    throw new Error('Exact candidate and controller identities required')
  const assets = releaseAssetNames(version)
  if (!Number.isFinite(Date.parse(date))) throw new Error('Invalid release date')
  const names = readdirSync(dist)
  const installer = names.filter(
    (name) => /^DSH-PX.*Setup.*\.exe$/i.test(name) && name.endsWith(version + '.exe')
  )
  const zip = `DSH-PX-${version}-win.zip`
  if (installer.length !== 1 || !names.includes(zip) || !names.includes(installer[0] + '.blockmap'))
    throw new Error('Incomplete release assets')
  const output = join(dist, 'release-artifacts')
  if (existsSync(output) && readdirSync(output).length)
    throw new Error('Release artifact directory must be empty; prepared assets will not be overwritten')
  mkdirSync(output, { recursive: true })
  for (const [source, target] of [
    [installer[0], assets.installer],
    [installer[0] + '.blockmap', assets.blockmap],
    [zip, assets.zip]
  ])
    copyFileSync(join(dist, source), join(output, target))
  const setup = readFileSync(join(output, assets.installer)),
    sha512 = createHash('sha512').update(setup).digest('base64')
  writeFileSync(
    join(output, assets.metadata),
    `version: ${JSON.stringify(version)}\nfiles:\n  - url: ${JSON.stringify(assets.installer)}\n    sha512: ${sha512}\n    size: ${setup.length}\npath: ${JSON.stringify(assets.installer)}\nsha512: ${sha512}\nreleaseDate: ${JSON.stringify(date)}\n`
  )
  const files = Object.values(assets)
  const manifest = {
    schemaVersion: 1,
    head,
    version,
    controllerSha,
    files: files.map((name) => ({
      name,
      size: statSync(join(output, name)).size,
      sha256: createHash('sha256')
        .update(readFileSync(join(output, name)))
        .digest('hex')
    }))
  }
  writeFileSync(join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
