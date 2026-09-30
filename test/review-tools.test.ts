import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const load = (name: string): Promise<any> => import(pathToFileURL(resolve('scripts', name)).href)
const core = await load('review-core.mjs')
const tools = await load('review-tools.mjs')
const { runReviewBatch, REVIEW_PROMPT } = await load('review-process.mjs')
const { reviewBatches } = await load('review-worker.mjs')
const { scanText, maskSecrets } = await load('check-secrets.mjs')

const head = 'a'.repeat(40),
  base = 'b'.repeat(40),
  mergeBase = 'c'.repeat(40)
const request = { head, base, mergeBase }
const KEY_ENV = 'DSHPX_REVIEW_TOOLS_FIXTURE_KEY'
const config = {
  model: {
    provider: 'deepseek',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: KEY_ENV
  },
  timeoutMs: 60000
}
// Assembled at runtime so this fixture never contains a literal credential.
const TOKEN = 'gh' + 'p_' + 'R'.repeat(36)
const PERSONAL = 'C:\\Users\\' + 'mallory' + '\\AppData\\x'

function memory(trees: Record<string, Record<string, string | Buffer | { text: string; mode: string }>>) {
  const inventory = new Map<string, any[]>(),
    blobs = new Map<string, Buffer>(),
    reads: string[] = []
  for (const [ref, tree] of Object.entries(trees))
    inventory.set(
      ref,
      Object.entries(tree).map(([path, value]) => {
        const structured = typeof value === 'object' && !Buffer.isBuffer(value)
        const bytes = Buffer.isBuffer(value)
          ? value
          : Buffer.from(structured ? value.text : (value as string))
        blobs.set(ref + ':' + path, bytes)
        return {
          path,
          mode: structured ? value.mode : '100644',
          type: 'blob',
          size: bytes.length,
          oid: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
        }
      })
    )
  return {
    reads,
    list: async (ref: string) => inventory.get(ref) ?? [],
    read: async (ref: string, path: string) => {
      reads.push(ref + ':' + path)
      return blobs.get(ref + ':' + path)!
    }
  }
}
const numbered = (n: number, tag = 'line') =>
  Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n') + '\n'
const fixture = () =>
  memory({
    [head]: {
      'src/app.ts': "import { helper } from './helper'\nexport const app = helper()\n",
      'src/helper.ts': 'export const helper = () => 42\n',
      'src/big.ts': numbered(2000),
      'src/leak.ts': `export const ok = 1\nconst token = '${TOKEN}'\n`,
      'docs/guide.md': '# Guide\nhelper usage\n',
      'bin.dat': Buffer.from([0, 1, 2, 3]),
      '.env': 'KEY=1',
      link: { text: 'src/app.ts', mode: '120000' }
    },
    [base]: {
      'src/helper.ts': 'export const helper = () => 41\n',
      'src/legacy.ts': `export const home = '${PERSONAL}'\n`
    },
    [mergeBase]: {
      'src/helper.ts': 'export const helper = () => 40\n',
      'src/legacy.ts': `export const home = '${PERSONAL}'\n`
    }
  })
const upstream = () => {
  const file = (path: string, text: string, slice?: any) => ({
    path,
    text,
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: text.length,
    ...(slice ? { slice } : {})
  })
  const pkg = {
    name: '@deepseek-ai/dsh-client-connection',
    version: '0.2.0-rc.1',
    integrity: 'sha512-' + 'A'.repeat(86) + '==',
    files: [
      file('lib/types/index.d.ts', 'export interface A {}\nexport interface B {}\n'),
      file('lib/index.js', 'x\ny\nz', { fromLine: 10, toLine: 12, anchor: 'y' })
    ]
  }
  return {
    lockDigest: 'f'.repeat(64),
    services: {},
    manifest: [],
    hosts: new Map([['0.2.0-rc.1', new Map([[pkg.name, pkg]])]])
  }
}
const session = (reader = fixture(), limits?: any) =>
  tools.createReviewTools({
    request,
    reader,
    scan: scanText,
    mask: maskSecrets,
    upstream: upstream(),
    limits
  })
/** Tool content without its trailing remaining-budget line. */
const strip = (content: string) => content.replace(/\n\[budget: \d+\/\d+ calls, \d+\/\d+ bytes left\]$/, '')
const call = (name: string, args: unknown, id = 'call-' + Math.random().toString(16).slice(2)) => ({
  id,
  type: 'function',
  function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }
})

test('read_file returns numbered head/base/mergeBase blobs within line and byte limits', async () => {
  const s = session()
  const headRead = await s.execute(call('read_file', { ref: 'head', path: 'src/helper.ts' }))
  assert.match(
    strip(headRead.content),
    /^FILE "src\/helper.ts" ref=head \(a{40}\) oid=[a-f0-9]{40} lines 1-1\/1\n1 export const helper = \(\) => 42$/
  )
  assert.match((await s.execute(call('read_file', { ref: 'base', path: 'src/helper.ts' }))).content, /=> 41/)
  assert.match(
    (await s.execute(call('read_file', { ref: 'mergeBase', path: 'src/helper.ts' }))).content,
    /=> 40/
  )
  const range = await s.execute(
    call('read_file', { ref: 'head', path: 'src/big.ts', startLine: 1500, endLine: 1502 })
  )
  assert.deepEqual(strip(range.content).split('\n').slice(1), [
    '1500 line 1500',
    '1501 line 1501',
    '1502 line 1502'
  ])
  const capped = await s.execute(call('read_file', { ref: 'head', path: 'src/big.ts' }))
  assert.equal(strip(capped.content).split('\n').length, 1 + tools.TOOL_LIMITS.maxLines)
  assert.ok(
    strip(capped.content).endsWith(`${tools.TOOL_LIMITS.maxLines} line ${tools.TOOL_LIMITS.maxLines}`)
  )
  assert.equal(s.records.length, 5)
  assert.ok(s.records.every((r: any) => r.outcome === 'ok' && /^[a-f0-9]{64}$/.test(r.sha256)))
  assert.equal(s.records[0].sha256, createHash('sha256').update(headRead.content).digest('hex'))
  assert.equal(s.records[0].bytes, Buffer.byteLength(headRead.content))
})

