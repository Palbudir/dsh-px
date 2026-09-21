import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reviewEvents, validateCheckpoint, type Event } from '../packages/dsh-px-taskflow/src/evidence'
import { apply } from '../packages/dsh-px-taskflow/src/index'
import { desktopCheckLabel } from '../packages/dsh-px-updater/src/client-data'
const start = (id: string, tool: string, seq: number, args = {}): Event => ({ seq, time: seq * 100, type: 'tool/call', data: { callId: id, name: tool, arguments: JSON.stringify(args) } })
const result = (id: string, seq: number, text: string, isError = false): Event => ({ seq, time: seq * 100, type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: id, isError, content: [{ type: 'text', text }] }] } } })
const checkpoint = { goal: '修复计算', summary: '已完成修改与测试', nextStep: '', state: 'ready_for_review', evidence: ['check'] }

test('任务记录从持久会话恢复；保留失败复现的证据状态；修改与检查准确关联', () => {
  const events = [start('edit', 'edit', 0, { file_path: 'calc.js' }), result('edit', 1, 'done'),
    start('fail', 'pwsh', 2, { command: 'node --test' }), result('fail', 3, 'failed\n[exit code: 1]'),
    start('check', 'pwsh', 4, { command: 'node --test' }), result('check', 5, 'tests 2, pass 2')]
  assert.throws(() => validateCheckpoint({ ...checkpoint, evidence: ['invented'] }, events), /不存在/)
  assert.deepEqual(validateCheckpoint({ ...checkpoint, evidence: ['fail', 'check'] }, events).evidence, ['fail', 'check'])
  assert.throws(() => validateCheckpoint({ ...checkpoint, evidence: [] }, events), /至少引用/)
  assert.throws(() => validateCheckpoint({ ...checkpoint, state: 'working' }, events), /下一步/)
  const stored = validateCheckpoint(checkpoint, events)
  events.push(start('cp', 'task_checkpoint', 6), result('cp', 7, JSON.stringify({ checkpoint: stored })))
  const restored = reviewEvents(JSON.parse(JSON.stringify(events)), false)
  assert.equal(restored.checkpoint?.goal, checkpoint.goal)
  assert.deepEqual(restored.changedFiles, ['calc.js'])
  assert.equal(restored.executions[1].outcome, 'error')
  assert.equal(restored.executions[2].durationMs, 100)
  assert.equal(restored.checkpointStale, false)
  events.push(start('later', 'edit', 8, { file_path: 'calc.js' }))
  assert.equal(reviewEvents(events, false).checkpointStale, true)
  assert.equal(reviewEvents(events, false).executions.at(-1)?.outcome, 'interrupted')
})

test('工具缺失结果、嵌套调用、跨轮次、输出截断与会话隔离', () => {
  const events: Event[] = [ { seq: 0, time: 0, type: 'turn/start', data: {} }, start('old', 'write', 1),
    { seq: 2, time: 200, type: 'turn/start', data: {} }, start('new', 'pwsh', 3),
    { seq: 4, time: 400, type: 'tool/ptc-dispatch-start', data: { subCallId: 'nested', name: 'read', arguments: { file_path: 'a' } } },
    { seq: 5, time: 500, type: 'tool/ptc-dispatch', data: { subCallId: 'nested', isError: false, content: [{ type: 'text', text: 'x'.repeat(6000) }] } } ]
  const review = reviewEvents(events)
  assert.equal(review.executions[0].outcome, 'interrupted')
  assert.equal(review.executions[1].outcome, 'running')
  assert.equal(review.executions[2].outcome, 'returned')
  assert.match(review.executions[2].output, /输出已截断/)
  assert.ok(review.executions[2].output.length < 2500)
  assert.equal(reviewEvents([]).total, 0)
  assert.deepEqual(review.changedFiles, [])
})

test('任务插件使用当前会话与只读持久句柄；错误也关闭句柄，路由可卸载', async () => {
  const routes = new Map<string, any>(), tools = new Map<string, any>(), cleanup: Array<() => void> = []
  let closed = 0
  const ctx: any = {
    effect: (fn: () => (() => void) | void) => { const dispose = fn(); if (dispose) cleanup.push(dispose) },
    inject: (_: unknown, fn: (ctx: any) => void) => fn(ctx),
    systemPrompt: { section: () => () => {} },
    tools: { register: (tool: any) => tools.set(tool.name, tool) },
    sessions: { get: (id: string) => id === 'live' ? { snapshotEvents: () => [] } : undefined },
    sessionPersistence: { open: async (_: string, mode: string) => {
      assert.equal(mode, 'read'); return { read: async () => { throw new Error('corrupt') }, close: async () => { closed++ } }
    } },
    webServer: { register: (r: any) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
  }
  apply(ctx)
  const request = async (method: string, id: string): Promise<number> => {
    let status = 0
    await routes.get('/dsh-px-taskflow/review')({ method, url: `/review?sessionId=${id}` }, { writeHead: (n: number) => { status = n }, end: () => {} })
    return status
  }
  assert.equal(await request('POST', 'live'), 405)
  assert.equal(await request('GET', '../outside'), 400)
  assert.equal(await request('GET', 'live'), 200)
  assert.equal(await request('GET', 'cold'), 404)
  assert.equal(closed, 1)
  await assert.rejects(tools.get('task_review').execute({}, { signal: new AbortController().signal }), /当前会话/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(tools.get('task_review').execute({}, { signal: controller.signal, agent: { session: { snapshotEvents: () => [] } } }))
  cleanup.forEach(fn => fn()); assert.equal(routes.size, 0)
})

test('桌面检查完成不再同时显示尚未检查；历史时间不会冒充本次结果', () => {
  const shell = { phase: 'idle', version: '0.1.0-beta.re.0.7', lastCheckedAt: new Date().toISOString() }
  assert.equal(desktopCheckLabel(shell, false), 'upToDate')
  assert.equal(desktopCheckLabel({ ...shell, version: null }, false), 'notChecked')
  assert.equal(desktopCheckLabel(shell, true), 'shellDisconnected')
  assert.equal(desktopCheckLabel({ ...shell, phase: 'error' }, false), 'checkFailed')
})
