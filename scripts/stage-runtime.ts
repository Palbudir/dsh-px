/** Build a portable DSH profile from the pinned catalog, never from a personal home. */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { repoRoot } from './paths'
import { copyHoistedDependencies } from './copy-hoisted-dependencies'
import { MANAGED_PLUGIN_NAMES, COMMUNITY_VERSIONS, RUNTIME_VERSIONS } from '../src/shared/plugin-catalog'
import {
  inspectNode,
  inspectDsh,
  inspectManagedPlugin,
  inspectManagedPlugins,
  assertPluginIdentity,
  inspectBundledSidebar,
  verifyRuntimeIntegrity
} from '../src/shared/runtime-integrity'
import { copyBundlePayload } from '../src/shared/bundle-payload'
import { forbiddenPayloadPaths } from '../src/shared/payload-policy'
import { applySidebarCompatibility } from '../src/shared/sidebar-compatibility'

const REPO = repoRoot()
const OUT = join(REPO, 'runtime')
const NODE_VERSION = process.env.DSH_PX_NODE_VERSION ?? RUNTIME_VERSIONS.node
const DSH_VERSION = process.env.DSH_PX_DSH_VERSION ?? RUNTIME_VERSIONS.dsh
const PROFILE = process.env.DSH_PX_PROFILE ?? 'web'
const PNPM_VERSION = process.env.DSH_PX_PNPM_VERSION ?? '10.34.5'
const args = new Set(process.argv.slice(2))
const log = (message: string): void => {
  process.stdout.write(`[stage] ${message}\n`)
}
const shim = (name: string): string => (process.platform === 'win32' ? `${name}.cmd` : name)

function removeRuntimeTree(target: string): void {
  if (
    !resolve(target)
      .toLowerCase()
      .startsWith((resolve(OUT) + sep).toLowerCase())
  )
    throw new Error(`拒绝清理 runtime 以外的路径：${target}`)
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    const writable = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) writable(file)
        else chmodSync(file, 0o666)
      }
    }
    if (statSync(target).isDirectory()) writable(target)
    else chmodSync(target, 0o666)
    rmSync(target, { recursive: true, force: true, maxRetries: 3 })
  }
}

function run(
  command: string,
  parameters: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): void {
  const result = spawnSync(command, parameters, {
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32',
    ...options
  })
  if (result.error || result.status !== 0)
    throw new Error(`${command} 失败：${result.error?.message ?? result.status}`)
}

function pnpmCommand(): { command: string; parameters: string[] } {
  if (process.env.DSH_PX_PNPM) return { command: process.env.DSH_PX_PNPM, parameters: [] }
  const probe = spawnSync(shim('pnpm'), ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32'
  })
  if (probe.status === 0 && probe.stdout.trim() === PNPM_VERSION)
    return { command: shim('pnpm'), parameters: [] }
  return { command: shim('npx'), parameters: ['--yes', `pnpm@${PNPM_VERSION}`] }
}

async function stageNode(): Promise<string> {
  const directory = join(OUT, 'node')
  const executable = join(directory, process.platform === 'win32' ? 'node.exe' : 'bin/node')
  if (existsSync(executable)) {
    inspectNode(executable, { version: NODE_VERSION, platform: process.platform, arch: process.arch })
    log(`复用已验证的 Node ${NODE_VERSION}`)
    return executable
  }
  const platform = ({ win32: 'win', darwin: 'darwin', linux: 'linux' } as Record<string, string>)[
    process.platform
  ]
  if (!platform || !['x64', 'arm64'].includes(process.arch))
    throw new Error(`不支持的构建平台：${process.platform}/${process.arch}`)
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const base = `node-v${NODE_VERSION}-${platform}-${process.arch}`
  const archiveName = `${base}.${extension}`
  const url = `https://nodejs.org/dist/v${NODE_VERSION}`
  const [archiveResponse, checksumResponse] = await Promise.all([
    fetch(`${url}/${archiveName}`),
    fetch(`${url}/SHASUMS256.txt`)
  ])
  if (!archiveResponse.ok || !checksumResponse.ok)
    throw new Error(`Node 下载失败：${archiveResponse.status}/${checksumResponse.status}`)
  const bytes = Buffer.from(await archiveResponse.arrayBuffer())
  const expected = (await checksumResponse.text())
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith('  ' + archiveName))
    ?.split(/\s+/)[0]
  if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error('Node 官方归档 SHA256 校验失败')
  mkdirSync(OUT, { recursive: true })
  const archive = join(OUT, archiveName)
  writeFileSync(archive, bytes)
  const extracted = join(OUT, base)
  if (existsSync(extracted)) removeRuntimeTree(extracted)
  const tar = spawnSync('tar', ['-xf', archive, '-C', OUT], { stdio: 'inherit', windowsHide: true })
  if (tar.status !== 0) throw new Error('Node 归档解压失败，请确认 tar 可用')
  const stagedExecutable = join(extracted, process.platform === 'win32' ? 'node.exe' : 'bin/node')
  inspectNode(stagedExecutable, { version: NODE_VERSION, platform: process.platform, arch: process.arch })
  if (existsSync(directory)) removeRuntimeTree(directory)
  cpSync(extracted, directory, { recursive: true, dereference: true })
  removeRuntimeTree(extracted)
  rmSync(archive)
  return executable
}

