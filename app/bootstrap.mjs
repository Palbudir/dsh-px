/**
 * 外壳侧的最小健康检查。在怀疑界面之前，先跑这个。
 *
 * 它会用**已装配**的运行时（不是你全局的 dsh）在临时端口上启动，
 * 等 HTTP 面应答，报告状态码，然后关掉它。
 * 任何 HTTP 应答 —— 包括来自浏览器信任围栏的 401 —— 都证明 harness 已经起来了。
 *
 * 用法：
 *   node app/bootstrap.mjs
 *   DSH_PX_PORT=3080 node app/bootstrap.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const RUNTIME = join(REPO, 'runtime')
const PROFILE = process.env.DSH_PX_PROFILE ?? 'web'
const PORT = Number(process.env.DSH_PX_PORT ?? 3081)

const nodeExe = process.platform === 'win32'
  ? join(RUNTIME, 'node', 'node.exe')
  : join(RUNTIME, 'node', 'bin', 'node')
const dshEntry = join(RUNTIME, 'dsh', 'lib', 'bin.js')
const home = process.env.DSH_PX_HOME ?? join(RUNTIME, 'dsh-home')

for (const [label, p] of [['node', nodeExe], ['dsh', dshEntry], ['home', join(home, 'profiles', PROFILE, 'package.json')]]) {
  if (!existsSync(p)) {
    process.stderr.write(`[bootstrap] 缺少 ${label}：${p}\n请先执行：npm run stage -- --from-existing\n`)
    process.exit(1)
  }
}

process.stdout.write(`[bootstrap] node=${nodeExe}\n[bootstrap] dsh=${dshEntry}\n[bootstrap] DSH_HOME=${home}\n`)

const child = spawn(nodeExe, [dshEntry, '--profile', PROFILE, '--host', '127.0.0.1', '--port', String(PORT), '--no-open'], {
  env: { ...process.env, DSH_HOME: home },
  stdio: 'inherit'
})

const url = `http://127.0.0.1:${PORT}/`
const deadline = Date.now() + 150_000
let ready = false
while (Date.now() < deadline && child.exitCode === null) {
  try {
    const res = await fetch(url, { redirect: 'manual' })
    process.stdout.write(`[bootstrap] 就绪 ${url} -> HTTP ${res.status}\n`)
    ready = true
    break
  } catch {
    await new Promise((r) => setTimeout(r, 400))
  }
}

if (!ready) process.stderr.write('[bootstrap] harness 未能在限时内就绪\n')
if (child.exitCode === null) child.kill()
process.exit(ready ? 0 : 1)
