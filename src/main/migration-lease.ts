import { DatabaseSync } from 'node:sqlite'
import { lstatSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/** Serializes stale-directory recovery as well as the profile mutation itself across processes. */
export function acquireMigrationLease(home: string): () => void {
  const path = join(home, '.dsh-px-migration-lease.sqlite')
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error('迁移进程锁必须是独立普通文件')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const database = new DatabaseSync(path)
  try {
    database.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
  } catch (error) {
    database.close()
    if ([5, 6].includes((error as { errcode?: number }).errcode ?? -1))
      throw new Error('另一个进程正在准备插件或维护数据；请稍后重试')
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try {
      database.exec('ROLLBACK')
    } finally {
      database.close()
    }
  }
}

/** Never retry over a competing directory; the caller must inspect its owner instead. */
export async function claimMigrationDirectory(
  source: string,
  target: string,
  {
    rename = renameSync,
    wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    platform = process.platform
  } = {}
): Promise<void> {
  const original = lstatSync(source)
  const ownerPath = join(source, 'owner.json')
  const originalOwner = readFileSync(ownerPath, 'utf8')
  for (let attempt = 0; ; attempt++) {
    try {
      lstatSync(target)
      throw Object.assign(new Error('迁移锁已被认领'), { code: 'EEXIST' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const sourceStat = lstatSync(source)
    const ownerStat = lstatSync(ownerPath)
    if (
      !sourceStat.isDirectory() ||
      sourceStat.isSymbolicLink() ||
      sourceStat.ino !== original.ino ||
      sourceStat.dev !== original.dev ||
      !ownerStat.isFile() ||
      ownerStat.isSymbolicLink() ||
      ownerStat.nlink !== 1 ||
      readFileSync(ownerPath, 'utf8') !== originalOwner
    )
      throw new Error('迁移临时锁目录或归属已变化')
    try {
      rename(source, target)
      return
    } catch (error) {
      if (
        platform !== 'win32' ||
        !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') ||
        attempt >= 9
      )
        throw error
      await wait(20)
    }
  }
}
