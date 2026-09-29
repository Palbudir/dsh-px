import { Provider, type AppUpdater, type ResolvedUpdateFileInfo } from 'electron-updater'
import type { UpdateInfo, CustomPublishOptions } from 'builder-util-runtime'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'
import { verifySignedRelease, type ReleaseManifest, type ReleaseTarget } from '../shared/signed-release'

export interface SignedUpdateOptions {
  provider: 'custom'
  url: string
  keys: Readonly<Record<string, string>>
  target: ReleaseTarget
}

/** The updater never reads an unsigned YAML feed or chooses files outside the verified manifest. */
export class SignedUpdateProvider extends Provider<UpdateInfo> {
  private readonly manifests = new WeakMap<UpdateInfo, ReleaseManifest>()
  private readonly configuration: SignedUpdateOptions
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
  async getLatestVersion(): Promise<UpdateInfo> {
    const raw = await this.httpRequest(new URL(this.configuration.url))
    if (!raw) throw new Error('更新服务器没有返回签名清单')
    const manifest = verifySignedRelease(raw, this.configuration.keys, this.configuration.target)
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
  resolveFiles(info: UpdateInfo): ResolvedUpdateFileInfo[] {
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
}
