import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const { collectReviewContext, collectGroupedReview, reviewModuleReferences, parseReviewTree, splitBatches } =
  await import(pathToFileURL(resolve('scripts/review-core.mjs')).href)
const { prepareReviewSnapshot } = await import(pathToFileURL(resolve('scripts/review-worker.mjs')).href)
const head = 'a'.repeat(40),
  base = 'b'.repeat(40),
  mergeBase = 'c'.repeat(40)
function memory(
  trees: Record<string, Record<string, string | Buffer | { text: string; mode: string; type?: string }>>
) {
  const requests: Array<{ ref: string; path: string }> = [],
    inventory = new Map<string, any[]>(),
    blobs = new Map<string, Buffer>()
  for (const [ref, tree] of Object.entries(trees)) {
    const entries = Object.entries(tree).map(([path, value]) => {
      const structured = typeof value === 'object' && !Buffer.isBuffer(value)
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(structured ? value.text : (value as string))
      const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
      blobs.set(ref + ':' + path, bytes)
      return {
        path,
        oid,
        mode: structured ? value.mode : '100644',
        type: structured ? (value.type ?? 'blob') : 'blob',
        size: bytes.length
      }
    })
    inventory.set(ref, entries)
  }
  return {
    requests,
    reader: {
      list: async (ref: string) => inventory.get(ref) ?? [],
      read: async (ref: string, path: string) => {
        requests.push({ ref, path })
        return blobs.get(ref + ':' + path)!
      }
    }
  }
}
const request = (names: string[], refBase = base) => ({
  repository: 'fixture/repo',
  head,
  base: refBase,
  mergeBase: base,
  names
})

test('contract groups include runtime and updater producers without copying governance into every batch', async () => {
  const sources = {
    'README.md': 'Contract fixture',
    'scripts/review-loop.mjs': 'export const loop = 1',
    'scripts/stage-runtime.ts':
      'import { schema } from \'../src/shared/runtime-integrity\'; export const producer = "stage"',
    'scripts/verify-package.ts':
      'import { schema } from \'../src/shared/runtime-integrity\'; export const verifier = "package"',
    'src/main/index.ts':
      'import { schema } from \'../shared/runtime-integrity\'; export const consumer = "activation"',
    'src/shared/runtime-integrity.ts': 'export const schema = 2',
    'packages/dsh-px-updater/package.json': JSON.stringify({
      name: 'dsh-px-updater',
      main: 'lib/index.js',
      exports: { '.': './lib/index.js', './client': './lib/client.js' }
    }),
    'packages/dsh-px-updater/src/index.ts': 'export const status = "producer"',
    'packages/dsh-px-updater/src/client.tsx': 'export const page = "consumer"'
  }
  const names = [
    'scripts/review-loop.mjs',
    'src/shared/runtime-integrity.ts',
    'packages/dsh-px-updater/src/client.tsx'
  ]
  const f = memory({
    [base]: sources,
    [head]: { ...sources, 'src/shared/runtime-integrity.ts': 'export const schema = 3' }
  })
  const plan = await collectGroupedReview(request(names), f.reader)
  assert.deepEqual(
    plan.files.map((file: any) => file.path),
    names
  )
  const runtime = plan.batches.filter((batch: any) => batch.group === 'runtime')
  const updater = plan.batches.filter((batch: any) => batch.group === 'updater')
  assert.ok(runtime.length && updater.length)
  for (const batch of runtime) {
    assert.ok(batch.text.includes('export const producer = "stage"'))
    assert.ok(batch.text.includes('export const verifier = "package"'))
    assert.ok(batch.text.includes('export const consumer = "activation"'))
    assert.ok(!batch.text.includes('export const loop = 1'))
  }
  for (const batch of updater) {
    assert.ok(batch.text.includes('export const status = "producer"'))
    assert.ok(batch.text.includes('export const page = "consumer"'))
  }
  assert.equal(new Set(plan.batches.map((batch: any) => batch.id)).size, plan.batches.length)
  await assert.rejects(collectGroupedReview(request([...names, names[0]]), f.reader), /Duplicate changed/)
})

test('shared changes retain every byte across consumer groups and oversized contracts fail closed', async () => {
  const path = 'packages/shared/shared.ts'
  const before = 'export const shared = "' + 'a'.repeat(12000) + '"'
  const after = 'export const shared = "' + 'b'.repeat(14000) + '"'
  const consumers: Record<string, string> = { 'src/main/index.ts': "import '../../packages/shared/shared'" }
  for (const name of ['updater', 'workbench', 'workspace', 'taskflow']) {
    consumers[`packages/dsh-px-${name}/package.json`] = JSON.stringify({ name: `dsh-px-${name}` })
    consumers[`packages/dsh-px-${name}/src/index.ts`] = "import '../../shared/shared'"
  }
  const f = memory({ [base]: { ...consumers, [path]: before }, [head]: { ...consumers, [path]: after } })
  const plan = await collectGroupedReview(request([path]), f.reader, {}, 5000)
  assert.equal(plan.files.length, 1)
  assert.equal(plan.files[0].before, before)
  assert.equal(plan.files[0].after, after)
  assert.equal(plan.metrics.groups, 5)
  for (const group of ['runtime', 'updater', 'workbench', 'workspace', 'taskflow']) {
    const chunks = plan.batches.filter((batch: any) => batch.group === group)
    assert.ok(chunks.length > 1)
    assert.ok(chunks.every((batch: any) => batch.text.length <= 5000))
    assert.ok(chunks.some((batch: any) => batch.text.includes('/' + after.length)))
  }
  // A required producer larger than the budget is never truncated: the plan fails closed.
  const big = { 'src/main/big.ts': before }
  const large = memory({
    [base]: { ...big, 'src/main/index.ts': "import './big'" },
    [head]: { ...big, 'src/main/index.ts': "import './big'; export const changed = 1" }
  })
  await assert.rejects(
    collectGroupedReview(request(['src/main/index.ts']), large.reader, {}, 5000),
    /context exceeds/
  )
})

