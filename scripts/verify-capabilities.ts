/** Verify runtime integrity, baseline plugin declarations, and optional authenticated startup.
 * Declaration parity is not evidence that every Agent capability has been exercised.
 * Run with npm run verify -- --boot; --json emits machine-readable results.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot } from './paths'
import type { Dirent } from 'node:fs'
import { inspectDsh, verifyRuntimeIntegrity } from '../src/shared/runtime-integrity'
import { RUNTIME_VERSIONS } from '../src/shared/plugin-catalog'

/** 从 unknown 的 catch 变量里取出可读消息（strict 下 catch 变量是 unknown）。 */
function errText(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err)
}

const REPO = repoRoot()
const RUNTIME = join(REPO, 'runtime')
const PROFILE = process.env.DSH_PX_PROFILE ?? 'web'
const BOOT = process.argv.includes('--boot')
const AS_JSON = process.argv.includes('--json')

const results: Array<{ name: string; ok: boolean; detail: string | undefined }> = []
const record = (name: string, ok: boolean, detail?: string): void => {
  results.push({ name, ok, detail })
  if (!AS_JSON) process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` —— ${detail}` : ''}\n`)
}

/** 解析 `--dump-config` 那种类 YAML 输出，取出组合出的行。 */
function parseRows(yaml) {
  const rows: Array<{ id: string; name: string | null }> = []
  let current: { id: string; name: string | null } | null = null
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

function dump(nodeExe, dshEntry, home) {
  const out = execFileSync(nodeExe, [dshEntry, '--profile', PROFILE, '--dump-config'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home, NODE_OPTIONS: '', NODE_PATH: '' },
    cwd: home,
    windowsHide: true,
    timeout: 20_000,
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
function officialBaseline() {
  const currentVersion = JSON.parse(readFileSync(join(RUNTIME, 'dsh', 'package.json'), 'utf8')).version
  const matching = (directory: string): boolean => {
    try {
      inspectDsh(directory, currentVersion)
      return true
    } catch {
      return false
    }
  }
  // 强制走 manifest 分支：CI 上就是这条路径（无全局 dsh、_dsh-install 已清理），
  // 而开发机上因为装了全局 dsh 走不到它 —— 若不显式测，这条唯一在 CI 生效的
  // 分支就从未被验证过。
  if (process.argv.includes('--baseline=manifest')) {
    const forced = join(REPO, 'build', 'baseline', 'dsh-package.json')
    return existsSync(forced) && JSON.parse(readFileSync(forced, 'utf8')).version === currentVersion
      ? { kind: 'manifest', file: forced }
      : null
  }

  const fromNpmInstall = join(RUNTIME, '_dsh-install', 'node_modules', '@deepseek-ai', 'dsh')
  if (matching(fromNpmInstall)) return { kind: 'install', dir: fromNpmInstall }

  try {
    const root = execFileSync(
      process.platform === 'win32' ? 'cmd.exe' : 'npm',
      process.platform === 'win32' ? ['/d', '/s', '/c', 'npm root -g'] : ['root', '-g'],
      {
        encoding: 'utf8',
        windowsHide: true
      }
    ).trim()
    const dir = join(root, '@deepseek-ai', 'dsh')
    if (matching(dir)) return { kind: 'install', dir }
  } catch {
    /* 没有全局 npm/dsh 也正常 */
  }

  const manifest = join(REPO, 'build', 'baseline', 'dsh-package.json')
  if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).version === currentVersion)
    return { kind: 'manifest', file: manifest }

  return null
}

async function bootProbe(nodeExe, dshEntry, home, options: { timeoutMs?: number } = {}) {
  const port = 34000 + Math.floor(Math.random() * 1000)
  const child = spawn(
    nodeExe,
    [dshEntry, '--profile', PROFILE, '--host', '127.0.0.1', '--port', String(port), '--no-open'],
    {
      env: { ...process.env, DSH_HOME: home, NODE_OPTIONS: '', NODE_PATH: '' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let log = ''
  let launchUrl: string | undefined
  let cookie = ''
  const consume = (chunk: Buffer): void => {
    log = (log + chunk.toString()).slice(-128 * 1024)
    launchUrl ??= log.match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[A-Za-z0-9_-]+`))?.[0]
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', consume)
  const safeLog = (): string => log.replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[redacted]')
  const url = `http://127.0.0.1:${port}/`
  const timeoutMs = options.timeoutMs ?? 150_000
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`提前退出（${child.exitCode}）\n${safeLog().slice(-2000)}`)
      try {
        if (launchUrl && !cookie) {
          const exchange = await fetch(launchUrl, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
          if (exchange.status === 303) cookie = exchange.headers.get('set-cookie')?.split(';')[0] ?? ''
        }
        if (!launchUrl || !cookie) throw new Error('等待本次子进程的启动令牌完成认证')
        const res = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(2000),
          headers: cookie ? { Cookie: cookie } : {}
        })
        if (res.ok) {
          const plugin = await fetch(`${url}dsh-px-workbench/status`, {
            signal: AbortSignal.timeout(2000),
            headers: { Cookie: cookie }
          })
          if (plugin.ok) return { ok: true, status: res.status, url, log: safeLog() }
        }
      } catch {
        /* 还没开始监听 */
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    throw new Error(`${timeoutMs} 毫秒内未通过本次子进程认证与就绪检查\n${safeLog().slice(-2000)}`)
  } finally {
    if (child.exitCode === null) child.kill()
  }
}

