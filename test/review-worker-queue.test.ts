import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { selectReviewRuns, selectCurrentReviewRuns, readBranchHeads, pushReviewBase } = await import(
  pathToFileURL(resolve('scripts/review-worker.mjs')).href
)
const oldHead = 'a'.repeat(40),
  currentHead = 'b'.repeat(40),
  master = 'c'.repeat(40),
  parent = 'd'.repeat(40)
const push = (id: number, branch: string, head: string) => ({
  id,
  run_attempt: 1,
  event: 'push',
  conclusion: 'success',
  head_branch: branch,
  head_sha: head
})

test('deleted merged pushes settle obsolete before the one-job budget without issuing a verdict or check', () => {
  const old = push(1, 'merged-feature', oldHead),
    current = push(2, 'current-feature', currentHead)
  const state: Record<string, any> = {}
  // The deleted branch's old head can still be master: global SHA reachability is not branch identity.
  const branches = new Map([
    ['master', oldHead],
    ['current-feature', currentHead]
  ])
  const selected = selectReviewRuns([old, current], state, branches, { now: 1000 }).slice(0, 1)
  const reviews: number[] = [],
    checks: number[] = []
  for (const run of selected) {
    reviews.push(run.id)
    checks.push(run.id)
  }
  assert.deepEqual(reviews, [2])
  assert.deepEqual(checks, [2])
  assert.deepEqual(state['1-1'], {
    complete: true,
    obsolete: true,
    obsoleteReason: 'branch-deleted',
    branch: 'merged-feature',
    head: oldHead,
    observedHead: null,
    settledAt: 1000,
    priorState: undefined
  })
  assert.equal(Object.hasOwn(state['1-1'], 'verdict'), false)
  const persisted = JSON.parse(JSON.stringify(state))
  assert.deepEqual(selectReviewRuns([old], persisted, branches, { now: 999999 }), [])
  assert.equal(persisted['1-1'].settledAt, 1000, 'future polls neither retry nor rewrite obsolete retirement')
})

test('superseded pushes are retired even while delayed or monitored and even if another branch has the old SHA', () => {
  const old = push(1, 'feature', oldHead),
    current = push(2, 'feature', currentHead)
  const previous = {
    complete: false,
    head: oldHead,
    retryAt: 999999,
    verdict: 'pass',
    monitorQuality: { runId: 10 },
    error: 'temporary failure'
  }
  const state: Record<string, any> = { '1-1': previous }
  const selected = selectReviewRuns(
    [old, current],
    state,
    new Map([
      ['feature', currentHead],
      ['another-branch', oldHead]
    ]),
    { now: 1000 }
  )
  assert.deepEqual(
    selected.map((run: any) => run.id),
    [2]
  )
  assert.equal(state['1-1'].obsoleteReason, 'head-superseded')
  assert.equal(state['1-1'].observedHead, currentHead)
  assert.deepEqual(state['1-1'].priorState, previous, 'historical result/monitor/error evidence is retained')
  assert.equal(Object.hasOwn(state['1-1'], 'monitorQuality'), false)
  assert.equal(Object.hasOwn(state['1-1'], 'verdict'), false, 'retirement creates no new review conclusion')
  assert.equal(state['1-1'].complete, true)
})

test('already settled history without active monitoring is preserved byte-for-byte', () => {
  for (const verdict of ['pass', 'fail']) {
    const history = {
      complete: true,
      verdict,
      head: oldHead,
      base: parent,
      workerDigest: 'historical-worker',
      retryAt: 1
    }
    const state = { '1-1': history },
      before = JSON.stringify(state)
    assert.deepEqual(
      selectReviewRuns([push(1, 'deleted-feature', oldHead)], state, new Map(), { now: 1000 }),
      []
    )
    assert.equal(state['1-1'], history)
    assert.equal(JSON.stringify(state), before)
  }
})

