import type { IncomingMessage } from 'node:http'
export async function readJsonBody(req: IncomingMessage, limit = 512000): Promise<any> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json'))
    throw new Error('请使用 JSON 请求')
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk)
    if (bytes > limit) throw new Error('请求内容过大')
    chunks.push(Buffer.from(chunk))
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 内容无效')
  return value
}
