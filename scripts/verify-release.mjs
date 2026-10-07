/** Read-only verification of one downloaded Actions release directory; no download or publication. */
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { verifyReleaseFiles } from './release-assets.mjs'
import { releaseTag } from './release-version.mjs'

const [product, directory, head, version, ...extra] = process.argv.slice(2)
if (!directory || !/^[a-f0-9]{40}$/.test(head ?? '') || !version || extra.length) {
  throw Error(
    'Usage: node scripts/verify-release.mjs <pack|desktop> <release-directory> <source-sha> <version>'
  )
}
releaseTag(product, version)
const root = resolve(directory)
const manifest = JSON.parse(readFileSync(join(root, 'release-manifest.json'), 'utf8'))
const files = verifyReleaseFiles(root, manifest, { product, version, head, controllerSha: head })
console.log(JSON.stringify({ product, version, sourceCommit: head, verified: true, files }, null, 2))
