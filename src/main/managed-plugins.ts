import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MANAGED_PLUGIN_NAMES = ['dsh-px-updater', 'dsh-px-workbench', 'dsh-px-taskflow', 'dsh-px-workspace'] as const

/** 一次版本迁移：由官方 CLI 安装和协调组合包，不覆盖用户的完整 profile。 */
export async function ensureManagedPlugins (options: {
  home: string
  seedHome: string
  profileName: string
  identity: string
  install: (specs: string[]) => Promise<void>
}): Promise<boolean> {
  const { home, seedHome, profileName, identity, install } = options
  const marker = join(home, '.dsh-px-managed-plugins.json')
  try { if (JSON.parse(readFileSync(marker, 'utf8')).identity === identity) return false } catch { /* first migration */ }
  const profile = join(home, 'profiles', profileName)
  const sourceProfile = join(seedHome, 'profiles', profileName)
  const shipped = MANAGED_PLUGIN_NAMES.filter(name => existsSync(join(sourceProfile, 'node_modules', name, 'package.json')))
  if (!shipped.length) return false
  const specs = shipped.map(name => `file:${join(sourceProfile, 'node_modules', name).replaceAll('\\', '/')}`)
  if (specs.length) {
    const backup = join(home, 'backups', `plugins-${Date.now()}`)
    mkdirSync(backup, { recursive: true })
    for (const file of ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
      if (existsSync(join(profile, file))) copyFileSync(join(profile, file), join(backup, file))
    }
    // 安装失败不写完成标记，下次可重试。保留备份和失败时现场，避免伪造完整回滚。
    try { await install(specs) } catch (error) {
      throw new Error(`自管插件迁移失败，原配置备份在 ${backup}。${String(error)}`)
    }
    const installed = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    for (const name of shipped) {
      if (!installed.dsh?.profile?.bundles?.includes(name) ||
          !existsSync(join(profile, 'node_modules', name, 'lib', 'client.js'))) {
        throw new Error(`插件 ${name} 未完成安装或组合包协调，迁移未标记完成。备份：${backup}`)
      }
    }
  }
  writeFileSync(marker + '.tmp', JSON.stringify({ identity, plugins: shipped, migratedAt: new Date().toISOString() }))
  renameSync(marker + '.tmp', marker)
  return specs.length > 0
}
