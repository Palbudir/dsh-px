import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const load = (name: string): Promise<any> => import(pathToFileURL(resolve('scripts', name)).href)
const core = await load('review-core.mjs')
const model = await load('review-model.mjs')
const { runReviewBatch, REVIEW_PROMPT } = await load('review-process.mjs')
const { INSTALLED_SCRIPT } = await load('review-install.mjs')

const head = 'a'.repeat(40),
  base = 'b'.repeat(40),
  request = { head, base }
const SECRET = 'sk-fixture-secret-value-0123456789'
const KEY_ENV = 'DSHPX_REVIEW_FIXTURE_KEY'
const config = {
  model: {
    provider: 'deepseek',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: KEY_ENV
  },
  timeoutMs: 900000
}
const batch = core.splitBatches([{ path: 'fixture.ts', before: 'old\n', after: 'new\n' }], 'context')[0]
const verdict = (extra: Record<string, unknown> = {}) => ({
  head,
  base,
  batchId: batch.id,
  verdict: 'pass',
  summary: 'Reviewed',
  findings: [],
  blockers: [],
  ...extra
})
const completion = (content: unknown, choice: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'fixture',
    object: 'chat.completion',
    model: 'deepseek-flash',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          reasoning_content: 'fixture reasoning',
          content: typeof content === 'string' ? content : JSON.stringify(content)
        },
        ...choice
      }
    ]
  })
const reply = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers })

function workspace(t: TestContext) {
  const parent = realpathSync(tmpdir()),
    directory = mkdtempSync(join(parent, 'dshpx-review-model-'))
  t.after(() => {
    assert.ok(resolve(directory).startsWith(parent + sep))
    rmSync(directory, { recursive: true, force: true })
  })
  const traces = () =>
    readdirSync(directory)
      .filter((name) => name.endsWith('.trace.jsonl'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n')
  return { directory, traces }
}
function scripted(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: any }> = []
  const fetch = async (url: string, init: any) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error('unexpected extra request')
    if (next instanceof Error) throw next
    return next
  }
  return { calls, fetch }
}
const options = (fetch: unknown, extra: Record<string, unknown> = {}) => ({
  fetch,
  env: { [KEY_ENV]: SECRET },
  sleep: async () => {},
  ...extra
})

test('review-model is part of the installed worker script set and its digest', () => {
  assert.ok(INSTALLED_SCRIPT.test('review-model.mjs'))
})

test('without a tool context the request uses the configured model, JSON output, high-effort thinking, the documented max_tokens and no tools; key only in the header', async (t) => {
  const w = workspace(t)
  const api = scripted([reply(200, completion(verdict()))])
  const value = await runReviewBatch(config, request, batch, w.directory, options(api.fetch))
  assert.equal(value.verdict, 'pass')
  assert.equal(api.calls.length, 1)
  const [{ url, init }] = api.calls
  assert.equal(url, 'https://api.deepseek.com/chat/completions')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.Authorization, `Bearer ${SECRET}`)
  const body = JSON.parse(init.body)
  assert.equal(body.model, 'deepseek-flash')
  assert.deepEqual(body.response_format, { type: 'json_object' })
  assert.deepEqual(body.thinking, { type: 'enabled' })
  assert.equal(body.reasoning_effort, 'high')
  assert.equal(body.max_tokens, 393216)
  assert.equal(model.MODEL_MAX_TOKENS, 393216)
  assert.equal(body.stream, false)
  for (const forbidden of ['tools', 'tool_choice', 'functions', 'function_call'])
    assert.equal(forbidden in body, false, forbidden)
  assert.ok(!init.body.includes(SECRET), 'key never enters the request body')
  const [system, user] = body.messages
  assert.equal(system.role, 'system')
  assert.ok(system.content.startsWith(REVIEW_PROMPT))
  assert.ok(system.content.includes(JSON.stringify(core.reviewSchema)))
  assert.match(system.content, /json/)
  assert.equal(user.role, 'user')
  assert.ok(user.content.includes(`"batchId":"${batch.id}"`))
  assert.ok(user.content.includes(`<untrusted-source>\n${batch.text}\n</untrusted-source>`))
  const trace = w.traces()
  assert.match(trace, /"status":200/)
  assert.ok(!trace.includes(SECRET))
})

