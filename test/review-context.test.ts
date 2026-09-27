import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { collectReviewContext, reviewModuleReferences, parseReviewTree, splitBatches } = await import(
  pathToFileURL(resolve('scripts/review-core.mjs')).href
)
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
    'src/main/update-controller.ts':
      "import './update-bridge'; export const consumer = 'electron-updater caller'",
    'src/main/update-bridge.ts': 'export const bridge = true',
    'packages/dsh-px-updater/src/metadata.ts': 'export const feed = true'
  }
  const f = memory({ [base]: tree, [head]: tree })
  const result = await collectReviewContext(request(['docs/github/review-policy.json']), f.reader)
  for (const file of Object.keys(tree)) assert.ok(result.context.includes(file), file)
  assert.match(result.context, /electron-updater caller/)
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
