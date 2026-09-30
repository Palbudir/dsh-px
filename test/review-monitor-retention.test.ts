import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'

const load = (name: string): Promise<any> => import(pathToFileURL(resolve('scripts', name)).href)
const { canonical, sha256, attest, sourceDigest } = await load('review-core.mjs')
const { installReviewParser } = await load('review-parser.mjs')
const head = 'a'.repeat(40),
  base = 'b'.repeat(40),
  tree = 'c'.repeat(40),
  artifactBase = 'd'.repeat(40)

function zipRequest(value: unknown) {
  const name = Buffer.from('request.json'),
    body = Buffer.from(JSON.stringify(value))
  const local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(body.length, 22)
  local.writeUInt16LE(name.length, 26)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt32LE(body.length, 20)
  central.writeUInt32LE(body.length, 24)
  central.writeUInt16LE(name.length, 28)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + name.length, 12)
  end.writeUInt32LE(local.length + name.length + body.length, 16)
  return Buffer.concat([local, name, body, central, name, end])
}

// This child imports the unmodified installed worker main. Only OS/network boundaries are fake.
const childSource = `
import fs from 'node:fs';import cp from 'node:child_process';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {syncBuiltinESMExports} from 'node:module';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const directory=process.cwd(),data=JSON.parse(fs.readFileSync('fixture-data.json','utf8'));
const calls={gh:[],app:[],published:[],model:0,git:0,cacheReads:0};
const checks=data.checks??[],originalRead=fs.readFileSync;
fs.readFileSync=(path,...args)=>{if(String(path).includes('cache-'))calls.cacheReads++;return originalRead(path,...args)};
const run={id:913,run_attempt:data.runAttempt,event:'pull_request_target',path:'.github/workflows/review-request.yml',conclusion:'success',status:'completed',head_branch:'feature',head_sha:data.runHead,repository:{full_name:'fixture/repo'}};
const quality={id:701,run_attempt:data.qualityAttempt,workflow_id:5,path:data.workflow,event:'workflow_dispatch',head_branch:'master',head_sha:data.base,display_title:'dsh-px-quality:'+data.head,repository:{full_name:'fixture/repo'},status:data.qualityStatus,conclusion:data.qualityConclusion,html_url:'https://github.com/fixture/repo/actions/runs/701'};
const api=(route)=>{
 if(route==='user')return {login:'fixture'};
 if(route.includes('/branches?'))return [{name:'master',commit:{sha:data.base}},{name:'feature',commit:{sha:data.head}}];
 if(route.includes('/actions/workflows/review-request.yml/runs'))return {workflow_runs:[run]};
 if(route.endsWith('/actions/runs/913/artifacts')){
  if(data.artifact==='deleted')throw Error('fixture artifact HTTP 404');
  return {artifacts:data.artifact==='missing'?[]:[{id:917,name:'review-request-'+data.runAttempt,expired:data.artifact==='expired'}]};
 }
 if(route.endsWith('/actions/artifacts/917/zip'))return Buffer.from(data.requestZip,'base64');
 if(route.endsWith('/pulls/42'))return {number:42,state:data.prState,head:{sha:data.prHead,repo:{full_name:'fixture/repo'}},base:{sha:data.base,repo:{full_name:'fixture/repo'}}};
 if(route.includes('/actions/workflows/5/runs'))return {workflow_runs:[quality]};
 if(route.endsWith('/actions/runs/701'))return quality;
 if(route.endsWith('/actions/runs/913'))return {...run,run_attempt:data.runAttempt};
 if(route.endsWith('/branches/master'))return {protected:true,commit:{sha:data.base}};
 if(route.endsWith('/commits/'+data.head))return {commit:{tree:{sha:data.tree}},parents:[{sha:data.base}]};
 if(route.includes('/compare/'))return {status:'identical'};
 if(route.includes('/contents/'))return {content:Buffer.from(data.controller).toString('base64')};
 throw Error('Unexpected isolated route '+route);
};
cp.spawn=(exe,args)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;process.nextTick(()=>{try{let result;if(exe==='fixture-gh'){calls.gh.push(args[1]);result=api(args[1])}else if(exe==='fixture-git'){calls.git++;throw Error('Fixture forbids Git/model execution')}else{calls.model++;throw Error('Fixture forbids model execution')}child.stdout.end(Buffer.isBuffer(result)?result:typeof result==='string'?result:JSON.stringify(result));child.emit('close',0)}catch(error){child.stderr.end(String(error));child.emit('close',1)}});return child};
syncBuiltinESMExports();
const permissions={contents:'read',pull_requests:'read',actions:'read',checks:'write'};
globalThis.fetch=async(url,options={})=>{if(!String(url).startsWith('https://api.github.com/')){calls.model++;throw Error('Fixture forbids model execution')}const route=String(url).replace('https://api.github.com/','');calls.app.push({route,method:options.method??'GET'});let value;if(route==='app')value={id:777,permissions};else if(route==='app/installations/7/access_tokens')value={token:'fixture-token',expires_at:new Date(Date.now()+3600000).toISOString(),permissions};else if(route.startsWith('installation/repositories?'))value={total_count:1,repositories:[{id:1,full_name:'fixture/repo'}]};else if(route.includes('/check-runs?'))value={check_runs:checks};else if(route.endsWith('/check-runs')&&options.method==='POST'){const body=JSON.parse(options.body);value={...body,id:checks.length+1,app:{id:777}};checks.push(value);calls.published.push(value)}else value=api(route);return {ok:true,status:200,json:async()=>value}};
const worker=join(directory,'review-worker.mjs');process.argv=[process.execPath,worker,'--publish',...(data.rerun?['--rerun=913']:[])];
let fatal;try{await import(pathToFileURL(worker).href)}catch(error){fatal=String(error);process.exitCode=1}finally{fs.writeFileSync('observed.json',JSON.stringify({calls,checks,fatal,exitCode:process.exitCode??0}))}
`

