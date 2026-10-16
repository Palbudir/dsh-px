import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readNativeWork, checkpointNativeRefs } from '../packages/dsh-px-taskflow/src/native-work'
import { readCheckpoint } from '../packages/dsh-px-taskflow/src/evidence'

const goal = {
  id: 'goal-1',
  revision: 4,
  objective: '保留原任务',
  phase: 'paused',
  maxGoalRounds: 256,
  roundsStarted: 8,
  activation: 'disarmed'
}
const task = {
  id: 'task-1',
  revision: 3,
  subject: '验证结果',
  status: 'in_progress',
  ownerName: 'reviewer',
  blockedBy: [],
  ready: false,
  writeScopeWarnings: ['共享文件范围重叠']
}
const team = {
  members: [
    { id: 'root', name: 'lead', role: 'lead', phase: 'active' },
    { id: 'child', name: 'reviewer', role: 'teammate', phase: 'active' }
  ],
  tasks: [task]
}

test('ledger references are stamped from native owners; invented tasks and malformed saved refs are rejected', () => {
  const agent = { id: 'root' }
  const host = {
    goals: {
      get: (a: any) => {
        assert.equal(a, agent)
        return goal
      }
    },
    agentTeams: {
      membership: () => ({ id: 'root' }),
      getTask: (_: any, id: string) => (id === 'task-1' ? task : undefined)
    }
  }
  const refs = checkpointNativeRefs(host, agent, ['task-1', 'task-1'])
  assert.deepEqual(refs, {
    goal: { id: goal.id, revision: 4 },
    team: { id: 'root', tasks: [{ id: task.id, revision: 3 }] }
  })
  assert.throws(() => checkpointNativeRefs(host, agent, ['invented']), /不存在/)
  const ledger = {
    goal: 'test',
    summary: 'saved',
    nextStep: 'wait',
    state: 'working',
    evidence: [],
    native: refs
  }
  assert.deepEqual(readCheckpoint(ledger)?.native, refs)
  assert.equal(readCheckpoint({ ...ledger, native: { goal: { id: 'x', revision: -1 } } }), null)
  assert.equal(readCheckpoint({ ...ledger, native: 'untrusted' }), null)
  assert.equal(readCheckpoint({ ...ledger, native: { team: null } }), null)
})

test('native work reads exact live authority and preserves pause, task revision and owner', async () => {
  const agent = { id: 'child', session: { header: { id: 'child' } } }
  const checked = (value: any) => {
    assert.equal(value, agent)
  }
  const host = {
    agents: { get: () => agent },
    goals: {
      get: (a: any) => {
        checked(a)
        return goal
      }
    },
    agentTeams: {
      membership: (a: any) => {
        checked(a)
        return { id: 'root', role: 'teammate' }
      },
      listMembers: (a: any) => {
        checked(a)
        return [{ ...team.members[0], status: 'inactive' }]
      },
      listTasks: (a: any) => {
        checked(a)
        return [task]
      }
    }
  }
  const value = await readNativeWork(host, 'child')
  assert.equal(value.source, 'live')
  assert.equal(value.goal.status, 'available')
  if (value.goal.status === 'available') {
    assert.equal(value.goal.value?.phase, 'paused')
    assert.equal(value.goal.value?.activation, 'disarmed')
    assert.equal(value.goal.value?.revision, 4)
  }
  if (value.team.status !== 'available') assert.fail('team unavailable')
  assert.equal(value.team.value?.id, 'root')
  assert.equal(value.team.value?.tasks[0]?.id, 'task-1')
  assert.equal(value.team.value?.tasks[0]?.revision, 3)
  assert.equal(value.team.value?.tasks[0]?.ownerName, 'reviewer')
  assert.deepEqual(value.team.value?.tasks[0]?.writeScopeWarnings, ['共享文件范围重叠'])
})

function coldHost() {
  let opens = 0,
    closes = 0,
    revision = 'one'
  const records: Record<string, any> = {
    root: {
      header: { id: 'root' },
      inherited: 0,
      values: { goal: { goal, roundsStarted: 8 }, agentTeam: team }
    },
    child: {
      header: { id: 'child', parentSession: 'root', isSeeded: true },
      inherited: 7,
      values: { goal: null, agentTeam: { members: [], tasks: [] } }
    },
    fork: {
      header: { id: 'fork', parentSession: 'root', isSeeded: true },
      inherited: 7,
      values: {
        goal: null,
        agentTeam: { members: [{ id: 'fork', name: 'lead', role: 'lead', phase: 'active' }], tasks: [] }
      }
    }
  }
  const host: any = {
    goals: {},
    agentTeams: {},
    sessions: { get: () => undefined },
    sessionPersistence: {
      stat: async () => ({ revision }),
      open: async (id: string, mode: string) => {
        assert.equal(mode, 'read')
        opens++
        const row = records[id]
        if (!row) throw Object.assign(Error('missing session'), { name: 'SessionPersistenceNotFoundError' })
        return {
          header: row.header,
          inheritedEventCount: row.inherited,
          read: async () => ({ events: row.events ?? [] }),
          close: async () => {
            closes++
          }
        }
      }
    },
    sessionProjections: {
      snapshot: () => {
        throw Error('must not load live agents for a stored read')
      },
      restore: (checkpoint: any, events: any[], baseSeq: number, header: any, inherited: number) => {
        assert.deepEqual(checkpoint, {})
        assert.deepEqual(events, records[header.id].events ?? [])
        assert.equal(baseSeq, 0)
        assert.equal(inherited, records[header.id].inherited)
        return {
          snapshot: { values: records[header.id].values },
          checkpoint: { goal: { val: { failure: records[header.id].failure ?? null } } }
        }
      }
    }
  }
  return {
    host,
    records,
    counts: () => ({ opens, closes }),
    revise: () => {
      revision += 'x'
    }
  }
}

