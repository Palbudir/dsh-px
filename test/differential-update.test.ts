import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { createServer, request, type RequestOptions } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { NsisUpdater } from 'electron-updater'
import { HttpExecutor, configureRequestUrl, configureRequestOptions } from 'builder-util-runtime'
import { configureSignedUpdates } from '../src/main/signed-update-provider'
import { signRelease, type ReleaseManifest } from '../src/shared/signed-release'

const digest = (body: Buffer, algorithm: string, encoding: 'hex' | 'base64') =>
  createHash(algorithm).update(body).digest(encoding)
const pair = generateKeyPairSync('ed25519')
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const keyId = createHash('sha256').update(publicKey).digest('hex').slice(0, 24)
const block = (parts: Buffer[]) =>
  gzipSync(
    JSON.stringify({
      version: '2',
      files: [
        {
          name: 'file',
          offset: 0,
          sizes: parts.map((p) => p.length),
          checksums: parts.map((p) => digest(p, 'sha256', 'base64'))
        }
      ]
    })
  )

for (const mode of ['delta', 'missing-baseline', 'damaged-map', 'damaged-baseline'] as const) {
  test(`real NSIS updater verifies the final installer after ${mode}`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'px-delta-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const chunks = Array.from({ length: 16 }, () => randomBytes(64 * 1024))
    const changed = [...chunks]
    changed[7] = randomBytes(64 * 1024)
    const old = Buffer.concat(chunks),
      next = Buffer.concat(changed)
    const oldVersion = '0.3.2-alpha.1',
      nextVersion = '0.3.3-alpha.1'
    const installer = `DSH-PX-Desktop-${nextVersion}-win-x64.exe`
    const path = `/Palbudir/dsh-px/releases/download/desktop-v${nextVersion}/${installer}`
    const oldPath = path.replaceAll(nextVersion, oldVersion)
    const map = block(changed),
      oldMap = block(chunks)
    const describe = (name: string, bytes: Buffer, role: 'installer' | 'blockmap') => ({
      role,
      name,
      url: 'https://github.com' + path + (role === 'blockmap' ? '.blockmap' : ''),
      size: bytes.length,
      sha256: digest(bytes, 'sha256', 'hex'),
      sha512: digest(bytes, 'sha512', 'base64')
    })
    const manifest: ReleaseManifest = {
      schemaVersion: 1,
      product: 'desktop',
      channel: 'preview',
      platform: 'win32-x64',
      protocolGeneration: 3,
      version: nextVersion,
      packVersion: nextVersion,
      hostVersion: '0.2.0-rc.2',
      sourceCommit: 'a'.repeat(40),
      upstreamCommit: 'b'.repeat(40),
      issuedAt: new Date().toISOString(),
      upgradeFromGenerations: [3],
      files: [describe(installer, next, 'installer'), describe(installer + '.blockmap', map, 'blockmap')]
    }
    const envelope = Buffer.from(JSON.stringify(signRelease(manifest, keyId, privateKey)))
    let downloaded = 0,
      ranged = 0,
      full = 0
    const server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost')
      if (url.pathname.endsWith('/desktop-preview.json')) {
        res.end(envelope)
        return
      }
      if (url.pathname === path + '.blockmap') {
        res.end(mode === 'damaged-map' ? Buffer.from('bad') : map)
        return
      }
      if (url.pathname === oldPath + '.blockmap') {
        res.end(oldMap)
        return
      }
      if (url.pathname !== path) {
        res.writeHead(404)
        res.end()
        return
      }
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/)
      if (range) {
        const start = Number(range[1]),
          end = Number(range[2])
        const bytes = next.subarray(start, end + 1)
        ranged++
        downloaded += bytes.length
        res.writeHead(206, {
          'Content-Length': bytes.length,
          'Content-Range': `bytes ${start}-${end}/${next.length}`
        })
        res.end(bytes)
      } else {
        full++
        downloaded += next.length
        res.writeHead(200, { 'Content-Length': next.length })
        res.end(next)
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        })
    )
    const port = (server.address() as { port: number }).port
    class FixtureExecutor extends HttpExecutor<any> {
      createRequest(options: RequestOptions, callback: (response: any) => void) {
        return request(
          { ...options, protocol: 'http:', hostname: '127.0.0.1', port, agent: undefined },
          callback
        )
      }
      download(url: URL, destination: string, options: any): Promise<string> {
        return options.cancellationToken.createPromise(
          (resolve: (value: string) => void, reject: (error: Error) => void, onCancel: any) => {
            const requestOptions: any = { headers: options.headers }
            configureRequestUrl(url, requestOptions)
            configureRequestOptions(requestOptions)
            this.doDownload(
              requestOptions,
              {
                destination,
                options,
                onCancel,
                callback: (error: Error | null) => (error ? reject(error) : resolve(destination)),
                responseHandler: null
              } as any,
              0
            )
          }
        )
      }
    }
    const config = join(root, 'update.json')
    writeFileSync(config, JSON.stringify({ updaterCacheDirName: 'cache' }))
    mkdirSync(join(root, 'cache'))
    if (mode !== 'missing-baseline')
      writeFileSync(
        join(root, 'cache/installer.exe'),
        mode === 'damaged-baseline' ? randomBytes(old.length) : old
      )
    const app = {
      version: oldVersion,
      name: 'fixture',
      isPackaged: true,
      appUpdateConfigPath: config,
      userDataPath: root,
      baseCachePath: root,
      whenReady: async () => {},
      relaunch() {
        assert.fail('must not launch an installer in a download test')
      },
      quit() {
        assert.fail('must not quit')
      },
      onQuit() {}
    }
    const updater = new NsisUpdater(undefined, app)
    updater.logger = null
    ;(updater as any).httpExecutor = new FixtureExecutor()
    configureSignedUpdates(updater, { [keyId]: publicKey }, 'preview', 3)
    const found = await updater.checkForUpdates()
    assert.equal(found?.isUpdateAvailable, true)
    const files = await updater.downloadUpdate()
    assert.deepEqual(readFileSync(files[0]), next)
    if (mode === 'delta') {
      assert.equal(full, 0)
      assert.equal(downloaded, 64 * 1024)
      assert.ok(ranged > 0)
    } else assert.equal(full, 1, 'an unusable delta must fall back to the complete signed installer')
  })
}
