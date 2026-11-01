import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import { createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { HistoryIndex } from '../packages/dsh-px-memory/src/history'
import { KnowledgeBank } from '../packages/dsh-px-memory/src/knowledge'
import { SegmentRuntime } from '../packages/dsh-px-memory/src/segment-runtime'
import { parseSegmentSummary } from '../packages/dsh-px-memory/src/segment-summarizer'
import { registerSegmentBoundary } from '../packages/dsh-px-memory/src/segment-context'

async function until(check: () => boolean, label: string) {
  const end = Date.now() + 5000
  while (!check()) {
    if (Date.now() > end) throw Error('timeout: ' + label)
    await delay(10)
  }
}
async function fixture(t: any, capacity: number | null = 32768) {
  const root = mkdtempSync(join(tmpdir(), 'px-segment-job-')),
    app: any = new Context(),
    fibers: any[] = [],
    scopes: any[] = [],
    agents = new Map<string, any>(),
    pending: any[] = [],
    selections = new Map<string, any>()
  const llm = app.provide('llm', {
    async *stream(options: any) {
      let release!: (value?: string) => void
      const barrier = new Promise<string | undefined>((yes, no) => {
        release = yes
        options.signal.addEventListener(
          'abort',
          () => {
            setTimeout(() => no(options.signal.reason), 40)
          },
          { once: true }
        )
      })
      const source = JSON.parse(options.messages[0].content[0].text)
      pending.push({ options, source, release })
      const override = await barrier
      yield {
        type: 'text-delta',
        index: 0,
        text:
          override ??
          JSON.stringify({
            summary: '旧段已记录原始要求及执行结果，后续纠正优先。证据可按事件编号读取。',
            memories: source.allowedMemoryEvidence.length
              ? [{ key: '稳定约定', body: 'MEMORY_CANDIDATE_731', seqs: [source.allowedMemoryEvidence[0]] }]
              : []
          })
      }
      yield { type: 'usage', usage: { inputTokens: 9000, outputTokens: 200, cacheReadTokens: 1000 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  })
  app.provide('agents', { get: (id: string) => agents.get(id), list: () => [...agents.values()] })
  app.provide('pxContextPolicy', { describe: async () => ({ capacity: capacity ?? undefined }) })
  for (const plugin of [SessionStore, SessionProjections, TokenMeter, Jobs, BasicCompactionEngine]) {
    const fiber = app.plugin(plugin, plugin === BasicCompactionEngine ? { auto: false } : {})
    fibers.push(fiber)
    await fiber.await()
  }
  let host: any
  const feature = app.inject(['sessions', 'sessionProjections', 'tokenMeter', 'jobs'], (value: any) => {
    host = value
    registerSegmentBoundary(host)
    host.jobs.attachController('segment-fixture')
    // Only the Agent loop is simulated; sessions, metering, Jobs, Documents and compaction are native.
    host.sessionProjections.register({
      key: 'turnBoundary',
      stateVersion: 1,
      stateSchema: z.any(),
      init: () => ({ openTurnStartSeq: null, lastStepBoundary: null }),
      apply: (state: any, event: any) =>
        event.type === 'turn/start'
          ? { ...state, openTurnStartSeq: event.seq }
          : event.type === 'turn/end'
            ? { ...state, openTurnStartSeq: null }
            : event.type === 'step/start'
              ? { ...state, lastStepBoundary: { kind: 'start', seq: event.seq } }
              : event.type === 'step/end'
                ? { ...state, lastStepBoundary: { kind: 'end', seq: event.seq } }
                : state
    })
    host.sessionProjections.register({
      key: 'modelSelection',
      stateVersion: 1,
      stateSchema: z.any(),
      init: () => ({ pending: null }),
      apply: (state: any) => state
    })
  })
  await feature.await()
  const identities = new MemoryStore(join(root, 'memory.json')),
    history = new HistoryIndex(join(root, 'history.sqlite'), identities)
  const bank = new KnowledgeBank(join(root, 'bank'), identities, undefined, (caller, target, seq, signal) =>
    history.read(host, caller.sessionId, target, seq, 0, signal)
  )
  let runtime = new SegmentRuntime(app, identities, bank, history, join(root, 'segments.sqlite'))
  await runtime.ready()
  const create = (id: string, singleTurn = false, sized = false, enable = true) => {
    const session = host.sessions.create(id, { meta: { cwd: root } }),
      agent: any = { id, session, options: { provider: 'fixture', model: 'fixture' } }
    const scope = createScope(app, agent)
    agent.ctx = scope.ctx
    scopes.push(scope)
    agents.set(id, agent)
    identities.bind(id, { locked: true })
    if (enable) runtime.configure(id, 0, true)
    session.append('turn/start', { turn: 1 })
    const first = session.append(
      'user/message',
      createUserMessage({
        source: { kind: 'user' },
        content: [
          {
            type: 'text',
            text:
              'ORIGINAL_REQUEST_731 ' +
              'old source with important fact '.repeat(
                sized ? Math.max(1700, Math.ceil((capacity ?? 32768) / 40)) : 1000
              )
          }
        ]
      }),
      { surfaceOp: 'append' }
    )
    session.append('step/start', { turn: 1, step: 1 })
    const last = session.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        stream: [],
        message: createAssistantMessage({
          source: { provider: 'fixture', model: 'fixture' },
          content: [
            { type: 'reasoning', text: 'REASONING_MUST_NOT_BE_MEMORY' },
            { type: 'text', text: 'Historical visible conclusion. '.repeat(150) }
          ]
        })
      },
      { surfaceOp: 'append' }
    )
    session.append('step/end', { turn: 1, step: 1 })
    if (!singleTurn) {
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      session.append('turn/start', { turn: 2 })
    }
    const tail = session.append(
      'user/message',
      createUserMessage({
        source: { kind: 'user' },
        content: [
          { type: 'text', text: 'RECENT_TAIL_926 ' + 'recent content to retain '.repeat(sized ? 4200 : 1500) }
        ]
      }),
      { surfaceOp: 'append' }
    )
    return { agent, session, first, last, tail }
  }
  t.after(async () => {
    await runtime.dispose()
    await bank.dispose()
    await history.close()
    for (const scope of scopes.reverse()) await scope.dispose()
    await feature.dispose()
    for (const fiber of fibers.reverse()) await fiber.dispose()
    await llm()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    app,
    host,
    identities,
    bank,
    history,
    pending,
    create,
    selections,
    get runtime() {
      return runtime
    },
    restart: async () => {
      await runtime.dispose()
      runtime = new SegmentRuntime(app, identities, bank, history, join(root, 'segments.sqlite'))
      await runtime.ready()
    }
  }
}

test('explicit native auto-off is inherited until the user enables background preparation for this session', async (t) => {
  const f = await fixture(t),
    a = f.create('manual-only', false, false, false)
  assert.equal(f.runtime.snapshot(a.agent.id).settings.enabled, false)
  assert.equal(f.runtime.snapshot(a.agent.id).settings.inheritedNativeAutoOff, true)
  await f.runtime.boundary(a.agent, new AbortController().signal)
  assert.equal(f.runtime.snapshot(a.agent.id).preparingAdmission, false)
  assert.equal(f.pending.length, 0)
  f.runtime.configure(a.agent.id, 0, true)
  await f.runtime.boundary(a.agent, new AbortController().signal)
  await until(() => f.pending.length === 1, 'explicit opt-in works')
  f.pending[0].release()
  await until(() => f.runtime.snapshot(a.agent.id).records[0].phase === 'ready', 'prepared')
  await f.restart()
  assert.equal(f.runtime.snapshot(a.agent.id).settings.enabled, true, 'saved opt-in survives restart')
})

test(
  'native Job overlaps main progress and commits at a later boundary, with separate explicit memory adoption',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t),
      a = f.create('a', true)
    await f.runtime.boundary(a.agent, new AbortController().signal)
    await until(() => f.pending.length === 1, 'background call started')
    const row = f.runtime.snapshot('a').records[0]
    assert.equal(f.host.jobs.get(row.jobId, 'a').status, 'running')
    assert.equal(
      a.session.snapshotEvents().some((e: any) => e.type === 'compaction/start'),
      false
    )
    assert.ok(!JSON.stringify(f.pending[0].source).includes('REASONING_MUST_NOT_BE_MEMORY'))
    a.session.append('step/start', { turn: 1, step: 2 })
    const work = a.session.append(
      'assistant/message',
      {
        turn: 1,
        step: 2,
        stream: [],
        message: createAssistantMessage({
          source: { provider: 'fixture', model: 'fixture' },
          content: [{ type: 'text', text: 'MAIN_ADVANCED_DURING_BACKGROUND_853' }]
        })
      },
      { surfaceOp: 'append' }
    )
    a.session.append('step/end', { turn: 1, step: 2 })
    assert.equal(f.host.jobs.get(row.jobId, 'a').status, 'running')
    f.pending[0].release()
    await until(
      () =>
        f.runtime.snapshot('a').records[0].phase === 'ready' &&
        f.host.jobs.get(row.jobId, 'a').status === 'completed',
      'prepared'
    )
    await delay(10)
    await f.runtime.boundary(a.agent, new AbortController().signal)
    assert.equal(f.runtime.snapshot('a').records.find((v) => v.id === row.id)?.phase, 'committed')
    assert.ok(a.session.surface.nodes.includes(work.seq))
    assert.ok(a.session.surface.nodes.includes(a.tail.seq))
    assert.ok(!a.session.surface.nodes.includes(a.first.seq))
    assert.equal(f.runtime.snapshot('a').cost.usage.inputTokens, 9000)
    const caller = { sessionId: 'a', project: f.root, actor: 'human' as const }
    assert.equal((await f.bank.search(caller, 'persona-project', 'MEMORY_CANDIDATE_731')).results.length, 0)
    const adopted = await f.runtime.decideMemory('a', row.id, 0, 'accept', f.root)
    assert.equal(adopted.status, 'accepted')
    assert.deepEqual(await f.runtime.decideMemory('a', row.id, 0, 'accept', f.root), adopted)
    const found = await f.bank.search(caller, 'persona-project', 'MEMORY_CANDIDATE_731')
    assert.equal(found.results.length, 1)
    assert.equal(found.results[0].events[0].seq, a.first.seq)
  }
)

test(
  'native cancellation waits for producer quiescence and never commits the late response',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t),
      a = f.create('cancel')
    await f.runtime.boundary(a.agent, new AbortController().signal)
    await until(() => f.pending.length === 1, 'started')
    const row = f.runtime.snapshot('cancel').records[0]
    f.runtime.cancel('cancel')
    assert.equal(f.host.jobs.get(row.jobId, 'cancel').status, 'stopping')
    assert.equal(f.runtime.snapshot('cancel').records[0].phase, 'stopping')
    await until(() => f.host.jobs.get(row.jobId, 'cancel').status === 'killed', 'native stopped')
    assert.equal(f.runtime.snapshot('cancel').records[0].phase, 'cancelled')
    await f.runtime.boundary(a.agent, new AbortController().signal)
    await delay(30)
    assert.equal(f.pending.length, 1, 'same failed range must not retry itself')
    assert.ok(a.session.surface.nodes.includes(a.first.seq))
  }
)