test('local import/export/require closure is complete and ref-bound, preserving base/head contracts and leading spaces', async () => {
  const shared = {
    'README.md': 'project contract',
    'src/entry.ts': "import { run } from './worker.js'; export { result } from './ leading';\n",
    'src/ leading.ts': "export { value as result } from './contract'",
    'src/contract.ts': 'export const value = 1'
  }
  const f = memory({
    [base]: { ...shared, 'src/worker.ts': "const c = require('./contract'); export const run = 'OLD'" },
    [head]: { ...shared, 'src/worker.ts': "const c = require('./contract'); export const run = 'NEW'" }
  })
  const result = await collectReviewContext(request(['src/entry.ts']), f.reader)
  assert.match(result.context, /'OLD'/)
  assert.match(result.context, /'NEW'/)
  assert.ok(result.identities.some((x: any) => x.path === 'src/ leading.ts'))
  const stable = result.identities.filter((x: any) => x.path === 'src/contract.ts')
  assert.equal(stable.length, 1, 'same Git blob is included once with all snapshot roles')
  assert.deepEqual(
    stable[0].roles.map((x: any) => x.role),
    ['head', 'base', 'mergeBase']
  )
  assert.equal(result.files[0].before, shared['src/entry.ts'])
  assert.ok(f.requests.every((row) => [head, base].includes(row.ref)))
})

test('policy explicitly referenced sources, installer and actual local updater consumers are supplied', async () => {
  const policy = JSON.stringify({
    trustedQuality: {
      path: '.github/workflows/quality.yml',
      files: { 'scripts/quality.mjs': 'f'.repeat(64) }
    },
    trustedBuild: { files: { 'scripts/build.mjs': 'e'.repeat(64) } }
  })
  const tree = {
    'docs/github/review-policy.json': policy,
    '.github/workflows/quality.yml': 'name: exact workflow',
    'scripts/quality.mjs': "import './contract.mjs'",
    'scripts/build.mjs': 'export const build = true',
    'scripts/contract.mjs': 'export const contract = 1',
    'scripts/review-install.mjs': 'export const installed = true',
    // Consumers are discovered from the graph (updater client and release-feed readers), not names.
    'src/renamed/updater-client.ts':
      "import type { AppUpdater } from 'electron-updater'; import './bridge'; export const consumer = 'electron-updater caller'",
    'src/renamed/bridge.ts': 'export const bridge = true',
    'packages/dsh-px-updater/src/feed.ts':
      'export const feed = (repo: string) => `https://api.github.com/repos/${repo}/releases/latest`'
  }
  const f = memory({ [base]: tree, [head]: { ...tree, 'src/unrelated.ts': 'export const other = 1' } })
  const result = await collectReviewContext(request(['docs/github/review-policy.json']), f.reader)
  for (const file of Object.keys(tree)) assert.ok(result.context.includes(file), file)
  assert.match(result.context, /electron-updater caller/)
  assert.ok(!result.context.includes('export const other = 1'))
})

test('requested base is distinct from merge base and each changed contract is labelled by its immutable ref', async () => {
  const f = memory({
    [mergeBase]: { 'README.md': 'MERGE_CONTRACT' },
    [base]: { 'README.md': 'BASE_CONTRACT' },
    [head]: { 'README.md': 'HEAD_CONTRACT' }
  })
  const result = await collectReviewContext({ ...request(['README.md']), mergeBase }, f.reader)
  for (const value of ['MERGE_CONTRACT', 'BASE_CONTRACT', 'HEAD_CONTRACT'])
    assert.ok(result.context.includes(value))
  assert.equal(result.files[0].before, 'MERGE_CONTRACT')
  assert.equal(result.files[0].after, 'HEAD_CONTRACT')
})