test('invalid refs, paths, ranges, patterns and arguments are rejected without reading or executing anything', async () => {
  const reader = fixture()
  const s = session(reader)
  const cases: Array<[string, unknown, RegExp]> = [
    ['read_file', { ref: 'HEAD~1', path: 'src/app.ts' }, /ref must be one of/],
    ['read_file', { ref: 'origin/master', path: 'src/app.ts' }, /ref must be one of/],
    ['read_file', { ref: 'head', path: '../outside' }, /Unsafe/],
    ['read_file', { ref: 'head', path: '/etc/passwd' }, /Unsafe/],
    ['read_file', { ref: 'head', path: 'C:/Windows/win.ini' }, /Unsafe/],
    ['read_file', { ref: 'head', path: 'src\\app.ts' }, /Unsafe/],
    ['read_file', { ref: 'head', path: '.env' }, /Private or generated/],
    ['read_file', { ref: 'head', path: 'node_modules/x/index.js' }, /Private or generated/],
    ['read_file', { ref: 'head', path: 'runtime/dsh/a.js' }, /Private or generated/],
    ['read_file', { ref: 'head', path: 'build-test/a.js' }, /Private or generated/],
    ['read_file', { ref: 'head', path: 'keys/app.pem' }, /Private or generated/],
    ['read_file', { ref: 'head', path: 'link' }, /not a regular file/],
    ['read_file', { ref: 'head', path: 'bin.dat' }, /binary/],
    ['read_file', { ref: 'head', path: 'src/absent.ts' }, /not present/],
    ['read_file', { ref: 'head', path: 'src/app.ts', startLine: 0 }, /positive integer/],
    ['read_file', { ref: 'head', path: 'src/app.ts', startLine: 1.5 }, /positive integer/],
    ['read_file', { ref: 'head', path: 'src/app.ts', startLine: 99 }, /beyond the last line/],
    ['read_file', { ref: 'head', path: 'src/app.ts', startLine: 2, endLine: 1 }, /must not precede/],
    ['read_file', { ref: 'head', path: 'src/app.ts', command: 'rm -rf /' }, /unknown argument/],
    ['search', { ref: 'head', pattern: 'x' }, /literal string of 2-200/],
    ['search', { ref: 'head', pattern: 'a'.repeat(201) }, /literal string/],
    ['search', { ref: 'head', pattern: 'a\nb' }, /single-line/],
    ['search', { ref: 'head', pattern: 'helper', pathPrefix: '../' }, /Unsafe/],
    ['list', { ref: 'head', dir: 'node_modules' }, /Private or generated/],
    ['list', { ref: 'head', dir: 'nowhere' }, /not a directory/],
    ['read_upstream', { host: '9.9.9', package: 'x', path: 'y' }, /host must be one of/],
    ['read_upstream', { host: '0.2.0-rc.1', package: 'react', path: 'index.js' }, /package must be one of/],
    [
      'read_upstream',
      { host: '0.2.0-rc.1', package: '@deepseek-ai/dsh-client-connection', path: 'lib/secret.js' },
      /allowlist/
    ],
    ['shell', { command: 'whoami' }, /unknown tool/],
    ['write_file', { path: 'a', content: 'b' }, /unknown tool/],
    ['read_file', '{not json', /not valid JSON/],
    ['read_file', '[1,2]', /JSON object/]
  ]
  for (const [name, args, expected] of cases) {
    const result = await s.execute(call(name, args))
    assert.match(result.content, /^ERROR: /, name)
    assert.match(result.content, expected, JSON.stringify(args))
    assert.equal(s.records.at(-1).outcome, 'rejected')
  }
  assert.ok(!reader.reads.some((read) => /\.env|node_modules|runtime|build-test|pem|link|outside/.test(read)))
  // A regular-expression pattern is searched as a literal string, never compiled.
  const literal = await s.execute(call('search', { ref: 'head', pattern: '(.*)+$' }))
  assert.match(literal.content, /matches=0/)
})

