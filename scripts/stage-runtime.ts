/**
 * 装配 dsh-px 随附在 Electron 应用里的运行时。
 *
 * 会在 ./runtime 下产出：
 *   node/       独立的 Node 运行时（于是用户什么都不用装）
 *   dsh/        dsh CLI 安装，自包含（所有 @deepseek-ai/* 都在其内部）
 *   dsh-home/   种子 profile：profiles/<名称>/ + 插件树
 *
 * 设计笔记（都是撞了才知道的 —— 详见 docs/PACKAGING.md）：
 *   - 全局 dsh 安装本身是自包含的：内部嵌套了 239 个 @deepseek-ai 包。
 *     整体复制它就免去了重建 pnpm Junction fallback 树的麻烦。
 *   - $DSH_HOME/profiles/node_modules 是一棵指回 dsh 安装的 **Junction** 树。
 *     普通复制会把它丢掉，所以 profile 的安装是由装配好的 dsh 自己重做的
 *     （`dsh plugin add`）—— 那是构建 profile 唯一受支持的方式。
 *   - pnpm >= 10 在获批之前会拒绝执行依赖的构建脚本。node-pty 需要它的
 *     conpty.dll / OpenConsole.exe postinstall，所以装配出的 profile 的
 *     pnpm-workspace.yaml 必须带上 `allowBuilds: { node-pty: true }`。
 *
 * 用法：
 *   node scripts/stage-runtime.mjs                 # Node + dsh + 种子 home
 *   node scripts/stage-runtime.mjs --with-plugins  # 额外安装 DEFAULT_PLUGINS
 *   node scripts/stage-runtime.mjs --from-existing # 复制本地 ~/.dsh 的 profile，
 *                                                  # 而不是从零安装
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, cpSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { repoRoot } from './paths'
import { copyHoistedDependencies } from './copy-hoisted-dependencies'
import type { Dirent } from 'node:fs'

const REPO = repoRoot()
const OUT = join(REPO, 'runtime')

/** 锁定的 dsh 版本。要改动请有意为之，改完重跑 `npm run verify`。 */
const DSH_VERSION = process.env.DSH_PX_DSH_VERSION ?? '0.1.5-rc.2'
/** 随附的独立 Node 运行时。必须满足 dsh 的 engines（>=20）。 */
const NODE_VERSION = process.env.DSH_PX_NODE_VERSION ?? '24.16.0'
const PROFILE = process.env.DSH_PX_PROFILE ?? 'web'

/**
 * beta 版预装的插件。
 *
 * 外部插件均已对 npm 注册表核验过包名。
 * 最后一项是本仓库自带的插件（`packages/dsh-px-updater`），
 * 用 `file:` 引用安装 —— 这样它和外部插件走完全相同的链路：
 * 同样声明 `dsh.bundle.patch`、同样由 bundle 协调进入层栈。
 * 换言之，我们对自己的插件不做任何特殊处理，用的是官方机制本身。
 */
const DEFAULT_PLUGINS = [
  'dshmarket',
  'dsh-better-sidebar',
  'dsh-mermaid-render',
  'dsh-find-plugin',
  'file:packages/dsh-px-updater',
  'file:packages/dsh-px-workbench',
  'file:packages/dsh-px-taskflow'
]

/**
 * 上述 `file:` 项对应的包名（bundle 协调要用真实包名，而不是 file: 路径）。
 */
const LOCAL_PLUGIN_NAMES = ['dsh-px-updater', 'dsh-px-workbench', 'dsh-px-taskflow']
const COMMUNITY_VERSIONS: Record<string, string> = { dshmarket: '1.48.0', 'dsh-better-sidebar': '0.19.1', 'dsh-mermaid-render': '0.1.11', 'dsh-find-plugin': '0.3.7' }

/**
 * 用 `link:` 而不是 `file:` 安装本仓库自带的插件。
 *
 * 原因（踩过）：pnpm 的 `file:` 会做**硬拷贝**，源码改了安装副本不会更新 ——
 * 表现为"改了代码、重启、行为完全没变"，很容易误判成逻辑问题去查错方向。
 * `link:` 建立符号链接，源码即生效，开发迭代才正常。
 *
 * 发布时也不受影响：装配产物是把文件复制进 runtime 的，链接只在构建机上有意义。
 */
