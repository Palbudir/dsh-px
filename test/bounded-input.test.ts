import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundedInputPlan } from '../packages/dsh-px-computer/src/bounded-input'

const base = { pid: 20, window_id: 40, keys: ['w'], duration_ms: 250, delivery_mode: 'foreground' }
test('continuous input rejects unbounded plans, hidden focus escalation and unsafe chords', () => {
  for (const change of [
    { duration_ms: 0 },
    { duration_ms: 10001 },
    { duration_ms: Infinity },
    { duration_ms: '250' },
    { dx: 2001 },
    { dy: NaN },
    { pid: -1 },
    { window_id: 0 },
    { delivery_mode: 'background' },
    { keys: ['win', 'r'] },
    { keys: ['ctrl', 'alt', 'delete'] },
    { keys: ['ctrl+w'] },
    { keys: ['shift', 'shift_l'] },
    { buttons: ['left', 'left'] },
    { buttons: ['unknown'] },
    { keys: ['w', 'a', 's', 'd', 'q', 'e', 'r'] },
    { keys: [] }
  ])
    assert.throws(() => boundedInputPlan({ ...base, ...change }), JSON.stringify(change))
})
test('generic input supports modifiers, navigation, mouse holds and relative movement without game-specific names', () => {
  assert.deepEqual(
    boundedInputPlan({ ...base, keys: ['ctrl', 'up', 'F3'], buttons: ['right'], dx: -100, dy: 200 }),
    {
      pid: 20,
      window_id: 40,
      keys: [17, 38, 114],
      buttons: ['right'],
      duration_ms: 250,
      dx: -100,
      dy: 200
    }
  )
  assert.deepEqual(boundedInputPlan({ ...base, keys: [], dx: 20 }).keys, [])
})