test('missing dependencies, escaped paths, links, private paths and invalid bytes block before unsafe reads', async () => {
  const cases: Array<{ source: string; extra?: Record<string, any>; error: RegExp }> = [
    { source: "import './absent'", error: /Unresolved local dependency/ },
    { source: "import '../../outside'", error: /Unsafe/ },
    { source: "import '/outside/private.js'", error: /outside the Git snapshot/ },
    { source: "import './node_modules/secret'", error: /Private or generated/ },
    { source: "import './key.pem'", error: /Private or generated/ },
    {
      source: "import './linked'",
      extra: { 'src/linked': { mode: '120000', text: '../../secret' } },
      error: /regular Git blob/
    },
    {
      source: "import './submodule'",
      extra: { 'src/submodule': { mode: '160000', type: 'commit', text: '' } },
      error: /regular Git blob/
    },
    { source: "import './bad'", extra: { 'src/bad.ts': Buffer.from([0xff]) }, error: /encoded data/ }
  ]
  for (const row of cases) {
    const tree = { 'src/entry.ts': row.source, ...row.extra },
      f = memory({ [head]: tree, [base]: tree })
    await assert.rejects(collectReviewContext(request(['src/entry.ts']), f.reader), row.error)
    assert.ok(
      !f.requests.some(
        (read) => read.path.includes('secret') || ['src/linked', 'src/submodule'].includes(read.path)
      )
    )
  }
  const tree = {
    'docs/github/review-policy.json': JSON.stringify({ trustedBuild: { files: { '../outside': 'a' } } })
  }
  const f = memory({ [base]: tree, [head]: tree })
  await assert.rejects(collectReviewContext(request(['docs/github/review-policy.json']), f.reader), /Unsafe/)
})

test('bounded context rejects excessive file/byte inventories and missing explicit policy files instead of truncating', async () => {
  const tree = { 'src/entry.ts': "import './other'", 'src/other.ts': 'A'.repeat(8000) },
    f = memory({ [base]: tree, [head]: tree })
  await assert.rejects(
    collectReviewContext(request(['src/entry.ts']), f.reader, { maxPaths: 1 }),
    /file limit/
  )
  await assert.rejects(
    collectReviewContext(request(['src/entry.ts']), f.reader, { maxBytes: 1000 }),
    /byte budget/
  )
  await assert.rejects(
    collectReviewContext(request(['src/entry.ts']), f.reader, { maxTreeEntries: 1 }),
    /entry limit/
  )
  await assert.rejects(
    collectReviewContext(request(['src/entry.ts']), f.reader, { maxBytes: Infinity }),
    /Invalid bounded/
  )
  const p = {
      'docs/github/review-policy.json': JSON.stringify({
        trustedBuild: { files: { 'scripts/not-present.mjs': 'a' } }
      })
    },
    bad = memory({ [head]: p, [base]: p })
  await assert.rejects(
    collectReviewContext(request(['docs/github/review-policy.json']), bad.reader),
    /Required review source is absent/
  )
})

test('literal module scan ignores comments/quoted fixtures and supports JSX prose, nested expressions and TSX generic components', () => {
  const source = `import type { Item } from './contract'
    const fake = "import './not-code'";
    // import './comment';
    const regex = /import\\('not-a-module'\\)/;
    const divide = total / count;
    export const view = () => <section>don't stop "now" <Select<Item> value={1} />
      <span>{flag && import('./inside')}</span>{\`template \${import('./template')}\`}
    </section>;
    const generic = <T,>(value: T) => value;
    const constrained = <T extends Item>(value: T) => value;
    const later = import('./later');
    const unknown = import(computedPath);`
  const references = reviewModuleReferences(source, { jsx: true })
  assert.deepEqual(
    references.literals.map((row: any) => row.specifier),
    ['./contract', './inside', './template', './later']
  )
  assert.equal(references.dynamic.length, 1)
})

test('policy/test helper script dependencies are resolved without interpreting embedded source strings', async () => {
  const source =
    "const load = name => import(pathToFileURL(resolve('scripts', name)).href); const subject = await load('review-core.mjs'); const fixture = \"import './nonexistent-fixture'\";"
  const tree = { 'test/fixture.test.ts': source, 'scripts/review-core.mjs': 'export const core = true' },
    f = memory({ [head]: tree, [base]: tree })
  const result = await collectReviewContext(request(['test/fixture.test.ts']), f.reader)
  assert.ok(result.context.includes('scripts/review-core.mjs'))
  assert.equal(
    result.metrics.computedReferences,
    2,
    'computed loader is explicitly disclosed for both distinct refs'
  )
})

test('concatenated import/require targets remain computed rather than being mistaken for a complete literal', async () => {
  const source =
    "const a = import('./base' + suffix); const b = require('./x' + mode); const c = import('./data.json', { with: { type: 'json' } }); const d = require('./plain');"
  const refs = reviewModuleReferences(source)
  assert.deepEqual(
    refs.literals.map((row: any) => row.specifier),
    ['./data.json', './plain']
  )
  assert.deepEqual(
    refs.dynamic.map((row: any) => row.incompleteLiteralPrefix),
    ['./base', './x']
  )
  const tree = { 'src/entry.ts': source, 'src/data.json': '{}', 'src/plain.ts': 'export const value = 1' },
    f = memory({ [base]: tree, [head]: tree })
  const result = await collectReviewContext(request(['src/entry.ts']), f.reader)
  assert.match(result.context, /incompleteLiteralPrefix/)
  assert.ok(!f.requests.some((row) => ['src/base', 'src/x'].includes(row.path)))
})

test('from can be a legal import/export alias and computed helper calls do not masquerade as literal targets', () => {
  const refs = reviewModuleReferences(
    "import { from as local } from './dep.mjs'; export * as from from './other.mjs'; const load = name => import(pathToFileURL(resolve('scripts', name)).href); load('review-worker.mjs' + suffix);"
  )
  assert.deepEqual(
    refs.literals.map((row: any) => row.specifier),
    ['./dep.mjs', './other.mjs']
  )
  assert.ok(
    refs.dynamic.some(
      (row: any) => row.kind === 'load' && row.incompleteLiteralPrefix === 'scripts/review-worker.mjs'
    )
  )
})

