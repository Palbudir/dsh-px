import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'README.md',
  'CONTRIBUTING.md',
  'NOTICE.md',
  'AGENTS.md',
  ...readdirSync(join(root, 'docs'), { recursive: true })
    .filter((name) => name.endsWith('.md'))
    .map((name) => join('docs', name))
]
const errors = []
let links = 0
for (const file of files) {
  const path = join(root, file)
  if (!existsSync(path)) continue
  const source = readFileSync(path, 'utf8')
  if (/C:[\\/]Users[\\/]Administrator|C:[\\/]Palbudir|session-[a-f0-9]{8}-[a-f0-9]{4}/i.test(source))
    errors.push(`${file}: contains machine-specific paths or QA session identifiers`)
  for (const match of source.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue
    if (/^[a-z]+:/i.test(target)) {
      errors.push(`${file}: unsupported local link ${target}`)
      continue
    }
    const local = decodeURIComponent(target.split('#')[0])
    if (local && !existsSync(resolve(dirname(path), local))) errors.push(`${file}: missing link ${target}`)
    links++
  }
}
if (errors.length) {
  process.stderr.write(errors.join('\n') + '\n')
  process.exitCode = 1
} else console.log(`Documentation: ${files.length} files and ${links} local links checked`)
