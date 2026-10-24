import { test } from 'node:test'
import assert from 'node:assert/strict'
import { waitForNativeWork } from '../packages/dsh-px-taskflow/src/work-wait'

function fixture() {
  const inbox = new Set<(value: any) => void>(),
    jobs = new Set<(value: any) => void>()
  const agent = { id: 'owner', inbox: { nextStep: [] as Array<{ id: string }> } }
  const state = { work: [{ id: 'job-1', owner: agent.id, status: 'running' }], teamWaiters: 0 }
  const host: any = {
    on: (_: string, handler: (value: any) => void) => {
      inbox.add(handler)
      return () => inbox.delete(handler)
    },
    jobs: {
      list: (owner: string) => {
        assert.equal(owner, agent.id)
        return state.work
      },
      events: {
        subscribe: (filter: any, handler: (value: any) => void) => {
          assert.deepEqual(filter, { owner: agent.id })
          jobs.add(handler)
          return () => jobs.delete(handler)
        }
      },
      read: () => {
        throw Error('must not consume output')
      },
      kill: () => {
        throw Error('must not cancel work')
      }
    }
  }
  const message = (target = agent, id = 'human') => {
    target.inbox.nextStep.push({ id })
    for (const handler of inbox) handler({ agent: target, message: { id } })
  }
  return { host, agent, state, inbox, jobs, message }
}

test('new steering yields a native-work observation without consuming output or cancelling its job', async () => {
  const f = fixture(),
    controller = new AbortController()
  const waiting = waitForNativeWork(f.host, f.agent, controller.signal)
  f.message({ id: 'other', inbox: { nextStep: [] } })
  assert.equal(f.inbox.size, 1)
  f.message()
  const result = await waiting
  assert.equal(result.reason, 'message')
  assert.deepEqual(result.jobIds, ['job-1'])
  assert.equal(f.state.work[0].status, 'running')
  assert.equal(controller.signal.aborted, false)
  assert.equal(f.agent.inbox.nextStep.length, 1, 'native loop retains ownership of message admission')
  assert.equal(f.inbox.size + f.jobs.size, 0)
})

test('already pending steering is not lost and no-active-work returns without waiting', async () => {
  const f = fixture()
  f.message()
  assert.equal((await waitForNativeWork(f.host, f.agent, new AbortController().signal)).reason, 'message')
  f.agent.inbox.nextStep.length = 0
  f.state.work = []
  assert.equal((await waitForNativeWork(f.host, f.agent, new AbortController().signal)).reason, 'no-progress')
  assert.equal(f.inbox.size + f.jobs.size, 0)
})

test('job events only wake observed work, and caller cancellation releases subscriptions', async () => {
  const f = fixture()
  const waiting = waitForNativeWork(f.host, f.agent, new AbortController().signal)
  for (const handler of f.jobs) handler({ type: 'settled', job: { id: 'unrelated' } })
  for (const handler of f.jobs) handler({ type: 'settled', job: { id: 'job-1' } })
  assert.equal((await waiting).reason, 'job-change')
  const controller = new AbortController(),
    reason = new Error('user cancelled')
  const cancelled = waitForNativeWork(f.host, f.agent, controller.signal)
  controller.abort(reason)
  await assert.rejects(cancelled, reason)
  assert.equal(f.state.work[0].status, 'running')
  assert.equal(f.inbox.size + f.jobs.size, 0)
})

test('message wake drains the native Team waiter and never interrupts a teammate', async () => {
  const f = fixture()
  f.host.agentTeams = {
    listMembers: () => [{ id: 'peer', status: 'running' }],
    waitForChange: (_agent: unknown, _timeout: number, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        f.state.teamWaiters++
        signal.addEventListener(
          'abort',
          () => {
            f.state.teamWaiters--
            reject(signal.reason)
          },
          { once: true }
        )
      }),
    interrupt: () => {
      throw Error('must not interrupt peer')
    }
  }
  const waiting = waitForNativeWork(f.host, f.agent, new AbortController().signal)
  f.message()
  assert.equal((await waiting).reason, 'message')
  assert.equal(f.state.teamWaiters, 0)
  assert.equal(f.inbox.size + f.jobs.size, 0)
})

test('unknown native state fails rather than reporting idle, and timeouts are bounded', async () => {
  const f = fixture()
  f.host.jobs.list = () => {
    throw Error('native unavailable')
  }
  await assert.rejects(waitForNativeWork(f.host, f.agent, new AbortController().signal), /native unavailable/)
  assert.equal(f.inbox.size + f.jobs.size, 0)
  await assert.rejects(waitForNativeWork(f.host, f.agent, new AbortController().signal, 60_001), /等待时长/)
})