test('AST module inventory handles regex after control flow without confusing literals with comments', () => {
  const controls = [
    'if (enabled) /[//]/.test(value);',
    'while (enabled) /[/*]/.test(value);',
    'for (; enabled;) /[//]/.test(value);',
    'if (enabled) {} /[//]/.test(value);',
    "const value = /import 'ignored'/; const ratio = left / right;"
  ]
  for (const control of controls) {
    const refs = reviewModuleReferences(`${control}\nimport './guard.js';`)
    assert.deepEqual(
      refs.literals.map((row: any) => row.specifier),
      ['./guard.js'],
      control
    )
    assert.deepEqual(refs.dynamic, [])
  }
})

test('AST inventory includes TypeScript import contracts and explicitly records computed arguments', () => {
  const refs = reviewModuleReferences(`
    import implementation = require('./implementation');
    type Contract = import('./contract').Contract;
    export type { Result } from './result';
    const a = import(\`./static\`);
    const b = import(\`./dynamic/\${name}\`);
    const c = require('./prefix' + mode);
    const d = require.resolve('./resolved');
  `)
  assert.deepEqual(
    refs.literals.map((row: any) => row.specifier),
    ['./implementation', './contract', './result', './static', './resolved']
  )
  assert.equal(refs.dynamic.length, 2)
  assert.ok(refs.dynamic.some((row: any) => row.incompleteLiteralPrefix === './prefix'))
  assert.throws(
    () => reviewModuleReferences("import './before'; const broken = ; import './after';"),
    /Unexpected token/
  )
  assert.deepEqual(
    reviewModuleReferences("if (skip) return; require('./cjs');", { filename: 'entry.cjs' }).literals.map(
      (row: any) => row.specifier
    ),
    ['./cjs']
  )
})

test('divergent requested base prints ordinary changed-root bytes from a real three-fork Git history', async (t) => {
  const parent = realpathSync(tmpdir()),
    directory = mkdtempSync(join(parent, 'dshpx-context-forks-'))
  t.after(() => {
    assert.ok(resolve(directory).startsWith(parent + sep))
    rmSync(directory, { recursive: true, force: true })
  })
  mkdirSync(join(directory, 'hooks'))
  mkdirSync(join(directory, 'src'))
  const run = (args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        `core.hooksPath=${join(directory, 'hooks')}`,
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=Context Fixture',
        '-c',
        'user.email=context-fixture@example.invalid',
        '-C',
        directory,
        ...args
      ],
      { windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '' } }
    )
  run(['init', '-q'])
  const commit = (text: string) => {
    writeFileSync(join(directory, 'src/entry.ts'), text)
    run(['add', '--', 'src/entry.ts'])
    run(['commit', '-qm', 'fixture'])
    return run(['rev-parse', 'HEAD']).toString().trim()
  }
  const initial = commit('export const marker = "MERGE_ONLY"\n')
  const requestedBase = commit('export const marker = "BASE_ONLY"\n')
  run(['checkout', '-q', '--detach', initial])
  const requestedHead = commit('export const marker = "HEAD_ONLY"\n')
  writeFileSync(join(directory, 'src/entry.ts'), 'throw new Error("DIRTY_TREE_MUST_NOT_BE_PARSED")')
  const git = async (args: string[], raw = false, binary = false) => {
    const result = run(args)
    return binary ? result : raw ? result.toString() : result.toString().trim()
  }
  const result = await prepareReviewSnapshot(
    { repository: 'fixture/repo' },
    { head: requestedHead, base: requestedBase },
    git
  )
  assert.equal(result.mergeBase, initial)
  assert.equal(result.files[0].before, 'export const marker = "MERGE_ONLY"\n')
  assert.equal(result.files[0].after, 'export const marker = "HEAD_ONLY"\n')
  for (const marker of ['BASE_ONLY', 'MERGE_ONLY', 'HEAD_ONLY'])
    assert.ok(result.context.includes(marker), marker)
  assert.ok(
    result.identities.some(
      (item: any) =>
        item.path === 'src/entry.ts' &&
        item.roles.some((role: any) => role.role === 'base' && role.ref === requestedBase)
    )
  )
  assert.ok(result.batches.every((batch: any) => batch.text.includes('BASE_ONLY')))
  assert.ok(!result.context.includes('DIRTY_TREE_MUST_NOT_BE_PARSED'))
  assert.match(readFileSync(join(directory, 'src/entry.ts'), 'utf8'), /DIRTY_TREE_MUST_NOT_BE_PARSED/)
})