async function main() {
  const nodeExe =
    process.platform === 'win32' ? join(RUNTIME, 'node', 'node.exe') : join(RUNTIME, 'node', 'bin', 'node')
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
    try {
      verifyRuntimeIntegrity(RUNTIME, {
        node: process.env.DSH_PX_NODE_VERSION ?? RUNTIME_VERSIONS.node,
        dsh: process.env.DSH_PX_DSH_VERSION ?? RUNTIME_VERSIONS.dsh,
        app: JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
      })
      record('实际 Node/DSH/插件版本、平台与文件摘要匹配', true)
    } catch (error) {
      record('实际 Node/DSH/插件版本、平台与文件摘要匹配', false, errText(error))
      return finish()
    }
  } else {
    record('运行时 manifest 存在', false)
    return finish()
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
    record(
      '官方 dsh 基线可用',
      false,
      '既没有全局 dsh，也没有 build/baseline/dsh-package.json；未度量能力平价'
    )
  } else {
    let stagedRows
    try {
      stagedRows = dump(nodeExe, dshEntry, home)
    } catch (err) {
      record('装配版 --dump-config 成功', false, errText(err).slice(0, 400))
    }

    if (stagedRows) {
      record('装配版能组合出插件树', stagedRows.length > 100, `${stagedRows.length} 行`)

      let missing: Array<{ id: string; name: string | null }> = []
      let extra: Array<{ id: string; name: string | null }> = []
      let baselineLabel = ''

      if (baseline.kind === 'install') {
        // 完整基线：直接组合官方安装的树，逐行对比 —— 这是最有说服力的形式。
        baselineLabel = '官方安装（组合树逐行对比）'
        const officialHome = mkdtempSync(join(tmpdir(), 'dshpx-baseline-'))
        try {
          const officialRows = dump(nodeExe, join(baseline.dir ?? '', 'lib', 'bin.js'), officialHome)
          const key = (r: { id: string; name: string | null }): string => `${r.id}|${r.name}`
          const stagedSet = new Set(stagedRows.map(key))
          const officialKeys = new Set(officialRows.map(key))
          missing = officialRows.filter((r) => !stagedSet.has(key(r)))
          extra = stagedRows.filter((r) => !officialKeys.has(key(r)))
        } catch (err) {
          record('官方版 --dump-config 成功', false, errText(err).slice(0, 400))
        } finally {
          // mkdtemp generated this exact path; no personal profile was consulted or changed.
          rmSync(officialHome, { recursive: true, force: true })
        }
      } else {
        // manifest 基线：只有官方 dsh 的依赖清单。无法逐行组合对比，
        // 因此改为断言"官方 dsh 的每个直接依赖都确实被打进了装配树"——
        // 这是 CI（无全局 dsh、_dsh-install 已清理）唯一可做的事，
        // 也正是"自包含"这一步真正会失败的地方。
        baselineLabel = '官方 manifest（依赖完整性对比）'
        const manifest = JSON.parse(readFileSync(baseline.file ?? '', 'utf8')) as {
          dependencies?: Record<string, string>
        }
        const deps = Object.keys(manifest.dependencies ?? {})
        const installed = new Set()
        const scanScope = (base, prefix) => {
          if (!existsSync(base)) return
          for (const entry of readdirSync(base, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            if (entry.name.startsWith('@')) {
              scanScope(join(base, entry.name), entry.name + '/')
              continue
            }
            installed.add(prefix + entry.name)
          }
        }
        // The CLI entry is in lib; dependencies are relative to the package root.
        const stagedDshDir = dirname(dirname(dshEntry)) // runtime/dsh
        const stagedModules = join(stagedDshDir, 'node_modules')
        scanScope(join(stagedModules, '@deepseek-ai'), '@deepseek-ai/')
        scanScope(stagedModules, '')
        missing = deps.filter((d) => !installed.has(d)).map((d) => ({ id: d, name: d }))
        extra = []
      }

      if (missing) {
        record(
          `官方基线的插件或依赖条目完整（基线：${baselineLabel}）`,
          missing.length === 0,
          missing.length
            ? `缺失 ${missing.length} 项：${missing
                .slice(0, 10)
                .map((r) => r.id ?? r.name)
                .join('、')}`
            : '完全一致或为其超集'
        )
        if (extra.length) {
          record(
            '装配版是超集（随附插件带来了额外行）',
            true,
            `+${extra.length}：${extra
              .slice(0, 10)
              .map((r) => r.id)
              .join('、')}`
          )
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
      record('装配的 harness 能启动且 HTTP 有应答', false, errText(err).slice(0, 600))
    }
  }

  return finish()
}

function finish() {
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
