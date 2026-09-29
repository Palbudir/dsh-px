import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, verify as cryptoVerify } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { deflateRawSync } from 'node:zlib'
const load = (name: string): Promise<any> => import(pathToFileURL(resolve('scripts', name)).href)
const core = await load('review-core.mjs')
const { publishReview, publishQuality, settleQuality } = await load('review-verify.mjs')
const { trustedRun, qualityChanged, runTitle } = await load('review-trusted-ci.mjs')
const { assertChecks, assertNewerVersion, assertLegacyLatest, releaseGate, LEGACY_LATEST_TAG } =
  await load('release-gate.mjs')
const releaseProducts = JSON.parse(readFileSync(resolve('config/products.json'), 'utf8'))
const desktopTag = `desktop-v${releaseProducts.desktop.version}`
const { compareVersions } = await load('release-version.mjs')
const { outsideRepository } = await load('review-install.mjs')
const { command, downloadCommand } = await load('review-process.mjs')
const { APP_PERMISSIONS, appJwt, createAppClient, assertAppPermissions } = await load('review-app.mjs')
const { acquireReviewLock } = await load('review-worker.mjs')
const { validateCatalog } = await load('release-catalog.mjs')
const { archiveMemberNames, verifyReleaseFiles } = await load('release-controller.mjs')
const head = 'a'.repeat(40),
  base = 'b'.repeat(40),
  tree = 'c'.repeat(40),
  appId = 777
const key = generateKeyPairSync('ed25519')
const privateKey = key.privateKey.export({ type: 'pkcs8', format: 'pem' })
const publicKey = key.publicKey.export({ type: 'spki', format: 'pem' })
const controllerSource = 'trusted controller source\n'
const qualityPath = '.github/workflows/trusted-quality.yml',
  buildPath = '.github/workflows/release.yml'
