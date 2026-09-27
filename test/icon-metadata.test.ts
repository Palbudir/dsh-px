import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
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
import { build } from 'esbuild'

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const outputNames = ['icon.png', 'icon-256.png', 'tray-16.png', 'tray-32.png']

async function fixture(t: TestContext) {
  const parent = realpathSync(tmpdir()),
    root = realpathSync(mkdtempSync(join(parent, 'dshpx-icon-metadata-')))
  t.after(() => {
    assert.ok(root.startsWith(parent + sep))
    rmSync(root, { recursive: true, force: true })
  })
  const output = join(root, 'build'),
    sharp = join(root, 'runtime/dsh/node_modules/sharp')
  mkdirSync(output)
  mkdirSync(sharp, { recursive: true })
  const marker = join(root, 'sharp-loaded')
  // Exercise the real script CLI and metadata writes without adding a native CI dependency.
  writeFileSync(
    join(sharp, 'index.js'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)},'loaded');module.exports=buf=>{let size;return {resize(w,h){size=[w,h];return this},png(){return this},async toBuffer(){return Buffer.from(JSON.stringify({size,source:buf.toString('base64')}))}}};`
  )
  const entry = join(root, 'build-icon.mjs')
  await build({
    entryPoints: [resolve('scripts/build-icon.ts')],
    outfile: entry,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    logLevel: 'silent'
  })
  const source = Buffer.from('synthetic local icon fixture')
  writeFileSync(join(output, 'icon-source.png'), source)
  const run = (override?: string) => {
    const env: NodeJS.ProcessEnv = { ...process.env, DSH_PX_REPO: root, NODE_OPTIONS: '', NODE_PATH: '' }
    delete env.DSH_PX_ICON_SHA256
    if (override !== undefined) env.DSH_PX_ICON_SHA256 = override
    return spawnSync(process.execPath, [entry], {
      cwd: root,
      windowsHide: true,
      env,
      encoding: 'utf8',
      timeout: 10000
    })
  }
  return { output, source, run, marker }
}

test('icon CLI metadata is deterministic and lists all four outputs with an explicit source override', async (t) => {
  const f = await fixture(t),
    expected = digest(f.source)
  const first = f.run(expected)
  assert.equal(first.status, 0, first.stderr)
  const metadata = readFileSync(join(f.output, 'icon-meta.json'))
  const parsed = JSON.parse(metadata.toString('utf8'))
  assert.equal(Object.hasOwn(parsed, 'generatedAt'), false)
  assert.equal(parsed.sha256, expected)
  assert.deepEqual(
    parsed.outputs,
    outputNames.map((name) => 'build/' + name)
  )
  const images = outputNames.map((name) => readFileSync(join(f.output, name)))
  const second = f.run(expected)
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(readFileSync(join(f.output, 'icon-meta.json')), metadata)
  outputNames.forEach((name, i) => assert.deepEqual(readFileSync(join(f.output, name)), images[i]))
})

test('default source pin matches NOTICE and rejects changed artwork before loading sharp or writing outputs', async (t) => {
  const f = await fixture(t)
  const trackedMeta = readFileSync('build/icon-meta.json', 'utf8')
  const meta = JSON.parse(trackedMeta)
  assert.equal(trackedMeta.replaceAll('\r\n', '\n'), JSON.stringify(meta, null, 2) + '\n')
  assert.ok(readFileSync('NOTICE.md', 'utf8').includes(meta.sha256))
  const sentinels = [...outputNames, 'icon-meta.json']
  for (const name of sentinels) writeFileSync(join(f.output, name), 'existing ' + name)
  const result = f.run()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /素材摘要不匹配/)
  assert.ok(result.stderr.includes('期望 ' + meta.sha256))
  assert.equal(existsSync(f.marker), false)
  for (const name of sentinels) assert.equal(readFileSync(join(f.output, name), 'utf8'), 'existing ' + name)
})

test('an incorrect explicit source digest also fails before any output is created', async (t) => {
  const f = await fixture(t)
  for (const override of ['0'.repeat(64), '', 'not-a-sha256']) {
    const result = f.run(override)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /素材摘要不匹配/)
  }
  assert.equal(existsSync(f.marker), false)
  for (const name of [...outputNames, 'icon-meta.json']) assert.equal(existsSync(join(f.output, name)), false)
})
