/** Ensure the installed Electron package has its matching official binary.
 * Electron 44's package does not run a postinstall download; the repository's
 * postinstall calls the vendor installer explicitly. Do not unpack caches with
 * a second, unverified archive implementation.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { repoRoot } from './paths'

const folder = join(repoRoot(), 'node_modules', 'electron')
if (!existsSync(join(folder, 'package.json'))) process.exit(0)
const version = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).version as string
const binary = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'
function healthy (): boolean {
  try {
    return existsSync(join(folder, 'dist', binary)) &&
      readFileSync(join(folder, 'dist', 'version'), 'utf8').trim().replace(/^v/, '') === version &&
      readFileSync(join(folder, 'path.txt'), 'utf8').trim() === binary
  } catch { return false }
}
if (!healthy()) {
  process.stdout.write(`[electron-setup] 正在准备官方 Electron ${version}…\n`)
  const result = spawnSync(process.execPath, [join(folder, 'install.js')], { stdio: 'inherit', windowsHide: true })
  if (result.error || result.status !== 0 || !healthy()) {
    process.stderr.write(`[electron-setup] Electron ${version} 未完成安装；请检查网络后重跑 npm install。\n`)
    process.exit(1)
  }
}
process.stdout.write(`[electron-setup] 已核对 Electron ${version} 与 ${binary}\n`)
