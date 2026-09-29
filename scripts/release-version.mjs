export function versionParts(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version
    )
  if (!match) throw new Error('Invalid semantic version')
  const pre = match[4]?.split('.') ?? []
  if (pre.some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === '0'))
    throw new Error('Invalid numeric prerelease identifier')
  return { core: match.slice(1, 4).map(BigInt), pre }
}
export function compareVersions(left, right) {
  const a = versionParts(left),
    b = versionParts(right)
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1
  if (!a.pre.length || !b.pre.length) return !a.pre.length && !b.pre.length ? 0 : !a.pre.length ? 1 : -1
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined || b.pre[i] === undefined) return a.pre[i] === undefined ? -1 : 1
    if (a.pre[i] === b.pre[i]) continue
    const an = /^\d+$/.test(a.pre[i]),
      bn = /^\d+$/.test(b.pre[i])
    if (an && bn) return BigInt(a.pre[i]) > BigInt(b.pre[i]) ? 1 : -1
    if (an !== bn) return an ? -1 : 1
    return a.pre[i] > b.pre[i] ? 1 : -1
  }
  return 0
}

/** Released products. Each has its own tag prefix, version source and monotonic history. */
export const RELEASE_PRODUCTS = Object.freeze(['desktop', 'pack'])

function product(value) {
  if (!RELEASE_PRODUCTS.includes(value)) throw new Error('Unknown release product')
  return value
}

/** `desktop-v<version>` / `pack-v<version>`: never a bare `v*` tag that legacy clients select. */
export function releaseTag(name, version) {
  product(name)
  versionParts(version)
  return `${name}-v${version}`
}

/** Parse a product tag; returns null for tags that belong to no current product (history). */
export function parseReleaseTag(tag) {
  const match = /^(desktop|pack)-v(.+)$/.exec(String(tag))
  if (!match) return null
  versionParts(match[2])
  return { product: match[1], version: match[2] }
}

/**
 * Old DSH-PX clients (electron-updater GitHub provider and the legacy updater plugin) treat any
 * `v<semver>` tag and GitHub Latest as their own feed. New releases must never look like that.
 */
export function assertNotLegacyClientTag(tag) {
  const value = String(tag).replace(/^refs\/tags\//, '')
  if (/^v?\d/.test(value)) throw new Error('A bare v* tag would be selected by legacy DSH-PX clients')
  if (!parseReleaseTag(value)) throw new Error('Release tag must be desktop-v<version> or pack-v<version>')
}

/** Delta feeds and auto-update YAML are never published; the signed manifest is the only feed. */
export function assertPublishableAssetName(name) {
  if (typeof name !== 'string' || !name || name !== name.trim() || /[/\\:\r\n]/.test(name))
    throw new Error('Unsafe release asset name')
  if (/\.(?:ya?ml|blockmap)$/i.test(name))
    throw new Error(`Update feed or delta asset is not publishable: ${name}`)
  if (/[^0-9A-Za-z._-]/.test(name)) throw new Error(`Release asset name is not GitHub-safe: ${name}`)
  return name
}

/** GitHub-safe names, preserving build metadata without colliding with another valid SemVer. */
export function releaseAssetNames(name, version) {
  product(name)
  if (typeof version !== 'string') throw new Error('Invalid semantic version')
  versionParts(version)
  // Underscores are not valid SemVer characters, so this escape of '+' is unambiguous.
  const safeVersion = version.replace('+', '_')
  if (/[^0-9A-Za-z._-]/.test(safeVersion)) throw new Error('Invalid release asset version')
  const assets =
    name === 'desktop'
      ? { installer: `DSH-PX-Desktop-${safeVersion}-win-x64.exe`, artifact: 'artifact.json' }
      : { pack: `dsh-px-pack-${safeVersion}.tgz`, artifact: 'artifact.json' }
  for (const asset of Object.values(assets)) assertPublishableAssetName(asset)
  return assets
}