test(
  'native correction while preparation runs rejects late memory adoption without losing current work',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t),
      a = f.create('correction'),
      caller = { sessionId: 'correction', project: f.root, actor: 'human' as const }
    await f.runtime.boundary(a.agent, new AbortController().signal)
    await until(() => f.pending.length === 1, 'started')
    await f.bank.write(caller, 'persona-project', {
      key: '稳定约定',
      body: 'USER_CORRECTION_642',
      revision: (await f.bank.catalog(caller, 'persona-project')).revision
    })
    const incoming = a.session.append(
      'user/message',
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: '用户刚刚更正了原来的约定，请保持新结论。' }]
      }),
      { surfaceOp: 'append' }
    )
    f.pending[0].release()
    await until(() => f.runtime.snapshot('correction').records[0].phase === 'ready', 'prepared')
    await delay(20)
    const row = f.runtime.snapshot('correction').records[0]
    await f.runtime.boundary(a.agent, new AbortController().signal)
    await assert.rejects(f.runtime.decideMemory('correction', row.id, 0, 'accept', f.root), /已经变化/)
    assert.ok(a.session.surface.nodes.includes(incoming.seq))
    assert.match(
      (await f.bank.search(caller, 'persona-project', 'USER_CORRECTION_642')).results[0].body,
      /USER_CORRECTION/
    )
  }
)

