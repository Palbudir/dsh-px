import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const { managed } = JSON.parse(readFileSync(join(repo, 'config/plugins.json'), 'utf8'))
const args = process.argv.slice(2)
if (args.some((a) => !['--host', '--client'].includes(a)))
  throw new Error('支持 --host 或 --client；无参数构建两侧')
const halves = args.length ? args.map((a) => a.slice(2)) : ['host', 'client']
for (const half of halves)
  for (const name of managed) {
    const result = spawnSync(
      process.execPath,
      [join(repo, `scripts/plugins/build-${half}.mjs`), join(repo, 'packages', name)],
      { stdio: 'inherit', windowsHide: true }
    )
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