const USE_LINK_FOR_LOCAL = true

const args = new Set(process.argv.slice(2))
const log = (msg) => process.stdout.write(`[stage] ${msg}\n`)

function run (cmd, cmdArgs, opts = {}) {
  log(`$ ${cmd} ${cmdArgs.join(' ')}`)
  const res = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32', ...opts })
  if (res.status !== 0) throw new Error(`${cmd} exited with ${res.status}`)
  return res
}

/**
 * Windows 上 npm/pnpm 是以 .cmd 批处理垫片形式提供的，spawnSync 无法直接执行它们 ——
 * 需要 shell。按平台解析二进制名，免得每个调用点都得自己记着这件事。
 */
function shim (name) {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

/**
 * 递归复制 `src` 到 `dest`，跳过 `skip` 里列出的任何路径段。
 *
 * 之所以需要它：一是 `cpSync` 没有排除选项；二是因为 `profiles/node_modules`
 * 下装着两种截然不同的东西：
 *   - 第三方插件依赖（react、mermaid、@codemirror、node-pty）——
 *     **必须**复制，它们在这个包里别处找不到；
 *   - `@deepseek-ai` 那棵树 —— **绝不能**复制。它是 dsh 自己管理的
 *     "module proxy" fallback，一旦实体化成真目录，dsh 就拒绝启动：
 *       "…/profiles/node_modules/@deepseek-ai/dsh exists and is not a symlink or
 *        dsh-managed module proxy; remove it so dsh can manage the installation
 *        fallback"
 *     而且它也是冗余的：随附的 `runtime/dsh` 已经带了全部 239 个嵌套的
 *     `@deepseek-ai` 包，而组合包名称的解析优先走 dsh 安装目录。
 */
function copyTree (
  src: string,
  dest: string,
  { skip = SKIP_IN_PROFILE_TREE, skipEntry = null }: {
    skip?: Set<string>
    skipEntry?: ((entry: Dirent, fullPath: string) => boolean) | null
  } = {}
): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const from = join(src, entry.name)
    if (skipEntry && skipEntry(entry, from)) continue
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyTree(from, to, { skip, skipEntry })
    } else {
      // recursive:true 是必须的：Dirent 报的是链接本身，实际源可能是目录
      // （实测 '@agentclientprotocol/sdk/' 就是），少了它会以
      // "Recursive option not enabled" 直接失败。
      cpSync(from, to, { recursive: true, dereference: true, force: true })
    }
  }
}

/** dsh 自己管理的 fallback 命名空间；见 copyProfileTree 的说明。 */
const SKIP_IN_PROFILE_TREE = new Set(['@deepseek-ai'])

/**
 * 建立"哪些目录项是 dsh 管理的 fallback 链接"的判定函数。
 *
 * 背景（实测数据）：开发机上 `profiles/node_modules` 里有 **164 个 Junction 全部指向
 * `runtime/dsh/node_modules`**（即 dsh 自己的包树），另有 **23 个实体目录**才是真正的
 * 三方依赖。dsh 启动时会校验这些 fallback 必须是"链接或 dsh 管理的 module proxy"，
 * 一旦被解引用变成真目录就拒绝启动。所以：**指向 dsh 自身包树的链接绝不能复制**。
 *
 * 不能只按名字判断（`@deepseek-ai` 只是其中一部分，`commander`、`accepts` 等
 * 也都是这种链接），要按**链接目标**判断。同时注意：pnpm 的 `.pnpm` 内部链接
 * 指向的是 profile 自己的 store，那是真依赖，必须复制 —— 所以只认 dsh 包树这个前缀。
 * @param {string|null} dshDir
 * @returns {(entry: import('node:fs').Dirent, fullPath: string) => boolean}
 */
