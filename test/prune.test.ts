import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  lstatSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

test('pruning stays inside runtime, never follows links, and preserves dependency data directories', async (t) => {
  const parent = resolve('build-test')
  const root = mkdtempSync(join(parent, 'prune-regression-'))
  t.after(() => {
    assert.ok(root.startsWith(parent + '\\') || root.startsWith(parent + '/'))
    rmSync(root, { recursive: true, force: true })
  })
  const script = join(root, 'prune.mjs')
  await build({
    entryPoints: [resolve('scripts/prune-seed-home.ts')],
    outfile: script,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'warning'
  })
  const populate = (base: string) => {
    mkdirSync(join(base, 'runtime/dsh-home/profiles/web'), { recursive: true })
    mkdirSync(join(base, 'runtime/dsh/node_modules/example/test'), { recursive: true })
    writeFileSync(join(base, 'runtime/dsh/node_modules/example/test/data.json'), 'public dependency data')
    writeFileSync(join(base, 'runtime/dsh/node_modules/example/index.js.map'), 'source map')
    writeFileSync(join(base, 'runtime/dsh-home/.credentials.yaml'), 'synthetic private fixture')
  }
  const run = (repo: string) =>
    spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, DSH_PX_REPO: repo, DSH_PX_PROFILE: 'web' }
    })
  const ordinary = join(root, 'ordinary')
  populate(ordinary)
  mkdirSync(join(ordinary, 'runtime/dsh-home/.dsh-px-maintenance-trash/old/profile'), { recursive: true })
  writeFileSync(
    join(ordinary, 'runtime/dsh-home/.dsh-px-maintenance-trash/old/profile/private.json'),
    'synthetic retired profile'
  )
  const external = join(root, 'outside')
  mkdirSync(external)
  writeFileSync(join(external, 'keep.txt'), 'keep')
  symlinkSync(
    external,
    join(ordinary, 'runtime/dsh-home/sessions'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  const result = run(ordinary)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(external, 'keep.txt'), 'utf8'), 'keep')
  assert.throws(() => lstatSync(join(ordinary, 'runtime/dsh-home/sessions')), /ENOENT/)
  assert.equal(existsSync(join(ordinary, 'runtime/dsh-home/.credentials.yaml')), false)
  assert.equal(existsSync(join(ordinary, 'runtime/dsh-home/.dsh-px-maintenance-trash')), false)
  assert.equal(existsSync(join(ordinary, 'runtime/dsh/node_modules/example/index.js.map')), false)
  assert.equal(
    readFileSync(join(ordinary, 'runtime/dsh/node_modules/example/test/data.json'), 'utf8'),
    'public dependency data'
  )
  const alias = join(root, 'repository-alias')
  symlinkSync(ordinary, alias, process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(join(ordinary, 'runtime/dsh-home/.credentials.yaml'), 'untouched behind ancestor link')
  const ancestorResult = run(alias)
  assert.notEqual(ancestorResult.status, 0)
  assert.match(ancestorResult.stderr, /外部链接/)
  assert.equal(
    readFileSync(join(ordinary, 'runtime/dsh-home/.credentials.yaml'), 'utf8'),
    'untouched behind ancestor link'
  )
  const linked = join(root, 'linked')
  mkdirSync(linked)
  symlinkSync(
    join(ordinary, 'runtime'),
    join(linked, 'runtime'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  const rejected = run(linked)
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /外部链接/)
  assert.equal(
    readFileSync(join(ordinary, 'runtime/dsh/node_modules/example/test/data.json'), 'utf8'),
    'public dependency data'
  )
})
