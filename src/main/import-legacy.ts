import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { join, relative, resolve, sep, dirname, basename } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { WorkspaceStore, validateWorkspaceState } from '../../packages/dsh-px-workspace/src/store'

const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
function files(root: string): string[] {
  if (!existsSync(root)) return []
  if (lstatSync(root).isSymbolicLink()) throw new Error('数据目录不能是链接')
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name),
      stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error('导入目录包含链接，请先检查来源')
    return stat.isDirectory() ? files(path) : stat.isFile() ? [path] : []
  })
}
function safeTarget(path: string): void {
  for (let p = resolve(path); ; p = dirname(p)) {
    if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error('目标路径包含链接')
    if (dirname(p) === p) return
  }
}
function homes(source: string, target: string): { source: string; target: string } {
  const src = realpathSync(source),
    dst = existsSync(target) ? realpathSync(target) : resolve(target)
  const a = src.toLowerCase(),
    b = dst.toLowerCase()
  if (a === b || a.startsWith(b + sep) || b.startsWith(a + sep))
    throw new Error('来源和目标必须是独立数据目录')
  safeTarget(source)
  safeTarget(target)
  return { source: src, target: dst }
}
export function planLegacyImport(source: string, target: string) {
  const roots = homes(source, target)
  const sessions = files(join(roots.source, 'sessions')).filter((p) => /session\.v[34]\.jsonl\.zstd$/.test(p))
  const directories = [...new Set(sessions.map(dirname))]
  const conflicts = directories.filter((p) =>
    existsSync(join(roots.target, 'sessions', relative(join(roots.source, 'sessions'), p)))
  )
  const attachments = files(join(roots.source, 'attachments'))
  return { ...roots, sessionDirectories: directories, conflicts, attachments }
}
function assertOffline(source: string, target: string): void {
  for (const directory of [source, target]) {
    const profiles = join(directory, 'profiles')
    if (existsSync(profiles))
      for (const name of readdirSync(profiles))
        if (existsSync(join(profiles, name, 'lock'))) throw new Error('请退出来源和目标 DSH 服务后再导入')
  }
}
/** Preserve native per-record checkpoints; the native reader verifies log identity and row versions. */
function copyProjectionCaches(source: string, target: string, directories: string[]) {
  let copied = 0,
    skipped = 0
  for (const directory of directories) {
    const id = basename(directory)
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) continue
    if (!existsSync(join(target, 'sessions', relative(join(source, 'sessions'), directory)))) continue
    const src = join(source, 'storages', 'session_projcache', 'sessions', id + '.json')
    const dst = join(target, 'storages', 'session_projcache', 'sessions', id + '.json')
    if (!existsSync(src) || existsSync(dst)) {
      skipped++
      continue
    }
    safeTarget(src)
    safeTarget(dst)
    let record: any
    try {
      record = JSON.parse(readFileSync(src, 'utf8'))
    } catch {
      skipped++
      continue
    }
    if (![3, 4, 5, 6, 7].includes(record?.version) || !record.record?.identity || !record.record?.rows) {
      skipped++
      continue
    }
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst, constants.COPYFILE_EXCL)
    if (hash(src) !== hash(dst)) throw new Error('原生标题缓存副本校验失败')
    copied++
  }
  return { copied, skipped }
}
/** Supplement a completed import without copying logs again or overwriting an existing cache. */
export function restoreLegacyTitleCaches(source: string, target: string) {
  const plan = planLegacyImport(source, target)
  assertOffline(plan.source, plan.target)
  return copyProjectionCaches(plan.source, plan.target, plan.sessionDirectories)
}
/** Offline, additive import: never replaces a session, credentials, profile or plugin configuration. */
export function importLegacyData(source: string, target: string) {
  const plan = planLegacyImport(source, target)
  assertOffline(plan.source, plan.target)
  if (plan.conflicts.length)
    throw new Error(`有 ${plan.conflicts.length} 个会话目录已存在；请先处理冲突，导入不会覆盖它们`)
  const incomingPath = join(plan.source, 'storages', 'dsh-px-workspace', 'workspace.json')
  const incoming = existsSync(incomingPath) ? JSON.parse(readFileSync(incomingPath, 'utf8')) : undefined
  if (incoming) validateWorkspaceState(incoming)
  const statePath = join(plan.target, 'storages', 'dsh-px-workspace', 'workspace.json')
  safeTarget(statePath)
  const current = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, 'utf8'))
    : { version: 1, annotations: [], schedules: [] }
  validateWorkspaceState(current)
  const merged = structuredClone(current)
  if (incoming)
    for (const key of ['annotations', 'schedules'] as const) {
      const ids = new Set(merged[key].map((x: any) => x.id))
      for (const entry of incoming[key]) {
        if (ids.has(entry.id)) throw new Error('插件记录标识冲突；导入不会覆盖现有记录')
        const item = structuredClone(entry)
        if (key === 'schedules') {
          item.enabled = false
          item.nextAt = null
          item.updatedAt = Date.now()
          for (const event of item.history)
            if (['dispatching', 'queued', 'running'].includes(event.status)) {
              event.status = 'interrupted'
              event.detail = '从旧版导入，请先核对旧会话再启用。'
            }
        }
        merged[key].push(item)
      }
    }
  validateWorkspaceState(merged)
  // Check attachments before copying anything; equal content can be shared, different content cannot.
  for (const p of plan.attachments) {
    const dst = join(plan.target, 'attachments', relative(join(plan.source, 'attachments'), p))
    safeTarget(dst)
    if (existsSync(dst) && hash(dst) !== hash(p)) throw new Error('附件冲突；导入已停止')
  }
  const reportDir = join(plan.target, 'backups', 'px-import-' + randomUUID())
  safeTarget(reportDir)
  mkdirSync(reportDir, { recursive: true })
  const report = {
    source: plan.source,
    target: plan.target,
    complete: false,
    sessions: [] as string[],
    attachments: 0,
    annotations: incoming?.annotations.length ?? 0,
    schedulesPaused: incoming?.schedules.length ?? 0,
    titleCaches: 0
  }
  const save = () => writeFileSync(join(reportDir, 'import.json'), JSON.stringify(report, null, 2))
  save()
  if (existsSync(statePath))
    copyFileSync(statePath, join(reportDir, 'workspace-before.json'), constants.COPYFILE_EXCL)
  for (const p of plan.attachments) {
    const dst = join(plan.target, 'attachments', relative(join(plan.source, 'attachments'), p))
    if (!existsSync(dst)) {
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(p, dst, constants.COPYFILE_EXCL)
      report.attachments++
    }
  }
  for (const directory of plan.sessionDirectories) {
    const rel = relative(join(plan.source, 'sessions'), directory),
      dst = join(plan.target, 'sessions', rel)
    safeTarget(dst)
    const stage = join(reportDir, 'staging-' + randomUUID())
    mkdirSync(stage)
    for (const p of files(directory)) {
      const saved = join(stage, relative(directory, p))
      mkdirSync(dirname(saved), { recursive: true })
      copyFileSync(p, saved, constants.COPYFILE_EXCL)
      if (hash(saved) !== hash(p)) throw new Error('会话副本校验失败')
    }
    mkdirSync(dirname(dst), { recursive: true })
    renameSync(stage, dst)
    report.sessions.push(rel)
    save()
  }
  if (incoming) {
    const store = new WorkspaceStore(statePath)
    store.update((state) => Object.assign(state, merged))
  }
  report.titleCaches = copyProjectionCaches(plan.source, plan.target, plan.sessionDirectories).copied
  report.complete = true
  save()
  return {
    sessions: report.sessions.length,
    attachments: report.attachments,
    annotations: report.annotations,
    schedulesPaused: report.schedulesPaused,
    titleCaches: report.titleCaches,
    report: join(reportDir, 'import.json')
  }
}
