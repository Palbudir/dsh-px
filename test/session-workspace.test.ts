import { localHandler } from './http-fixture'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { artifacts, messages, nextOccurrence, quoteDraft, type RecordEvent, type Schedule } from '../packages/dsh-px-workspace/src/model'
import { Scheduler, WorkspaceStore } from '../packages/dsh-px-workspace/src/store'
import { apply } from '../packages/dsh-px-workspace/src/index'
import { insertQuote } from '../packages/dsh-px-workspace/src/client-input'

function fixture () {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-workspace-'))
  const path = join(root, 'state.json')
  return { root, path, store: new WorkspaceStore(path), close: () => rmSync(root, { recursive: true, force: true }) }
}
const event = (seq: number, type: string, data: any): RecordEvent => ({ seq, time: seq * 1000, type, data })
const events = [
  event(1, 'user/message', { id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: '需要核对' }] }),
  event(2, 'user/message', { id: 'internal', source: { kind: 'injected' }, content: [{ type: 'text', text: 'internal context' }] }),
  event(3, 'assistant/message', { message: { id: 'a', content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: '结果\n待修复' }, { type: 'tool-call', arguments: 'secret' }] } }),
  event(4, 'deliverables/presented', { files: [{ path: 'a.md', description: '旧版' }, { path: 'b.html' }] }),
  event(5, 'deliverables/presented', { files: [{ path: 'a.md', description: '新版' }] }),
  event(6, 'tool/result', { output: 'changed c.txt' })
]
test('quotes contain only authored visible text; artifacts come only from explicit presentation', () => {
  assert.deepEqual(messages(events).map(m => m.text), ['需要核对', '结果\n待修复'])
  assert.equal(artifacts(events).length, 2)
  assert.equal(artifacts(events).find(a => a.path === 'a.md')?.description, '新版')
  assert.match(quoteDraft({ sessionId: 's', seq: 3, quote: '结果\n待修复', note: '检查边界' }), /> 结果\n> 待修复/)
})
test('annotations survive reload, validate exact source and reject stale edits/deletes', () => {
  const f = fixture()
  try {
    const source = messages(events)[1]
    const a = f.store.saveAnnotation({ sessionId: 's', messageId: 'a', quote: '待修复', note: '检查边界' }, source, 100)
    assert.equal(new WorkspaceStore(f.path).snapshot().annotations[0].note, '检查边界')
    assert.throws(() => f.store.saveAnnotation({ ...a, quote: '并不存在' }, source), /连续原文/)
    const b = f.store.saveAnnotation({ ...a, note: '已修复' }, source, 101)
    assert.throws(() => f.store.saveAnnotation(a, source), /已变化/)
    assert.throws(() => f.store.deleteAnnotation(a), /已变化/)
    f.store.deleteAnnotation(b)
    assert.equal(f.store.snapshot().annotations.length, 0)
  } finally { f.close() }
})
test('invalid persisted state is preserved and never replaced with an empty store', () => {
  const f = fixture()
  try { writeFileSync(f.path, '{broken'); assert.throws(() => new WorkspaceStore(f.path), /无法读取/); assert.equal(readFileSync(f.path, 'utf8'), '{broken') } finally { f.close() }
})
const input = (now: number) => ({ title: '测试', sessionId: 'session-owner', prompt: '只回复测试结果', timing: { kind: 'once' as const, at: now + 1000 }, enabled: true })
test('due schedule targets the saved owner, claims before admission, and survives restart without duplicate', async () => {
  const f = fixture(); let now = 100000, count = 0
  try {
    const scheduler = new Scheduler(f.store, async (s, id) => {
      count++; assert.equal(s.sessionId, 'session-owner')
      const claim = new WorkspaceStore(f.path).snapshot().schedules[0].history[0]
      assert.equal(claim.requestId, id); assert.equal(claim.status, 'dispatching')
    }, 'Asia/Shanghai', () => now)
    scheduler.save(input(now)); await scheduler.tick(); assert.equal(count, 0)
    now += 1000; await scheduler.tick(); await scheduler.tick()
    assert.equal(count, 1); assert.equal(f.store.snapshot().schedules[0].history[0].status, 'queued')
    const restored = new Scheduler(new WorkspaceStore(f.path), async () => { count++ }, 'Asia/Shanghai', () => now)
    await restored.tick(); assert.equal(count, 1)
  } finally { f.close() }
})
test('concurrent ticks and manual delivery cannot duplicate a claimed task; mutation is rejected in flight', async () => {
  const f = fixture(); let release!: () => void, calls = 0, now = 100000
  try {
    const scheduler = new Scheduler(f.store, async () => { calls++; await new Promise<void>(r => { release = r }) }, 'Asia/Shanghai', () => now)
    const s = scheduler.save(input(now)); now += 1000
    const tick = scheduler.tick(); await scheduler.tick()
    assert.equal(calls, 1); assert.throws(() => scheduler.remove(s), /正在投递/)
    await assert.rejects(scheduler.run(s.id), /正在投递/)
    release(); await tick; assert.equal(calls, 1)
  } finally { f.close() }
})
test('failed or interrupted admission pauses instead of silently retrying', async () => {
  const f = fixture(); let now = 100000, count = 0
  try {
    const scheduler = new Scheduler(f.store, async () => { count++; throw new Error('connection lost') }, 'Asia/Shanghai', () => now)
    scheduler.save({ ...input(now), timing: { kind: 'interval', minutes: 1 } }); now += 60000
    await scheduler.tick(); now += 120000; await scheduler.tick()
    assert.equal(count, 1); assert.equal(f.store.snapshot().schedules[0].enabled, false)
    assert.equal(f.store.snapshot().schedules[0].history[0].status, 'uncertain')
    f.store.update(state => { state.schedules[0].enabled = true; state.schedules[0].nextAt = now; state.schedules[0].history[0].status = 'dispatching' })
    const restored = new Scheduler(new WorkspaceStore(f.path), async () => { count++ }, 'Asia/Shanghai', () => now)
    await restored.tick(); assert.equal(count, 1)
    assert.equal(restored.store.snapshot().schedules[0].history[0].status, 'uncertain')
  } finally { f.close() }
})
test('recurrences skip missed backlog; edits pause/resume, stale writes fail, timezone change pauses', async () => {
  const f = fixture(); let now = 100000, count = 0
  try {
    const scheduler = new Scheduler(f.store, async () => { count++ }, 'Asia/Shanghai', () => now)
    const s = scheduler.save({ ...input(now), timing: { kind: 'interval', minutes: 1 } })
    now += 86400000; await scheduler.tick(); await scheduler.tick()
    assert.equal(count, 1); assert.equal(f.store.snapshot().schedules[0].nextAt, now + 60000)
    assert.throws(() => scheduler.save({ ...s, enabled: false }), /已变化/)
    const paused = scheduler.save({ ...f.store.snapshot().schedules[0], enabled: false })
    now += 60000; await scheduler.tick(); assert.equal(count, 1)
    scheduler.save({ ...paused, enabled: true }); now += 60000
    const moved = new Scheduler(f.store, async () => { count++ }, 'UTC', () => now)
    await moved.tick(); assert.equal(count, 1); assert.equal(f.store.snapshot().schedules[0].enabled, false)
    assert.match(f.store.snapshot().schedules[0].history[0].detail!, /时区/)
  } finally { f.close() }
})
test('daily next occurrence uses the local calendar and one-shot rejects past times', () => {
  const morning = new Date(2026, 8, 24, 8, 0).getTime()
  assert.equal(nextOccurrence({ kind: 'daily', time: '09:30' }, morning), new Date(2026, 8, 24, 9, 30).getTime())
  assert.equal(nextOccurrence({ kind: 'daily', time: '09:30' }, morning + 7200000), new Date(2026, 8, 25, 9, 30).getTime())
  const f = fixture()
  try { const s = new Scheduler(f.store, async () => {}, 'UTC', () => 100000); assert.throws(() => s.save(input(1)), /将来/); assert.throws(() => s.save({ ...input(100000), timing: { kind: 'interval', minutes: 0 } }), /至少/); assert.throws(() => s.save({ ...input(100000), timing: { kind: 'daily', time: '25:00' } }), /有效/)} finally { f.close() }
})
test('authenticated API rejects write-by-GET and missing CSRF header; uses native queue mode and refuses subagent target', async () => {
  const f = fixture(), previous = process.env.DSH_HOME, routes = new Map<string, any>(), disposers: Array<() => void> = []
  const admitted: any[] = []
  process.env.DSH_HOME = f.root
  try {
    apply({ inject: (_services, cb) => cb({ sessions: { get: id => ({ header: { id, origin: id === 'child' ? 'subagent' : undefined }, snapshotEvents: () => events }) },
      sessionController: { inspect: async () => { throw new Error('not needed') }, prompt: async (r, signal) => { signal.throwIfAborted(); admitted.push(r); return { accepted: true } } },
      effect: fn => { disposers.push(fn()) }, webServer: { register: r => { routes.set(r.path, localHandler(r.handler)); return () => {} } } }) })
    async function request (route: string, method: string, value: unknown, header = true): Promise<{ status: number, data: any }> {
      let status = 0, data: any
      const req = Object.assign(Readable.from([JSON.stringify(value)]), { method, url: basePath(route), headers: { 'content-type': 'application/json', ...(header ? { 'x-dsh-px-request': '1' } : {}) } })
      await routes.get(basePath(route))(req, { writeHead: (s: number) => { status = s }, end: (b: string) => { data = JSON.parse(b) } })
      return { status, data }
    }
    assert.equal((await request('schedules', 'POST', { action: 'save', ...input(Date.now()) }, false)).status, 403)
    assert.equal((await request('schedules', 'POST', { action: 'save', ...input(Date.now()), sessionId: 'child' })).status, 400)
    const saved = await request('schedules', 'POST', { action: 'save', ...input(Date.now()) })
    assert.equal(saved.status, 200)
    await request('schedules', 'GET', { action: 'run', id: saved.data.id }); assert.equal(admitted.length, 0)
    const result = await request('schedules', 'POST', { action: 'run', id: saved.data.id })
    assert.equal(result.status, 200); assert.equal(result.data.history[0].status, 'queued')
    assert.equal(admitted[0].mode, 'queue'); assert.equal(admitted[0].sessionId, 'session-owner')
  } finally { disposers.forEach(fn => fn()); if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; f.close() }
})
function basePath (route: string): string { return '/dsh-px-workspace/' + route }
test('plugin shutdown leaves the claim for recovery and cannot overwrite new-instance data', async () => {
  const f = fixture(); let release!: () => void
  try {
    const scheduler = new Scheduler(f.store, async () => { await new Promise<void>(r => { release = r }) }, 'UTC', () => 100000)
    const s = scheduler.save(input(100000)), running = scheduler.run(s.id)
    scheduler.stop()
    const fresh = new WorkspaceStore(f.path)
    new Scheduler(fresh, async () => {}, 'UTC', () => 100001)
    fresh.update(state => { state.schedules[0].title = '新实例已恢复' })
    release(); await assert.rejects(running, /服务在投递期间停止/)
    assert.equal(new WorkspaceStore(f.path).snapshot().schedules[0].title, '新实例已恢复')
  } finally { f.close() }
})
test('quote insertion explicitly scopes native events and appends without replacing another session draft', () => {
  const drafts = { a: '已有草稿 A', b: '已有草稿 B' }
  const scope: any = { bail: (dispatch: unknown, name: string, request: any) => {
    assert.equal(dispatch, scope); assert.equal(name, 'slash/input-insert-text')
    assert.equal(request.span.start, drafts.b.length); assert.equal(request.span.end, drafts.b.length)
    drafts.b += request.text; return true
  } }
  insertQuote({ sessions: { scope: id => id === 'b' ? scope : undefined }, conversation: { input: { for: c => { assert.equal(c, scope); return { state: { getSnapshot: () => ({ draft: drafts.b, draftRev: 3, phase: 'plain' }) }, notify: () => {} } } } } }, 'b', { sessionId: 'a', seq: 1, quote: '引用正文', note: '我的批注' })
  assert.equal(drafts.a, '已有草稿 A'); assert.match(drafts.b, /^已有草稿 B\n\n引用历史/); assert.match(drafts.b, /我的批注/)
})
