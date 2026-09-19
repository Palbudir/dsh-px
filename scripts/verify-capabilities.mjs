/**
 * 验证装配出的 dsh-px 运行时至少达到了官方 dsh 的能力。
 *
 * beta 的验收问题是："打包后的应用是否提供了普通 `dsh --profile web` 安装所提供的东西？"
 * 我们机械地回答它，而不是凭感觉：
 *
 *   1. 结构     装配出的运行时存在，且它的 profile 声明了官方随附 profile 所声明的同一批组合包层。
 *   2. 能力平价 用 `--dump-config` 分别组合出装配版 profile 与官方 profile 的树，
 *               然后比较组合出的插件行集合（id + name）。
 *               官方有而装配版缺的任何东西都是能力缺口。
 *   3. 启动     （--boot）在临时端口上启动装配好的 harness，并证明它的 HTTP 面有应答。
 *
 * 用法：
 *   node scripts/verify-capabilities.mjs            # 结构 + 能力平价
 *   node scripts/verify-capabilities.mjs --boot     # 额外启动并探测
 *   node scripts/verify-capabilities.mjs --json     # 机器可读结果
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const RUNTIME = join(REPO, 'runtime')
const PROFILE = process.env.DSH_PX_PROFILE ?? 'web'
const BOOT = process.argv.includes('--boot')
const AS_JSON = process.argv.includes('--json')

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  if (!AS_JSON) process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` —— ${detail}` : ''}\n`)
}

/** 解析 `--dump-config` 那种类 YAML 输出，取出组合出的行。 */
function parseRows (yaml) {
  const rows = []
  let current = null
  for (const raw of yaml.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (/^\s*#\s*==/.test(line)) continue
    const idMatch = line.match(/^-\s+id:\s*(\S+)\s*$/)
    if (idMatch) {
      if (current) rows.push(current)
      current = { id: idMatch[1], name: null }
      continue
    }
    const nameMatch = line.match(/^\s+name:\s*'?([^'\s]+)'?\s*$/)
    if (nameMatch && current && current.name === null) current.name = nameMatch[1]
  }
  if (current) rows.push(current)
  return rows
}

function dump (nodeExe, dshEntry, home) {
  const out = execFileSync(nodeExe, [dshEntry, '--profile', PROFILE, '--dump-config'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home },
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return parseRows(out)
}

/**
 * 定位用作能力平价基线的"官方 dsh"。
 *
 * 三条来源，按顺序：
 *   1. `runtime/_dsh-install` —— stage 脚本从 npm 安装的**锁定版本**。
 *      但它现在会被清理掉（避免 212 MB 被误打包），所以只在未清理时可用。
 *   2. 全局安装 —— 开发机上顺手可用。
 *   3. `build/baseline/dsh-package.json` —— stage 在清理前留存的官方 manifest。
 *      这是 CI 上**唯一**可用的基线来源：CI 没有全局 dsh，
 *      而 _dsh-install 已被删除。只留一个 JSON 文件即可支撑平价对比。
 *
 * 早期只查全局安装，CI 上基线永远缺失、平价检查被静默跳过；
 * 后来 _dsh-install 被清理又让基线消失。这两处都是真实踩过的坑。
 * @returns {{kind:'install', dir:string} | {kind:'manifest', file:string} | null}
 */
function officialBaseline () {
  // 强制走 manifest 分支：CI 上就是这条路径（无全局 dsh、_dsh-install 已清理），
  // 而开发机上因为装了全局 dsh 走不到它 —— 若不显式测，这条唯一在 CI 生效的
  // 分支就从未被验证过。
  if (process.argv.includes('--baseline=manifest')) {
    const forced = join(REPO, 'build', 'baseline', 'dsh-package.json')
    return existsSync(forced) ? { kind: 'manifest', file: forced } : null
  }

  const fromNpmInstall = join(RUNTIME, '_dsh-install', 'node_modules', '@deepseek-ai', 'dsh')
  if (existsSync(join(fromNpmInstall, 'lib', 'bin.js'))) return { kind: 'install', dir: fromNpmInstall }

  try {
    const root = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32'
    }).trim()
    const dir = join(root, '@deepseek-ai', 'dsh')
    if (existsSync(join(dir, 'lib', 'bin.js'))) return { kind: 'install', dir }
  } catch { /* 没有全局 npm/dsh 也正常 */ }

  const manifest = join(REPO, 'build', 'baseline', 'dsh-package.json')
  if (existsSync(manifest)) return { kind: 'manifest', file: manifest }

  return null
}

