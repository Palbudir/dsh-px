/**
 * Verify that the staged dsh-px runtime reaches at least official-dsh capability.
 *
 * The acceptance question for beta is: "does the packaged app offer what a plain
 * `dsh --profile web` install offers?" We answer it mechanically instead of by
 * opinion:
 *
 *   1. STRUCTURE  the staged runtime exists and its profile declares the same
 *                 bundle layers the official shipped profile declares.
 *   2. PARITY     compose the staged profile's tree and the official profile's
 *                 tree with `--dump-config`, then compare the set of composed
 *                 plugin rows (id + name). Anything official has that staged
 *                 lacks is a capability gap.
 *   3. SPAWN      (--boot) start the staged harness on a scratch port and prove
 *                 its HTTP surface answers.
 *
 * Usage:
 *   node scripts/verify-capabilities.mjs            # structure + parity
 *   node scripts/verify-capabilities.mjs --boot     # also boot and probe
 *   node scripts/verify-capabilities.mjs --json     # machine-readable result
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  if (!AS_JSON) process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}\n`)
}

/** Parse `--dump-config` YAML-ish output into composed rows. */
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

/** Locate the official dsh this machine runs, for the parity baseline. */
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
      if (child.exitCode !== null) throw new Error(`exited early (${child.exitCode})\n${log.slice(-2000)}`)
      try {
        const res = await fetch(url, { redirect: 'manual' })
        return { ok: true, status: res.status, url, log }
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 400))
    }
    throw new Error(`not ready within 150s\n${log.slice(-2000)}`)
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

  // ---- 1. structure -------------------------------------------------------
  record('staged node runtime exists', existsSync(nodeExe), nodeExe.replace(REPO, '.'))
  record('staged dsh install exists', existsSync(dshEntry), dshEntry.replace(REPO, '.'))
  record('seed profile exists', existsSync(join(profileDir, 'package.json')), profileDir.replace(REPO, '.'))

  if (!existsSync(nodeExe) || !existsSync(dshEntry)) return finish()

  const runtimeManifest = join(RUNTIME, 'runtime-manifest.json')
  if (existsSync(runtimeManifest)) {
    const m = JSON.parse(readFileSync(runtimeManifest, 'utf8'))
    record('runtime manifest present', true, `dsh ${m.dsh?.version} / node ${m.node?.version}`)
  }

  if (!existsSync(join(profileDir, 'package.json'))) return finish()
  const profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const bundles = profileManifest?.dsh?.profile?.bundles ?? []
  for (const required of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
    record(`profile declares ${required}`, bundles.includes(required), `bundles=${bundles.join(', ')}`)
  }

  // ---- 2. parity against the official install -----------------------------
  const official = officialDsh()
  if (!official) {
    record('official dsh baseline available', false, 'no global dsh install found; parity not measured')
  } else {
    const officialHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
    let stagedRows, officialRows
    try {
      stagedRows = dump(nodeExe, dshEntry, home)
    } catch (err) {
      record('staged --dump-config succeeds', false, String(err?.message ?? err).slice(0, 400))
    }
    try {
      officialRows = dump(nodeExe, join(official, 'lib', 'bin.js'), officialHome)
    } catch (err) {
      record('official --dump-config succeeds', false, String(err?.message ?? err).slice(0, 400))
    }
    if (stagedRows && officialRows) {
      const key = (r) => `${r.id}|${r.name}`
      const stagedSet = new Set(stagedRows.map(key))
      const missing = officialRows.filter((r) => !stagedSet.has(key(r)))
      const extra = stagedRows.filter((r) => !new Set(officialRows.map(key)).has(key(r)))
      record('staged composes a plugin tree', stagedRows.length > 100, `${stagedRows.length} rows`)
      record(
        'capability parity: nothing official is missing',
        missing.length === 0,
        missing.length ? `missing ${missing.length}: ${missing.slice(0, 10).map((r) => r.id).join(', ')}` : 'identical or superset'
      )
      if (extra.length) {
        record('staged superset (bundled plugins add rows)', true,
          `+${extra.length}: ${extra.slice(0, 10).map((r) => r.id).join(', ')}`)
      }
    }
  }

  // ---- 3. spawn ------------------------------------------------------------
  if (BOOT) {
    try {
      const probe = await bootProbe(nodeExe, dshEntry, home)
      record('staged harness boots and answers HTTP', true, `${probe.url} -> HTTP ${probe.status}`)
    } catch (err) {
      record('staged harness boots and answers HTTP', false, String(err?.message ?? err).slice(0, 600))
    }
  }

  return finish()
}

function finish () {
  const failed = results.filter((r) => !r.ok)
  if (AS_JSON) {
    process.stdout.write(JSON.stringify({ ok: failed.length === 0, results }, null, 2) + '\n')
  } else {
    process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`)
    if (failed.length) process.stdout.write(`BETA NOT MET: ${failed.map((r) => r.name).join('; ')}\n`)
  }
  process.exitCode = failed.length ? 1 : 0
}

await main()
