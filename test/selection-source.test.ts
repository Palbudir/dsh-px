import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectionSource } from '../packages/dsh-px-workspace/src/selection-source'
import { createQuoteRequests } from '../packages/shared/quote-requests'

test('sentence selection resolves beyond the initial message page and remains tied to the durable source', () => {
  const source = {
    id: 'message-1',
    seq: 42,
    time: 0,
    role: 'assistant' as const,
    text: 'x'.repeat(50000) + '需要调整的原句' + 'y'.repeat(40000)
  }
  const selected = selectionSource(source, '需要调整的原句')
  assert.equal(selected.id, source.id)
  assert.equal(selected.seq, 42)
  assert.ok(selected.offset > 32000)
  assert.ok(selected.text.includes('需要调整的原句'))
  assert.ok(selected.text.length <= 32000)
  assert.throws(() => selectionSource(source, '不存在的引文'))
  assert.throws(() => selectionSource(undefined, '需要调整的原句'))
  assert.throws(() => selectionSource(source, 'x'.repeat(8001)))
})
test('queued sentence selections retain their own quote across late consumers and other sessions', () => {
  const requests = createQuoteRequests()
  requests.request('a', 'm1', '旧原句')
  const old = requests.getSnapshot().a.token
  requests.request('a', 'm2', '新原句')
  requests.request('b', 'm3', '另一会话')
  requests.consume('a', old)
  assert.equal(requests.getSnapshot().a.quote, '新原句')
  requests.consume('a', requests.getSnapshot().a.token)
  assert.equal(requests.getSnapshot().b.quote, '另一会话')
})
