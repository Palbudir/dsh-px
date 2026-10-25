import test from 'node:test'
import assert from 'node:assert/strict'
import { skipRepeatedCheckpoint } from '../packages/dsh-px-workbench/src/compaction-progress'
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction/checkpoint'

test('automatic pressure preserves a lone small prior summary but keeps new work and large summaries compactable', () => {
  const agent = {
    session: {
      eventAt: () => ({ type: 'user/message', data: { source: compactCheckpointSource('fixture' as any) } })
    }
  }
  const range = { start: 100, end: 100 },
    measurement = { nodes: [{ seq: 100, tokens: 1200 }] },
    spec = { maxTokens: 2048 }
  assert.equal(skipRepeatedCheckpoint(agent, range, measurement, spec), true)
  assert.equal(skipRepeatedCheckpoint(agent, { start: 100, end: 102 }, measurement, spec), false)
  assert.equal(skipRepeatedCheckpoint(agent, range, { nodes: [{ seq: 100, tokens: 9000 }] }, spec), false)
  assert.equal(
    skipRepeatedCheckpoint(
      { session: { eventAt: () => ({ type: 'user/message', data: { source: { kind: 'user' } } }) } },
      range,
      measurement,
      spec
    ),
    false
  )
  assert.equal(skipRepeatedCheckpoint({ session: {} }, range, measurement, spec), false)
  assert.equal(skipRepeatedCheckpoint(agent, range, { nodes: [] }, spec), false)
})
