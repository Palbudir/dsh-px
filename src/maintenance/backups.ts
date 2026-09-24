import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { listManagedPluginBackups, type MigrationBackup } from '../main/managed-plugins'
import {
  atomicJson,
  confirm,
  inside,
  localPath,
  maintenanceJournal,
  noLinks,
  offlineLease,
  planDigest,
  privateFile,
  readJournal,
  readJson,
  readPlan,
  revision,
  uuid,
  type MaintenancePaths
} from './core'

function inventory(paths: MaintenancePaths): MigrationBackup[] {
  const root = localPath(paths.home, 'backups/managed-profiles')
  if (!existsSync(root)) return []
  for (const id of readdirSync(root)) {
    if (!uuid(id)) continue
    const directory = localPath(paths.home, `backups/managed-profiles/${id}`)
    if (!lstatSync(directory).isDirectory()) throw new Error('备份目录格式异常')
    const metadata = localPath(paths.home, `backups/managed-profiles/${id}/backup.json`)
    if (!existsSync(metadata)) throw new Error('备份元数据缺失，不能确认完整备份与保留数量')
    const row = readJson(metadata, 64000)
    if (
      (row.schemaVersion !== undefined && row.schemaVersion !== 1) ||
      row.id !== id ||
      typeof row.identity !== 'string' ||
      typeof row.profileName !== 'string' ||
      !['committed', 'restored'].includes(row.state) ||
      typeof row.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(row.createdAt)) ||
      row.path !== `backups/managed-profiles/${id}/profile`
    )
      throw new Error('备份记录格式或路径不受支持')
    const profile = localPath(paths.home, row.path),
      manifest = localPath(paths.home, row.path + '/package.json')
    if (!lstatSync(profile).isDirectory() || !lstatSync(manifest).isFile())
      throw new Error('备份未保留完整 profile 入口')
  }
  const all: MigrationBackup[] = []
  for (let offset = 0; ; offset += 50) {
    const page = listManagedPluginBackups(paths.home, offset, 50)
    all.push(...page.items)
    if (offset + page.items.length >= page.total) break
  }
  return all
    .filter((row) => row.profileName === paths.profileName)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}
