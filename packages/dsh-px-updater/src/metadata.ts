import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'

const LIMIT = 2 * 1024 * 1024
/** Handles plain JSON, already-decoded fetch bodies, and encoded proxy responses. */
export function decodeMetadata(bytes: Uint8Array, encoding: string | null): Record<string, unknown> {
  if (bytes.byteLength > LIMIT) throw new Error('版本信息超过读取上限')
  let body = Buffer.from(bytes)
  const plain = (): boolean => /^[\s\uFEFF]*[\[{]/u.test(body.toString('utf8', 0, Math.min(256, body.length)))
  if (!plain()) {
    try {
      for (const item of (encoding ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .reverse()) {
        if (item === 'gzip' || item === 'x-gzip') body = gunzipSync(body, { maxOutputLength: LIMIT })
        else if (item === 'br') body = brotliDecompressSync(body, { maxOutputLength: LIMIT })
        else if (item === 'deflate') body = inflateSync(body, { maxOutputLength: LIMIT })
        else if (item !== 'identity') throw new Error('unsupported encoding')
      }
    } catch {
      throw new Error('版本服务返回的压缩数据无法读取，请稍后重试')
    }
  }
  try {
    const value = JSON.parse(body.toString('utf8').replace(/^\uFEFF/u, ''))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new Error('版本服务未返回有效的 JSON 信息，请稍后重试')
  }
}
export async function fetchMetadata(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'accept-encoding': 'identity', 'user-agent': 'dsh-px-updater' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('版本服务返回了空响应')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > LIMIT) {
          await reader.cancel()
          throw new Error('版本信息超过读取上限')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    return decodeMetadata(Buffer.concat(chunks), response.headers.get('content-encoding'))
  } catch (error) {
    if (controller.signal.aborted) throw new Error('版本查询超时，请稍后重试')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
