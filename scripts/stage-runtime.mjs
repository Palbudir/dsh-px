/**
 * Assemble the bundled runtime that dsh-px ships inside the Electron app.
 *
 * Produces, under ./runtime:
 *   node/       a standalone Node runtime (so the user installs nothing)
 *   dsh/        the dsh CLI install, self-contained (all @deepseek-ai/* nested)
 *   dsh-home/   a seed profile: profiles/<name>/ + the plugin tree
 *
 * Design notes (learned the hard way — see docs/PACKAGING.md):
 *   - The global dsh install is self-contained: 239 nested @deepseek-ai packages.
 *     Copying it whole avoids reconstructing pnpm's junction fallback tree.
 *   - $DSH_HOME/profiles/node_modules is a *junction* tree pointing back into the
 *     dsh install. A plain copy would lose it, so profile installs are re-done
 *     by the staged dsh itself (`dsh plugin add`), which is the only supported
 *     way to build a profile.
 *   - pnpm >= 10 refuses to run dependency build scripts until approved. node-pty
 *     needs its conpty.dll / OpenConsole.exe postinstall, so the staged profile's
 *     pnpm-workspace.yaml must carry `allowBuilds: { node-pty: true }`.
 *
 * Usage:
 *   node scripts/stage-runtime.mjs                 # node + dsh + seed home
 *   node scripts/stage-runtime.mjs --with-plugins  # also installs DEFAULT_PLUGINS
 *   node scripts/stage-runtime.mjs --from-existing # copy the local ~/.dsh profile
 *                                                  # instead of installing fresh
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, cpSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const OUT = join(REPO, 'runtime')

/** Pinned dsh version. Change deliberately, then re-run `npm run verify`. */
const DSH_VERSION = process.env.DSH_PX_DSH_VERSION ?? '0.1.5-rc.2'
/** Standalone Node runtime to bundle. Must satisfy dsh's engines (>=20). */
const NODE_VERSION = process.env.DSH_PX_NODE_VERSION ?? '24.16.0'
const PROFILE = process.env.DSH_PX_PROFILE ?? 'web'

/** Plugins the beta ships pre-installed. Names verified against the npm registry. */
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
 * Windows ships npm/pnpm as .cmd batch shims, which spawnSync cannot execute
 * directly — it needs a shell. Resolve the binary name per platform so callers
 * do not each have to remember this.
 */
function shim (name) {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

/**
 * Recursively copy `src` to `dest`, skipping any path segment listed in `skip`.
 *
 * Needed because `cpSync` has no exclude option, and because two very different
 * things live under `profiles/node_modules`:
 *   - third-party plugin dependencies (react, mermaid, @codemirror, node-pty) —
 *     MUST be copied, they exist nowhere else in the bundle;
 *   - the `@deepseek-ai` tree — must NOT be copied. It is dsh's own managed
 *     "module proxy" fallback, and once materialised as real directories dsh
 *     refuses to boot:
 *       "…/profiles/node_modules/@deepseek-ai/dsh exists and is not a symlink or
 *        dsh-managed module proxy; remove it so dsh can manage the installation
 *        fallback"
 *     It is also redundant: the bundled `runtime/dsh` already carries all 239
 *     nested `@deepseek-ai` packages, and bundle names resolve against the dsh
 *     installation first.
 */
function copyTree (src, dest, { skip = new Set() } = {}) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyTree(from, to, { skip })
    } else {
      // dereference: sources are junctions/symlinks in the live harness home.
      cpSync(from, to, { dereference: true, force: true })
    }
  }
}

const SKIP_IN_PROFILE_TREE = new Set(['@deepseek-ai'])

/**
 * `rmSync` fails on trees copied from a live profile because some packages ship
 * read-only files. Clearing the attribute first makes cleanup idempotent.
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

/** Resolve the dsh install that this machine currently runs. */
function findGlobalDsh () {
  // `npm root -g` is authoritative for where a global install lives.
  const root = execFileSync(shim('npm'), ['root', '-g'], {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  }).trim()
  const candidate = join(root, '@deepseek-ai', 'dsh')
  if (existsSync(join(candidate, 'lib', 'bin.js'))) return candidate
  throw new Error(`could not locate a global dsh install under ${root}`)
}

