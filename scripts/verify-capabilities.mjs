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
import { existsSync, readFileSync } from 'node:fs'
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

/** 定位这台机器在用的官方 dsh，用作能力平价的基线。 */
function officialDsh () {
  const root = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  }).trim()
  const dir = join(root, '@deepseek-ai', 'dsh')
  return existsSync(join(dir, 'lib', 'bin.js')) ? dir : null
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
  const official = officialDsh()
  if (!official) {
    record('官方 dsh 基线可用', false, '找不到全局 dsh 安装；未度量能力平价')
  } else {
    const officialHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
    let stagedRows, officialRows
    try {
      stagedRows = dump(nodeExe, dshEntry, home)
    } catch (err) {
      record('装配版 --dump-config 成功', false, String(err?.message ?? err).slice(0, 400))
    }
    try {
      officialRows = dump(nodeExe, join(official, 'lib', 'bin.js'), officialHome)
    } catch (err) {
      record('官方版 --dump-config 成功', false, String(err?.message ?? err).slice(0, 400))
    }
    if (stagedRows && officialRows) {
      const key = (r) => `${r.id}|${r.name}`
      const officialKeys = new Set(officialRows.map(key))
      const stagedSet = new Set(stagedRows.map(key))
      const missing = officialRows.filter((r) => !stagedSet.has(key(r)))
      const extra = stagedRows.filter((r) => !officialKeys.has(key(r)))
      record('装配版能组合出插件树', stagedRows.length > 100, `${stagedRows.length} 行`)
      record(
        '能力平价：官方的东西一样都不缺',
        missing.length === 0,
        missing.length ? `缺失 ${missing.length} 行：${missing.slice(0, 10).map((r) => r.id).join('、')}` : '完全一致或为其超集'
      )
      if (extra.length) {
        record('装配版是超集（随附插件带来了额外行）', true,
          `+${extra.length}：${extra.slice(0, 10).map((r) => r.id).join('、')}`)
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
