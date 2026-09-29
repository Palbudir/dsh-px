import { createHash } from 'node:crypto'
import type { ProductCatalog } from './product-contract'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}

/** The caller verifies the manifest first. Build timestamps do not change migration identity. */
export function runtimeContentIdentity(manifest: {
  app: { version: string }
  platform: string
  arch: string
  profile: string
  node: { version: string }
  dsh: { version: string }
  integrity: Record<string, unknown>
  products?: ProductCatalog
}): string {
  return createHash('sha256')
    .update(
      canonical({
        pack: manifest.products?.pack ?? { version: manifest.app.version },
        protocolGeneration: manifest.products?.protocolGeneration ?? null,
        platform: manifest.platform,
        arch: manifest.arch,
        profile: manifest.profile,
        nodeVersion: manifest.node.version,
        dshVersion: manifest.dsh.version,
        integrity: manifest.integrity
      })
    )
    .digest('hex')
}