test('parser provenance projections bind exact JSON pointers to each Git ref without replacing changed lockfile bytes', async () => {
  const parser = {
    version: '7.29.9',
    resolved: 'https://registry.npmjs.org/@babel/parser/-/parser-7.29.9.tgz',
    integrity: 'sha512-fixture'
  }
  const oldLock = JSON.stringify({
    packages: { '': { devDependencies: {} }, 'node_modules/@babel/parser': parser },
    retained: 'OLD_COMPLETE_LOCK'
  })
  const newLock = JSON.stringify({
    packages: {
      '': { devDependencies: { '@babel/parser': '7.29.9' } },
      'node_modules/@babel/parser': parser
    },
    retained: 'NEW_COMPLETE_LOCK'
  })
  const tree = { 'scripts/review-entry.mjs': 'export const active = true' }
  const f = memory({
    [base]: { ...tree, 'package-lock.json': oldLock },
    [head]: { ...tree, 'package-lock.json': newLock }
  })
  const result = await collectReviewContext(
    request(['scripts/review-entry.mjs', 'package-lock.json']),
    f.reader
  )
  const current = result.projections.find((item: any) => item.role === 'head')
  assert.equal(current.ref, head)
  assert.equal(current.sha256, createHash('sha256').update(newLock).digest('hex'))
  assert.equal(current.pointers['/packages//devDependencies/@babel~1parser'], '7.29.9')
  assert.deepEqual(current.pointers['/packages/node_modules~1@babel~1parser'], parser)
  assert.equal(
    result.projections.find((item: any) => item.role === 'base').pointers[
      '/packages//devDependencies/@babel~1parser'
    ],
    null
  )
  assert.equal(result.files.find((item: any) => item.path === 'package-lock.json').before, oldLock)
  assert.equal(result.files.find((item: any) => item.path === 'package-lock.json').after, newLock)
  assert.match(result.context, /CONTEXT JSON PROJECTION/)
})

test('Git tree parsing preserves whitespace names and rejects malformed identity', () => {
  const data = Buffer.from(`100644 blob ${'d'.repeat(40)} 12\tsrc/ leading.ts\0`)
  assert.equal(parseReviewTree(data)[0].path, 'src/ leading.ts')
  assert.throws(() => parseReviewTree(Buffer.from('garbage\0')), /Malformed/)
})

test('complete batch lengths include headers and repeated context, and changed bytes have gap-free coverage', () => {
  const context = 'C'.repeat(5500),
    before = 'A'.repeat(12000),
    after = 'B'.repeat(14500)
  const batches = splitBatches([{ path: 'src/' + 'x'.repeat(120) + '.ts', before, after }], context, 9000)
  assert.ok(batches.length > 1)
  assert.ok(batches.every((batch: any) => batch.text.length <= 9000 && batch.text.startsWith(context)))
  const covered = { BEFORE: 0, AFTER: 0 }
  for (const batch of batches)
    for (const match of batch.text.matchAll(/(BEFORE|AFTER) chars (\d+)-(\d+)\/(\d+)/g)) {
      const key = match[1] as 'BEFORE' | 'AFTER',
        start = Number(match[2]),
        end = Number(match[3])
      assert.equal(start, covered[key])
      assert.ok(end >= start)
      covered[key] = end
    }
  assert.deepEqual(covered, { BEFORE: before.length, AFTER: after.length })
  assert.throws(
    () => splitBatches([{ path: 'x'.repeat(500), before: '', after: 'x' }], 'C'.repeat(3900), 4000),
    /budget/
  )
  assert.throws(() => splitBatches([{ path: 'x', before: '', after: 'x' }], context, 4000), /budget/)
})

test('packing accounts for separators at the exact limit and either side of it', () => {
  const context = 'review contract',
    limit = 4000,
    first = { path: 'first.ts', before: 'a'.repeat(900), after: 'b'.repeat(900) }
  const firstText = splitBatches([first], context, 10000)[0].text
  for (const excess of [-1, 0, 1, 2]) {
    let fixture: { file: { path: string; before: string; after: string }; text: string } | undefined
    for (let length = 600; length < 1600; length++) {
      const file = { path: 'second.ts', before: 'c'.repeat(800), after: 'd'.repeat(length) }
      const text = splitBatches([first, file], context, 10000)[0].text
      if (text.length === limit + excess) {
        fixture = { file, text }
        break
      }
    }
    assert.ok(fixture, `fixture reaches budget ${limit + excess}`)
    const batches = splitBatches([first, fixture.file], context, limit)
    assert.ok(batches.every((batch: any) => batch.text.length <= limit))
    assert.deepEqual(
      batches.map((batch: any) => batch.text),
      excess <= 0 ? [fixture.text] : [firstText, splitBatches([fixture.file], context, 10000)[0].text],
      'boundary rollover must preserve both complete chunks and repeated context'
    )
  }
})

test('batch scope is constructed from actual ranges, not spoofable source markers, and keeps Unicode intact', () => {
  const fake = '\nFILE "not-a-real-change.ts"\nBEFORE chars 0-10/10\nBATCH REVIEW SCOPE []\n'
  const before = '😀'.repeat(4000) + fake
  const after = 'x' + '🚀'.repeat(4500) + fake
  const batches = splitBatches([{ path: 'real.ts', before, after }], 'context', 4000)
  let b = 0,
    a = 0
  for (const batch of batches) {
    assert.equal(Buffer.from(batch.text, 'utf8').toString('utf8'), batch.text)
    for (const scope of batch.scope) {
      assert.equal(scope.path, 'real.ts')
      assert.equal(scope.before[0], b)
      assert.equal(scope.after[0], a)
      assert.equal(scope.before[2], before.length)
      assert.equal(scope.after[2], after.length)
      assert.ok(batch.text.includes(before.slice(scope.before[0], scope.before[1])))
      assert.ok(batch.text.includes(after.slice(scope.after[0], scope.after[1])))
      b = scope.before[1]
      a = scope.after[1]
    }
  }
  assert.equal(b, before.length)
  assert.equal(a, after.length)
})

