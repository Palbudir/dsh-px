import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPackUpdateWindow, MAX_PACK_DOWNLOAD_BYTES } from '../src/main/pack-update-window'

function harness(size: number, actualSize = size, current = '0.7.0-alpha.1') {
  let handler: any,
    window: any,
    stageCalls = 0,
    downloadCalls = 0,
    received = 0,
    cancelled = false
  class Window {
    webContents = { mainFrame: { url: '' }, setWindowOpenHandler() {}, on() {} }
    constructor() {
      window = this
    }
    isDestroyed() {
      return false
    }
    show() {}
    focus() {}
    on() {}
    async loadFile(path: string) {
      this.webContents.mainFrame.url = pathToFileURL(path).href
    }
  }
  const deployment: any = {
    options: { bundled: { version: current } },
    read: () => ({ active: { version: current } }),
    manifest: () => ({
      version: '0.7.2-alpha.1',
      files: [{ url: 'https://example.invalid/pack.tgz', size }]
    }),
    stage: (_signed: string, bytes: Buffer) => {
      stageCalls++
      received = bytes.length
      if (received !== size) throw Error('Signed archive size mismatch')
      assert.equal(
        bytes.every((byte) => byte === 0x5a),
        true,
        'stream chunks are copied intact'
      )
      return { version: '0.7.2-alpha.1' }
    }
  }
  const controller = createPackUpdateWindow(
    {
      app: { getVersion: () => '0.7.0-alpha.1', on() {} },
      BrowserWindow: Window,
      ipcMain: {
        handle: (_name: string, fn: any) => {
          handler = fn
        }
      },
      net: {
        fetch: async (url: string) => {
          if (url.endsWith('pack-preview.json')) return new Response('verified manifest fixture')
          downloadCalls++
          let remaining = actualSize
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!remaining) {
                  controller.close()
                  return
                }
                const chunk = Math.min(remaining, 1024 * 1024)
                remaining -= chunk
                controller.enqueue(new Uint8Array(chunk).fill(0x5a))
              },
              cancel() {
                cancelled = true
              }
            })
          )
        }
      }
    },
    {
      assets: resolve('build-test/update-window-fixture'),
      deployment: () => deployment,
      desktop: { state: { phase: 'idle' } },
      restart: async () => false
    }
  )
  controller.open()
  return {
    call: (action: string) =>
      handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, action),
    foreign: () => handler({ sender: {}, senderFrame: window.webContents.mainFrame }, 'download-pack'),
    counts: () => ({ stageCalls, downloadCalls, received, cancelled })
  }
}

test('native updater downloads and stages a signed-size Pack above the old 32 MiB cap', async () => {
  const h = harness(33 * 1024 * 1024)
  assert.equal((await h.call('check-pack')).pack.phase, 'available')
  assert.equal((await h.call('download-pack')).pack.phase, 'ready')
  assert.equal(h.counts().received, 33 * 1024 * 1024)
  assert.equal(h.counts().stageCalls, 1)
})
test('oversized supported download is cancelled at signed size and never staged', async () => {
  const h = harness(33 * 1024 * 1024, 40 * 1024 * 1024)
  await h.call('check-pack')
  const result = await h.call('download-pack')
  assert.match(result.pack.message, /超出签名清单大小/)
  assert.equal(h.counts().stageCalls, 0)
  assert.equal(h.counts().cancelled, true)
})
test('expanded allocation cap accepts a Pack above 128 MiB and offers the 512 MiB boundary', async () => {
  const h = harness(129 * 1024 * 1024)
  await h.call('check-pack')
  assert.equal((await h.call('download-pack')).pack.phase, 'ready')
  assert.equal(h.counts().received, 129 * 1024 * 1024)
  assert.equal((await harness(MAX_PACK_DOWNLOAD_BYTES).call('check-pack')).pack.phase, 'available')
})
test('unsupported Pack size is reported before downloading, rather than as a signature mismatch', async () => {
  const h = harness(MAX_PACK_DOWNLOAD_BYTES + 1)
  const result = await h.call('check-pack')
  assert.equal(result.pack.phase, 'error')
  assert.match(result.pack.message, /512 MiB/)
  assert.equal(h.counts().downloadCalls, 0)
})

test('an equal or newer installed Pack stays current without applying a download-only limit', async () => {
  for (const version of ['0.7.2-alpha.1', '0.7.3-alpha.1']) {
    const h = harness(MAX_PACK_DOWNLOAD_BYTES + 1, MAX_PACK_DOWNLOAD_BYTES + 1, version)
    assert.equal((await h.call('check-pack')).pack.phase, 'current')
    assert.equal(h.counts().downloadCalls, 0)
  }
})
test('truncated Pack still fails staging and foreign updater callers are rejected', async () => {
  const h = harness(33 * 1024 * 1024, 1024)
  await assert.rejects(h.foreign(), /not the sender/)
  await h.call('check-pack')
  assert.match((await h.call('download-pack')).pack.message, /size mismatch/)
})
