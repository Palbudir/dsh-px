import test from 'node:test'
import assert from 'node:assert/strict'
import { QqInteractions, approvalText, questionAnswer } from '../packages/dsh-px-qq/src/interactions'

const request = (signal?: AbortSignal) => ({
  agent: {
    session: {
      id: 's',
      snapshotEvents: () => [
        {
          type: 'tool/call',
          data: { callId: 'call-1', name: 'file_write', arguments: '{"path":"test.txt","content":"hello"}' }
        }
      ]
    }
  },
  toolName: 'file_write',
  callId: 'call-1',
  signal
})
test('approval presents exact arguments and accepts only the routed private decision once', async () => {
  const sent: string[] = [],
    queue = new QqInteractions(async (_chat, text) => {
      sent.push(text)
    })
  const pending = queue.request('approval', request(), 'private:12', async () => {
    throw Error('unexpected fallback')
  })
  const id = queue.list()[0].id
  assert.match(sent[0], /test.txt/)
  assert.throws(() => queue.respond('group:34', { id, decision: 'allowed-once' }), /本私聊/)
  assert.equal(queue.list().length, 1)
  assert.throws(() => queue.respond('private:12', { id, decision: 'yes' }), /批准一次/)
  queue.respond('private:12', { id, decision: 'allowed-once' })
  assert.equal(await pending, 'allowed-once')
  assert.throws(() => queue.respond('private:12', { id, decision: 'allowed-once' }), /已处理/)
  assert.equal(approvalText({ ...request(), callId: 'forged' }), undefined)
})
test('cancel and plugin disposal close native waits; late replies cannot approve', async () => {
  const signal = new AbortController(),
    queue = new QqInteractions(async () => {})
  const first = queue.request('approval', request(signal.signal), 'private:12', async () => undefined)
  const id = queue.list()[0].id
  signal.abort()
  assert.equal(await first, 'cancelled')
  assert.throws(() => queue.respond('private:12', { id, decision: 'allowed-once' }), /已取消/)
  const second = queue.request(
    'question',
    { ...request(), questions: [{ id: 'a', question: 'Where?' }] },
    'private:12',
    async () => undefined
  )
  const rejected = assert.rejects(second, /已停止/)
  queue.dispose()
  await rejected
})
test('structured multi-question answers preserve labels, free text and explicit plan decisions', async () => {
  const queue = new QqInteractions(async () => {})
  const q = { id: 'a', question: 'Choose', options: [{ label: 'X' }, { label: 'Y' }], multiSelect: true }
  const pending = queue.request(
    'question',
    { ...request(), questions: [q, { id: 'b', question: 'Why?' }] },
    'private:12',
    async () => undefined
  )
  const id = queue.list()[0].id
  queue.respond('private:12', { id, question: 1, answer: '2,1' })
  assert.deepEqual(queue.list()[0].answered, [0])
  queue.respond('private:12', { id, question: 2, answer: 'my reason' })
  assert.deepEqual(await pending, {
    answers: [
      { id: 'a', selected: ['Y', 'X'] },
      { id: 'b', selected: [], custom: 'my reason' }
    ]
  })
  assert.throws(
    () => questionAnswer({ ...q, intent: { kind: 'plan-review', approve: 'X' } }, 'okay'),
    /选项序号/
  )
})
test('unrenderable approval delegates to native UI without partial approval commands', async () => {
  const messages: string[] = [],
    queue = new QqInteractions(async (_chat, text) => {
      messages.push(text)
    })
  assert.equal(
    await queue.request(
      'approval',
      { ...request(), callId: undefined },
      'private:12',
      async () => 'rejected'
    ),
    'rejected'
  )
  assert.equal(queue.list().length, 0)
  assert.match(messages[0], /客户端/)
})

test('a unique current-session question accepts an ordinary answer, never an approval or another session', async () => {
  const queue = new QqInteractions(async () => {})
  const question = queue.request(
    'question',
    {
      ...request(),
      questions: [{ id: 'a', question: 'Color?', options: [{ label: 'Red' }, { label: 'Blue' }] }]
    },
    'private:12',
    async () => undefined
  )
  const approval = queue.request('approval', request(), 'private:12', async () => undefined)
  assert.equal(queue.answerPlain('private:12', 'other-session', '2'), undefined)
  assert.equal(queue.answerPlain('private:34', 's', '2'), undefined)
  queue.answerPlain('private:12', 's', '2')
  assert.deepEqual(await question, { answers: [{ id: 'a', selected: ['Blue'] }] })
  assert.equal(queue.answerPlain('private:12', 's', 'yes'), undefined)
  assert.equal(queue.list()[0].kind, 'approval')
  queue.respond('private:12', { id: queue.list()[0].id, decision: 'rejected' })
  assert.equal(await approval, 'rejected')
})
