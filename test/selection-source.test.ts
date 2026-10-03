import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectionSource } from '../packages/dsh-px-workspace/src/selection-source'
import { createQuoteRequests } from '../packages/shared/quote-requests'
import { quoteMatches } from '../packages/dsh-px-workspace/src/quote-text'

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

test('formatted selection verifies visible Markdown text without treating link targets or code markup as prose', () => {
  const source = {
    id: 'formatted',
    seq: 51,
    time: 0,
    role: 'assistant' as const,
    text: '请检查 **社区来源**、[上游版本](https://example.com) 和 `PX` 补丁。'
  }
  const quote = '社区来源、上游版本 和 PX 补丁'
  const result = selectionSource(source, quote)
  assert.equal(result.rendered, true)
  assert.ok(result.text.includes(quote))
  assert.ok(quoteMatches(source.text, quote))
  assert.ok(quoteMatches('**第一段**\n\n第二段', '第一段\n\n\n第二段'))
  assert.equal(quoteMatches('`value_a = 2`', 'valuea = 2'), false)
  assert.equal(quoteMatches(source.text, '上游版本 https://example.com'), false)
  const long = { ...source, text: '正文\n\n'.repeat(16000) + source.text }
  const tail = selectionSource(long, quote)
  assert.ok(tail.offset > 32000)
  assert.ok(tail.text.includes(quote))
})