function matchingGlobalDsh(): string | null {
  try {
    const root = execFileSync(shim('npm'), ['root', '-g'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32'
    }).trim()
    const candidate = join(root, '@deepseek-ai/dsh')
    inspectDsh(candidate, DSH_VERSION)
    return candidate
  } catch {
    return null
  }
}

function stageDsh(): string {
  const destination = join(OUT, 'dsh')
  if (existsSync(join(destination, 'package.json'))) {
    inspectDsh(destination, DSH_VERSION)
    log(`复用已验证的 DSH ${DSH_VERSION}`)
  } else {
    const global = matchingGlobalDsh()
    if (global) cpSync(global, destination, { recursive: true, dereference: true })
    else {
      const prefix = join(OUT, '_dsh-install')
      const installed = join(prefix, 'node_modules/@deepseek-ai/dsh')
      mkdirSync(prefix, { recursive: true })
      if (existsSync(join(installed, 'package.json'))) inspectDsh(installed, DSH_VERSION)
      else
        run(
          shim('npm'),
          [
            'install',
            '--prefix',
            prefix,
            '--no-audit',
            '--no-fund',
            '--loglevel',
            'error',
            `@deepseek-ai/dsh@${DSH_VERSION}`
          ],
          { cwd: prefix }
        )
      inspectDsh(installed, DSH_VERSION)
      cpSync(installed, destination, { recursive: true, dereference: true })
      copyHoistedDependencies(join(prefix, 'node_modules'), join(destination, 'node_modules'))
      removeRuntimeTree(prefix)
    }
    inspectDsh(destination, DSH_VERSION)
  }
  mkdirSync(join(REPO, 'build/baseline'), { recursive: true })
  writeFileSync(
    join(REPO, 'build/baseline/dsh-package.json'),
    readFileSync(join(destination, 'package.json'))
  )
  return destination
}

function stageHome(): string {
  const home = join(OUT, 'dsh-home')
  const profile = join(home, 'profiles', PROFILE)
  const manifestPath = join(profile, 'package.json')
  const dependencies = {
    ...COMMUNITY_VERSIONS,
    ...Object.fromEntries(MANAGED_PLUGIN_NAMES.map((name) => [name, `file:./.dsh-px-packages/${name}`]))
  }
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...Object.keys(dependencies)]
  if (args.has('--fresh-seed') && existsSync(home)) removeRuntimeTree(home)
  if (!existsSync(manifestPath)) {
    mkdirSync(profile, { recursive: true })
    for (const name of MANAGED_PLUGIN_NAMES)
      copyBundlePayload(join(REPO, 'packages', name), join(profile, '.dsh-px-packages', name))
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          name: `dsh-profile-${PROFILE}`,
          private: true,
          dshPx: { seedSource: 'catalog', schemaVersion: 1 },
          dependencies,
          dsh: { profile: { bundles, patchReload: 'live' } }
        },
        null,
        2
      ) + '\n'
    )
    writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(profile, 'cordis.yml'), '[]\n')
    writeFileSync(
      join(profile, 'pnpm-workspace.yaml'),
      'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\nallowBuilds:\n  node-pty: true\n'
    )
    const pnpm = pnpmCommand()
    run(pnpm.command, [...pnpm.parameters, 'install'], {
      cwd: profile,
      env: { ...process.env, DSH_HOME: home }
    })
    run(pnpm.command, [...pnpm.parameters, 'rebuild', 'node-pty'], {
      cwd: profile,
      env: { ...process.env, DSH_HOME: home }
    })
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (
    manifest.dshPx?.seedSource !== 'catalog' ||
    JSON.stringify(Object.keys(manifest.dependencies ?? {}).sort()) !==
      JSON.stringify(Object.keys(dependencies).sort()) ||
    Object.entries(dependencies).some(([name, spec]) => manifest.dependencies[name] !== spec) ||
    JSON.stringify([...(manifest.dsh?.profile?.bundles ?? [])].sort()) !== JSON.stringify([...bundles].sort())
  ) {
    throw new Error(
      '现有种子不是锁定清单的可移植 profile；使用 --with-plugins --fresh-seed 重建，不得发布个人 profile'
    )
  }
  for (const file of ['cordis.patch.yml', 'cordis.yml']) {
    if (
      readFileSync(join(profile, file), 'utf8')
        .replace(/^\s*#.*$/gm, '')
        .trim() !== '[]'
    )
      throw new Error(`发布种子不允许用户补丁：${file}`)
  }
  for (const [name, version] of Object.entries(COMMUNITY_VERSIONS)) {
    const actual = JSON.parse(readFileSync(join(profile, 'node_modules', name, 'package.json'), 'utf8'))
    if (actual.name !== name || actual.version !== version)
      throw new Error(`社区插件 ${name} 实际版本不符合 ${version}`)
  }
  for (const name of MANAGED_PLUGIN_NAMES) {
    const source = join(REPO, 'packages', name)
    for (const target of [join(profile, '.dsh-px-packages', name), join(profile, 'node_modules', name)]) {
      if (existsSync(target)) removeRuntimeTree(target)
      copyBundlePayload(source, target)
    }
  }
  const sidebar = applySidebarCompatibility(profile)
  if (sidebar.state !== 'patched-known')
    throw new Error('随附侧栏不是固定来源，不能验证终端退出行为；请从锁定清单重新装配')
  return home
}