test('the key is read only from the configured variable; a missing key fails before any request', async (t) => {
  const w = workspace(t)
  const api = scripted([])
  for (const env of [{}, { DEEPSEEK_API_KEY: SECRET }, { [KEY_ENV]: '   ' }])
    await assert.rejects(
      runReviewBatch(config, request, batch, w.directory, options(api.fetch, { env })),
      new RegExp(`API key is missing: set the ${KEY_ENV}`)
    )
  assert.equal(api.calls.length, 0)
  assert.throws(() => model.readApiKey(model.installedModel(config), {}), /DSHPX_REVIEW_FIXTURE_KEY/)
})

test('429, 5xx and network errors retry with bounded exponential backoff, then succeed', async (t) => {
  const w = workspace(t)
  const delays: number[] = []
  const api = scripted([
    reply(429, '{"error":"rate"}'),
    reply(503, 'overloaded'),
    new TypeError('fetch failed'),
    reply(200, completion(verdict()))
  ])
  const value = await runReviewBatch(
    config,
    request,
    batch,
    w.directory,
    options(api.fetch, { sleep: async (ms: number) => void delays.push(ms) })
  )
  assert.equal(value.verdict, 'pass')
  assert.equal(api.calls.length, 4)
  assert.deepEqual(delays, [2000, 4000, 8000])
  // Two HTTP responses plus their retry errors, one network error, one final response.
  assert.equal(w.traces().trim().split('\n').length, 6, 'every attempt and error is traced')
  const retryAfter = scripted([reply(429, '', { 'retry-after': '3' }), reply(200, completion(verdict()))])
  const waits: number[] = []
  await runReviewBatch(
    config,
    request,
    batch,
    w.directory,
    options(retryAfter.fetch, { sleep: async (ms: number) => void waits.push(ms) })
  )
  assert.deepEqual(waits, [3000])
})

test('retries are finite: persistent 5xx fails closed after the attempt limit', async (t) => {
  const w = workspace(t)
  const api = scripted(Array.from({ length: model.MODEL_MAX_ATTEMPTS }, () => reply(500, 'down')))
  await assert.rejects(
    runReviewBatch(config, request, batch, w.directory, options(api.fetch)),
    /failed after retries: Review model HTTP 500/
  )
  assert.equal(api.calls.length, model.MODEL_MAX_ATTEMPTS)
})

test('git/gh child environments never carry the model key variable', async () => {
  const { childEnvironment } = await load('review-process.mjs')
  const env = childEnvironment(
    { PATH: 'p', DEEPSEEK_API_KEY: SECRET, [KEY_ENV]: SECRET, deepseek_api_key: SECRET, KEEP: '1' },
    [KEY_ENV]
  )
  assert.deepEqual(Object.keys(env).sort(), ['KEEP', 'PATH'])
})

test('redirects are refused and oversized responses fail closed without buffering them', async (t) => {
  const w = workspace(t)
  const redirected = scripted([reply(302, '', { location: 'https://elsewhere.example/' })])
  await assert.rejects(runReviewBatch(config, request, batch, w.directory, options(redirected.fetch)))
  assert.equal(redirected.calls[0].init.redirect, 'error')
  const declared = scripted([reply(200, 'x', { 'content-length': String(model.MAX_RESPONSE_BYTES + 1) })])
  await assert.rejects(
    runReviewBatch(config, request, batch, w.directory, options(declared.fetch)),
    /exceeds size limit/
  )
  assert.equal(declared.calls.length, 1)
  const huge = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024))
    }
  })
  const streamed = scripted([new Response(huge, { status: 200 })])
  await assert.rejects(
    runReviewBatch(config, request, batch, w.directory, options(streamed.fetch)),
    /exceeds size limit/
  )
  assert.equal(streamed.calls.length, 1)
})

