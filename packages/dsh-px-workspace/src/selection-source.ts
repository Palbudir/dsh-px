import type { Message } from './model'
import { InputError } from './store'

/** Resolve against the durable source, including selections beyond the first body page. */
export function selectionSource(source: Message | undefined, quote: unknown) {
  if (!source) throw new InputError('消息尚未保存或没有可引用的正文', 404)
  if (typeof quote !== 'string' || !quote.trim() || quote.length > 8000)
    throw new InputError('引用片段须为 1–8000 字符')
  const found = source.text.indexOf(quote)
  if (found < 0)
    throw new InputError('选区跨越了正文格式或内容已变化，请使用消息下方“引用 / 批注”在原文中选择')
  const offset = Math.max(0, found - 1000)
  return {
    ...source,
    text: source.text.slice(offset, offset + 32000),
    offset,
    length: source.text.length,
    nextOffset: offset + 32000 < source.text.length ? offset + 32000 : null
  }
}
