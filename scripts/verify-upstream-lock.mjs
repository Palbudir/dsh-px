/**
 * CI check of the trusted upstream lock: download every pinned official tarball from the npm
 * registry and verify it against its pinned sha512 SRI, then project the locked files of every
 * pinned host. Nothing is cached; any mismatch or missing file fails.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadUpstreamCatalog, UPSTREAM_LOCK } from './review-upstream.mjs'

const cache = mkdtempSync(join(tmpdir(), 'dsh-px-upstream-lock-'))
try {
  const catalog = await loadUpstreamCatalog({ cacheDirectory: cache })
  let packages = 0,
    files = 0
  for (const host of UPSTREAM_LOCK.hosts) {
    const projected = catalog.hosts.get(host)
    if (!projected) throw Error(`Pinned host ${host} has no projected contracts`)
    for (const [, pkg] of projected) {
      packages++
      files += pkg.files.length
    }
  }
  console.log(
    `Upstream lock verified: ${UPSTREAM_LOCK.hosts.join(', ')}; ${packages} packages, ${files} files`
  )
} finally {
  rmSync(cache, { recursive: true, force: true })
}
