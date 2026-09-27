import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const { admitPullRequest, selectCurrentReviewRuns, reviewRunKey } = await import(
  pathToFileURL(resolve('scripts/review-worker.mjs')).href
)
const config = { repository: 'fixture/repo', branch: 'master' }
const head = 'a'.repeat(40),
  base = 'b'.repeat(40),
  moved = 'c'.repeat(40)

function fixture(id = 913) {
  const run = {
    id,
    run_attempt: 1,
    event: 'pull_request_target',
    conclusion: 'success',
    head_branch: 'feature-branch',
    head_sha: head
  }
  const request: any = {
    version: 1,
    repository: config.repository,
    headRepository: config.repository,
    kind: 'pull_request',
    head,
    base,
    pullRequest: 42,
    runId: id,
    runAttempt: 1
  }
  const pr: any = {
    number: 42,
    state: 'closed',
    head: { sha: head, repo: { full_name: config.repository } },
    base: { sha: base, repo: { full_name: config.repository } }
  }
  const calls: string[] = []
  const api = async (route: string) => {
    calls.push(route)
    assert.equal(route, 'repos/fixture/repo/pulls/42', 'admission must not call model or check publishers')
    return pr
  }
  return { run, request, pr, calls, api }
}

test('a closed PR with a deleted branch retires before publication and retains earlier result and diagnostics', async () => {
  const f = fixture()
  const prior = {
    complete: false,
    verdict: 'pass',
    head,
    base,
    retryAt: 0,
    workerDigest: 'historical-worker',
    monitorQuality: { runId: 701, conclusion: 'success' },
    error: 'Review base moved'
  }
  const state: Record<string, any> = { [reviewRunKey(f.run)]: prior }
  const branches = new Map([['master', moved]])
  const selected = await selectCurrentReviewRuns(f.api, config, [f.run], state, branches, { now: 100 })
  assert.deepEqual(selected, [f.run])
  assert.equal(await admitPullRequest(f.api, config, f.run, f.request, state, { now: 100 }), false)
  assert.deepEqual(state['913-1'], {
    complete: true,
    obsolete: true,
    obsoleteReason: 'pull-request-closed',
    pullRequest: 42,
    head,
    observedHead: head,
    observedState: 'closed',
    settledAt: 100,
    priorState: prior
  })
  assert.equal(Object.hasOwn(state['913-1'], 'verdict'), false)
  assert.equal(Object.hasOwn(state['913-1'], 'monitorQuality'), false)
  assert.equal(f.request.base, base, 'retirement must not pretend to review a newer base')
  assert.deepEqual(f.calls, ['repos/fixture/repo/pulls/42'])
  const persisted = JSON.parse(JSON.stringify(state))
  assert.deepEqual(
    await selectCurrentReviewRuns(f.api, config, [f.run], persisted, branches, { now: 100000 }),
    []
  )
  assert.deepEqual(persisted['913-1'].priorState, prior)
})

test('rerunning a still-closed PR remains retired without nested prior history or a new verdict', async () => {
  const f = fixture()
  const history = { complete: true, verdict: 'fail', head, base }
  const state: Record<string, any> = { '913-1': history }
  await admitPullRequest(f.api, config, f.run, f.request, state, { now: 10 })
  const retired = state['913-1']
  assert.deepEqual(
    await selectCurrentReviewRuns(f.api, config, [f.run], state, new Map(), { rerun: '913', now: 20 }),
    [f.run]
  )
  assert.equal(await admitPullRequest(f.api, config, f.run, f.request, state, { now: 20 }), false)
  assert.equal(state['913-1'], retired)
  assert.equal(state['913-1'].settledAt, 10)
  assert.equal(state['913-1'].priorState, history)
  assert.equal(Object.hasOwn(state['913-1'], 'verdict'), false)
})

test('a reopened PR new run is admitted independently of retired older runs and uses current base', async () => {
  const old = fixture(),
    next = fixture(914)
  const state: Record<string, any> = {}
  await admitPullRequest(old.api, config, old.run, old.request, state, { now: 10 })
  const retired = JSON.stringify(state['913-1'])
  next.pr.state = 'open'
  next.pr.base.sha = moved
  assert.deepEqual(
    await selectCurrentReviewRuns(next.api, config, [old.run, next.run], state, new Map(), { now: 20 }),
    [next.run]
  )
  assert.equal(await admitPullRequest(next.api, config, next.run, next.request, state, { now: 20 }), true)
  assert.equal(next.request.base, moved)
  assert.equal(JSON.stringify(state['913-1']), retired)
  assert.equal(state['914-1'], undefined, 'admission itself manufactures no result')
})