function makeDshFallbackFilter (dshDir) {
  if (!dshDir) return () => false
  const prefix = (join(dshDir, 'node_modules') + sep).toLowerCase()
  return (entry, fullPath) => {
    // dsh 自己的状态目录一律不复制：
    //   .dsh-module-fallback —— 每个 profile 内的 module fallback 树，
    //     其 Junction 指向 profile 自己的 node_modules（实测 @codemirror/commands
    //     指向 profiles/web/node_modules/@codemirror/commands）。解引用后同样会让
    //     dsh 以 "exists and is not a symlink or dsh-managed module proxy" 拒绝启动。
    //   .dsh-market —— 插件市场的状态目录。
    // 这些都是 dsh/插件生成物，首次启动会自行重建。
    if (entry.name.startsWith('.dsh-')) return true

    if (!entry.isSymbolicLink()) return false
    let target
    try { target = realpathSync(fullPath) } catch { return true } // 悬空链接一律跳过
    return (target + sep).toLowerCase().startsWith(prefix)
  }
}

/**
 * 对从活 profile 复制来的树，`rmSync` 会因为某些包带只读文件而失败。
 * 先清掉只读属性，让清理变成幂等的。
 */
function rmTree (target) {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    const res = spawnSync(process.platform === 'win32' ? 'cmd' : 'sh',
      process.platform === 'win32'
        ? ['/c', 'attrib', '-R', join(target, '*'), '/S', '/D']
        : ['-c', `chmod -R u+w '${target}'`],
      { stdio: 'ignore' })
    void res
    rmSync(target, { recursive: true, force: true, maxRetries: 3 })
  }
}

/**
 * 解析出一个可用的 pnpm 调用方式，并返回 [命令, 前置参数]。
 *
 * `dsh plugin add` 内部会调用 pnpm，所以 pnpm 必须在 PATH 上；
 * 但"必须在 PATH 上"不该成为构建的前提 —— CI 和干净机器上未必有。
 * 实测这里的探测顺序：
 *   1. PATH 上的 pnpm（开发机通常有）
 *   2. `npx --yes pnpm@<PIN>`（从 npm 拉取固定版本，任何有 npm 的机器都能用）
 * 注：`corepack enable` 需要管理员权限（实测 EPERM），所以不作依赖。
 */
function resolvePnpm () {
  if (process.env.DSH_PX_PNPM) return { cmd: process.env.DSH_PX_PNPM, pre: [] }
  const probe = spawnSync(shim('pnpm'), ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  })
  if (probe.status === 0) return { cmd: shim('pnpm'), pre: [] }
  log(`PATH 上没有可用的 pnpm，回退到 npx pnpm@${PNPM_VERSION}`)
  return { cmd: shim('npx'), pre: ['--yes', `pnpm@${PNPM_VERSION}`] }
}

/** 锁定的 pnpm 版本（`dsh plugin` 依赖它）。 */
const PNPM_VERSION = process.env.DSH_PX_PNPM_VERSION ?? '10'

/** 解析出这台机器当前在用的那份 dsh 安装（开发态优先）。 */
function findGlobalDsh () {
  // `npm root -g` 是全局安装位置的权威来源。
  const root = execFileSync(shim('npm'), ['root', '-g'], {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  }).trim()
  const candidate = join(root, '@deepseek-ai', 'dsh')
  if (existsSync(join(candidate, 'lib', 'bin.js'))) return candidate
  return null
}

/**
 * 从 npm 安装**锁定版本**的 dsh 到 runtime/_dsh-install，并返回其路径。
 *
 * 为什么必须有这条路径：CI（以及任何干净机器）上**没有全局 dsh**。
 * 最初的实现只走 `findGlobalDsh()`，于是 CI 每次都在这一步失败 ——
 * 也就是说那个 workflow 从来没有真正构建过任何东西。
 * 而且即便"能找到全局 dsh"也不该用：那会让构建产物取决于**本机装了哪一版**，
 * 与 `DSH_PX_DSH_VERSION` 声明的版本可能不一致。
 *
 * 用 `npm install --prefix` 而不是 `npm install -g`：
 * 不污染宿主环境，且位置确定、可缓存。
 * 注意 npm 会**提升**安装（239 个包平铺在 `node_modules/@deepseek-ai/` 下，
 * 而不是嵌套进 dsh 内部）。这对我们是好事 —— dsh 因此自包含，
 * 前面的装配逻辑无需改动。
 * @returns {string} dsh 安装目录
 */
