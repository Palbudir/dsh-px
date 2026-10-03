import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyBundlePayload } from '../src/shared/bundle-payload'
import { FOUNDATION_PLUGINS, FEATURE_BUNDLES } from '../src/shared/distribution'
import { SIDEBAR_AUTH_SOURCE } from '../src/shared/sidebar-auth-compatibility'

export const FOUNDATION = FOUNDATION_PLUGINS
export const FEATURES = FEATURE_BUNDLES

/** One download remains a complete composition; Desktop installs the five native feature bundles separately. */
export function buildDistribution(
  bundle: string,
  version: string,
  dependencies: Record<string, string>,
  identity: Record<string, unknown>
) {
  const directory = join(bundle, 'distribution')
  mkdirSync(directory)
  const staging = join(bundle, '..', 'feature-build')
  mkdirSync(staging)
  const entries: Array<{ name: string; version: string; file: string; sha256: string }> = []
  for (const name of ['dsh-px-core', ...FEATURES]) {
    const output = join(staging, name)
    mkdirSync(output)
    const pkgDir = join(output, 'package')
    if (name === 'dsh-px-core' || name === 'dsh-px-files') {
      mkdirSync(pkgDir)
      const members = name === 'dsh-px-core' ? FOUNDATION : ['dsh-better-sidebar']
      const membersDir = join(pkgDir, 'node_modules')
      mkdirSync(membersDir)
      const memberVersions: Record<string, string> = {}
      for (const member of members) {
        const original = join(bundle, 'node_modules', member)
        if (member === 'dsh-better-sidebar') cpSync(original, join(membersDir, member), { recursive: true })
        else copyBundlePayload(original, join(membersDir, member))
        memberVersions[member] = JSON.parse(readFileSync(join(original, 'package.json'), 'utf8')).version
      }
      const metadata =
        name === 'dsh-px-core'
          ? [
              'PX 基础组件',
              '内容索引、共享存储、运行诊断与版本服务。',
              'PX foundation',
              'Content indexing, shared storage, diagnostics and version services.'
            ]
          : [
              '文件与终端',
              `文件、编辑器、终端与变更视图；集成社区 Better Sidebar ${SIDEBAR_AUTH_SOURCE.version}，含 PX 兼容补丁。`,
              'Files and terminals',
              `Files, editor, terminals and changes with community Better Sidebar ${SIDEBAR_AUTH_SOURCE.version} and PX compatibility patches.`
            ]
      const pkg = {
        name,
        version,
        private: true,
        type: 'module',
        main: 'index.js',
        license: 'MIT',
        icon: './icon.svg',
        description: metadata[1],
        exports: {
          '.': './index.js',
          './package.json': './package.json',
          './locale/*.json': './locale/*.json'
        },
        files: ['index.js', 'cordis.patch.yml', 'locale', 'icon.svg', 'LICENSE'],
        dependencies: { ...(name === 'dsh-px-files' ? dependencies : {}), ...memberVersions },
        bundledDependencies: members,
        dsh: { bundle: { patch: './cordis.patch.yml' } },
        dshPx: {
          ...identity,
          role: name === 'dsh-px-core' ? 'foundation' : 'feature',
          ...(name === 'dsh-px-files' ? { patches: [SIDEBAR_AUTH_SOURCE] } : {})
        }
      }
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
      writeFileSync(join(pkgDir, 'index.js'), 'export function apply() {}\n')
      writeFileSync(
        join(pkgDir, 'cordis.patch.yml'),
        '- insert:\n' +
          members
            .map((m) => `    - id: ${m === 'dsh-better-sidebar' ? 'better-sidebar' : m}\n      name: ${m}\n`)
            .join('')
      )
      mkdirSync(join(pkgDir, 'locale'))
      for (const lang of ['zh', 'en'])
        writeFileSync(
          join(pkgDir, 'locale', lang + '.json'),
          JSON.stringify(
            {
              meta: {
                title: lang === 'zh' ? metadata[0] : metadata[2],
                description: lang === 'zh' ? metadata[1] : metadata[3]
              }
            },
            null,
            2
          ) + '\n'
        )
      copyFileSync(join(bundle, 'node_modules/dsh-px-workspace/icon.svg'), join(pkgDir, 'icon.svg'))
      copyFileSync(join(bundle, 'LICENSE'), join(pkgDir, 'LICENSE'))
    } else copyBundlePayload(join(bundle, 'node_modules', name), pkgDir)
    const file = `${name}-${version}.tgz`
    execFileSync('tar', ['-czf', relative(output, join(directory, file)).replaceAll('\\', '/'), 'package'], {
      cwd: output,
      windowsHide: true
    })
    entries.push({
      name,
      version,
      file: 'distribution/' + file,
      sha256: createHash('sha256')
        .update(readFileSync(join(directory, file)))
        .digest('hex')
    })
  }
  const distribution = { schemaVersion: 1, version, foundation: entries[0], features: entries.slice(1) }
  writeFileSync(join(bundle, 'distribution.json'), JSON.stringify(distribution, null, 2) + '\n')
  return distribution
}