test('search and list return bounded, ref-bound inventories', async () => {
  const s = session()
  const found = await s.execute(call('search', { ref: 'head', pattern: 'helper' }))
  assert.deepEqual(strip(found.content).split('\n').slice(1), [
    'docs/guide.md:2:helper usage',
    "src/app.ts:1:import { helper } from './helper'",
    'src/app.ts:2:export const app = helper()',
    'src/helper.ts:1:export const helper = () => 42'
  ])
  assert.match(found.content, /filesSkipped=2/, 'the binary file and the link are skipped, not decoded')
  const scoped = await s.execute(call('search', { ref: 'mergeBase', pattern: 'helper', pathPrefix: 'src' }))
  assert.deepEqual(strip(scoped.content).split('\n').slice(1), [
    'src/helper.ts:1:export const helper = () => 40'
  ])
  const limited = session(fixture(), { ...tools.TOOL_LIMITS, maxSearchResults: 3 })
  const truncated = await limited.execute(call('search', { ref: 'head', pattern: 'line 1' }))
  assert.match(truncated.content, /matches=3 \(truncated/)
  const listed = await s.execute(call('list', { ref: 'head', dir: '' }))
  assert.deepEqual(strip(listed.content).split('\n').slice(1), [
    'bin.dat\t4 bytes',
    'docs/',
    'link\t10 bytes',
    'src/'
  ])
  assert.ok(!listed.content.includes('.env'), 'private names are not listed')
  const src = await s.execute(call('list', { ref: 'head', dir: 'src' }))
  assert.match(src.content, /^helper\.ts\t31 bytes$/m)
})

test('read_upstream returns only locked, SRI-identified files with upstream line numbers', async () => {
  const s = session()
  const full = await s.execute(
    call('read_upstream', {
      host: '0.2.0-rc.1',
      package: '@deepseek-ai/dsh-client-connection',
      path: 'lib/types/index.d.ts',
      startLine: 2
    })
  )
  assert.match(
    strip(full.content),
    /^UPSTREAM \{"package":"@deepseek-ai\/dsh-client-connection","host":"0.2.0-rc.1","version":"0.2.0-rc.1","integrity":"sha512-A{86}==","path":"lib\/types\/index.d.ts","sha256":"[a-f0-9]{64}"\} lines 2-2\n2 export interface B \{\}$/
  )
  const slice = await s.execute(
    call('read_upstream', {
      host: '0.2.0-rc.1',
      package: '@deepseek-ai/dsh-client-connection',
      path: 'lib/index.js'
    })
  )
  assert.deepEqual(strip(slice.content).split('\n').slice(1), ['10 x', '11 y', '12 z'])
  const outside = await s.execute(
    call('read_upstream', {
      host: '0.2.0-rc.1',
      package: '@deepseek-ai/dsh-client-connection',
      path: 'lib/index.js',
      startLine: 2
    })
  )
  assert.match(outside.content, /slice covering lines 10-12/)
  assert.equal(s.records[0].role, 'upstream')
  assert.deepEqual(s.records[0].sources[0].upstream.host, '0.2.0-rc.1')
})

test('a secret in candidate (head) tool output fails closed with its location; merged content is masked', async () => {
  const s = session()
  await assert.rejects(s.execute(call('read_file', { ref: 'head', path: 'src/leak.ts' })), (error: any) => {
    assert.ok(error instanceof tools.ReviewSecretFound)
    assert.deepEqual(error.findings, [
      { path: 'src/leak.ts', line: 2, rule: 'github-token' },
      { path: 'src/leak.ts', line: 2, rule: 'assigned-secret' }
    ])
    assert.ok(!JSON.stringify(error.findings).includes(TOKEN) && !error.message.includes(TOKEN))
    return true
  })
  assert.equal(s.records.at(-1).outcome, 'secret-blocked')
  // A head search hit reports the real line number as well.
  await assert.rejects(s.execute(call('search', { ref: 'head', pattern: 'const token' })), (error: any) =>
    error.findings.some((f: any) => f.path === 'src/leak.ts' && f.line === 2)
  )
  // The whole blob is scanned once: a line range that avoids the secret still stops the review.
  await assert.rejects(
    s.execute(call('read_file', { ref: 'head', path: 'src/leak.ts', endLine: 1 })),
    tools.ReviewSecretFound
  )
  for (const ref of ['base', 'mergeBase']) {
    const merged = await s.execute(call('read_file', { ref, path: 'src/legacy.ts' }))
    assert.ok(!merged.content.includes('mallory'), ref)
    assert.match(merged.content, /Users\\\*+\\AppData/)
    assert.equal(s.records.at(-1).outcome, 'masked')
    assert.equal(scanText('masked', merged.content).length, 0)
  }
  // A model-supplied pattern echoed in the header is masked too, never returned verbatim.
  const echoed = await s.execute(call('search', { ref: 'base', pattern: TOKEN }))
  assert.ok(!echoed.content.includes(TOKEN))
})

test('a private key body cannot be read by line range: head blocks, merged content is masked as a whole', async () => {
  const pem = [
    '-----BEGIN ' + 'PRIVATE KEY-----',
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC' + 'Q'.repeat(12),
    'KEYBODYSECONDLINE' + 'Z'.repeat(40),
    '-----END ' + 'PRIVATE KEY-----',
    'export const after = 1'
  ].join('\n')
  const reader = memory({
    [head]: { 'fixtures/key.txt': pem },
    [base]: { 'fixtures/key.txt': pem },
    [mergeBase]: {}
  })
  const s = session(reader)
  await assert.rejects(
    s.execute(call('read_file', { ref: 'head', path: 'fixtures/key.txt', startLine: 2, endLine: 3 })),
    (error: any) => error.findings.some((f: any) => f.line === 1 && f.rule === 'private-key')
  )
  await assert.rejects(
    s.execute(call('search', { ref: 'head', pattern: 'KEYBODY' })),
    tools.ReviewSecretFound
  )
  const merged = await s.execute(
    call('read_file', { ref: 'base', path: 'fixtures/key.txt', startLine: 2, endLine: 5 })
  )
  assert.ok(!merged.content.includes('KEYBODY') && !merged.content.includes('MIIEv'))
  assert.match(strip(merged.content), /\n2 \*+\n3 \*+\n4 \*+\n5 export const after = 1$/)
  // Search runs on the masked text, so a masked key body cannot be confirmed by a match count.
  for (const probe of ['KEYBODY', 'MIIEvQIBADAN', 'ZZZZ']) {
    const found = await s.execute(call('search', { ref: 'base', pattern: probe }))
    assert.match(strip(found.content), /matches=0\b|no matches/i, `probe ${probe} must not match`)
    assert.ok(!found.content.includes('fixtures/key.txt'), `probe ${probe} must not name the file`)
  }
  const visible = await s.execute(call('search', { ref: 'base', pattern: 'export const after' }))
  assert.match(visible.content, /fixtures\/key.txt:5:export const after = 1/)
})

test('forbidden credential paths are neither readable nor listed', async () => {
  const reader = memory({
    [head]: {
      'cfg/.npmrc': 'x',
      'cfg/.netrc': 'x',
      'cfg/id_rsa': 'x',
      'cfg/id_ed25519.pub': 'x',
      'cfg/app.keystore': 'x',
      'cfg/app.jks': 'x',
      'cfg/ok.json': '{}'
    },
    [base]: {},
    [mergeBase]: {}
  })
  const s = session(reader)
  for (const path of [
    'cfg/.npmrc',
    'cfg/.netrc',
    'cfg/id_rsa',
    'cfg/id_ed25519.pub',
    'cfg/app.keystore',
    'cfg/app.jks'
  ])
    assert.match(
      (await s.execute(call('read_file', { ref: 'head', path }))).content,
      /^ERROR: Private or generated/,
      path
    )
  assert.deepEqual(
    strip((await s.execute(call('list', { ref: 'head', dir: 'cfg' }))).content)
      .split('\n')
      .slice(1),
    ['ok.json\t2 bytes']
  )
  assert.deepEqual(reader.reads, [])
})

test('call and byte budgets are enforced per batch and each result reports the remaining budget', async () => {
  const s = session(fixture(), { ...tools.TOOL_LIMITS, maxCalls: 2 })
  await s.execute(call('list', { ref: 'head', dir: 'src' }))
  await s.execute(call('list', { ref: 'head', dir: 'src' }))
  await assert.rejects(s.execute(call('list', { ref: 'head', dir: 'src' })), tools.ToolBudgetExceeded)
  assert.equal(s.records.at(-1).outcome, 'budget-exceeded')
  const bytes = session(fixture(), { ...tools.TOOL_LIMITS, maxTotalBytes: 12000 })
  await bytes.execute(call('read_file', { ref: 'head', path: 'src/big.ts', endLine: 700 }))
  await assert.rejects(
    bytes.execute(call('read_file', { ref: 'head', path: 'src/big.ts', startLine: 701, endLine: 1400 })),
    /result budget exhausted \(12000 bytes/
  )
  const perCall = session(fixture(), { ...tools.TOOL_LIMITS, maxCallBytes: 2000 })
  const cut = await perCall.execute(call('read_file', { ref: 'head', path: 'src/big.ts' }))
  assert.ok(Buffer.byteLength(cut.content) <= 2000)
  assert.match(strip(cut.content), /\[truncated at line \d+; continue with startLine=\d+\]$/)
})

// ---- Model loop with tools (injected fetch; no real API calls) ----

function workspace(t: TestContext) {
  const parent = realpathSync(tmpdir()),
    directory = mkdtempSync(join(parent, 'dshpx-review-tools-'))
  t.after(() => {
    assert.ok(resolve(directory).startsWith(parent + sep))
    rmSync(directory, { recursive: true, force: true })
  })
  const read = (suffix: string) =>
    readdirSync(directory)
      .filter((name) => name.endsWith(suffix))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
  return { directory, read }
}
const completion = (message: Record<string, unknown>, finish = 'stop') =>
  new Response(
    JSON.stringify({
      id: 'x',
      object: 'chat.completion',
      choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', ...message } }]
    }),
    { status: 200 }
  )
const verdict = (batchId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    head,
    base,
    batchId,
    verdict: 'pass',
    summary: 'ok',
    findings: [],
    blockers: [],
    ...extra
  })
function scripted(responses: Array<Response | ((body: any) => Response)>) {
  const bodies: any[] = []
  const fetch = async (_url: string, init: any) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    const next = responses.shift()
    if (!next) throw new Error('unexpected extra request')
    return typeof next === 'function' ? next(body) : next
  }
  return { bodies, fetch }
}
const toolCall = (id: string, name: string, args: unknown) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
})
const options = (fetch: unknown, reader = fixture(), limits?: any) => ({
  fetch,
  env: { [KEY_ENV]: 'sk-fixture-tools-key-0123456789abcdef' },
  sleep: async () => {},
  tools: { reader, scan: scanText, mask: maskSecrets, upstream: upstream(), limits }
})
const batchOf = (files: any[], max = 90000) =>
  core.splitBatches(files, 'Review contract group: fixture\nEND OF TRUSTED WORKER HEADER\n', max)