test('cold Team member resolves through the authoritative parent roster; ordinary fork stays independent', async () => {
  const fixture = coldHost()
  const child = await readNativeWork(fixture.host, 'child')
  if (child.team.status !== 'available') assert.fail('team unavailable')
  assert.equal(child.team.value?.id, 'root')
  assert.equal(child.team.value?.tasks[0]?.id, task.id)
  const fork = await readNativeWork(fixture.host, 'fork')
  if (fork.team.status !== 'available') assert.fail('fork unavailable')
  assert.equal(fork.team.value?.id, 'fork')
  assert.equal(fork.team.value?.taskCount, 0)
  assert.deepEqual(fixture.counts(), { opens: 3, closes: 3 })
})

test('stored goal never claims it is armed; unchanged logs are not replayed on every panel poll', async () => {
  const fixture = coldHost()
  fixture.records.root.values.goal.goal = { ...goal, phase: 'active', activation: 'armed' }
  const initial = await readNativeWork(fixture.host, 'root')
  if (initial.goal.status !== 'available') assert.fail('goal unavailable')
  assert.equal(initial.goal.value?.activation, 'unknown')
  await readNativeWork(fixture.host, 'root')
  assert.deepEqual(fixture.counts(), { opens: 1, closes: 1 })
  fixture.revise()
  await readNativeWork(fixture.host, 'root')
  assert.deepEqual(fixture.counts(), { opens: 2, closes: 2 })
  fixture.host.agentTeams = undefined
  const disabled = await readNativeWork(fixture.host, 'root')
  assert.equal(disabled.team.status, 'unavailable')
  assert.deepEqual(fixture.counts(), { opens: 3, closes: 3 })
})

test('ordinary cold forks still work after parent removal; provider-owned children do not become new teams', async () => {
  const f = coldHost()
  delete f.records.root
  const fork = await readNativeWork(f.host, 'fork')
  assert.equal(fork.team.status, 'available')
  f.records.child.inherited = 0
  f.records.child.events = [{ type: 'subagent/descriptor' }]
  f.revise()
  assert.equal((await readNativeWork(f.host, 'child')).team.status, 'error')
})

test('provider-owned child does not gain an implicit Team; inherited descriptor in ordinary fork is ignored', async () => {
  const f = coldHost()
  f.records.fork.inherited = 1
  f.records.fork.events = [{ type: 'subagent/descriptor' }]
  const inherited = await readNativeWork(f.host, 'fork')
  assert.equal(inherited.team.status, 'available')
  f.records.fork.events.push({ type: 'subagent/descriptor' })
  f.revise()
  const owned = await readNativeWork(f.host, 'fork')
  assert.equal(owned.team.status, 'unavailable')
})

test('native replay failures do not silently turn stale goals or teams into current truth', async () => {
  const fixture = coldHost()
  fixture.records.root.failure = 'invalid goal revision'
  fixture.records.root.values.agentTeam = { ...team, failure: 'invalid team record' }
  const value = await readNativeWork(fixture.host, 'root')
  assert.deepEqual(value.goal, { status: 'error', reason: 'invalid goal revision' })
  assert.deepEqual(value.team, { status: 'error', reason: 'invalid team record' })
})

test('failed reads close the readonly handle; unavailable services stay distinguishable from an empty board', async () => {
  const fixture = coldHost()
  let closed = false
  fixture.host.sessionPersistence.open = async () => ({
    header: { id: 'root' },
    read: async () => {
      throw Error('corrupt transcript')
    },
    close: async () => {
      closed = true
      throw Error('close failure')
    }
  })
  const result = await readNativeWork(fixture.host, 'root')
  assert.equal(closed, true)
  assert.deepEqual(result.goal, { status: 'error', reason: 'corrupt transcript' })
  assert.equal((await readNativeWork({}, 'root')).goal.status, 'unavailable')
})

test('task summaries are bounded without dropping the total or disguising truncation', async () => {
  const fixture = coldHost()
  fixture.records.root.values.agentTeam = {
    members: team.members,
    tasks: Array.from({ length: 75 }, (_, i) => ({ ...task, id: `task-${i}` }))
  }
  const value = await readNativeWork(fixture.host, 'root')
  if (value.team.status !== 'available') assert.fail('team unavailable')
  assert.equal(value.team.value?.tasks.length, 50)
  assert.equal(value.team.value?.taskCount, 75)
  assert.equal(value.team.value?.truncated, true)
})
