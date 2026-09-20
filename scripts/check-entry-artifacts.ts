/**
 * 打包前的入口产物断言。
 *
 * ## 为什么需要它（一次真实事故）
 *
 * beta-re.0.1 的发布在最后一步失败：
 *
 * ```
 * ⨯ Application entry file "out\main\index.js" in "...\app.asar" is corrupted:
 *   Error: "out\main\index.js" was not found in this archive
 * ```
 *
 * 原因是 `release.yml` 直接调 `npx electron-builder`，而 **electron-builder
 * 只打包、不构建**。从前能碰巧成功，是因为入口是**入库**的 `app/main.mjs`；
 * 主进程迁到 TypeScript 后入口变成 `out/main/index.js` —— 那是构建产物，
 * 在 `.gitignore` 里。于是 app.asar 里根本没有入口文件。
 *
 * 这个坑特别隐蔽，有三层原因：
 *   1. 前面"装配 + 验证能力平价"全绿 —— 它们只验 harness，不碰 Electron 主进程；
 *   2. 报错措辞是 "corrupted"，容易往"文件损坏"方向查，而真实原因只是没构建；
 *   3. 本地 `npm run dist` 能成功（它的脚本里包含 build），只有 CI 走的是
 *      "直接调 electron-builder"这条路。
 *
 * 所以这里在打包**之前**用一句直白的话断言，并给出修法。
 *
 * 用法：`node scripts/check-entry-artifacts.mjs`
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot } from './paths'

const REPO = repoRoot()

/**
 * 打包必需的构建产物。
 *
 * 每一项都是"入库之外、必须现构建"的东西 —— 入库文件不需要断言，
 * git 自然会保证它在。
 */
const REQUIRED = [
  ['out/main/index.js', 'Electron 主进程（package.json 的 main 指向它）'],
  ['out/renderer/index.html', '首启/重启进度页（主进程用 loadFile 加载它）'],
  ['out/preload/index.mjs', '进度页 preload'],
  [join('packages', 'dsh-px-updater', 'lib', 'index.js'), '自研插件的宿主半边'],
  [join('packages', 'dsh-px-updater', 'lib', 'client.js'), '自研插件的客户端半边（设置页分区）']
]

let failed = false
for (const [rel, why] of REQUIRED) {
  const abs = join(REPO, rel)
  if (!existsSync(abs)) {
    process.stderr.write(`缺少构建产物 ${rel}（${why}）\n`)
    failed = true
    continue
  }
  const size = statSync(abs).size
  if (size === 0) {
    process.stderr.write(`构建产物 ${rel} 是空文件（${why}）\n`)
    failed = true
    continue
  }
  process.stdout.write(`OK  ${rel}  ${size} 字节  —— ${why}\n`)
}

if (failed) {
  process.stderr.write(
    '\n这些不是入库文件，必须先在打包前构建：\n' +
    '  npm run build        # = build:client + build:main\n' +
    '\n注意 electron-builder **只打包、不构建**：直接调它会在 asar 健全性检查里\n' +
    '报 "Application entry file ... is corrupted"，那个措辞会把人往错误方向带。\n'
  )
  process.exit(1)
}

process.stdout.write('\n入口产物齐备，可以打包。\n')
