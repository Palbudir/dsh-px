import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReleaseManifest, signAndVerify } from '../scripts/sign-release-manifest'
import { verifySignedRelease } from '../src/shared/signed-release'

function keyPair() {
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey,
    keyId: createHash('sha256').update(publicKey).digest('hex').slice(0, 24)
  }
}

test('offline signer hashes real artifacts and yields a manifest the updater accepts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'px-sign-'))
  try {
    const installer = join(dir, 'DSH-PX-Desktop-0.2.0-alpha.1-win-x64.exe')
    writeFileSync(installer, 'installer bytes')
    const manifest = createReleaseManifest({
      product: 'desktop',
      channel: 'preview',
      version: '0.2.0-alpha.1',
      packVersion: '0.2.0-alpha.1',
      protocolGeneration: 2,
      upgradeFromGenerations: [2],
      hostVersion: '0.2.0-rc.1',
      upstreamCommit: 'a'.repeat(40),
      sourceCommit: 'b'.repeat(40),
      issuedAt: '2026-09-29T00:00:00.000Z',
      files: [{ role: 'installer', path: installer }]
    })
    assert.equal(manifest.files[0].size, 15)
    assert.equal(manifest.files[0].sha256, createHash('sha256').update('installer bytes').digest('hex'))
    assert.equal(
      manifest.files[0].url,
      'https://github.com/Palbudir/dsh-px/releases/download/desktop-v0.2.0-alpha.1/DSH-PX-Desktop-0.2.0-alpha.1-win-x64.exe'
    )
    const k = keyPair()
    const keys = { [k.keyId]: k.publicKey }
    const envelope = signAndVerify(manifest, k.privateKey, keys)
    assert.equal(envelope.keyId, k.keyId)
    const target = {
      product: 'desktop',
      channel: 'preview',
      platform: 'win32-x64',
      protocolGeneration: 2
    } as const
    assert.equal(verifySignedRelease(JSON.stringify(envelope), keys, target).version, '0.2.0-alpha.1')
    // A key outside the pinned set is refused before anything is signed.
    assert.throws(() => signAndVerify(manifest, keyPair().privateKey, keys), /pinned update key/)
    // Invalid manifests (preview version on stable) are rejected by the shared schema.
    assert.throws(() => signAndVerify({ ...manifest, channel: 'stable' }, k.privateKey, keys))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
