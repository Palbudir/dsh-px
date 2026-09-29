import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'

const load = (name: string): Promise<any> => import(pathToFileURL(resolve('scripts', name)).href)
const { publishReviewRequest } = await load('review-worker.mjs')
const { PUBLIC_REVIEW_FAILURE } = await load('review-verify.mjs')
const core = await load('review-core.mjs')
const head = 'a'.repeat(40),
  base = 'b'.repeat(40),
  tree = 'c'.repeat(40),
  appId = 777
const privatePath = 'C:\\Users\\PRIVATE_DIAGNOSTIC_FIXTURE\\AppData\\Local\\worker\\detail.json'
const privateMarker = 'SYNTHETIC_DIAGNOSTIC_MUST_STAY_LOCAL'
const privateError = `EACCES ${privatePath}; ${privateMarker}`
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
  trustedQuality: {
    workflowId: 201,
    path: workflowPath,
    files: { [workflowPath]: core.sourceDigest(controllerSource) }
  }
}

function fixture(t: TestContext) {
  const parent = realpathSync(tmpdir()),
    directory = realpathSync(mkdtempSync(join(parent, 'dshpx-publication-diagnostics-')))
  t.after(() => {
    assert.ok(directory.startsWith(parent + sep))
    rmSync(directory, { recursive: true, force: true })
  })
  const report = core.attest(
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
      reviewer: {
        provider: 'deepseek',
        model: 'deepseek-flash',
        baseUrl: 'https://api.deepseek.com',
        configurationDigest: core.sha256(
          core.canonical({
            provider: 'deepseek',
            model: 'deepseek-flash',
            baseUrl: 'https://api.deepseek.com'
          })
        )
      },
      verdict: 'pass',
      findings: [],
      blockers: [],
      batches: [{ id: 'batch-one', digest: 'f'.repeat(64) }]
    },
    'test',
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  )
  const created: any[] = []
  const state: any = {
    branchHead: base,
    hook: undefined,
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
    if (state.hook) await state.hook(route, options)
    if (options.method === 'POST' && route.endsWith('/check-runs')) {
      const record = { ...options.body, id: created.length + 1, app: { id: appId } }
      created.push(record)
      return record
    }
    if (route.includes('/check-runs')) return { check_runs: created }
    if (route.endsWith('/actions/runs/123'))
      return {
        path: '.github/workflows/review-request.yml',
        run_attempt: 1,
        conclusion: 'success',
        repository: { full_name: policy.repository }
      }
    if (route.endsWith('/actions/runs/91')) return state.quality
    if (route.includes('/actions/workflows/201/runs'))
      return { workflow_runs: state.quality ? [state.quality] : [] }
    if (route.endsWith('/branches/master')) return { protected: true, commit: { sha: state.branchHead } }
    if (route.endsWith('/commits/' + head))
      return { sha: head, commit: { tree: { sha: tree } }, parents: [{ sha: base }] }
    if (route.includes('/compare/')) return { status: 'identical' }
    if (route.includes('/contents/' + workflowPath))
      return { content: Buffer.from(controllerSource).toString('base64') }
    assert.fail('Unexpected fake API route: ' + route)
  }
  const current = () => JSON.parse(readFileSync(join(directory, 'publication-status.json'), 'utf8'))
  const noDispatch = async () => assert.fail('an existing run must not dispatch again')
  const run = (dispatch: () => Promise<unknown> = noDispatch) =>
    publishReviewRequest({ report, policy, api, dispatch, directory })
  return { directory, report, api, state, created, current, run }
}

function assertPrivateOnly(records: any[]) {
  for (const record of records) {
    const texts = [JSON.stringify(record)]
    for (const marker of [core.REPORT_MARKER, core.QUALITY_MARKER]) {
      const encoded = new RegExp(marker + '([A-Za-z0-9+/=]+)').exec(record.output?.summary ?? '')?.[1]
      if (encoded) texts.push(Buffer.from(encoded, 'base64').toString('utf8'))
    }
    for (const text of texts) {
      assert.ok(!text.includes(privateMarker))
      assert.ok(!text.includes('PRIVATE_DIAGNOSTIC_FIXTURE'))
    }
  }
}

