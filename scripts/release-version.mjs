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

/** GitHub-safe names, preserving build metadata without colliding with another valid SemVer. */
export function releaseAssetNames(version) {
  if (typeof version !== 'string') throw new Error('Invalid semantic version')
  versionParts(version)
  // Underscores are not valid SemVer characters, so this escape of '+' is unambiguous.
  const safeVersion = version.replace('+', '_')
  if (/[^0-9A-Za-z._-]/.test(safeVersion)) throw new Error('Invalid release asset version')
  const installer = `DSH-PX-Setup-${safeVersion}.exe`
  return {
    installer,
    blockmap: installer + '.blockmap',
    zip: `DSH-PX-${safeVersion}-win.zip`,
    metadata: 'latest.yml'
  }
}
