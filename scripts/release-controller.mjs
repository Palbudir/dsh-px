import { createHash, randomUUID } from 'node:crypto'
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
import { releaseGate } from './release-gate.mjs'
import { versionParts, releaseAssetNames } from './release-version.mjs'

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
export function verifyReleaseFiles(directory, manifest, expected) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.head !== expected.head ||
    manifest.version !== expected.version ||
    manifest.controllerSha !== expected.controllerSha ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 4
  )
    throw new Error('Build artifact identity mismatch')
  const names = manifest.files.map((file) => file.name)
  const assets = releaseAssetNames(expected.version),
    expectedNames = new Set(Object.values(assets))
  if (new Set(names).size !== 4 || names.some((name) => !expectedNames.has(name)))
    throw new Error('Incomplete release file inventory')
  const exe = assets.installer
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
  const yml = readFileSync(join(directory, 'latest.yml'), 'utf8')
  const digest = createHash('sha512')
    .update(readFileSync(join(directory, exe)))
    .digest('base64')
  const dateLine = /^releaseDate: ("[^"\r\n]+")$/m.exec(yml.replaceAll('\r\n', '\n'))
  const date = dateLine ? JSON.parse(dateLine[1]) : ''
  const exact = `version: ${JSON.stringify(expected.version)}\nfiles:\n  - url: ${JSON.stringify(exe)}\n    sha512: ${digest}\n    size: ${statSync(join(directory, exe)).size}\npath: ${JSON.stringify(exe)}\nsha512: ${digest}\nreleaseDate: ${JSON.stringify(date)}\n`
  if (!Number.isFinite(Date.parse(date)) || yml.replaceAll('\r\n', '\n') !== exact)
    throw new Error('Update metadata does not identify this installer')
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
    version = args.version,
    buildRunId = Number(args['build-run'])
  versionParts(version)
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
    const verify = () => releaseGate({ version, tag: `refs/tags/v${version}`, head, policy, api, buildRunId })
    const eligibility = await verify()
    const directory = join(root, 'releases', version, String(buildRunId)),
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
    await downloadCommand(
      config.gh,
      ['api', `repos/${policy.repository}/actions/artifacts/${matches[0].id}/zip`],
      archive
    )
    if ('sha256:' + sha256(readFileSync(archive)) !== matches[0].digest)
      throw new Error('Downloaded artifact differs from its GitHub digest')
    const seven = config.sevenZip
    if (!seven || !existsSync(seven))
      throw new Error('A trusted 7-Zip executable is required for artifact inspection')
    const names = archiveMemberNames(
      await command(seven, ['l', '-slt', archive], { maxBytes: 1000000 }),
      archive
    )
    if (names.length !== 5 || !names.includes('release-manifest.json'))
      throw new Error('Unexpected artifact members')
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
      head,
      version,
      controllerSha: eligibility.build.controllerSha
    })
    if (names.some((name) => name !== 'release-manifest.json' && !files.some((file) => file.name === name)))
      throw new Error('Artifact inventory differs from verified manifest')
    const notesFile = join(root, 'releases', version, 'notes.md')
    const plan = { head, version, buildRunId, assets: files, notesFile, source: eligibility }
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
    const tag = 'v' + version
    const refs = await api(`repos/${policy.repository}/git/matching-refs/tags/${tag}`)
    const existingRef = refs.find((ref) => ref.ref === `refs/tags/${tag}`)
    if (existingRef && (existingRef.object.type !== 'commit' || existingRef.object.sha !== head))
      throw new Error('Version tag already identifies a different commit; it will not be rewritten')
    if (!existingRef)
      await api(`repos/${policy.repository}/git/refs`, {
        method: 'POST',
        body: { ref: `refs/tags/${tag}`, sha: head }
      })
    const releases = await api(`repos/${policy.repository}/releases?per_page=100`)
    let draft = releases.find((release) => release.tag_name === tag)
    if (draft && !draft.draft) throw new Error('Published releases are never overwritten')
    if (!draft)
      draft = await api(`repos/${policy.repository}/releases`, {
        method: 'POST',
        body: {
          tag_name: tag,
          target_commitish: head,
          name: `DSH-PX ${version}`,
          body: notes,
          draft: true,
          prerelease: false
        }
      })
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
      body: { name: `DSH-PX ${version}`, body: notes, draft: false, make_latest: 'true' }
    })
    console.log(JSON.stringify({ published: published.html_url, head, version }))
  } finally {
    unlock()
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