async function bootProbe (nodeExe, dshEntry, home) {
  const port = 34000 + Math.floor(Math.random() * 1000)
  const child = spawn(nodeExe, [dshEntry, '--profile', PROFILE, '--host', '127.0.0.1',
    '--port', String(port), '--no-open'], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = ''
  child.stdout.on('data', (c) => { log += c })
  child.stderr.on('data', (c) => { log += c })
  const url = `http://127.0.0.1:${port}/`
  const deadline = Date.now() + 150_000
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`提前退出（${child.exitCode}）\n${log.slice(-2000)}`)
      try {
        const res = await fetch(url, { redirect: 'manual' })
        return { ok: true, status: res.status, url, log }
      } catch { /* 还没开始监听 */ }
      await new Promise((r) => setTimeout(r, 400))
    }
    throw new Error(`150 秒内未就绪\n${log.slice(-2000)}`)
  } finally {
    if (child.exitCode === null) child.kill()
  }
}

async function main () {
  const nodeExe = process.platform === 'win32'
    ? join(RUNTIME, 'node', 'node.exe')
    : join(RUNTIME, 'node', 'bin', 'node')
  const dshEntry = join(RUNTIME, 'dsh', 'lib', 'bin.js')
  const home = join(RUNTIME, 'dsh-home')
  const profileDir = join(home, 'profiles', PROFILE)

  // ---- 1. 结构 ------------------------------------------------------------
  record('装配的 Node 运行时存在', existsSync(nodeExe), nodeExe.replace(REPO, '.'))
  record('装配的 dsh 安装存在', existsSync(dshEntry), dshEntry.replace(REPO, '.'))
  record('种子 profile 存在', existsSync(join(profileDir, 'package.json')), profileDir.replace(REPO, '.'))

  if (!existsSync(nodeExe) || !existsSync(dshEntry)) return finish()

  const runtimeManifest = join(RUNTIME, 'runtime-manifest.json')
  if (existsSync(runtimeManifest)) {
    const m = JSON.parse(readFileSync(runtimeManifest, 'utf8'))
    record('运行时 manifest 存在', true, `dsh ${m.dsh?.version} / node ${m.node?.version}`)
  }

  if (!existsSync(join(profileDir, 'package.json'))) return finish()
  const profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const bundles = profileManifest?.dsh?.profile?.bundles ?? []
  for (const required of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
    record(`profile 声明了 ${required}`, bundles.includes(required), `bundles=${bundles.join(', ')}`)
  }

  // ---- 2. 与官方安装做能力平价 --------------------------------------------
  const baseline = officialBaseline()
  if (!baseline) {
    record('官方 dsh 基线可用', false, '既没有全局 dsh，也没有 build/baseline/dsh-package.json；未度量能力平价')
  } else {
    let stagedRows
    try {
      stagedRows = dump(nodeExe, dshEntry, home)
    } catch (err) {
      record('装配版 --dump-config 成功', false, String(err?.message ?? err).slice(0, 400))
    }

    if (stagedRows) {
      record('装配版能组合出插件树', stagedRows.length > 100, `${stagedRows.length} 行`)

      let missing = null
      let extra = []
      let baselineLabel = ''

      if (baseline.kind === 'install') {
        // 完整基线：直接组合官方安装的树，逐行对比 —— 这是最有说服力的形式。
        baselineLabel = '官方安装（组合树逐行对比）'
        const officialHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
        try {
          const officialRows = dump(nodeExe, join(baseline.dir, 'lib', 'bin.js'), officialHome)
          const key = (r) => `${r.id}|${r.name}`
          const stagedSet = new Set(stagedRows.map(key))
          const officialKeys = new Set(officialRows.map(key))
          missing = officialRows.filter((r) => !stagedSet.has(key(r)))
          extra = stagedRows.filter((r) => !officialKeys.has(key(r)))
        } catch (err) {
          record('官方版 --dump-config 成功', false, String(err?.message ?? err).slice(0, 400))
        }
      } else {
        // manifest 基线：只有官方 dsh 的依赖清单。无法逐行组合对比，
        // 因此改为断言"官方 dsh 的每个直接依赖都确实被打进了装配树"——
        // 这是 CI（无全局 dsh、_dsh-install 已清理）唯一可做的事，
        // 也正是"自包含"这一步真正会失败的地方。
        baselineLabel = '官方 manifest（依赖完整性对比）'
        const manifest = JSON.parse(readFileSync(baseline.file, 'utf8'))
        const deps = Object.keys(manifest.dependencies ?? {})
        const installed = new Set()
        const scanScope = (base, prefix) => {
          if (!existsSync(base)) return
          for (const entry of readdirSync(base, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            if (entry.name.startsWith('@')) { scanScope(join(base, entry.name), entry.name + '/'); continue }
            installed.add(prefix + entry.name)
          }
        }
        // 扫描装配树的依赖。注意基准目录必须是 `runtime/dsh/node_modules`：
        // dshEntry 是**文件**（lib/bin.js），用 `join(dshEntry, '..', 'node_modules')`
        // 会解析成 lib/node_modules 而漏掉全部依赖（第一次写就是这样，
        // 结果误报'缺失 72 项'）。用 dirname 明确上溯两级才是对的。
        const stagedDshDir = dirname(dirname(dshEntry))          // runtime/dsh
        const stagedModules = join(stagedDshDir, 'node_modules')
        scanScope(join(stagedModules, '@deepseek-ai'), '@deepseek-ai/')
        scanScope(stagedModules, '')
        missing = deps.filter((d) => !installed.has(d)).map((d) => ({ id: d, name: d }))
        extra = []
      }

      if (missing) {
        record(
          `能力平价：官方的东西一样都不缺（基线：${baselineLabel}）`,
          missing.length === 0,
          missing.length ? `缺失 ${missing.length} 项：${missing.slice(0, 10).map((r) => r.id ?? r.name).join('、')}` : '完全一致或为其超集'
        )
        if (extra.length) {
          record('装配版是超集（随附插件带来了额外行）', true,
            `+${extra.length}：${extra.slice(0, 10).map((r) => r.id).join('、')}`)
        }
      }
    }
  }

  // ---- 3. 启动 ------------------------------------------------------------
  if (BOOT) {
    try {
      const probe = await bootProbe(nodeExe, dshEntry, home)
      record('装配的 harness 能启动且 HTTP 有应答', true, `${probe.url} -> HTTP ${probe.status}`)
    } catch (err) {
      record('装配的 harness 能启动且 HTTP 有应答', false, String(err?.message ?? err).slice(0, 600))
    }
  }

  return finish()
}

function finish () {
  const failed = results.filter((r) => !r.ok)
  if (AS_JSON) {
    process.stdout.write(JSON.stringify({ ok: failed.length === 0, results }, null, 2) + '\n')
  } else {
    process.stdout.write(`\n${results.length - failed.length}/${results.length} 项检查通过\n`)
    if (failed.length) process.stdout.write(`beta 未达标：${failed.map((r) => r.name).join('；')}\n`)
  }
  process.exitCode = failed.length ? 1 : 0
}

await main()
