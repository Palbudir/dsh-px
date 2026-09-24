import { closeSync, openSync, readSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { hash, noLinks, record } from './core'

/** Read exactly the independent first Zstd frame; event frames are never read or decoded. */
export function readSessionHeader(path: string): {
  id: string
  cwd: string
  revision: string
  bytesRead: number
} {
  noLinks(path)
  const fd = openSync(path, 'r'),
    chunks: Buffer[] = []
  let offset = 0
  const read = (size: number): Buffer => {
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > 65536)
      throw new Error('会话首帧超过维护读取上限')
    const bytes = Buffer.alloc(size)
    if (readSync(fd, bytes, 0, size, offset) !== size) throw new Error('会话首帧不完整')
    offset += size
    chunks.push(bytes)
    return bytes
  }
  try {
    if (read(4).readUInt32LE() !== 0xfd2fb528) throw new Error('不支持的会话压缩格式')
    const descriptor = read(1)[0]
    if (descriptor & 24) throw new Error('会话首帧格式无效')
    const single = (descriptor & 32) !== 0,
      sizeFlag = descriptor >>> 6,
      dictionary = descriptor & 3
    read(
      (single ? 0 : 1) +
        (dictionary === 3 ? 4 : dictionary) +
        (sizeFlag === 0 ? (single ? 1 : 0) : 1 << sizeFlag)
    )
    while (true) {
      const block = read(3).readUIntLE(0, 3),
        type = (block >>> 1) & 3
      if (type === 3) throw new Error('会话首帧块类型无效')
      read(type === 1 ? 1 : block >>> 3)
      if (block & 1) break
    }
    if (descriptor & 4) read(4)
    const frame = Buffer.concat(chunks)
    const plaintext = zstdDecompressSync(frame, { maxOutputLength: 65536 })
    const text = plaintext.toString('utf8')
    if (plaintext.indexOf(10) !== plaintext.length - 1 || plaintext.length === 0)
      throw new Error('首帧不是独立会话头，拒绝读取正文')
    let header: unknown
    try {
      header = JSON.parse(text)
    } catch {
      throw new Error('会话头 JSON 无效，拒绝读取正文')
    }
    if (
      !record(header) ||
      header.type !== 'session' ||
      header.version !== 3 ||
      typeof header.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(header.id) ||
      typeof header.cwd !== 'string'
    )
      throw new Error('不支持的会话头版本或标识')
    return { id: header.id, cwd: header.cwd, revision: hash(frame), bytesRead: offset }
  } finally {
    closeSync(fd)
  }
}