test(
  'restart discards old ready candidates and recognizes a native replacement even when its auxiliary receipt was lost',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t),
      a = f.create('restart')
    await f.runtime.boundary(a.agent, new AbortController().signal)
    await until(() => f.pending.length === 1, 'started')
    f.pending[0].release()
    await until(() => f.runtime.snapshot('restart').records[0].phase === 'ready', 'prepared')
    await delay(20)
    const old = f.runtime.snapshot('restart').records[0]
    await f.restart()
    await f.runtime.boundary(a.agent, new AbortController().signal)
    assert.equal(f.runtime.snapshot('restart').records.find((r) => r.id === old.id)?.phase, 'discarded')
    assert.ok(a.session.surface.nodes.includes(a.first.seq))
    assert.equal(f.pending.length, 1)
    f.runtime.requestRetry('restart')
    await until(() => f.pending.length === 2, 'explicit retry')
    f.pending[1].release()
    await until(() => f.runtime.snapshot('restart').records[0].phase === 'ready', 'retry prepared')
    await delay(20)
    const next = f.runtime.snapshot('restart').records[0]
    await f.runtime.boundary(a.agent, new AbortController().signal)
    f.runtime.store.change(next.id, ['committed'], (row) => {
      row.phase = 'committing'
      row.epoch = 'simulated-crashed-process'
      delete row.nativeCompactionId
    })
    await f.restart()
    await f.runtime.boundary(a.agent, new AbortController().signal)
    assert.equal(f.runtime.snapshot('restart').records.find((r) => r.id === next.id)?.phase, 'committed')
    assert.equal(a.session.snapshotEvents().filter((e: any) => e.type === 'compaction/summary').length, 1)
  }
)

