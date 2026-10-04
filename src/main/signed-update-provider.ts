import { Provider, type AppUpdater, type ResolvedUpdateFileInfo } from 'electron-updater'
import type { UpdateInfo, CustomPublishOptions } from 'builder-util-runtime'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'
import {
  verifySignedRelease,
  type ReleaseFile,
  type ReleaseManifest,
  type ReleaseTarget
} from '../shared/signed-release'
import { createHash } from 'node:crypto'
import { versionGeneration } from '../shared/product-contract'

type MapRules = { signed: Map<string, ReleaseFile>; previous: Set<string> }
const mapRules = new WeakMap<object, MapRules>()
/** Keep the native HTTP transport, but verify the new signed map before its parser sees bytes. */
function blockmapRules(executor: ProviderRuntimeOptions['executor']): MapRules {
  const existing = mapRules.get(executor)
  if (existing) return existing
  const rules: MapRules = { signed: new Map(), previous: new Set() }
  const download = executor.downloadToBuffer.bind(executor)
  executor.downloadToBuffer = async (url, options) => {
    const expected = rules.signed.get(url.href)
    if (url.pathname.endsWith('.blockmap') && !expected && !rules.previous.has(url.href))
      throw Error('差分索引不属于当前更新')
    const bytes = await download(url, options)
    if (
      expected &&
      (!bytes ||
        bytes.length !== expected.size ||
        createHash('sha256').update(bytes).digest('hex') !== expected.sha256 ||
        createHash('sha512').update(bytes).digest('base64') !== expected.sha512)
    )
      throw Error('差分索引校验失败，改用完整安装包')
    return bytes
  }
  mapRules.set(executor, rules)
  return rules
}

export interface SignedUpdateOptions {
  provider: 'custom'
  url: string
  keys: Readonly<Record<string, string>>
  target: ReleaseTarget
}

/** Installer and new map are signed. The previous release map is a planning hint; final installer hashes remain mandatory. */
export class SignedUpdateProvider extends Provider<UpdateInfo> {
  private readonly manifests = new WeakMap<UpdateInfo, ReleaseManifest>()
  private readonly configuration: SignedUpdateOptions
  private currentManifest?: ReleaseManifest
  constructor(options: CustomPublishOptions, _updater: AppUpdater, runtime: ProviderRuntimeOptions) {
    super({ ...runtime, isUseMultipleRangeRequest: false })
    const configuration = options as unknown as SignedUpdateOptions
    if (
      !configuration.target ||
      !['stable', 'preview'].includes(configuration.target.channel) ||
      !Number.isSafeInteger(configuration.target.protocolGeneration) ||
      configuration.target.protocolGeneration < 1 ||
      !configuration.keys ||
      typeof configuration.keys !== 'object' ||
      Array.isArray(configuration.keys) ||
      !Object.values(configuration.keys).length ||
      Object.values(configuration.keys).some((key) => typeof key !== 'string')
    )
      throw new Error('PX Desktop 更新信任配置无效')
    const expected = `https://raw.githubusercontent.com/Palbudir/dsh-px/updates/desktop-${configuration.target.channel}.json`
    if (
      configuration.url !== expected ||
      configuration.target.product !== 'desktop' ||
      configuration.target.platform !== 'win32-x64'
    )
      throw new Error('PX Desktop 更新源配置无效')
    this.configuration = {
      ...configuration,
      keys: Object.freeze({ ...configuration.keys }),
      target: Object.freeze({ ...configuration.target })
    }
  }
  override async getLatestVersion(): Promise<UpdateInfo> {
    const raw = await this.httpRequest(new URL(this.configuration.url))
    if (!raw) throw new Error('更新服务器没有返回签名清单')
    const manifest = verifySignedRelease(raw, this.configuration.keys, this.configuration.target)
    this.currentManifest = manifest
    const installer = manifest.files.find((file) => file.role === 'installer')!
    const info: UpdateInfo = {
      version: manifest.version,
      releaseDate: manifest.issuedAt,
      files: [{ url: installer.url, size: installer.size, sha512: installer.sha512 }],
      path: installer.url,
      sha512: installer.sha512
    }
    this.manifests.set(info, manifest)
    return info
  }
  override getBlockMapFiles(baseUrl: URL, oldVersion: string, newVersion: string): URL[] {
    const manifest = this.currentManifest
    const installer = manifest?.files.find((file) => file.role === 'installer')
    const blockmap = manifest?.files.find((file) => file.role === 'blockmap')
    if (!installer || !blockmap || manifest?.version !== newVersion || baseUrl.href !== installer.url)
      throw Error('当前版本未提供匹配的签名差分索引')
    versionGeneration(oldVersion)
    const oldName = `DSH-PX-Desktop-${oldVersion.replace('+', '_')}-win-x64.exe.blockmap`
    const previous = new URL(
      `https://github.com/Palbudir/dsh-px/releases/download/desktop-v${encodeURIComponent(oldVersion)}/${oldName}`
    )
    const next = new URL(blockmap.url)
    const rules = blockmapRules(this.executor)
    rules.signed.set(next.href, blockmap)
    rules.previous.add(previous.href)
    // One updater owns at most one active transfer. Keep a bounded recent roster.
    while (rules.signed.size > 8) rules.signed.delete(rules.signed.keys().next().value!)
    while (rules.previous.size > 8) rules.previous.delete(rules.previous.values().next().value!)
    return [previous, next]
  }
  override resolveFiles(info: UpdateInfo): ResolvedUpdateFileInfo[] {
    const manifest = this.manifests.get(info)
    if (!manifest || info.version !== manifest.version) throw new Error('更新文件缺少对应的签名清单')
    const installer = manifest.files.find((file) => file.role === 'installer')!
    // Return newly constructed file metadata from the frozen manifest, never from mutable UpdateInfo.
    return [
      {
        url: new URL(installer.url),
        info: { url: installer.url, size: installer.size, sha512: installer.sha512 }
      }
    ]
  }
}

export function configureSignedUpdates(
  updater: AppUpdater,
  keys: Readonly<Record<string, string>>,
  channel: 'stable' | 'preview',
  generation: number
): void {
  updater.setFeedURL({
    provider: 'custom',
    updateProvider: SignedUpdateProvider,
    url: `https://raw.githubusercontent.com/Palbudir/dsh-px/updates/desktop-${channel}.json`,
    keys,
    target: { product: 'desktop', channel, platform: 'win32-x64', protocolGeneration: generation }
  })
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = false
  // Missing baselines or invalid maps use electron-updater's full-download fallback.
  updater.disableDifferentialDownload = false
  updater.disableWebInstaller = true
}
