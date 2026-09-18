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

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const OUT = join(REPO, 'runtime')

/** 锁定的 dsh 版本。要改动请有意为之，改完重跑 `npm run verify`。 */
const DSH_VERSION = process.env.DSH_PX_DSH_VERSION ?? '0.1.5-rc.2'
/** 随附的独立 Node 运行时。必须满足 dsh 的 engines（>=20）。 */
const NODE_VERSION = process.env.DSH_PX_NODE_VERSION ?? '24.16.0'
const PROFILE = process.env.DSH_PX_PROFILE ?? 'web'

/** beta 版预装的插件。包名均已对 npm 注册表核验过。 */
const DEFAULT_PLUGINS = [
  'dshmarket',
  'dsh-better-sidebar',
  'dsh-mermaid-render',
  'dsh-find-plugin'
]

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
function copyTree (src, dest, { skip = SKIP_IN_PROFILE_TREE, skipEntry = null } = {}) {
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

/** 解析出这台机器当前在用的那份 dsh 安装。 */
function findGlobalDsh () {
  // `npm root -g` 是全局安装位置的权威来源。
  const root = execFileSync(shim('npm'), ['root', '-g'], {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  }).trim()
  const candidate = join(root, '@deepseek-ai', 'dsh')
  if (existsSync(join(candidate, 'lib', 'bin.js'))) return candidate
  throw new Error(`在 ${root} 下找不到全局 dsh 安装`)
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
  await pipeline(Readable.fromWeb(res.body), createWriteStream(archive))

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
  const src = findGlobalDsh()
  log(`正在从 ${src} 复制 dsh ${DSH_VERSION}（自包含，可能需要一分钟）`)
  mkdirSync(OUT, { recursive: true })
  cpSync(src, dest, { recursive: true, dereference: true })
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

  /** 从随附模板填充一个空的种子 home，然后安装插件。 */
  const buildFresh = () => {
    if (withPlugins) {
      log(`正在安装插件：${DEFAULT_PLUGINS.join('、')}`)
      // `dsh plugin` 会同时做两件事：从随附模板初始化缺失的 profile，
      // 以及根据已安装的包协调 dsh.profile.bundles。
      run(nodeExe, [dshEntry, 'plugin', '--profile', PROFILE, 'add', ...DEFAULT_PLUGINS], { env })
    } else {
      log('正在从随附模板初始化 profile')
      // 没有参数的 pnpm 子命令无法执行，所以这里直接播种 profile 契约要求的几个文件。
      // 这与 `dsh plugin` 的初始化行为一致。
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
        name: `dsh-profile-${PROFILE}`,
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'live' } }
      }, null, 2) + '\n')
      writeFileSync(join(profileDir, 'cordis.patch.yml'),
        '# dsh-px profile 补丁层；在每个组合包层之后应用。\n[]\n')
      writeFileSync(join(profileDir, 'cordis.yml'),
        '# dsh profile 根 —— 一个空的条目列表。整棵树是由补丁组合出来的。\n[]\n')
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
      // 再复制两处插件树。都用 skipEntry 滤掉"指向 dsh 自己包树的 Junction" ——
      // 那些是 dsh 管理的 fallback，解引用后会让 dsh 拒绝启动。
      const isDshFallback = makeDshFallbackFilter(dshDir)
      const srcWebModules = join(srcHome, 'profiles', PROFILE, 'node_modules')
      if (existsSync(srcWebModules)) {
        copyTree(srcWebModules, join(profileDir, 'node_modules'), { skipEntry: isDshFallback })
      }
      const srcTopModules = join(srcHome, 'profiles', 'node_modules')
      if (existsSync(srcTopModules)) {
        copyTree(srcTopModules, join(home, 'profiles', 'node_modules'), { skipEntry: isDshFallback })
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

  // pnpm >= 10 在获批前会拦截依赖的构建脚本。node-pty 需要它的 conpty
  // postinstall，否则侧栏终端会在运行时静默失败。只有全新安装那条路径需要这一步；
  // 复制来的树里已经带着构建好的二进制。
  if (withPlugins && !fromExisting) {
    const ws = join(profileDir, 'pnpm-workspace.yaml')
    if (existsSync(ws)) {
      const text = readFileSync(ws, 'utf8')
      if (!/^\s*allowBuilds:/m.test(text)) {
        writeFileSync(ws, text + '\nallowBuilds:\n  node-pty: true\n')
        log('已写入 node-pty 的 allowBuilds')
      }
      run(shim('pnpm'), ['approve-builds', '--all'], { cwd: profileDir, env })
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

  // 精确记录装配了什么，好让应用和 CI 都能对它做断言。
  const manifest = {
    stagedAt: new Date().toISOString(),
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

main().catch((err) => {
  process.stderr.write(`[stage] 失败：${err?.stack ?? err}\n`)
  process.exit(1)
})
