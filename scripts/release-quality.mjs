import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FEATURE_BUNDLES } from '../src/shared/distribution.ts'

/**
 * Verify a build-native-pack output directory against its own archive bytes and the pinned products.
 * Candidate builds are isolated validation only; release builds must be clean and bound to `head`.
 */
export function verifyPackOutput(directory, { products, nativePack, head, candidate }) {
  if (!/^[a-f0-9]{40}$/.test(head ?? '')) throw new Error('Exact Pack source commit required')
  const version = products.pack.version
  const tgz = `dsh-px-pack-${version}.tgz`
  // The builder keeps the SRI-verified upstream sidebar archive beside its output; nothing else is a Pack.
  const names = readdirSync(directory).filter(
    (name) => name.endsWith('.tgz') && name !== 'sidebar-source.tgz'
  )
  if (names.length !== 1 || names[0] !== tgz)
    throw new Error('Pack output must contain exactly its versioned tgz')
  const artifact = JSON.parse(readFileSync(join(directory, 'artifact.json'), 'utf8'))
  const bytes = readFileSync(join(directory, tgz))
  const sha256 = createHash('sha256').update(bytes).digest('hex'),
    sha512 = createHash('sha512').update(bytes).digest('base64')
  if (
    artifact.version !== version ||
    artifact.candidate !== candidate ||
    artifact.artifact !== tgz ||
    artifact.hostVersion !== nativePack.hostVersion ||
    artifact.upstreamCommit !== nativePack.upstreamCommit ||
    artifact.protocolGeneration !== products.protocolGeneration ||
    artifact.sourceCommit !== head ||
    artifact.size !== bytes.length ||
    artifact.sha256 !== sha256 ||
    artifact.sha512 !== sha512
  )
    throw new Error('artifact.json does not describe this Pack archive')
  // Relative names keep GNU tar from reading a drive-letter colon as a remote host.
  const tar = (...args) =>
    execFileSync('tar', args, {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    })
  const entries = tar('-tzf', tgz)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((name) => name.replaceAll('\\', '/'))
  for (const name of entries)
    if (!/^package(?:\/|$)/.test(name) || name.split('/').includes('..') || name.startsWith('/'))
      throw new Error(`Pack archive contains an unsafe path: ${name}`)
  const manifest = JSON.parse(tar('-xOzf', tgz, 'package/package.json'))
  const px = manifest.dshPx ?? {}
  if (
    manifest.name !== 'dsh-px-pack' ||
    manifest.version !== version ||
    px.candidate !== candidate ||
    px.sourceCommit !== head ||
    px.sourceDirty !== artifact.sourceDirty ||
    px.hostVersion !== nativePack.hostVersion ||
    px.upstreamCommit !== nativePack.upstreamCommit ||
    px.protocolGeneration !== products.protocolGeneration
  )
    throw new Error('Pack manifest inside the archive does not match the product contract')
  const present = new Set(entries.map((name) => name.replace(/\/$/, '')))
  for (const file of ['package/package.json', 'package/cordis.patch.yml', 'package/index.js'])
    if (!present.has(file)) throw new Error(`Pack archive is missing ${file}`)
  if (!Array.isArray(manifest.bundledDependencies) || !manifest.bundledDependencies.length)
    throw new Error('Pack archive declares no bundled members')
  for (const member of manifest.bundledDependencies)
    if (!present.has(`package/node_modules/${member}/package.json`))
      throw new Error(`Pack archive is missing bundled member ${member}`)
  if (products.protocolGeneration >= 3) {
    const distribution = JSON.parse(tar('-xOzf', tgz, 'package/distribution.json'))
    if (
      distribution.schemaVersion !== 1 ||
      distribution.version !== version ||
      distribution.foundation?.name !== 'dsh-px-core' ||
      distribution.features?.length !== FEATURE_BUNDLES.length ||
      !FEATURE_BUNDLES.every((name) => distribution.features.filter((f) => f.name === name).length === 1)
    )
      throw Error('Pack distribution does not contain the foundation and declared feature bundles')
    for (const entry of [distribution.foundation, ...distribution.features]) {
      if (entry.version !== version || entry.file !== `distribution/${entry.name}-${version}.tgz`)
        throw Error('Invalid distribution member')
      const member = execFileSync('tar', ['-xOzf', tgz, 'package/' + entry.file], {
        cwd: directory,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024
      })
      if (createHash('sha256').update(member).digest('hex') !== entry.sha256)
        throw Error('Distribution member digest mismatch')
      const metadata = JSON.parse(
        execFileSync('tar', ['-xOzf', '-', 'package/package.json'], {
          input: member,
          encoding: 'utf8',
          windowsHide: true
        })
      )
      if (metadata.name !== entry.name || metadata.version !== version)
        throw Error('Distribution member identity mismatch')
    }
  }
  if (!candidate && (artifact.sourceDirty !== false || px.sourceDirty !== false))
    throw new Error('Release Pack must be built from a clean checkout')
  return { file: tgz, size: bytes.length, sha256, sha512, manifest }
}