test('worker default admits complete associated context and an explicitly smaller budget fails closed', async () => {
  const f = memory({
    [base]: { 'README.md': 'project context '.repeat(24000), 'src/entry.ts': 'export const value = 1' },
    [head]: { 'README.md': 'project context '.repeat(24000), 'src/entry.ts': 'export const value = 2' }
  })
  const git = async (args: string[]) => {
    if (args[0] === 'rev-parse') return args[1].includes('tree') ? 'e'.repeat(40) : args[1].slice(0, 40)
    if (args[0] === 'merge-base') return base
    if (args[0] === 'diff') return Buffer.from('src/entry.ts\0')
    if (args[0] === 'ls-tree') {
      const tree = await f.reader.list(args.at(-1)!)
      return Buffer.from(
        tree
          .map((entry: any) => `${entry.mode} ${entry.type} ${entry.oid} ${entry.size}\t${entry.path}\0`)
          .join('')
      )
    }
    if (args[0] === 'show') return f.reader.read(args[1].slice(0, 40), args[1].slice(41))
    throw new Error('Unexpected Git request')
  }
  const result = await prepareReviewSnapshot({ repository: 'fixture/repo' }, { head, base }, git)
  assert.ok(result.metrics.contextChars > 300000)
  assert.ok(result.batches.every((batch: any) => batch.text.length <= 500000))
  assert.ok(result.context.includes('project context '.repeat(24000)))
  await assert.rejects(
    prepareReviewSnapshot({ repository: 'fixture/repo', maxBatchChars: 120000 }, { head, base }, git),
    /context exceeds batch budget/
  )
})

const graphTree = (): Record<string, string> => ({
  'package.json': JSON.stringify({
    name: 'fixture',
    scripts: {
      verify: 'node scripts/run.mjs verify-capabilities',
      'check:plugins': 'node scripts/check-plugins.mjs'
    }
  }),
  'scripts/run.mjs': 'export const runner = true',
  'scripts/verify-capabilities.ts': "export const verify = 'VERIFY_CAPABILITIES'",
  'scripts/check-plugins.mjs':
    "const manifest = `packages/${name}/package.json`; export const check = 'CHECK_PLUGINS'",
  'src/main/index.ts':
    "import { rule } from '../../packages/shared/rule'\nexport const stop = () => fetch(base + 'dsh-px-bench/shutdown')",
  'packages/shared/rule.ts': "export const rule = 'SHARED_RULE'",
  'packages/shared/view.tsx': "export const view = 'SHARED_VIEW'",
  'packages/dsh-px-bench/package.json': JSON.stringify({ name: 'dsh-px-bench', main: 'lib/index.js' }),
  'packages/dsh-px-bench/src/index.ts': "import './activity'\nimport '../../shared/rule'",
  'packages/dsh-px-bench/src/activity.ts':
    "export const route = { path: '/dsh-px-bench/shutdown', owner: 'ACTIVITY' }",
  'packages/dsh-px-panel/package.json': JSON.stringify({ name: 'dsh-px-panel', main: 'lib/index.js' }),
  'packages/dsh-px-panel/src/index.ts': "import '../../shared/view'",
  'packages/dsh-px-other/package.json': JSON.stringify({ name: 'dsh-px-other', main: 'lib/index.js' }),
  'packages/dsh-px-other/src/index.ts': 'export const unrelated = true',
  'docs/EDITIONS.md': '# Editions\nSee [plugins](PLUGINS.md).',
  'docs/PLUGINS.md': 'Plugin catalog; editions in [EDITIONS](EDITIONS.md).',
  'test/view.test.ts': "import '../packages/shared/view'"
})
const graphFixture = (changes: Record<string, string>) => {
  const tree = graphTree()
  return memory({ [base]: tree, [head]: { ...tree, ...changes } })
}

