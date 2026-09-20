/**
 * 从 ZIP 中读出单个文件的内容（用于验证交付物里的真实代码）。
 *
 * 与 unzip-list.mjs 配套：那个列条目，这个取内容。
 * 只支持 deflate(8) 与 stored(0) —— electron-builder 产出这两种。
 *
 * 用法：
 *   node scripts/unzip-read.mjs <zip> <内部路径子串>
 */
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

/**
 * 读取 ZIP 中第一个"路径包含 needle"的文件。
 * @param {string} zipPath
 * @param {string} needle
 * @returns {{name: string, text: string} | null}
 */
export function readZipEntry (zipPath, needle) {
  const buf = readFileSync(zipPath)
  const EOCD_SIG = 0x06054b50
  const CD_SIG = 0x02014b50

  const maxBack = Math.min(buf.length, 22 + 0xffff)
  let eocd = -1
  for (let i = buf.length - 22; i >= buf.length - maxBack; i -= 1) {
    if (i < 0) break
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP')

  const entryCount = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)

  let p = cdOffset
  for (let i = 0; i < entryCount; i += 1) {
    if (buf.readUInt32LE(p) !== CD_SIG) throw new Error(`中央目录第 ${i} 条损坏`)
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)

    if (name.includes(needle)) {
      // 本地头长度可能与中央目录不同（含 extra 字段），必须从本地头读。
      const lhNameLen = buf.readUInt16LE(localOffset + 26)
      const lhExtraLen = buf.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + lhNameLen + lhExtraLen
      const data = buf.subarray(dataStart, dataStart + compSize)
      const text = method === 0
        ? data.toString('utf8')
        : inflateRawSync(data).toString('utf8')
      return { name, text }
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

// 允许直接运行
if (process.argv[1] && process.argv[1].endsWith('unzip-read.mjs')) {
  const [, , zip, needle] = process.argv
  if (!zip || !needle) {
    console.error('用法：node scripts/unzip-read.mjs <zip> <内部路径子串>')
    process.exit(1)
  }
  const r = readZipEntry(zip, needle)
  if (!r) { console.error('未找到匹配条目'); process.exit(1) }
  console.log(`=== ${r.name} (${r.text.length} 字节) ===`)
  console.log(r.text)
}
