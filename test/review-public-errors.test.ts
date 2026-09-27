import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const load = (name: string): Promise<any> => import(pathToFileURL(resolve('scripts', name)).href)
const core = await load('review-core.mjs')
const { PUBLIC_REVIEW_FAILURE, publishReview, publishQuality, settleQuality } =
  await load('review-verify.mjs')
const { releaseGate } = await load('release-gate.mjs')

const head = 'a'.repeat(40),
  base = 'b'.repeat(40),
  tree = 'c'.repeat(40),
  appId = 777,
  version = '0.1.0-beta.re.0.11'
const privatePath = 'C:\\Users\\PRIVATE_FIXTURE_USER\\AppData\\Local\\worker\\jobs\\private.json'
const privateMarker = 'SYNTHETIC_PRIVATE_DETAIL_DO_NOT_PUBLISH'
const privateError = `ENOENT ${privatePath}; ${privateMarker}`
const keys = generateKeyPairSync('ed25519')
const workflowPath = '.github/workflows/trusted-quality.yml'
const controllerSource = 'trusted fixture controller\n'
const policy = {
  repository: 'fixture/repo',
  branch: 'master',
  publisher: 'fixture',
  workerDigest: 'd'.repeat(64),
  reviewAppId: appId,
  keys: { test: keys.publicKey.export({ type: 'spki', format: 'pem' }) },
  maxAgeHours: 24,
  requiredChecks: [core.CHECK_NAME, core.QUALITY_CHECK_NAME],
  trustedQuality: {
    workflowId: 201,
    path: workflowPath,
    files: { [workflowPath]: core.sourceDigest(controllerSource) }
  }
}

function proof(extra: Record<string, unknown> = {}) {
  return core.attest(
    {
      version: 1,
      repository: policy.repository,
      publisher: policy.publisher,
      workerDigest: policy.workerDigest,
      head,
      base,
      tree,
      mergeBase: base,
      filesDigest: 'e'.repeat(64),
      contextDigest: 'f'.repeat(64),
      completedAt: Date.now(),
      requestRunId: 123,
      requestAttempt: 1,
      reviewer: { cliVersion: 'fixture-cli', configurationDigest: 'e'.repeat(64) },
      verdict: 'pass',
      findings: [],
      blockers: [],
      batches: [{ id: 'batch-one', digest: 'f'.repeat(64) }],
      ...extra
    },
    'test',
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  )
}

function fixture() {
  const created: any[] = []
  const state: any = {
    fault: undefined,
    source: {
      path: '.github/workflows/review-request.yml',
      run_attempt: 1,
      conclusion: 'success',
      repository: { full_name: policy.repository }
    },
    commit: { sha: head, commit: { tree: { sha: tree } }, parents: [{ sha: base }] },
    branch: {
      protected: true,
      commit: { sha: head },
      protection: {
        required_status_checks: {
          checks: policy.requiredChecks.map((context) => ({ context, app_id: appId }))
        }
      }
    },
    quality: {
      id: 91,
      run_attempt: 1,
      workflow_id: 201,
      path: workflowPath,
      event: 'workflow_dispatch',
      head_branch: 'master',
      head_sha: base,
      display_title: 'dsh-px-quality:' + head,
      repository: { full_name: policy.repository },
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/fixture/repo/actions/runs/91'
    }
  }
  const api = async (route: string, options: any = {}): Promise<any> => {
    if (state.fault) state.fault(route, options)
    if (options.method === 'POST' && route.endsWith('/check-runs')) {
      const record = { ...options.body, id: created.length + 1, app: { id: appId } }
      created.push(record)
      return record
    }
    if (route.includes('/check-runs')) return { check_runs: created }
    if (route.endsWith('/actions/runs/123')) return state.source
    if (route.endsWith('/actions/runs/91')) return state.quality
    if (route.includes('/actions/workflows/201/runs'))
      return { workflow_runs: state.quality ? [state.quality] : [] }
    if (route.endsWith('/branches/master')) return state.branch
    if (route.endsWith('/commits/' + head)) return state.commit
    if (route.includes('/compare/')) return { status: 'ahead' }
    if (route.includes('/contents/package.json'))
      return { content: Buffer.from(JSON.stringify({ name: 'dsh-px', version })).toString('base64') }
    if (route.includes('/contents/' + workflowPath))
      return { content: Buffer.from(controllerSource).toString('base64') }
    if (route.includes('/releases')) return [{ tag_name: 'v0.1.0-beta.re.0.10.1', draft: false }]
    assert.fail('Unexpected fake API route: ' + route)
  }
  return { state, api, created }
}