export function listBackups(paths: MaintenancePaths, offset = 0, limit = 20) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error('分页范围无效')
  const rows = inventory(paths),
    protectedIds = rows.slice(0, 2).map((row) => row.id)
  return {
    total: rows.length,
    protectedIds,
    items: rows
      .slice(offset, offset + limit)
      .map((row) => ({ ...row, protected: protectedIds.includes(row.id) }))
  }
}
export async function planBackupCleanup(paths: MaintenancePaths, ids: string[]) {
  return offlineLease(paths, () => {
    if (!ids.length || ids.length > 100 || ids.some((id) => !uuid(id)) || new Set(ids).size !== ids.length)
      throw new Error('必须显式列出不重复的备份 ID')
    const rows = inventory(paths),
      protectedIds = rows.slice(0, 2).map((row) => row.id)
    if (ids.some((id) => protectedIds.includes(id))) throw new Error('最近两份完整备份始终保留')
    const items = ids.map((id) => {
      const row = rows.find((row) => row.id === id)
      if (!row) throw new Error('所选备份不属于当前 profile 或已不存在')
      return {
        id,
        metadataRevision: revision(localPath(paths.home, `backups/managed-profiles/${id}/backup.json`))
      }
    })
    const plan: any = {
      schemaVersion: 1,
      id: randomUUID(),
      scope: paths.scope,
      kind: 'backup-cleanup',
      createdAt: new Date().toISOString(),
      items,
      protectedIds
    }
    plan.digest = planDigest(plan)
    plan.confirmation = `delete-backups:${plan.id}:${plan.digest.slice(0, 12)}`
    atomicJson(privateFile(paths, 'plans', plan.id), plan)
    return plan
  })
}
/** Unlink nested reparse points as entries; never descend into their targets. */
function deleteTree(path: string, root: string): void {
  if (!inside(path, root)) throw new Error('清理目录越界')
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (!inside(realpathSync(path), root)) throw new Error('备份清理遇到外部路径')
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) deleteTree(join(path, name), root)
    rmdirSync(path)
  } else if (stat.isFile()) unlinkSync(path)
  else throw new Error('备份包含不支持的文件类型，未继续清理')
}
function finishCleanup(paths: MaintenancePaths, journal: any, afterRemoval?: (id: string) => void) {
  const plan = readPlan(paths, journal.id, 'backup-cleanup')
  if (
    journal.planDigest !== plan.digest ||
    !Array.isArray(plan.items) ||
    plan.items.some((item: any) => !uuid(item.id))
  )
    throw new Error('清理事务与计划不匹配')
  const protectedIds = inventory(paths)
    .slice(0, 2)
    .map((row) => row.id)
  if (plan.items.some((item: any) => protectedIds.includes(item.id)))
    throw new Error('所选备份已成为最近两份，拒绝继续清理')
  for (const item of plan.items) {
    const source = localPath(paths.home, `backups/managed-profiles/${item.id}`)
    const trash = localPath(paths.home, `.dsh-px-maintenance-trash/${plan.id}/${item.id}`)
    if (existsSync(source) && existsSync(trash)) throw new Error('清理现场存在重复目录，请保留并核对')
    if (existsSync(source)) {
      if (
        revision(localPath(paths.home, `backups/managed-profiles/${item.id}/backup.json`)) !==
        item.metadataRevision
      )
        throw new Error('备份元数据已变化，拒绝清理')
      mkdirSync(join(trash, '..'), { recursive: true })
      renameSync(source, trash)
    }
    if (existsSync(trash)) {
      noLinks(trash)
      deleteTree(trash, trash)
    }
    afterRemoval?.(item.id)
  }
  const receipt = {
    schemaVersion: 1,
    id: plan.id,
    scope: paths.scope,
    kind: plan.kind,
    state: 'completed',
    deletedIds: plan.items.map((item: any) => item.id),
    retainedIds: protectedIds,
    finishedAt: new Date().toISOString()
  }
  atomicJson(privateFile(paths, 'receipts', plan.id), receipt)
  unlinkSync(localPath(paths.home, maintenanceJournal))
  return receipt
}
export async function applyBackupCleanup(
  paths: MaintenancePaths,
  id: string,
  confirmation: string,
  afterRemoval?: (id: string) => void
) {
  return offlineLease(paths, () => {
    const plan = readPlan(paths, id, 'backup-cleanup')
    confirm(confirmation, 'delete-backups', id, plan.digest)
    const rows = inventory(paths),
      protectedIds = rows.slice(0, 2).map((row) => row.id)
    if (
      !Array.isArray(plan.items) ||
      !plan.items.length ||
      plan.items.some(
        (item: any) =>
          !uuid(item.id) ||
          protectedIds.includes(item.id) ||
          !rows.some((row) => row.id === item.id) ||
          revision(localPath(paths.home, `backups/managed-profiles/${item.id}/backup.json`)) !==
            item.metadataRevision
      )
    )
      throw new Error('清理计划已过期，未更改备份')
    const journal: any = {
      schemaVersion: 1,
      id,
      scope: paths.scope,
      kind: 'backup-cleanup',
      planDigest: plan.digest,
      phase: 'prepared'
    }
    journal.digest = planDigest(journal)
    atomicJson(localPath(paths.home, maintenanceJournal), journal, 'missing')
    return finishCleanup(paths, readJournal(paths), afterRemoval)
  })
}
export async function recoverBackupCleanup(paths: MaintenancePaths, confirmation: string) {
  return offlineLease(
    paths,
    () => {
      const journal = readJournal(paths)
      if (journal.kind !== 'backup-cleanup') throw new Error('这不是备份清理事务，请使用 QA 维护入口恢复')
      confirm(confirmation, 'recover', journal.id, journal.digest)
      return finishCleanup(paths, journal)
    },
    true
  )
}