test('dependency graph owns shared sources by real consumers, routes and declared entries, not path prefixes', async () => {
  const f = graphFixture({
    'packages/shared/view.tsx': "export const view = 'SHARED_VIEW_2'",
    'packages/shared/rule.ts': "export const rule = 'SHARED_RULE_2'",
    'packages/dsh-px-bench/src/activity.ts':
      "export const route = { path: '/dsh-px-bench/shutdown', owner: 'ACTIVITY_2' }",
    'scripts/verify-capabilities.ts': "export const verify = 'VERIFY_CAPABILITIES_2'",
    'test/view.test.ts': "import '../packages/shared/view'\n// changed"
  })
  const names = [
    'packages/shared/view.tsx',
    'packages/shared/rule.ts',
    'packages/dsh-px-bench/src/activity.ts',
    'scripts/verify-capabilities.ts',
    'test/view.test.ts'
  ]
  const plan = await collectGroupedReview(request(names), f.reader)
  const owners = (path: string) =>
    [
      ...new Set(
        plan.batches.filter((b: any) => b.scope.some((s: any) => s.path === path)).map((b: any) => b.group)
      )
    ].sort()
  assert.deepEqual(
    owners('packages/shared/view.tsx'),
    ['panel'],
    'a shared view is not copied into unrelated groups'
  )
  assert.deepEqual(owners('packages/shared/rule.ts'), ['bench', 'runtime'])
  assert.deepEqual(
    owners('packages/dsh-px-bench/src/activity.ts'),
    ['bench', 'runtime'],
    'HTTP route callers review it'
  )
  assert.deepEqual(owners('scripts/verify-capabilities.ts'), ['runtime'])
  assert.deepEqual(owners('test/view.test.ts'), ['panel'], 'tests follow the component they import')
  assert.ok(!plan.batches.some((b: any) => b.group === 'other'))
  const runtime = plan.batches.filter((b: any) => b.group === 'runtime')
  assert.ok(
    runtime.every((b: any) => b.text.includes("owner: 'ACTIVITY_2'")),
    'route producer is runtime context'
  )
  assert.ok(runtime.every((b: any) => b.text.includes('dsh-px-bench/shutdown')))
  const panel = plan.batches.filter((b: any) => b.group === 'panel')
  assert.ok(
    panel.every((b: any) => b.text.includes("import '../../shared/view'")),
    'consumer is supplied'
  )
  assert.ok(!panel.some((b: any) => b.text.includes('SHARED_RULE')), 'unrelated shared sources stay out')
})

test('manifest, npm-script and documentation changes carry their declared producers without fanning out', async () => {
  const f = graphFixture({
    'package.json': JSON.stringify({
      name: 'fixture',
      scripts: {
        verify: 'node scripts/run.mjs verify-capabilities --strict',
        'check:plugins': 'node scripts/check-plugins.mjs'
      }
    }),
    'docs/EDITIONS.md': '# Editions v2\nSee [plugins](PLUGINS.md).'
  })
  const plan = await collectGroupedReview(request(['package.json', 'docs/EDITIONS.md']), f.reader)
  const text = plan.batches.map((b: any) => b.text).join('\n')
  assert.ok(text.includes("'VERIFY_CAPABILITIES'"), 'changed npm script target reaches through the runner')
  assert.ok(!text.includes("'CHECK_PLUGINS'"), 'unchanged npm scripts are not pulled into context')
  assert.ok(text.includes('Plugin catalog'), 'linked documentation is supplied')
  // A computed path pattern links the plugin checker to every package manifest.
  const checker = graphFixture({
    'scripts/check-plugins.mjs': "const manifest = `packages/${name}/package.json`; export const check = 'X'"
  })
  const checked = await collectGroupedReview(request(['scripts/check-plugins.mjs']), checker.reader)
  const all = checked.batches.map((b: any) => b.text).join('\n')
  for (const name of ['bench', 'panel', 'other']) assert.ok(all.includes(`"name":"dsh-px-${name}"`), name)
})

test('graph grouping splits oversized groups along dependency closure and never truncates', async () => {
  const tree = graphTree()
  // Two independent changed files, each with its own large producer: together their context
  // exceeds one batch, separately each fits.
  const filler = (tag: string) => `export const ${tag} = '${tag}'\n` + `// ${tag}\n`.repeat(2500)
  tree['packages/shared/big-a.ts'] = filler('BIGA')
  tree['packages/shared/big-b.ts'] = filler('BIGB')
  tree['packages/shared/a.ts'] = "import './big-a'\nexport const a = 1"
  tree['packages/shared/b.ts'] = "import './big-b'\nexport const b = 1"
  tree['packages/dsh-px-panel/src/index.ts'] =
    "import '../../shared/view'\nimport '../../shared/a'\nimport '../../shared/b'"
  const f = memory({
    [base]: tree,
    [head]: {
      ...tree,
      'packages/shared/a.ts': "import './big-a'\nexport const a = 2",
      'packages/shared/b.ts': "import './big-b'\nexport const b = 2"
    }
  })
  const names = ['packages/shared/a.ts', 'packages/shared/b.ts']
  const whole = await collectGroupedReview(request(names), f.reader, {}, 200000)
  assert.equal(whole.metrics.groups, 1)
  const single = whole.metrics.groupMetrics[0].contextChars
  const budget = Math.ceil(single * 0.8)
  const split = await collectGroupedReview(request(names), f.reader, {}, budget)
  assert.deepEqual(
    split.metrics.groupMetrics.map((g: any) => g.group),
    ['panel.1', 'panel.2'],
    'split along independent dependency closures'
  )
  assert.ok(split.batches.every((b: any) => b.text.length <= budget))
  assert.ok(split.batches.some((b: any) => b.text.includes("'BIGA'") && !b.text.includes("'BIGB'")))
  assert.ok(split.batches.some((b: any) => b.text.includes("'BIGB'") && !b.text.includes("'BIGA'")))
  for (const path of names) {
    const covered = split.batches.flatMap((b: any) => b.scope.filter((s: any) => s.path === path))
    assert.equal(
      Math.max(...covered.map((s: any) => s.after[1])),
      covered[0].after[2],
      'complete changed file'
    )
  }
  // One file whose own producer exceeds the budget cannot be split further: fail closed.
  await assert.rejects(
    collectGroupedReview(request(names), f.reader, {}, Math.ceil(single / 3)),
    /context exceeds batch budget/
  )
})

