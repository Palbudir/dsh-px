import test from 'node:test'
import assert from 'node:assert/strict'
import { channelTaskOutput } from '../packages/dsh-px-workbench/src/channel-task-output'

test('transport recovery extracts only public native output and retains stable part identities', () => {
  const text = 'x'.repeat(3399) + '🐟' + 'z'.repeat(20)
  const parts = channelTaskOutput({
    seq: 42,
    type: 'assistant/message',
    data: {
      message: {
        content: [
          { type: 'reasoning', text: 'private-reasoning' },
          { type: 'text', text }
        ]
      }
    }
  })
  assert.deepEqual(
    parts.map((p) => p.key),
    ['task-event:42:0', 'task-event:42:1']
  )
  assert.equal(parts.map((p) => p.body.replace(/^任务输出 \d+\/\d+\n/, '')).join(''), text)
  assert.ok(parts.every((p) => !/[\uD800-\uDBFF]$/.test(p.body)))
  assert.deepEqual(channelTaskOutput({ seq: 43, type: 'tool/result', data: { text: 'not deliverable' } }), [])
  assert.deepEqual(channelTaskOutput({ seq: 44, type: 'turn/end', data: { reason: { kind: 'stop' } } }), [])
})