function readJson(file) {
  return JSON.parse(readFileSync(resolve(file), 'utf8'))
}

/** Build a Pack into a fresh private directory below the OS temp root and verify it. */
export function buildAndVerifyPack({ candidate, root = process.cwd() }) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  }).trim()
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'dshpx-pack-')))
  const output = join(parent, 'pack')
  const args = ['scripts/run.mjs', 'build-native-pack', output]
  if (candidate) args.push('--candidate')
  if (process.env.DSH_PX_SIDEBAR_ARCHIVE) args.push(`--sidebar-archive=${process.env.DSH_PX_SIDEBAR_ARCHIVE}`)
  try {
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true })
    if (result.error || result.status !== 0) throw new Error('Native Pack build failed')
    const verified = verifyPackOutput(output, {
      products: readJson(join(root, 'config/products.json')),
      nativePack: readJson(join(root, 'config/native-pack.json')),
      head,
      candidate
    })
    return { ...verified, output, parent, head }
  } catch (error) {
    rmSync(parent, { recursive: true, force: true })
    throw error
  }
}

/** Shared by branch verification and release; a gate failure always stops subsequent steps. */
export function runQualityGates(root = process.cwd()) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const commands = [
    [npm, ['run', 'typecheck']],
    // check:repo includes the secret scan.
    [npm, ['run', 'check:repo']],
    [process.execPath, ['scripts/check-roadmap.mjs']],
    [npm, ['run', 'test']],
    // Tests rebuild the tracked plugin artifacts; the checkout must remain exactly the reviewed tree.
    ['git', ['diff', '--exit-code']],
    ['git', ['status', '--porcelain', '--untracked-files=all']]
  ]
  for (const [exe, args] of commands) {
    const result = spawnSync(exe, args, {
      cwd: root,
      stdio: exe === 'git' && args[0] === 'status' ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      shell: process.platform === 'win32' && exe === npm,
      windowsHide: true,
      encoding: 'utf8'
    })
    if (result.error || result.status !== 0) throw new Error(`Quality gate failed: ${exe} ${args.join(' ')}`)
    if (args[0] === 'status' && result.stdout.trim()) {
      process.stderr.write(result.stdout)
      throw new Error('Quality gates left untracked or modified files in the checkout')
    }
  }
  const pack = buildAndVerifyPack({ candidate: true, root })
  try {
    console.log(`Candidate Pack verified: ${pack.file} ${pack.sha256}`)
  } finally {
    const base = realpathSync(tmpdir())
    if (pack.parent.startsWith(base + sep)) rmSync(pack.parent, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!existsSync('config/products.json') || !statSync('config/products.json').isFile())
      throw new Error('Run the quality controller from a DSH-PX checkout')
    runQualityGates()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
