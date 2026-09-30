/**
 * Read-only release packaging for the trusted build workflow. It never publishes, signs or uses
 * credentials: it verifies candidate outputs and writes the exact files the local controller may upload.
 *
 *   pack          quality gates + clean release Pack  -> <out>/{dsh-px-pack-<v>.tgz, artifact.json, release-manifest.json}
 *   desktop-pack  quality gates + clean release Pack  -> <out>/ (input for prepare-native-desktop)
 *   desktop       inspect one NSIS installer          -> <out>/{DSH-PX-Desktop-<v>-win-x64.exe, artifact.json, release-manifest.json}
 */
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyPackOutput, runQualityGates } from './release-quality.mjs'
import {
  assertPublishableAssetName,
  parseReleaseTag,
  releaseAssetNames,
  releaseTag
} from './release-version.mjs'

const sha = (value, label) => {
  if (!/^[a-f0-9]{40}$/.test(value ?? '')) throw new Error(`Exact ${label} SHA required`)
  return value
}
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** The release input names one product and must equal that product's reviewed version. */
export function releaseIdentity(release, products) {
  const parsed = parseReleaseTag(release)
  if (!parsed || releaseTag(parsed.product, parsed.version) !== release)
    throw new Error('Release must be desktop-v<version> or pack-v<version>')
  const expected = parsed.product === 'pack' ? products.pack.version : products.desktop.version
  if (parsed.version !== expected)
    throw new Error(`Release ${release} does not match the candidate ${parsed.product} version`)
  return parsed
}

/** Only regular files without links may enter a release directory. */
function regularFile(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new Error(`Release input must be a regular file: ${path}`)
  return readFileSync(path)
}

function digests(bytes) {
  return {
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sha512: createHash('sha512').update(bytes).digest('base64')
  }
}

