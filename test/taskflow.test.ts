import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evidenceDetail, reviewEvents, validateCheckpoint, type Event } from '../packages/dsh-px-taskflow/src/evidence'
import { apply, readFailure } from '../packages/dsh-px-taskflow/src/index'
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
  assert.equal(review.executions[2].outputTruncated, true)
  assert.equal(review.executions[2].output.length, 240)
  assert.equal(evidenceDetail(events, 'nested')?.output.length, 4000)
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
      assert.equal(mode, 'read'); return { read: async () => { throw Object.assign(new Error('corrupt'), { name: 'SessionPersistenceCorruptionError' }) }, close: async () => { closed++; throw new Error('close failed') } }
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
  assert.equal(await request('GET', 'cold'), 422)
  assert.equal(closed, 1)
  await assert.rejects(tools.get('task_review').execute({}, { signal: new AbortController().signal }), /当前会话/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(tools.get('task_review').execute({}, { signal: controller.signal, agent: { session: { snapshotEvents: () => [] } } }))
  cleanup.forEach(fn => fn()); assert.equal(routes.size, 0)
})

test('只解析命令尾部状态标记；读取日志成功、只读查看及交付不会产生修改或过时告警', () => {
  const events = [start('check', 'pwsh', 0), result('check', 1, 'pass'), start('cp', 'task_checkpoint', 2),
    result('cp', 3, JSON.stringify({ checkpoint })),
    start('log', 'read', 4, { file_path: 'log.txt' }), result('log', 5, '[exit code: 1]\n[timed out]\nError: tool call aborted'),
    start('view', 'str_replace_editor', 6, { command: 'view', path: 'README.md' }), result('view', 7, '[sandbox: file access denied]'),
    start('show', 'present', 8), result('show', 9, 'done'),
    start('detail', 'task_evidence', 10), result('detail', 11, 'history')]
  const review = reviewEvents(events)
  assert.equal(review.executions.length, 4)
  assert.ok(review.executions.every(c => c.outcome === 'returned'))
  assert.deepEqual(review.changedFiles, [])
  assert.equal(review.checkpointStale, false)
  const writes = [...events, start('edit', 'str_replace_editor', 12, { command: 'str_replace', path: 'a' }), result('edit', 13, 'done')]
  assert.deepEqual(reviewEvents(writes).changedFiles, ['a'])
  assert.equal(reviewEvents(writes).checkpointStale, true)
  const failures = [start('cmd', 'pwsh', 0), result('cmd', 1, 'failed\n[exit code: 2]'),
    start('quoted', 'pwsh', 2), result('quoted', 3, 'historical [exit code: 1]\nall passed'),
    start('timeout', 'bash', 4), result('timeout', 5, '[timed out after 1000ms]\n[exit code: 0]')]
  assert.deepEqual(reviewEvents(failures).executions.map(c => [c.outcome, c.outcomeSource]), [['error', 'command_marker'], ['returned', 'tool'], ['error', 'command_marker']])
})