function installDshFromNpm () {
  const prefix = join(OUT, '_dsh-install')
  const dshDir = join(prefix, 'node_modules', '@deepseek-ai', 'dsh')
  if (existsSync(join(dshDir, 'lib', 'bin.js'))) {
    log(`已从 npm 安装 dsh ${DSH_VERSION}：${dshDir}`)
    return dshDir
  }
  log(`正在从 npm 安装 dsh@${DSH_VERSION}（干净机器/CI 的路径）`)
  mkdirSync(prefix, { recursive: true })
  run(shim('npm'), [
    'install', '--prefix', prefix,
    '--no-audit', '--no-fund', '--loglevel', 'error',
    `@deepseek-ai/dsh@${DSH_VERSION}`
  ], { cwd: prefix })
  if (!existsSync(join(dshDir, 'lib', 'bin.js'))) {
    throw new Error(`npm 安装后仍找不到 ${join(dshDir, 'lib', 'bin.js')}`)
  }
  log(`已从 npm 安装 dsh -> ${dshDir}`)
  return dshDir
}

async function downloadNode () {
  const dir = join(OUT, 'node')
  const exe = process.platform === 'win32' ? join(dir, 'node.exe') : join(dir, 'bin', 'node')
  if (existsSync(exe)) {
    log(`Node 已装配：${exe}`)
    return exe
  }
  mkdirSync(dir, { recursive: true })

  const platform = { win32: 'win', darwin: 'darwin', linux: 'linux' }[process.platform]
  if (!platform) throw new Error(`不支持的平台 ${process.platform}`)
  const arch = { x64: 'x64', arm64: 'arm64' }[process.arch]
  if (!arch) throw new Error(`不支持的架构 ${process.arch}`)

  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const base = `node-v${NODE_VERSION}-${platform}-${arch}`
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${base}.${ext}`
  const archive = join(OUT, `${base}.${ext}`)

  log(`正在下载 ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  if (res.body === null) throw new Error('归档响应没有 body')
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(archive))

  log(`正在解压 ${base}`)
  if (ext === 'zip') {
    // Windows 10+ 自带的 tar 能读 zip；失败则回退到 Expand-Archive。
    const tar = spawnSync('tar', ['-xf', archive, '-C', OUT], { stdio: 'inherit' })
    if (tar.status !== 0) {
      run('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${OUT}' -Force`])
    }
  } else {
    run('tar', ['-xzf', archive, '-C', OUT])
  }

  const extracted = join(OUT, base)
  if (!existsSync(extracted)) throw new Error(`解压后本应存在 ${extracted}`)
  // 无论归档内部的目录名是什么，都规整成 runtime/node。
  rmSync(dir, { recursive: true, force: true })
  cpSync(extracted, dir, { recursive: true, dereference: true })
  rmSync(extracted, { recursive: true, force: true })
  rmSync(archive, { force: true })

  if (!existsSync(exe)) throw new Error(`装配后缺少 node 二进制：${exe}`)
  log(`已装配 node -> ${exe}`)
  return exe
}

function stageDsh () {
  const dest = join(OUT, 'dsh')
  if (existsSync(join(dest, 'lib', 'bin.js'))) {
    log(`dsh 已装配：${dest}`)
    return dest
  }
  // 开发机上若已装全局 dsh，就复用它（快、且离线）；
  // 否则（CI / 干净机器）从 npm 安装**锁定版本**。
  // 这两条路径必须都在，否则 CI 永远构建不出东西。
  const globalSrc = findGlobalDsh()
  if (globalSrc) {
    log(`正在从 ${globalSrc} 复制 dsh ${DSH_VERSION}（自包含，可能需要一分钟）`)
    mkdirSync(OUT, { recursive: true })
    cpSync(globalSrc, dest, { recursive: true, dereference: true })
    log(`已装配 dsh -> ${dest}`)
    return dest
  }

  // npm 路径：npm 会**提升**安装，239 个包平铺在 prefix 的 node_modules 下，
  // 而不是嵌套进 dsh 内部。所以只复制 dsh 一个目录不够 ——
  // 实测会报 `Cannot find package '@deepseek-ai/dsh-app-boot' imported from
  // <runtime>/dsh/lib/bin.js`。必须把整棵 node_modules 一起带上，
  // 复现"自包含"的布局（这也正是全局安装长成的样子）。
  const src = installDshFromNpm()
  const prefixModules = join(OUT, '_dsh-install', 'node_modules')
  log('正在组装自包含的 dsh 目录（提升安装 -> 嵌套布局）')
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true, dereference: true })
  copyHoistedDependencies(prefixModules, join(dest, 'node_modules'))
  // 依赖已经搬进 runtime/dsh/node_modules，_dsh-install 就只是构建中间产物了。
  // **必须删掉**：extraResources 会把整个 runtime/ 打进安装包 ——
  // beta.0 就是这样凭空胖了约 300 MB（多出 28747 个文件条目）。
  //
  // 但删除前先把它的 manifest 单独留一份：能力平价检查需要"官方安装"作基线，
  // 而 CI 上没有全局 dsh，基线只能来自这里。留一份 package.json 只要几 KB，
  // 比留着整个 212 MB 的安装目录划算得多。
  // 注意：**绝不能**把这份记录放进 runtime/dsh/ —— 那会污染交付物。
  const baselineDir = join(REPO, 'build', 'baseline')
  mkdirSync(baselineDir, { recursive: true })
  writeFileSync(join(baselineDir, 'dsh-package.json'), readFileSync(join(src, 'package.json')))
  log(`已留存官方 dsh manifest 作为能力平价基线（build/baseline/dsh-package.json）`)
  rmTree(join(OUT, '_dsh-install'))
  log('已清理 _dsh-install（构建中间产物，不进交付物）')
  log(`已装配 dsh -> ${dest}`)
  return dest
}

