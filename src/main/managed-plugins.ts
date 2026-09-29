import { createHash, randomUUID } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import * as asyncFs from 'node:fs/promises'
import { MANAGED_PLUGIN_NAMES } from '../shared/plugin-catalog'
import { acquireMigrationLease, claimMigrationDirectory } from './migration-lease'
import {
  assertPluginIdentity,
  assertSidebarCompatibilityIdentity,
  inspectManagedPlugin,
  inspectManagedPlugins
} from '../shared/runtime-integrity'
import type { PluginIdentity } from '../shared/runtime-integrity'
import { copyBundlePayload } from '../shared/bundle-payload'
import type { SeedProgress } from './materialize'
import { assertLocalProfilePath } from './materialize'
import {
  applySidebarCompatibility,
  inspectSidebarCompatibility,
  type SidebarCompatibility
} from '../shared/sidebar-compatibility'
export { MANAGED_PLUGIN_NAMES } from '../shared/plugin-catalog'

type Phase = 'preparing' | 'validated' | 'old-moved' | 'committed'
interface Journal {
  schemaVersion: 1
  id: string
  profileName: string
  identity: string
  phase: Phase
  createdAt: string
  plugins: PluginIdentity[]
  sidebarCompatibility?: SidebarCompatibility
}
interface BaseOptions {
  home: string
  profileName: string
}
export interface ManagedPluginOptions extends BaseOptions {
  seedHome: string
  identity: string
  expectedVersion?: string
  /** Caller has just created or resumed an owned first-run seed; never inferred from a missing package file. */
  adoptSeed?: boolean
  runtimeNode?: string
  dshEntry?: string
  onPhase?: (phase: Phase | 'restored') => void
  onProgress?: (progress: SeedProgress) => void
  /** Additional validation runs against the private staging home, never the active profile. */
  validate?: (stagingHome: string) => Promise<void>
}
export interface MigrationBackup {
  id: string
  identity: string
  createdAt: string
  profileName: string
  path: string
  state: 'committed' | 'restored'
}

const inflight = new Map<string, Promise<unknown>>()
const JOURNAL = '.dsh-px-profile-transaction.json'
const MARKER = '.dsh-px-managed-plugins.json'
let ownProcessIdentity: string | undefined

