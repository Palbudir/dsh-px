import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { WorkspaceStore, Scheduler } from '../packages/dsh-px-workspace/src/store'
import { SessionContentIndex, type RecordEvent } from '../packages/dsh-px-workspace/src/model'
import { EvidenceIndex, evidenceDetail, reviewEvents } from '../packages/dsh-px-taskflow/src/evidence'
import { apply as workspace } from '../packages/dsh-px-workspace/src/index'
import { apply as taskflow, POLICY } from '../packages/dsh-px-taskflow/src/index'
import { localHandler } from './http-fixture'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-reliability-'))
  const path = join(root, 'state.json')
  return {
    root,
    path,
    store: new WorkspaceStore(path),
    close: () => rmSync(root, { recursive: true, force: true })
  }
}
const event = (seq: number, type: string, data: any): RecordEvent => ({ seq, type, data, time: seq * 1000 })
const input = (title: string) => ({
  title,
  sessionId: 'owner',
  prompt: 'fixture only',
  timing: { kind: 'once' as const, at: 2000 },
  enabled: true
})
const rpc = (id: string) => ({
  id: 'message-' + id,
  source: { kind: 'user', rpcId: id },
  content: [{ type: 'text', text: 'fixture' }]
})
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

for (const mutation of ['overlap', 'manual', 'pause', 'delete', 'reschedule', 'stop'] as const) {
  test(`due batch rechecks every task after an awaited delivery: ${mutation}`, async () => {
    const f = fixture(),
      gate = deferred(),
      started = deferred(),
      calls: string[] = []
    let now = 1000
    const scheduler = new Scheduler(
      f.store,
      async (row) => {
        calls.push(row.title)
        if (row.title === 'A') {
          started.resolve()
          await gate.promise
        }
      },
      'UTC',
      () => now
    )
    try {
      scheduler.save(input('A'))
      const b = scheduler.save(input('B'))
      now = 3000
      const first = scheduler.tick()
      await started.promise
      if (mutation === 'overlap') await Promise.all([scheduler.tick(), scheduler.tick(), scheduler.tick()])
      if (mutation === 'manual') await scheduler.run(b.id)
      if (mutation === 'pause') scheduler.save({ ...b, enabled: false })
      if (mutation === 'delete') scheduler.remove(b)
      if (mutation === 'reschedule') scheduler.save({ ...b, timing: { kind: 'once', at: 10000 } })
      if (mutation === 'stop') scheduler.stop()
      gate.resolve()
      if (mutation === 'stop') await assert.rejects(first, /服务在投递期间停止/)
      else await first
      assert.deepEqual(calls, ['overlap', 'manual'].includes(mutation) ? ['A', 'B'] : ['A'])
      assert.ok(f.store.schedules().every((s) => s.history.length <= 1))
      if (mutation === 'overlap') {
        await scheduler.tick()
        assert.equal(calls.length, 2)
      }
    } finally {
      scheduler.stop()
      f.close()
    }
  })
}

test('durable snapshots recover corrupt data explicitly, preserve the original, and pause restored schedules', () => {
  const f = fixture()
  try {
    const scheduler = new Scheduler(
      f.store,
      async () => {},
      'UTC',
      () => 1000
    )
    const row = scheduler.save(input('recover'))
    f.store.saveAnnotation(
      { sessionId: 'owner', messageId: 'source', quote: 'visible', note: 'saved note' },
      { id: 'source', role: 'assistant', text: 'visible source', seq: 1, time: 1 }
    )
    const original = '{corrupt but must remain'
    writeFileSync(f.path, original)
    assert.throws(() => new WorkspaceStore(f.path), /无法读取/)
    const status = WorkspaceStore.status(f.path)
    assert.equal(status.ready, false)
    assert.equal(status.snapshots.find((s) => s.id === 'last-good')?.annotations, 1)
    assert.throws(() => WorkspaceStore.restore(f.path, 'last-good', 'stale'), /已变化/)
    assert.equal(readFileSync(f.path, 'utf8'), original)
    assert.throws(() => WorkspaceStore.restore(f.path, '../state', status.revision), /无效/)
    const restored = WorkspaceStore.restore(f.path, 'last-good', status.revision, 5000)
    assert.equal(restored.snapshot().annotations[0].note, 'saved note')
    assert.equal(restored.schedules()[0].id, row.id)
    assert.equal(restored.schedules()[0].enabled, false)
    assert.equal(restored.schedules()[0].nextAt, null)
    const preserved = readdirSync(f.root).find((name) => name.includes('.corrupt-'))!
    assert.equal(readFileSync(join(f.root, preserved), 'utf8'), original)
    assert.equal(WorkspaceStore.status(f.path).ready, true)
  } finally {
    f.close()
  }
})