test('multi-round tool calls pass reasoning_content back, and tools, trace and evidence bind every call', async (t) => {
  const w = workspace(t)
  const [batch] = batchOf([
    {
      path: 'src/app.ts',
      before: 'export const app = 1\n',
      after: "import { helper } from './helper'\nexport const app = helper()\n"
    }
  ])
  const api = scripted([
    completion(
      {
        content: '',
        reasoning_content: 'R1: need helper',
        tool_calls: [toolCall('c1', 'read_file', { ref: 'head', path: 'src/helper.ts' })]
      },
      'tool_calls'
    ),
    completion(
      {
        content: null,
        reasoning_content: 'R2: check callers',
        tool_calls: [
          toolCall('c2', 'search', { ref: 'head', pattern: 'helper(' }),
          toolCall('c3', 'list', { ref: 'mergeBase', dir: 'src' })
        ]
      },
      'tool_calls'
    ),
    completion({ content: verdict(batch.id), reasoning_content: 'R3: done' })
  ])
  const result = await runReviewBatch(config, request, batch, w.directory, options(api.fetch))
  assert.equal(result.verdict, 'pass')
  assert.match(result.evidence, /^[a-f0-9]{64}$/)
  assert.equal(api.bodies.length, 3, 'one request at a time, one per round')
  for (const body of api.bodies) {
    assert.deepEqual(
      body.tools.map((tool: any) => tool.function.name),
      ['read_file', 'search', 'list', 'read_upstream']
    )
    assert.equal(body.max_tokens, 393216)
    assert.equal(body.reasoning_effort, 'high')
    assert.deepEqual(body.thinking, { type: 'enabled' })
  }
  assert.ok(api.bodies[0].messages[0].content.startsWith(REVIEW_PROMPT))
  assert.match(
    api.bodies[0].messages[1].content,
    /"toolBudget":\{"calls":100,"totalBytes":600000,"bytesPerCall":60000\}/
  )
  // Every earlier assistant turn is passed back verbatim with its reasoning_content.
  const second = api.bodies[1].messages
  assert.deepEqual(
    second.slice(2).map((m: any) => m.role),
    ['assistant', 'tool']
  )
  assert.equal(second[2].reasoning_content, 'R1: need helper')
  assert.equal(second[2].tool_calls[0].id, 'c1')
  assert.equal(second[3].tool_call_id, 'c1')
  assert.match(second[3].content, /export const helper = \(\) => 42/)
  const third = api.bodies[2].messages
  assert.deepEqual(
    third.slice(2).map((m: any) => [m.role, m.reasoning_content ?? m.tool_call_id]),
    [
      ['assistant', 'R1: need helper'],
      ['tool', 'c1'],
      ['assistant', 'R2: check callers'],
      ['tool', 'c2'],
      ['tool', 'c3']
    ]
  )
  // Trace and evidence record name, arguments, returned bytes and sha256 of each call.
  const [evidence] = w.read('.evidence.json').map((text) => JSON.parse(text))
  const calls = evidence.attempts[0].toolCalls
  assert.deepEqual(
    calls.map((c: any) => [c.id, c.name, c.outcome]),
    [
      ['c1', 'read_file', 'ok'],
      ['c2', 'search', 'ok'],
      ['c3', 'list', 'ok']
    ]
  )
  assert.equal(calls[0].arguments, '{"path":"src/helper.ts","ref":"head"}')
  assert.equal(calls[0].sha256, createHash('sha256').update(second[3].content).digest('hex'))
  assert.equal(calls[0].bytes, Buffer.byteLength(second[3].content))
  assert.equal(evidence.inputDigest, createHash('sha256').update(batch.text).digest('hex'))
  const { digest, ...unsigned } = evidence
  assert.equal(digest, core.sha256(core.canonical(unsigned)))
  assert.equal(result.evidence, digest)
  const trace = w.read('.trace.jsonl').join('\n')
  for (const call of calls) assert.ok(trace.includes(call.sha256))
  assert.ok(!trace.includes('sk-fixture-tools-key'))
  // The signed batch entry carries the evidence digest next to the input digest.
  const aggregated = core.aggregate(request, [batch], [result])
  assert.deepEqual(aggregated.batches, [{ id: batch.id, digest: core.sha256(batch.text), evidence: digest }])
  // Different tool results give a different evidence digest for the same input.
  const other = scripted([
    completion(
      {
        reasoning_content: 'R1',
        tool_calls: [toolCall('c1', 'read_file', { ref: 'mergeBase', path: 'src/helper.ts' })]
      },
      'tool_calls'
    ),
    completion({ content: verdict(batch.id), reasoning_content: 'R2' })
  ])
  const w2 = workspace(t)
  assert.notEqual(
    (await runReviewBatch(config, request, batch, w2.directory, options(other.fetch))).evidence,
    digest
  )
})

