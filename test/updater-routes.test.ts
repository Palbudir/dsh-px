import { localHandler } from './http-fixture'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { signRelease, type ReleaseManifest } from '../src/shared/signed-release'
import { evaluatePackFeed, PACK_FEED_URL, PACK_TARGET } from '../packages/dsh-px-updater/src/pack-feed'
import products from '../config/products.json'

const pair = generateKeyPairSync('ed25519')
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const keyId = createHash('sha256').update(publicKey).digest('hex').slice(0, 24)
const keys = { [keyId]: publicKey }

function packManifest(version: string, changes: Partial<ReleaseManifest> = {}): ReleaseManifest {
  const name = `dsh-px-pack-${version}.tgz`
  return {
    schemaVersion: 1,
    product: 'pack',
    channel: 'preview',
    platform: 'any',
    version,
    packVersion: version,
    protocolGeneration: products.protocolGeneration,
    upgradeFromGenerations: [],
    hostVersion: products.desktop.hostVersion,
    upstreamCommit: 'a'.repeat(40),
    sourceCommit: 'b'.repeat(40),
    issuedAt: '2026-09-30T00:00:00.000Z',
    files: [
      {
        role: 'pack',
        name,
        url: `https://github.com/Palbudir/dsh-px/releases/download/pack-v${version}/${name}`,
        size: 10,
        sha256: 'c'.repeat(64),
        sha512: Buffer.alloc(64, 1).toString('base64')
      }
    ],
    ...changes
  }
}
const signed = (manifest: ReleaseManifest) => JSON.stringify(signRelease(manifest, keyId, privateKey))

test('the Pack feed is fixed, preview-only and bound to this protocol generation', () => {
  assert.equal(PACK_FEED_URL, 'https://raw.githubusercontent.com/Palbudir/dsh-px/updates/pack-preview.json')
  assert.deepEqual(PACK_TARGET, {
    product: 'pack',
    channel: 'preview',
    platform: 'any',
    protocolGeneration: products.protocolGeneration
  })
})

test('a verified newer Pack is announced for manual installation with its own release page', () => {
  const result = evaluatePackFeed(
    signed(packManifest(`0.${products.protocolGeneration}.0-alpha.2`)),
    `0.${products.protocolGeneration}.0-alpha.1`,
    new Date(0),
    keys
  )
  assert.equal(result.error, null)
  assert.equal(result.updateAvailable, true)
  assert.equal(result.install, 'manual')
  assert.equal(result.latest.pack, `0.${products.protocolGeneration}.0-alpha.2`)
  assert.equal(
    result.releaseUrl,
    `https://github.com/Palbudir/dsh-px/releases/tag/pack-v0.${products.protocolGeneration}.0-alpha.2`
  )
  const same = evaluatePackFeed(
    signed(packManifest(`0.${products.protocolGeneration}.0-alpha.1`)),
    `0.${products.protocolGeneration}.0-alpha.1`,
    new Date(0),
    keys
  )
  assert.equal(same.updateAvailable, false)
  assert.equal(same.error, null)
})

test('unsigned, foreign, wrong-product and wrong-generation feeds never report a version', () => {
  const other = generateKeyPairSync('ed25519')
  const foreign = JSON.stringify(
    signRelease(
      packManifest(`0.${products.protocolGeneration}.9`),
      keyId,
      other.privateKey.export({ type: 'pkcs8', format: 'pem' })
    )
  )
  const tampered = JSON.parse(signed(packManifest(`0.${products.protocolGeneration}.9`)))
  tampered.payload.version = tampered.payload.packVersion = `0.${products.protocolGeneration}.10`
  const desktop: ReleaseManifest = {
    ...packManifest(`0.${products.protocolGeneration}.9`),
    product: 'desktop',
    platform: 'win32-x64',
    upgradeFromGenerations: [products.protocolGeneration],
    files: [
      {
        role: 'installer',
        name: `DSH-PX-Desktop-0.${products.protocolGeneration}.9-win-x64.exe`,
        url: `https://github.com/Palbudir/dsh-px/releases/download/desktop-v0.${products.protocolGeneration}.9/DSH-PX-Desktop-0.${products.protocolGeneration}.9-win-x64.exe`,
        size: 10,
        sha256: 'c'.repeat(64),
        sha512: Buffer.alloc(64, 1).toString('base64')
      }
    ]
  }
  const next = packManifest(`0.${products.protocolGeneration + 1}.0`, {
    protocolGeneration: products.protocolGeneration + 1
  })
  for (const source of [
    'not json',
    JSON.stringify(packManifest(`0.${products.protocolGeneration}.9`)),
    foreign,
    JSON.stringify(tampered),
    signed(desktop),
    signed(next)
  ]) {
    const result = evaluatePackFeed(source, `0.${products.protocolGeneration}.0-alpha.1`, new Date(0), keys)
    assert.notEqual(result.error, null, source.slice(0, 40))
    assert.equal(result.latest.pack, null)
    assert.equal(result.updateAvailable, false)
    assert.equal(result.releaseUrl, null)
  }
  // The shipped keys are the pinned update keys, so a feed signed by a test key is rejected there.
  assert.notEqual(
    evaluatePackFeed(
      signed(packManifest(`0.${products.protocolGeneration}.9`)),
      `0.${products.protocolGeneration}.0-alpha.1`
    ).error,
    null
  )
})