test('the configured timeout bounds the whole invocation and is not retried', async (t) => {
  const w = workspace(t)
  let calls = 0
  const hanging = (_url: string, init: any) =>
    new Promise((_resolve, reject) => {
      calls++
      init.signal.addEventListener('abort', () => reject(init.signal.reason))
    })
  await assert.rejects(
    runReviewBatch({ ...config, timeoutMs: 30 }, request, batch, w.directory, options(hanging)),
    /timed out/
  )
  assert.equal(calls, 1)
})

test('other 4xx responses fail immediately and never leak the key into errors or trace', async (t) => {
  const w = workspace(t)
  for (const status of [400, 401, 402, 422]) {
    const api = scripted([reply(status, `{"error":{"message":"bad key ${SECRET}"}}`)])
    const error = await runReviewBatch(config, request, batch, w.directory, options(api.fetch)).then(
      () => assert.fail('must reject'),
      (e: Error) => e
    )
    assert.match(error.message, new RegExp(`HTTP ${status}`))
    assert.ok(!error.message.includes(SECRET))
    assert.equal(api.calls.length, 1, `HTTP ${status} is not retried`)
  }
  assert.ok(!w.traces().includes(SECRET))
})

test('non-JSON, schema violations, identity mismatch, incomplete finishes and tool calls without a tool context fail closed', async (t) => {
  const w = workspace(t)
  const cases: Array<[string, RegExp]> = [
    ['<html>gateway</html>', /non-JSON API response/],
    [completion(''), /empty content/],
    // Only empty undeclared keys are dropped (see review-tools.test.ts); one with content is refused.
    [completion(verdict({ extra: true })), /does not match the review schema/],
    [completion(verdict({ verdict: 'approved' })), /does not match the review schema/],
    [completion(verdict({ findings: [{ priority: '1' }] })), /does not match the review schema/],
    [
      completion(verdict({ findings: [{ priority: 4, path: 'a', line: 1, title: 'x', detail: 'y' }] })),
      /does not match the review schema/
    ],
    [completion({ ...verdict(), blockers: undefined }), /does not match the review schema/],
    // A mistyped head/base/batchId echo is corrected by the worker (see the identity test below).
    [completion(verdict(), { finish_reason: 'content_filter' }), /did not complete/],
    [completion(verdict(), { finish_reason: 'insufficient_system_resource' }), /did not complete/],
    [
      completion(verdict(), {
        message: {
          role: 'assistant',
          content: JSON.stringify(verdict()),
          tool_calls: [{ id: '1', type: 'function', function: { name: 'shell', arguments: '{}' } }]
        }
      }),
      /forbidden capability/
    ],
    [JSON.stringify({ choices: [] }), /no single choice/]
  ]
  for (const [body, expected] of cases) {
    // A schema-violating answer gets one formatting turn; repeating the same answer fails closed.
    const schema = String(expected) === String(/does not match the review schema/)
    const api = scripted(schema ? [reply(200, body), reply(200, body)] : [reply(200, body)])
    await assert.rejects(
      runReviewBatch(config, request, batch, w.directory, options(api.fetch)),
      expected,
      body.slice(0, 80)
    )
    assert.equal(api.calls.length, schema ? 2 : 1, 'invalid output is never retried into a pass')
  }
})

test('invalid JSON gets one tool-free formatting turn; the re-emitted answer is validated as usual', async (t) => {
  const w = workspace(t)
  // A real answer closed its string array with '}' instead of ']'.
  const broken = JSON.stringify(verdict({ blockers: ['needs x'] })).replace('"needs x"]', '"needs x"}]')
  const repaired = scripted([
    reply(200, completion(broken)),
    reply(200, completion(verdict({ blockers: ['needs x'] })))
  ])
  const value = await runReviewBatch(config, request, batch, w.directory, options(repaired.fetch))
  assert.deepEqual(value.blockers, ['needs x'])
  assert.equal(repaired.calls.length, 2)
  const second = JSON.parse(repaired.calls[1].init.body)
  assert.match(
    second.messages.at(-1).content,
    /not valid JSON.*Do not call tools and do not change your review/s
  )
  assert.equal(second.messages.at(-2).content, broken, 'the malformed answer is shown back verbatim')
  const evidence = JSON.parse(readFileSync(join(w.directory, `${batch.id}.evidence.json`), 'utf8'))
  assert.equal(evidence.attempts.at(-1).formatRepaired, true)
  // Still invalid after the one formatting turn: fail closed, no third request.
  const hopeless = scripted([
    reply(200, completion('not json at all')),
    reply(200, completion('still not json'))
  ])
  await assert.rejects(
    runReviewBatch(config, request, batch, w.directory, options(hopeless.fetch)),
    /not valid JSON/
  )
  assert.equal(hopeless.calls.length, 2)
  // The formatting turn cannot be used to reach tools.
  const sneaky = scripted([
    reply(200, completion('{')),
    reply(
      200,
      completion(verdict(), {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: '1', type: 'function', function: { name: 'list', arguments: '{}' } }]
        }
      })
    )
  ])
  await assert.rejects(runReviewBatch(config, request, batch, w.directory, options(sneaky.fetch)))
  // A schema-invalid re-emission is still rejected.
  const invalid = scripted([
    reply(200, completion('{')),
    reply(200, completion(verdict({ verdict: 'approved' })))
  ])
  await assert.rejects(
    runReviewBatch(config, request, batch, w.directory, options(invalid.fetch)),
    /does not match the review schema/
  )
})

