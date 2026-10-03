import { Lexer } from 'marked'
import { quoteWhitespace } from '../../shared/quote-whitespace'

function decode(text: string): string {
  const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, name: string) => {
    if (name[0] !== '#') return names[name.toLowerCase()] ?? whole
    const value = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole
  })
}
function visible(tokens: any[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'code' || token.type === 'codespan')
        return token.text + (token.type === 'code' ? '\n' : '')
      if (token.type === 'br' || token.type === 'space' || token.type === 'hr') return '\n'
      if (token.type === 'def') return ''
      if (token.type === 'list') return token.items.map((item: any) => visible(item.tokens)).join('\n')
      if (token.type === 'table')
        return [token.header, ...token.rows]
          .map((row) => row.map((cell: any) => visible(cell.tokens)).join('\t'))
          .join('\n')
      if (token.type === 'html')
        return decode(token.text.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ''))
      const text = token.tokens ? visible(token.tokens) : decode(token.text ?? '')
      return text + (['paragraph', 'heading', 'blockquote'].includes(token.type) ? '\n\n' : '')
    })
    .join('')
}
/** Text-only Markdown projection; never evaluates or renders HTML. Bound expensive fallback work. */
export function visibleMessageText(source: string): string | undefined {
  if (source.length > 1_000_000) return undefined
  try {
    return visible(Lexer.lex(source, { gfm: true }))
  } catch {
    return undefined
  }
}
export function quoteMatches(source: string, quote: string): boolean {
  if (source.includes(quote)) return true
  const rendered = visibleMessageText(source)
  return (
    rendered !== undefined &&
    !!quoteWhitespace(quote) &&
    quoteWhitespace(rendered).includes(quoteWhitespace(quote))
  )
}
export function visibleQuoteOffset(source: string, quote: string): number {
  const chars: string[] = [],
    offsets: number[] = []
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (/\s/u.test(character)) {
      if (chars.length && chars.at(-1) !== ' ') {
        chars.push(' ')
        offsets.push(index)
      }
    } else {
      chars.push(character)
      offsets.push(index)
    }
  }
  const found = chars.join('').indexOf(quoteWhitespace(quote))
  return found < 0 ? -1 : offsets[found]
}