async function downloadNode () {
  const dir = join(OUT, 'node')
  const exe = process.platform === 'win32' ? join(dir, 'node.exe') : join(dir, 'bin', 'node')
  if (existsSync(exe)) {
    log(`node already staged: ${exe}`)
    return exe
  }
  mkdirSync(dir, { recursive: true })

  const platform = { win32: 'win', darwin: 'darwin', linux: 'linux' }[process.platform]
  if (!platform) throw new Error(`unsupported platform ${process.platform}`)
  const arch = { x64: 'x64', arm64: 'arm64' }[process.arch]
  if (!arch) throw new Error(`unsupported arch ${process.arch}`)

  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const base = `node-v${NODE_VERSION}-${platform}-${arch}`
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${base}.${ext}`
  const archive = join(OUT, `${base}.${ext}`)

  log(`downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(archive))

  log(`extracting ${base}`)
  if (ext === 'zip') {
    // tar ships with Windows 10+ and reads zip; falls back to Expand-Archive.
    const tar = spawnSync('tar', ['-xf', archive, '-C', OUT], { stdio: 'inherit' })
    if (tar.status !== 0) {
      run('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${OUT}' -Force`])
    }
  } else {
    run('tar', ['-xzf', archive, '-C', OUT])
  }

  const extracted = join(OUT, base)
  if (!existsSync(extracted)) throw new Error(`expected ${extracted} after extraction`)
  // Normalise to runtime/node regardless of the archive's internal name.
  rmSync(dir, { recursive: true, force: true })
  cpSync(extracted, dir, { recursive: true, dereference: true })
  rmSync(extracted, { recursive: true, force: true })
  rmSync(archive, { force: true })

  if (!existsSync(exe)) throw new Error(`node binary missing after staging: ${exe}`)
  log(`staged node -> ${exe}`)
  return exe
}

function stageDsh () {
  const dest = join(OUT, 'dsh')
  if (existsSync(join(dest, 'lib', 'bin.js'))) {
    log(`dsh already staged: ${dest}`)
    return dest
  }
  const src = findGlobalDsh()
  log(`copying dsh ${DSH_VERSION} from ${src} (self-contained, may take a minute)`)
  mkdirSync(OUT, { recursive: true })
  cpSync(src, dest, { recursive: true, dereference: true })
  log(`staged dsh -> ${dest}`)
  return dest
}

/**
 * Build the seed harness home by letting the staged dsh create and populate the
 * profile itself. This is the only supported way to produce a profile tree, and
 * it reproduces the junction layout that dsh's module resolution expects.
 */
function stageHome (nodeExe, dshDir, { withPlugins, fromExisting }) {
  const home = join(OUT, 'dsh-home')
  const profileDir = join(home, 'profiles', PROFILE)
  const dshEntry = join(dshDir, 'lib', 'bin.js')
  const env = { ...process.env, DSH_HOME: home }

  /** Populate an empty seed home from the shipped template, then install plugins. */
  const buildFresh = () => {
    if (withPlugins) {
      log(`installing plugins: ${DEFAULT_PLUGINS.join(', ')}`)
      // `dsh plugin` both initialises the missing profile from the shipped
      // template and reconciles dsh.profile.bundles from installed packages.
      run(nodeExe, [dshEntry, 'plugin', '--profile', PROFILE, 'add', ...DEFAULT_PLUGINS], { env })
    } else {
      log('initialising profile from the shipped template')
      // No pnpm child command can run without an argument, so seed the two files
      // the profile contract requires. This mirrors `dsh plugin` initialisation.
      mkdirSync(join(profileDir, 'dsh-template'), { recursive: true })
      const template = join(profileDir, 'dsh-template')
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
        name: `dsh-profile-${PROFILE}`,
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'live' } }
      }, null, 2) + '\n')
      writeFileSync(join(profileDir, 'cordis.patch.yml'), '# dsh-px profile patch layer; applied after every bundle layer.\n[]\n')
      writeFileSync(join(profileDir, 'cordis.yml'), '# dsh profile root — an empty entry list. The tree is composed as patches.\n[]\n')
      writeFileSync(join(profileDir, 'pnpm-workspace.yaml'),
        'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
      rmSync(template, { recursive: true, force: true })
    }
    if (!existsSync(join(profileDir, 'package.json'))) {
      throw new Error(`profile was not initialised at ${profileDir}`)
    }
  }

  if (fromExisting) {
    const srcHome = process.env.DSH_PX_SOURCE_HOME ?? process.env.DSH_HOME ??
      join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
    if (!existsSync(join(srcHome, 'profiles', PROFILE, 'package.json'))) {
      throw new Error(`--from-existing: no profile at ${join(srcHome, 'profiles', PROFILE)}`)
    }
    if (!existsSync(join(profileDir, 'package.json'))) {
      log(`copying working profile from ${srcHome} (fast path)`)
      log('  excluding @deepseek-ai/* — dsh manages that tree itself and the bundled dsh already provides it')
      mkdirSync(join(home, 'profiles'), { recursive: true })
      // The profile's own files first (cheap, and they define the composition).
      for (const f of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml']) {
        const from = join(srcHome, 'profiles', PROFILE, f)
        if (existsSync(from)) cpSync(from, join(profileDir, f), { force: true })
      }
      // Then the plugin tree, minus dsh's managed fallback namespace.
      const srcWebModules = join(srcHome, 'profiles', PROFILE, 'node_modules')
      if (existsSync(srcWebModules)) {
        copyTree(srcWebModules, join(profileDir, 'node_modules'))
      }
    } else {
      log(`seed home already populated, keeping it: ${profileDir}`)
    }
  } else if (existsSync(join(profileDir, 'package.json'))) {
    log(`seed home already populated: ${profileDir}`)
  } else {
    mkdirSync(home, { recursive: true })
    buildFresh()
  }

  // pnpm >= 10 blocks dependency build scripts until approved. node-pty needs its
  // conpty postinstall or the sidebar terminal silently fails at runtime. Only
  // needed on the fresh path; the copied tree already carries the built binary.
  if (withPlugins && !fromExisting) {
    const ws = join(profileDir, 'pnpm-workspace.yaml')
    if (existsSync(ws)) {
      const text = readFileSync(ws, 'utf8')
      if (!/^\s*allowBuilds:/m.test(text)) {
        writeFileSync(ws, text + '\nallowBuilds:\n  node-pty: true\n')
        log('wrote allowBuilds for node-pty')
      }
      run(shim('pnpm'), ['approve-builds', '--all'], { cwd: profileDir, env })
    }
  }

  return home
}

async function main () {
  log(`repo=${REPO}`)
  log(`target runtime=${OUT}`)
  rmSync(join(OUT, 'dsh-home', '.dsh-px-seeded'), { force: true })

  const nodeExe = await downloadNode()
  const dshDir = stageDsh()
  const home = stageHome(nodeExe, dshDir, {
    withPlugins: args.has('--with-plugins'),
    fromExisting: args.has('--from-existing')
  })

  // Record exactly what was staged so the app and CI can assert on it.
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
  log('wrote runtime/runtime-manifest.json')
  log('done. next: npm run verify')
}

main().catch((err) => {
  process.stderr.write(`[stage] FAILED: ${err?.stack ?? err}\n`)
  process.exit(1)
})
