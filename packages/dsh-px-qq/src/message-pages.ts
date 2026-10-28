import { randomUUID } from 'node:crypto'
import { QqError } from './policy'

interface Entry {
  sessionId: string
  chatId: string
  until: number
  bytes: number
  message: any
}
const PAGE_BYTES = 8 * 1024 * 1024,
  CACHE_BYTES = 32 * 1024 * 1024,
  CACHE_MESSAGES = 100

/** Short-lived snapshots let long messages be read without accepting arbitrary message IDs. */
export class QqMessagePages {
  private entries = new Map<string, Entry>()
  clear(): void {
    this.entries.clear()
  }
  remember(messages: any[], sessionId: string, chatId: string): string[] {
    if (messages.length > 50) throw new QqError('单次群历史页过大，请减少条数', 413)
    const sizes = messages.map((m) => Buffer.byteLength(JSON.stringify(m)))
    const incoming = sizes.reduce((a, b) => a + b, 0)
    if (incoming > PAGE_BYTES) throw new QqError('群历史页超过八 MiB，请减少条数后读取', 413)
    for (const [key, entry] of this.entries) if (entry.until < Date.now()) this.entries.delete(key)
    let bytes = [...this.entries.values()].reduce((n, entry) => n + entry.bytes, 0)
    // Reserve the whole response before adding it: no reference from this page is evicted midway.
    while (this.entries.size + messages.length > CACHE_MESSAGES || bytes + incoming > CACHE_BYTES) {
      const key = this.entries.keys().next().value!
      bytes -= this.entries.get(key)!.bytes
      this.entries.delete(key)
    }
    return messages.map((message, index) => {
      const reference = randomUUID()
      this.entries.set(reference, {
        sessionId,
        chatId,
        message: structuredClone(message),
        bytes: sizes[index],
        until: Date.now() + 600000
      })
      return reference
    })
  }
  read(reference: unknown, sessionId: string, chatId: string): any {
    const entry = typeof reference === 'string' ? this.entries.get(reference) : undefined
    if (!entry || entry.sessionId !== sessionId || entry.chatId !== chatId || entry.until < Date.now())
      throw new QqError('消息引用不属于当前聊天或已过期，请重新读取群历史', 403)
    return entry.message
  }
}

export function messageParts(message: any): any[] {
  return Array.isArray(message.message)
    ? message.message
    : [{ type: 'text', data: { text: String(message.raw_message ?? '') } }]
}

/** Offsets count UTF-16 units, but pages never split a surrogate pair. */
export function messagePage(parts: any[], offset: number, textOffset: number, project: (part: any) => any) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > parts.length ||
    !Number.isSafeInteger(textOffset) ||
    textOffset < 0
  )
    throw new QqError('消息续读位置无效')
  if (offset === parts.length && textOffset) throw new QqError('消息已读完，文字偏移无效')
  let remaining = 8000,
    index = offset,
    within = textOffset
  const content: any[] = []
  for (; index < parts.length && content.length < 30; index++) {
    const part = parts[index],
      known = ['face', 'at', 'reply', 'image'].includes(part?.type)
    if (known) {
      if (within) throw new QqError('非文字消息段不能使用文字偏移')
      content.push({ ...project(part), segment: index })
      continue
    }
    const original = part?.type === 'text' ? String(part.data?.text ?? '') : JSON.stringify(part?.data ?? {})
    if (
      within > original.length ||
      (within > 0 &&
        /[\uDC00-\uDFFF]/.test(original[within] ?? '') &&
        /[\uD800-\uDBFF]/.test(original[within - 1]))
    )
      throw new QqError('文字续读位置无效')
    let end = Math.min(original.length, within + remaining)
    if (end < original.length && /[\uD800-\uDBFF]/.test(original[end - 1] ?? '')) end--
    if (end === within && original.length > within) break
    const value = original.slice(within, end)
    content.push({
      type: String(part?.type ?? 'unknown').slice(0, 30),
      text: value,
      segment: index,
      textOffset: within,
      totalCharacters: original.length
    })
    remaining -= value.length
    within = end
    if (within < original.length) break
    within = 0
    if (!remaining) {
      index++
      break
    }
  }
  return { content, next: index < parts.length ? { offset: index, textOffset: within } : null }
}
