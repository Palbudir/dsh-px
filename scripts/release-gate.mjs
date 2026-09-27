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
import { versionParts, compareVersions } from './release-version.mjs'

export function assertNewerVersion(version, releases) {
  versionParts(version)
  for (const release of releases) {
    if (release.draft) continue
    const existing = String(release.tag_name).replace(/^v/, '')
    try {
      versionParts(existing)
    } catch {
      continue
    }
    if (compareVersions(version, existing) <= 0)
      throw new Error(`Release ${version} is not newer than published ${existing}`)
  }
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
export async function releaseGate({ version, tag, head, policy, api, buildRunId }) {
  sha(head)
  versionParts(version)
  if (tag !== `refs/tags/v${version}`) throw new Error('Release requires the exact version tag')
  const branch = await api(`repos/${policy.repository}/branches/${policy.branch}`)
  if (!branch.protected || branch.commit.sha !== head)
    throw new Error('Only the current protected default-branch commit can be released')
  const required = branch.protection?.required_status_checks?.checks ?? []
  for (const name of [CHECK_NAME, QUALITY_CHECK_NAME])
    if (!required.some((check) => check.context === name && check.app_id === policy.reviewAppId))
      throw new Error(`Branch protection does not require dedicated ${name}`)
  const source = await api(`repos/${policy.repository}/contents/package.json?ref=${head}`)
  const pkg = JSON.parse(Buffer.from(source.content, 'base64').toString('utf8'))
  if (pkg.name !== 'dsh-px' || pkg.version !== version)
    throw new Error('Version does not match the reviewed commit package')
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
    quality.runId !== evidence.quality.runId ||
    quality.runAttempt !== evidence.quality.runAttempt
  )
    throw new Error('Quality evidence is not the latest successful trusted run')
  const build = buildRunId ? await trustedRun(api, policy, 'build', buildRunId, head, version) : undefined
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('Release history audit limit reached')
    const data = await api(`repos/${policy.repository}/releases?per_page=100&page=${page}`)
    releases.push(...data)
    if (data.length < 100) break
  }
  assertNewerVersion(version, releases)
  return { head, version, quality, build }
}