test('finish_reason=length splits the batch along its units and retries serially; only exhausted depth blocks', async (t) => {
  const w = workspace(t)
  const files = Array.from({ length: 4 }, (_, i) => ({
    path: `src/f${i}.ts`,
    before: `export const v = ${i}\n`,
    after: `export const v = ${i + 10}\n`
  }))
  const [batch] = batchOf(files)
  assert.equal(batch.scope.length, 4)
  const scopes: string[][] = []
  const api = scripted([
    completion({ content: '', reasoning_content: 'x'.repeat(50) }, 'length'),
    (body) => {
      scopes.push(
        JSON.parse(/IDENTITY (\{.*\})/.exec(body.messages[1].content)![1]).reviewScope.map((s: any) => s.path)
      )
      return completion({ content: verdict(batch.id, { summary: 'first half' }) })
    },
    (body) => {
      scopes.push(
        JSON.parse(/IDENTITY (\{.*\})/.exec(body.messages[1].content)![1]).reviewScope.map((s: any) => s.path)
      )
      return completion({
        content: verdict(batch.id, {
          summary: 'second half',
          findings: [{ priority: 3, path: 'src/f3.ts', line: 1, title: 'nit', detail: 'd' }]
        })
      })
    }
  ])
  const result = await runReviewBatch(config, request, batch, w.directory, options(api.fetch))
  assert.deepEqual(scopes, [
    ['src/f0.ts', 'src/f1.ts'],
    ['src/f2.ts', 'src/f3.ts']
  ])
  assert.equal(result.verdict, 'pass')
  assert.equal(result.batchId, batch.id)
  assert.match(result.summary, /\[part 1\/2\] first half\n\[part 2\/2\] second half/)
  assert.equal(result.findings.length, 1)
  const [evidence] = w.read('.evidence.json').map((text) => JSON.parse(text))
  assert.deepEqual(
    evidence.attempts.map((a: any) => [a.depth, a.outcome]),
    [
      [0, 'output-truncated'],
      [1, 'answered'],
      [1, 'answered']
    ]
  )
  // A single small unit that keeps truncating is split down to the depth limit, then blocks.
  const [single] = batchOf([
    { path: 'src/one.ts', before: numbered(400, 'old'), after: numbered(400, 'new') }
  ])
  const always = scripted(Array.from({ length: 40 }, () => () => completion({ content: '' }, 'length')))
  const blocked = await runReviewBatch(config, request, single, w.directory, options(always.fetch))
  // One part's truncation blocks that part, so the combined batch result fails closed.
  assert.equal(blocked.verdict, 'fail')
  assert.ok(blocked.blockers.length > 0)
  assert.ok(blocked.blockers.every((b: string) => /truncated \(finish_reason=length\)/.test(b)))
  assert.ok(
    always.bodies.length > 1 && always.bodies.length <= 15,
    `bounded retries: ${always.bodies.length}`
  )
})