function assertPublicClean(records: any[]) {
  for (const record of records) {
    const texts = [JSON.stringify(record)]
    for (const marker of [core.REPORT_MARKER, core.QUALITY_MARKER]) {
      const encoded = new RegExp(marker + '([A-Za-z0-9+/=]+)').exec(record.output?.summary ?? '')?.[1]
      if (encoded) texts.push(Buffer.from(encoded, 'base64').toString('utf8'))
    }
    for (const text of texts) {
      assert.ok(!text.includes(privateMarker), 'private marker must not reach a public check')
      assert.ok(!text.includes('PRIVATE_FIXTURE_USER'), 'local path must not reach a public check')
    }
  }
}

test('unverified, stale and failed attestations publish failure without their raw proof', async (t) => {
  const invalid = proof({ blockers: [privateError] })
  invalid.payload.verdict = privateMarker
  const cases = {
    tampered: invalid,
    stale: proof({ completedAt: Date.now() - 25 * 3600000, privateDetail: privateError }),
    failed: proof({ verdict: 'fail', blockers: [privateError] }),
    missingIdentity: proof({ tree: undefined, blockers: [privateError] })
  }
  for (const [name, report] of Object.entries(cases)) {
    await t.test(name, async () => {
      const api = fixture()
      const first = await publishReview(report, policy, api.api)
      assert.equal(first.conclusion, 'failure')
      assert.equal(first.retryable, false)
      assert.ok(first.problem)
      assert.equal(api.created[0].output.summary, PUBLIC_REVIEW_FAILURE)
      assert.ok(!api.created[0].output.summary.includes(core.REPORT_MARKER))
      assert.equal((await publishReview(report, policy, api.api)).id, first.id)
      assert.equal(api.created.length, 1)
      assertPublicClean(api.created)
    })
  }
})

test('a valid proof with a local API error stays retryable, deduplicates and publishes proof after recovery', async () => {
  const api = fixture()
  const report = proof()
  api.state.fault = (route: string) => {
    if (route.endsWith('/actions/runs/123')) throw new Error(privateError)
  }
  const failed = await publishReview(report, policy, api.api)
  assert.equal(failed.conclusion, 'failure')
  assert.equal(failed.retryable, true)
  assert.ok(failed.problem.includes(privateMarker))
  assert.ok(failed.problem.includes(privatePath))
  assert.equal(api.created[0].output.summary, PUBLIC_REVIEW_FAILURE)
  assert.equal((await publishReview(report, policy, api.api)).id, failed.id)
  assert.equal(api.created.length, 1)
  api.state.fault = undefined
  const recovered = await publishReview(report, policy, api.api)
  assert.equal(recovered.conclusion, 'success')
  assert.equal(recovered.retryable, false)
  assert.equal(recovered.problem, '')
  assert.equal(api.created.length, 2)
  assert.equal(api.created[0].external_id, api.created[1].external_id)
  assert.equal((await publishReview(report, policy, api.api)).id, recovered.id)
  assert.equal(api.created.length, 2)
  assertPublicClean(api.created)
})

test('a legacy unsafe failure is superseded once instead of being reused by deduplication', async () => {
  const api = fixture()
  const report = proof({ verdict: 'fail', blockers: [privateError] })
  await publishReview(report, policy, api.api)
  api.created[0].output.summary = privateError + '\n' + core.REPORT_MARKER + core.encodeReport(report)
  const replaced = await publishReview(report, policy, api.api)
  assert.equal(replaced.conclusion, 'failure')
  assert.equal(api.created.length, 2)
  assert.equal(api.created[0].external_id, api.created[1].external_id)
  assert.equal(api.created[1].output.summary, PUBLIC_REVIEW_FAILURE)
  assert.equal((await publishReview(report, policy, api.api)).id, replaced.id)
  assert.equal(api.created.length, 2)
  assertPublicClean(api.created.slice(1))
})

test('signature validity alone never publishes proof when request, tree or branch checks fail', async (t) => {
  const changes: Record<string, (state: any) => void> = {
    request: (state) => {
      state.source.path = 'untrusted-workflow'
    },
    tree: (state) => {
      state.commit.commit.tree.sha = 'f'.repeat(40)
    },
    branch: (state) => {
      state.branch.protected = false
    },
    base: (state) => {
      state.commit.parents[0].sha = 'f'.repeat(40)
    }
  }
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async () => {
      const api = fixture()
      change(api.state)
      const result = await publishReview(proof({ privateDetail: privateError }), policy, api.api)
      assert.equal(result.conclusion, 'failure')
      assert.equal(result.retryable, true)
      assert.equal(api.created[0].output.summary, PUBLIC_REVIEW_FAILURE)
      assertPublicClean(api.created)
    })
  }
})

