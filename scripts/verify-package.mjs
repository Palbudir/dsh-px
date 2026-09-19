/**
 * 校验**安装包内部**的内容，而不是只看 `win-unpacked`。
 *
 * 为什么需要这个脚本（一次真实的教训）：
 *   beta.0 发布时我只验证了 `dist/win-unpacked/`，那里一切正常；
 *   但用户装完却起不来。事后才发现问题只在"安装后的目录"里才暴露。
 *   只验证中间产物、不验证最终交付物，等于没验证。
 *
 * 本脚本检查三件事：
 *   1. **必备文件确实在安装包载荷里** —— 尤其是 runtime/node/node.exe。
 *      少了它，应用装完根本起不来，而 win-unpacked 里却是好的。
 *   2. **不该有的东西没被打进去** —— 构建中间产物（runtime/_dsh-install）
 *      曾让安装包凭空胖了约 300 MB。
 *   3. 载荷规模在合理范围，异常时给出提示。
 *
 * 用 7-Zip 读取 NSIS 载荷；没装 7-Zip 时会自动下载 7zr.exe（约 600 KB）。
 *
 * 用法：
 *   node scripts/verify-package.mjs                 # 校验 dist 下最新的安装包
 *   node scripts/verify-package.mjs <安装包路径>
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(REPO, 'dist')
const TOOLS = join(REPO, 'build', 'tools')
const log = (m) => process.stdout.write(`[pkg] ${m}\n`)

/** 交付物里**必须**存在的路径（相对安装根）。缺任何一个，装出来的应用就是坏的。 */
const REQUIRED = [
  'resources/app.asar',
  'resources/app-update.yml',
  'resources/runtime/runtime-manifest.json',
  'resources/runtime/node/node.exe',
  'resources/runtime/dsh/lib/bin.js',
  'resources/runtime/dsh-home/profiles/web/package.json'
]

/** 绝不该出现在交付物里的构建中间产物。 */
const FORBIDDEN = [
  'resources/runtime/_dsh-install'
]