test('backup write failure never overwrites the main state or reports an uncommitted annotation as saved', () => {
  const f = fixture()
  try {
    const scheduler = new Scheduler(
      f.store,
      async () => {},
      'UTC',
      () => 1000
    )
    const row = scheduler.save(input('original'))
    const original = readFileSync(f.path, 'utf8')
    mkdirSync(f.path + '.previous.json')
    assert.throws(() => scheduler.save({ ...row, title: 'not committed' }), /未写入修改/)
    assert.equal(readFileSync(f.path, 'utf8'), original)
    assert.equal(f.store.schedules()[0].title, 'original')
  } finally {
    f.close()
  }
})

test('a missing primary file with a valid snapshot requires explicit recovery, never an empty reset', () => {
  const f = fixture()
  try {
    const scheduler = new Scheduler(
      f.store,
      async () => {},
      'UTC',
      () => 1000
    )
    scheduler.save(input('retained'))
    unlinkSync(f.path)
    assert.throws(() => new WorkspaceStore(f.path), /无法读取/)
    const status = WorkspaceStore.status(f.path)
    assert.equal(status.ready, false)
    assert.equal(status.revision, 'missing')
    const recovered = WorkspaceStore.restore(f.path, 'last-good', status.revision)
    assert.equal(recovered.schedules()[0].title, 'retained')
    assert.equal(recovered.schedules()[0].enabled, false)
  } finally {
    f.close()
  }
})

test('stale store instances and external edits cannot overwrite newer persisted data', () => {
  const f = fixture()
  try {
    const first = new Scheduler(
      f.store,
      async () => {},
      'UTC',
      () => 1000
    )
    const row = first.save(input('original'))
    const stale = new WorkspaceStore(f.path)
    first.save({ ...row, title: 'newer committed value' })
    const old = new Scheduler(
      stale,
      async () => {},
      'UTC',
      () => 1000
    )
    assert.throws(() => old.save({ ...row, title: 'stale overwrite' }), /其他操作修改/)
    assert.equal(new WorkspaceStore(f.path).schedules()[0].title, 'newer committed value')
  } finally {
    f.close()
  }
})

test('recurring batches advance from claim time and do not duplicate during slow admission', async () => {
  const f = fixture(),
    gate = deferred(),
    started = deferred(),
    calls: string[] = []
  let now = 1000
  const scheduler = new Scheduler(
    f.store,
    async (row) => {
      calls.push(row.title)
      if (row.title === 'A') {
        started.resolve()
        await gate.promise
      }
    },
    'UTC',
    () => now
  )
  try {
    scheduler.save({ ...input('A'), timing: { kind: 'interval', minutes: 1 } })
    scheduler.save({ ...input('B'), timing: { kind: 'interval', minutes: 1 } })
    now = 900000
    const tick = scheduler.tick()
    await started.promise
    await scheduler.tick()
    gate.resolve()
    await tick
    await scheduler.tick()
    assert.deepEqual(calls, ['A', 'B'])
    assert.ok(f.store.schedules().every((s) => s.nextAt === now + 60000))
  } finally {
    scheduler.stop()
    f.close()
  }
})

test('missing schedule target settles pending history and pauses recurrence without redelivery', async () => {
  const f = fixture()
  let calls = 0
  const scheduler = new Scheduler(
    f.store,
    async () => {
      calls++
    },
    'UTC',
    () => 1000,
    async () => {
      throw Object.assign(new Error('gone'), { status: 404 })
    }
  )
  try {
    const row = scheduler.save({ ...input('missing'), timing: { kind: 'interval', minutes: 1 } })
    await scheduler.run(row.id)
    await scheduler.reconcile()
    assert.equal(f.store.schedules()[0].history[0].status, 'interrupted')
    assert.equal(f.store.schedules()[0].enabled, false)
    await scheduler.tick()
    assert.equal(calls, 1)
  } finally {
    scheduler.stop()
    f.close()
  }
})

test('a recurring task never builds a backlog while its prior prompt remains queued', async () => {
  const f = fixture()
  let now = 1000,
    calls = 0
  const scheduler = new Scheduler(
    f.store,
    async () => {
      calls++
    },
    'UTC',
    () => now
  )
  try {
    const row = scheduler.save({ ...input('no backlog'), timing: { kind: 'interval', minutes: 1 } })
    now += 60000
    await scheduler.tick()
    now += 86400000
    await scheduler.tick()
    await scheduler.tick()
    assert.equal(calls, 1)
    await assert.rejects(scheduler.run(row.id), /仍在队列/)
    assert.equal(f.store.schedules()[0].history.length, 1)
  } finally {
    scheduler.stop()
    f.close()
  }
})

