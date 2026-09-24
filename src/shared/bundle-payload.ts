import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Copy only a bundle's declared release files; no source checkout, link or package-manager cache. */
export function copyBundlePayload(source: string, destination: string): void {
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  const files = ['package.json', ...((pkg.files as unknown[]) ?? [])]
  const copy = (from: string, to: string): void => {
    if (lstatSync(from).isSymbolicLink()) throw new Error(`受管插件载荷中存在外部链接：${from}`)
    if (statSync(from).isDirectory()) {
      mkdirSync(to, { recursive: true })
      for (const entry of readdirSync(from)) copy(join(from, entry), join(to, entry))
    } else {
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, to)
    }
  }
  for (const file of files) {
    if (typeof file !== 'string') throw new Error('受管插件 files 必须列出包内的确切载荷路径')
    const rel = relative(source, resolve(source, file))
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || /[*?!]/.test(file)) {
      throw new Error('受管插件 files 必须列出包内的确切载荷路径')
    }
    copy(join(source, file), join(destination, file))
  }
}