/**
 * 通过让装配好的 dsh 自己去创建并填充 profile，来构建种子 harness home。
 * 这是产出 profile 树唯一受支持的方式，而且它复现的正是 dsh 模块解析
 * 所期望的 Junction 布局。
 */
function stageHome (nodeExe, dshDir, { withPlugins, fromExisting }) {
  const home = join(OUT, 'dsh-home')
  const profileDir = join(home, 'profiles', PROFILE)
  const dshEntry = join(dshDir, 'lib', 'bin.js')
  const env = { ...process.env, DSH_HOME: home }

  /**
   * 读取已安装依赖里声明了 `dsh.bundle` 的包，用于协调 profile 的 bundles 列表。
   *
   * `dsh plugin add` 本来会做这件事，但它内部把 pnpm 当作子进程调用，
   * 在 CI 里更容易受环境影响；这里自己读一遍其实更确定、也更透明 ——
   * 判据就是官方规范本身：包 manifest 里有没有 `dsh.bundle.patch`。
   * @returns {string[]} 需要加入 bundles 的包名（按名称排序，保证可复现）
   */
  const installedBundles = (dir) => {
    const names: unknown[] = []
    const scan = (base, prefix) => {
      if (!existsSync(base)) return
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        // 必须同时接受**符号链接**：`link:` 协议（以及 pnpm 的 .pnpm 布局）
        // 给出的顶层条目是 symlink，`isDirectory()` 对它返回 false。
        // 只认 isDirectory() 会静默漏掉本地插件 —— 实测就是这样：
        // 插件装上了、也在 node_modules 里，却始终没进 bundles。
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        if (entry.name.startsWith('@')) {
          scan(join(base, entry.name), entry.name + '/')
          continue
        }
        const full = prefix + entry.name
        if (full.startsWith('@deepseek-ai/')) continue // 内置组合包由 dsh 自己解析
        try {
          const manifest = JSON.parse(readFileSync(join(base, entry.name, 'package.json'), 'utf8'))
          if (manifest?.dsh?.bundle?.patch) names.push(full)
        } catch { /* 不是包目录，忽略 */ }
      }
    }
    scan(dir, '')
    return [...new Set(names)].sort()
  }

  /** 从随附模板填充一个空的种子 home，然后安装插件。 */
  const buildFresh = () => {
    mkdirSync(profileDir, { recursive: true })
    if (!withPlugins) {
      log('正在从随附模板初始化 profile（不含插件）')
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
        name: `dsh-profile-${PROFILE}`,
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'live' } }
      }, null, 2) + '\n')
    } else {
      // 一步到位写出 profile 清单（依赖 + 从模板来的基础组合包），
      // 再由 pnpm 安装，最后按 manifest 协调 bundles。
      // 这样就不依赖 `dsh plugin add` 内部的 pnpm 子进程调用，确定性更好。
      log(`正在安装插件：${DEFAULT_PLUGINS.join('、')}`)
      // `file:` 引用在 pnpm 里是相对于 **profile 目录**解析的，所以本仓库自带的插件
      // 必须写成绝对路径；否则会去找 <profile>/packages/... 而必然失败。
      const deps = Object.fromEntries(DEFAULT_PLUGINS.map((p) => {
        if (p.startsWith('file:')) {
          const rel = p.slice('file:'.length)
          const abs = resolve(REPO, rel)
          // link: 建符号链接（源码即生效，开发迭代正常）；file: 是硬拷贝。
          return [JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8')).name, `${USE_LINK_FOR_LOCAL ? 'link' : 'file'}:${abs}`]
        }
        return [p, COMMUNITY_VERSIONS[p]]
      }))
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
        name: `dsh-profile-${PROFILE}`,
        private: true,
        dependencies: deps,
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'live' } }
      }, null, 2) + '\n')
      writeFileSync(join(profileDir, 'pnpm-workspace.yaml'),
        'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n' +
        '# pnpm >= 10 会拦截依赖的构建脚本；node-pty 需要它的 conpty postinstall，\n' +
        '# 否则侧栏终端会在运行时静默失败。\n' +
        'allowBuilds:\n  node-pty: true\n')
      const pnpm = resolvePnpm()
      run(pnpm.cmd, [...pnpm.pre, 'install'], { cwd: profileDir, env })
      // 显式重建原生模块，避免"install 静默跳过构建脚本、终端运行时才失败"。
      run(pnpm.cmd, [...pnpm.pre, 'rebuild', 'node-pty'], { cwd: profileDir, env })

      // 依官方规范协调 bundles：谁声明了 dsh.bundle.patch，谁就进层栈。
      const pkgPath = join(profileDir, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const found = installedBundles(join(profileDir, 'node_modules'))
      pkg.dsh.profile.bundles = [...new Set([...pkg.dsh.profile.bundles, ...found])]
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
      log(`bundles 已协调：${pkg.dsh.profile.bundles.join('、')}`)
    }
    writeFileSync(join(profileDir, 'cordis.patch.yml'),
      '# dsh-px profile 补丁层；在每个组合包层之后应用。\n[]\n')
    writeFileSync(join(profileDir, 'cordis.yml'),
      '# dsh profile 根 —— 一个空的条目列表。整棵树是由补丁组合出来的。\n[]\n')
    if (!existsSync(join(profileDir, 'pnpm-workspace.yaml'))) {
      writeFileSync(join(profileDir, 'pnpm-workspace.yaml'),
        'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    }
    if (!existsSync(join(profileDir, 'package.json'))) {
      throw new Error(`profile 未能在 ${profileDir} 初始化`)
    }
  }

  if (fromExisting) {
    const srcHome = process.env.DSH_PX_SOURCE_HOME ?? process.env.DSH_HOME ??
      join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
    if (!existsSync(join(srcHome, 'profiles', PROFILE, 'package.json'))) {
      throw new Error(`--from-existing：${join(srcHome, 'profiles', PROFILE)} 下没有 profile`)
    }
    if (!existsSync(join(profileDir, 'package.json'))) {
      log(`正在从 ${srcHome} 复制可用的 profile（快路径）`)
      log('  排除 @deepseek-ai/* —— 那棵树由 dsh 自己管理，且随附的 dsh 已经提供它')
      mkdirSync(join(home, 'profiles'), { recursive: true })
      // 先复制 profile 自己的文件（很便宜，而且它们定义了组合）。
      for (const f of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml']) {
        const from = join(srcHome, 'profiles', PROFILE, f)
        if (existsSync(from)) cpSync(from, join(profileDir, f), { force: true })
      }
      // 再复制插件树。
      //
      //   profiles/<name>/node_modules  —— 复制，但滤掉 dsh 管理的链接。
      //     这里才混着真插件依赖（mermaid、@codemirror、node-pty、react…）。
      //
      //   profiles/node_modules         —— **整体跳过**。实测开发机上它有 164 个
      //     Junction（全部指向 dsh 包树）+ 23 个实体目录，而那 23 个全是 dsh 自己的
      //     依赖作用域（@aws-sdk、@octokit、@opentelemetry、@anthropic-ai、
      //     @deepseek-ai …）。整棵就是 dsh 托管的 fallback 树，不含插件依赖，
      //     dsh 首启会自行重建。（曾试图按名字过滤：不可行，dsh 的传递依赖闭包很大，
      //     `argparse` 这类不在其直接依赖清单里，逐个枚举必然漏。）
      const isDshFallback = makeDshFallbackFilter(dshDir ?? null)
      const srcWebModules = join(srcHome, 'profiles', PROFILE, 'node_modules')
      if (existsSync(srcWebModules)) {
        copyTree(srcWebModules, join(profileDir, 'node_modules'), { skipEntry: isDshFallback })
      }
      // 兜底：确保种子树里没有顶层 fallback 树残留。
      const strayTop = join(home, 'profiles', 'node_modules')
      if (existsSync(strayTop)) {
        rmTree(strayTop)
        log('已移除顶层 profiles/node_modules（dsh 托管的 fallback 树，会自行重建）')
      }
    } else {
      log(`种子 home 已填充，保留现状：${profileDir}`)
    }
    // 兜底清理：无论走哪条路径，都不允许种子树里残留 dsh 的 fallback 目录。
    // 若这里的目录还在，说明它是被解引用过的实体目录（而非链接），
    // dsh 会以 "exists and is not a symlink or dsh-managed module proxy" 拒绝启动。
    const strayProxy = join(home, 'profiles', 'node_modules', '@deepseek-ai')
    if (existsSync(strayProxy)) {
      rmTree(strayProxy)
      log('已从种子 home 移除残留的 @deepseek-ai fallback 树（dsh 会自行重建）')
    }
  } else if (existsSync(join(profileDir, 'package.json'))) {
    log(`种子 home 已填充：${profileDir}`)
  } else {
    mkdirSync(home, { recursive: true })
    buildFresh()
  }

  // 全新安装路径已在 buildFresh 内处理构建脚本（写 allowBuilds + 显式 rebuild
  // node-pty），这里不再重复。复制路径的树里已经带着构建好的二进制。

  if (withPlugins) {
    for (const [name, version] of Object.entries(COMMUNITY_VERSIONS)) {
      const installed = JSON.parse(readFileSync(join(profileDir, 'node_modules', name, 'package.json'), 'utf8'))
      if (installed.version !== version) throw new Error(`种子插件 ${name} 版本 ${installed.version} 不符合选型 ${version}，请更新种子后重新装配`)
    }
    for (const name of LOCAL_PLUGIN_NAMES) {
      const installed = JSON.parse(readFileSync(join(profileDir, 'node_modules', name, 'package.json'), 'utf8'))
      const expected = JSON.parse(readFileSync(join(REPO, 'packages', name, 'package.json'), 'utf8')).version
      if (installed.version !== expected) throw new Error(`自制插件 ${name} 未更新到 ${expected}`)
    }
  }
  return home
}

