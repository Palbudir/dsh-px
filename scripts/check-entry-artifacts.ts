import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot } from './paths'
import { managedArtifacts } from '../src/shared/plugin-catalog'

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
  ['out/preload/index.cjs', '进度页 preload'],
  ...managedArtifacts().map((path) => [path, '自制插件构建产物'])
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
      '  npm run build        # = build:plugins + build:main\n' +
      '\n注意 electron-builder **只打包、不构建**：直接调它会在 asar 健全性检查里\n' +
      '报 "Application entry file ... is corrupted"，那个措辞会把人往错误方向带。\n'
  )
  process.exit(1)
}

process.stdout.write('\n入口产物齐备，可以打包。\n')
