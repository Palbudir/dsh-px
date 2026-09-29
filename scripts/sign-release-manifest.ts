/**
 * Offline signer for PX update manifests. The private key must live outside the repository;
 * the result is re-verified against the pinned public keys before it is written.
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  signRelease,
  verifySignedRelease,
  type ReleaseFile,
  type ReleaseManifest,
  type SignedRelease
} from '../src/shared/signed-release'
import { validateProductCatalog } from '../src/shared/product-contract'
import { maintenanceArgs } from './maintenance-args'

export interface ReleaseInput {
  product: ReleaseManifest['product']
  channel: ReleaseManifest['channel']
  version: string
  packVersion: string
  protocolGeneration: number
  upgradeFromGenerations: number[]
  hostVersion: string
  upstreamCommit: string
  sourceCommit: string
  issuedAt: string
  files: { role: ReleaseFile['role']; path: string }[]
}

/** Hash local artifacts into a manifest whose URLs point at the fixed release tag. */
export function createReleaseManifest(input: ReleaseInput): ReleaseManifest {
  const files = input.files.map(({ role, path }): ReleaseFile => {
    const bytes = readFileSync(path),
      name = basename(path)
    return {
      role,
      name,
      url: `https://github.com/Palbudir/dsh-px/releases/download/${input.product}-v${input.version}/${name}`,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sha512: createHash('sha512').update(bytes).digest('base64')
    }
  })
  return {
    schemaVersion: 1,
    product: input.product,
    channel: input.channel,
    platform: input.product === 'pack' ? 'any' : 'win32-x64',
    version: input.version,
    packVersion: input.packVersion,
    protocolGeneration: input.protocolGeneration,
    upgradeFromGenerations: input.upgradeFromGenerations,
    hostVersion: input.hostVersion,
    upstreamCommit: input.upstreamCommit,
    sourceCommit: input.sourceCommit,
    issuedAt: input.issuedAt,
    files
  }
}

/** Sign, then prove the envelope verifies with the pinned keys for its own target. */
export function signAndVerify(
  manifest: ReleaseManifest,
  privateKeyPem: string,
  keys: Readonly<Record<string, string>>
): SignedRelease {
  const publicPem = createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: 'spki', format: 'pem' })
    .toString()
  const keyId = Object.keys(keys).find(
    (id) => createPublicKey(keys[id]).export({ type: 'spki', format: 'pem' }).toString() === publicPem
  )
  if (!keyId) throw new Error('Private key does not match any pinned update key')
  const envelope = signRelease(manifest, keyId, privateKeyPem)
  verifySignedRelease(JSON.stringify(envelope), keys, {
    product: manifest.product,
    channel: manifest.channel,
    platform: manifest.platform,
    protocolGeneration: manifest.protocolGeneration
  })
  return envelope
}

function main(argv: string[]) {
  const args = maintenanceArgs(argv)
  if (args.action !== 'sign') {
    process.stdout.write(
      'Usage: sign-release-manifest sign --product desktop|pack --channel preview|stable --file <role>=<path> [--file ...] [--upgrade-from <n> ...] --key <pem outside repo> --out <json> [--allow-dirty yes]\n'
    )
    return
  }
  args.allow(['--product', '--channel', '--file', '--upgrade-from', '--key', '--out', '--allow-dirty'])
  const root = resolve(globalThis.__DSH_REPO__ ?? '.')
  const read = (file: string) => JSON.parse(readFileSync(resolve(root, file), 'utf8'))
  const products = read('config/products.json'),
    pin = read('config/native-desktop.json'),
    keys = read('config/update-keys.json').keys
  validateProductCatalog(products)
  const product = args.one('--product') as ReleaseManifest['product']
  const channel = args.one('--channel') as ReleaseManifest['channel']
  const keyPath = resolve(args.one('--key'))
  const inside = relative(root, keyPath)
  if (!isAbsolute(inside) && !inside.startsWith('..'))
    throw new Error('Private key must be outside the repository')
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim()
  if (git('status', '--porcelain') && args.one('--allow-dirty', 'no') !== 'yes')
    throw new Error('Release manifests must be signed from a clean checkout')
  const files = args.many('--file').map((spec) => {
    const at = spec.indexOf('=')
    const role = spec.slice(0, at) as ReleaseFile['role'],
      path = resolve(spec.slice(at + 1))
    if (at < 1 || !existsSync(path) || !statSync(path).isFile()) throw new Error('Invalid --file ' + spec)
    return { role, path }
  })
  const version = product === 'pack' ? products.pack.version : products.desktop.version
  const manifest = createReleaseManifest({
    product,
    channel,
    version,
    packVersion: products.pack.version,
    protocolGeneration: products.protocolGeneration,
    upgradeFromGenerations: args.many('--upgrade-from').map(Number),
    hostVersion: product === 'pack' ? products.pack.hostVersions[0] : products.desktop.hostVersion,
    upstreamCommit: pin.commit,
    sourceCommit: git('rev-parse', 'HEAD'),
    issuedAt: new Date().toISOString(),
    files
  })
  const envelope = signAndVerify(manifest, readFileSync(keyPath, 'utf8'), keys)
  const out = resolve(args.one('--out'))
  writeFileSync(out, JSON.stringify(envelope, null, 2) + '\n', { flag: 'wx' })
  process.stdout.write(`Signed ${product}-v${version} (${channel}) with ${envelope.keyId}: ${out}\n`)
}

declare global {
  var __DSH_REPO__: string | undefined
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