function fixture(t: TestContext) {
  const parent = realpathSync(tmpdir()),
    directory = realpathSync(mkdtempSync(join(parent, 'dshpx-retention-main-')))
  t.after(() => {
    assert.ok(directory.startsWith(parent + sep))
    rmSync(directory, { recursive: true, force: true })
  })
  const files = installReviewParser(resolve('.'), directory)
  for (const name of [
    'review-worker.mjs',
    'review-core.mjs',
    'review-diff.mjs',
    'review-tools.mjs',
    'review-parser.mjs',
    'review-process.mjs',
    'review-model.mjs',
    'review-app.mjs',
    'review-verify.mjs',
    'review-trusted-ci.mjs',
    'review-upstream.mjs',
    'check-secrets.mjs'
  ]) {
    copyFileSync(join('scripts', name), join(directory, name))
    files[name] = sha256(readFileSync(join(directory, name)))
  }
  const workerDigest = sha256(canonical(files)),
    key = generateKeyPairSync('ed25519')
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const controller = 'trusted inert fixture controller\n',
    workflow = '.github/workflows/trusted-quality.yml'
  const policy = {
    version: 1,
    repository: 'fixture/repo',
    branch: 'master',
    publisher: 'fixture',
    workerDigest,
    reviewAppId: 777,
    keys: { fixture: key.publicKey.export({ type: 'spki', format: 'pem' }) },
    trustedQuality: { workflowId: 5, path: workflow, files: { [workflow]: sourceDigest(controller) } }
  }
  const config = {
    directory,
    repository: policy.repository,
    branch: 'master',
    publisher: 'fixture',
    workerDigest,
    git: 'fixture-git',
    gh: 'fixture-gh',
    githubApp: { appId: 777, installationId: 7, repositoryId: 1 },
    keyId: 'fixture',
    model: {
      provider: 'deepseek',
      model: 'deepseek-flash',
      baseUrl: 'https://api.deepseek.com',
      apiKeyEnv: 'DSHPX_FIXTURE_MODEL_KEY'
    }
  }
  const reviewerIdentity = {
    provider: 'deepseek',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com'
  }
  const fixtureReviewer = { ...reviewerIdentity, configurationDigest: sha256(canonical(reviewerIdentity)) }
  for (const [name, value] of [
    ['installation.json', { files, workerDigest }],
    ['worker.json', config],
    ['public-policy.json', policy]
  ] as const)
    writeFileSync(join(directory, name), JSON.stringify(value))
  writeFileSync(join(directory, 'github-app.pem'), rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }))
  writeFileSync(join(directory, 'signing-key.pem'), key.privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const proof = attest(
    {
      version: 1,
      repository: policy.repository,
      publisher: policy.publisher,
      workerDigest,
      head,
      base,
      tree,
      mergeBase: base,
      filesDigest: 'e'.repeat(64),
      contextDigest: 'f'.repeat(64),
      requestRunId: 913,
      requestAttempt: 1,
      completedAt: Date.now(),
      reviewer: fixtureReviewer,
      verdict: 'pass',
      findings: [],
      blockers: [],
      batches: [{ id: 'fixture', digest: 'e'.repeat(64) }]
    },
    'fixture',
    key.privateKey.export({ type: 'pkcs8', format: 'pem' })
  )
  const cache = join(
    directory,
    'cache-' + sha256(canonical({ head, base, workerDigest, model: reviewerIdentity })) + '.json'
  )
  writeFileSync(cache, JSON.stringify(proof))
  const request = {
    version: 1,
    repository: policy.repository,
    headRepository: policy.repository,
    kind: 'pull_request',
    pullRequest: 42,
    head,
    base: artifactBase,
    runId: 913,
    runAttempt: 1
  }
  const data: any = {
    head,
    base,
    tree,
    controller,
    workflow,
    requestZip: zipRequest(request).toString('base64'),
    artifact: 'present',
    runAttempt: 1,
    runHead: base,
    prState: 'open',
    prHead: head,
    qualityAttempt: 1,
    qualityStatus: 'completed',
    qualityConclusion: 'success',
    checks: []
  }
  writeFileSync(join(directory, 'run-fixture.mjs'), childSource)
  const queuePath = join(directory, 'queue-state.json')
  const queue = (): Record<string, any> =>
    existsSync(queuePath) ? JSON.parse(readFileSync(queuePath, 'utf8')) : {}
  const launch = (env: Record<string, string | undefined> = {}) => {
    writeFileSync(join(directory, 'fixture-data.json'), JSON.stringify(data))
    const launchEnv: Record<string, string | undefined> = {
      ...process.env,
      NODE_OPTIONS: '',
      NODE_PATH: '',
      DSH_PX_REVIEW_MAX_JOBS: '1',
      DSHPX_FIXTURE_MODEL_KEY: 'fixture-model-key',
      ...env
    }
    for (const [name, value] of Object.entries(launchEnv)) if (value === undefined) delete launchEnv[name]
    const result = spawnSync(process.execPath, ['run-fixture.mjs'], {
      cwd: directory,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10000,
      env: launchEnv
    })
    assert.equal(result.error, undefined)
    return { result, observed: JSON.parse(readFileSync(join(directory, 'observed.json'), 'utf8')) }
  }
  const poll = () => {
    const state = queue()
    for (const value of Object.values(state)) value.retryAt = 0
    writeFileSync(queuePath, JSON.stringify(state))
    const { result, observed } = launch()
    assert.equal(observed.fatal, undefined, result.stderr)
    data.checks = observed.checks
    return { ...observed, processStatus: result.status, queue: queue() }
  }
  const identity = (attempt = 1) => join(directory, 'jobs', `913-${attempt}`, 'request-identity.json')
  const capture = () => {
    const result = poll()
    assert.equal(result.processStatus, 0)
    assert.equal(result.queue['913-1'].monitorQuality.runAttempt, 1)
    assert.equal(result.calls.model, 0)
    assert.equal(result.calls.git, 0)
    assert.ok(result.calls.gh.some((route: string) => route.includes('/artifacts')))
    assert.equal(JSON.parse(readFileSync(identity(), 'utf8')).request.base, artifactBase)
    return result
  }
  return { directory, workerDigest, data, request, cache, queuePath, queue, launch, poll, capture, identity }
}

