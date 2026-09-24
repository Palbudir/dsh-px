/** Remove generated/private seed data before packaging, without following external links. */
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { repoRoot } from './paths'

const runtimeRoot = resolve(repoRoot(), 'runtime')
const seedHome = join(runtimeRoot, 'dsh-home')
const profileName = process.env.DSH_PX_PROFILE ?? 'web'
if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) throw new Error('profile 名无效')
const log = (text: string): void => {
  process.stdout.write(`[prune] ${text}\n`)
}
let ancestor = parse(runtimeRoot).root
for (const segment of relative(ancestor, runtimeRoot).split(sep).filter(Boolean)) {
  ancestor = join(ancestor, segment)
  try {
    const stat = lstatSync(ancestor)
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('runtime 清理路径不能经过外部链接或文件：' + ancestor)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
    throw error
  }
}
if (!existsSync(seedHome)) {
  log('没有装配种子，无需清理')
  process.exit(0)
}

function localTarget(path: string, allowRoot = false): string {
  const target = resolve(path),
    rel = relative(runtimeRoot, target)
  if ((!allowRoot && !rel) || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
    throw new Error('清理目标必须在当前仓库 runtime 内')
  const segments = rel ? rel.split(sep) : []
  let parent = runtimeRoot
  for (let i = 0; i <= segments.length; i++) {
    // The final target may itself be a link: rm removes it without visiting its destination.
    if (i < segments.length || target === runtimeRoot) {
      const stat = lstatSync(parent)
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('runtime 清理路径不能经过外部链接或文件：' + parent)
    }
    if (i < segments.length) parent = join(parent, segments[i])
  }
  return target
}
function size(path: string): number {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return 0
  if (!stat.isDirectory()) return stat.size
  return readdirSync(path).reduce((total, name) => total + size(join(path, name)), 0)
}
function remove(path: string): number {
  const target = localTarget(path)
  const bytes = size(target)
  rmSync(target, { recursive: true, force: true, maxRetries: 3 })
  return bytes
}
localTarget(runtimeRoot, true)
localTarget(join(seedHome, 'profiles', profileName))
const generated = [
  'profiles/node_modules',
  `profiles/${profileName}/.dsh-module-fallback`,
  `profiles/${profileName}/.dsh-market`,
  'storages',
  'sessions',
  'backups',
  'logs',
  'update-bridge',
  '.dsh-px-staging',
  '.dsh-px-migration-lock',
  '.dsh-px-maintenance-trash',
  '.credentials.yaml',
  'credentials.yaml',
  'settings.yaml',
  'service-state.json',
  '.dsh-px-managed-plugins.json',
  '.dsh-px-profile-transaction.json',
  '.dsh-px-maintenance-transaction.json',
  '.dsh-px-materialized',
  '.dsh-px-seed-claimed'
]
let freed = 0
for (const name of generated) {
  const target = join(seedHome, name)
  try {
    lstatSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
    throw error
  }
  freed += remove(target)
  log('已清理 ' + name)
}

let maps = 0
function trimSourceMaps(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (dir === runtimeRoot && entry.name === 'node') continue
      trimSourceMaps(path)
    } else if (/\.(?:[cm]?js|css|d\.ts)\.map$/.test(entry.name)) {
      freed += remove(path)
      maps++
    }
  }
}
// Preserve dependency test/data directories: package consumers may import them.
trimSourceMaps(runtimeRoot)
log(`已清理 ${maps} 个源映射；合计 ${(freed / 1048576).toFixed(1)} MB`)
log(`种子大小 ${(size(seedHome) / 1048576).toFixed(1)} MB；打包后仍须通过载荷校验`)