function cleanGeneratedHome(home: string): void {
  for (const relative of [
    'profiles/node_modules',
    `profiles/${PROFILE}/.dsh-module-fallback`,
    `profiles/${PROFILE}/.dsh-market`,
    'storages',
    'sessions',
    '.credentials.yaml',
    'settings.yaml',
    '.dsh-px-seeded'
  ]) {
    const target = join(home, relative)
    if (existsSync(target)) removeRuntimeTree(target)
  }
  const paths: string[] = []
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = `${prefix}/${entry.name}`
      paths.push(relative)
      if (entry.isDirectory()) walk(join(directory, entry.name), relative)
    }
  }
  walk(home, 'runtime/dsh-home')
  const forbidden = forbiddenPayloadPaths(paths)
  if (forbidden.length) throw new Error(`种子中混入不可发布的数据：${forbidden.slice(0, 20).join('、')}`)
}

async function main(): Promise<void> {
  if (args.has('--from-existing'))
    throw new Error('发布装配禁止复制个人 profile；请使用 --with-plugins 从锁定清单构建')
  if (!args.has('--with-plugins')) throw new Error('DSH-PX 运行时需要完整插件清单；请使用 --with-plugins')
  if (
    !/^[a-zA-Z0-9_-]+$/.test(PROFILE) ||
    ![NODE_VERSION, DSH_VERSION, PNPM_VERSION].every((version) =>
      /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/.test(version)
    )
  )
    throw new Error('无效的 profile 或运行时版本')
  log(`装配目录：${OUT}`)
  const nodeExecutable = await stageNode()
  const dshDirectory = stageDsh()
  const home = stageHome()
  cleanGeneratedHome(home)
  const app = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  const node = inspectNode(nodeExecutable, {
    version: NODE_VERSION,
    platform: process.platform,
    arch: process.arch
  })
  const dsh = inspectDsh(dshDirectory, DSH_VERSION)
  const plugins = inspectManagedPlugins(join(home, 'profiles', PROFILE), 'bundled-runtime', app.version).map(
    (plugin) => ({ ...plugin, source: `packages/${plugin.name}` })
  )
  for (const plugin of plugins)
    assertPluginIdentity(
      inspectManagedPlugin(join(REPO, 'packages', plugin.name), plugin.name, plugin.source, app.version),
      plugin
    )
  const manifest = {
    schemaVersion: 2,
    seedSource: 'catalog',
    stagedAt: new Date().toISOString(),
    app: { name: app.name, version: app.version },
    platform: node.platform,
    arch: node.arch,
    node: {
      version: node.version,
      path: './runtime/node/' + (process.platform === 'win32' ? 'node.exe' : 'bin/node')
    },
    dsh: { version: dsh.version, path: './runtime/dsh' },
    profile: PROFILE,
    plugins: [...Object.keys(COMMUNITY_VERSIONS), ...MANAGED_PLUGIN_NAMES],
    home: './runtime/dsh-home',
    integrity: {
      nodeSha256: node.sha256,
      dshManifestSha256: dsh.manifestSha256,
      dshEntrySha256: dsh.entrySha256,
      managedPlugins: plugins,
      sidebarCompatibility: inspectBundledSidebar(join(home, 'profiles', PROFILE))
    }
  }
  writeFileSync(join(OUT, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  verifyRuntimeIntegrity(OUT, { node: NODE_VERSION, dsh: DSH_VERSION, app: app.version })
  log('实际运行时与来源摘要已验证。下一步：npm run verify -- --boot')
}

main().catch((error) => {
  process.stderr.write(`[stage] 失败：${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
