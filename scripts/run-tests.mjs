import { build } from 'esbuild'
import { readdirSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const input = join(root, 'test'),
  outputRoot = join(root, 'build-test', 'test-runs')
const output = join(outputRoot, randomUUID())
if (!resolve(output).startsWith(resolve(outputRoot) + sep)) throw new Error('Invalid test output directory')
mkdirSync(output, { recursive: true })
const entries = readdirSync(input, { recursive: true })
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
if (!entries.length) throw new Error('No source tests found')
await build({
  entryPoints: entries.map((name) => join(input, name)),
  outbase: input,
  outdir: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  logLevel: 'warning'
})
const result = spawnSync(
  process.execPath,
  ['--test', ...entries.map((name) => join(output, name.replace(/\.ts$/, '.js')))],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  }
)
process.exitCode = result.status ?? 1
if (result.status === 0) rmSync(output, { recursive: true, force: true })
else process.stderr.write(`Test output retained: ${output}\n`)