test('worker persists a moved-base review rejection before quality admission and clears it after recovery', async (t) => {
  const f = fixture(t)
  const signed = JSON.stringify(f.report)
  const attestation = join(f.directory, 'attestation.json'),
    cache = join(f.directory, 'cache.json')
  writeFileSync(attestation, signed)
  writeFileSync(cache, signed)
  f.state.branchHead = 'f'.repeat(40)
  let seenBeforeAdmission = false
  f.state.hook = (_route: string, options: any) => {
    if (options.method === 'POST' && options.body.name === core.QUALITY_CHECK_NAME) {
      const status = f.current()
      assert.equal(status.phase, 'review-publication')
      assert.match(status.errors[0].reason, /Review base moved/)
      seenBeforeAdmission = true
    }
  }
  const failed = await f.run()
  assert.equal(seenBeforeAdmission, true)
  assert.equal(failed.finished, false, 'a valid proof whose base moved retains retryability')
  assert.equal(failed.errorPhase, 'review-publication')
  assert.match(failed.error, /Review base moved/)
  assert.equal(f.current().sourceVerdict, 'pass')
  assert.equal(f.current().status, 'failed')
  assert.equal(f.created[0].output.summary, PUBLIC_REVIEW_FAILURE)
  const count = f.created.length
  await f.run()
  assert.equal(f.created.length, count, 'persisting local diagnostics does not duplicate public failures')

  f.state.branchHead = base
  f.state.hook = undefined
  const recovered = await f.run()
  assert.equal(recovered.finished, true)
  assert.equal(recovered.monitorQuality.conclusion, 'success')
  assert.equal(recovered.error, undefined)
  assert.equal(recovered.errorPhase, undefined)
  assert.deepEqual(f.current().errors, [])
  assert.equal(f.current().status, 'settled')
  assert.equal(JSON.stringify(f.report), signed)
  assert.equal(readFileSync(attestation, 'utf8'), signed)
  assert.equal(readFileSync(cache, 'utf8'), signed)
  assertPrivateOnly(f.created)
})

test('worker preserves a terminal signature rejection without changing the signed source verdict', async (t) => {
  const f = fixture(t)
  f.report.payload.blockers = [privateError]
  const before = JSON.stringify(f.report)
  const result = await f.run()
  assert.equal(result.finished, true, 'invalid proof rejection remains non-retryable')
  assert.equal(result.monitorQuality, undefined)
  assert.match(result.error, /signature/)
  assert.equal(result.errorPhase, 'review-publication')
  assert.match(f.current().errors[0].reason, /signature/)
  assert.equal(f.current().sourceVerdict, 'pass')
  assert.equal(JSON.stringify(f.report), before)
  assert.ok(f.created.every((check) => check.conclusion === 'failure'))
  assertPrivateOnly(f.created)
})

test('worker records a rejected quality controller while keeping the successful source attestation intact', async (t) => {
  const f = fixture(t)
  f.state.quality.path = '.github/workflows/untrusted.yml'
  const result = await f.run()
  assert.equal(result.finished, false)
  assert.equal(result.errorPhase, 'quality-publication')
  assert.match(result.error, /Untrusted or unsuccessful quality workflow run/)
  assert.equal(f.current().errors[0].reason, result.error)
  assert.equal(f.current().sourceVerdict, 'pass')
  assert.equal(f.created[0].conclusion, 'success')
  assert.equal(f.created[1].conclusion, 'failure')
  assert.equal(f.created[1].output.summary, PUBLIC_REVIEW_FAILURE)
  assertPrivateOnly(f.created)
})