test('real worker main fails before any GitHub or model call when the configured key variable is missing', (t) => {
  const f = fixture(t)
  for (const value of [undefined, '']) {
    const { result, observed } = f.launch({ DSHPX_FIXTURE_MODEL_KEY: value })
    assert.equal(result.status, 1)
    assert.match(observed.fatal, /API key is missing: set the DSHPX_FIXTURE_MODEL_KEY environment variable/)
    assert.deepEqual(observed.calls.gh, [])
    assert.deepEqual(observed.calls.app, [])
    assert.equal(observed.calls.model + observed.calls.git, 0)
    assert.equal(existsSync(f.queuePath), false)
  }
})
test('real worker main captures once and keeps unchanged quality monitors after artifact expiry or deletion', (t) => {
  const f = fixture(t)
  f.capture()
  const original = readFileSync(f.identity(), 'utf8')
  for (const artifact of ['expired', 'deleted']) {
    f.data.artifact = artifact
    const result = f.poll()
    assert.equal(result.processStatus, 0)
    assert.equal(result.calls.published.length, 0)
    assert.ok(!result.calls.gh.some((route: string) => route.includes('/artifacts')))
    assert.ok(result.calls.gh.some((route: string) => route.endsWith('/pulls/42')))
    assert.ok(result.calls.gh.some((route: string) => route.includes('/actions/workflows/5/runs')))
    assert.equal(result.calls.model + result.calls.git + result.calls.cacheReads, 0)
    assert.equal(result.queue['913-1'].monitorQuality.conclusion, 'success')
    assert.equal(readFileSync(f.identity(), 'utf8'), original)
  }
})