test('an unsettled dispatch cannot be retargeted away from its native lifecycle', async () => {
  const f = fixture()
  const facts = new Map<string, any>()
  const scheduler = new Scheduler(
    f.store,
    async () => {},
    'UTC',
    () => 1000,
    async (row) => row.history.flatMap((h) => (facts.has(h.requestId) ? [facts.get(h.requestId)] : []))
  )
  try {
    const row = scheduler.save(input('owner unchanged'))
    const queued = await scheduler.run(row.id)
    assert.throws(() => scheduler.save({ ...queued, sessionId: 'another-owner' }), /不能更改目标会话/)
    const requestId = queued.history[0].requestId
    facts.set(requestId, { requestId, time: 1000, status: 'running', turn: 1 })
    await scheduler.reconcile()
    assert.throws(
      () => scheduler.save({ ...f.store.schedules()[0], sessionId: 'another-owner' }),
      /不能更改目标会话/
    )
    f.store.update((state) => {
      state.schedules[0].history[0].status = 'uncertain'
    })
    assert.throws(
      () => scheduler.save({ ...f.store.schedules()[0], sessionId: 'another-owner' }),
      /不能更改目标会话/
    )
    facts.set(requestId, { requestId, time: 1000, status: 'completed', turn: 1, finishedAt: 2000 })
    await scheduler.reconcile()
    assert.equal(
      scheduler.save({ ...f.store.schedules()[0], sessionId: 'another-owner' }).sessionId,
      'another-owner'
    )
  } finally {
    scheduler.stop()
    f.close()
  }
})

test('changed-file summaries explicitly report their total and bounded truncation', () => {
  const events: RecordEvent[] = []
  for (let i = 0; i < 240; i++) {
    events.push(
      event(events.length, 'tool/call', {
        callId: 'write-' + i,
        name: 'write',
        arguments: JSON.stringify({ path: 'file-' + i })
      })
    )
    events.push(
      event(events.length, 'tool/result', {
        message: {
          content: [
            { type: 'tool-result', toolCallId: 'write-' + i, content: [{ type: 'text', text: 'saved' }] }
          ]
        }
      })
    )
  }
  const result = reviewEvents(new EvidenceIndex().update(events), false)
  assert.equal(result.changedFiles.length, 200)
  assert.equal(result.changedFilesTotal, 240)
  assert.equal(result.changedFilesTruncated, true)
  assert.equal(reviewEvents([], false).changedFilesTruncated, false)
})

for (const [reason, expected] of [
  [{ kind: 'completed' }, 'completed'],
  [{ kind: 'error', error: { message: 'fixture failure' } }, 'failed'],
  [{ kind: 'blocked' }, 'failed'],
  [{ kind: 'max-tokens' }, 'failed'],
  [{ kind: 'aborted', reason: { kind: 'user' } }, 'cancelled'],
  [{ kind: 'aborted', reason: { kind: 'disposed' } }, 'interrupted'],
  [{ kind: 'interrupted' }, 'interrupted']
] as const) {
  test(`dispatch final outcome follows only its native RPC/turn association: ${expected}/${reason.kind}`, async () => {
    const f = fixture(),
      index = new SessionContentIndex()
    let now = 1000
    let events: RecordEvent[] = []
    const scheduler = new Scheduler(
      f.store,
      async (_row, id) => {
        events = [event(0, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [rpc(id)] })]
      },
      'UTC',
      () => now,
      async (row) =>
        row.history.flatMap((h) => {
          const fact = index.update(events).dispatch(h.requestId)
          return fact ? [{ ...fact, requestId: h.requestId }] : []
        })
    )
    try {
      const row = scheduler.save(input('lifecycle'))
      await scheduler.run(row.id)
      assert.equal(f.store.schedules()[0].history[0].status, 'queued')
      const id = f.store.schedules()[0].history[0].requestId
      events.push(
        event(1, 'turn/start', { turn: 3 }),
        event(2, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
        event(3, 'user/message', rpc(id))
      )
      await scheduler.reconcile()
      assert.equal(f.store.schedules()[0].history[0].status, 'running')
      events.push(event(4, 'turn/end', { turn: 99, reason: { kind: 'completed' } }))
      await scheduler.reconcile()
      assert.equal(
        f.store.schedules()[0].history[0].status,
        'running',
        'unrelated completed turn cannot settle this dispatch'
      )
      events.push(event(5, 'turn/end', { turn: 3, reason }))
      now = 6000
      await scheduler.reconcile()
      const history = new WorkspaceStore(f.path).schedules()[0].history[0]
      assert.equal(history.status, expected)
      assert.equal(history.turn, 3)
      assert.equal(history.finishedAt, 5000)
      assert.equal(history.time, 1000, 'admission time remains stable')
      if (expected === 'completed') assert.match(history.detail!, /不代表.*验证通过/)
    } finally {
      scheduler.stop()
      f.close()
    }
  })
}

