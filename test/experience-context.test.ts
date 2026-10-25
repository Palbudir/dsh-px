import test from 'node:test'
import assert from 'node:assert/strict'
import { experienceWindow, redactExperienceText } from '../packages/dsh-px-memory/src/experience-context'
import { inspectMemorySession } from '../packages/dsh-px-memory/src/session-context'
import { experienceRunView } from '../packages/dsh-px-memory/src/experience-run-state'
import {
  experienceModel,
  experienceSessionModel,
  createExperienceParent
} from '../packages/dsh-px-memory/src/experience-context'

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

test('draft and simulation routing use the exact native projection, never inspect or resume the full source', async () => {
  let reads = 0
  const controller = {
    inspect: () => {
      throw Error('full log must not be requested')
    },
    resolveAgent: () => {
      throw Error('source must not wake')
    },
    projections: async ({ sessionId }: any, signal: AbortSignal) => {
      assert.equal(sessionId, 'source')
      assert.equal(signal.aborted, false)
      reads++
      return {
        kind: 'sequenced',
        values: {
          modelSelection: {
            lastUsed: { provider: 'p', model: 'used', reasoningEffort: 'low' },
            next: { provider: 'p', model: 'pending' }
          }
        }
      }
    }
  }
  assert.deepEqual(await experienceSessionModel({ sessionController: controller }, 'source'), {
    provider: 'p',
    model: 'used',
    reasoningEffort: 'low'
  })
  assert.equal(reads, 1)
  controller.projections = async () => ({ kind: 'migration-required', values: {} }) as any
  await assert.rejects(experienceSessionModel({ sessionController: controller }, 'source'), /没有可用/)
})

test('a previous-host running record is visibly unconfirmed without rewriting its native status or score', () => {
  const old = { status: 'running', startedAt: new Date(1000).toISOString(), passRate: 0.5 }
  assert.deepEqual(experienceRunView(old, 2000), { ...old, awaitingRecovery: true })
  assert.equal(experienceRunView(old, 0).awaitingRecovery, false)
  assert.equal(experienceRunView({ ...old, status: 'interrupted' }, 2000).awaitingRecovery, false)
  assert.equal(experienceRunView({ ...old, status: 'completed' }, 2000).awaitingRecovery, false)
  assert.equal(old.status, 'running')
})

test('identity cleanup failure cannot rewrite native completion or mask the original creation failure', async () => {
  const original = new Error('native creation failed'),
    warnings: unknown[] = []
  let fail = false,
    disposed = 0
  const host = {
    logger: { warn: (...args: unknown[]) => warnings.push(args) },
    get: (name: string) =>
      name === 'agents'
        ? {
            create: async () => {
              if (fail) throw original
              return {
                agent: { id: 'task' },
                dispose: async () => {
                  disposed++
                }
              }
            }
          }
        : undefined
  }
  const store = {
    bind: () => {},
    releaseExperienceBindings: () => {
      throw Error('storage unavailable during cleanup')
    }
  } as any
  const caller = { sessionId: 'source', project: 'project', actor: 'human' as const },
    model = { provider: 'p', model: 'm' }
  const owned = await createExperienceParent(host, store, caller, model, new AbortController().signal)
  await owned.dispose()
  assert.equal(disposed, 1)
  fail = true
  await assert.rejects(
    createExperienceParent(host, store, caller, model, new AbortController().signal),
    (error) => error === original
  )
  assert.equal(warnings.length, 2)
})