test('verified success preserves signed source findings and quality evidence required by releaseGate', async () => {
  const api = fixture()
  const report = proof({
    findings: [
      {
        priority: 3,
        file: 'src/example.ts',
        line: 1,
        title: 'Naming polish',
        body: 'Optional naming clarity.'
      }
    ]
  })
  assert.equal((await publishReview(report, policy, api.api)).conclusion, 'success')
  await publishQuality(policy, api.api, head, { runId: 91, untrustedDetail: privateError })
  const encoded = new RegExp(core.REPORT_MARKER + '([A-Za-z0-9+/=]+)').exec(api.created[0].output.summary)![1]
  assert.deepEqual(core.decodeReport(encoded), report)
  const gate = await releaseGate({ version, tag: 'refs/tags/v' + version, head, policy, api: api.api })
  assert.equal(gate.head, head)
  assert.equal(gate.quality.runId, 91)
  assertPublicClean(api.created)
})

test('direct quality exceptions are generic publicly but retain distinct failure identities', async () => {
  const api = fixture()
  const failed = await publishQuality(policy, api.api, head, null, privateError)
  assert.equal(failed.completed, true)
  assert.equal(failed.passed, false)
  assert.equal(api.created[0].conclusion, 'failure')
  assert.equal(api.created[0].output.summary, PUBLIC_REVIEW_FAILURE)
  assert.equal((await publishQuality(policy, api.api, head, null, privateError)).id, failed.id)
  assert.equal(api.created.length, 1)
  await publishQuality(policy, api.api, head, null, privateError + ' changed')
  assert.equal(api.created.length, 2)
  assert.notEqual(api.created[0].external_id, api.created[1].external_id)
  await publishQuality(policy, api.api, head, null, { runId: 91, runAttempt: 1, conclusion: privateError })
  assert.equal(api.created.at(-1).output.summary, PUBLIC_REVIEW_FAILURE)
  assertPublicClean(api.created)
})

test('quality discovery exceptions keep local details and recover without false success or duplicate failures', async () => {
  const api = fixture()
  api.state.fault = (route: string) => {
    if (route.includes('/actions/workflows/')) throw new Error(privateError)
  }
  const dispatch = async () => assert.fail('an existing run must not be dispatched again')
  const first = await settleQuality(policy, api.api, head, dispatch)
  assert.equal(first.finished, false)
  assert.ok(first.error.includes(privateMarker))
  assert.ok(first.error.includes(privatePath))
  assert.equal(api.created[0].output.summary, PUBLIC_REVIEW_FAILURE)
  await settleQuality(policy, api.api, head, dispatch)
  assert.equal(api.created.length, 1)
  api.state.fault = undefined
  const recovered = await settleQuality(policy, api.api, head, dispatch)
  assert.equal(recovered.finished, true)
  assert.equal(recovered.monitorQuality.conclusion, 'success')
  assert.equal(api.created.at(-1).conclusion, 'success')
  await settleQuality(policy, api.api, head, dispatch)
  assert.equal(api.created.length, 2)
  assertPublicClean(api.created)
})

test('dispatch and publication failures remain unfinished without exposing exceptions', async () => {
  const api = fixture()
  api.state.quality = null
  const dispatch = async () => {
    throw new Error(privateError)
  }
  const first = await settleQuality(policy, api.api, head, dispatch)
  assert.equal(first.finished, false)
  assert.ok(first.error.includes(privateMarker))
  assert.equal(api.created[0].conclusion, 'failure')
  assert.equal(api.created[0].output.summary, PUBLIC_REVIEW_FAILURE)
  api.state.fault = (_route: string, options: any) => {
    if (options.method === 'POST') throw new Error(privateError)
  }
  const unpublished = await settleQuality(policy, api.api, head, async () => undefined)
  assert.equal(unpublished.finished, false)
  assert.ok(unpublished.error.includes(privateMarker))
  assert.equal(api.created.length, 1)
  assertPublicClean(api.created)
})

test('normal failed, pending and successful trusted run transitions stay visible and deduplicate', async () => {
  const api = fixture()
  api.state.quality.conclusion = 'failure'
  const dispatch = async () => assert.fail('an existing run must not be dispatched again')
  const failed = await settleQuality(policy, api.api, head, dispatch)
  assert.equal(failed.finished, true)
  assert.equal(failed.monitorQuality.conclusion, 'failure')
  assert.equal(api.created[0].conclusion, 'failure')
  assert.equal(api.created[0].output.summary, 'Trusted quality run 91, attempt 1: failure')
  await settleQuality(policy, api.api, head, dispatch)
  assert.equal(api.created.length, 1)
  api.state.quality.run_attempt = 2
  api.state.quality.status = 'in_progress'
  api.state.quality.conclusion = null
  assert.equal((await settleQuality(policy, api.api, head, dispatch)).finished, false)
  assert.equal(api.created.at(-1).status, 'queued')
  api.state.quality.status = 'completed'
  api.state.quality.conclusion = 'success'
  const completed = await settleQuality(policy, api.api, head, dispatch)
  assert.equal(completed.finished, true)
  assert.equal(completed.monitorQuality.runAttempt, 2)
  assert.equal(api.created.at(-1).conclusion, 'success')
  await settleQuality(policy, api.api, head, dispatch)
  assert.equal(api.created.length, 3)
  assertPublicClean(api.created)
})