async function main () {
  log(`仓库=${REPO}`)
  log(`目标 runtime=${OUT}`)
  rmSync(join(OUT, 'dsh-home', '.dsh-px-seeded'), { force: true })

  const nodeExe = await downloadNode()
  const dshDir = stageDsh()
  const home = stageHome(nodeExe, dshDir, {
    withPlugins: args.has('--with-plugins'),
    fromExisting: args.has('--from-existing')
  })

  // 装完立刻洗干净，**默认就做**（不再依赖调用方记得加 --prune）。
  //
  // 为什么改成默认：这个坑反复出现了三次 —— 种子树被 dsh 生成物污染后
  // （profiles/node_modules、profiles/web/.dsh-module-fallback），
  // 会被 extraResources 原样打进安装包，beta.0 的安装后目录因此达到 924 MB。
  // 只要"清理"是可选的，就总会有入口忘记调用（如 npm run pack）。
  // 因此把清理内建为装配的收尾步骤，另外保留 npm run prune 供 verify 之后补跑。
  pruneSeedHome(home)

  // 精确记录装配了什么，好让应用和 CI 都能对它做断言。
  //
  // `app.version` 从 package.json 读，写进这里成为**应用版本的唯一真相源**。
  // 为什么不直接调 Electron 的 app.getVersion()：开发态下它返回的是
  // **Electron 自己的版本**（实测得到 "38.8.6"），而不是本应用的版本，
  // 于是更新检查会得出"有新版本吗"的错误结论。
  const appManifest = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  const manifest = {
    stagedAt: new Date().toISOString(),
    app: { name: appManifest.name, version: appManifest.version },
    platform: process.platform,
    arch: process.arch,
    node: { version: NODE_VERSION, path: nodeExe.replace(REPO, '.') },
    dsh: { version: DSH_VERSION, path: dshDir.replace(REPO, '.') },
    profile: PROFILE,
    plugins: args.has('--with-plugins') ? DEFAULT_PLUGINS : [],
    home: home.replace(REPO, '.')
  }
  writeFileSync(join(OUT, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  log('已写入 runtime/runtime-manifest.json')
  log('完成。下一步：npm run verify')
}

/**
 * 从种子树中删除 dsh / 插件生成的运行时产物。
 *
 * 这些目录在用户首次启动时会就地重建，因此**不该进交付物** ——
 * 它们既拖大安装包，又可能带着构建机器上的路径痕迹。
 *
 * 注意：本函数必须只在"装配收尾"时调用。`npm run verify` 之后如果不再 prune，
 * 生成的产物就会被打包进安装包（beta.0 的真实事故）。
 * @param {string} home 种子 home 目录
 */
function pruneSeedHome (home) {
  const targets = [
    join(home, 'profiles', 'node_modules'),                                  // dsh 重建的顶层 fallback
    join(home, 'profiles', PROFILE, '.dsh-module-fallback'),                 // profile 内 fallback
    join(home, 'profiles', PROFILE, '.dsh-market'),                          // 市场状态
    join(home, 'storages'),                                                  // 构建期 KV 落盘
    join(home, 'sessions'),                                                  // 构建期会话（verify 会写）
    join(home, '.credentials.yaml'),                                         // 绝不外带任何凭据
    join(home, 'settings.yaml')                                              // 构建机上的设置
  ]
  let freed = 0
  for (const t of targets) {
    if (!existsSync(t)) continue
    const before = dirSize(t)
    rmTree(t)
    freed += before
    log(`已清理种子树中的 ${t.replace(home, '<home>')}（${(before / 1048576).toFixed(1)} MB）`)
  }
  if (freed > 0) log(`种子树共瘦身 ${(freed / 1048576).toFixed(1)} MB`)
}

/** 递归统计目录体积（字节）。 */
function dirSize (p) {
  let total = 0
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else { try { total += statSync(full).size } catch { /* 忽略不可读项 */ } }
    }
  }
  try { if (statSync(p).isDirectory()) walk(p) } catch { /* 不是目录就算了 */ }
  return total
}

main().catch((err) => {
  process.stderr.write(`[stage] 失败：${err?.stack ?? err}\n`)
  process.exit(1)
})
