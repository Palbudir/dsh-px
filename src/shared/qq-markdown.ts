import { lexer } from 'marked'

function entities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (raw, value: string) => {
    const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (value[0] !== '#') return names[value.toLowerCase()] ?? raw
    const number =
      value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : parseInt(value.slice(1), 10)
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : raw
  })
}
function inline(tokens: readonly any[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'codespan') return token.text
      if (token.type === 'image') return '[图片' + (token.text ? '：' + token.text : '') + ']'
      if (token.type === 'link') {
        const label = inline(token.tokens ?? []),
          href = token.href ?? ''
        return label === href || !href ? label : label + ' (' + href + ')'
      }
      if (token.type === 'br') return '\n'
      if (token.tokens) return inline(token.tokens)
      return entities(String(token.text ?? token.raw ?? ''))
    })
    .join('')
}
function blocks(tokens: readonly any[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'space') return '\n'
      if (token.type === 'code') return token.text + '\n'
      if (token.type === 'blockquote') return blocks(token.tokens).replace(/^/gm, '> ') + '\n'
      if (token.type === 'list')
        return (
          token.items
            .map((item: any, index: number) => {
              const prefix = token.ordered ? String(Number(token.start) + index) + '. ' : '• '
              const content = blocks(item.tokens).replace(/\n+$/, '')
              return prefix + content.replace(/\n/g, '\n  ')
            })
            .join('\n') + '\n'
        )
      if (token.type === 'table') {
        const row = (cells: any[]) => cells.map((cell) => inline(cell.tokens ?? [])).join(' | ')
        return [row(token.header), ...token.rows.map(row)].join('\n') + '\n'
      }
      if (token.type === 'hr') return '——\n'
      if (token.tokens) return inline(token.tokens) + '\n'
      return entities(String(token.text ?? token.raw ?? '')) + '\n'
    })
    .join('')
}
/** Flatten Markdown structurally; code and intraword underscores are never treated as emphasis. */
export function qqPlainText(text: string): string {
  return blocks(lexer(text, { gfm: true })).replace(/^\n+|\n+$/g, '')
}