/** A live recycled PID must not keep a crashed migration locked indefinitely. */
function processIdentity(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  try {
    if (process.platform === 'linux') {
      const value = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const started = value.slice(value.lastIndexOf(')') + 2).split(' ')[19]
      return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() + ':' + started
    }
    if (process.platform === 'win32') {
      const powershell = join(
        process.env.SystemRoot ?? 'C:/Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe'
      )
      return (
        execFileSync(
          powershell,
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`
          ],
          {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore']
          }
        ).trim() || undefined
      )
    }
    return (
      execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() || undefined
    )
  } catch {
    return undefined
  }
}

function entryExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function inside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}

function atomicJson(file: string, value: unknown): void {
  const temporary = `${file}.${randomUUID()}.tmp`
  mkdirSync(dirname(file), { recursive: true })
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600, flush: true })
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function paths(options: BaseOptions, id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(options.profileName) || !/^[0-9a-f-]{36}$/.test(id))
    throw new Error('迁移路径标识无效')
  const home = resolve(options.home)
  return {
    home,
    profile: join(home, 'profiles', options.profileName),
    stagingHome: join(home, '.dsh-px-staging', id),
    stagingProfile: join(home, '.dsh-px-staging', id, 'profiles', options.profileName),
    backupRoot: join(home, 'backups', 'managed-profiles', id),
    backup: join(home, 'backups', 'managed-profiles', id, 'profile'),
    displaced: join(home, '.dsh-px-staging', id, 'uncommitted-profile')
  }
}

function removeOwned(target: string, home: string): void {
  if (!inside(target, home) || resolve(target) === resolve(home))
    throw new Error('拒绝清理迁移目录之外的路径')
  rmSync(target, { recursive: true, force: true, maxRetries: 3 })
}
async function removeOwnedAsync(target: string, home: string): Promise<void> {
  if (!inside(target, home) || resolve(target) === resolve(home))
    throw new Error('拒绝清理迁移目录之外的路径')
  await asyncFs.rm(target, { recursive: true, force: true, maxRetries: 3 })
}

/** Only internal links are rebased. External developer links remain owned by the user. */
async function rebaseLinks(directory: string, from: string, to: string): Promise<void> {
  if (!entryExists(directory)) return
  for (const entry of await asyncFs.readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(file), await asyncFs.readlink(file))
      if (!inside(target, from)) continue
      const next = join(to, relative(from, target))
      let isDirectory = true
      try {
        isDirectory = (await asyncFs.stat(file)).isDirectory()
      } catch {
        /* A moved internal directory may temporarily be absent. */
      }
      await asyncFs.rm(file, { force: true })
      await asyncFs.symlink(
        next,
        file,
        isDirectory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file'
      )
    } else if (entry.isDirectory()) await rebaseLinks(file, from, to)
  }
}

async function cloneProfile(
  source: string,
  destination: string,
  onProgress?: ManagedPluginOptions['onProgress']
): Promise<void> {
  let count = 0,
    copied = 0,
    lastReport = 0
  const report = (force = false): void => {
    if (!force && Date.now() - lastReport < 100) return
    lastReport = Date.now()
    onProgress?.({ done: count, total: 0, copied, phase: `正在准备插件升级：已复制 ${copied} 个文件…` })
  }
  const walk = async (from: string, to: string): Promise<void> => {
    await asyncFs.mkdir(to, { recursive: true })
    for (const entry of await asyncFs.readdir(from, { withFileTypes: true })) {
      const sourceFile = join(from, entry.name),
        targetFile = join(to, entry.name)
      const rel = relative(source, sourceFile)
      if (rel === '.dsh-module-fallback') continue
      if (entry.isSymbolicLink()) {
        const target = resolve(dirname(sourceFile), await asyncFs.readlink(sourceFile))
        if (inside(target, join(source, '.dsh-module-fallback'))) continue
        const next = inside(target, source) ? join(destination, relative(source, target)) : target
        let directory: boolean
        try {
          directory = (await asyncFs.stat(sourceFile)).isDirectory()
        } catch (error) {
          const parts = rel.split(sep)
          const packageRoot =
            parts[0] === 'node_modules' &&
            (parts.length === 2 || (parts.length === 3 && parts[1].startsWith('@')))
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !packageRoot) throw error
          // Package-manager links name directories, including a disabled developer package whose source is absent.
          directory = true
        }
        await asyncFs.symlink(
          next,
          targetFile,
          directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file'
        )
      } else if (entry.isDirectory()) await walk(sourceFile, targetFile)
      else {
        await asyncFs.copyFile(sourceFile, targetFile)
        copied++
      }
      report()
      if (++count % 300 === 0) await new Promise<void>((done) => setImmediate(done))
    }
  }
  await walk(source, destination)
  report(true)
}

function markerValid(home: string, profile: string, identity: string, shipped: PluginIdentity[]): boolean {
  try {
    const marker = JSON.parse(readFileSync(join(home, MARKER), 'utf8'))
    if (marker.schemaVersion !== 2 || marker.identity !== identity) return false
    // The marketplace may reinstall the same official version without its compatibility adapter.
    // Unknown/custom or linked third-party builds remain the user's property.
    if (inspectSidebarCompatibility(profile).state === 'original-known') return false
    const current = inspectManagedPlugins(profile, 'installed')
    for (const expected of shipped) {
      assertPluginIdentity(
        current.find((plugin) => plugin.name === expected.name)!,
        expected
      )
      assertPluginIdentity(
        inspectManagedPlugin(join(profile, '.dsh-px-packages', expected.name), expected.name, 'vendored'),
        expected
      )
    }
    return true
  } catch {
    return false
  }
}

function recordCompletion(home: string, journal: Journal, adoptedSeed = false): void {
  atomicJson(join(home, MARKER), {
    schemaVersion: 2,
    identity: journal.identity,
    plugins: journal.plugins,
    sidebarCompatibility: journal.sidebarCompatibility,
    transactionId: journal.id,
    adoptedSeed,
    migratedAt: new Date().toISOString()
  })
}

function profileConfigurationRevision(profile: string): string {
  const hash = createHash('sha256')
  for (const name of [
    'package.json',
    'cordis.patch.yml',
    'cordis.yml',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    '.pnpmfile.cjs'
  ]) {
    const file = join(profile, name)
    hash.update(name + '\0')
    if (entryExists(file)) {
      const value = readFileSync(file)
      hash.update(String(value.length) + '\0').update(value)
    } else hash.update('missing\0')
  }
  return hash.digest('hex')
}

function recordBackup(options: BaseOptions, journal: Journal, state: MigrationBackup['state']): void {
  const p = paths(options, journal.id)
  if (!entryExists(p.backup)) return
  atomicJson(join(p.backupRoot, 'backup.json'), {
    id: journal.id,
    identity: journal.identity,
    createdAt: journal.createdAt,
    profileName: journal.profileName,
    path: relative(p.home, p.backup).replaceAll('\\', '/'),
    state
  } satisfies MigrationBackup)
}

/** Page backup metadata without loading dependency trees; cleanup is an explicit user operation. */
export function listManagedPluginBackups(
  home: string,
  offset = 0,
  limit = 20
): { items: MigrationBackup[]; total: number } {
  const root = join(home, 'backups', 'managed-profiles')
  if (!existsSync(root)) return { items: [], total: 0 }
  const names = readdirSync(root).filter((name) => /^[0-9a-f-]{36}$/.test(name))
  const records: MigrationBackup[] = []
  for (const name of names) {
    try {
      const record = JSON.parse(readFileSync(join(root, name, 'backup.json'), 'utf8')) as MigrationBackup
      if (record.id === name && entryExists(join(home, record.path)) && inside(join(home, record.path), root))
        records.push(record)
    } catch {
      /* Incomplete transactions are covered by the journal, not successful-backup history. */
    }
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return {
    items: records.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, Math.min(limit, 50))),
    total: records.length
  }
}

async function recover(options: BaseOptions): Promise<'none' | 'restored' | 'committed'> {
  const file = join(options.home, JOURNAL)
  if (!entryExists(file)) return 'none'
  const journal = JSON.parse(readFileSync(file, 'utf8')) as Journal
  if (
    journal.schemaVersion !== 1 ||
    journal.profileName !== options.profileName ||
    !['preparing', 'validated', 'old-moved', 'committed'].includes(journal.phase)
  ) {
    throw new Error(`迁移记录无效；保留现场并修复 ${file}`)
  }
  const p = paths(options, journal.id)
  if (journal.phase === 'committed' && entryExists(p.profile)) {
    try {
      const current = inspectManagedPlugins(p.profile, 'installed')
      for (const expected of journal.plugins)
        assertPluginIdentity(
          current.find((plugin) => plugin.name === expected.name)!,
          expected
        )
      if (journal.sidebarCompatibility?.state === 'patched-known')
        assertSidebarCompatibilityIdentity(
          inspectSidebarCompatibility(p.profile),
          journal.sidebarCompatibility
        )
      recordCompletion(p.home, journal)
      recordBackup(options, journal, 'committed')
      await removeOwnedAsync(p.stagingHome, p.home)
      rmSync(file)
      return 'committed'
    } catch (error) {
      if (!entryExists(p.backup)) throw error
      // An interrupted commit with an invalid new tree can still recover its complete old tree.
    }
  }
  if (entryExists(p.backup)) {
    if (entryExists(p.profile)) {
      mkdirSync(p.stagingHome, { recursive: true })
      if (entryExists(p.displaced)) throw new Error('迁移恢复现场存在重复的新 profile；请保留目录并检查日志')
      renameSync(p.profile, p.displaced)
    }
    await rebaseLinks(p.backup, p.backup, p.profile)
    renameSync(p.backup, p.profile)
  } else if (!entryExists(p.profile))
    throw new Error('迁移恢复失败：旧 profile 与备份均不存在，未自动创建空配置')
  const failures = join(p.home, 'backups', 'managed-failures')
  atomicJson(join(failures, `${journal.id}.json`), { ...journal, recoveredAt: new Date().toISOString() })
  // Failed staging is a duplicate of the now-restored active profile. Keep only small bounded diagnostics.
  await removeOwnedAsync(p.stagingHome, p.home)
  const diagnostics = readdirSync(failures)
    .filter((name) => /^[0-9a-f-]{36}\.json$/.test(name))
    .sort((a, b) => statSync(join(failures, b)).mtimeMs - statSync(join(failures, a)).mtimeMs)
  for (const name of diagnostics.slice(20)) rmSync(join(failures, name))
  rmSync(file)
  return 'restored'
}

async function exclusive<T>(options: BaseOptions, action: () => Promise<T>): Promise<T> {
  if (!/^[a-zA-Z0-9_-]+$/.test(options.profileName)) throw new Error('迁移 profile 名无效')
  assertLocalProfilePath(options.home, options.profileName)
  const key = resolve(options.home)
  const previous = inflight.get(key) ?? Promise.resolve()
  const current = previous
    .catch(() => {})
    .then(async () => {
      const lock = join(key, '.dsh-px-migration-lock')
      mkdirSync(key, { recursive: true })
      const releaseLease = acquireMigrationLease(key)
      try {
        const claim = join(key, `.dsh-px-lock-${randomUUID()}`)
        mkdirSync(claim)
        ownProcessIdentity ??= processIdentity(process.pid)
        atomicJson(join(claim, 'owner.json'), {
          pid: process.pid,
          processIdentity: ownProcessIdentity,
          acquiredAt: new Date().toISOString()
        })
        try {
          await claimMigrationDirectory(claim, lock)
        } catch (error) {
          if (!entryExists(lock)) {
            removeOwned(claim, key)
            throw error
          }
          let pid = 0,
            expectedProcessIdentity: string | undefined
          try {
            const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'))
            pid = owner.pid
            expectedProcessIdentity =
              typeof owner.processIdentity === 'string' ? owner.processIdentity : undefined
          } catch {
            removeOwned(claim, key)
            throw new Error(`迁移锁不完整，请保留 ${lock} 并检查日志`)
          }
          let alive = true
          try {
            process.kill(pid, 0)
          } catch (failure) {
            alive = (failure as NodeJS.ErrnoException).code !== 'ESRCH'
          }
          if (alive && expectedProcessIdentity) {
            const actualProcessIdentity = pid === process.pid ? ownProcessIdentity : processIdentity(pid)
            if (actualProcessIdentity && actualProcessIdentity !== expectedProcessIdentity) alive = false
          }
          if (!Number.isInteger(pid) || pid <= 0 || alive) {
            removeOwned(claim, key)
            throw new Error(`另一个进程正在准备插件（PID ${pid}）；请稍后重试`)
          }
          removeOwned(lock, key)
          try {
            await claimMigrationDirectory(claim, lock)
          } catch (failure) {
            removeOwned(claim, key)
            throw failure
          }
        }
        try {
          return await action()
        } finally {
          removeOwned(lock, key)
        }
      } finally {
        releaseLease()
      }
    })
  inflight.set(key, current)
  try {
    return await current
  } finally {
    if (inflight.get(key) === current) inflight.delete(key)
  }
}

/** Call before seed materialization, so interrupted renames never look like a first install. */
export function recoverManagedPluginMigration(
  options: BaseOptions
): Promise<'none' | 'restored' | 'committed'> {
  return exclusive(options, async () => recover(options))
}

/** Maintenance uses the same process-aware lease and never repairs an unfinished upgrade implicitly. */
export function withManagedProfileMaintenance<T>(
  options: BaseOptions,
  action: () => Promise<T> | T
): Promise<T> {
  return exclusive(options, async () => {
    if (entryExists(join(options.home, JOURNAL)))
      throw new Error('存在尚未完成的插件迁移，请先启动 DSH-PX 完成恢复，再清理备份。')
    return await action()
  })
}

async function validateNativeProfile(options: ManagedPluginOptions, stagingHome: string): Promise<void> {
  if (!options.runtimeNode && !options.dshEntry) return
  if (!options.runtimeNode || !options.dshEntry) throw new Error('原生 DSH 校验需要完整的 Node 与 CLI 路径')
  await new Promise<void>((done, reject) => {
    execFile(
      options.runtimeNode!,
      [options.dshEntry!, '--profile', options.profileName, '--dump-config'],
      {
        cwd: stagingHome,
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, DSH_HOME: stagingHome, NODE_OPTIONS: '', NODE_PATH: '' }
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`原生 DSH 组合验证失败：${String(stderr).slice(-2000) || error.message}`))
        else if (!/^\s*-\s+id:/m.test(stdout)) reject(new Error('原生 DSH 组合验证未返回插件配置'))
        else done()
      }
    )
  })
}

/** A completed fresh seed needs validation, not a second copy of the same dependency tree. */
async function adoptOwnedSeed(options: ManagedPluginOptions, shipped: PluginIdentity[]): Promise<boolean> {
  if (
    !options.adoptSeed ||
    !options.runtimeNode ||
    !options.dshEntry ||
    !entryExists(join(options.home, '.dsh-px-seed-claimed')) ||
    entryExists(join(options.home, MARKER))
  )
    return false
  const id = randomUUID(),
    p = paths(options, id)
  const sourceProfile = join(options.seedHome, 'profiles', options.profileName)
  const sourceSidebar = inspectSidebarCompatibility(sourceProfile)
  let checkedRevision: string
  const verifyPayload = (): void => {
    if (sourceSidebar.state === 'patched-known')
      assertSidebarCompatibilityIdentity(inspectSidebarCompatibility(p.profile), sourceSidebar)
    const installed = inspectManagedPlugins(p.profile, 'installed')
    for (const expected of shipped) {
      assertPluginIdentity(
        installed.find((plugin) => plugin.name === expected.name)!,
        expected
      )
      assertPluginIdentity(
        inspectManagedPlugin(join(p.profile, '.dsh-px-packages', expected.name), expected.name, 'vendored'),
        expected
      )
    }
  }
  try {
    // Both lists and user override layers must still be the exact portable seed configuration.
    checkedRevision = profileConfigurationRevision(p.profile)
    if (checkedRevision !== profileConfigurationRevision(sourceProfile)) return false
    const profile = JSON.parse(readFileSync(join(p.profile, 'package.json'), 'utf8'))
    if (
      profile.dshPx?.seedSource !== 'catalog' ||
      shipped.some(
        (plugin) =>
          profile.dependencies?.[plugin.name] !== `file:./.dsh-px-packages/${plugin.name}` ||
          !profile.dsh?.profile?.bundles?.includes(plugin.name)
      )
    )
      return false
    verifyPayload()
  } catch {
    return false
  }

  options.onProgress?.({ done: 0, total: 0, copied: 0, phase: '正在核对首次启动的插件与配置…' })
  try {
    // Native --dump-config rewrites cordis.yml. Give it an isolated configuration view,
    // with a read-only-by-contract module lookup link, so the owned profile is never rewritten.
    await asyncFs.mkdir(p.stagingProfile, { recursive: true })
    for (const file of [
      'package.json',
      'cordis.patch.yml',
      'cordis.yml',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml'
    ]) {
      const from = join(p.profile, file)
      if (existsSync(from)) await asyncFs.copyFile(from, join(p.stagingProfile, file))
    }
    await asyncFs.symlink(
      join(p.profile, 'node_modules'),
      join(p.stagingProfile, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    if (existsSync(join(p.home, 'cordis.patch.yml')))
      await asyncFs.copyFile(join(p.home, 'cordis.patch.yml'), join(p.stagingHome, 'cordis.patch.yml'))
    await validateNativeProfile(options, p.stagingHome)
    await options.validate?.(p.stagingHome)
    if (profileConfigurationRevision(p.profile) !== checkedRevision) return false
    verifyPayload()
    recordCompletion(
      p.home,
      {
        schemaVersion: 1,
        id,
        profileName: options.profileName,
        identity: options.identity,
        phase: 'committed',
        createdAt: new Date().toISOString(),
        plugins: shipped,
        sidebarCompatibility: inspectSidebarCompatibility(p.profile)
      },
      true
    )
    options.onProgress?.({
      done: shipped.length,
      total: shipped.length,
      copied: 0,
      phase: '首次启动配置已就绪'
    })
    return true
  } catch {
    return false
  } finally {
    await removeOwnedAsync(p.stagingHome, p.home)
  }
}

/** Prepare and verify a new profile, then switch it while the harness is stopped. */
export function ensureManagedPlugins(options: ManagedPluginOptions): Promise<boolean> {
  return exclusive(options, async () => {
    await recover(options)
    const shipped = inspectManagedPlugins(
      join(options.seedHome, 'profiles', options.profileName),
      'bundled-runtime',
      options.expectedVersion
    )
    if (new Set(shipped.map((plugin) => plugin.version)).size !== 1)
      throw new Error('随附受管插件版本不一致，未开始迁移')
    const active = join(options.home, 'profiles', options.profileName)
    if (markerValid(options.home, active, options.identity, shipped)) return false
    if (await adoptOwnedSeed(options, shipped)) return true
    if (lstatSync(active).isSymbolicLink())
      throw new Error('用户 profile 是外部链接，未自动替换；请使用独立的本机 profile')
    const id = randomUUID(),
      p = paths(options, id)
    const journal: Journal = {
      schemaVersion: 1,
      id,
      identity: options.identity,
      profileName: options.profileName,
      phase: 'preparing',
      createdAt: new Date().toISOString(),
      plugins: shipped
    }
    const advance = (phase: Phase): void => {
      journal.phase = phase
      atomicJson(join(p.home, JOURNAL), journal)
      options.onPhase?.(phase)
    }
    try {
      advance('preparing')
      const configurationRevision = profileConfigurationRevision(p.profile)
      await cloneProfile(p.profile, p.stagingProfile, options.onProgress)
      if (existsSync(join(p.home, 'cordis.patch.yml')))
        copyFileSync(join(p.home, 'cordis.patch.yml'), join(p.stagingHome, 'cordis.patch.yml'))
      const pkgFile = join(p.stagingProfile, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
      const originalBundles: string[] = pkg.dsh?.profile?.bundles ?? []
      const deps = { ...(pkg.dependencies ?? {}) }
      const bundles = [...originalBundles]
      let previousNames: string[] = []
      try {
        const previous = JSON.parse(readFileSync(join(p.home, MARKER), 'utf8'))
        previousNames = (previous.plugins ?? []).map((item: string | PluginIdentity) =>
          typeof item === 'string' ? item : item.name
        )
      } catch {
        /* No previous managed inventory. */
      }
      for (const plugin of shipped) {
        const source = join(options.seedHome, 'profiles', options.profileName, 'node_modules', plugin.name)
        const alreadyKnown =
          previousNames.includes(plugin.name) ||
          Object.hasOwn(deps, plugin.name) ||
          entryExists(join(p.profile, 'node_modules', plugin.name))
        // Removing a known bundle or dependency is an explicit user preference. Never re-enable it on upgrade.
        if (!alreadyKnown && !bundles.includes(plugin.name)) bundles.push(plugin.name)
        const vendor = join(p.stagingProfile, '.dsh-px-packages', plugin.name)
        await removeOwnedAsync(vendor, p.stagingHome)
        copyBundlePayload(source, vendor)
        const installed = join(p.stagingProfile, 'node_modules', plugin.name)
        await removeOwnedAsync(installed, p.stagingHome)
        copyBundlePayload(vendor, installed)
        if (Object.hasOwn(deps, plugin.name) || !alreadyKnown)
          deps[plugin.name] = `file:./.dsh-px-packages/${plugin.name}`
      }
      atomicJson(pkgFile, {
        ...pkg,
        dependencies: deps,
        dsh: { ...pkg.dsh, profile: { ...pkg.dsh?.profile, bundles } }
      })
      const installed = inspectManagedPlugins(p.stagingProfile, 'installed')
      for (const plugin of shipped)
        assertPluginIdentity(
          installed.find((item) => item.name === plugin.name)!,
          plugin
        )
      // The helper refuses every linked package path and replaces the private host inode atomically.
      // It cannot mutate external developer packages retained by cloneProfile.
      journal.sidebarCompatibility = applySidebarCompatibility(p.stagingProfile)
      await validateNativeProfile(options, p.stagingHome)
      await options.validate?.(p.stagingHome)
      // DSH-generated paths never travel with the profile; the next native boot rebuilds them.
      await removeOwnedAsync(join(p.stagingProfile, '.dsh-module-fallback'), p.stagingHome)
      await rebaseLinks(p.stagingProfile, p.stagingProfile, p.profile)
      advance('validated')
      if (profileConfigurationRevision(p.profile) !== configurationRevision)
        throw new Error('原 profile 配置在准备期间变更，已保留最新配置；请重试升级')
      mkdirSync(p.backupRoot, { recursive: true })
      renameSync(p.profile, p.backup)
      await rebaseLinks(p.backup, p.profile, p.backup)
      advance('old-moved')
      renameSync(p.stagingProfile, p.profile)
      advance('committed')
      recordCompletion(p.home, journal)
      recordBackup(options, journal, 'committed')
      await removeOwnedAsync(p.stagingHome, p.home)
      rmSync(join(p.home, JOURNAL))
      return true
    } catch (error) {
      let recovery = '原 profile 未改动'
      try {
        recovery =
          (await recover(options)) === 'committed'
            ? '已完成的 profile 已验证，重试即可继续'
            : '完整旧 profile 已恢复，可重试'
      } catch (restoreError) {
        recovery = `自动恢复尚未完成，请保留数据目录并重试：${String(restoreError)}`
      }
      throw new Error(`自管插件准备失败；${recovery}。事务 ${id}；${String(error)}`)
    }
  })
}