test('an open PR with an old requested head retires explicitly and preserves prior history', async () => {
  const f = fixture()
  f.pr.state = 'open'
  f.pr.head.sha = moved
  const prior = { complete: false, verdict: 'pass', head }
  const state: Record<string, any> = { '913-1': prior }
  assert.equal(await admitPullRequest(f.api, config, f.run, f.request, state), false)
  assert.equal(state['913-1'].obsoleteReason, 'head-superseded')
  assert.equal(state['913-1'].observedState, 'open')
  assert.equal(state['913-1'].observedHead, moved)
  assert.equal(state['913-1'].priorState, prior)
  assert.equal(Object.hasOwn(state['913-1'], 'verdict'), false)
})

test('unknown PR state and API failures cannot falsely retire a pending request', async (t) => {
  for (const value of [undefined, null, 'unknown', 'OPEN']) {
    await t.test(String(value), async () => {
      const f = fixture()
      f.pr.state = value
      const prior = { complete: false, error: 'prior retryable error' }
      const state = { '913-1': prior }
      const requestBefore = JSON.stringify(f.request)
      await assert.rejects(
        admitPullRequest(f.api, config, f.run, f.request, state),
        /unknown current pull request/
      )
      assert.equal(state['913-1'], prior)
      assert.equal(JSON.stringify(f.request), requestBefore)
      assert.equal(Object.hasOwn(state['913-1'], 'obsolete'), false)
    })
  }
  const f = fixture(),
    prior = { complete: false, error: 'keep retrying' }
  const state = { '913-1': prior }
  await assert.rejects(
    admitPullRequest(
      async () => {
        throw new Error('HTTP 503')
      },
      config,
      f.run,
      f.request,
      state
    ),
    /503/
  )
  assert.equal(state['913-1'], prior)
  assert.equal(Object.hasOwn(state['913-1'], 'obsolete'), false)
})

test('PR response identity and ref validation precede any retirement or request mutation', async (t) => {
  const changes: Record<string, (pr: any) => void> = {
    number: (pr) => {
      pr.number = 43
    },
    repository: (pr) => {
      pr.base.repo.full_name = 'another/repository'
    },
    head: (pr) => {
      pr.head.sha = 'invalid'
    },
    base: (pr) => {
      pr.base.sha = 'invalid'
    }
  }
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async () => {
      const f = fixture(),
        state = {}
      change(f.pr)
      await assert.rejects(admitPullRequest(f.api, config, f.run, f.request, state), /Invalid|unknown/)
      assert.deepEqual(state, {})
      assert.equal(f.request.base, base)
    })
  }
})

test('invalid trusted-request identifiers are rejected before fetching a PR', async (t) => {
  for (const value of [0, -1, 1.5, '42', undefined]) {
    await t.test(String(value), async () => {
      const f = fixture(),
        state = {}
      f.request.pullRequest = value
      await assert.rejects(admitPullRequest(f.api, config, f.run, f.request, state), /admission identity/)
      assert.deepEqual(f.calls, [])
      assert.deepEqual(state, {})
    })
  }
  const f = fixture()
  f.request.runId++
  await assert.rejects(admitPullRequest(f.api, config, f.run, f.request, {}), /admission identity/)
  assert.deepEqual(f.calls, [])
})

test('an open fork PR remains rejected while a closed owned-base PR can retire without a live head repository', async () => {
  const f = fixture(),
    state = {}
  f.pr.state = 'open'
  f.pr.head.repo.full_name = 'fork/repo'
  await assert.rejects(admitPullRequest(f.api, config, f.run, f.request, state), /Fork PRs/)
  assert.deepEqual(state, {})
  f.pr.state = 'closed'
  f.pr.head.repo = null
  assert.equal(await admitPullRequest(f.api, config, f.run, f.request, state), false)
  assert.equal((state as any)['913-1'].obsoleteReason, 'pull-request-closed')
})
