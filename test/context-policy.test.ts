import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contextTier,
  contextBudget,
  positiveCapacity,
  budgetEntries,
  assertSameTier
} from '../packages/shared/context-policy'

test('model tier boundaries include exact 64K and 256K; unknown is minimum without an invented capacity', () => {
  assert.equal(contextTier(), 'minimum')
  assert.equal(contextBudget().capacity, undefined)
  assert.equal(contextTier(65_536), 'minimum')
  assert.equal(contextTier(65_537), 'brief')
  assert.equal(contextTier(262_144), 'brief')
  assert.equal(contextTier(262_145), 'full')
  for (const value of [0, -1, NaN, Infinity, '65536', 1.5]) assert.equal(positiveCapacity(value), undefined)
  assert.throws(() => assertSameTier('minimum', 'full'), /新建接续/)
  assert.doesNotThrow(() => assertSameTier(undefined, 'full'))
})
test('output and compaction headroom leave space in small windows; memory entries are never sliced mid-record', () => {
  for (const capacity of [1024, 4096, 32768, 65536, 131072, 262144, 1048576]) {
    const b = contextBudget(capacity)
    assert.ok(b.outputTokens + b.headroomTokens < capacity)
    assert.ok(b.summaryTokens <= b.outputTokens)
    assert.ok(b.retainRatio < b.thresholdRatio)
  }
  const rows = [{ text: 'a'.repeat(100) }, { text: 'b' }]
  assert.deepEqual(budgetEntries(rows, 30), { entries: [rows[1]], omitted: 1 })
})
