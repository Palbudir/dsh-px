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
import { execFileSync } from 'node:child_process'
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

/** 获取 7zr（只需一次，约 600 KB）。 */
function ensure7z () {
  const vendored = join(TOOLS, '7zr.exe')
  if (existsSync(vendored)) return vendored
  for (const p of ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe']) {
    if (existsSync(p)) return p
  }
  if (process.platform !== 'win32') return '7z'
  mkdirSync(TOOLS, { recursive: true })
  log('本地没有 7-Zip，正在下载 7zr.exe（约 600 KB）')
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Invoke-WebRequest 'https://www.7-zip.org/a/7zr.exe' -OutFile '${vendored}' -UseBasicParsing`],
  { stdio: 'inherit' })
  if (!existsSync(vendored)) throw new Error('7zr.exe 下载失败')
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
  // -slt 给出结构化输出；这里用普通 l 并解析文本。
  //
  // 解析要点（第一版就在这里写错了，把"全部缺失"误报出来）：
  //   `7zr l` 的行格式是   ....A  <size>  <packed>  resources\runtime\node\node.exe
  //   属性列可能是 `....A` / `D....` / `....A` 等变体，分隔用**多个空格**，
  //   路径里用**反斜杠**。因此不能用"以路径开头"的朴素正则，要从行尾反向取路径。
  const raw = execFileSync(seven, ['l', installer], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

  // 解析要点（前两版都在这里出错，把"全部缺失"误报了出来）：
  // `7zr l` 的数据行形如
  //     ····················D....············0············0··resources\runtime\node
  // 即：可空的日期/时间列 + 属性列(如 D.... / ....A) + Size + Compressed + **路径(行尾)**。
  // 日期列为空时前面是一长串空格，列对齐并不可靠。
  // 因此这里反过来做：从行尾按"两个及以上空格"反向切，最后一段就是路径。
  const paths = []
  for (const rawLine of raw.split('\n')) {
    // 必须去掉 \r：7zr 在 Windows 上输出 CRLF，而 \r **不被 \s 视为空白**，
    // 于是路径会以 "…app.asar\r" 结尾，后续比较全部落空
    // —— 这正是"解析到 45988 条却报告全部缺失"的原因。
    const line = rawLine.replace(/\r$/, '')
    if (!/[\\/]/.test(line)) continue            // 路径一定含分隔符
    const parts = line.split(/\s{2,}/).filter(Boolean)
    const candidate = parts[parts.length - 1]
    if (!candidate) continue
    // 路径段必然把分隔符当普通字符；再用属性列做一次形状校验，滤掉表头与统计行。
    if (!/(^|[\\/])(resources|locales)([\\/]|$)/i.test(candidate) && !/\.(exe|dll|pak|bin|asar|json|yml|dat|html|txt)$/i.test(candidate)) continue
    paths.push(candidate.replace(/\\/g, '/').replace(/\/+$/, ''))
  }
  log(`解析到载荷条目：${paths.length}`)

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
