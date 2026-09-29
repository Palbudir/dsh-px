/** Signed Pack release feed: Ed25519 manifest verified with the pinned keys, then compared to this Pack. */
import updateKeys from '../../../config/update-keys.json'
import products from '../../../config/products.json'
import { verifySignedRelease, type ReleaseManifest } from '../../../src/shared/signed-release'
import { isNewer } from './version'

export const PACK_FEED_URL = 'https://raw.githubusercontent.com/Palbudir/dsh-px/updates/pack-preview.json'
export const PACK_FEED_KEYS: Readonly<Record<string, string>> = Object.freeze({ ...updateKeys.keys })
export const PACK_TARGET = Object.freeze({
  product: 'pack',
  channel: 'preview',
  platform: 'any',
  protocolGeneration: products.protocolGeneration
} as const)

export interface PackCheck {
  checkedAt: string
  current: { pack: string }
  latest: { pack: string | null; hostVersion: string | null; issuedAt: string | null }
  updateAvailable: boolean
  releaseUrl: string | null
  /** Pack updates are only announced; installation stays with the native plugin manager. */
  install: 'manual'
  error: string | null
}

/** A release page for the verified tag only; never a URL taken from unverified feed text. */
export function packReleaseUrl(manifest: Pick<ReleaseManifest, 'product' | 'version'>): string {
  return `https://github.com/Palbudir/dsh-px/releases/tag/${manifest.product}-v${encodeURIComponent(manifest.version)}`
}

export function evaluatePackFeed(
  source: string,
  currentPack: string,
  now = new Date(),
  keys: Readonly<Record<string, string>> = PACK_FEED_KEYS
): PackCheck {
  const result: PackCheck = {
    checkedAt: now.toISOString(),
    current: { pack: currentPack },
    latest: { pack: null, hostVersion: null, issuedAt: null },
    updateAvailable: false,
    releaseUrl: null,
    install: 'manual',
    error: null
  }
  let manifest: ReleaseManifest
  try {
    manifest = verifySignedRelease(source, keys, PACK_TARGET)
  } catch (error) {
    result.error = `签名更新清单未通过校验：${error instanceof Error ? error.message : String(error)}`
    return result
  }
  result.latest = { pack: manifest.version, hostVersion: manifest.hostVersion, issuedAt: manifest.issuedAt }
  result.releaseUrl = packReleaseUrl(manifest)
  result.updateAvailable = isNewer(manifest.version, currentPack)
  return result
}
