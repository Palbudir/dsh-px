/**
 * 清理种子 home 里 dsh / 插件生成的运行时产物。
 *
 * 为什么需要独立脚本（而不是只在 stage-runtime 里做一次）：
 *   `npm run verify --boot` 会**真的启动一次 harness**，而 dsh 启动时会在种子树里
 *   生成它自己的运行时产物。实测一次 verify 之后种子树从 308 MB 涨到 924 MB：
 *       profiles/node_modules            397 MB（dsh 重建的 fallback）
 *       profiles/web/.dsh-module-fallback 221 MB（profile 内 fallback）
 *   这些目录在用户首启时会就地重建，**不该进交付物**。
 *
 * 所以打包流程里 prune 必须在 **verify 之后、打包之前** 再跑一次：
 *     stage -> verify -> prune -> (build package)
 *
 * 发布 beta.0 时正是漏了这一步：安装后 dsh-home 达 924 MB（正常 308 MB）。
 *
 * 用法：
 *   node scripts/prune-seed-home.mjs
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOME = join(REPO, 'runtime', 'dsh-home')
const PROFILE = process.env.DSH_PX_PROFILE ?? 'web'
const log = (m) => process.stdout.write(`[prune] ${m}\n`)

if (!existsSync(HOME)) {
  log(`没有种子 home（${HOME}），无需清理`)
  process.exit(0)
}

/** 递归统计体积。 */
function dirSize (p) {
  let total = 0
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else { try { total += statSync(full).size } catch { /* 忽略 */ } }
    }
  }
  try { if (statSync(p).isDirectory()) walk(p) } catch { /* 忽略 */ }
  return total
}

/** 读只读文件会让 rmSync 失败；先清属性再删。 */
function rmTree (target) {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    spawnSync(process.platform === 'win32' ? 'cmd' : 'sh',
      process.platform === 'win32'
        ? ['/c', 'attrib', '-R', join(target, '*'), '/S', '/D']
        : ['-c', `chmod -R u+w '${target}'`],
      { stdio: 'ignore' })
    rmSync(target, { recursive: true, force: true, maxRetries: 3 })
  }
}

const TARGETS = [
  ['profiles/node_modules', join(HOME, 'profiles', 'node_modules')],
  ['profiles/<name>/.dsh-module-fallback', join(HOME, 'profiles', PROFILE, '.dsh-module-fallback')],
  ['profiles/<name>/.dsh-market', join(HOME, 'profiles', PROFILE, '.dsh-market')],
  ['storages', join(HOME, 'storages')],
  ['sessions', join(HOME, 'sessions')],
  ['.credentials.yaml', join(HOME, '.credentials.yaml')],
  ['settings.yaml', join(HOME, 'settings.yaml')]
]

let freed = 0
for (const [label, path] of TARGETS) {
  if (!existsSync(path)) continue
  const before = dirSize(path) || statSync(path).size
  rmTree(path)
  freed += before
  log(`已清理 ${label}（${(before / 1048576).toFixed(1)} MB）`)
}

const remaining = dirSize(HOME)
log(freed > 0 ? `共瘦身 ${(freed / 1048576).toFixed(1)} MB` : '没有需要清理的内容')
log(`种子 home 现在 ${(remaining / 1048576).toFixed(1)} MB`)

// 交付物健康区间：干净的种子树应在 200–400 MB。明显超出说明又混进了生成物。
if (remaining > 500 * 1048576) {
  process.stderr.write(
    `[prune] 警告：种子 home 仍有 ${(remaining / 1048576).toFixed(0)} MB，` +
    '超出预期（干净时应约 300 MB）。可能有新的 dsh 生成物没被识别，请检查。\n'
  )
}
