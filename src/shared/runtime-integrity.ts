import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { MANAGED_PLUGIN_NAMES, PRODUCT_CATALOG } from './plugin-catalog'
import { assertRuntimeProducts } from './product-contract'
import {
  inspectSidebarCompatibility,
  SIDEBAR_SOURCE,
  type SidebarCompatibility
} from './sidebar-compatibility'

export interface NodeIdentity {
  version: string
  platform: string
  arch: string
  sha256: string
}
export interface PluginIdentity {
  name: string
  version: string
  source: string
  files: Record<string, string>
}
const integrityFiles = ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml'] as const

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Execute the staged binary; neither its directory name nor a desired version is evidence. */
export function inspectNode(
  executable: string,
  expected?: { version?: string; platform?: string; arch?: string }
): NodeIdentity {
  const options = {
    encoding: 'utf8' as const,
    windowsHide: true,
    timeout: 15_000,
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe']
  }
  const version = execFileSync(executable, ['--version'], options).trim().replace(/^v/, '')
  const identity = JSON.parse(
    execFileSync(
      executable,
      ['-p', 'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})'],
      options
    )
  ) as NodeIdentity
  if (!/^\d+\.\d+\.\d+$/.test(version) || identity.version !== version)
    throw new Error('Node 二进制版本探测结果不一致')
  for (const key of ['version', 'platform', 'arch'] as const) {
    if (expected?.[key] && identity[key] !== expected[key])
      throw new Error(`Node ${key} 实际为 ${identity[key]}，要求 ${expected[key]}`)
  }
  return { version, platform: identity.platform, arch: identity.arch, sha256: sha256File(executable) }
}

export function inspectDsh(
  directory: string,
  expectedVersion?: string
): { version: string; manifestSha256: string; entrySha256: string } {
  const manifest = join(directory, 'package.json')
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  if (pkg.name !== '@deepseek-ai/dsh' || typeof pkg.version !== 'string')
    throw new Error(`不是有效的 DSH 安装：${directory}`)
  if (expectedVersion && pkg.version !== expectedVersion)
    throw new Error(`DSH 实际为 ${pkg.version}，要求 ${expectedVersion}`)
  if (!statSync(join(directory, 'lib/bin.js')).isFile()) throw new Error('DSH 缺少 CLI 入口')
  return {
    version: pkg.version,
    manifestSha256: sha256File(manifest),
    entrySha256: sha256File(join(directory, 'lib/bin.js'))
  }
}

function packageFile(directory: string, declared: unknown, label: string): string {
  if (typeof declared !== 'string' || !declared.startsWith('./'))
    throw new Error(`插件 ${label} 入口必须是包内相对路径`)
  const path = resolve(directory, declared)
  const rel = relative(directory, path)
  if (!rel || rel.startsWith('..' + sep) || rel === '..' || resolve(path) === resolve(directory))
    throw new Error(`插件 ${label} 入口越界`)
  if (!statSync(path).isFile() || statSync(path).size === 0)
    throw new Error(`插件缺少有效 ${label}：${declared}`)
  return rel.replaceAll('\\', '/')
}

/** Managed packages are prebuilt, dependency-free DSH bundles; loading remains native DSH. */
export function inspectManagedPlugin(
  directory: string,
  name: string,
  source: string,
  expectedVersion?: string
): PluginIdentity {
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (pkg.name !== name || typeof pkg.version !== 'string' || !pkg.version)
    throw new Error(`插件清单身份错误：${name}`)
  if (expectedVersion && pkg.version !== expectedVersion)
    throw new Error(`插件 ${name} 实际为 ${pkg.version}，要求 ${expectedVersion}`)
  if (Object.keys(pkg.dependencies ?? {}).length || Object.keys(pkg.optionalDependencies ?? {}).length)
    throw new Error(`插件 ${name} 包含需安装的外部依赖，不能使用免安装迁移`)
  if (pkg.type !== 'module' || pkg.dsh?.client?.platform !== 'web')
    throw new Error(`插件 ${name} 缺少 ESM/Web 合约`)
  const host = packageFile(directory, pkg.exports?.['.'], `${name} host`)
  const client = packageFile(directory, pkg.exports?.['./client'], `${name} client`)
  const patch = packageFile(directory, pkg.dsh?.bundle?.patch, `${name} bundle`)
  if (host !== 'lib/index.js' || client !== 'lib/client.js' || patch !== 'cordis.patch.yml')
    throw new Error(`插件 ${name} 入口与受管构建合约不一致`)
  const files = Object.fromEntries(
    ['package.json', host, client, patch].map((file) => [file, sha256File(join(directory, file))])
  )
  return { name, version: pkg.version, source, files }
}

export function inspectManagedPlugins(
  profile: string,
  source: string,
  expectedVersion?: string
): PluginIdentity[] {
  return MANAGED_PLUGIN_NAMES.map((name) =>
    inspectManagedPlugin(join(profile, 'node_modules', name), name, source, expectedVersion)
  )
}