test('retained merged branches are obsolete before the budget, while current master and unmerged PR/push stay eligible', async () => {
  const merged = push(1, 'kept-merged-feature', oldHead),
    active = push(2, 'active-feature', currentHead)
  const main = push(3, 'master', master),
    pr = { ...push(4, 'kept-merged-feature', oldHead), event: 'pull_request_target' }
  const state: Record<string, any> = {},
    calls: string[] = []
  const branches = new Map([
    ['master', master],
    ['kept-merged-feature', oldHead],
    ['active-feature', currentHead]
  ])
  const selected = await selectCurrentReviewRuns(
    async (route: string) => {
      calls.push(route)
      const head = route.includes(oldHead) ? oldHead : currentHead
      return {
        base_commit: { sha: head },
        merge_base_commit: { sha: head === oldHead ? oldHead : parent },
        status: head === oldHead ? 'ahead' : 'diverged',
        ahead_by: 2,
        behind_by: head === oldHead ? 0 : 1
      }
    },
    { repository: 'owner/repo', branch: 'master' },
    [merged, active, main, pr],
    state,
    branches,
    { now: 1000 }
  )
  assert.deepEqual(
    selected.map((run: any) => run.id),
    [2, 3, 4]
  )
  assert.equal(selected.slice(0, 1)[0].id, 2)
  assert.deepEqual(calls, [
    `repos/owner/repo/compare/${oldHead}...${master}`,
    `repos/owner/repo/compare/${currentHead}...${master}`
  ])
  assert.equal(state['1-1'].obsoleteReason, 'already-integrated')
  assert.equal(state['1-1'].integratedInto, master)
  assert.equal(Object.hasOwn(state['1-1'], 'verdict'), false)
  assert.equal(state['4-1'], undefined, 'PR is still handled through its real PR identity')
})

test('equal feature/master SHA is retired, including explicit rerun; settled history is not compared again', async () => {
  const run = push(1, 'feature', oldHead),
    branches = new Map([
      ['master', oldHead],
      ['feature', oldHead]
    ])
  let calls = 0
  const api = async () => {
    calls++
    return {
      base_commit: { sha: oldHead },
      merge_base_commit: { sha: oldHead },
      status: 'identical',
      ahead_by: 0,
      behind_by: 0
    }
  }
  const historical: Record<string, unknown> = { complete: true, verdict: 'pass', head: oldHead },
    state: Record<string, any> = { '1-1': historical }
  assert.deepEqual(
    await selectCurrentReviewRuns(
      api,
      { repository: 'owner/repo', branch: 'master' },
      [run],
      state,
      branches
    ),
    []
  )
  assert.equal(calls, 0)
  assert.equal(state['1-1'], historical)
  assert.deepEqual(
    await selectCurrentReviewRuns(
      api,
      { repository: 'owner/repo', branch: 'master' },
      [run],
      state,
      branches,
      { rerun: '1' }
    ),
    []
  )
  assert.equal(calls, 1)
  assert.equal(state['1-1'].obsoleteReason, 'already-integrated')
  assert.deepEqual(state['1-1'].priorState, historical)
})

test('ancestry API failures and contradictory identities keep pending requests pending without a fake retirement', async () => {
  const run = push(1, 'feature', oldHead),
    branches = new Map([
      ['master', master],
      ['feature', oldHead]
    ])
  const cases = [
    async () => {
      throw new Error('HTTP 503')
    },
    async () => ({
      base_commit: { sha: currentHead },
      merge_base_commit: { sha: oldHead },
      status: 'ahead',
      ahead_by: 1,
      behind_by: 0
    }),
    async () => ({
      base_commit: { sha: oldHead },
      merge_base_commit: { sha: parent },
      status: 'ahead',
      ahead_by: 1,
      behind_by: 0
    }),
    async () => ({
      base_commit: { sha: oldHead },
      merge_base_commit: { sha: oldHead },
      status: 'identical',
      ahead_by: 0,
      behind_by: 0
    })
  ]
  for (const api of cases) {
    const previous = { complete: false, retryAt: 0 },
      state = { '1-1': previous }
    await assert.rejects(
      selectCurrentReviewRuns(api, { repository: 'owner/repo', branch: 'master' }, [run], state, branches)
    )
    assert.equal(state['1-1'], previous)
    assert.equal(state['1-1'].complete, false)
  }
})