test('real main settles newer quality attempts without retaining the original artifact', (t) => {
  const f = fixture(t)
  f.capture()
  f.data.artifact = 'deleted'
  f.data.qualityAttempt = 2
  f.data.qualityStatus = 'in_progress'
  f.data.qualityConclusion = null
  let result = f.poll()
  assert.equal(result.processStatus, 0)
  assert.equal(result.queue['913-1'].complete, false)
  assert.equal(result.queue['913-1'].monitorQuality.runAttempt, 2)
  assert.equal(result.calls.published.at(-1).status, 'queued')
  f.data.qualityStatus = 'completed'
  f.data.qualityConclusion = 'failure'
  result = f.poll()
  assert.equal(result.queue['913-1'].monitorQuality.conclusion, 'failure')
  assert.equal(result.calls.published.at(-1).conclusion, 'failure')
  f.data.qualityAttempt = 3
  f.data.qualityConclusion = 'success'
  result = f.poll()
  assert.equal(result.processStatus, 0)
  assert.equal(result.queue['913-1'].monitorQuality.runAttempt, 3)
  assert.equal(result.queue['913-1'].monitorQuality.conclusion, 'success')
  assert.equal(result.calls.published.at(-1).conclusion, 'success')
  assert.equal(result.calls.model + result.calls.git, 0)
  assert.ok(!result.calls.gh.some((route: string) => route.includes('/artifacts')))
})

test('cached identity never skips live closed, changed-head or unknown PR admission', async (t) => {
  for (const scenario of ['closed', 'head-changed', 'unknown']) {
    await t.test(scenario, (t) => {
      const f = fixture(t)
      f.capture()
      f.data.artifact = 'deleted'
      if (scenario === 'head-changed') f.data.prHead = 'f'.repeat(40)
      else f.data.prState = scenario
      const result = f.poll(),
        current = result.queue['913-1']
      assert.equal(result.calls.model + result.calls.git + result.calls.cacheReads, 0)
      assert.ok(
        !result.calls.gh.some(
          (route: string) => route.includes('/artifacts') || route.includes('/actions/workflows/5/runs')
        )
      )
      if (scenario === 'unknown') {
        assert.equal(result.processStatus, 1)
        assert.equal(current.obsolete, undefined)
        assert.equal(current.complete, false)
      } else {
        assert.equal(result.processStatus, 0)
        assert.equal(
          current.obsoleteReason,
          scenario === 'closed' ? 'pull-request-closed' : 'head-superseded'
        )
        assert.equal(current.priorState.monitorQuality.conclusion, 'success')
        assert.equal(result.calls.published.length, 0)
      }
    })
  }
})

