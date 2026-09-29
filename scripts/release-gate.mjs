import {
  CHECK_NAME,
  QUALITY_CHECK_NAME,
  REPORT_MARKER,
  QUALITY_MARKER,
  decodeReport,
  sha,
  verifyAttestation
} from './review-core.mjs'
import { findTrustedQuality, trustedRun } from './review-trusted-ci.mjs'
import {
  assertNotLegacyClientTag,
  compareVersions,
  parseReleaseTag,
  releaseTag,
  versionParts
} from './release-version.mjs'

/** The last legacy-shell release. Old clients read GitHub Latest; it must never move. */
export const LEGACY_LATEST_TAG = 'v0.1.0-beta.re.0.11'

/**
 * Each product is monotonic within its own tag prefix. Historical `v*` releases belong to the retired
 * shell and are not compared; a malformed tag inside the product's own prefix fails closed.
 */
export function assertNewerVersion(product, version, releases) {
  versionParts(version)
  const prefix = `${product}-v`
  for (const release of releases) {
    if (release.draft) continue
    const tag = String(release.tag_name)
    if (!tag.startsWith(prefix)) continue
    let existing
    try {
      existing = parseReleaseTag(tag)
    } catch {
      throw new Error(`Existing ${product} release has an invalid tag: ${tag}`)
    }
    if (existing?.product === product && compareVersions(version, existing.version) <= 0)
      throw new Error(`Release ${product} ${version} is not newer than published ${existing.version}`)
  }
}

/** GitHub Latest must remain the legacy release so old clients never see a new product. */
export function assertLegacyLatest(latest) {
  if (!latest || latest.tag_name !== LEGACY_LATEST_TAG || latest.prerelease || latest.draft)
    throw new Error(`GitHub Latest must remain ${LEGACY_LATEST_TAG}; refusing to continue`)
}

export function assertChecks(checks, policy, head) {
  if (!Number.isSafeInteger(policy.reviewAppId) || policy.reviewAppId <= 0 || policy.reviewAppId === 15368)
    throw new Error('Dedicated review App is not configured')
  const selected = {}
  for (const name of [CHECK_NAME, QUALITY_CHECK_NAME]) {
    const latest = checks
      .filter(
        (check) => check.name === name && check.head_sha === head && check.app?.id === policy.reviewAppId
      )
      .sort((a, b) => b.id - a.id)[0]
    if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success')
      throw new Error(`Missing or unsuccessful dedicated App check: ${name}`)
    selected[name] = latest
  }
  const proof = new RegExp(`${REPORT_MARKER}([A-Za-z0-9+/=]+)`).exec(
    selected[CHECK_NAME].output?.summary ?? ''
  )
  if (!proof) throw new Error('Independent check lacks signed evidence')
  verifyAttestation(decodeReport(proof[1]), policy, { head })
  const quality = new RegExp(`${QUALITY_MARKER}([A-Za-z0-9+/=]+)`).exec(
    selected[QUALITY_CHECK_NAME].output?.summary ?? ''
  )
  if (!quality) throw new Error('Dedicated quality check lacks its trusted workflow evidence')
  return {
    review: decodeReport(proof[1]),
    quality: JSON.parse(Buffer.from(quality[1], 'base64').toString('utf8'))
  }
}

export async function releaseGate({ product, version, tag, head, policy, api, buildRunId }) {
  sha(head)
  versionParts(version)
  const expectedTag = releaseTag(product, version)
  if (tag !== `refs/tags/${expectedTag}`) throw new Error('Release requires the exact product version tag')
  assertNotLegacyClientTag(tag)
  const branch = await api(`repos/${policy.repository}/branches/${policy.branch}`)
  if (!branch.protected || branch.commit.sha !== head)
    throw new Error('Only the current protected default-branch commit can be released')
  const required = branch.protection?.required_status_checks?.checks ?? []
  for (const name of [CHECK_NAME, QUALITY_CHECK_NAME])
    if (!required.some((check) => check.context === name && check.app_id === policy.reviewAppId))
      throw new Error(`Branch protection does not require dedicated ${name}`)
  const decode = async (path) =>
    JSON.parse(
      Buffer.from(
        (await api(`repos/${policy.repository}/contents/${path}?ref=${head}`)).content,
        'base64'
      ).toString('utf8')
    )
  const pkg = await decode('package.json')
  const products = await decode('config/products.json')
  if (pkg.name !== 'dsh-px' || pkg.version !== products.desktop?.version)
    throw new Error('Reviewed package identity does not match its Desktop version')
  const source = product === 'pack' ? products.pack?.version : products.desktop?.version
  if (source !== version) throw new Error(`Version does not match the reviewed ${product} version`)
  if (products.desktop?.architecture !== 'official-derived')
    throw new Error('Only official-derived products are released from this repository')
  const checks = [],
    releases = []
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('Check history audit limit reached')
    const data = await api(`repos/${policy.repository}/commits/${head}/check-runs?per_page=100&page=${page}`)
    checks.push(...data.check_runs)
    if (data.check_runs.length < 100) break
  }
  const evidence = assertChecks(checks, policy, head)
  const quality = await findTrustedQuality(api, policy, head)
  if (
    !quality ||
    quality.pending ||
    quality.failed ||
    quality.runId !== evidence.quality.runId ||
    quality.runAttempt !== evidence.quality.runAttempt
  )
    throw new Error('Quality evidence is not the latest successful trusted run')
  // The trusted build's run-name binds the head and the product tag, so one run proves one product.
  const build = buildRunId ? await trustedRun(api, policy, 'build', buildRunId, head, expectedTag) : undefined
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('Release history audit limit reached')
    const data = await api(`repos/${policy.repository}/releases?per_page=100&page=${page}`)
    releases.push(...data)
    if (data.length < 100) break
  }
  assertNewerVersion(product, version, releases)
  assertLegacyLatest(await api(`repos/${policy.repository}/releases/latest`))
  return { head, product, version, tag: expectedTag, quality, build }
}