test('current default-branch push keeps its recorded parent base while a current feature uses audited master', () => {
  const mainRun = push(1, 'master', master),
    featureRun = push(2, 'feature', currentHead)
  const branches = new Map([
    ['master', master],
    ['feature', currentHead]
  ])
  const mainRequest = { head: master, base: parent },
    featureRequest = { head: currentHead, base: oldHead }
  assert.deepEqual(
    selectReviewRuns([mainRun, featureRun], {}, branches).map((run: any) => run.id),
    [1, 2]
  )
  assert.equal(pushReviewBase(mainRequest, mainRun, branches, 'master'), parent)
  assert.equal(mainRequest.base, parent)
  assert.equal(pushReviewBase(featureRequest, featureRun, branches, 'master'), master)
  assert.equal(featureRequest.base, oldHead, 'base helper does not rewrite the captured request itself')
  assert.throws(
    () => pushReviewBase({ head: oldHead, base: parent }, mainRun, branches, 'master'),
    /SHA mismatch/
  )
  assert.throws(
    () => pushReviewBase(featureRequest, featureRun, new Map([['feature', oldHead]]), 'master'),
    /no longer current/
  )
  assert.throws(
    () => pushReviewBase(featureRequest, featureRun, new Map([['feature', currentHead]]), 'master'),
    /Invalid commit SHA/
  )
})

test('explicit rerun cannot revive an obsolete push; an actually restored matching branch can be reviewed explicitly', () => {
  const run = push(7, 'feature', oldHead),
    state: Record<string, any> = {}
  assert.deepEqual(
    selectReviewRuns([run], state, new Map([['feature', currentHead]]), { rerun: '7', now: 10 }),
    []
  )
  assert.equal(state['7-1'].obsolete, true)
  assert.deepEqual(selectReviewRuns([run], state, new Map(), { rerun: '7', now: 20 }), [])
  assert.equal(state['7-1'].obsoleteReason, 'branch-deleted')
  assert.deepEqual(
    selectReviewRuns([run], state, new Map([['feature', oldHead]]), { rerun: '7' }).map((row: any) => row.id),
    [7]
  )
})

test('PR requests are not mistaken for branch pushes and unchanged retry/monitor priorities stay intact', () => {
  const pr = { ...push(1, 'absent-pr-branch', oldHead), event: 'pull_request_target' }
  const pending = push(3, 'feature', currentHead),
    monitored = push(2, 'master', master)
  const state: Record<string, any> = { '2-1': { complete: true, monitorQuality: { runId: 20 } } }
  assert.deepEqual(
    selectReviewRuns(
      [monitored, pending, pr],
      state,
      new Map([
        ['feature', currentHead],
        ['master', master]
      ]),
      { now: 100 }
    ).map((row: any) => row.id),
    [1, 3, 2]
  )
  assert.equal(state['1-1'], undefined)
  assert.deepEqual(
    selectReviewRuns([pr], { '1-1': { complete: false, retryAt: 200 } }, new Map(), { now: 100 }),
    []
  )
  assert.throws(
    () => pushReviewBase({ head: oldHead, base: parent }, pr, new Map(), 'master'),
    /SHA mismatch/
  )
})

test('only a complete validated branch inventory can retire requests; failed or malformed listing fails closed', async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({
    name: `branch-${index}`,
    commit: { sha: oldHead }
  }))
  const calls: string[] = []
  const branches = await readBranchHeads(async (route: string) => {
    calls.push(route)
    return route.endsWith('page=1') ? first : [{ name: 'feature/with-slash', commit: { sha: currentHead } }]
  }, 'owner/repo')
  assert.equal(branches.size, 101)
  assert.equal(branches.get('feature/with-slash'), currentHead)
  assert.equal(calls.length, 2)
  await assert.rejects(
    readBranchHeads(async (route: string) => {
      if (route.endsWith('page=1')) return first
      throw Error('HTTP 503 temporary failure')
    }, 'owner/repo'),
    /503/
  )
  await assert.rejects(
    readBranchHeads(async () => [{ name: 'feature', commit: { sha: 'invalid' } }], 'owner/repo'),
    /Invalid commit SHA/
  )
  await assert.rejects(
    readBranchHeads(async () => null, 'owner/repo'),
    /Invalid branch inventory/
  )
  assert.throws(
    () => selectReviewRuns([{ ...push(1, 'feature', oldHead), head_branch: null }], {}, new Map()),
    /Invalid push branch/
  )
  assert.throws(() => selectReviewRuns([push(1, 'feature', 'bad-sha')], {}, new Map()), /Invalid commit SHA/)
})
