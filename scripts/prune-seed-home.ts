/**
 * 清理种子 home 里 dsh / 插件生成的运行时产物，并裁掉运行期用不到的交付物内容。
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
 *   node scripts/run.mjs prune-seed-home        # 经 run.mjs 运行（推荐）
 *
 * @module dsh-px/scripts/prune-seed-home
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { repoRoot } from './paths'

const REPO = repoRoot()
const RUNTIME = join(REPO, 'runtime')
const HOME = join(RUNTIME, 'dsh-home')
const PROFILE = process.env.DSH_PX_PROFILE ?? 'web'
const log = (m: string): void => { process.stdout.write(`[prune] ${m}\n`) }

if (!existsSync(HOME)) {
  log(`没有种子 home（${HOME}），无需清理`)
  process.exit(0)
}

/**
 * 递归统计体积（字节）。
 * @param p 起始路径
 */
function dirSize (p: string): number {
  let total = 0
  const walk = (dir: string): void => {
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
function rmTree (target: string): void {
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

const TARGETS: Array<[string, string]> = [
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

// ── 交付物瘦身：*.map 与 tests/ ────────────────────────────────────────────
//
// 这一步与上面的"清生成物"目的不同：那些是**不该存在**的，这两个是
// **合法但运行期用不到**的 —— 只裁掉它们，别的都不动。
//
//   *.map          源映射。只在 DevTools 里用；缺了它 JS 照常执行
//                  （末尾的 sourceMappingURL 注释指向不存在的文件，浏览器静默忽略）。
//                  实测随附运行时里有 6067 个，约 100 MB。
//   tests/ test/   包自带的测试。运行期不会有人跑它们。
//                  实测 61 个目录，约 9 MB。
//
// **不断言删掉的数量**：dsh 版本升级后这两个数字会变，写死会让流程变得脆弱。
// 只报告实际删掉了多少。
let mapFreed = 0
let mapCount = 0
const testsDirs: string[] = []

/**
 * 递归裁剪：删除 *.map，并整体删除名为 tests/test 的目录。
 * @param dir 起始目录
 * @param depth 当前深度（上限保护，见调用处说明）
 */
const trim = (dir: string, depth: number): void => {
  if (depth > 24) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = join(dir, e.name)
    // 符号链接/Junction 一律不跟随：随附运行时里 dsh 托管的 fallback 是链接，
    // 跟随会把只读安装区里的东西删掉（那是另一份数据）。
    if (e.isSymbolicLink()) continue
    // `node/` 是随附的 Node 本体，没有 map 也没有 tests，跳过省时间。
    if (depth === 0 && e.isDirectory() && e.name === 'node') continue
    if (e.isDirectory()) {
      if (e.name === 'tests' || e.name === 'test') {
        const sz = dirSize(full)
        rmTree(full)
        mapFreed += sz
        testsDirs.push(full)
        continue
      }
      trim(full, depth + 1)
      continue
    }
    if (e.name.endsWith('.map')) {
      try {
        const sz = statSync(full).size
        rmSync(full, { force: true, maxRetries: 2 })
        mapFreed += sz
        mapCount += 1
      } catch { /* 删不掉就留着，不影响功能 */ }
    }
  }
}

log('裁剪 *.map 与 tests/ …')
// 扫描范围刻意是整个 runtime（含 dsh 安装本体，不含 node）：
// 实测 map 分布为 dsh-home 1418 个（66.6 MB）+ dsh 本体 4649 个（35.7 MB），
// 只扫 dsh-home 会漏掉三分之一的收益。
//
// 深度上限是保护：万一将来把 runtime 指到了仓库外的共享目录，也不会一路删下去。
trim(RUNTIME, 0)
log(`已删除 ${String(mapCount)} 个 *.map、${String(testsDirs.length)} 个测试目录（共 ${(mapFreed / 1048576).toFixed(1)} MB）`)
freed += mapFreed

const afterTrim = dirSize(HOME)
log(`种子 home 现在 ${(afterTrim / 1048576).toFixed(1)} MB`)

// 交付物健康区间：干净的种子树应在 200–400 MB。明显超出说明又混进了生成物。
if (afterTrim > 500 * 1048576) {
  process.stderr.write(
    `[prune] 警告：种子 home 仍有 ${(afterTrim / 1048576).toFixed(0)} MB，` +
    '超出预期（干净时应约 300 MB）。可能有新的 dsh 生成物没被识别，请检查。\n'
  )
}
