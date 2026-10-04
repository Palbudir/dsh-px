import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EvidenceIndex,
  reviewEvents,
  validateCheckpoint,
  type Event
} from '../packages/dsh-px-taskflow/src/evidence'
import { ledgerContext, LedgerIndex } from '../packages/dsh-px-taskflow/src/ledger'

test('ledger remains derived from raw evidence through repeated lossy compaction, correction and restart', () => {
  const events: Event[] = [],
    push = (type: string, data: unknown) => events.push({ seq: events.length, time: Date.now(), type, data })
  push('user/message', {
    source: { kind: 'user' },
    content: [{ type: 'text', text: '只修改计算模块，保留用户数据' }]
  })
  push('tool/call', { callId: 'check', name: 'pwsh', arguments: '{}' })
  push('tool/result', {
    message: { role: 'tool', toolCallId: 'check', content: [{ type: 'text', text: '3 tests passed' }] }
  })
  push('tool/call', { callId: 'note', name: 'task_checkpoint', arguments: '{}' })
  const checkpoint = {
    goal: '修复计算',
    summary: '完成初步修改',
    nextStep: '检查边界情况',
    state: 'working',
    evidence: ['check'],
    constraints: '保留用户数据',
    decisions: '不修改 UI'
  }
  push('tool/result', {
    message: {
      role: 'tool',
      toolCallId: 'note',
      content: [{ type: 'text', text: JSON.stringify({ checkpoint }) }]
    }
  })
  for (let i = 0; i < 8; i++) {
    push('compaction/summary', { summary: [{ type: 'text', text: '故意遗漏所有关键细节' }] })
    push('user/message', {
      source: { kind: 'compact-checkpoint' },
      content: [{ type: 'text', text: '摘要' }]
    })
  }
  push('user/message', {
    source: { kind: 'user' },
    content: [{ type: 'text', text: '暂停修复，先整理现状' }]
  })
  const rebuilt = new EvidenceIndex().update(JSON.parse(JSON.stringify(events)))
  const review = reviewEvents(rebuilt, false),
    context = ledgerContext(review)
  assert.match(context, /保留用户数据/)
  assert.match(context, /检查边界情况/)
  assert.match(context, /暂停修复，先整理现状/)
  assert.equal(review.checkpointStale, true)
  assert.equal(review.latestRequest?.text, '暂停修复，先整理现状')
  assert.equal(review.referencedExecutions[0].id, 'check')
  assert.deepEqual(validateCheckpoint(checkpoint, rebuilt), checkpoint)
  assert.equal(new LedgerIndex().update(events).context(), context)
})

test('prompt ledger scans long history once and retains no execution output archive', () => {
  const events: Event[] = Array.from({ length: 10000 }, (_, i) => ({
    seq: i,
    time: i,
    type: 'tool/result',
    data: {
      message: { role: 'tool', toolCallId: 'unrelated', content: [{ type: 'text', text: 'x'.repeat(2000) }] }
    }
  }))
  const ledger = new LedgerIndex().update(events)
  for (let i = 0; i < 100; i++) ledger.update(events).context()
  assert.equal(ledger.processedEvents, 10000)
  events.push({
    seq: 10000,
    time: 1,
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] }
  })
  ledger.update(events)
  assert.equal(ledger.processedEvents, 10001)
})
test('ledger optional fields stay backward compatible and reject excessive data', () => {
  const c = { goal: 'g', summary: 's', nextStep: 'n', state: 'working', evidence: [] }
  assert.deepEqual(validateCheckpoint(c, []), c)
  assert.throws(() => validateCheckpoint({ ...c, constraints: 'x'.repeat(2001) }, []))
  assert.equal(ledgerContext(reviewEvents([])), '')
})
