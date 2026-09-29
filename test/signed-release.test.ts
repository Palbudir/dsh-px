import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createHash } from 'node:crypto'
import { signRelease, verifySignedRelease, type ReleaseManifest } from '../src/shared/signed-release'
import { SignedUpdateProvider, configureSignedUpdates } from '../src/main/signed-update-provider'
const pair = generateKeyPairSync('ed25519')
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const keyId = createHash('sha256').update(publicKey).digest('hex').slice(0, 24)
const keys = { [keyId]: publicKey }
const target = {
  product: 'desktop',
  channel: 'preview',
  platform: 'win32-x64',
  protocolGeneration: 2
} as const
const manifest: ReleaseManifest = {
  schemaVersion: 1,
  ...target,
  upgradeFromGenerations: [2],
  version: '0.2.0-beta.1',
  packVersion: '0.2.1-beta.1',
  hostVersion: '0.2.0-rc.1',
  upstreamCommit: 'a'.repeat(40),
  sourceCommit: 'b'.repeat(40),
  issuedAt: '2026-09-29T00:00:00.000Z',
  files: [
    {
      role: 'installer',
      name: 'DSH-PX-Setup.exe',
      url: 'https://github.com/Palbudir/dsh-px/releases/download/desktop-v0.2.0-beta.1/DSH-PX-Setup.exe',
      size: 123,
      sha256: 'c'.repeat(64),
      sha512: Buffer.alloc(64, 1).toString('base64')
    }
  ]
}

test('Electron custom provider resolves only the immutable installer from its verified candidate', async () => {
  const envelope = JSON.stringify(signRelease(manifest, keyId, privateKey))
  const configuration = {
    provider: 'custom' as const,
    updateProvider: SignedUpdateProvider,
    url: 'https://raw.githubusercontent.com/Palbudir/dsh-px/updates/desktop-preview.json',
    keys,
    target
  }
  const runtime: any = {
    platform: 'win32',
    isUseMultipleRangeRequest: false,
    executor: {
      request: async (options: any) => {
        assert.equal(options.hostname, 'raw.githubusercontent.com')
        return envelope
      }
    }
  }
  const provider = new SignedUpdateProvider(configuration, {} as any, runtime)
  const info = await provider.getLatestVersion()
  info.files[0].url = 'https://other.example/changed.exe'
  assert.equal(provider.resolveFiles(info)[0].url.href, manifest.files[0].url)
  assert.equal(provider.resolveFiles(info)[0].info.sha512, manifest.files[0].sha512)
  assert.throws(() => provider.resolveFiles({ ...info }), /签名清单/)
  Reflect.set(info, 'version', '0.2.99')
  assert.throws(() => provider.resolveFiles(info), /签名清单/)
  assert.throws(
    () => new SignedUpdateProvider({ ...configuration, url: 'https://other.example' }, {} as any, runtime)
  )
})

test('signed updates require explicit full-installer download and never enable downgrade or web installers', () => {
  let feed: any
  const updater: any = {
    setFeedURL: (options: unknown) => {
      feed = options
    }
  }
  configureSignedUpdates(updater, keys, 'preview', 2)
  assert.equal(feed.provider, 'custom')
  assert.equal(feed.updateProvider, SignedUpdateProvider)
  assert.equal(updater.disableDifferentialDownload, true)
  assert.equal(updater.disableWebInstaller, true)
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.allowDowngrade, false)
})

test('a complete Desktop upgrade can authorize an older generation without permitting mixed Pack generations', () => {
  const future = structuredClone(manifest)
  future.version = '0.3.0-beta.1'
  future.packVersion = '0.3.1-beta.1'
  future.protocolGeneration = 3
  future.upgradeFromGenerations = [2, 3]
  future.files[0].url = future.files[0].url.replace('desktop-v0.2.0-beta.1', 'desktop-v0.3.0-beta.1')
  const source = JSON.stringify(signRelease(future, keyId, privateKey))
  assert.equal(verifySignedRelease(source, keys, target).protocolGeneration, 3)
  assert.throws(() => verifySignedRelease(source, keys, { ...target, protocolGeneration: 1 }))
  future.upgradeFromGenerations = [3]
  assert.throws(() =>
    verifySignedRelease(JSON.stringify(signRelease(future, keyId, privateKey)), keys, target)
  )
})
test('signed metadata binds independent Pack version, exact product, channel and immutable file digests', () => {
  const source = JSON.stringify(signRelease(manifest, keyId, privateKey))
  const verified = verifySignedRelease(source, keys, target)
  assert.equal(verified.packVersion, '0.2.1-beta.1')
  assert.ok(Object.isFrozen(verified.files[0]))
  assert.throws(() => verifySignedRelease(source, keys, { ...target, product: 'pack', platform: 'any' }))
  assert.throws(() => verifySignedRelease(source, keys, { ...target, channel: 'stable' }))
  assert.throws(() => verifySignedRelease(source, keys, { ...target, protocolGeneration: 3 }))
  assert.throws(() => verifySignedRelease(source, {}, target))
  const tampered = JSON.parse(source)
  tampered.payload.files[0].sha512 = Buffer.alloc(64, 2).toString('base64')
  assert.throws(() => verifySignedRelease(JSON.stringify(tampered), keys, target), /签名校验失败/)
})
test('even signed manifests reject wrong origins, file kinds, duplicate entries and invalid identities', () => {
  for (const change of [
    (m: ReleaseManifest) => {
      m.files[0].url = 'https://other.example/installer.exe'
    },
    (m: ReleaseManifest) => {
      m.files[0].role = 'pack'
    },
    (m: ReleaseManifest) => {
      m.files.push(m.files[0])
    },
    (m: ReleaseManifest) => {
      m.files[0].size = -1
    },
    (m: ReleaseManifest) => {
      m.packVersion = '0.3.0'
    },
    (m: ReleaseManifest) => {
      m.sourceCommit = 'branch-name'
    },
    (m: ReleaseManifest) => {
      m.channel = 'stable'
    }
  ]) {
    const copy = structuredClone(manifest)
    change(copy)
    assert.throws(() => signRelease(copy, keyId, privateKey))
  }
})