test('the worker, not the model, owns the commit and batch identity of an answer', async (t) => {
  const w = workspace(t)
  // A real answer once copied the base SHA with two characters wrong.
  const typo = 'b'.repeat(13) + 'db' + 'b'.repeat(25)
  for (const extra of [{ head: 'c'.repeat(40) }, { base: typo }, { batchId: 'other' }]) {
    const api = scripted([reply(200, completion(verdict(extra)))])
    const value = await runReviewBatch(config, request, batch, w.directory, options(api.fetch))
    assert.equal(value.head, request.head)
    assert.equal(value.base, request.base)
    assert.equal(value.batchId, batch.id)
    const evidence = JSON.parse(readFileSync(join(w.directory, `${batch.id}.evidence.json`), 'utf8'))
    assert.deepEqual(evidence.attempts.at(-1).identityCorrected, Object.keys(extra))
  }
  // A non-string identity is still a schema violation, and the verdict stays the model's.
  const wrongType = scripted([
    reply(200, completion(verdict({ head: 1 }))),
    reply(200, completion(verdict({ head: 1 })))
  ])
  await assert.rejects(
    runReviewBatch(config, request, batch, w.directory, options(wrongType.fetch)),
    /does not match the review schema/
  )
  const failing = scripted([reply(200, completion(verdict({ base: typo, verdict: 'fail' })))])
  assert.equal(
    (await runReviewBatch(config, request, batch, w.directory, options(failing.fetch))).verdict,
    'fail'
  )
})

test('only https base URLs and normalized installed model records are accepted', () => {
  assert.deepEqual(model.modelSettings({}), {
    provider: 'deepseek',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY'
  })
  assert.equal(
    model.modelSettings({ baseUrl: 'https://proxy.example/v1/' }).baseUrl,
    'https://proxy.example/v1'
  )
  for (const baseUrl of [
    'http://api.deepseek.com',
    'ftp://api.deepseek.com',
    'file:///C:/key',
    'not a url',
    'https://user:pass@api.deepseek.com',
    'https://api.deepseek.com/?key=x'
  ])
    assert.throws(() => model.modelSettings({ baseUrl }), /base URL/, baseUrl)
  assert.throws(() => model.modelSettings({ apiKeyEnv: 'GITHUB_TOKEN' }), /GitHub/)
  assert.throws(() => model.modelSettings({ apiKeyEnv: 'BAD-NAME' }), /environment variable/)
  assert.throws(() => model.modelSettings({ provider: 'openai' }), /provider/)
  assert.throws(() => model.installedModel({}), /reinstall/)
  assert.throws(() => model.installedModel({ codexOverrides: [] }), /reinstall/)
  assert.throws(
    () => model.installedModel({ model: { ...config.model, baseUrl: 'http://api.deepseek.com' } }),
    /https/
  )
  assert.throws(() => model.installedModel({ model: { ...config.model, apiKey: SECRET } }), /not normalized/)
  assert.deepEqual(model.modelIdentity(config), {
    provider: 'deepseek',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com'
  })
})