test('用户取消、已返回的失败、未知中断与仍在运行分别保留', () => {
  const events: Event[] = [{ type: 'turn/start', seq: 0, time: 0, data: {} },
    start('failed', 'pwsh', 1), result('failed', 2, 'failed\n[exit code: 1]'),
    start('cancel', 'pwsh', 3), result('cancel', 4, 'Error: tool call aborted', true), start('pending', 'write', 5)]
  assert.equal(reviewEvents(events).executions.at(-1)?.outcome, 'running')
  events.push({ type: 'turn/end', seq: 6, time: 600, data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  assert.deepEqual(reviewEvents(events).executions.map(c => c.outcome), ['error', 'cancelled', 'cancelled'])
  assert.throws(() => validateCheckpoint({ ...checkpoint, evidence: ['cancel'] }, events), /已结算/)
  assert.equal(reviewEvents([start('unknown', 'pwsh', 0)], false).executions[0].outcome, 'interrupted')
})

test('200 次执行可无重叠遍历、引用早期证据、分段读取而不重放工具', () => {
  const events: Event[] = []
  const text = 'prefix-' + '内容\n'.repeat(5000) + '-end'
  for (let i = 0; i < 200; i++) events.push(start(`c${i}`, 'read', i * 2, { file_path: 'a'.repeat(1200) }), result(`c${i}`, i * 2 + 1, text))
  const ids: string[] = []
  let beforeSeq: number | undefined
  do {
    const page = reviewEvents(events, false, { beforeSeq, limit: 17 })
    ids.push(...page.executions.map(c => c.id))
    beforeSeq = page.nextBeforeSeq ?? undefined
    if (!page.truncated) break
  } while (true)
  assert.equal(ids.length, 200); assert.equal(new Set(ids).size, 200)
  assert.deepEqual(validateCheckpoint({ ...checkpoint, evidence: ['c0'] }, events).evidence, ['c0'])
  let output = '', offset = 0
  while (true) {
    const value = evidenceDetail(events, 'c0', false, { offset, maxChars: 777 })!
    output += value.output
    if (value.nextOutputOffset === null) break
    offset = value.nextOutputOffset
  }
  assert.equal(output, text)
  const summary = reviewEvents(events)
  assert.equal(summary.executions.length, 20)
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 30000, '固定长输出样例的默认摘要受预算约束')
  events.push(start('cp', 'task_checkpoint', 400), result('cp', 401, JSON.stringify({ checkpoint: { ...checkpoint, evidence: ['c0'] } })))
  assert.equal(reviewEvents(events).referencedExecutions[0].id, 'c0')
  assert.equal(evidenceDetail([], 'c0'), null, '不能从另一会话读取编号')
  assert.equal(evidenceDetail(events, 'cp'), null, '不递归展开自身工作记录')
  assert.throws(() => validateCheckpoint({ ...checkpoint, evidence: ['cp'] }, events), /不存在/)
  assert.throws(() => reviewEvents(events, true, { limit: 51 }), /分页/)
  assert.throws(() => reviewEvents(events, true, { beforeSeq: -1 }), /分页/)
  assert.throws(() => evidenceDetail(events, 'c0', true, { maxChars: 8001 }), /分页/)
  assert.equal(evidenceDetail(events, 'c0', false, { offset: text.length })?.output, '')
})

test('读取错误类型和 HTTP 查询参数明确，未知执行不误报会话丢失', async () => {
  const table = [
    [{ name: 'SessionPersistenceNotFoundError' }, 404, false], [{ name: 'SessionPersistenceCorruptionError' }, 422, false],
    [new Error('corrupt Zstandard session log: first frame is not exactly one header line'), 422, false],
    [new Error('corrupt session log: header line is not valid JSON'), 422, false], [new Error('empty or header-less Zstandard session log'), 422, false],
    [{ name: 'SessionFormatUnsupportedError' }, 409, false], [{ code: 'EACCES' }, 403, false], [{ code: 'EBUSY' }, 503, true], [new Error('SECRET'), 500, true]
  ] as const
  for (const [error, status, retryable] of table) {
    const value = readFailure(error); assert.equal(value.status, status); assert.equal(value.retryable, retryable)
    assert.doesNotMatch(JSON.stringify(value), /SECRET/)
  }
  const routes = new Map<string, any>(), events = [start('a', 'read', 0), result('a', 1, '0123456789')]
  apply({ inject: (_: unknown, fn: any) => fn({ effect: (fn: any) => fn(),
    systemPrompt: { section: () => () => {} }, tools: { register: () => {} },
    sessions: { get: (id: string) => id === 'live' ? { snapshotEvents: () => events } : undefined },
    sessionPersistence: { open: async () => { throw Object.assign(new Error('missing'), { name: 'SessionPersistenceNotFoundError' }) } },
    webServer: { register: (r: any) => { routes.set(r.path, r.handler); return () => {} } }
  }), effect: () => {} })
  async function request (kind: string, query: string): Promise<{ status: number, data: any }> {
    let status = 0, data: any
    await routes.get('/dsh-px-taskflow/' + kind)({ method: 'GET', url: '/?' + query }, { writeHead: (s: number) => { status = s }, end: (s: string) => { data = JSON.parse(s) } })
    return { status, data }
  }
  assert.equal((await request('review', 'sessionId=live&limit=1&limit=2')).status, 400)
  assert.equal((await request('review', 'sessionId=live&beforeSeq=NaN')).status, 400)
  assert.equal((await request('review', 'sessionId=live&unknown=1')).status, 400)
  assert.equal((await request('evidence', 'sessionId=live&callId=a&offset=3&maxChars=4')).data.output, '3456')
  assert.equal((await request('evidence', 'sessionId=live&callId=missing')).data.code, 'EVIDENCE_NOT_FOUND')
  assert.equal((await request('review', 'sessionId=missing')).data.code, 'SESSION_NOT_FOUND')
})

test('桌面检查完成不再同时显示尚未检查；历史时间不会冒充本次结果', () => {
  const shell = { phase: 'idle', version: '0.1.0-beta.re.0.7', lastCheckedAt: new Date().toISOString() }
  assert.equal(desktopCheckLabel(shell, false), 'upToDate')
  assert.equal(desktopCheckLabel({ ...shell, version: null }, false), 'notChecked')
  assert.equal(desktopCheckLabel(shell, true), 'shellDisconnected')
  assert.equal(desktopCheckLabel({ ...shell, phase: 'error' }, false), 'checkFailed')
})
