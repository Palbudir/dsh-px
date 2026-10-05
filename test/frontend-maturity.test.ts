import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDraftRegistry, createDraftCell } from '../packages/shared/draft-store'
import { validNoteDraft, validScheduleDraft } from '../packages/dsh-px-workspace/src/client/draft-validation'
import { createOperationRegistry } from '../packages/shared/operation'
import { createQuoteRequests } from '../packages/shared/quote-requests'
import { pageCarrier } from '../packages/shared/client-capabilities'
import { activitySnapshot, isIdle, registerActivity } from '../packages/dsh-px-workbench/src/activity'

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
test('page carrier never infers Electron from the desktop service behind a browser', () => {
  assert.equal(pageCarrier(undefined), 'browser')
  assert.equal(pageCarrier({ runtimeMode: 'packaged' }), 'browser')
  // The retired PX shell preload no longer identifies a Desktop window.
  assert.equal(pageCarrier({ app: 'DSH-PX', electron: '44.4.5' }), 'browser')
  assert.equal(pageCarrier({ protocolVersion: 'x' }), 'browser')
  assert.equal(pageCarrier({ protocolVersion: 0 }), 'browser')
  assert.equal(pageCarrier({ protocolVersion: 1 }), 'desktop')
})
test('activity counts observed owners once and never equates observations with Host idle', () => {
  const a = { id: 'a', status: 'running' as const, inbox: { nextTurn: ['queued'], nextStep: ['steer'] } }
  const b = { id: 'b', status: 'idle' as const, inbox: { nextTurn: [], nextStep: [] } }
  const shared = { id: 'unowned', status: 'running' }
  const value = activitySnapshot({
    agents: { list: () => [a, b] },
    terminalActivity: () => ({
      known: false,
      observedKnown: true,
      scope: 'observed-sessions',
      openTerminals: 0
    }),
    jobs: {
      list: (owner) =>
        owner ? [shared, { id: owner, status: owner === 'a' ? 'stopping' : 'completed' }] : [shared]
    }
  })
  assert.deepEqual(value, {
    known: false,
    observedKnown: true,
    scope: 'observed-sessions',
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
        terminalActivity: () => ({
          known: false,
          observedKnown: true,
          scope: 'observed-sessions',
          openTerminals: 0
        })
      })
    ),
    false
  )
})

test('an idle Agent with a session-owned background job is not reported as idle', () => {
  const agent = { id: 'session-background', status: 'idle' as const, inbox: { nextTurn: [], nextStep: [] } }
  const calls: Array<string | undefined> = []
  const value = activitySnapshot({
    agents: { list: () => [agent] },
    jobs: {
      list: (sessionId) => {
        calls.push(sessionId)
        // Matches the native registry's strict comparison of job.owner.id to caller.
        return sessionId === agent.id ? [{ id: 'pwsh-1', status: 'running' }] : []
      }
    },
    terminalActivity: () => ({
      known: false,
      observedKnown: true,
      scope: 'observed-sessions',
      openTerminals: 0
    })
  })
  assert.deepEqual(calls, [undefined, agent.id])
  assert.equal(value.runningAgents, 0)
  assert.equal(value.runningJobs, 1)
  assert.equal(isIdle(value), false)
})
test('activity is a read-only authenticated snapshot; the Pack exposes no shutdown route', () => {
  const disposers: Array<() => void> = []
  const routes = new Map<string, any>()
  const host = {
    loader: { entries: () => [] },
    agents: { list: () => [{ id: 'live', status: 'running', inbox: { nextTurn: [], nextStep: [] } }] },
    jobs: { list: () => [] },
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
  assert.deepEqual([...routes.keys()], ['/dsh-px-workbench/activity'])
  const call = (method: string) => {
    let status = 0,
      body: any
    routes.get('/dsh-px-workbench/activity')(
      { method, headers: { host: '127.0.0.1:9999' } },
      {
        writeHead: (code: number) => {
          status = code
        },
        end: (raw: string) => {
          body = JSON.parse(raw)
        }
      }
    )
    return { status, body }
  }
  assert.equal(call('POST').status, 405)
  const snapshot = call('GET')
  assert.equal(snapshot.status, 200)
  assert.equal(snapshot.body.runningAgents, 1)
  assert.equal('instanceId' in snapshot.body, false)
  disposers.forEach((dispose) => dispose())
  assert.equal(routes.size, 0)
})
