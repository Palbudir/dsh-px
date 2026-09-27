import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { withManagedProfileMaintenance } from '../main/managed-plugins'

export const maintenanceJournal = '.dsh-px-maintenance-transaction.json'
export const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
export const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)
export const record = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
export function inside(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
}
/** Verify every existing component without following a junction or symbolic link. */
export function noLinks(path: string): void {
  const absolute = resolve(path),
    root = parse(absolute).root
  let current = root
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, part)
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('维护目标不能经过链接或 Junction')
    } catch (error: any) {
      if (error?.code === 'ENOENT') return
      throw error
    }
  }
}
export function localPath(home: string, value: string): string {
  const target = resolve(home, value)
  if (!inside(target, home) || target === resolve(home)) throw new Error('维护路径超出指定数据目录')
  noLinks(target)
  return target
}
export interface MaintenanceOptions {
  userData: string
  repoRoot: string
  profileName?: string
}
export interface MaintenancePaths {
  userData: string
  home: string
  repoRoot: string
  qaRoot: string
  profileName: string
  scope: string
}
export function maintenancePaths(options: MaintenanceOptions): MaintenancePaths {
  if (!isAbsolute(options.userData) || !isAbsolute(options.repoRoot))
    throw new Error('数据目录和仓库必须使用绝对路径')
  noLinks(options.userData)
  noLinks(options.repoRoot)
  const userData = realpathSync(options.userData),
    repoRoot = realpathSync(options.repoRoot)
  const home = localPath(userData, 'dsh-home'),
    profileName = options.profileName ?? 'web'
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profileName) || !lstatSync(home).isDirectory())
    throw new Error('数据目录或 profile 无效')
  return {
    userData,
    home,
    repoRoot,
    qaRoot: localPath(repoRoot, 'build-test'),
    profileName,
    scope: hash([realpathSync(home), repoRoot, profileName].join('\0'))
  }
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    return error?.code !== 'ESRCH'
  }
}
export function assertOffline(paths: MaintenancePaths, isAlive = alive): void {
  const state = readJson(localPath(paths.userData, 'service-state.json'), 64000)
  if (
    !record(state) ||
    state.phase !== 'stopped' ||
    state.pid !== null ||
    typeof state.instanceId !== 'string' ||
    !Number.isSafeInteger(state.ownerPid) ||
    state.ownerPid <= 0 ||
    typeof state.ownerStartedAt !== 'string' ||
    !Number.isFinite(Date.parse(state.ownerStartedAt)) ||
    !Object.hasOwn(state, 'lastAgentPid') ||
    !(state.lastAgentPid === null || (Number.isSafeInteger(state.lastAgentPid) && state.lastAgentPid > 0)) ||
    !(state.pid === null || (Number.isSafeInteger(state.pid) && state.pid > 0))
  )
    throw new Error('缺少可验证的正常停机记录；请先成功启动支持维护记录的版本，并正常退出后再维护')
  for (const pid of new Set(
    [state.ownerPid, state.lastAgentPid, state.pid].filter((id): id is number => typeof id === 'number')
  ))
    if (isAlive(pid)) throw new Error(`目标桌面或 Agent 进程仍存在（PID ${pid}），拒绝离线维护`)
}
export async function offlineLease<T>(
  paths: MaintenancePaths,
  action: () => Promise<T> | T,
  allowPending = false
): Promise<T> {
  return withManagedProfileMaintenance({ home: paths.home, profileName: paths.profileName }, async () => {
    assertOffline(paths)
    if (!allowPending && existsSync(localPath(paths.home, maintenanceJournal)))
      throw new Error('存在未完成的维护事务，请先 recover')
    return await action()
  })
}
export function readJson(path: string, maxBytes = 32 * 1024 * 1024): any {
  return readSnapshot(path, maxBytes).value
}
export function readSnapshot(path: string, maxBytes = 32 * 1024 * 1024): { value: any; revision: string } {
  noLinks(path)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.size > maxBytes) throw new Error('维护元数据不是受支持的普通文件')
  const bytes = readFileSync(path)
  if (bytes.length > maxBytes) throw new Error('维护元数据大小已变化，拒绝读取')
  try {
    return { value: JSON.parse(bytes.toString('utf8')), revision: hash(bytes) }
  } catch {
    throw new Error('维护元数据 JSON 无效，原文件已保留')
  }
}
export function revision(path: string): string {
  noLinks(path)
  try {
    return hash(readFileSync(path))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return 'missing'
    throw error
  }
}
export function atomicJson(path: string, value: unknown, expected?: string): string {
  noLinks(path)
  if (expected !== undefined && revision(path) !== expected)
    throw new Error('数据在维护前已变化，原文件保留；请重新制定计划')
  mkdirSync(dirname(path), { recursive: true })
  const text = jsonText(value),
    temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600, flush: true })
    if (expected !== undefined && revision(path) !== expected)
      throw new Error('数据在提交前已变化，原文件保留')
    renameSync(temporary, path)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return hash(text)
}
export function jsonText(value: unknown): string {
  const text = JSON.stringify(value, null, 2) + '\n'
  if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('维护结果超过存储大小上限，未写入')
  return text
}
export function readJournal(paths: MaintenancePaths): any {
  const journal = readJson(localPath(paths.home, maintenanceJournal))
  if (
    !record(journal) ||
    journal.schemaVersion !== 1 ||
    !uuid(journal.id) ||
    journal.scope !== paths.scope ||
    !['backup-cleanup', 'qa-archive', 'qa-restore'].includes(journal.kind) ||
    journal.phase !== 'prepared' ||
    typeof journal.digest !== 'string' ||
    journal.digest !== planDigest(journal)
  )
    throw new Error('维护事务版本或目标不匹配，原记录保留')
  return journal
}
/** Explicit escape for a conflicting interrupted transaction; it never changes user stores. */
export async function preserveInterrupted(paths: MaintenancePaths, confirmation: string): Promise<unknown> {
  return offlineLease(
    paths,
    () => {
      const journal = readJournal(paths)
      confirm(confirmation, 'keep-current', journal.id, journal.digest)
      if (uuid(journal.archiveId) && (journal.kind === 'qa-archive' || journal.kind === 'qa-restore')) {
        const file = privateFile(paths, 'archives', journal.archiveId),
          archive = readJson(file)
        if (archive.scope !== paths.scope || archive.schemaVersion !== 1 || archive.id !== journal.archiveId)
          throw new Error('归档恢复来源不匹配，未结束事务')
        if (archive.status !== 'restored') {
          archive.status = 'interrupted'
          if (journal.kind === 'qa-restore') archive.restoredAt = new Date(journal.at).toISOString()
          atomicJson(file, archive)
        }
      }
      atomicJson(privateFile(paths, 'receipts', journal.id), {
        ...journal,
        state: 'abandoned',
        finishedAt: new Date().toISOString()
      })
      unlinkSync(localPath(paths.home, maintenanceJournal))
      return {
        id: journal.id,
        state: 'abandoned',
        message: '已保留当前数据并结束未完成事务；原归档及未清理文件仍保留，可核对后单独恢复。'
      }
    },
    true
  )
}
export function pendingInfo(paths: MaintenancePaths) {
  const file = localPath(paths.home, maintenanceJournal)
  if (!existsSync(file)) return { pending: false }
  const journal = readJournal(paths)
  return {
    pending: true,
    id: journal.id,
    kind: journal.kind,
    recoverConfirmation: `recover:${journal.id}:${journal.digest.slice(0, 12)}`,
    keepCurrentConfirmation: `keep-current:${journal.id}:${journal.digest.slice(0, 12)}`
  }
}
export function confirm(value: string, operation: string, id: string, digest: string): void {
  if (value !== `${operation}:${id}:${digest.slice(0, 12)}`)
    throw new Error('确认值不匹配；请复制计划给出的完整确认值')
}
export function privateFile(paths: MaintenancePaths, kind: string, id: string): string {
  if (!uuid(id) || !['plans', 'archives', 'receipts'].includes(kind)) throw new Error('维护记录标识无效')
  return localPath(paths.home, `backups/maintenance/${kind}/${id}.json`)
}
export function planDigest(plan: Record<string, unknown>): string {
  const { digest: _digest, confirmation: _confirmation, ...body } = plan
  return hash(JSON.stringify(body))
}
export function readPlan(paths: MaintenancePaths, id: string, kind: string): any {
  const plan = readJson(privateFile(paths, 'plans', id))
  if (
    plan.schemaVersion !== 1 ||
    plan.id !== id ||
    plan.scope !== paths.scope ||
    plan.kind !== kind ||
    plan.digest !== planDigest(plan)
  )
    throw new Error('维护计划格式、目标或摘要不匹配')
  return plan
}