const policy = {
  repository: 'owner/repo',
  branch: 'master',
  publisher: 'owner',
  workerDigest: 'worker-v1',
  reviewAppId: appId,
  keys: { test: publicKey },
  maxAgeHours: 24,
  requiredChecks: [core.CHECK_NAME, core.QUALITY_CHECK_NAME],
  trustedQuality: {
    workflowId: 201,
    path: qualityPath,
    files: { [qualityPath]: core.sourceDigest(controllerSource) }
  },
  trustedBuild: {
    workflowId: 202,
    path: buildPath,
    files: { [buildPath]: core.sourceDigest(controllerSource) }
  }
}
function proof(extra = {}) {
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
      filesDigest: 'd'.repeat(64),
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
      batches: [{ id: 'one', digest: 'd'.repeat(64) }],
      ...extra
    },
    'test',
    privateKey
  )
}
function result(id: string, extra = {}) {
  return {
    head,
    base,
    batchId: id,
    verdict: 'pass',
    summary: 'Reviewed',
    findings: [],
    blockers: [],
    ...extra
  }
}
function workflow(kind = 'quality', extra = {}) {
  return {
    id: kind === 'quality' ? 91 : 92,
    run_attempt: 1,
    workflow_id: kind === 'quality' ? 201 : 202,
    path: kind === 'quality' ? qualityPath : buildPath,
    event: 'workflow_dispatch',
    head_branch: 'master',
    head_sha: base,
    display_title: runTitle(kind, head, desktopTag),
    repository: { full_name: policy.repository },
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://github.com/owner/repo/actions/runs/91',
    ...extra
  }
}
function qualityEvidence() {
  const run = workflow()
  return {
    runId: run.id,
    runAttempt: run.run_attempt,
    workflowId: run.workflow_id,
    path: run.path,
    targetHead: head,
    controllerSha: base,
    conclusion: run.conclusion,
    url: run.html_url
  }
}
function checkRuns(report = proof()) {
  return [
    {
      id: 1,
      name: core.CHECK_NAME,
      head_sha: head,
      app: { id: appId },
      status: 'completed',
      conclusion: 'success',
      output: { summary: core.REPORT_MARKER + core.encodeReport(report) }
    },
    {
      id: 2,
      name: core.QUALITY_CHECK_NAME,
      head_sha: head,
      app: { id: appId },
      status: 'completed',
      conclusion: 'success',
      output: {
        summary: core.QUALITY_MARKER + Buffer.from(JSON.stringify(qualityEvidence())).toString('base64')
      }
    }
  ]
}
function fixtureApi(options: any = {}) {
  const created: any[] = [],
    checks: any[] = options.checks ?? checkRuns()
  const quality = options.quality ?? workflow(),
    build = options.build ?? workflow('build')
  const api = async (route: string, mutation: any = {}): Promise<any> => {
    if (mutation.method === 'POST' && route.endsWith('/check-runs')) {
      const check = { id: 100 + created.length, app: { id: appId }, ...mutation.body }
      created.push(check)
      checks.push(check)
      return check
    }
    if (route.includes('/check-runs')) return { total_count: checks.length, check_runs: checks }
    if (route.endsWith('/actions/runs/123'))
      return {
        path: '.github/workflows/review-request.yml',
        run_attempt: 1,
        conclusion: 'success',
        repository: { full_name: policy.repository }
      }
    if (route.endsWith('/actions/runs/91')) return quality
    if (route.endsWith('/actions/runs/92')) return build
    if (route.includes('/actions/workflows/201/runs')) return { workflow_runs: [quality] }
    if (route.includes('/branches/'))
      return {
        protected: true,
        commit: { sha: options.branchHead ?? head },
        protection: {
          required_status_checks: {
            checks: policy.requiredChecks.map((context) => ({ context, app_id: appId }))
          }
        }
      }
    if (route.includes('/compare/')) return { status: options.ancestry ?? 'ahead' }
    if (route.includes('/contents/package.json'))
      return {
        content: Buffer.from(
          JSON.stringify({ name: 'dsh-px', version: releaseProducts.desktop.version })
        ).toString('base64')
      }
    if (route.includes('/contents/config/products.json'))
      return { content: Buffer.from(JSON.stringify(options.products ?? releaseProducts)).toString('base64') }
    if (route.includes('/contents/'))
      return { content: Buffer.from(options.controllerSource ?? controllerSource).toString('base64') }
    if (route.endsWith('/commits/' + head))
      return { sha: head, commit: { tree: { sha: tree } }, parents: [{ sha: base }] }
    if (route.endsWith('/releases/latest'))
      return options.latest ?? { tag_name: 'v0.1.0-beta.re.0.11', prerelease: false, draft: false }
    if (route.includes('/releases'))
      return (
        options.releases ?? [
          { tag_name: 'v0.1.0-beta.re.0.11', draft: false },
          { tag_name: 'v0.1.0-beta.re.0.10.1', draft: false }
        ]
      )
    throw new Error('Unexpected fixture API: ' + route)
  }
  return { api, created, checks }
}

