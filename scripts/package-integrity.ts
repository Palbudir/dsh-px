import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { extractFile } from '@electron/asar'
import { sourceFingerprint } from '../src/shared/build-identity'
import { MANAGED_PLUGIN_NAMES } from '../src/shared/plugin-catalog'
import { assertPluginIdentity, inspectManagedPlugin } from '../src/shared/runtime-integrity'

const entryOutputs = ['main/index.js', 'preload/index.cjs', 'renderer/index.html'] as const
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** A self-consistent old runtime is still stale when this checkout's managed sources changed. */
export function verifyManagedPackageSources(
  runtimeRoot: string,
  repository: string,
  profile: string,
  version: string
): void {
  for (const name of MANAGED_PLUGIN_NAMES) {
    const source = `packages/${name}`
    assertPluginIdentity(
      inspectManagedPlugin(
        join(runtimeRoot, 'dsh-home/profiles', profile, 'node_modules', name),
        name,
        source,
        version
      ),
      inspectManagedPlugin(join(repository, 'packages', name), name, source, version)
    )
  }
}

/** Bind the packed app to both current sources and the current locally inspected build. */
export function verifyBuiltApplication(archive: string, repository: string, version: string): void {
  const app = JSON.parse(extractFile(archive, 'package.json').toString('utf8'))
  if (app.name !== 'dsh-px' || app.version !== version)
    throw new Error('app.asar 中的应用身份或版本与安装包不一致')
  const packed = JSON.parse(extractFile(archive, 'out/build-info.json').toString('utf8'))
  const built = JSON.parse(readFileSync(join(repository, 'out/build-info.json'), 'utf8'))
  const fingerprint = sourceFingerprint(repository)
  for (const info of [packed, built]) {
    if (
      info?.version !== version ||
      info.sourceFingerprint !== fingerprint ||
      !info.outputs ||
      Object.keys(info.outputs).length !== entryOutputs.length ||
      entryOutputs.some((entry) => !/^[a-f0-9]{64}$/.test(info.outputs[entry] ?? ''))
    )
      throw new Error('应用构建身份与当前源码不一致或入口摘要不完整；请重新 build 并打包')
  }
  for (const entry of entryOutputs) {
    const actual = hash(extractFile(archive, join('out', ...entry.split('/'))))
    const current = hash(readFileSync(join(repository, 'out', entry)))
    if (actual !== packed.outputs[entry] || current !== built.outputs[entry] || actual !== current)
      throw new Error(`应用入口与当前构建不一致：${entry}`)
  }
  const verifyOutputs = (parts: string[]): void => {
    for (const entry of readdirSync(join(repository, 'out', ...parts), { withFileTypes: true })) {
      const next = [...parts, entry.name]
      if (entry.isDirectory()) verifyOutputs(next)
      else if (entry.isFile()) {
        if (next.length === 1 && entry.name === 'build-info.json') continue
        const current = hash(readFileSync(join(repository, 'out', ...next)))
        if (hash(extractFile(archive, join('out', ...next))) !== current)
          throw new Error(`应用资源与当前构建不一致：${next.join('/')}`)
      } else throw new Error('当前构建包含链接或特殊文件，不能确认应用资源')
    }
  }
  verifyOutputs([])
}
