import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { createDraftRegistry, createDraftCell } from '../packages/shared/draft-store'
import { validNoteDraft, validScheduleDraft } from '../packages/dsh-px-workspace/src/client/draft-validation'
import { createOperationRegistry } from '../packages/shared/operation'
import { createQuoteRequests } from '../packages/shared/quote-requests'
import { pageCarrier } from '../packages/shared/client-capabilities'
import { createLayoutStore, LayoutError, serviceIdentity } from '../packages/dsh-px-workbench/src/layout'
import { activitySnapshot, isIdle, registerActivity } from '../packages/dsh-px-workbench/src/activity'
import { createServiceState } from '../src/main/service-state'
import { closeTabState, parseTabs } from '../packages/dsh-px-workspace/src/client/tab-state'

test('inactive persisted drafts leave bounded memory and restore all unsaved text', () => {
  const records = new Map<string, string>()
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value)
    },
    removeItem: (key: string) => {
      records.delete(key)
    }
  }
  const registry = createDraftRegistry(4)
  for (let i = 0; i < 200; i++) {
    registry.acquire(`draft:${i}`, { note: '' }, storage)!.set({ note: `未保存-${i}` })
    assert.ok(registry.size() <= 4)
  }
  const restored = registry.acquire('draft:0', { note: '' }, storage)!
  assert.equal(restored.getSnapshot().note, '未保存-0')
  restored.clear()
  assert.equal(records.has('draft:0'), false, 'saved/discarded drafts no longer consume window storage')
  restored.clear({ note: '已保存内容的当前视图' })
  assert.equal(restored.getSnapshot().note, '已保存内容的当前视图')
  assert.equal(
    records.has('draft:0'),
    false,
    'keeping a saved editor view must not create another unsaved record'
  )
})
test('quota failures retain existing edits and refuse new editors before dropping user content', () => {
  const registry = createDraftRegistry(2)
  const first = registry.acquire('first', { note: '' })!
  first.set({ note: '保留我' })
  registry.acquire('second', { note: '' })!.set({ note: '也保留我' })
  assert.equal(registry.acquire('third', { note: '' }), null)
  assert.equal(registry.acquire('first', { note: '' })!.getSnapshot().note, '保留我')
  first.clear({ note: '已保存到服务的内容' })
  assert.ok(registry.acquire('third', { note: '' }))
})
test('malformed nested draft records cannot crash an editor or overwrite the original on read', () => {
  const broken = JSON.stringify({ version: 1, value: { source: {}, editing: null, quote: 'retain' } })
  const records = new Map([['a', broken]])
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value)
    },
    removeItem: (key: string) => {
      records.delete(key)
    }
  }
  const cell = createDraftCell('a', { source: null, editing: null, quote: '' }, storage, validNoteDraft)
  assert.equal(cell.isUnreadable(), true)
  assert.equal(cell.getSnapshot().source, null)
  assert.equal(records.get('a'), broken)
  const blockedSnapshot = cell.getSnapshot()
  cell.clear()
  assert.notEqual(
    cell.getSnapshot(),
    blockedSnapshot,
    'clearing the restore error must notify React readers immediately'
  )
  assert.equal(cell.isUnreadable(), false)
  assert.equal(records.has('a'), false)
  assert.equal(validScheduleDraft({ kind: 'once', editing: { id: 'a', timing: null } }), false)
})
test('drafts used by a pending save are pinned until the original operation settles', () => {
  let pending = true
  const registry = createDraftRegistry(1, () => !pending)
  const records = new Map<string, string>()
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value)
    }
  }
  registry.acquire('a', { note: '' }, storage)!.set({ note: 'pending' })
  assert.equal(registry.acquire('b', { note: '' }, storage), null)
  pending = false
  assert.ok(registry.acquire('b', { note: '' }, storage))
})
test('operations survive an unmount while running and are reclaimed after completion', async () => {
  const registry = createOperationRegistry()
  let finish!: () => void
  const operation = registry.get('session:a')
  const unsubscribe = operation.subscribe(() => {})
  const pending = operation.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  unsubscribe()
  assert.equal(registry.get('session:a'), operation)
  assert.equal(registry.pending('session:a'), true)
  finish()
  await pending
  assert.equal(registry.size(), 0)
  for (let i = 0; i < 1000; i++) await registry.get(String(i)).run(async () => {})
  assert.equal(registry.size(), 0)
})
test('quote consumption is token-safe and outstanding requests have a visible capacity error', () => {
  const requests = createQuoteRequests(2)
  requests.request('a', 'first')
  const old = requests.getSnapshot().a.token
  requests.request('a', 'second')
  requests.consume('a', old)
  assert.equal(requests.getSnapshot().a.messageId, 'second')
  requests.request('b', 'third')
  assert.throws(() => requests.request('c', 'fourth'), /待处理引用过多/)
  requests.consume('a')
  requests.request('c', 'fourth')
  assert.equal(Object.keys(requests.getSnapshot()).length, 2)
})
test('operation observers can replay an effect without creating a second mutation state', async () => {
  const registry = createOperationRegistry(),
    operation = registry.get('a')
  operation.subscribe(() => {})()
  const unsubscribe = operation.subscribe(() => {})
  await Promise.resolve()
  assert.equal(registry.get('a'), operation)
  unsubscribe()
  await Promise.resolve()
  assert.equal(registry.size(), 0)
})
test('service-owned layout restores across connections and rejects another window stale save', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpx-layout-'))
  try {
    const first = createLayoutStore(dir),
      second = createLayoutStore(dir)
    const one = first.read(),
      two = second.read()
    const ids = Array.from({ length: 85 }, (_, index) => `session-${index}`)
    const saved = first.write({ ...one, layout: { ...one.layout, ids, pins: ['session-84'] } })
    assert.equal(saved.serviceId, serviceIdentity(dir))
    assert.deepEqual(second.read().layout.ids, ids)
    assert.throws(
      () => second.write({ ...two, layout: { ...two.layout, ids: ['other'] } }),
      (err: unknown) => err instanceof LayoutError && err.status === 409
    )
    assert.deepEqual(first.read().layout.ids, ids)
    assert.notEqual(serviceIdentity(join(dir, 'another')), saved.serviceId)
    const file = join(dir, 'storages', 'dsh-px-workbench', 'session-layout.json')
    writeFileSync(file, '{damaged')
    assert.throws(() => first.write(saved), /原文件已保留/)
    assert.equal(readFileSync(file, 'utf8'), '{damaged')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('closing many tabs reclaims titles outside the bounded reopen list', () => {
  let tabs = parseTabs(
    JSON.stringify({
      ids: Array.from({ length: 80 }, (_, i) => `s-${i}`),
      titles: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`s-${i}`, `title ${i}`]))
    })
  )
  for (let i = 0; i < 80; i++) tabs = closeTabState(tabs, `s-${i}`, tabs.ids).tabs
  assert.equal(tabs.closed.length, 10)
  assert.equal(Object.keys(tabs.titles).length, 10)
})
test('page carrier never infers Electron from the desktop service behind a browser', () => {
  assert.equal(pageCarrier(undefined), 'browser')
  assert.equal(pageCarrier({ runtimeMode: 'packaged' }), 'browser')
  assert.equal(pageCarrier({ app: 'DSH-PX', electron: '44.4.5' }), 'desktop')
})
test('activity counts all owners once and never equates missing native services with idle', () => {
  const a = { id: 'a', status: 'running' as const, inbox: { nextTurn: ['queued'], nextStep: ['steer'] } }
  const b = { id: 'b', status: 'idle' as const, inbox: { nextTurn: [], nextStep: [] } }
  const shared = { id: 'unowned', status: 'running' }
  const value = activitySnapshot({
    agents: { list: () => [a, b] },
    terminalActivity: () => ({ known: true, openTerminals: 0 }),
    jobs: {
      list: (owner) =>
        owner ? [shared, { id: owner.id, status: owner.id === 'a' ? 'stopping' : 'completed' }] : [shared]
    }
  })
  assert.deepEqual(value, {
    known: true,
    runningAgents: 1,
    queuedInputs: 2,
    runningJobs: 2,
    openTerminals: 0
  })
  assert.equal(isIdle(activitySnapshot()), false)
  assert.equal(isIdle(value), false)
  assert.equal(
    isIdle(
      activitySnapshot({
        agents: { list: () => [] },
        jobs: { list: () => [] },
        terminalActivity: () => ({ known: true, openTerminals: 0 })
      })
    ),
    true
  )
})
test('shutdown is instance-bound, rejects active idle-mode, and awaits native disposal', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpx-shutdown-'))
  const oldData = process.env.DSH_PX_USER_DATA,
    oldInstance = process.env.DSH_PX_INSTANCE_ID
  const instanceId = 'fixture-instance-0123456789'
  process.env.DSH_PX_USER_DATA = dir
  process.env.DSH_PX_INSTANCE_ID = instanceId
  const heartbeat = createServiceState(dir, { instanceId })
  heartbeat.set('running', 'fixture', process.pid)
  const disposers: Array<() => void> = []
  t.after(() => {
    disposers.forEach((dispose) => dispose())
    heartbeat.dispose()
    if (oldData === undefined) delete process.env.DSH_PX_USER_DATA
    else process.env.DSH_PX_USER_DATA = oldData
    if (oldInstance === undefined) delete process.env.DSH_PX_INSTANCE_ID
    else process.env.DSH_PX_INSTANCE_ID = oldInstance
    rmSync(dir, { recursive: true, force: true })
  })
  let running = true,
    finish!: () => void,
    started = false,
    shouldThrow = false
  const routes = new Map<string, any>()
  const host = {
    loader: { entries: () => [] },
    agents: {
      list: () => (running ? [{ id: 'live', status: 'running', inbox: { nextTurn: [], nextStep: [] } }] : [])
    },
    jobs: { list: () => [] },
    root: {
      fiber: {
        dispose: () => {
          if (shouldThrow) throw new Error('native disposal fixture failure')
          started = true
          return new Promise<void>((resolve) => {
            finish = resolve
          })
        }
      }
    },
    effect: (fn: () => () => void) => {
      disposers.push(fn())
    },
    connection: { requestRejection: () => undefined },
    webServer: {
      register: (route: any) => {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      }
    }
  }
  registerActivity({ inject: (_: unknown, callback: any) => callback(host) })
  async function request(value: unknown) {
    const req = Readable.from([JSON.stringify({ requestId: randomUUID(), ...(value as object) })]) as any
    req.method = 'POST'
    req.headers = { host: '127.0.0.1:9999', 'content-type': 'application/json', 'x-dsh-px-request': '1' }
    let status = 0,
      body: any
    await routes.get('/dsh-px-workbench/shutdown')(req, {
      writeHead: (code: number) => {
        status = code
      },
      end: (raw: string) => {
        body = JSON.parse(raw)
      }
    })
    return { status, body }
  }
  assert.equal((await request({ instanceId: 'stale', mode: 'cancel' })).status, 409)
  assert.equal((await request({ instanceId, mode: 'idle' })).status, 409)
  assert.equal(started, false)
  running = false
  assert.equal((await request({ instanceId, mode: 'idle' })).status, 202)
  running = true
  await new Promise((resolve) => setTimeout(resolve, 5))
  const path = join(dir, 'shutdown-ack.json')
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).errorCode, 'NEW_ACTIVITY')
  assert.equal(started, false, 'a newly queued task must survive the final idle claim')
  running = false
  shouldThrow = true
  assert.equal((await request({ instanceId, mode: 'idle' })).status, 202)
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).errorCode, 'DISPOSE_FAILED')
  shouldThrow = false
  assert.equal((await request({ instanceId, mode: 'idle' })).status, 202)
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(started, true)
  assert.equal(existsSync(path), true)
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).disposedAt, undefined)
  assert.match(JSON.parse(readFileSync(path, 'utf8')).requestId, /^[a-f0-9-]{36}$/)
  finish()
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(typeof JSON.parse(readFileSync(path, 'utf8')).disposedAt, 'string')
})