test('summary parser does not accept invented evidence or an output that asks for execution', () => {
  assert.throws(
    () =>
      parseSegmentSummary(
        JSON.stringify({ summary: 'x', memories: [{ key: 'x', body: 'y', seqs: [99] }] }),
        [1]
      ),
    /依据/
  )
  assert.throws(
    () => parseSegmentSummary(JSON.stringify({ summary: 'x', memories: [], commands: ['run'] }), [1]),
    /格式/
  )
})

for (const capacity of [null, 32768, 65536, 262144]) {
  test(
    `background input/output budget stays inside the declared window (${capacity ?? 'undeclared minimum'})`,
    { timeout: 20000 },
    async (t) => {
      const f = await fixture(t, capacity),
        a = f.create('window-case', true, true)
      await f.runtime.boundary(a.agent, new AbortController().signal)
      await until(() => f.pending.length === 1, 'window-sized preparation')
      const request = f.pending[0].options,
        row = f.runtime.snapshot(a.agent.id).records[0],
        window = capacity ?? 32768
      assert.equal(row.capacity, window)
      const tokens =
        f.host.tokenMeter.estimateMessage({
          role: 'system',
          content: [{ type: 'text', text: request.system }]
        }) + f.host.tokenMeter.estimateMessage(request.messages[0])
      assert.ok(
        tokens + request.maxTokens < window,
        'actual auxiliary request leaves capacity for its output'
      )
      assert.deepEqual(request.tools, [])
      f.pending[0].release()
      await until(() => f.runtime.snapshot(a.agent.id).records[0].phase === 'ready', 'prepared')
      assert.equal(
        a.session.snapshotEvents().some((e: any) => e.type === 'compaction/start'),
        false
      )
    }
  )
}

test(
  'disabled long-term memory still permits context compaction, but creates no memory proposals',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t),
      a = f.create('memory-off'),
      state = f.identities.read()
    f.identities.action(
      state.revision,
      { type: 'configure', name: '默认助手', instructions: '', memoryEnabled: false },
      a.agent.id,
      f.root
    )
    await f.runtime.boundary(a.agent, new AbortController().signal)
    await until(() => f.pending.length === 1, 'context still works')
    assert.deepEqual(f.pending[0].source.allowedMemoryEvidence, [])
    f.pending[0].release()
    await until(() => f.runtime.snapshot(a.agent.id).records[0].phase === 'ready', 'prepared')
    await delay(15)
    await f.runtime.boundary(a.agent, new AbortController().signal)
    const row = f.runtime.snapshot(a.agent.id).records[0]
    assert.equal(row.phase, 'committed')
    assert.deepEqual(row.prepared?.memories, [])
    assert.ok(row.source.readableSeqs?.includes(a.first.seq))
  }
)
