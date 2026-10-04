import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { validFeatureList, type PackDistribution } from '../shared/distribution'

export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** Read the regular-file subset produced by our Pack builder, before writing any paths. */
export function unpackFiles(archive: Buffer): Map<string, Buffer> {
  const data = gunzipSync(archive, { maxOutputLength: 128 * 1024 * 1024 })
  const files = new Map<string, Buffer>(),
    names = new Set<string>()
  const field = (header: Buffer, start: number, length: number) =>
    header
      .subarray(start, start + length)
      .toString('utf8')
      .split('\0')[0]
  let offset = 0,
    nextPath: string | undefined
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) return files
    let checksum = 0
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i]
    const sizeText = field(header, 124, 12).trim()
    if (!/^[0-7]+$/.test(sizeText) || checksum !== parseInt(field(header, 148, 8).trim(), 8))
      throw Error('Invalid Pack archive header')
    const size = parseInt(sizeText, 8),
      type = header[156] || 48
    if (offset + 512 + size > data.length) throw Error('Truncated Pack archive')
    const body = data.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === 120) {
      // PAX lengths are byte lengths; paths may contain Unicode or embedded newlines.
      for (let at = 0; at < body.length;) {
        const space = body.indexOf(32, at),
          length = Number(body.subarray(at, space).toString())
        if (
          space < at ||
          !Number.isSafeInteger(length) ||
          length <= space - at + 1 ||
          at + length > body.length
        )
          throw Error('Invalid Pack extended header')
        const record = body.subarray(space + 1, at + length - 1).toString('utf8')
        if (record.startsWith('path=')) nextPath = record.slice(5)
        at += length
      }
      continue
    }
    if (type === 76) {
      nextPath = body.toString('utf8').split('\0')[0]
      continue
    }
    const prefix = field(header, 345, 155)
    const name = nextPath ?? (prefix ? prefix + '/' : '') + field(header, 0, 100)
    nextPath = undefined
    if (type === 53) continue
    if (type !== 48) throw Error('Pack archive contains a link or unsupported entry')
    const parts = name.split('/')
    if (
      parts.shift() !== 'package' ||
      !parts.length ||
      parts.some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[\\:\x00-\x1f<>"|?*]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      )
    )
      throw Error('Unsafe Pack archive path')
    const path = parts.join('/'),
      key = path.toLowerCase()
    if (names.has(key)) throw Error('Duplicate Pack archive path')
    names.add(key)
    files.set(path, body)
  }
  throw Error('Pack archive has no end marker')
}

export interface PackContract {
  version: string
  hostVersion: string
  upstreamCommit: string
  protocolGeneration: number
  sourceCommit: string
}
export function extractPack(
  bytes: Buffer,
  destination: string,
  expected: PackContract,
  candidate = false
): void {
  const files = unpackFiles(bytes)
  const manifest = JSON.parse(files.get('package.json')?.toString('utf8') ?? '{}')
  if (
    manifest.name !== 'dsh-px-pack' ||
    manifest.version !== expected.version ||
    (['hostVersion', 'upstreamCommit', 'protocolGeneration', 'sourceCommit'] as const).some(
      (key) => manifest.dshPx?.[key] !== expected[key]
    ) ||
    (!candidate && (manifest.dshPx?.candidate !== false || manifest.dshPx?.sourceDirty !== false))
  )
    throw Error('Pack archive does not match the release contract')
  const distribution: PackDistribution = JSON.parse(files.get('distribution.json')?.toString('utf8') ?? '{}')
  if (
    distribution.schemaVersion !== 1 ||
    distribution.version !== expected.version ||
    distribution.foundation?.name !== 'dsh-px-core' ||
    !validFeatureList(distribution.features)
  )
    throw Error('Invalid Pack distribution')
  const coreFiles = new Map<string, Buffer>()
  for (const item of [distribution.foundation, ...distribution.features]) {
    if (
      item.version !== expected.version ||
      item.file !== `distribution/${item.name}-${expected.version}.tgz`
    )
      throw Error('Invalid Pack component identity')
    const content = files.get(item.file)
    if (!content || sha256(content) !== item.sha256) throw Error('Pack component checksum mismatch')
    if (item === distribution.foundation)
      for (const [name, data] of unpackFiles(content)) coreFiles.set(name, data)
  }
  const write = (file: string, content: Buffer) => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content, { flag: 'wx' })
  }
  write(join(destination, 'distribution.json'), files.get('distribution.json')!)
  for (const item of [distribution.foundation, ...distribution.features])
    write(join(destination, item.file), files.get(item.file)!)
  for (const [name, data] of coreFiles) write(join(destination, 'foundation', name), data)
}
