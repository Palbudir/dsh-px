/**
 * 直接读取 ZIP 的中央目录，列出条目路径 —— 不依赖任何外部工具。
 *
 * 为什么需要它：校验安装包内容原本靠调用 7-Zip 读取 NSIS 载荷，
 * 但同一份安装包在本地与 CI 上表现不一致（本地列出 14 万条，CI 只列出 2 行），
 * 排查成本高且方向不确定。而 electron-builder 每次都会同时产出
 * `*-win.zip`，且其内容与安装包来自**同一个 win-unpacked 目录** ——
 * 校验 ZIP 同样能证明"交付物里有没有必备文件、有没有混入构建产物"。
 *
 * ZIP 是自描述的：末尾的中央目录记录了全部条目名。这里用 zlib 解压
 * 中央目录即可，纯 JS、跨平台、零依赖、结果确定。
 *
 * 用法：
 *   node scripts/unzip-list.mjs <zip 路径>          # 打印条目数与前若干条
 *   import { listZipEntries } from './unzip-list.mjs'
 */
import { readFileSync, existsSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

/**
 * 列出 ZIP 内所有条目路径。
 *
 * 实现要点：从文件尾部向前找 End Of Central Directory（EOCD，签名 0x06054b50），
 * 再据其记录的偏移与大小读出中央目录，逐条解析文件名。
 * 这样无需解压任何数据，对几百 MB 的包也是毫秒级。
 * @param {string} zipPath
 * @returns {string[]} 条目路径（正斜杠分隔）
 */
export function listZipEntries (zipPath) {
  const buf = readFileSync(zipPath)
  const EOCD_SIG = 0x06054b50
  const CD_SIG = 0x02014b50

  // EOCD 最少 22 字节；注释最长 65535，所以最多回看 22 + 65535。
  const maxBack = Math.min(buf.length, 22 + 0xffff)
  let eocd = -1
  for (let i = buf.length - 22; i >= buf.length - maxBack; i -= 1) {
    if (i < 0) break
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP：找不到 EOCD 记录')

  const entryCount = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)

  // ZIP64：条目数或偏移为哨兵值时，这里不展开（本项目的包远未到 4GB 条目上限）。
  if (entryCount === 0xffff || cdOffset === 0xffffffff) {
    throw new Error('该 ZIP 使用了 ZIP64 结构，本解析器未支持（请改用 7-Zip）')
  }
  if (cdOffset + cdSize > buf.length) throw new Error('ZIP 中央目录越界，文件可能损坏')

  const names: string[] = []
  let p = cdOffset
  for (let i = 0; i < entryCount; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) {
      throw new Error(`中央目录第 ${i} 条记录损坏（偏移 ${p}）`)
    }
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    names.push(name.replace(/\\/g, '/'))
    p += 46 + nameLen + extraLen + commentLen
  }
  return names
}

// 允许直接运行，便于人工检查。
//
// 判据是"**除本模块外没有任何参数**"而不是匹配文件名：脚本已改为 .ts 源码
// 经 `scripts/run.mjs` 编译后运行，运行期的 argv[1] 是
// `build-scripts/unzip-list.js`，写死 `.mjs`/`.ts` 都会失效。
// 以"被当作入口直接调用"为准，才对两种调用方式都成立。
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const target = process.argv[2]
  if (!target || !existsSync(target)) {
    console.error('用法：node scripts/run.mjs unzip-list <zip 路径>')
    process.exit(1)
  }
  const names = listZipEntries(target)
  console.log(`条目数：${names.length}`)
  console.log('前 10 条：')
  for (const n of names.slice(0, 10)) console.log('  ', n)
  const res = names.filter((n) => n.toLowerCase().startsWith('resources/'))
  console.log(`resources/ 下条目：${res.length}`)
}