test('worker persists returned quality API details locally and removes the current error after success', async (t) => {
  const f = fixture(t)
  f.state.hook = (route: string) => {
    if (route.includes('/contents/' + workflowPath)) throw new Error(privateError)
  }
  const failed = await f.run()
  assert.equal(failed.finished, false)
  assert.equal(failed.errorPhase, 'quality-publication')
  assert.ok(failed.error.includes(privatePath))
  assert.ok(f.current().errors[0].reason.includes(privateMarker))
  assert.equal(f.current().errors[0].reason, failed.error)
  assert.equal(f.current().sourceVerdict, 'pass')
  f.state.hook = undefined
  const recovered = await f.run()
  assert.equal(recovered.finished, true)
  assert.equal(recovered.error, undefined)
  assert.deepEqual(f.current().errors, [])
  assert.equal(f.current().monitorQuality.runId, 91)
  assertPrivateOnly(f.created)
})

test('worker identifies dispatch API errors and retains pending/monitor semantics after dispatch recovers', async (t) => {
  const f = fixture(t)
  const quality = f.state.quality
  f.state.quality = null
  const failed = await f.run(async () => {
    throw new Error(privateError)
  })
  assert.equal(failed.finished, false)
  assert.equal(failed.errorPhase, 'quality-dispatch')
  assert.ok(failed.error.includes(privateMarker))
  assert.equal(f.current().errors[0].phase, 'quality-dispatch')
  assert.ok(f.current().errors[0].reason.includes(privatePath))
  const pending = await f.run(async () => undefined)
  assert.equal(pending.finished, false)
  assert.equal(pending.monitorQuality, undefined)
  assert.equal(pending.error, undefined)
  assert.equal(f.current().status, 'pending')
  assert.deepEqual(f.current().errors, [])
  f.state.quality = { ...quality, status: 'in_progress', conclusion: null }
  const monitored = await f.run()
  assert.equal(monitored.finished, false)
  assert.equal(monitored.monitorQuality.runId, 91)
  f.state.quality = quality
  assert.equal((await f.run()).finished, true)
  assertPrivateOnly(f.created)
})

test('worker retains the original returned reason if subsequent quality admission publication throws', async (t) => {
  const f = fixture(t)
  f.state.branchHead = 'f'.repeat(40)
  f.state.hook = (_route: string, options: any) => {
    if (options.method === 'POST' && options.body.name === core.QUALITY_CHECK_NAME) {
      assert.match(f.current().errors[0].reason, /Review base moved/)
      throw new Error(privateError)
    }
  }
  await assert.rejects(f.run(), /SYNTHETIC_DIAGNOSTIC_MUST_STAY_LOCAL/)
  const status = f.current()
  assert.equal(status.errors.length, 2)
  assert.equal(status.errors[0].phase, 'review-publication')
  assert.match(status.errors[0].reason, /Review base moved/)
  assert.equal(status.errors[1].phase, 'quality-admission')
  assert.ok(status.errors[1].reason.includes(privateMarker))
  assert.equal(status.sourceVerdict, 'pass')
  assert.equal(f.created.length, 1)
  assert.equal(f.created[0].conclusion, 'failure')
  assertPrivateOnly(f.created)
})

test('a settled failed trusted run remains monitored rather than being relabelled as an exception or a pass', async (t) => {
  const f = fixture(t)
  f.state.quality.conclusion = 'failure'
  const result = await f.run()
  assert.equal(result.finished, true)
  assert.equal(result.monitorQuality.conclusion, 'failure')
  assert.equal(result.error, undefined)
  assert.equal(f.current().status, 'settled')
  assert.equal(f.current().monitorQuality.conclusion, 'failure')
  assert.deepEqual(f.current().errors, [])
  assert.equal(f.created.at(-1).conclusion, 'failure')
  assert.equal(f.report.payload.verdict, 'pass')
  assertPrivateOnly(f.created)
})
