/**
 * Repair a broken Electron install after `npm install`.
 *
 * Observed on Windows: `npm install electron` can report success while leaving
 * `node_modules/electron/dist/` holding a single file (seen: `locales/sr.pak`
 * out of 75 archive entries). `require('electron')` then throws "Electron failed
 * to install correctly", and re-running electron's own `install.js` no-ops
 * because `@electron/get` reports a **cache hit** — the zip is fine, the
 * *extraction* is what failed.
 *
 * This script detects that state and repairs it from the cache instead of
 * re-downloading. It is wired to `postinstall`, so a fresh clone self-heals.
 *
 * It is a no-op when Electron is healthy or absent (CI stages the runtime but
 * does not need a GUI).
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
  log('electron not installed; nothing to do')
  process.exit(0)
}

const exeName = process.platform === 'win32' ? 'electron.exe' : 'electron'
const exePath = join(DIST, exeName)
const pathTxt = join(ELECTRON_DIR, 'path.txt')

/** A healthy install has the binary and the path file electron reads to find it. */
function healthy () {
  return existsSync(exePath) && existsSync(pathTxt)
}

if (healthy()) {
  log(`healthy: ${exePath}`)
  process.exit(0)
}

log('electron looks broken; attempting repair from the download cache')

/** Locate the cached archive for the installed electron version. */
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
    // Cache layout: <root>/<sha>/electron-v<version>-<platform>-<arch>.zip
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
  log('no cached archive found; run `npm install electron` again (it will download)')
  process.exit(0)
}
log(`using cached archive: ${archive} (${(statSync(archive).size / 1048576).toFixed(1)} MB)`)

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

const extract = archive.endsWith('.zip')
  ? spawnSync('tar', ['-xf', archive, '-C', DIST], { stdio: 'inherit' })
  : spawnSync('tar', ['-xzf', archive, '-C', DIST], { stdio: 'inherit' })

if (extract.status !== 0 || !existsSync(exePath)) {
  log(`repair failed (tar exited ${extract.status}); remove node_modules/electron and reinstall`)
  process.exit(0)
}

// electron's index.js reads this file to locate the binary; install.js normally
// writes it, so a manual extraction must write it too.
writeFileSync(pathTxt, exeName)
log(`repaired: ${exePath}`)
