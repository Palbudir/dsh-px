import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, linkSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { parseTabs, visibleTabs, closeTabState } from '../packages/dsh-px-workspace/src/client/tab-state'
import { createDraftCell } from '../packages/shared/draft-store'
import { requestJson, RequestError } from '../packages/shared/client-http'
import { decodeMetadata, fetchMetadata } from '../packages/dsh-px-updater/src/metadata'
import { WorkspaceStore, Scheduler } from '../packages/dsh-px-workspace/src/store'
import { managedArtifacts, MANAGED_PLUGIN_NAMES } from '../src/shared/plugin-catalog'
import { trustedLocalRequest } from '../packages/shared/request-trust'
import { createOperation } from '../packages/shared/operation'
import { summarizeAppLog } from '../src/shared/log-summary'

test('closing a pinned tab selects its visual neighbour and restores legacy tab records', () => {
  const tabs = parseTabs(
    JSON.stringify({ ids: ['a', 'owner', 'b'], pins: ['b'], closed: [], titles: { a: 'A' } })
  )
  assert.deepEqual(visibleTabs(tabs), ['b', 'a', 'owner'])
  const closed = closeTabState(tabs, 'b', ['a', 'owner', 'b'])
  assert.equal(closed.next, 'a')
  assert.equal(closed.tabs.closed[0], 'b')
  assert.equal(closeTabState(tabs, 'b', ['owner']).next, 'owner')
  assert.equal(parseTabs('{bad').ids.length, 0)
})
test('restoring tabs does not silently drop the sixty-first and later conversations', () => {
  const ids = Array.from({ length: 85 }, (_, i) => `session-${i}`)
  assert.deepEqual(parseTabs(JSON.stringify({ ids })).ids, ids)
})
test('form drafts survive unmount/remount, remain session scoped, and never submit', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v)
    }
  }
  const cell = createDraftCell('a', { title: '', prompt: '', enabled: false }, storage)
  cell.set((old) => ({ ...old, title: '未保存标题' }))
  cell.set((old) => ({ ...old, prompt: '未保存要求' }))
  const remounted = createDraftCell('a', { title: '', prompt: '', enabled: false }, storage)
  assert.equal(remounted.getSnapshot().title, '未保存标题')
  assert.equal(remounted.getSnapshot().prompt, '未保存要求')
  assert.equal(remounted.getSnapshot().enabled, false)
  assert.equal(createDraftCell('b', { title: '' }, storage).getSnapshot().title, '')
})
test('quota failures preserve in-memory edits and unreadable storage is not overwritten on read', () => {
  let writes = 0
  const storage = {
    getItem: () => '{broken',
    setItem: () => {
      writes++
      throw new Error('quota')
    }
  }
  const cell = createDraftCell('draft', { note: '' }, storage)
  assert.equal(writes, 0)
  assert.equal(cell.set({ note: '仍可复制的草稿' }), false)
  assert.equal(cell.isPersisted(), false)
  assert.equal(cell.getSnapshot().note, '仍可复制的草稿')
})
test('HTTP caller cancellation is honoured instead of being replaced by the timeout signal', async (t) => {
  let requestSignal: AbortSignal | undefined
  t.mock.method(
    globalThis,
    'fetch',
    (_url: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        requestSignal = init.signal as AbortSignal
        requestSignal.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
      })
  )
  const controller = new AbortController(),
    pending = requestJson('/quality', { signal: controller.signal })
  controller.abort(new Error('caller cancelled'))
  await assert.rejects(pending, /caller cancelled/)
  assert.ok(requestSignal?.aborted)
})
test('non-JSON HTTP failures preserve status without showing raw response content', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('PRIVATE_RAW_RESPONSE', { status: 503 }))
  await assert.rejects(
    requestJson('/quality'),
    (e: unknown) =>
      e instanceof RequestError &&
      e.status === 503 &&
      e.code === 'INVALID_RESPONSE' &&
      !e.message.includes('PRIVATE_RAW_RESPONSE')
  )
})
test('metadata handles raw compression and already-decoded fetch responses without double decoding', () => {
  const bytes = Buffer.from('{"version":"1.2.3"}')
  for (const [encoded, encoding] of [
    [bytes, 'gzip'],
    [gzipSync(bytes), 'gzip'],
    [deflateSync(bytes), 'deflate'],
    [brotliCompressSync(bytes), 'br']
  ] as const)
    assert.equal(decodeMetadata(encoded, encoding).version, '1.2.3')
  assert.throws(
    () => decodeMetadata(Buffer.from('SECRET_BAD_BODY'), null),
    (error) => !String(error).includes('SECRET_BAD_BODY')
  )
  assert.throws(() => decodeMetadata(gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1, 65)), 'gzip'), /压缩数据/)
})
test('metadata fetch requests identity encoding and enforces bounded reads', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('accept-encoding'), 'identity')
    return new Response('{"version":"2.0.0"}')
  })
  assert.equal((await fetchMetadata('https://metadata.example.test', 5000)).version, '2.0.0')
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)))
  await assert.rejects(fetchMetadata('https://metadata.example.test', 5000), /上限/)
})
test('annotation pages do not lose records sharing a timestamp and returned values are detached', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-quality-'))
  try {
    const store = new WorkspaceStore(join(root, 'state.json'))
    store.update((state) => {
      state.annotations = Array.from({ length: 45 }, (_, i) => ({
        id: `note-${String(i).padStart(3, '0')}`,
        sessionId: 'a',
        messageId: 'm',
        seq: 1,
        role: 'user',
        sourceHash: 'a'.repeat(64),
        quote: '原文',
        note: '批注',
        updatedAt: 100
      }))
    })
    const ids: string[] = []
    let before: string | undefined
    do {
      const page = store.annotations('a', before)
      assert.ok(page.annotations.length <= 20)
      ids.push(...page.annotations.map((a) => a.id))
      page.annotations[0].note = '不应改动存储'
      before = page.nextBefore ?? undefined
    } while (before)
    assert.equal(new Set(ids).size, 45)
    assert.equal(store.annotations('a').annotations[0].note, '批注')
    assert.throws(() => store.annotations('a', 'bad'), /分页参数/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('idle scheduler reads task state without cloning the annotation collection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-quality-'))
  try {
    const store = new WorkspaceStore(join(root, 'state.json'))
    const scheduler = new Scheduler(store, async () => {
      assert.fail('should stay idle')
    })
    store.snapshot = () => {
      throw new Error('unnecessary full-state clone')
    }
    await scheduler.tick()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('timezone changes while the service is running pause future tasks before they become due', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-quality-'))
  let zone = 'Asia/Shanghai'
  try {
    const store = new WorkspaceStore(join(root, 'state.json'))
    const scheduler = new Scheduler(
      store,
      async () => {
        assert.fail('timezone changed')
      },
      () => zone,
      () => 10000
    )
    scheduler.save({
      title: '定时任务',
      sessionId: 'a',
      prompt: '工作要求',
      timing: { kind: 'interval', minutes: 60 },
      enabled: true
    })
    zone = 'UTC'
    await scheduler.tick()
    assert.equal(store.schedules()[0].enabled, false)
    assert.match(store.schedules()[0].history[0].detail!, /时区/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('artifact assertions cover every managed plugin including the workspace plugin', () => {
  const artifacts = managedArtifacts('resources/runtime/dsh-home/profiles/web/node_modules')
  assert.equal(artifacts.length, MANAGED_PLUGIN_NAMES.length * 2)
  assert.ok(
    artifacts.includes('resources/runtime/dsh-home/profiles/web/node_modules/dsh-px-workspace/lib/client.js')
  )
})
test('local request fence refuses untrusted hosts, cross-site and opaque origins without breaking Edge port omission', () => {
  const trust = (headers: Record<string, string>) => trustedLocalRequest({ headers })
  assert.equal(trust({ host: '127.0.0.1:3099', origin: 'http://127.0.0.1' }), true)
  assert.equal(trust({ host: 'localhost:3099', origin: 'http://localhost:3099' }), true)
  assert.equal(trust({ host: '[::1]:3099' }), true)
  assert.equal(trust({ host: 'untrusted.invalid', origin: 'http://untrusted.invalid' }), false)
  assert.equal(trust({ host: '127.0.0.1:3099', origin: 'http://127.0.0.1:4000' }), false)
  assert.equal(trust({ host: '127.0.0.1', origin: 'null' }), false)
  assert.equal(trust({ host: '127.0.0.1', 'sec-fetch-site': 'cross-site' }), false)
  assert.equal(trust({ host: 'user@127.0.0.1' }), false)
  assert.equal(trust({}), false)
})
test('a pending mutation stays exclusive while its panel is remounted', async () => {
  const operation = createOperation()
  let finish!: () => void,
    calls = 0
  const first = operation.run(async () => {
    calls++
    await new Promise<void>((resolve) => {
      finish = resolve
    })
  })
  assert.equal(operation.getSnapshot(), true)
  await assert.rejects(
    operation.run(async () => {
      calls++
    }),
    /仍在进行/
  )
  finish()
  await first
  assert.equal(calls, 1)
  assert.equal(operation.getSnapshot(), false)
  await operation.run(async () => {
    calls++
  })
  assert.equal(calls, 2)
})
test('diagnostic summaries distinguish explicit update shutdowns and never export raw bodies', () => {
  const summary = summarizeAppLog(
    '[dsh-px] 启动 2026-09-24T00:00:00Z  版本 0.1.0-beta.re.0.10\nPRIVATE_SECRET Error in example text\nInstall on explicit quitAndInstall\n[dsh] harness exited code=1 signal=null\n[dsh-px-event] {"event":"schedule.settled","prompt":"PRIVATE_SECRET"}'
  )
  assert.equal(summary.boots[0].exits.expected, 1)
  assert.equal(summary.boots[0].exits.unexplained, 0)
  assert.equal(summary.structuredEvents['schedule.settled'], 1)
  assert.ok(!JSON.stringify(summary).includes('PRIVATE_SECRET'))
})
test('rebuilding an artifact replaces its source entry without modifying a linked runtime copy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-artifact-'))
  try {
    const source = join(root, 'client.js'),
      runtime = join(root, 'runtime.js')
    writeFileSync(source, 'previous artifact')
    linkSync(source, runtime)
    const { writeArtifact } = await import(pathToFileURL(resolve('scripts/plugins/write-artifact.mjs')).href)
    writeArtifact(source, 'rebuilt artifact')
    assert.equal(readFileSync(source, 'utf8'), 'rebuilt artifact')
    assert.equal(readFileSync(runtime, 'utf8'), 'previous artifact')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
