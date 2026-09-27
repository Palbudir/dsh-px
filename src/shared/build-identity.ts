import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export function sourceFingerprint(root: string): string {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(entry.name)) continue
      const file = join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile() && /\.(?:[cm]?js|tsx?|json|ya?ml|html|css)$/.test(entry.name)) files.push(file)
    }
  }
  for (const name of ['src', 'packages', 'config']) walk(join(root, name))
  for (const name of ['package.json', 'electron.vite.config.ts'])
    if (existsSync(join(root, name))) files.push(join(root, name))
  const hash = createHash('sha256')
  for (const file of files.sort())
    hash
      .update(relative(root, file).replaceAll('\\', '/') + '\0')
      .update(readFileSync(file))
      .update('\0')
  return hash.digest('hex')
}
