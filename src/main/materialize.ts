/**
 * Materialize a fresh profile, yielding between batches so progress remains responsive.
 * Mutable configuration is copied. Installed package files may use hard links with a copy fallback.
 * DSH owns its fallback links; source-checkout links are dereferenced into release payloads.
 * Existing profiles are upgraded by the separate managed-plugins transaction.
 */
import {
  copyFileSync,
  createReadStream,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import * as asyncFs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { Dirent } from 'node:fs'

/** 播种进度：已处理项数 / 总计项数 / 已回退复制的项数 / 当前阶段文案。 */
export interface SeedProgress {
  done: number
  total: number
  copied: number
  phase: string
}

/** `materializeSeedHome` 的参数。 */
export interface MaterializeOptions {
  /** 随附的种子 home（只读）。 */
  seedHome: string
  /** 目标 home（可写）。 */
  home: string
  /** profile 名（对应 `profiles/<name>`）。 */
  profileName: string
  /** 随附的 dsh 安装目录；指向它内部的链接会被**原样保留**（见 `collect`）。 */
  dshDir: string
  /** 进度回调（节流由调用方决定）。 */
  onProgress?: (p: SeedProgress) => void
  /** 每个批次处理多少项后让出事件循环。 */
  batchSize?: number
  /**
   * 旧调用方兼容参数；true 会拒绝执行，已有 profile 必须使用独立迁移事务。
   */
  refresh?: boolean
  /**
   * 由已验证 runtime manifest 的版本与内容摘要计算的稳定身份。
   * 写进 `.dsh-px-materialized`，供下次启动判断"随附运行时换了没有"。
   */
  seedIdentity?: string
}

/** 物化结果。 */
export interface MaterializeResult {
  /** 硬链接成功的文件数。 */
  linked: number
  /** 复制（含跨卷回退）的文件数。 */
  copied: number
  /** 目标已存在而跳过的项数（续传）。 */
  skipped: number
  /** 总项数（目录 + 链接 + 文件）。 */
  total: number
  /** 耗时毫秒。 */
  ms: number
}

/** Reserved profile containers must be real directories, never links into another user tree. */
export function assertLocalProfilePath(home: string, profileName: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) throw new Error('profile 名无效')
  const profile = join(home, 'profiles', profileName)
  for (const directory of [
    join(home, 'profiles'),
    profile,
    join(profile, 'node_modules'),
    join(profile, '.dsh-px-packages'),
    join(home, '.dsh-px-staging'),
    join(home, 'backups'),
    join(home, 'backups', 'managed-profiles')
  ]) {
    try {
      const status = lstatSync(directory)
      if (status.isSymbolicLink() || !status.isDirectory())
        throw new Error(`保留用户目录，未写入：受管 profile 路径不能是外部链接或文件：${directory}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

async function copyAtomic(source: string, destination: string): Promise<void> {
  const temporary = `${destination}.dsh-px-copy-${randomUUID()}.tmp`
  try {
    await asyncFs.copyFile(source, temporary)
    await asyncFs.rename(temporary, destination)
  } finally {
    await asyncFs.rm(temporary, { force: true })
  }
}

async function sameContents(source: string, destination: string): Promise<boolean> {
  const [before, after] = await Promise.all([asyncFs.stat(source), asyncFs.stat(destination)])
  if (!before.isFile() || !after.isFile() || before.size !== after.size) return false
  if (before.dev === after.dev && before.ino === after.ino) return true
  const digest = async (file: string): Promise<string> => {
    const hash = createHash('sha256')
    for await (const bytes of createReadStream(file)) hash.update(bytes)
    return hash.digest('hex')
  }
  return (await digest(source)) === (await digest(destination))
}

/** 待处理项的类型。 */
type Kind = 'dir' | 'link' | 'hard' | 'copy'

/** 一个待处理项。 */
interface WorkItem {
  from: string
  to: string
  kind: Kind
}

/**
 * 判断某个顶层子项是否由 dsh 自己管理、必须整棵跳过。
 *
 * 判据是"dsh 自己管理"而不是"看起来像依赖"：dsh 的传递依赖闭包很大，
 * 按名字枚举必然漏（实测 `argparse` 这类就不在 dsh 的直接依赖清单里）。
 */
function isDshManagedName(name: string): boolean {
  return (name.startsWith('.dsh-') && name !== '.dsh-px-packages') || name === '@deepseek-ai'
}

/**
 * 递归收集待物化项。
 *
 * 链接的处理是这里**最关键也最容易搞错**的一点，分两种情况：
 *
 * 1. **指向随附 dsh 安装目录内部的链接** → 原样重建为链接。
 *    这些是 dsh 自己托管的 module fallback（实测开发机上 `profiles/node_modules`
 *    有 164 个 Junction 全指向 `runtime/dsh/node_modules`）。dsh 启动时**断言**它们
 *    必须是链接或它自己管理的 proxy，一旦被解引用成真目录就拒绝启动：
 *      `... exists and is not a symlink or dsh-managed module proxy`
 *
 * 2. **其余链接（含开发态插件）** → **解引用**，按真实内容物化。
 *    开发态自研插件是 Junction 指向源码仓库（`packages/dsh-px-updater`）。
 *    若原样重建，目标 home 里会留下一个指向构建机路径的**悬空链接**，
 *    harness 随即报 `Cannot find package '…'`（实测踩到）。因此必须跟随目标、
 *    把真实文件铺过去。
 *
 * @param profileSeedRoot `profiles/<name>` 的种子路径（用于识别顶层 `node_modules`）
 * @param hardlink 文件是否用硬链接（仅 `node_modules` 内为 true）
 * @param dshDir 随附 dsh 安装目录（判据 1 的边界）
 */
function collect(
  src: string,
  dest: string,
  items: WorkItem[],
  hardlink: boolean,
  profileSeedRoot: string,
  dshDir: string
): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(src, { withFileTypes: true })
  } catch (error) {
    throw new Error(`无法读取随附插件目录 ${src}：${describe(error)}`)
  }

  // 顶层 `profiles/<name>/node_modules` **不能**跳过：那里才是真插件依赖
  // （mermaid、@codemirror、react…）。要跳过的是上一级的 `profiles/node_modules`
  // ——那是 dsh 托管的 fallback 树，由调用方直接不进入（collect 从不访问它）。
  const isProfileRoot = src === profileSeedRoot

  for (const entry of entries) {
    if (isDshManagedName(entry.name)) continue
    // 用户主动设置的开发链接也归用户管理；绝不能沿它改写外部仓库。
    if (isMeaningfulLink(join(dest, entry.name))) continue
    if (isProfileRoot && entry.name === 'node_modules') {
      // 进入它，但**这一棵里的文件全部硬链接**（秒级、不占盘）。
      collect(join(src, entry.name), join(dest, entry.name), items, true, profileSeedRoot, dshDir)
      continue
    }

    const from = join(src, entry.name)
    const to = join(dest, entry.name)

    if (entry.isSymbolicLink()) {
      const target = linkTarget(from)
      if (target && isInside(target, dshDir)) {
        // 判据 1：dsh 托管的 fallback，原样重建（链接类型在 recreateLink 里按真实目标判定）。
        items.push({ from, to, kind: 'link' })
        continue
      }
      // 判据 2：解引用。源改用**解析后的真实路径**，这样 'hard' 项硬链接的是真文件；
      // 若真实目标是目录，就继续按目录递归（下面统一处理）。
      const real = target ?? from
      let realIsDir = false
      try {
        realIsDir = statSync(real).isDirectory()
      } catch (error) {
        throw new Error(`随附插件链接不可用 ${from}：${describe(error)}`)
      }
      if (!realIsDir) {
        items.push({ from: real, to, kind: hardlink ? 'hard' : 'copy' })
        continue
      }
      items.push({ from: real, to, kind: 'dir' })
      collect(real, to, items, hardlink, profileSeedRoot, dshDir)
      continue
    }
    if (entry.isDirectory()) {
      items.push({ from, to, kind: 'dir' })
      // 一旦进入 node_modules（hardlink=true）就整棵沿用硬链接；
      // 清单目录（hardlink=false）走复制。
      collect(from, to, items, hardlink, profileSeedRoot, dshDir)
      continue
    }
    items.push({ from, to, kind: hardlink ? 'hard' : 'copy' })
  }
}

/** 迁移种子留下的 pnpm 绝对路径。只改确切的种子引用，保留用户自定义 store。 */
export function repairPnpmMetadata(
  opts: Pick<MaterializeOptions, 'seedHome' | 'home' | 'profileName'>
): boolean {
  const rel = join('profiles', opts.profileName, 'node_modules')
  const file = join(opts.home, rel, '.modules.yaml')
  if (!existsSync(file) || isMeaningfulLink(file)) return false
  const text = readFileSync(file, 'utf8')
  let old: unknown
  let parsed: Record<string, unknown> | null = null
  const line = /^virtualStoreDir:\s*(.+)$/m.exec(text)
  try {
    parsed = JSON.parse(text)
    old = parsed?.virtualStoreDir
  } catch {
    const scalar = line?.[1].trim()
    if (scalar?.startsWith('"')) {
      try {
        old = JSON.parse(scalar)
      } catch {
        return false
      }
    } else old = scalar?.replace(/^'|'$/g, '').replace(/''/g, "'")
  }
  if (typeof old !== 'string') return false
  const sourceStore = join(opts.seedHome, rel, '.pnpm')
  // CI 装配时记录的是 runner 路径，不是安装后的 resources 路径。
  let shippedStore: string | undefined
  try {
    const shipped = readFileSync(join(opts.seedHome, rel, '.modules.yaml'), 'utf8')
    try {
      shippedStore = JSON.parse(shipped).virtualStoreDir
    } catch {
      const value = /^virtualStoreDir:\s*(.+)$/m.exec(shipped)?.[1].trim()
      shippedStore = value?.startsWith('"')
        ? JSON.parse(value)
        : value?.replace(/^'|'$/g, '').replace(/''/g, "'")
    }
  } catch {
    /* metadata absent */
  }
  const requestedStore = join(opts.home, rel, '.pnpm')
  if (
    ![sourceStore, shippedStore, requestedStore].some(
      (candidate) =>
        typeof candidate === 'string' && resolve(old).toLowerCase() === resolve(candidate).toLowerCase()
    )
  )
    return false
  // pnpm 会展开 Windows 的 ADMINI~1 等短路径；与它使用相同的真实 home。
  const targetStore = join(realpathSync.native(opts.home), rel, '.pnpm')
  if (resolve(old).toLowerCase() === resolve(targetStore).toLowerCase()) return false
  const next = parsed
    ? JSON.stringify({ ...parsed, virtualStoreDir: targetStore }, null, 2) + '\n'
    : text.replace(/^virtualStoreDir:.*$/m, `virtualStoreDir: ${JSON.stringify(targetStore)}`)
  // .modules.yaml 可能也是种子的硬链接：写临时文件再替换，不能原地改写。
  writeFileSync(file + '.dsh-px.tmp', next)
  renameSync(file + '.dsh-px.tmp', file)
  return true
}

/** 解析符号链接的绝对目标路径；失败返回 null。 */
function linkTarget(link: string): string | null {
  try {
    return resolve(dirname(link), readlinkSync(link))
  } catch {
    return null
  }
}

/** `child` 是否位于 `parent` 之内（两侧都做大小写归一，Windows 路径不分大小写）。 */
function isInside(child: string, parent: string): boolean {
  const c = resolve(child).toLowerCase()
  const p = (resolve(parent) + sep).toLowerCase()
  return (c + sep).startsWith(p)
}

/**
 * 重建一个符号链接/Junction。
 *
 * **类型必须按"真实目标"判定，不能按 Dirent**：Windows 上对 Junction 调用
 * `readdirSync({ withFileTypes: true })` 时 `entry.isDirectory()` 是 **false**
 * （Dirent 走 lstat 语义，看到的是重解析点本身）。若据此按"文件"建链接，
 * `symlinkSync(..., 'file')` 会以 ENOENT 失败（实测踩到），而目标处只留下一个
 * **不存在的链接** —— 表现为插件静默消失、harness 报 `Cannot find package`。
 */
function recreateLink(item: WorkItem): void {
  let target: string
  try {
    target = readlinkSync(item.from)
  } catch (err) {
    throw new Error(`读取链接目标失败：${describe(err)}`)
  }
  // 用解析后的真实目标判断是目录还是文件。
  let isDir = false
  try {
    isDir = statSync(item.from).isDirectory()
  } catch {
    throw new Error(`链接目标不可用（悬空）：${item.from} -> ${target}`)
  }
  if (process.platform === 'win32') {
    // 目录链接用 junction（无需开发者模式/管理员权限）；文件链接仍用符号链接。
    symlinkSync(target, item.to, isDir ? 'junction' : 'file')
  } else {
    symlinkSync(target, item.to, isDir ? 'dir' : 'file')
  }
}

/**
 * 把种子 home 物化到目标 home。
 *
 * 可续传：已存在的目标项直接跳过，所以中途失败后再启动不会从头再来。
 *
 * 只用于首次准备和未完成首启的续传；升级由 managed-plugins 事务负责。
 */
export async function materializeSeedHome(opts: MaterializeOptions): Promise<MaterializeResult> {
  if (opts.refresh) throw new Error('已有 profile 的升级必须使用 ensureManagedPlugins 事务，禁止原地刷新')
  const { seedHome, home, profileName, dshDir, onProgress } = opts
  assertLocalProfilePath(home, profileName)
  const batchSize = opts.batchSize ?? 400
  const t0 = Date.now()
  const verifyResume =
    !existsSync(join(home, '.dsh-px-materialized')) && existsSync(join(home, '.dsh-px-seed-claimed'))

  // ---- 1. 清单文件：一律**复制**（不能硬链接，见模块头部说明）----
  mkdirSync(home, { recursive: true })
  const manifestItems = [
    join('profiles', profileName, 'package.json'),
    join('profiles', profileName, 'cordis.patch.yml'),
    join('profiles', profileName, 'cordis.yml'),
    join('profiles', profileName, 'pnpm-workspace.yaml'),
    join('profiles', profileName, 'pnpm-lock.yaml')
  ]
  for (const rel of manifestItems) {
    const from = join(seedHome, rel)
    if (!existsSync(from)) continue
    const to = join(home, rel)
    try {
      mkdirSync(dirname(to), { recursive: true })
      if (!entryExists(to)) await copyAtomic(from, to)
    } catch (err) {
      // 清单文件很小；失败就如实抛出，不要带着空壳 profile 继续。
      throw new Error(`复制清单文件 ${rel} 失败：${describe(err)}`)
    }
  }

  // ---- 2. 收集待物化项 ----
  const profileSeed = join(seedHome, 'profiles', profileName)
  const items: WorkItem[] = []
  if (existsSync(profileSeed)) {
    // 关键：`profiles/node_modules`（dsh 托管的 fallback 树）根本不进入；
    // 而 `profiles/<name>/node_modules`（真插件依赖）由 collect 内部以硬链接展开。
    collect(profileSeed, join(home, 'profiles', profileName), items, false, profileSeed, dshDir)
  }

  const total = items.length
  let done = 0
  let linked = 0
  let copied = 0
  let skipped = 0
  let fallbackWarned = false
  /** 回退复制的样本（最多记若干条），用于事后排查"为什么变慢了/占盘了"。 */
  const fallbackDetails: string[] = []

  const report = (phase: string): void => {
    onProgress?.({ done, total, copied, phase })
  }
  report('正在准备本地运行时…')

  // ---- 3. 逐批应用，每批后让出事件循环 ----
  for (let i = 0; i < items.length; i += batchSize) {
    for (const item of items.slice(i, i + batchSize)) {
      done++
      try {
        switch (item.kind) {
          case 'dir':
            mkdirSync(item.to, { recursive: true })
            break
          case 'link':
            // 续传：目标已存在（含上次已建的同名链接）就跳过，不能重复建。
            if (entryExists(item.to)) {
              skipped++
              break
            }
            mkdirSync(dirname(item.to), { recursive: true })
            recreateLink(item)
            break
          case 'hard': {
            if (entryExists(item.to)) {
              if (!verifyResume || (await sameContents(item.from, item.to))) {
                skipped++
                break
              }
              await copyAtomic(item.from, item.to)
              copied++
              break
            }
            mkdirSync(dirname(item.to), { recursive: true })
            try {
              linkSync(item.from, item.to)
              linked++
            } catch (err) {
              // **任何**硬链接失败都回退到复制，绝不因此中断首启。
              // 复制只是慢一些、占盘一些，而中断会让应用完全不可用 —— 这个取舍
              // 是明确的。实测踩到过 `UNKNOWN: unknown error, link …`（某些大文件
              // 或特殊卷上会出现），当时因为只白名单了几个错误码而直接抛错、首启失败。
              // 跨卷（EXDEV）是最常见的一种，其余按不支持处理。
              if (!fallbackWarned) {
                fallbackWarned = true
                const code = (err as { code?: string } | null)?.code ?? 'UNKNOWN'
                process.stdout.write(
                  `[dsh-px] 硬链接不可用（${code}${isCrossDevice(err) ? '，安装目录与数据目录不在同一卷' : ''}），` +
                    '回退为复制：首次会明显更久、磁盘占用更大，但功能不受影响\n'
                )
              }
              fallbackDetails.push(`${(err as { code?: string } | null)?.code ?? 'UNKNOWN'}: ${item.from}`)
              // 复制本身也可能失败（磁盘满、权限、文件被占用）。到这里就不能再静默了：
              // 源文件是必需的，失败必须如实抛出并带上下文。
              try {
                await copyAtomic(item.from, item.to)
              } catch (copyErr) {
                throw new Error(`硬链接与复制都失败：${describe(copyErr)}`)
              }
              copied++
            }
            break
          }
          case 'copy': {
            if (entryExists(item.to)) {
              const vendor = join(home, 'profiles', profileName, '.dsh-px-packages')
              if (!verifyResume || !isInside(item.to, vendor) || (await sameContents(item.from, item.to))) {
                skipped++
                break
              }
            }
            mkdirSync(dirname(item.to), { recursive: true })
            await copyAtomic(item.from, item.to)
            copied++
            break
          }
        }
      } catch (err) {
        throw new Error(`准备 ${relative(home, item.to) || item.to} 失败：${describe(err)}`)
      }
    }
    report('正在准备本地运行时…')
    await new Promise<void>((res) => setImmediate(res))
  }

  repairPnpmMetadata(opts)
  writeFileSync(
    join(home, '.dsh-px-materialized'),
    `materialized from ${seedHome} at ${new Date().toISOString()}\n` +
      // Diagnostic source identity; managed plugin completion has its own validated marker.
      `seedIdentity=${opts.seedIdentity ?? '(none)'}\n` +
      `linked=${linked} copied=${copied} skipped=${skipped} total=${total} ms=${Date.now() - t0}\n` +
      (fallbackDetails.length
        ? `hardlinkFallback=${fallbackDetails.length}\n` +
          fallbackDetails
            .slice(0, 20)
            .map((d) => `  ${d}\n`)
            .join('')
        : 'hardlinkFallback=0\n')
  )
  report('完成')

  return { linked, copied, skipped, total, ms: Date.now() - t0 }
}

/** `EXDEV`：跨卷，硬链接不可用。 */
export function isCrossDevice(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'EXDEV'
}

/**
 * 文件系统不支持硬链接（FAT32、部分网络盘）或该文件上不具备硬链接条件。
 *
 * 注意：**回退判据不依赖本函数**——硬链接失败一律回退复制（见上面 `case 'hard'` 的
 * 说明），本函数只用于把原因说清楚、方便排查。
 */
export function isLinkUnsupported(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  return (
    code === 'ENOSYS' ||
    code === 'ENOTSUP' ||
    code === 'EOPNOTSUPP' ||
    code === 'EINVAL' ||
    code === 'EPERM' ||
    code === 'UNKNOWN'
  )
}

/** 目标是否为一个"有意义的"链接（用于续传判断）。 */
function isMeaningfulLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * 目标位置是否**已经有任何东西**（文件、目录、链接，**含悬空链接**）。
 *
 * 这里不能用 `existsSync`：它跟随链接，对**悬空链接返回 false**，
 * 于是续传时会试图在已有链接的位置再建一次，直接 EEXIST 失败。
 * 用 `lstatSync` 才能看到重解析点本身。
 */
function entryExists(p: string): boolean {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}

/** 把 unknown 的错误变成可读文本（不依赖 index.ts 的同名辅助，避免循环依赖）。 */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