/** 获取可用的 7-Zip。优先用系统/CI 已安装的，最后才尝试下载。 */
function ensure7z () {
  // 1) 显式配置
  if (process.env.DSH_PX_7Z) {
    if (existsSync(process.env.DSH_PX_7Z)) return process.env.DSH_PX_7Z
    throw new Error(`DSH_PX_7Z 指向的文件不存在：${process.env.DSH_PX_7Z}`)
  }
  // 2) 仓库内自带的（本地开发时下载一次即可）
  const vendored = join(TOOLS, '7zr.exe')
  if (existsSync(vendored)) return vendored
  // 3) 系统安装
  for (const p of ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe']) {
    if (existsSync(p)) return p
  }
  // 4) PATH 上的 7z（CI 里用 choco 安装后就在 PATH 上，这是最省事的一条）
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['7z'], { encoding: 'utf8' })
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim().split(/\r?\n/)[0].trim()

  if (process.platform !== 'win32') return '7z'

  // 5) 最后才下载。**注意**：CI 上这一步曾静默失败，导致"解析到 10 条载荷"
  //    从而误报全部缺失。因此这里不再静默 —— 失败就抛出可读原因，
  //    并在 CI 里由工作流预装 7-Zip 来避免走到这一步。
  mkdirSync(TOOLS, { recursive: true })
  log('本地没有 7-Zip，尝试下载 7zr.exe（约 600 KB）')
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Invoke-WebRequest 'https://www.7-zip.org/a/7zr.exe' -OutFile '${vendored}' -UseBasicParsing`],
    { stdio: 'inherit' })
  } catch (err) {
    throw new Error(
      `无法获得 7-Zip，因此不能校验安装包内容。\n` +
      `  自动下载失败：${err?.message ?? err}\n` +
      `  解决：安装 7-Zip（CI 上可 choco install 7zip -y），或设置 DSH_PX_7Z 指向 7z 可执行文件。`
    )
  }
  if (!existsSync(vendored)) throw new Error('7zr.exe 下载后仍不存在')
  return vendored
}

function pickInstaller (argPath) {
  if (argPath) return resolve(argPath)
  const candidates = readdirSync(DIST)
    .filter((f) => /Setup.*\.exe$/i.test(f))
    .map((f) => join(DIST, f))
  if (candidates.length === 0) throw new Error(`dist 下没有找到安装包：${DIST}`)
  // 取最新的一个
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

function main () {
  const installer = pickInstaller(process.argv[2])
  log(`安装包：${installer}`)
  log(`大小：${(statSync(installer).size / 1048576).toFixed(1)} MB`)

  const seven = ensure7z()
  // 用 `-slt`（结构化列表）而不是普通 `l`。
  //
  // 教训：普通 `l` 的输出是**列对齐的表格**，同一份 7-Zip 在不同环境
  // （CI runner 与本地）上给出不同列宽/空白，靠文本切分去解析非常脆 ——
  // 实测 CI 上只解析出 10 条，而本地同样命令解析出 45990 条。
  // `-slt` 把每个属性单独一行（`Path = ...`、`Attributes = ...`），
  // 不依赖对齐，是 7-Zip 官方给脚本用的格式。
  const raw = execFileSync(seven, ['l', '-slt', installer], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

  const paths = []
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    // 结构化格式里路径就是 `Path = ...`；末尾的归档自身路径会先出现一次，
    // 它不含分隔符，会被后面的过滤自然剔除。
    const m = line.match(/^Path = (.+)$/)
    if (!m) continue
    const p = m[1].trim().replace(/\\/g, '/').replace(/\/+$/, '')
    if (!p || !p.includes('/')) continue      // 只要归档内部路径
    paths.push(p)
  }
  log(`解析到载荷条目：${paths.length}`)

  // 防线：条目数过少说明**解析失败**，而不是"文件缺失"。
  //
  // 实测教训：CI 上曾只解析到 10 条，于是把"资源全都不存在"报了出来 ——
  // 而安装包其实是好的（232 MB、4 万多个文件）。这种误报方向最糟：
  // 它会让人去查打包问题，而真正的问题是校验工具或解析方式不可用。
  if (paths.length < 1000) {
    const sample = raw.split('\n').slice(0, 12).map((l) => '    | ' + l.replace(/\r$/, '')).join('\n')
    throw new Error(
      `只解析到 ${paths.length} 个载荷条目，远少于预期（应约 4 万）—— ` +
      `这说明 7-Zip 没能按预期列出安装包内容，而不是文件缺失。\n` +
      `  使用的 7-Zip：${seven}\n` +
      `  7-Zip 输出开头：\n${sample}\n` +
      `  请确认它可用（DSH_PX_7Z 可显式指定）。`
    )
  }

  const entries = raw.split('\n')
  const normalized = new Set(paths.map((p) => p.toLowerCase()))
  const failures = []

  // 1) 必备文件
  for (const req of REQUIRED) {
    const hit = [...normalized].some((p) => p === req.toLowerCase() || p.startsWith(req.toLowerCase() + '/'))
    if (hit) log(`PASS  含 ${req}`)
    else { log(`FAIL  缺少 ${req}`); failures.push(`缺少 ${req}`) }
  }

  // 2) 禁止项
  for (const bad of FORBIDDEN) {
    const hit = [...normalized].some((p) => p === bad.toLowerCase() || p.startsWith(bad.toLowerCase() + '/'))
    if (hit) { log(`FAIL  含不该打进去的构建产物 ${bad}`); failures.push(`含 ${bad}`) }
    else log(`PASS  不含 ${bad}`)
  }

  // 3) 规模提示
  const statsLine = entries.find((l) => /\d+ files, \d+ folders/.test(l))
  if (statsLine) log(`载荷规模：${statsLine.trim()}`)

  const warnLine = entries.find((l) => /^Warnings?:/i.test(l.trim()))
  if (warnLine) log(`7-Zip 提示：${warnLine.trim()}（通常无害，但值得看一眼）`)

  if (failures.length) {
    process.stderr.write(`\n[pkg] 校验失败：\n  - ${failures.join('\n  - ')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('\n[pkg] 安装包内容校验通过\n')
  }
}

try {
  main()
} catch (err) {
  process.stderr.write(`[pkg] 出错：${err?.stack ?? err}\n`)
  process.exit(1)
}
