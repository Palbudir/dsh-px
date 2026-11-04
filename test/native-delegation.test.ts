import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeDelegationRanges } from '../packages/dsh-px-memory/src/native-delegation'

test('nested ordinary forks retain delegated provenance without downgrading later human inputs', async () => {
  const descriptor = { seq: 0, type: 'subagent/descriptor', data: {} },
    delegated = { seq: 1, type: 'user/message', data: { source: { kind: 'user' } } },
    human = { seq: 2, type: 'user/message', data: { source: { kind: 'user' } } }
  const reads: Array<{ id: string; end: number }> = []
  const make = (
    id: string,
    parentSession: string | undefined,
    inheritedEventCount: number,
    events: any[]
  ) => ({
    header: { id, parentSession },
    inheritedEventCount,
    read: async (offset: number, length: number) => {
      const selected = events.slice(offset, offset + length)
      reads.push({ id, end: selected.at(-1)?.seq ?? -1 })
      return { events: selected }
    },
    close: async () => {}
  })
  const child = make('child', 'original', 0, [
    descriptor,
    delegated,
    {
      seq: 2,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'not shared beyond cut' }] }
    }
  ])
  const fork = make('fork', 'child', 2, [descriptor, delegated, human])
  const next = make('next', 'fork', 3, [descriptor, delegated, human, { ...human, seq: 3 }])
  const byId: any = { child, fork }
  const ranges = await nativeDelegationRanges(next, async (id) => byId[id], undefined, 3)
  assert.deepEqual(ranges, [{ from: 0, through: 1 }])
  assert.ok(reads.filter((r) => r.id === 'child').every((r) => r.end <= 1))
  assert.ok(
    !ranges.some((r) => 2 >= r.from && 2 <= r.through),
    'a genuine input made after the ordinary fork is not a delegation'
  )
})

test('missing inherited source stays readable but cannot become independent human evidence', async () => {
  const reader = {
    header: { id: 'fork', parentSession: 'missing' },
    inheritedEventCount: 5,
    read: async () => ({ events: [] })
  }
  assert.deepEqual(
    await nativeDelegationRanges(
      reader,
      async () => {
        throw Error('missing')
      },
      undefined,
      2
    ),
    [{ from: 0, through: 2 }]
  )
})
