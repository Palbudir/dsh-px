/**
 * 量化"最长路径"风险。
 *
 * Windows 默认的 MAX_PATH 是 260 字符。随附运行时来自 npm 包，里面存在很深的
 * node_modules 嵌套（例如 @opentelemetry/otlp-transformer/node_modules/@opentelemetry/
 * resources/build/esnext/detectors/platform/node/machine-id/...），一旦超出上限，
 * 复制、解压、安装都可能在用户机器上失败 —— 而失败点取决于用户的安装目录长度，
 * 因此在开发机上未必能复现，属于典型的"发布后才炸"的问题。
 *
 * 本脚本扫描 runtime/ 找出最长的相对路径，并算出"需要多短的安装前缀才安全"。
 *
 * 用法：
 *   node scripts/check-path-length.mjs
 */
import { readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot } from './paths'

const REPO = repoRoot()
const RUNTIME = join(REPO, 'runtime')
/** Windows 传统 MAX_PATH 上限。 */
const MAX_PATH = 260

let longest = { rel: '', len: 0 }
let over = 0
let scanned = 0

/** 递归扫描，记录最长相对路径。 */
function walk (dir, rel) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const childRel = rel ? `${rel}\\${e.name}` : e.name
    scanned += 1
    if (childRel.length > longest.len) longest = { rel: childRel, len: childRel.length }
    if (e.isDirectory()) walk(join(dir, e.name), childRel)
    else {
      // 只统计文件：目录本身不落盘，但文件路径才是真正会被截断的东西
      if (childRel.length > MAX_PATH) over += 1
    }
  }
}

try {
  if (!statSync(RUNTIME).isDirectory()) throw new Error('not a dir')
} catch {
  console.error(`[paths] 找不到 runtime/：${RUNTIME}\n  请先运行 npm run stage`)
  process.exit(1)
}

console.log('[paths] 正在扫描 runtime/（约 30 万个条目，稍候）…')
walk(RUNTIME, '')

console.log(`\n扫描条目：${scanned}`)
console.log(`最长相对路径：${longest.len} 字符`)
console.log(`  ${longest.rel}`)
console.log(`超过 ${MAX_PATH} 的文件数：${over}`)
console.log(`runtime/ 相对前缀：${'runtime\\'.length} 字符（当前所在位置不计入安装路径）`)

// 安装后运行时位于 <安装目录>\resources\runtime\<相对路径>
const wrap = '\\resources\\runtime\\'.length
const budget = MAX_PATH - longest.len - wrap
console.log('\n结论：')
console.log(`  安装后路径 = <安装目录> + "\\resources\\runtime\\" + <相对路径>`)
console.log(`  要让最长路径不超过 ${MAX_PATH}，安装目录本身不能超过 ${budget} 字符。`)
console.log(`  例：C:\\Users\\Administrator\\AppData\\Local\\Programs\\dsh-px 长度约 ` +
  `${'C:\\Users\\Administrator\\AppData\\Local\\Programs\\dsh-px'.length} 字符`)

if (over > 0) {
  console.log(
    `\n警告：有 ${over} 个文件的相对路径本身已超过 ${MAX_PATH} 字符。\n` +
    '  这意味着无论装到哪里，这些文件都无法在不启用长路径支持的情况下被正常处理。\n' +
    '  应对：在打包时裁剪这类深层开发用文件（如 *.d.ts / *.js.map / tests），\n' +
    '  或要求用户启用 Windows 长路径支持。'
  )
} else {
  console.log('\n未发现相对路径超限的文件；风险仅取决于用户选择的安装目录长度。')
}