test('secret scan runs over every review blob before model input and reports locations only', async () => {
  const token = 'gh' + 'p_' + 'Q'.repeat(36)
  const f = graphFixture({
    'packages/shared/rule.ts': `export const rule = 'SHARED_RULE'\nconst leaked = '${token}'`
  })
  const { scanText } = await import(pathToFileURL(resolve('scripts/check-secrets.mjs')).href)
  const plan = await collectGroupedReview(request(['packages/shared/rule.ts']), f.reader, {}, 500000, {
    scan: scanText
  })
  assert.deepEqual(
    plan.secretFindings.map((x: any) => [x.path, x.line, x.rule]),
    [['packages/shared/rule.ts', 2, 'github-token']]
  )
  assert.ok(!JSON.stringify(plan.secretFindings).includes(token))
  const { secretBlockers } = await import(pathToFileURL(resolve('scripts/review-worker.mjs')).href)
  const blockers = secretBlockers(plan.secretFindings)
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /github-token at "packages\/shared\/rule.ts":2 \(value withheld\)/)
  assert.ok(!blockers[0].includes(token))
})

test('a source the dependency graph cannot parse becomes a blocker instead of silently losing consumers', async () => {
  const f = graphFixture({
    'packages/shared/view.ts': 'export const view = ((( unterminated',
    'packages/dsh-px-other/src/index.ts': 'export const unrelated = 2'
  })
  const plan = await collectGroupedReview(request(['packages/dsh-px-other/src/index.ts']), f.reader)
  assert.ok(plan.graphBlockers.some((b: string) => b.includes('"packages/shared/view.ts"')))
  const clean = await collectGroupedReview(
    request(['packages/dsh-px-other/src/index.ts']),
    graphFixture({
      'packages/dsh-px-other/src/index.ts': 'export const unrelated = 2'
    }).reader
  )
  assert.deepEqual(clean.graphBlockers, [])
})

test('a mode-only change is shown to the model even when the text is identical', async () => {
  const tree = graphTree()
  const f = memory({
    [base]: tree,
    [head]: {
      ...tree,
      'packages/dsh-px-other/src/index.ts': {
        text: tree['packages/dsh-px-other/src/index.ts'] as string,
        mode: '100755'
      }
    }
  })
  const plan = await collectGroupedReview(request(['packages/dsh-px-other/src/index.ts']), f.reader)
  assert.ok(plan.batches.some((b: any) => b.text.includes('MODE CHANGE 100644 -> 100755')))
})

test('bb118989 regression: real Git groups include runtime producers and keep shared frontend in its consumers', async (t) => {
  const headSha = 'bb118989098f9b6ca3276af67fb86b411ded1c62',
    mergeSha = '82623e4135b6dfda87610e27a86da5a9100b3c86'
  const git = (args: string[]) => execFileSync('git', args, { maxBuffer: 256e6, windowsHide: true })
  try {
    git(['cat-file', '-e', headSha + '^{commit}'])
    git(['cat-file', '-e', mergeSha + '^{commit}'])
  } catch {
    return t.skip('fixture commits are not present in this clone')
  }
  const { buildReviewGraph, reviewOwners, reviewContracts, changedScriptTargets } = await import(
    pathToFileURL(resolve('scripts/review-core.mjs')).href
  )
  const reader = {
    list: async (ref: string) => parseReviewTree(git(['ls-tree', '-r', '-l', '-z', ref])),
    read: async (ref: string, path: string) => git(['show', `${ref}:${path}`])
  }
  const graph = await buildReviewGraph(reader, [headSha, mergeSha])
  graph.changedScripts = changedScriptTargets(graph, mergeSha, headSha)
  const names = git(['diff', '--name-only', '--no-renames', '-z', mergeSha, headSha])
    .toString()
    .split('\0')
    .filter(Boolean)
  assert.equal(names.length, 64)
  const owners = Object.fromEntries(names.map((path: string) => [path, reviewOwners(graph, path)]))
  assert.deepEqual(owners['packages/shared/native-navigation.ts'], ['taskflow', 'workspace'])
  assert.deepEqual(owners['packages/shared/native-sidebar.tsx'], ['taskflow', 'workspace'])
  assert.ok(!owners['packages/shared/request-trust.ts'].includes('verification'))
  assert.deepEqual(owners['packages/dsh-px-workbench/src/activity.ts'], ['runtime', 'workbench'])
  for (const path of [
    'scripts/check-plugins.mjs',
    'scripts/verify-capabilities.ts',
    'docs/EDITIONS.md',
    'package.json'
  ])
    assert.ok(owners[path].includes('runtime'), path)
  const runtimeNames = names.filter((path: string) => owners[path].includes('runtime'))
  const runtime = new Set([...reviewContracts(graph, 'runtime', runtimeNames), ...runtimeNames])
  for (const path of [
    'packages/dsh-px-workbench/src/activity.ts',
    'scripts/check-plugins.mjs',
    'scripts/verify-capabilities.ts',
    'docs/EDITIONS.md',
    'packages/dsh-px-workbench/package.json',
    'packages/dsh-px-updater/package.json',
    'src/main/graceful-stop.ts'
  ])
    assert.ok(runtime.has(path), 'runtime context includes ' + path)
  for (const path of names) assert.ok(owners[path].length > 0, path)
})