test('the updater host exposes only status and a signed check; no desktop bridge is claimed', async (t) => {
  type Handler = (req: any, res: any) => Promise<void> | void
  const routes = new Map<string, Handler>()
  let dispose: (() => void) | undefined
  const mod = await import(pathToFileURL(resolve('packages/dsh-px-updater/lib/index.js')).href)
  mod.apply(
    {
      logger: { info: () => {} },
      inject: (_: string[], callback: (ctx: unknown) => void) =>
        callback({
          connection: { requestRejection: () => undefined },
          webServer: {
            register: (route: { path: string; handler: Handler }) => {
              routes.set(route.path, localHandler(route.handler))
              return () => routes.delete(route.path)
            }
          },
          effect: (fn: () => () => void) => {
            dispose = fn()
          }
        })
    },
    {
      registerTool: false,
      feedUrl: 'https://attacker.example/feed.json',
      routePrefix: '/elsewhere',
      repository: 'someone/else'
    }
  )
  // Feed, repository and route prefix overrides are ignored: the bundled client keeps working.
  assert.deepEqual([...routes.keys()].sort(), ['/dsh-px-updater/check', '/dsh-px-updater/status'])
  async function request(path: string) {
    let status = 0
    let body: any = {}
    await routes.get(`/dsh-px-updater/${path}`)!(
      { method: 'GET', url: `/dsh-px-updater/${path}`, headers: {} },
      {
        writeHead: (code: number) => {
          status = code
        },
        end: (value: string) => {
          body = JSON.parse(value)
        }
      }
    )
    return { status, body }
  }
  const status = await request('status')
  assert.equal(status.status, 200)
  // /status exposes only what the client shows; no local manifest path.
  assert.deepEqual(Object.keys(status.body.pack).sort(), ['candidate', 'hostVersion', 'version'])
  assert.ok(!JSON.stringify(status.body).includes('manifestPath'))
  assert.equal(status.body.version, products.pack.version)
  assert.equal(status.body.feed, PACK_FEED_URL)
  assert.equal(status.body.repository, 'Palbudir/dsh-px')
  const urls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(String(url))
    return new Response(signed(packManifest(`0.${products.protocolGeneration}.9`)))
  })
  const check = await request('check')
  // The feed override was ignored, and the test-key signature is not trusted by the shipped keys.
  assert.deepEqual(urls, [PACK_FEED_URL])
  // A failed check is a displayable result (200 + error), so the client can show the reason.
  assert.equal(check.status, 200)
  assert.match(check.body.error, /签名/)
  assert.equal(check.body.updateAvailable, false)
  assert.equal(check.body.latest.pack, null)
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('offline')
  })
  const offline = await request('check')
  assert.equal(offline.status, 200)
  assert.match(offline.body.error, /无法读取/)
  dispose?.()
  assert.equal(routes.size, 0)
})

test('a newer-generation Pack feed tells the user to update Desktop first', () => {
  const next = packManifest(`0.${products.protocolGeneration + 1}.0`, {
    protocolGeneration: products.protocolGeneration + 1
  })
  const result = evaluatePackFeed(
    signed(next),
    `0.${products.protocolGeneration}.0-alpha.1`,
    new Date(0),
    keys
  )
  assert.equal(result.updateAvailable, false)
  assert.match(result.error ?? '', /需要先更新桌面客户端/)
  assert.doesNotMatch(result.error ?? '', /协议代际/)
})