test('queued removal and pre-step rewrite are not credited as completed work', () => {
  const cancelled = new SessionContentIndex().update([
    event(0, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [rpc('cancel')] }),
    event(1, 'agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      removedCount: 1,
      inserted: [],
      outcome: 'canceled'
    })
  ])
  assert.equal(cancelled.dispatch('cancel')?.status, 'cancelled')
  const rewritten = new SessionContentIndex().update([
    event(0, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [rpc('rewrite')] }),
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  ])
  assert.equal(rewritten.dispatch('rewrite')?.status, 'cancelled')
  assert.equal(rewritten.dispatch('unknown'), undefined)
})

test('10,000-event content index appends once and pages artifacts sharing one event without omission', () => {
  const events = Array.from({ length: 10000 }, (_, i) => event(i, 'user/message', rpc('r' + i)))
  const index = new SessionContentIndex().update(events)
  assert.equal(index.processedEvents, 10000)
  index.update(events)
  assert.equal(index.processedEvents, 10000)
  events.push(
    event(10000, 'deliverables/presented', {
      files: Array.from({ length: 75 }, (_, i) => ({ path: `file-${i}.md` }))
    })
  )
  index.update(events)
  assert.equal(index.processedEvents, 10001)
  const paths: string[] = []
  let cursor: string | undefined
  do {
    const page = index.content(undefined, cursor)
    assert.ok(page.messages.length <= 20 && page.artifacts.length <= 20)
    assert.ok(JSON.stringify(page).length < 16000)
    paths.push(...page.artifacts.map((f) => f.path))
    cursor = page.nextArtifactBefore ?? undefined
  } while (cursor)
  assert.equal(new Set(paths).size, 75)
  assert.equal(paths.length, 75)
  assert.equal(index.message('message-r0')?.text, 'fixture')
  assert.throws(() => index.content(undefined, 'invalid'), /分页/)
  index.update([event(0, 'user/message', rpc('new-session'))])
  assert.equal(index.content().artifactTotal, 0)
  assert.equal(index.message('message-r0'), undefined)
})

test('long execution history is incrementally indexed; cold reads do not mutate a running live result', () => {
  const events: RecordEvent[] = [event(0, 'turn/start', { turn: 1 })]
  for (let i = 0; i < 4000; i++) {
    events.push(event(events.length, 'tool/call', { callId: 'c' + i, name: 'read', arguments: '{}' }))
    events.push(
      event(events.length, 'tool/result', {
        message: {
          content: [
            { type: 'tool-result', toolCallId: 'c' + i, content: [{ type: 'text', text: 'result-' + i }] }
          ]
        }
      })
    )
  }
  const index = new EvidenceIndex().update(events)
  assert.equal(index.processedEvents, 8001)
  for (let i = 0; i < 100; i++) {
    reviewEvents(index.update(events), true, { beforeSeq: 8000 - i * 40 })
    evidenceDetail(index, 'c0')
  }
  assert.equal(index.processedEvents, 8001)
  events.push(event(events.length, 'tool/call', { callId: 'pending', name: 'write', arguments: '{}' }))
  index.update(events)
  assert.equal(index.processedEvents, 8002)
  assert.equal(evidenceDetail(index, 'pending', false)?.outcome, 'interrupted')
  assert.equal(evidenceDetail(index, 'pending', true)?.outcome, 'running')
  assert.equal(evidenceDetail(index, 'c0')?.output, 'result-0')
  assert.match(POLICY, /Simple answers need no checkpoint/)
  assert.doesNotMatch(POLICY, /record a ready_for_review|call task_review and record/)
})

