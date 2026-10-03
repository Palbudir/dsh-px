import { lstatSync, readFileSync, statSync, createWriteStream } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  assertNotLegacyClientTag,
  assertPublishableAssetName,
  releaseAssetNames,
  releaseTag
} from './release-version.mjs'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
// Download processes do not need model credentials.
function childEnvironment(env, extraKeyNames = []) {
  const blocked = new Set(['DEEPSEEK_API_KEY', ...extraKeyNames].map((name) => name.toUpperCase()))
  return Object.fromEntries(Object.entries(env).filter(([key]) => !blocked.has(key.toUpperCase())))
}
export function downloadCommand(exe, args, file, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(file, { mode: 0o600 })
    const child = spawn(exe, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnvironment(options.env ?? process.env, options.blockedEnv ?? [])
    })
    let bytes = 0,
      code = null,
      ended = false,
      failed = false
    const fail = (error) => {
      if (!failed) {
        failed = true
        child.kill()
        stream.destroy()
        clearTimeout(timer)
        reject(error)
      }
    }
    const finish = () => {
      if (ended && code === 0 && !failed) {
        clearTimeout(timer)
        resolve(bytes)
      }
    }
    const timer = setTimeout(() => fail(new Error('Artifact download timed out')), options.timeout ?? 600000)
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > (options.maxBytes ?? 2_000_000_000)) fail(new Error('Artifact exceeds download limit'))
    })
    child.stdout.pipe(stream)
    child.stderr.resume()
    child.once('error', fail)
    stream.once('error', fail)
    stream.once('finish', () => {
      ended = true
      finish()
    })
    child.once('close', (status) => {
      code = status
      if (status !== 0) fail(new Error(`Artifact download command failed (${status})`))
      else finish()
    })
  })
}

export const RELEASE_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000

function archiveFileStat(path) {
  for (let at = dirname(resolve(path)); ; at = dirname(at)) {
    const stat = lstatSync(at)
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('Release archive directory must not contain filesystem links')
    if (dirname(at) === at) break
  }
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error('Release archive must be a private regular file without links')
    return stat
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/** Only the current GitHub artifact identity can authorize reuse; partial downloads remain diagnostic data. */
export async function ensureReleaseArchive(
  { gh, repository, artifact, archive },
  download = downloadCommand
) {
  if (
    !Number.isSafeInteger(artifact?.id) ||
    artifact.id < 1 ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes < 1 ||
    artifact.size_in_bytes > 2_000_000_000 ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')
  )
    throw new Error('GitHub release artifact must have a bounded size and SHA-256 digest')
  const matches = () => {
    const stat = archiveFileStat(archive)
    return (
      stat?.size === artifact.size_in_bytes && 'sha256:' + sha256(readFileSync(archive)) === artifact.digest
    )
  }
  if (matches()) return { reused: true, size: artifact.size_in_bytes }
  await download(gh, ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], archive, {
    timeout: RELEASE_DOWNLOAD_TIMEOUT_MS,
    maxBytes: artifact.size_in_bytes
  })
  if (!matches()) throw new Error('Downloaded artifact size or digest differs from GitHub')
  return { reused: false, size: artifact.size_in_bytes }
}

export function archiveMemberNames(output, archive) {
  if (/^(?:Symbolic Link|Hard Link) = /m.test(output))
    throw new Error('Release artifacts cannot contain filesystem links')
  const names = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('Path = '))
    .map((line) => line.slice(7))
    .filter((name) => name.replaceAll('\\', '/') !== archive.replaceAll('\\', '/'))
  for (const name of names)
    if (!name || name !== basename(name) || /[/\\:\r\n]/.test(name) || name.startsWith('-'))
      throw new Error('Release artifact contains a non-flat or unsafe path')
  if (new Set(names).size !== names.length) throw new Error('Duplicate artifact paths')
  return names
}
/** Every publication is a prerelease that never becomes GitHub Latest (old clients read Latest). */
export function releaseCreateBody({ product, version, head, notes }) {
  const tag = releaseTag(product, version)
  assertNotLegacyClientTag(tag)
  return {
    tag_name: tag,
    target_commitish: head,
    name: `DSH-PX ${product === 'desktop' ? 'Desktop' : 'Pack'} ${version}`,
    body: notes,
    draft: true,
    prerelease: true,
    make_latest: 'false'
  }
}
export function releasePublishBody({ product, version, notes }) {
  return {
    name: `DSH-PX ${product === 'desktop' ? 'Desktop' : 'Pack'} ${version}`,
    body: notes,
    draft: false,
    prerelease: true,
    make_latest: 'false'
  }
}

export function verifyReleaseFiles(directory, manifest, expected) {
  if (
    manifest?.schemaVersion !== 2 ||
    manifest.product !== expected.product ||
    manifest.release !== releaseTag(expected.product, expected.version) ||
    manifest.head !== expected.head ||
    manifest.version !== expected.version ||
    manifest.controllerSha !== expected.controllerSha ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 2
  )
    throw new Error('Build artifact identity mismatch')
  const assets = releaseAssetNames(expected.product, expected.version)
  const expectedNames = new Set(Object.values(assets))
  const names = manifest.files.map((file) => file.name)
  for (const name of names) assertPublishableAssetName(name)
  if (new Set(names).size !== 2 || names.some((name) => !expectedNames.has(name)))
    throw new Error('Incomplete release file inventory')
  for (const file of manifest.files) {
    if (
      typeof file.name !== 'string' ||
      file.name !== basename(file.name) ||
      /[/\\:\r\n]/.test(file.name) ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      file.size > 2_000_000_000 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error('Invalid release asset descriptor')
    const path = join(directory, file.name)
    if (
      !lstatSync(path).isFile() ||
      lstatSync(path).isSymbolicLink() ||
      statSync(path).size !== file.size ||
      sha256(readFileSync(path)) !== file.sha256
    )
      throw new Error(`Release asset digest mismatch: ${file.name}`)
  }
  // artifact.json is the input to offline signing; it must describe the exact primary asset.
  const primary = expected.product === 'desktop' ? assets.installer : assets.pack
  const artifact = JSON.parse(readFileSync(join(directory, assets.artifact), 'utf8'))
  const bytes = readFileSync(join(directory, primary))
  if (
    artifact.product !== expected.product ||
    artifact.version !== expected.version ||
    artifact.file !== primary ||
    artifact.size !== bytes.length ||
    artifact.sha256 !== sha256(bytes) ||
    artifact.sourceCommit !== expected.head ||
    artifact.sourceDirty !== false ||
    (expected.product === 'pack' && artifact.candidate !== false)
  )
    throw new Error('artifact.json does not identify this release asset')
  return manifest.files
}