export function assertPluginIdentity(actual: PluginIdentity, expected: PluginIdentity): void {
  for (const identity of [actual, expected]) {
    if (
      !identity?.files ||
      Object.keys(identity.files).length !== integrityFiles.length ||
      integrityFiles.some(
        (file) => typeof identity.files[file] !== 'string' || !/^[a-f0-9]{64}$/.test(identity.files[file])
      )
    ) {
      throw new Error('插件完整性清单必须包含四个必需文件的 SHA256，不能省略摘要')
    }
  }
  if (
    actual.name !== expected.name ||
    actual.version !== expected.version ||
    Object.keys(expected.files).some((file) => actual.files[file] !== expected.files[file])
  ) {
    throw new Error(`插件 ${expected.name} 的版本或文件摘要与随附来源不一致`)
  }
}

export function assertSidebarCompatibilityIdentity(
  actual: SidebarCompatibility,
  expected: SidebarCompatibility
): void {
  const fields = ['name', 'version', 'patchId', 'sourceSha256', 'patchedSha256', 'sha256'] as const
  if (
    actual?.state !== 'patched-known' ||
    expected?.state !== 'patched-known' ||
    fields.some(
      (field) => typeof actual[field] !== 'string' || !actual[field] || actual[field] !== expected[field]
    ) ||
    actual.sha256 !== SIDEBAR_SOURCE.patchedSha256 ||
    actual.patchedSha256 !== SIDEBAR_SOURCE.patchedSha256 ||
    actual.sourceSha256 !== SIDEBAR_SOURCE.sourceSha256 ||
    actual.patchId !== SIDEBAR_SOURCE.patchId ||
    actual.name !== SIDEBAR_SOURCE.name ||
    actual.version !== SIDEBAR_SOURCE.version
  )
    throw new Error('侧栏终端兼容入口的来源、版本或补丁摘要不一致')
}

export function inspectBundledSidebar(profile: string) {
  const identity = inspectSidebarCompatibility(profile)
  assertSidebarCompatibilityIdentity(identity, identity)
  return { ...identity, source: SIDEBAR_SOURCE.tarball, sourceIntegrity: SIDEBAR_SOURCE.integrity }
}

/** Independently check a runtime after staging or extraction from a release archive. */
export function verifyRuntimeIntegrity(
  root: string,
  expected?: { node?: string; dsh?: string; app?: string }
): void {
  const manifest = JSON.parse(readFileSync(join(root, 'runtime-manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 3 || !manifest.integrity)
    throw new Error('运行时缺少可验证的来源与摘要清单；请重新装配')
  if (manifest.seedSource !== 'catalog') throw new Error('发布种子必须来自版本清单，不能来自个人 profile')
  if (
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    !/^[a-zA-Z0-9_-]+$/.test(manifest.profile ?? '')
  )
    throw new Error('运行时平台、架构或 profile 标识与本机不一致')
  if (expected?.app && manifest.app?.version !== expected.app)
    throw new Error('应用版本与 runtime manifest 不一致')
  assertRuntimeProducts(manifest.products, PRODUCT_CATALOG, manifest.app?.version, manifest.dsh?.version)
  const node = inspectNode(join(root, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node'), {
    version: expected?.node ?? manifest.node?.version,
    platform: manifest.platform,
    arch: manifest.arch
  })
  const dsh = inspectDsh(join(root, 'dsh'), expected?.dsh ?? manifest.dsh?.version)
  if (
    node.version !== manifest.node?.version ||
    dsh.version !== manifest.dsh?.version ||
    node.sha256 !== manifest.integrity.nodeSha256 ||
    dsh.manifestSha256 !== manifest.integrity.dshManifestSha256 ||
    dsh.entrySha256 !== manifest.integrity.dshEntrySha256
  )
    throw new Error('运行时二进制/DSH 清单与记录的版本或摘要不一致')
  const plugins = manifest.integrity.managedPlugins as PluginIdentity[]
  if (!Array.isArray(plugins) || plugins.length !== MANAGED_PLUGIN_NAMES.length)
    throw new Error('受管插件来源清单不完整')
  for (const name of MANAGED_PLUGIN_NAMES) {
    const expectedPlugin = plugins.find((plugin) => plugin.name === name)
    if (!expectedPlugin || expectedPlugin.source !== `packages/${name}`)
      throw new Error(`插件 ${name} 缺少受管来源记录`)
    assertPluginIdentity(
      inspectManagedPlugin(
        join(root, 'dsh-home/profiles', manifest.profile, 'node_modules', name),
        name,
        expectedPlugin.source,
        manifest.products.pack.version
      ),
      expectedPlugin
    )
  }
  const sidebar = inspectBundledSidebar(join(root, 'dsh-home/profiles', manifest.profile))
  const expectedSidebar = manifest.integrity.sidebarCompatibility
  assertSidebarCompatibilityIdentity(sidebar, expectedSidebar)
  if (
    expectedSidebar.source !== sidebar.source ||
    expectedSidebar.sourceIntegrity !== sidebar.sourceIntegrity
  )
    throw new Error('侧栏终端兼容入口缺少固定上游来源记录')
}