test('a head secret from a tool stops the whole review; merged secrets are masked', async (t) => {
  const w = workspace(t)
  const batches = batchOf(
    [
      { path: 'src/a.ts', before: 'a\n', after: 'b\n' },
      { path: 'src/c.ts', before: 'c\n', after: 'd\n' }
    ],
    4000
  )
  assert.equal(batches.length, 1)
  const leak = scripted([
    completion(
      {
        reasoning_content: 'r',
        tool_calls: [toolCall('s1', 'read_file', { ref: 'head', path: 'src/leak.ts' })]
      },
      'tool_calls'
    )
  ])
  const invoke = (c: any, r: any, b: any, d: string, extra: any) =>
    runReviewBatch(c, r, b, d, {
      ...options(leak.fetch),
      ...extra,
      fetch: leak.fetch,
      env: options(leak.fetch).env
    })
  const settled = await reviewBatches(config, request, [...batches, ...batches], w.directory, invoke, {
    reader: fixture(),
    scan: scanText,
    mask: maskSecrets,
    upstream: upstream()
  })
  assert.deepEqual(settled.secretBlockers, [
    'Secret scan blocked review input: assigned-secret at "src/leak.ts":2 (value withheld)',
    'Secret scan blocked review input: github-token at "src/leak.ts":2 (value withheld)'
  ])
  assert.equal(leak.bodies.length, 1, 'no further request after the finding')
  assert.ok(!JSON.stringify(settled).includes(TOKEN))
  assert.ok(!w.read('.trace.jsonl').join('').includes(TOKEN), 'the secret never reaches the trace')
  // The same content at base is masked and the review continues.
  const masked = scripted([
    completion(
      {
        reasoning_content: 'r',
        tool_calls: [toolCall('m1', 'read_file', { ref: 'base', path: 'src/legacy.ts' })]
      },
      'tool_calls'
    ),
    (body) => {
      assert.ok(!JSON.stringify(body).includes('mallory'))
      return completion({ content: verdict(batches[0].id) })
    }
  ])
  assert.equal(
    (await runReviewBatch(config, request, batches[0], w.directory, options(masked.fetch))).verdict,
    'pass'
  )
})

