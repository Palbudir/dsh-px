import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertLocalProfilePath,
  materializeSeedHome,
  repairPnpmMetadata,
  type MaterializeOptions
} from './materialize'
import { recoverManagedPluginMigration } from './managed-plugins'

export function assertNoPendingMaintenance(home: string): void {
  if (existsSync(join(home, '.dsh-px-maintenance-transaction.json'))) {
    throw new Error(
      '上次离线维护尚未完成。请先关闭此窗口，在维护工具中运行 recover 完成恢复后再启动；会话数据仍保留。'
    )
  }
}

/** Finish interrupted first-run copies before starting a transactional plugin upgrade. */
export async function prepareHarnessHome(
  options: {
    home: string
    seedHome: string
    profileName: string
    dshDir: string
    identity: string
    onProgress: MaterializeOptions['onProgress']
    migrate: (initialSeed: boolean) => Promise<void>
  },
  dependencies: {
    recover?: typeof recoverManagedPluginMigration
    materialize?: typeof materializeSeedHome
  } = {}
): Promise<void> {
  const { home, seedHome, profileName, dshDir, identity, onProgress } = options
  assertNoPendingMaintenance(home)
  // Recovery may rename a staged/backup profile. No directory observation can precede it.
  await (dependencies.recover ?? recoverManagedPluginMigration)({ home, profileName })
  assertLocalProfilePath(home, profileName)
  const marker = join(home, '.dsh-px-materialized')
  const profileDir = join(home, 'profiles', profileName)
  const profile = join(profileDir, 'package.json')
  const claim = join(home, '.dsh-px-seed-claimed')
  if (
    !existsSync(profile) &&
    !existsSync(claim) &&
    (existsSync(marker) ||
      existsSync(join(home, '.dsh-px-managed-plugins.json')) ||
      (existsSync(profileDir) && readdirSync(profileDir).length > 0))
  ) {
    throw new Error(
      '既有工作配置缺少 package.json，已保留当前目录。请从完整 profile 备份恢复清单后重试；不会用默认种子覆盖现有插件。'
    )
  }
  if (!existsSync(profile) || (!existsSync(marker) && existsSync(claim))) {
    mkdirSync(home, { recursive: true })
    // A pre-existing user profile is not an interrupted seed owned by this app.
    // Claim only before creating its first manifest; preserve an earlier real claim.
    if (!existsSync(profile) && !existsSync(claim))
      writeFileSync(claim, JSON.stringify({ identity, phase: 'materializing' }), { flag: 'wx' })
    await (dependencies.materialize ?? materializeSeedHome)({
      home,
      seedHome,
      profileName,
      dshDir,
      seedIdentity: identity,
      refresh: false,
      onProgress
    })
  }
  repairPnpmMetadata({ seedHome, home, profileName })
  await options.migrate(existsSync(claim))
  writeFileSync(marker, `seedIdentity=${identity}\n`)
  rmSync(claim, { force: true })
}