test('corrupt business storage leaves content readable and recovery works through the guarded API', async () => {
  const f = fixture(),
    previous = process.env.DSH_HOME,
    routes = new Map<string, any>(),
    cleanups: Array<() => void> = []
  const path = join(f.root, 'storages', 'dsh-px-workspace', 'workspace.json')
  const store = new WorkspaceStore(path)
  store.saveAnnotation(
    { sessionId: 'owner', messageId: 'message-r', quote: 'fixture', note: 'preserve' },
    { id: 'message-r', seq: 0, time: 0, text: 'fixture', role: 'user' }
  )
  writeFileSync(path, '{broken')
  process.env.DSH_HOME = f.root
  try {
    workspace({
      inject: (_services, callback) =>
        callback({
          provide: (_name, runtime) => {
            for (const feature of ['annotations', 'schedules'])
              runtime.mount({ effect: (fn: () => () => void) => cleanups.push(fn()) }, feature)
          },
          sessions: {
            get: () => ({
              header: { id: 'owner' },
              snapshotEvents: () => [event(0, 'user/message', rpc('r'))]
            })
          },
          sessionController: {
            inspect: async () => {
              throw new Error('not needed')
            },
            prompt: async () => ({ accepted: true })
          },
          connection: { requestRejection: () => undefined },
          webServer: {
            register: (route) => {
              routes.set(route.path, localHandler(route.handler))
              return () => {}
            }
          },
          effect: (fn) => {
            cleanups.push(fn())
          },
          logger: { warn: () => {} }
        })
    })
    const request = async (route: string, value?: any, validHeader = true) => {
      let status = 0,
        data: any
      const req = Object.assign(Readable.from(value ? [JSON.stringify(value)] : []), {
        method: value ? 'POST' : 'GET',
        url: `/?sessionId=owner`,
        headers: { 'content-type': 'application/json', ...(validHeader ? { 'x-dsh-px-request': '1' } : {}) }
      })
      await routes.get('/dsh-px-workspace/' + route)(req, {
        writeHead: (code: number) => {
          status = code
        },
        end: (text: string) => {
          data = JSON.parse(text)
        }
      })
      return { status, data }
    }
    const content = await request('content')
    assert.equal(content.status, 200)
    assert.equal(content.data.messages[0].text, 'fixture')
    assert.equal((await request('annotations')).status, 503)
    const status = await request('storage')
    assert.equal(status.data.ready, false)
    assert.equal(
      (
        await request(
          'storage',
          { action: 'restore', snapshotId: 'last-good', revision: status.data.revision },
          false
        )
      ).status,
      403
    )
    assert.equal(readFileSync(path, 'utf8'), '{broken')
    const recovered = await request('storage', {
      action: 'restore',
      snapshotId: 'last-good',
      revision: status.data.revision
    })
    assert.equal(recovered.status, 200)
    assert.equal(recovered.data.ready, true)
    assert.equal((await request('annotations')).data.annotations[0].note, 'preserve')
  } finally {
    cleanups.forEach((fn) => fn())
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    f.close()
  }
})

test('cold evidence pages reuse unchanged native revisions and invalidate when storage changes', async () => {
  const routes = new Map<string, any>()
  let revision = 'v1',
    reads = 0,
    closed = 0
  let events: RecordEvent[] = [event(0, 'tool/call', { callId: 'c', name: 'read', arguments: '{}' })]
  taskflow({
    effect: () => {},
    inject: (_services, callback) =>
      callback({
        effect: (fn: any) => fn(),
        tools: { register: () => {} },
        systemPrompt: { section: () => () => {} },
        sessions: { get: () => undefined },
        sessionPersistence: {
          stat: async () => ({ revision }),
          open: async () => ({
            read: async () => {
              reads++
              return { events }
            },
            close: async () => {
              closed++
            }
          })
        },
        connection: { requestRejection: () => undefined },
        webServer: {
          register: (route: any) => {
            routes.set(route.path, localHandler(route.handler))
            return () => {}
          }
        }
      })
  })
  async function request() {
    let data: any
    await routes.get('/dsh-px-taskflow/evidence')(
      { method: 'GET', url: '/?sessionId=cold&callId=c' },
      {
        writeHead: (status: number) => assert.equal(status, 200),
        end: (text: string) => {
          data = JSON.parse(text)
        }
      }
    )
    return data
  }
  assert.equal((await request()).outcome, 'interrupted')
  await request()
  await request()
  assert.equal(reads, 1)
  events = [
    ...events,
    event(1, 'tool/result', {
      message: {
        content: [{ type: 'tool-result', toolCallId: 'c', content: [{ type: 'text', text: 'new result' }] }]
      }
    })
  ]
  revision = 'v2'
  assert.equal((await request()).output, 'new result')
  assert.equal(reads, 2)
  assert.equal(closed, 2)
})