test('bad, wrong-repository and wrong-HEAD identities block stale green instead of being silently repaired', async (t) => {
  for (const scenario of ['bad-json', 'repository', 'head', 'run-head', 'request-run', 'base', 'kind']) {
    await t.test(scenario, (t) => {
      const f = fixture(t)
      f.capture()
      const stored = JSON.parse(readFileSync(f.identity(), 'utf8'))
      if (scenario === 'repository') stored.request.repository = 'wrong/repo'
      if (scenario === 'head') stored.request.head = 'f'.repeat(40)
      if (scenario === 'run-head') f.data.runHead = 'f'.repeat(40)
      if (scenario === 'request-run') stored.request.runId = 914
      if (scenario === 'base') stored.request.base = 'invalid-base'
      if (scenario === 'kind') stored.request.kind = 'push'
      const bytes = scenario === 'bad-json' ? '{' : JSON.stringify(stored)
      writeFileSync(f.identity(), bytes)
      f.data.artifact = 'present'
      const result = f.poll()
      assert.equal(result.processStatus, 1)
      assert.equal(result.queue['913-1'].complete, false)
      assert.ok(result.queue['913-1'].error)
      assert.equal(result.calls.published.at(-1).conclusion, 'failure')
      assert.equal(result.calls.model + result.calls.git + result.calls.cacheReads, 0)
      assert.ok(!result.calls.gh.some((route: string) => route.includes('/artifacts')))
      assert.equal(readFileSync(f.identity(), 'utf8'), bytes)
    })
  }
})

test('another workflow attempt cannot reuse a copied identity from an earlier attempt', (t) => {
  const f = fixture(t)
  f.capture()
  f.data.runAttempt = 2
  f.data.artifact = 'expired'
  mkdirSync(join(f.directory, 'jobs', '913-2'))
  copyFileSync(f.identity(), f.identity(2))
  const state = f.queue()
  state['913-2'] = { ...state['913-1'] }
  writeFileSync(f.queuePath, JSON.stringify(state))
  const result = f.poll()
  assert.equal(result.processStatus, 1)
  assert.equal(result.queue['913-2'].complete, false)
  assert.match(result.queue['913-2'].error, /provenance/)
  assert.equal(result.calls.published.at(-1).conclusion, 'failure')
  assert.equal(result.calls.model + result.calls.git, 0)
})

test('initial missing artifacts and legacy monitors without saved identity remain blocked', async (t) => {
  for (const legacy of [false, true]) {
    await t.test(legacy ? 'legacy-monitor' : 'first-request', (t) => {
      const f = fixture(t)
      if (legacy) {
        f.capture()
        rmSync(f.identity())
      }
      f.data.artifact = 'expired'
      const result = f.poll()
      assert.equal(result.processStatus, 1)
      assert.equal(result.queue['913-1'].complete, false)
      assert.match(result.queue['913-1'].error, /No trusted request identity/)
      assert.equal(existsSync(f.identity()), false)
      assert.equal(result.calls.model + result.calls.git + result.calls.cacheReads, 0)
      if (legacy) assert.equal(result.calls.published.at(-1).conclusion, 'failure')
      else assert.equal(result.calls.published.length, 0)
    })
  }
})

test('explicit source rerun still requires source review even when request identity survives expiry', (t) => {
  const f = fixture(t)
  f.capture()
  f.data.artifact = 'deleted'
  f.data.rerun = true
  const result = f.poll()
  assert.equal(result.processStatus, 1, 'the fixture forbids actual Git/model execution')
  assert.ok(
    result.calls.git > 0,
    'request metadata cannot stand in for an independently reviewed source verdict'
  )
  assert.equal(result.queue['913-1'].complete, false)
  assert.ok(!result.calls.gh.some((route: string) => route.includes('/artifacts')))
})

test('a live base change cannot use the unchanged monitor shortcut or mutate the captured original base', (t) => {
  const f = fixture(t)
  f.capture()
  const captured = readFileSync(f.identity(), 'utf8')
  f.data.artifact = 'expired'
  f.data.base = 'e'.repeat(40)
  const result = f.poll()
  assert.equal(
    result.processStatus,
    1,
    'fresh source work is required and deliberately blocked by this fixture'
  )
  assert.ok(result.calls.git > 0)
  assert.equal(result.queue['913-1'].complete, false)
  assert.equal(readFileSync(f.identity(), 'utf8'), captured)
  assert.ok(!result.calls.gh.some((route: string) => route.includes('/artifacts')))
})
