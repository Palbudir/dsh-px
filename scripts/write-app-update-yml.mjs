/**
 * 由 package.json 的 `build.publish` 生成 `app-update.yml`。
 *
 * 为什么需要这一步：electron-builder 只在**带发布**的构建里自动生成
 * `app-update.yml`（electron-updater 靠它知道去哪儿查更新）。而
 * `electron-builder --dir`（本地调试常用的快速打包）不会生成它，
 * 于是本地构建出来的应用一检查更新就报：
 *
 *     ENOENT: no such file or directory, open '…/resources/app-update.yml'
 *
 * 这让"本地验证自动更新"变得不可能 —— 只能靠真实的发布流程才发现问题。
 * 因此这里按 publish 配置显式生成，使 `npm run pack` 的产物也能自测更新。
 *
 * 用法：
 *   node scripts/write-app-update-yml.mjs [<目标 resources 目录>]
 * 默认写入 dist/win-unpacked/resources（或按平台对应的目录）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const log = (m) => process.stdout.write(`[app-update] ${m}\n`)

const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
const publish = pkg.build?.publish
if (!Array.isArray(publish) || publish.length === 0) {
  log('package.json 没有 build.publish 配置，跳过')
  process.exit(0)
}
const cfg = publish[0]

/** 按 electron-updater 的期望格式渲染。它接受扁平的 key: value。 */
const lines = Object.entries(cfg)
  .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
  .map(([k, v]) => `${k}: ${v}`)

// updater 缓存目录名：electron-updater 默认按 productName 生成，显式写出更稳。
lines.push(`updaterCacheDirName: ${(pkg.name ?? 'app').replace(/[^a-z0-9-_]/gi, '-')}-updater`)

const defaultDirs = [
  join(REPO, 'dist', 'win-unpacked', 'resources'),
  join(REPO, 'dist', 'mac', `${pkg.build?.productName ?? pkg.name}.app`, 'Contents', 'Resources'),
  join(REPO, 'dist', 'linux-unpacked', 'resources')
]

const requested = process.argv[2] ? [resolve(process.argv[2])] : defaultDirs
let written = 0
for (const dir of requested) {
  if (!existsSync(dir)) continue
  const out = join(dir, 'app-update.yml')
  writeFileSync(out, lines.join('\n') + '\n')
  log(`已写入 ${out}`)
  written += 1
}
if (written === 0) {
  log('没有找到已打包的 resources 目录；先运行 npm run pack')
  process.exit(0)
}
log(`内容：\n${lines.map((l) => '  ' + l).join('\n')}`)
