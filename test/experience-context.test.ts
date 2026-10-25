import test from 'node:test'
import assert from 'node:assert/strict'
import { experienceWindow, redactExperienceText } from '../packages/dsh-px-memory/src/experience-context'
import { inspectMemorySession } from '../packages/dsh-px-memory/src/session-context'
import { experienceModel } from '../packages/dsh-px-memory/src/experience-context'

test('bounded background analysis selects only a declared low effort and leaves source configuration untouched', () => {
  const source = { provider: 'p', model: 'm', reasoningEffort: 'high' }
  const info = { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }], defaultEffort: 'high' }
  assert.equal(experienceModel(source, info).reasoningEffort, 'low')
  assert.equal(source.reasoningEffort, 'high')
  assert.equal(experienceModel({ ...source, reasoningEffort: 'off' }, info).reasoningEffort, 'off')
  assert.equal(experienceModel(source, { efforts: [{ id: 'custom' }] }).reasoningEffort, 'high')
})

test('long single-turn experience keeps its user requirement and excludes private/unfinished records', () => {
  const events: any[] = [
    { seq: 0, time: 0, type: 'turn/start', data: { turn: 1 } },
    {
      seq: 1,
      time: 1,
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Keep the compatibility contract.' }]
      }
    },
    {
      seq: 2,
      time: 2,
      type: 'request/header',
      data: { header: { config: { provider: 'mock', model: 'mock' } } }
    },
    { seq: 3, time: 3, type: 'system/message', data: { content: [{ type: 'text', text: 'PRIVATE SYSTEM' }] } }
  ]
  for (let i = 4; i < 204; i++)
    events.push({
      seq: i,
      time: i,
      type: 'assistant/message',
      data: {
        message: {
          content: [
            { type: 'text', text: 'bounded-result-' + i },
            { type: 'reasoning', text: 'PRIVATE REASONING' }
          ]
        }
      }
    })
  events.push({
    seq: 204,
    time: 204,
    type: 'tool/call',
    data: { callId: 'private', name: 'persona_memory', arguments: '{}' }
  })
  events.push({
    seq: 205,
    time: 205,
    type: 'tool/result',
    data: {
      message: { role: 'tool', toolCallId: 'private', content: [{ type: 'text', text: 'PRIVATE MEMORY' }] }
    }
  })
  events.push({ seq: 206, time: 206, type: 'turn/end', data: {} })
  events.push({
    seq: 207,
    time: 207,
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: 'UNFINISHED TAIL' }] } }
  })
  // A huge old body need not be materialized to select the recent experience window.
  Object.defineProperty(events[4].data, 'message', {
    get() {
      throw Error('Old text outside the selected window was read')
    }
  })
  const window = experienceWindow(events, 'source', 'project'),
    text = JSON.stringify(window)
  assert.equal(window.throughSeq, 206)
  assert.match(text, /Keep the compatibility contract/)
  assert.doesNotMatch(text, /PRIVATE|UNFINISHED/)
  assert.ok(window.trajectory.steps.length <= 81)
  assert.ok(window.trajectory.steps.reduce((sum, step) => sum + step.text.length, 0) <= 16000)
})

test('common credentials are minimized before background analysis', () => {
  const key = 'sk-' + 'x'.repeat(24)
  const result = redactExperienceText(
    `${key}\nAuthorization: Bearer test-value\nhttps://user:pass@example.test/?token=private-value\napi_key="private-key"`
  )
  assert.doesNotMatch(result, /test-value|private-value|private-key|user:pass|x{24}/)
})

test('locked session UI polling reads and closes only the header; unknown identity uses full inspection', async () => {
  let inspected = 0,
    read = 0,
    closed = 0
  const host = {
    sessionController: {
      inspect: async () => {
        inspected++
        return { meta: { id: 's' }, events: [] }
      }
    },
    sessionPersistence: {
      open: async () => ({
        header: { id: 's', cwd: 'project' },
        read: () => {
          read++
          throw Error('must not read full log')
        },
        close: async () => {
          closed++
        }
      })
    }
  }
  const store = { read: () => ({ bindings: { s: { locked: true } } }) } as any
  assert.equal((await inspectMemorySession(host, store, 's')).meta.cwd, 'project')
  assert.deepEqual([inspected, read, closed], [0, 0, 1])
  await inspectMemorySession(host, store, 's', true)
  await inspectMemorySession(host, store, 'unknown')
  assert.equal(inspected, 2)
})
