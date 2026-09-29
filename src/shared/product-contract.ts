export interface ProductCatalog {
  schemaVersion: 1
  protocolGeneration: number
  pack: {
    version: string
    dataSchemaVersion: number
    hostVersions: string[]
    surfaces: string[]
  }
  desktop: {
    version: string
    packVersion: string
    hostVersion: string
    architecture: 'legacy-shell' | 'official-derived'
  }
}

/** PX 0.x.y uses x for its bridge generation; patch and prerelease advance independently. */
export function versionGeneration(version: unknown): number {
  if (typeof version !== 'string') throw new Error('Product version must be a string')
  const match =
    /^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/.exec(
      version
    )
  if (!match || !Number.isSafeInteger(Number(match[1])))
    throw new Error('Product version must use canonical 0.x.y with an optional prerelease')
  return Number(match[1])
}

export function validateProductCatalog(value: unknown): asserts value is ProductCatalog {
  const c = value as ProductCatalog | undefined
  if (!c || c.schemaVersion !== 1 || !Number.isSafeInteger(c.protocolGeneration) || c.protocolGeneration < 1)
    throw new Error('Invalid product catalog or protocol generation')
  if (!c.pack || !c.desktop) throw new Error('Both Pack and Desktop identities are required')
  for (const version of [c.pack.version, c.desktop.version, c.desktop.packVersion])
    if (versionGeneration(version) !== c.protocolGeneration)
      throw new Error('Pack and Desktop must use the declared protocol generation')
  if (c.desktop.packVersion !== c.pack.version)
    throw new Error("Desktop must pin this build's exact Pack version")
  if (!Number.isSafeInteger(c.pack.dataSchemaVersion) || c.pack.dataSchemaVersion < 1)
    throw new Error('Invalid Pack data schema version')
  if (
    !Array.isArray(c.pack.hostVersions) ||
    !c.pack.hostVersions.length ||
    c.pack.hostVersions.some(
      (v) => typeof v !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)
    ) ||
    new Set(c.pack.hostVersions).size !== c.pack.hostVersions.length ||
    !c.pack.hostVersions.includes(c.desktop.hostVersion)
  )
    throw new Error('Desktop host must be included in Pack host compatibility')
  if (
    !Array.isArray(c.pack.surfaces) ||
    !c.pack.surfaces.includes('web') ||
    !c.pack.surfaces.includes('px-desktop') ||
    c.pack.surfaces.some((s) => !['web', 'px-desktop', 'official-desktop'].includes(s)) ||
    new Set(c.pack.surfaces).size !== c.pack.surfaces.length
  )
    throw new Error('Invalid Pack surfaces')
  if (!['legacy-shell', 'official-derived'].includes(c.desktop.architecture))
    throw new Error('Unknown Desktop architecture')
}

/** Fail closed on a mismatched manifest before a runtime is activated or migrated. */
export function assertRuntimeProducts(
  actual: unknown,
  expected: unknown,
  appVersion: string,
  hostVersion: string
): void {
  validateProductCatalog(actual)
  validateProductCatalog(expected)
  if (
    actual.desktop.version !== appVersion ||
    actual.desktop.hostVersion !== hostVersion ||
    actual.protocolGeneration !== expected.protocolGeneration ||
    actual.pack.version !== expected.pack.version ||
    actual.pack.dataSchemaVersion !== expected.pack.dataSchemaVersion ||
    actual.desktop.version !== expected.desktop.version ||
    actual.desktop.architecture !== expected.desktop.architecture ||
    actual.desktop.hostVersion !== expected.desktop.hostVersion ||
    JSON.stringify([...actual.pack.hostVersions].sort()) !==
      JSON.stringify([...expected.pack.hostVersions].sort()) ||
    JSON.stringify([...actual.pack.surfaces].sort()) !== JSON.stringify([...expected.pack.surfaces].sort())
  )
    throw new Error('Runtime product identities do not match the reviewed build')
}