test('a spent tool budget forces one final answer without tools; its verdict or blockers are adopted', async (t) => {
  const w = workspace(t)
  const [batch] = batchOf([{ path: 'src/a.ts', before: 'a\n', after: 'b\n' }])
  const listing = (id: string, extra: any[] = []) =>
    completion(
      {
        reasoning_content: 'r-' + id,
        tool_calls: [toolCall(id, 'list', { ref: 'head', dir: 'src' }), ...extra]
      },
      'tool_calls'
    )
  const limits = { ...tools.TOOL_LIMITS, maxCalls: 2 }
  // Round 3 asks for two calls: the first exceeds the 2-call budget, the second is answered unexecuted.
  const adopted = scripted([
    listing('g0'),
    listing('g1'),
    listing('g2', [toolCall('g3', 'read_file', { ref: 'head', path: 'src/app.ts' })]),
    (body) => {
      assert.equal(body.tool_choice, 'none')
      assert.ok(body.tools.length === 4, 'tools stay defined for the reasoning_content rule')
      const tail = body.messages.slice(-4)
      assert.deepEqual(
        tail.map((m: any) => [m.role, m.tool_call_id ?? null]),
        [
          ['assistant', null],
          ['tool', 'g2'],
          ['tool', 'g3'],
          ['user', null]
        ]
      )
      assert.equal(tail[0].reasoning_content, 'r-g2')
      assert.match(tail[1].content, /^NOT RETURNED: Reviewer tool call budget exhausted/)
      assert.match(tail[2].content, /^NOT EXECUTED: /)
      assert.match(tail[3].content, /return the final review JSON now/)
      return completion({ content: verdict(batch.id, { summary: 'answered after budget' }) })
    }
  ])
  const result = await runReviewBatch(
    config,
    request,
    batch,
    w.directory,
    options(adopted.fetch, fixture(), limits)
  )
  assert.equal(result.verdict, 'pass')
  assert.equal(result.summary, 'answered after budget')
  assert.equal(adopted.bodies.length, 4)
  assert.ok(adopted.bodies.slice(0, 3).every((body: any) => !('tool_choice' in body)))
  const [evidence] = w.read('.evidence.json').map((text) => JSON.parse(text))
  assert.equal(evidence.attempts[0].finalizedAfterBudget, true)
  assert.match(evidence.attempts[0].finalizeReason, /call budget exhausted \(2 calls/)
  assert.deepEqual(
    evidence.attempts[0].toolCalls.map((c: any) => [c.id, c.outcome]),
    [
      ['g0', 'ok'],
      ['g1', 'ok'],
      ['g2', 'budget-exceeded'],
      ['g3', 'not-executed-budget-exhausted']
    ]
  )
  // Still missing essential context after the final turn: its blockers fail the review.
  const w2 = workspace(t)
  const missing = scripted([
    listing('h0'),
    listing('h1'),
    listing('h2'),
    completion({
      content: verdict(batch.id, {
        verdict: 'blocked',
        blockers: ['Could not read the consumer of src/a.ts']
      })
    })
  ])
  const incomplete = await runReviewBatch(
    config,
    request,
    batch,
    w2.directory,
    options(missing.fetch, fixture(), limits)
  )
  assert.deepEqual(incomplete.blockers, ['Could not read the consumer of src/a.ts'])
  assert.equal(core.aggregate(request, [batch], [incomplete]).verdict, 'fail')
  // The round limit also finalizes, and the byte budget does the same as the call budget.
  const w3 = workspace(t)
  const bytes = scripted([
    completion(
      {
        reasoning_content: 'r',
        tool_calls: [
          toolCall('b0', 'read_file', { ref: 'head', path: 'src/big.ts' }),
          toolCall('b1', 'read_file', { ref: 'head', path: 'src/big.ts', startLine: 900 })
        ]
      },
      'tool_calls'
    ),
    (body) => {
      assert.equal(body.tool_choice, 'none')
      return completion({ content: verdict(batch.id) })
    }
  ])
  assert.equal(
    (
      await runReviewBatch(
        config,
        request,
        batch,
        w3.directory,
        options(bytes.fetch, fixture(), { ...tools.TOOL_LIMITS, maxTotalBytes: 8000, maxCallBytes: 4800 })
      )
    ).verdict,
    'pass'
  )
  // Asking for tools again, or not stopping, on the final turn fails closed.
  for (const last of [listing('z9'), completion({ content: '' }, 'content_filter')]) {
    const again = scripted([listing('x0'), listing('x1'), listing('x2'), last])
    const w4 = workspace(t)
    const outcome = await runReviewBatch(
      config,
      request,
      batch,
      w4.directory,
      options(again.fetch, fixture(), limits)
    ).then(
      (value: any) => value,
      (error: Error) => error
    )
    if (outcome instanceof Error) assert.match(outcome.message, /after its tool budget|did not complete/)
    else assert.notEqual(core.aggregate(request, [batch], [outcome]).verdict, 'pass')
  }
})

test('the batch wall-clock deadline fails closed with its reason', async (t) => {
  const w = workspace(t)
  const [batch] = batchOf([{ path: 'src/a.ts', before: 'a\n', after: 'b\n' }])
  let clock = 1_000_000
  const api = scripted([
    () => {
      clock += 2 * 3600000
      return completion(
        { reasoning_content: 'r', tool_calls: [toolCall('d0', 'list', { ref: 'head', dir: 'src' })] },
        'tool_calls'
      )
    }
  ])
  const result = await runReviewBatch(config, request, batch, w.directory, {
    ...options(api.fetch),
    now: () => clock,
    batchDeadlineMs: 3600000
  })
  assert.equal(result.verdict, 'blocked')
  assert.match(result.blockers[0], /wall-clock deadline \(1 h including split retries\)/)
  assert.equal(api.bodies.length, 1, 'no request is started after the deadline')
  const { REVIEW_BATCH_DEADLINE_MS } = await load('review-process.mjs')
  assert.equal(REVIEW_BATCH_DEADLINE_MS, 6 * 3600000)
})

test('split results keep the most severe findings when combined findings exceed the schema limit', async (t) => {
  const w = workspace(t)
  const files = Array.from({ length: 2 }, (_, i) => ({
    path: `src/s${i}.ts`,
    before: `a${i}\n`,
    after: `b${i}\n`
  }))
  const [batch] = batchOf(files)
  const finding = (priority: number, n: number) => ({
    priority,
    path: 'src/s0.ts',
    line: 1,
    title: `t${n}`,
    detail: 'd'
  })
  const api = scripted([
    completion({ content: '' }, 'length'),
    completion({
      content: verdict(batch.id, {
        verdict: 'fail',
        findings: Array.from({ length: 100 }, (_, n) => finding(3, n))
      })
    }),
    completion({ content: verdict(batch.id, { verdict: 'fail', findings: [finding(0, 999)] }) })
  ])
  const result = await runReviewBatch(config, request, batch, w.directory, options(api.fetch))
  assert.equal(result.findings.length, 100)
  assert.equal(result.findings[0].priority, 0)
  assert.match(result.blockers.at(-1), /1 further findings omitted/)
})
test('a model that declares missing context within the budget fails through blockers', async (t) => {
  const w = workspace(t)
  const [batch] = batchOf([{ path: 'src/a.ts', before: 'a\n', after: 'b\n' }])
  const api = scripted([
    completion({
      content: verdict(batch.id, {
        verdict: 'blocked',
        blockers: ['Need src/contract.ts to assess the changed call']
      })
    })
  ])
  const result = await runReviewBatch(config, request, batch, w.directory, options(api.fetch))
  assert.equal(core.aggregate(request, [batch], [result]).verdict, 'fail')
})

test('over-long prose is clipped, never turned into a failed review or a pass', async (t) => {
  // A real answer: correct identity and verdict, but a 4546-character summary.
  const w = workspace(t)
  const [batch] = batchOf([{ path: 'src/a.ts', before: 'a\n', after: 'b\n' }])
  const long = 'x'.repeat(4546)
  const passing = scripted([
    completion({
      content: verdict(batch.id, {
        summary: long,
        findings: [
          { priority: 3, path: 'src/a.ts', line: 1, title: 't'.repeat(5000), detail: 'd'.repeat(5000) }
        ]
      })
    })
  ])
  const ok = await runReviewBatch(config, request, batch, w.directory, options(passing.fetch))
  assert.equal(ok.verdict, 'pass')
  assert.ok(ok.summary.length <= core.REVIEW_TEXT_LIMIT && ok.summary.endsWith('[…truncated by worker]'))
  assert.ok(ok.findings[0].title.length <= core.REVIEW_TEXT_LIMIT)
  assert.ok(ok.findings[0].detail.length <= core.REVIEW_TEXT_LIMIT)
  assert.equal(core.aggregate(request, [batch], [ok]).verdict, 'pass')
  assert.equal(JSON.parse(w.read('.evidence.json')[0]).attempts[0].textClipped, true)
  // An over-long blocker is shortened but still blocks.
  const blocking = scripted([
    completion({ content: verdict(batch.id, { verdict: 'blocked', blockers: ['b'.repeat(3000)] }) })
  ])
  const blocked = await runReviewBatch(config, request, batch, w.directory, options(blocking.fetch))
  assert.equal(blocked.verdict, 'blocked')
  assert.equal(blocked.blockers.length, 1)
  assert.ok(blocked.blockers[0].length > 0 && blocked.blockers[0].length <= core.REVIEW_BLOCKER_LIMIT)
  assert.equal(core.aggregate(request, [batch], [blocked]).verdict, 'fail')
  // A clipped high-priority finding still fails the review.
  const serious = scripted([
    completion({
      content: verdict(batch.id, {
        verdict: 'fail',
        findings: [
          { priority: 1, path: 'src/a.ts', line: 1, title: 'p1 '.repeat(3000), detail: 'x'.repeat(9000) }
        ]
      })
    })
  ])
  const failing = await runReviewBatch(config, request, batch, w.directory, options(serious.fetch))
  assert.equal(failing.findings[0].priority, 1)
  assert.equal(core.aggregate(request, [batch], [failing]).verdict, 'fail')
  // Identity is still exact: a wrong head is rejected, not normalized.
  const forged = scripted([completion({ content: verdict(batch.id, { head: 'f'.repeat(40) }) })])
  await assert.rejects(
    runReviewBatch(config, request, batch, w.directory, options(forged.fetch)),
    /mismatched commit identity/
  )
})

test('tool calls with a forged batch, malformed calls or no tool context fail closed', async (t) => {
  const w = workspace(t)
  const [batch] = batchOf([{ path: 'src/a.ts', before: 'a\n', after: 'b\n' }])
  const forged = { ...batch, scope: [{ ...batch.scope[0], part: [0, 1, 1] }] }
  await assert.rejects(
    runReviewBatch(config, request, forged, w.directory, options(scripted([]).fetch)),
    /unbound review scope/
  )
  const malformed = scripted([
    completion({ tool_calls: [{ id: 1, type: 'function', function: { name: 'list' } }] }, 'tool_calls')
  ])
  await assert.rejects(
    runReviewBatch(config, request, batch, w.directory, options(malformed.fetch)),
    /malformed tool_calls/
  )
  const noTools = scripted([
    completion({ tool_calls: [toolCall('x', 'list', { ref: 'head', dir: '' })] }, 'tool_calls')
  ])
  await assert.rejects(
    runReviewBatch(config, request, batch, w.directory, { ...options(noTools.fetch), tools: undefined }),
    /forbidden capability/
  )
  assert.ok(!('tools' in noTools.bodies[0]))
})
