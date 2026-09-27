import { spawnSync } from 'node:child_process'

// Shared by branch verification and release; a gate failure always stops subsequent steps.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const commands = [
  [npm, ['run', 'typecheck']],
  [npm, ['run', 'check:repo']],
  [process.execPath, ['scripts/release-catalog.mjs']],
  [npm, ['run', 'test']],
  ['git', ['diff', '--exit-code', '--', 'packages']],
  [npm, ['run', 'stage', '--', '--with-plugins']],
  [npm, ['run', 'verify', '--', '--boot', '--json']]
]
for (const [exe, args] of commands) {
  const result = spawnSync(exe, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && exe === npm,
    windowsHide: true
  })
  if (result.error || result.status !== 0) {
    process.exitCode = result.status || 1
    break
  }
}
