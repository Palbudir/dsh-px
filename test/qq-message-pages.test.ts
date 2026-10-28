import test from 'node:test'
import assert from 'node:assert/strict'
import { QqConversation } from '../packages/dsh-px-qq/src/conversation'

const signal = () => new AbortController().signal
test('long messages and all segments can be reconstructed through scoped continuation pages', async () => {
  const long = 'a'.repeat(7999) + '🐟' + 'b'.repeat(10000)
  const segments = [
    { type: 'text', data: { text: long } },
    ...Array.from({ length: 31 }, (_, i) => ({ type: 'text', data: { text: 'segment-' + i } })),
    { type: 'json', data: { data: 'json-content-' + 'x'.repeat(9000) } }
  ]
  const tools = new QqConversation(async () => ({
    messages: [{ message_id: 1, message_seq: 33, message: segments }]
  }))
  const history = await tools.execute('qq_context', { action: 'history' }, 's', 'group:34007', signal())
  assert.equal(history.truncated, true)
  assert.equal(history.messages[0].truncated, true)
  const reference = history.messages[0].reference,
    rebuilt = new Map<number, string>()
  let cursor: any = { offset: 0, textOffset: 0 },
    pages = 0
  do {
    const page = await tools.execute(
      'qq_context',
      { action: 'message', reference, ...cursor },
      's',
      'group:34007',
      signal()
    )
    assert.ok(page.content.length <= 30)
    assert.ok(page.content.reduce((n: number, p: any) => n + (p.text?.length ?? 0), 0) <= 8000)
    for (const part of page.content) {
      assert.ok(!/^[\uDC00-\uDFFF]/.test(part.text))
      assert.ok(!/[\uD800-\uDBFF]$/.test(part.text))
      rebuilt.set(part.segment, (rebuilt.get(part.segment) ?? '') + part.text)
    }
    cursor = page.next
    assert.ok(++pages < 20)
  } while (cursor)
  assert.equal(rebuilt.size, segments.length)
  assert.equal(rebuilt.get(0), long)
  for (let i = 1; i <= 31; i++) assert.equal(rebuilt.get(i), 'segment-' + (i - 1))
  assert.deepEqual(JSON.parse(rebuilt.get(32)!), segments[32].data)
  await assert.rejects(
    tools.execute('qq_context', { action: 'message', reference }, 'other', 'group:34007', signal()),
    /不属于/
  )
  await assert.rejects(
    tools.execute('qq_context', { action: 'message', reference }, 's', 'group:99999', signal()),
    /不属于/
  )
  tools.clear()
  await assert.rejects(
    tools.execute('qq_context', { action: 'message', reference }, 's', 'group:34007', signal()),
    /过期/
  )
})

test('dense image history keeps every returned preview live and all remaining images readable', async () => {
  let sent = 0
  const messages = Array.from({ length: 50 }, (_, m) => ({
    message_id: m + 1,
    message_seq: m + 1,
    message: Array.from({ length: 9 }, (_, n) => ({
      type: 'image',
      data: { url: `https://gchat.qpic.cn/${m}-${n}.png` }
    }))
  }))
  const tools = new QqConversation(async (action) =>
    action === 'get_group_msg_history' ? { messages } : (sent++, { message_id: sent })
  )
  const history = await tools.execute(
    'qq_context',
    { action: 'history', count: 50 },
    's',
    'group:34007',
    signal()
  )
  const previews = history.messages.flatMap((m: any) => m.content)
  assert.equal(previews.length, 200)
  for (const p of previews)
    await tools.execute(
      'qq_expression',
      { action: 'image', reference: p.reference },
      's',
      'group:34007',
      signal()
    )
  assert.equal(sent, 200)
  let images = 0
  for (const message of history.messages) {
    assert.equal(message.truncated, true)
    const page = await tools.execute(
      'qq_context',
      { action: 'message', reference: message.reference },
      's',
      'group:34007',
      signal()
    )
    assert.equal(page.next, null)
    for (const p of page.content) {
      await tools.execute(
        'qq_expression',
        { action: 'image', reference: p.reference },
        's',
        'group:34007',
        signal()
      )
      images++
    }
  }
  assert.equal(images, 450)
})
