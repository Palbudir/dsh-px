/**
 * Release gate for the aggregate Pack that `dsh web` users install through the plugin manager:
 * install the release Pack into a fresh profile with the packaged dsh plugin manager and pnpm, then
 * require the profile to record that archive as its dsh-px-pack dependency and every bundled member
 * to resolve inside the installed Pack. Desktop first start uses the split foundation and feature
 * archives instead; this gate does not exercise that path.
 *
 * Usage: node scripts/verify-native-pack-install.mjs <prepared upstream checkout> --pack=<tgz>
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sameArchiveSpec } from './native-pack-spec.mjs'
import { validDistribution, componentFile } from '../src/shared/distribution.ts'
import { DESKTOP_PNPM_ENTRY } from '../src/shared/native-desktop-runtime.ts'

const upstream = process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : ''
const packOption = process.argv.find((arg) => arg.startsWith('--pack='))
if (!upstream || !packOption)
  throw Error('Usage: verify-native-pack-install <prepared upstream checkout> --pack=<verified Pack tgz>')
const archive = resolve(packOption.slice('--pack='.length))
const target = join(upstream, 'apps/desktop/.desktop-build/targets/win-x64')
const dsh = join(target, 'dsh')
const pnpm = join(target, DESKTOP_PNPM_ENTRY)
const bin = join(target, 'runtime/bin')
for (const path of [archive, join(dsh, 'package.json'), pnpm, bin])
  if (!existsSync(path)) throw Error(`Pack install check is missing ${path}`)

const manifest = JSON.parse(
  readFileSync(join(dsh, 'node_modules/@deepseek-ai/dsh-plugin-manager/package.json'), 'utf8')
)
const { runPluginCommand } = await import(
  pathToFileURL(
    join(dsh, 'node_modules/@deepseek-ai/dsh-plugin-manager', manifest.exports['./operations'].default)
  ).href
)
const profile = mkdtempSync(join(tmpdir(), 'dsh-px-pack-install-'))
try {
  // Same plugin-manager context and environment as the Desktop overlay; the build runs on Node
  // instead of Electron, so the runtime node shims point at this executable.
  const install = async (args) => {
    const result = await runPluginCommand(
      {
        profile: 'web',
        dir: profile,
        installAnchor: join(dsh, 'node_modules/@deepseek-ai/dsh/package.json'),
        cwd: profile
      },
      args,
      {
        execution: 'service',
        command: process.execPath,
        args: ['--expose-internals', pnpm],
        outputBytes: 16384,
        idleTimeoutMs: 120000,
        // The same bound Desktop applies to native installs.
        signal: AbortSignal.timeout(300000),
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          PATH: bin + delimiter + (process.env.PATH || '')
        }
      }
    )
    if (result.exitCode !== 0 || result.timedOut)
      throw Error(
        `Pack install through the packaged plugin manager failed (exit ${result.exitCode}):\n${result.output ?? ''}`
      )
  }
  const distribution = JSON.parse(
    execFileSync('tar', ['-xOf', archive, 'package/distribution.json'], {
      encoding: 'utf8',
      windowsHide: true
    })
  )
  if (!validDistribution(distribution)) throw Error('Invalid Pack distribution')
  const community = distribution.community ?? []
  const archives = new Map()
  for (const item of community) {
    if (item.file !== componentFile(item)) throw Error('Invalid community archive path')
    const destination = join(profile, item.file.split('/').at(-1))
    writeFileSync(
      destination,
      execFileSync('tar', ['-xOf', archive, 'package/' + item.file], {
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024
      }),
      { flag: 'wx' }
    )
    archives.set(item.name, destination)
  }
  // All sources live outside node_modules: pnpm may replace the installed dependency tree.
  await install([
    'add',
    archive.replaceAll('\\', '/'),
    ...[...archives.values()].map((file) => file.replaceAll('\\', '/'))
  ])
  // The profile must name exactly this archive; another spec form would leave the Pack unmanaged.
  const spec = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')).dependencies?.['dsh-px-pack']
  if (!sameArchiveSpec(spec, archive, profile))
    throw Error(`Installed profile records dsh-px-pack as ${JSON.stringify(spec)}, not the installed archive`)
  const installed = join(profile, 'node_modules/dsh-px-pack')
  const pack = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  const members = pack.bundledDependencies ?? pack.bundleDependencies ?? []
  if (!members.length) throw Error('Installed Pack declares no bundled members')
  // bundledDependencies must be honoured: every member comes from the archive, never the registry.
  for (const member of members) {
    const file = join(installed, 'node_modules', member, 'package.json')
    if (!existsSync(file)) throw Error(`Installed Pack lacks bundled member ${member}`)
    const version = JSON.parse(readFileSync(file, 'utf8')).version
    if (version !== pack.dependencies?.[member])
      throw Error(`Bundled member ${member} is ${version}, expected ${pack.dependencies?.[member]}`)
  }
  if (community.length) {
    const current = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    for (const item of community) {
      if (
        !sameArchiveSpec(current.dependencies?.[item.name], archives.get(item.name), profile) ||
        !current.dsh?.profile?.bundles?.includes(item.name)
      )
        throw Error(`Community bundle is not independently registered: ${item.name}`)
      const pkg = JSON.parse(readFileSync(join(profile, 'node_modules', item.name, 'package.json'), 'utf8'))
      if (pkg.name !== item.name || pkg.version !== item.version)
        throw Error('Wrong community package identity')
    }
  }
  console.log(
    `Pack install verified through the packaged plugin manager: ${pack.version}, members ${members.join(', ')}, independent community ${community.map((item) => item.name + '@' + item.version).join(', ')}`
  )
} finally {
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch (error) {
    // A file still held open on Windows must not replace the install result with a cleanup error.
    console.warn(`Could not remove the temporary profile ${profile}: ${error.message}`)
  }
}
