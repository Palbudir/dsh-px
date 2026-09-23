import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true
})
if (build.status !== 0) process.exit(build.status ?? 1)
const electron = createRequire(import.meta.url)('electron')
const data = process.env.DSH_PX_USER_DATA_DIR || join(process.env.APPDATA || homedir(), 'dsh-px-development')
process.stdout.write(`开发实例数据目录：${data}\n`)
const child = spawn(electron, [join(root, 'out/main/index.js')], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, DSH_PX_USER_DATA_DIR: data, DSH_PX_PORT: process.env.DSH_PX_PORT || '3100' }
})
child.on('error', (error) => {
  process.stderr.write(error.message + '\n')
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
