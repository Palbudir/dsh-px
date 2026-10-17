import postcss from 'postcss'
import valueParser from 'postcss-value-parser'

export interface PreviewFile {
  absolutePath: string
  data: Uint8Array
  eof: boolean
}
export type ReadPreviewFile = (path: string, baseFile: string, signal: AbortSignal) => Promise<PreviewFile>
const MAX_FILE = 4 * 1024 * 1024,
  MAX_TOTAL = 32 * 1024 * 1024,
  MAX_FILES = 64
const encoder = new TextEncoder(),
  decoder = new TextDecoder('utf-8', { fatal: true })
const media: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm'
}
export function localPreviewReference(reference: string): boolean {
  return !!reference && !/^(?:[a-z][a-z\d+.-]*:|[/\\#?])/iu.test(reference)
}
function dataUrl(bytes: Uint8Array, type: string): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384))
  return `data:${type};base64,${btoa(binary)}`
}
/** Same native readBytes authority as DSH document previews; no file-serving credential enters the iframe. */
export async function prepareHtmlPreview(
  html: string,
  baseFile: string,
  read: ReadPreviewFile,
  signal: AbortSignal
): Promise<string> {
  let total = encoder.encode(html).length,
    count = 0
  if (total > MAX_TOTAL) throw Error('HTML 超过预览大小限制')
  const cache = new Map<string, Promise<PreviewFile>>()
  async function load(reference: string, base: string): Promise<PreviewFile> {
    signal.throwIfAborted()
    const path = decodeURIComponent(reference.split(/[?#]/u, 1)[0])
    if (!localPreviewReference(path) || path.includes('\0') || path.includes('\\'))
      throw Error('本地资源需要使用相对文件路径')
    const key = base + '\0' + path
    if (!cache.has(key)) {
      if (++count > MAX_FILES) throw Error('HTML 引用资源过多，请通过开发服务器预览')
      cache.set(
        key,
        (async () => {
          const file = await read(path, base, signal)
          signal.throwIfAborted()
          if (!file.eof || file.data.byteLength > MAX_FILE) throw Error('预览资源过大：' + reference)
          total += file.data.byteLength
          if (total > MAX_TOTAL) throw Error('HTML 和资源超过预览总大小限制')
          return file
        })()
      )
    }
    return cache.get(key)!
  }
  async function binary(reference: string, base: string): Promise<string> {
    if (!localPreviewReference(reference)) return reference
    const file = await load(reference, base),
      ext = file.absolutePath.split('.').at(-1)?.toLowerCase() ?? '',
      type = media[ext]
    if (!type) throw Error('此资源类型需要通过开发服务器预览：' + reference)
    const fragment = reference.includes('#') ? '#' + reference.split('#').slice(1).join('#') : ''
    return dataUrl(file.data, type) + fragment
  }
  async function values(value: string, base: string): Promise<string> {
    const parsed = valueParser(value),
      pending: Promise<void>[] = []
    parsed.walk((node) => {
      if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return
      const reference = valueParser
        .stringify(node.nodes)
        .trim()
        .replace(/^(['"])([\s\S]*)\1$/u, '$2')
      if (localPreviewReference(reference))
        pending.push(
          binary(reference, base).then((url) => {
            node.nodes = [{ type: 'string', quote: '"', value: url, sourceIndex: 0, sourceEndIndex: 0 }]
          })
        )
      return false
    })
    await Promise.all(pending)
    return parsed.toString()
  }
  async function stylesheet(text: string, base: string, ancestors: readonly string[] = []): Promise<string> {
    if (ancestors.includes(base) || ancestors.length >= 6) throw Error('样式表存在循环或过深引用')
    const root = postcss.parse(text, { from: undefined }),
      imports: any[] = [],
      decls: any[] = []
    root.walkAtRules('import', (r) => {
      imports.push(r)
    })
    for (const rule of imports) {
      const parsed = valueParser(rule.params),
        first = parsed.nodes.find((n) => n.type !== 'space' && n.type !== 'comment')
      const reference =
        first?.type === 'string'
          ? first.value
          : first?.type === 'function' && first.value.toLowerCase() === 'url'
            ? valueParser.stringify(first.nodes).replace(/^(['"])([\s\S]*)\1$/u, '$2')
            : undefined
      if (!reference || !localPreviewReference(reference)) continue
      const file = await load(reference, base),
        nested = await stylesheet(decoder.decode(file.data), file.absolutePath, [...ancestors, base])
      const tail = rule.params.slice(first!.sourceEndIndex).trim()
      if (/\b(?:layer|supports)\b/u.test(tail)) throw Error('此样式导入需要通过开发服务器预览')
      rule.replaceWith(postcss.parse(tail ? `@media ${tail}{${nested}}` : nested, { from: undefined }))
    }
    root.walkDecls((d) => {
      decls.push(d)
    })
    for (const d of decls) d.value = await values(d.value, base)
    signal.throwIfAborted()
    return root.toString()
  }
  const template = document.createElement('template')
  template.innerHTML = html
  const base = template.content.querySelector('base[href]')?.getAttribute('href')
  if (base && !/^https?:\/\//iu.test(base)) throw Error('带本地 base 路径的页面需要通过开发服务器预览')
  if (!base) {
    for (const el of template.content.querySelectorAll('script[src],link[href]')) {
      const script = el.localName === 'script',
        attr = script ? 'src' : 'href',
        ref = el.getAttribute(attr) ?? ''
      if (!localPreviewReference(ref)) continue
      if (!script && !(el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/u).includes('stylesheet'))
        continue
      if (
        script &&
        !['', 'text/javascript', 'application/javascript'].includes(
          (el.getAttribute('type') ?? '').trim().toLowerCase()
        )
      )
        throw Error('本地模块脚本需要通过开发服务器预览')
      const file = await load(ref, baseFile),
        source = decoder.decode(file.data)
      const text = script ? source : await stylesheet(source, file.absolutePath)
      el.setAttribute(attr, dataUrl(encoder.encode(text), script ? 'application/javascript' : 'text/css'))
      el.removeAttribute('integrity')
    }
    for (const el of template.content.querySelectorAll(
      'img[src],image[href],image[xlink\\:href],source[src],audio[src],video[src],video[poster]'
    )) {
      for (const attr of ['src', 'href', 'xlink:href', 'poster']) {
        const ref = el.getAttribute(attr)
        if (ref) el.setAttribute(attr, await binary(ref, baseFile))
      }
    }
    for (const el of template.content.querySelectorAll('style'))
      el.textContent = await stylesheet(el.textContent ?? '', baseFile)
    for (const el of template.content.querySelectorAll('[style]')) {
      const sheet = postcss.parse(`a{${el.getAttribute('style')}}`, { from: undefined })
      const rule = sheet.first as any
      for (const decl of rule?.nodes ?? [])
        if (decl.type === 'decl') decl.value = await values(decl.value, baseFile)
      el.setAttribute('style', (rule?.nodes ?? []).map((n: any) => n.toString()).join(';'))
    }
    for (const el of template.content.querySelectorAll('[srcset],iframe[src],object[data],embed[src]')) {
      const value = el.getAttribute('srcset') ?? el.getAttribute('src') ?? el.getAttribute('data') ?? ''
      if (localPreviewReference(value)) throw Error('此页面包含尚未打包的本地资源，请通过开发服务器预览')
    }
  }
  signal.throwIfAborted()
  return '<!doctype html>' + template.innerHTML
}
