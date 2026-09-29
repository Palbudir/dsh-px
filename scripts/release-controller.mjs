import {
  existsSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonical, sha, sha256 } from './review-core.mjs'
import { command, downloadCommand } from './review-process.mjs'
import { acquireReviewLock } from './review-worker.mjs'
import { assertLegacyLatest, releaseGate } from './release-gate.mjs'
import {
  assertNotLegacyClientTag,
  assertPublishableAssetName,
  releaseAssetNames,
  releaseTag,
  versionParts
} from './release-version.mjs'

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
async function main() {
  const root = dirname(fileURLToPath(import.meta.url))
  const config = JSON.parse(readFileSync(join(root, 'worker.json'), 'utf8'))
  if (realpathSync(root).toLowerCase() !== config.directory.toLowerCase())
    throw new Error('Use the installed trusted release controller')
  const installation = JSON.parse(readFileSync(join(root, 'installation.json'), 'utf8'))
  for (const [file, digest] of Object.entries(installation.files))
    if (sha256(readFileSync(join(root, file))) !== digest)
      throw new Error('Trusted controller changed; independently review and reinstall it')
  if (sha256(canonical(installation.files)) !== config.workerDigest)
    throw new Error('Controller manifest mismatch')
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((arg) => arg.startsWith('--') && arg.includes('='))
      .map((arg) => {
        const at = arg.indexOf('=')
        return [arg.slice(2, at), arg.slice(at + 1)]
      })
  )
  const head = sha(args.head),
    product = args.product,
    version = args.version,
    buildRunId = Number(args['build-run'])
  versionParts(version)
  const tag = releaseTag(product, version)
  assertNotLegacyClientTag(tag)
  if (!Number.isSafeInteger(buildRunId) || buildRunId <= 0)
    throw new Error('An explicit trusted build run ID is required')
  const policy = JSON.parse(readFileSync(join(root, 'public-policy.json'), 'utf8'))
  const api = async (route, options = {}) => {
    const arguments_ = ['api', route]
    if (options.method) arguments_.push('--method', options.method)
    if (options.body) arguments_.push('--input', '-')
    const response = await command(config.gh, arguments_, {
      input: options.body ? JSON.stringify(options.body) : undefined
    })
    return response ? JSON.parse(response) : null
  }
  if ((await api('user')).login !== config.publisher)
    throw new Error('Release identity is not the configured maintainer')
  const unlock = acquireReviewLock(root)
  if (!unlock) throw new Error('Another trusted review/release operation is active; retry when it finishes')
  try {
    const verify = () =>
      releaseGate({ product, version, tag: `refs/tags/${tag}`, head, policy, api, buildRunId })
    const eligibility = await verify()
    const directory = join(root, 'releases', tag, String(buildRunId)),
      archive = join(directory, 'assets.zip')
    mkdirSync(directory, { recursive: true })
    const artifacts = await api(
      `repos/${policy.repository}/actions/runs/${buildRunId}/artifacts?per_page=100`
    )
    const matches = artifacts.artifacts.filter(
      (artifact) => artifact.name === `release-${head}-${eligibility.build.runAttempt}` && !artifact.expired
    )
    if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest ?? ''))
      throw new Error('Expected exactly one immutable build artifact with a GitHub digest')
    await ensureReleaseArchive({
      gh: config.gh,
      repository: policy.repository,
      artifact: matches[0],
      archive
    })
    const seven = config.sevenZip
    if (!seven || !existsSync(seven))
      throw new Error('A trusted 7-Zip executable is required for artifact inspection')
    const names = archiveMemberNames(
      await command(seven, ['l', '-slt', archive], { maxBytes: 1000000 }),
      archive
    )
    if (names.length !== 3 || !names.includes('release-manifest.json'))
      throw new Error('Unexpected artifact members')
    for (const name of names) if (name !== 'release-manifest.json') assertPublishableAssetName(name)
    await command(seven, ['x', '-y', '-bd', '-bso0', '-bsp0', `-o${directory}`, archive, ...names], {
      timeout: 300000
    })
    if (
      names.some(
        (name) =>
          !lstatSync(join(directory, name)).isFile() || lstatSync(join(directory, name)).isSymbolicLink()
      )
    )
      throw new Error('Extracted release artifacts must be regular files')
    const manifest = JSON.parse(readFileSync(join(directory, 'release-manifest.json'), 'utf8'))
    const files = verifyReleaseFiles(directory, manifest, {
      product,
      head,
      version,
      controllerSha: eligibility.build.controllerSha
    })
    if (names.some((name) => name !== 'release-manifest.json' && !files.some((file) => file.name === name)))
      throw new Error('Artifact inventory differs from verified manifest')
    const notesFile = join(root, 'releases', tag, 'notes.md')
    const plan = { head, product, version, tag, buildRunId, assets: files, notesFile, source: eligibility }
    writeFileSync(join(directory, 'release-plan.json'), JSON.stringify(plan, null, 2))
    if (!process.argv.includes('--publish')) {
      console.log(JSON.stringify({ prepared: true, plan: join(directory, 'release-plan.json'), notesFile }))
      return
    }
    if (!existsSync(notesFile))
      throw new Error(
        'Review the prepared plan and create its public release notes before the explicit --publish command'
      )
    const notes = readFileSync(notesFile, 'utf8')
    if (!notes.trim() || notes.length > 20000)
      throw new Error('Release notes must be a concise reviewed document')
    await verify()
    const refs = await api(`repos/${policy.repository}/git/matching-refs/tags/${tag}`)
    const existingRef = refs.find((ref) => ref.ref === `refs/tags/${tag}`)
    if (existingRef && (existingRef.object.type !== 'commit' || existingRef.object.sha !== head))
      throw new Error('Version tag already identifies a different commit; it will not be rewritten')
    if (!existingRef)
      await api(`repos/${policy.repository}/git/refs`, {
        method: 'POST',
        body: { ref: `refs/tags/${tag}`, sha: head }
      })
    // Search every page: a draft past the first 100 releases must still be found, not duplicated.
    let draft
    for (let page = 1; !draft; page++) {
      if (page > 100) throw new Error('Release history audit limit reached')
      const releases = await api(`repos/${policy.repository}/releases?per_page=100&page=${page}`)
      draft = releases.find((release) => release.tag_name === tag)
      if (releases.length < 100) break
    }
    if (draft && !draft.draft) throw new Error('Published releases are never overwritten')
    if (!draft)
      draft = await api(`repos/${policy.repository}/releases`, {
        method: 'POST',
        body: releaseCreateBody({ product, version, head, notes })
      })
    for (const asset of draft.assets) assertPublishableAssetName(asset.name)
    for (const file of files) {
      const old = draft.assets.find((asset) => asset.name === file.name)
      if (old && (old.digest !== 'sha256:' + file.sha256 || old.size !== file.size))
        throw new Error(
          `Existing draft asset differs; inspect and remove this draft-only asset before retrying: ${file.name}`
        )
      if (!old)
        await command(
          config.gh,
          ['release', 'upload', tag, join(directory, file.name), '--repo', policy.repository],
          { timeout: 600000 }
        )
    }
    draft = await api(`repos/${policy.repository}/releases/${draft.id}`)
    if (
      !draft.draft ||
      draft.assets.length !== files.length ||
      draft.assets.some((asset) => !assertPublishableAssetName(asset.name)) ||
      files.some(
        (file) =>
          !draft.assets.some(
            (asset) =>
              asset.name === file.name && asset.digest === 'sha256:' + file.sha256 && asset.size === file.size
          )
      )
    )
      throw new Error('Uploaded draft assets did not verify')
    await verify()
    const published = await api(`repos/${policy.repository}/releases/${draft.id}`, {
      method: 'PATCH',
      body: releasePublishBody({ product, version, notes })
    })
    if (published.draft || !published.prerelease)
      throw new Error('Published release is not a prerelease; inspect it immediately')
    assertLegacyLatest(await api(`repos/${policy.repository}/releases/latest`))
    console.log(JSON.stringify({ published: published.html_url, head, product, version }))
  } finally {
    unlock()
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