/** Write the flat publishable directory and its manifest. Existing output is never overwritten. */
export function writeReleaseDirectory(output, { product, version, head, controllerSha, primary, artifact }) {
  sha(head, 'candidate')
  sha(controllerSha, 'controller')
  if (existsSync(output) && readdirSync(output).length)
    throw new Error('Release artifact directory must be empty; prepared assets will not be overwritten')
  mkdirSync(output, { recursive: true })
  const names = releaseAssetNames(product, version)
  const primaryName = product === 'desktop' ? names.installer : names.pack
  writeFileSync(join(output, primaryName), primary, { flag: 'wx' })
  writeFileSync(join(output, names.artifact), JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' })
  const files = [primaryName, names.artifact].map((name) => {
    assertPublishableAssetName(name)
    const bytes = readFileSync(join(output, name))
    return { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  })
  const manifest = {
    schemaVersion: 2,
    product,
    release: releaseTag(product, version),
    version,
    head,
    controllerSha,
    files
  }
  writeFileSync(join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx'
  })
  return manifest
}

/** Portable Pack metadata: identities and digests only, never build-machine paths. */
export function packArtifact(verified, products, nativePack) {
  return {
    schemaVersion: 1,
    product: 'pack',
    version: products.pack.version,
    file: verified.file,
    ...digests(readFileSync(verified.path)),
    candidate: false,
    sourceCommit: verified.manifest.dshPx.sourceCommit,
    sourceDirty: false,
    hostVersion: nativePack.hostVersion,
    upstreamCommit: nativePack.upstreamCommit,
    protocolGeneration: products.protocolGeneration
  }
}

/**
 * The electron-builder output directory must contain exactly one versioned installer, and no delta
 * or feed file may be carried forward. Any *.yml the builder wrote stays behind, unpublished.
 */
export function selectInstaller(dist, version) {
  const names = readdirSync(dist)
  const expected = releaseAssetNames('desktop', version).installer
  const installers = names.filter((name) => /\.exe$/i.test(name))
  if (installers.length !== 1 || installers[0] !== expected)
    throw new Error(`Expected exactly one installer ${expected}; found ${installers.join(', ') || 'none'}`)
  if (names.some((name) => /\.blockmap$/i.test(name)))
    throw new Error('Differential blockmap must not be produced')
  return join(dist, expected)
}

export function desktopArtifact({ installer, overlay, products, nativeDesktop, head, authenticode }) {
  if (
    overlay.sourceCommit !== head ||
    overlay.sourceDirty !== false ||
    overlay.upstream !== nativeDesktop.commit ||
    overlay.version !== products.desktop.version ||
    !/^[a-f0-9]{64}$/.test(overlay.packSha256 ?? '')
  )
    throw new Error('Desktop overlay does not describe this clean release commit')
  if (!['NotSigned', 'Valid'].includes(authenticode))
    throw new Error(`Unexpected Authenticode state ${authenticode}`)
  const bytes = regularFile(installer)
  return {
    schemaVersion: 1,
    product: 'desktop',
    version: products.desktop.version,
    file: releaseAssetNames('desktop', products.desktop.version).installer,
    ...digests(bytes),
    packVersion: products.desktop.packVersion,
    protocolGeneration: products.protocolGeneration,
    hostVersion: nativeDesktop.version,
    upstreamCommit: nativeDesktop.commit,
    sourceCommit: head,
    sourceDirty: false,
    originalMainSha256: overlay.originalMainSha256,
    mainSha256: overlay.mainSha256,
    packSha256: overlay.packSha256,
    authenticode
  }
}

function buildReleasePack(root, head, output) {
  const args = ['scripts/run.mjs', 'build-native-pack', output, `--expect-head=${head}`]
  if (process.env.DSH_PX_SIDEBAR_ARCHIVE) args.push(`--sidebar-archive=${process.env.DSH_PX_SIDEBAR_ARCHIVE}`)
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error('Release Pack build failed')
  const products = readJson(join(root, 'config/products.json')),
    nativePack = readJson(join(root, 'config/native-pack.json'))
  const verified = verifyPackOutput(output, { products, nativePack, head, candidate: false })
  return { ...verified, path: join(output, verified.file), products, nativePack }
}

function main() {
  const [command, ...rest] = process.argv.slice(2)
  const option = (name) => rest.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  const root = process.cwd()
  const head = sha(process.env.BUILD_HEAD, 'candidate')
  const controllerSha = sha(process.env.GITHUB_SHA, 'controller')
  const release = process.env.BUILD_RELEASE
  const out = option('out')
  if (!out) throw new Error('--out=<new directory> is required')
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== head)
    throw new Error('Candidate checkout is not the requested head')
  const pkg = readJson(join(root, 'package.json'))
  const products = readJson(join(root, 'config/products.json'))
  if (pkg.name !== 'dsh-px' || pkg.version !== products.desktop.version)
    throw new Error('Candidate package identity mismatch')
  const identity = releaseIdentity(release, products)
  if (command === 'pack' || command === 'desktop-pack') {
    if (command === 'pack' ? identity.product !== 'pack' : identity.product !== 'desktop')
      throw new Error(`${command} does not build ${release}`)
    runQualityGates(root)
    const work = resolve(out + '.work')
    const pack = buildReleasePack(root, head, work)
    if (command === 'desktop-pack') {
      mkdirSync(out, { recursive: false })
      copyFileSync(pack.path, join(out, pack.file))
      copyFileSync(join(work, 'artifact.json'), join(out, 'artifact.json'))
    } else
      writeReleaseDirectory(resolve(out), {
        product: 'pack',
        version: products.pack.version,
        head,
        controllerSha,
        primary: readFileSync(pack.path),
        artifact: packArtifact(pack, pack.products, pack.nativePack)
      })
    rmSync(work, { recursive: true, force: true })
    console.log(`Release Pack prepared: ${pack.file} ${pack.sha256}`)
    return
  }
  if (command === 'desktop') {
    if (identity.product !== 'desktop') throw new Error(`desktop does not build ${release}`)
    const upstream = option('upstream')
    if (!upstream) throw new Error('--upstream=<prepared official checkout> is required')
    const px = join(resolve(upstream), 'apps/desktop/.desktop-build/px')
    const installer = selectInstaller(join(px, 'dist'), products.desktop.version)
    const artifact = desktopArtifact({
      installer,
      overlay: readJson(join(px, 'overlay.json')),
      products,
      nativeDesktop: readJson(join(root, 'config/native-desktop.json')),
      head,
      authenticode: process.env.BUILD_AUTHENTICODE
    })
    writeReleaseDirectory(resolve(out), {
      product: 'desktop',
      version: products.desktop.version,
      head,
      controllerSha,
      primary: regularFile(installer),
      artifact
    })
    console.log(`Release Desktop prepared: ${artifact.file} ${artifact.sha256}`)
    return
  }
  throw new Error(
    'Usage: release-package.mjs pack|desktop-pack|desktop --out=<new directory> [--upstream=<dir>]'
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
