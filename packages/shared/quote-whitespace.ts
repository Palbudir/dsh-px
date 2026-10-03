/** Browser paragraph boundaries differ from Markdown source line breaks. */
export const quoteWhitespace = (text: string): string => text.replace(/\s+/gu, ' ').trim()
