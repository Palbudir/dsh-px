/**
 * 在 `npm install` 之后修复被装坏的 Electron。
 *
 * Windows 上实测到的现象：`npm install electron` 可能报告成功，
 * 但 `node_modules/electron/dist/` 里只剩一个文件
 * （实测：75 个归档条目里只落下了 `locales/sr.pak`）。
 * 此时 `require('electron')` 会抛 "Electron failed to install correctly"，
 * 而重跑 electron 自己的 `install.js` 会直接空转 ——
 * 因为 `@electron/get` 报告 **cache hit**：zip 是好的，**解压**才是失败的那一步。
 *
 * 本脚本检测这种状态，并从缓存修复，而不是重新下载。
 * 它挂在 `postinstall` 上，因此新克隆的仓库会自愈。
 *
 * 当 Electron 健康或压根不存在时，它是一个空操作
 * （CI 只需要装配运行时，不需要 GUI）。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON_DIR = join(REPO, 'node_modules', 'electron')
const DIST = join(ELECTRON_DIR, 'dist')
const log = (m) => process.stdout.write(`[electron-repair] ${m}\n`)

if (!existsSync(join(ELECTRON_DIR, 'package.json'))) {
  log('未安装 electron，无需处理')
  process.exit(0)
}

const exeName = process.platform === 'win32' ? 'electron.exe' : 'electron'
const exePath = join(DIST, exeName)
const pathTxt = join(ELECTRON_DIR, 'path.txt')

/** 健康的安装应当同时具备二进制文件和 electron 用来定位它的 path.txt。 */
function healthy () {
  return existsSync(exePath) && existsSync(pathTxt)
}

if (healthy()) {
  log(`健康：${exePath}`)
  process.exit(0)
}

log('electron 看起来是坏的；尝试从下载缓存修复')

/** 找到与当前安装版本匹配的缓存归档。 */
function findCachedArchive () {
  const version = JSON.parse(readFileSync(join(ELECTRON_DIR, 'package.json'), 'utf8')).version
  const roots = [
    process.env.ELECTRON_CACHE,
    process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'electron', 'Cache')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches', 'electron')
        : join(homedir(), '.cache', 'electron')
  ].filter(Boolean)

  const wanted = `electron-v${version}-`
  for (const root of roots) {
    if (!existsSync(root)) continue
    // 缓存布局：<root>/<sha>/electron-v<版本>-<平台>-<架构>.zip
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry)
      let files = []
      try { files = readdirSync(dir) } catch { continue }
      for (const file of files) {
        if (file.startsWith(wanted) && /\.(zip|tar\.gz)$/.test(file)) return join(dir, file)
      }
    }
  }
  return null
}

const archive = findCachedArchive()
if (!archive) {
  log('没有找到缓存归档；请重跑 `npm install electron`（它会下载）')
  process.exit(0)
}
log(`使用缓存归档：${archive}（${(statSync(archive).size / 1048576).toFixed(1)} MB）`)

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

const extract = archive.endsWith('.zip')
  ? spawnSync('tar', ['-xf', archive, '-C', DIST], { stdio: 'inherit' })
  : spawnSync('tar', ['-xzf', archive, '-C', DIST], { stdio: 'inherit' })

if (extract.status !== 0 || !existsSync(exePath)) {
  log(`修复失败（tar 退出码 ${extract.status}）；请删除 node_modules/electron 后重装`)
  process.exit(0)
}

// electron 的 index.js 靠这个文件定位二进制；正常情况写它的是 install.js，
// 所以手工解压必须自己写它。
writeFileSync(pathTxt, exeName)
log(`已修复：${exePath}`)