test('signed reviews bind exact SHA, base, worker and reviewer; missing hashes and old evidence fail', () => {
  assert.equal(core.verifyAttestation(proof(), policy, { head, base }).head, head)
  const tampered = proof()
  tampered.payload.head = 'e'.repeat(40)
  assert.throws(() => core.verifyAttestation(tampered, policy), /signature/)
  assert.throws(() => core.verifyAttestation(proof(), policy, { head: 'e'.repeat(40) }), /mismatch/)
  assert.throws(() => core.verifyAttestation(proof(), policy, { base: 'e'.repeat(40) }), /mismatch/)
  assert.throws(() => core.verifyAttestation(proof(), { ...policy, publisher: 'another' }), /mismatch/)
  assert.throws(() => core.verifyAttestation(proof(), { ...policy, keys: {} }), /signature/)
  assert.throws(
    () => core.verifyAttestation(proof({ completedAt: Date.now() - 25 * 3600000 }), policy),
    /stale/
  )
  assert.throws(() => core.verifyAttestation(proof({ filesDigest: '' }), policy), /identity/)
  const reviewer = proof().payload.reviewer
  for (const changed of [
    { cliVersion: 'fixture-cli', configurationDigest: 'e'.repeat(64) },
    { ...reviewer, model: 'other-model' },
    { ...reviewer, baseUrl: 'http://api.deepseek.com' },
    { ...reviewer, provider: undefined }
  ])
    assert.throws(() => core.verifyAttestation(proof({ reviewer: changed }), policy), /reviewer identity/)
})
test('all batches must complete; any P0/P1/P2 or missing context prevents a pass', () => {
  const batches = [
    { id: 'one', text: 'a' },
    { id: 'two', text: 'b' }
  ]
  assert.equal(core.aggregate({ head, base }, batches, [result('one'), result('two')]).verdict, 'pass')
  assert.throws(() => core.aggregate({ head, base }, batches, [result('one')]), /coverage/)
  for (const priority of [0, 1, 2]) {
    const findings = [{ priority, path: 'a.ts', line: 1, title: 'Bug', detail: 'Concrete bad behavior' }]
    assert.equal(
      core.aggregate({ head, base }, batches, [result('one', { findings }), result('two')]).verdict,
      'fail'
    )
    assert.throws(() => core.verifyAttestation(proof({ findings }), policy), /unresolved/)
  }
  assert.equal(
    core.aggregate({ head, base }, batches, [result('one', { blockers: ['Missing context'] }), result('two')])
      .verdict,
    'fail'
  )
})
test('large sources are fully split; invalid UTF8, NUL and binary changes cannot pass as text', () => {
  const batches = core.splitBatches(
    [{ path: ' file.ts', before: 'A'.repeat(9100), after: 'B'.repeat(11300) }],
    'context',
    5000
  )
  assert.ok(batches.length > 2 && batches[0].text.includes('" file.ts"'))
  const count = (char: string) =>
    batches
      .map((b: any) => b.text.match(new RegExp(char + '{2,}', 'g'))?.join('').length ?? 0)
      .reduce((a: number, b: number) => a + b, 0)
  assert.equal(count('A'), 9100)
  assert.equal(count('B'), 11300)
  assert.throws(() => core.decodeSource(Buffer.from([0xff, 0xfe, 0x41]), 'non-utf8.txt'))
  assert.throws(() => core.decodeSource(Buffer.from([0, 65]), 'binary.dat'), /Binary/)
  assert.equal(core.decodeSource(Buffer.from('\ufefftext'), 'bom.txt'), '\ufefftext')
})
test('trusted installation boundary rejects dot-prefixed descendants as well as ordinary children', () => {
  const root = mkdtempSync(join(tmpdir(), 'review-boundary-'))
  try {
    const child = join(root, '..trusted-review')
    mkdirSync(child)
    assert.equal(outsideRepository(root, child), false)
    assert.equal(outsideRepository(realpathSync(root), realpathSync(child)), false)
    assert.equal(outsideRepository(root, join(root, 'ordinary')), false)
    assert.equal(outsideRepository(root, resolve(root, '..', 'outside')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('same-named GitHub Actions checks cannot impersonate the dedicated App or a new SHA', () => {
  assert.doesNotThrow(() => assertChecks(checkRuns(), policy, head))
  assert.throws(
    () =>
      assertChecks(
        checkRuns().map((c) => ({ ...c, app: { id: 15368 } })),
        policy,
        head
      ),
    /dedicated/
  )
  assert.throws(() => assertChecks(checkRuns(), { ...policy, reviewAppId: 15368 }, head), /Dedicated/)
  assert.throws(() => assertChecks(checkRuns(), policy, 'f'.repeat(40)), /Missing/)
  const checks = checkRuns()
  checks.push({ ...checks[1], id: 99, conclusion: 'failure' })
  assert.throws(() => assertChecks(checks, policy, head), /unsuccessful/)
})
for (const change of [
  { workflow_id: 999 },
  { path: '.github/workflows/forged.yml' },
  { head_branch: 'feature' },
  { event: 'push' },
  { display_title: 'dsh-px-quality:' + 'f'.repeat(40) },
  { conclusion: 'failure' }
]) {
  test(`quality run cannot forge its trusted origin: ${Object.keys(change)[0]}`, async () => {
    const fixture = fixtureApi({ quality: workflow('quality', change) })
    await assert.rejects(trustedRun(fixture.api, policy, 'quality', 91, head), /Untrusted/)
  })
}
test('controller must belong to protected history and match its independently installed source hashes', async () => {
  assert.equal((await trustedRun(fixtureApi().api, policy, 'quality', 91, head)).targetHead, head)
  await assert.rejects(
    trustedRun(fixtureApi({ ancestry: 'diverged' }).api, policy, 'quality', 91, head),
    /history/
  )
  await assert.rejects(
    trustedRun(fixtureApi({ controllerSource: 'changed guard' }).api, policy, 'quality', 91, head),
    /Unapproved/
  )
})
test('App publishing de-duplicates unchanged checks; quality failure can settle a successful rerun', async () => {
  const fixture = fixtureApi({ checks: [] })
  const report = proof()
  assert.equal((await publishReview(report, policy, fixture.api)).conclusion, 'success')
  await publishReview(report, policy, fixture.api)
  assert.equal(fixture.created.length, 1)
  await publishQuality(policy, fixture.api, head, null, 'Attempt 1 failed')
  await publishQuality(policy, fixture.api, head, null, 'Attempt 1 failed')
  assert.equal(fixture.created.length, 2)
  const previous = { runId: 91, runAttempt: 1, status: 'completed', conclusion: 'failure' }
  assert.equal(
    qualityChanged(previous, { id: 91, run_attempt: 1, status: 'completed', conclusion: 'failure' }),
    false
  )
  assert.equal(
    qualityChanged(previous, { id: 91, run_attempt: 2, status: 'completed', conclusion: 'success' }),
    true
  )
  const successful = { runId: 91, runAttempt: 2, status: 'completed', conclusion: 'success' }
  assert.equal(
    qualityChanged(successful, { id: 91, run_attempt: 3, status: 'in_progress', conclusion: null }),
    true
  )
  assert.equal(
    qualityChanged(successful, { id: 92, run_attempt: 1, status: 'completed', conclusion: 'failure' }),
    true
  )
  await publishQuality(policy, fixture.api, head, qualityEvidence())
  assert.equal(fixture.created.at(-1).conclusion, 'success')
})

test('a first quality API 503 remains retryable and later success settles without duplicate failures', async () => {
  const fixture = fixtureApi({ checks: [] })
  let failing = true
  const api = async (route: string, options?: any) => {
    if (failing && route.includes('/actions/workflows/201/runs'))
      throw new Error('HTTP 503 temporary failure')
    return fixture.api(route, options)
  }
  const dispatch = async () => {
    assert.fail('existing run must not dispatch again')
  }
  assert.equal((await settleQuality(policy, api, head, dispatch)).finished, false)
  assert.equal(fixture.created.at(-1).conclusion, 'failure')
  await settleQuality(policy, api, head, dispatch)
  assert.equal(fixture.created.length, 1)
  failing = false
  assert.equal((await settleQuality(policy, api, head, dispatch)).finished, true)
  assert.equal(fixture.created.at(-1).conclusion, 'success')
})
test('App JWT and installation token stay inside the local client and request no code/release write permission', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'review-app-fixture-'))
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' })
  writeFileSync(join(directory, 'github-app.pem'), pem)
  try {
    const jwt = appJwt(appId, pem, 1000000),
      parts = jwt.split('.')
    assert.equal(JSON.parse(Buffer.from(parts[1], 'base64url').toString()).iss, String(appId))
    assert.equal(
      cryptoVerify(
        'RSA-SHA256',
        Buffer.from(parts.slice(0, 2).join('.')),
        rsa.publicKey,
        Buffer.from(parts[2], 'base64url')
      ),
      true
    )
    const calls: any[] = []
    const api = await createAppClient(
      { directory, repository: policy.repository, githubApp: { appId, installationId: 7, repositoryId: 42 } },
      async (url: string, init: any) => {
        calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined })
        const data = url.endsWith('/app')
          ? { id: appId, permissions: APP_PERMISSIONS }
          : url.includes('/access_tokens')
            ? {
                token: 'fixture-installation-token',
                permissions: APP_PERMISSIONS,
                expires_at: new Date(Date.now() + 3600000).toISOString()
              }
            : url.includes('/installation/repositories')
              ? { total_count: 1, repositories: [{ id: 42, full_name: policy.repository }] }
              : { ok: true }
        return new Response(JSON.stringify(data), { status: 200 })
      }
    )
    assert.equal((await api(`repos/${policy.repository}/compare/${base}...${head}`)).ok, true)
    assert.deepEqual(calls.find((call) => call.url.includes('/access_tokens')).body, {
      repository_ids: [42],
      permissions: APP_PERMISSIONS
    })
    assert.equal(APP_PERMISSIONS.contents, 'read')
    assert.throws(() => assertAppPermissions({ ...APP_PERMISSIONS, contents: 'write' }), /mismatch/)
    assert.throws(() => assertAppPermissions({ ...APP_PERMISSIONS, administration: 'write' }), /Unapproved/)
    assert.ok(!JSON.stringify(calls).includes('fixture-installation-token'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
test('local release gate binds protected HEAD, signed App checks, latest trusted CI, product build and version', async () => {
  const version = releaseProducts.desktop.version
  const input = {
    product: 'desktop',
    version,
    tag: `refs/tags/${desktopTag}`,
    head,
    policy,
    buildRunId: 92,
    api: fixtureApi().api
  }
  const gate = await releaseGate(input)
  assert.equal(gate.build.runId, 92)
  assert.equal(gate.tag, desktopTag)
  await assert.rejects(
    releaseGate({ ...input, api: fixtureApi({ branchHead: base }).api }),
    /current protected/
  )
  await assert.rejects(
    releaseGate({ ...input, api: fixtureApi({ quality: workflow('quality', { run_attempt: 2 }) }).api }),
    /latest/
  )
  await assert.rejects(
    releaseGate({ ...input, api: fixtureApi({ build: workflow('build', { head_branch: 'feature' }) }).api }),
    /Untrusted/
  )
  // A build run for the other product (different run-name) cannot authorize this release.
  await assert.rejects(
    releaseGate({
      ...input,
      api: fixtureApi({
        build: workflow('build', { display_title: runTitle('build', head, `pack-v${version}`) })
      }).api
    }),
    /Untrusted/
  )
  for (const tag of [`refs/tags/v${version}`, `refs/tags/pack-v${version}`, `desktop-v${version}`])
    await assert.rejects(releaseGate({ ...input, tag }), /exact product version tag/)
  await assert.rejects(releaseGate({ ...input, version: '0.2.99' }), /tag|reviewed desktop version/)
  const legacy = structuredClone(releaseProducts)
  legacy.desktop.architecture = 'legacy-shell'
  await assert.rejects(
    releaseGate({ ...input, api: fixtureApi({ products: legacy }).api }),
    /official-derived/
  )
  await assert.rejects(
    releaseGate({
      ...input,
      api: fixtureApi({ latest: { tag_name: `desktop-v0.2.0-alpha.0`, prerelease: true } }).api
    }),
    /GitHub Latest must remain/
  )
  await assert.rejects(
    releaseGate({ ...input, api: fixtureApi({ releases: [{ tag_name: desktopTag, draft: false }] }).api }),
    /not newer/
  )
  assert.ok(compareVersions('0.1.0-beta.re.0.10.1', '0.1.0-beta.re.0.10') > 0)
  assert.ok(compareVersions('1.0.0', '1.0.0-rc.99') > 0)
})

test('versions are monotonic per product prefix; history tags and drafts are not compared', () => {
  const history = [
    { tag_name: 'v0.1.0-beta.re.0.11', draft: false },
    { tag_name: 'v9.9.9', draft: false },
    { tag_name: 'pack-v0.2.0-alpha.3', draft: false },
    { tag_name: 'desktop-v0.2.0-alpha.1', draft: false },
    { tag_name: 'desktop-v0.2.0-alpha.9', draft: true }
  ]
  assertNewerVersion('desktop', '0.2.0-alpha.2', history)
  assertNewerVersion('pack', '0.2.0-alpha.4', history)
  assert.throws(() => assertNewerVersion('desktop', '0.2.0-alpha.1', history), /not newer/)
  assert.throws(() => assertNewerVersion('pack', '0.2.0-alpha.2', history), /not newer/)
  assert.throws(
    () => assertNewerVersion('pack', '0.2.1', [{ tag_name: 'pack-vbroken', draft: false }]),
    /invalid tag/
  )
})

test('the legacy Latest release must stay the unchanged legacy-shell prerelease-free tag', () => {
  assert.equal(LEGACY_LATEST_TAG, 'v0.1.0-beta.re.0.11')
  assertLegacyLatest({ tag_name: LEGACY_LATEST_TAG, prerelease: false, draft: false })
  for (const latest of [
    null,
    { tag_name: 'desktop-v0.2.0-alpha.1', prerelease: true },
    { tag_name: 'pack-v0.2.0-alpha.1', prerelease: false },
    { tag_name: LEGACY_LATEST_TAG, prerelease: true }
  ])
    assert.throws(() => assertLegacyLatest(latest), /GitHub Latest must remain/)
})

test('release archives reject traversal and payload identities fail before any publication', () => {
  assert.deepEqual(
    archiveMemberNames(
      'Path = archive.zip\nPath = release-manifest.json\nPath = artifact.json',
      'archive.zip'
    ),
    ['release-manifest.json', 'artifact.json']
  )
  assert.throws(
    () => archiveMemberNames('Path = archive.zip\nPath = ../signing-key.pem', 'archive.zip'),
    /unsafe/
  )
  assert.throws(
    () => archiveMemberNames('Path = a.zip\nPath = artifact.json\nSymbolic Link = secret', 'a.zip'),
    /links/
  )
  assert.throws(
    () =>
      verifyReleaseFiles(
        'unused',
        { schemaVersion: 1, head, version: '1.0.0', files: [] },
        { product: 'pack', head, version: '1.0.0', controllerSha: base }
      ),
    /identity/
  )
})
test('process failure, timeout and bounded binary download cannot produce success', async () => {
  await assert.rejects(command(process.execPath, ['-e', 'process.exit(7)']), /failed/)
  await assert.rejects(
    command(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeout: 20 }),
    /timed out/
  )
  const directory = mkdtempSync(join(tmpdir(), 'review-download-'))
  try {
    const path = join(directory, 'binary')
    assert.equal(
      await downloadCommand(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0,255,1]))'], path),
      3
    )
    assert.deepEqual(readFileSync(path), Buffer.from([0, 255, 1]))
    await assert.rejects(
      downloadCommand(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(100))'], path, {
        maxBytes: 10
      }),
      /limit/
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
function requestArchive(name: string, request: any): Buffer {
  const text = Buffer.from(JSON.stringify(request)),
    packed = deflateRawSync(text),
    filename = Buffer.from(name)
  const local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(8, 8)
  local.writeUInt16LE(filename.length, 26)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(packed.length, 20)
  central.writeUInt32LE(text.length, 24)
  central.writeUInt16LE(filename.length, 28)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(local.length + filename.length + packed.length, 16)
  return Buffer.concat([local, filename, packed, central, filename, end])
}
test('request ZIP is bounded and never extracted; forks require explicit maintainer handling', () => {
  const request = {
    version: 1,
    repository: policy.repository,
    headRepository: policy.repository,
    head,
    base,
    runId: 123,
    runAttempt: 1,
    kind: 'push'
  }
  assert.deepEqual(
    core.validateRequest(core.requestFromZip(requestArchive('request.json', request)), policy.repository),
    request
  )
  assert.throws(() => core.requestFromZip(requestArchive('../request.json', request)), /member/)
  assert.throws(
    () => core.validateRequest({ ...request, headRepository: 'outside/fork' }, policy.repository),
    /Fork/
  )
})
test('worker lock excludes concurrent consumers and releases on close', () => {
  const directory = mkdtempSync(join(tmpdir(), 'review-lock-'))
  try {
    const release = acquireReviewLock(directory)
    assert.equal(acquireReviewLock(directory), null)
    release()
    acquireReviewLock(directory)()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
test('roadmap catalog rejects stale status, duplicate IDs and missing dependencies', () => {
  const feature = {
    phase: '短期',
    category: '可靠性',
    name: 'Feature',
    priority: 'P1',
    utility: 5,
    difficulty: 2,
    fit: 5,
    effort: '1d',
    intro: 'Spec',
    subtasks: ['One step'],
    acceptance: 'Result',
    route: 'plugin',
    dependencies: []
  }
  const catalog = {
    schemaVersion: 2,
    purpose: 'Specifications',
    statusAuthority: '../ROADMAP.md',
    scoring: { utility: '1–5', difficulty: '1–5', fit: '1–5' },
    features: Array.from({ length: 100 }, (_, i) => ({ ...feature, id: 'F' + i }))
  }
  assert.equal(validateCatalog(catalog).features, 100)
  const duplicate = structuredClone(catalog)
  duplicate.features[1].id = 'F0'
  assert.throws(() => validateCatalog(duplicate), /Duplicate/)
  const stale: any = structuredClone(catalog)
  stale.features[0].status = 'old'
  assert.throws(() => validateCatalog(stale), /stale/)
  const missing: any = structuredClone(catalog)
  missing.features[0].dependencies = ['absent']
  assert.throws(() => validateCatalog(missing), /dependency/)
})
