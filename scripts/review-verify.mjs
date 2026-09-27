import {
  CHECK_NAME,
  QUALITY_CHECK_NAME,
  REPORT_MARKER,
  QUALITY_MARKER,
  canonical,
  encodeReport,
  sha,
  sha256,
  verifyAttestation
} from './review-core.mjs'
import { findTrustedQuality, trustedRun } from './review-trusted-ci.mjs'

export const PUBLIC_REVIEW_FAILURE =
  'Trusted verification could not be completed. Details are available in the private worker log.'

function requireDedicatedApp(policy) {
  if (!Number.isSafeInteger(policy.reviewAppId) || policy.reviewAppId <= 0 || policy.reviewAppId === 15368)
    throw new Error('A configured dedicated review App is required; GitHub Actions is not its identity')
}
async function publishCheck(api, policy, body) {
  const list = await api(
    `repos/${policy.repository}/commits/${body.head_sha}/check-runs?check_name=${encodeURIComponent(body.name)}&per_page=100`
  )
  const latest = list.check_runs
    .filter((check) => check.app?.id === policy.reviewAppId && check.name === body.name)
    .sort((a, b) => b.id - a.id)[0]
  if (
    latest?.external_id === body.external_id &&
    latest.status === body.status &&
    (latest.conclusion ?? undefined) === body.conclusion &&
    latest.output?.summary === body.output?.summary
  )
    return latest
  return await api(`repos/${policy.repository}/check-runs`, { method: 'POST', body })
}
/** Called only with the dedicated installation client in the trusted local worker. */
export async function publishReview(report, policy, api) {
  requireDedicatedApp(policy)
  sha(report?.payload?.head)
  let conclusion = 'success',
    problem = '',
    proofValid = false
  try {
    const payload = verifyAttestation(report, policy)
    proofValid = true
    const source = await api(`repos/${policy.repository}/actions/runs/${payload.requestRunId}`)
    if (
      source.path !== '.github/workflows/review-request.yml' ||
      source.run_attempt !== payload.requestAttempt ||
      source.conclusion !== 'success' ||
      source.repository?.full_name !== policy.repository
    )
      throw new Error('Untrusted review request')
    const commit = await api(`repos/${policy.repository}/commits/${payload.head}`)
    if (commit.commit.tree.sha !== payload.tree)
      throw new Error('Reviewed tree does not match the target commit')
    const branch = await api(`repos/${policy.repository}/branches/${policy.branch}`)
    if (!branch.protected) throw new Error('The default branch is not protected')
    if (payload.head === branch.commit.sha) {
      if (commit.parents[0]?.sha !== payload.base)
        throw new Error('Default-branch review must cover its latest merge delta')
    } else if (payload.base !== branch.commit.sha)
      throw new Error('Review base moved; rerun against the current default branch')
  } catch (error) {
    conclusion = 'failure'
    problem = String(error).slice(0, 1200)
  }
  const result = await publishCheck(api, policy, {
    name: CHECK_NAME,
    head_sha: report.payload.head,
    status: 'completed',
    conclusion,
    completed_at: new Date().toISOString(),
    external_id: sha256(canonical(report)),
    output: {
      title: conclusion === 'success' ? 'Independent review passed' : 'Independent review requires attention',
      summary:
        conclusion === 'success'
          ? `All source batches passed with no unresolved P0/P1/P2 or coverage blockers.\n\n${REPORT_MARKER}${encodeReport(report)}`
          : PUBLIC_REVIEW_FAILURE
    }
  })
  return { conclusion, id: result.id, problem, retryable: conclusion !== 'success' && proofValid }
}

function qualityFailureSummary(failure) {
  // Only fixed GitHub run status fields are public; exception text stays with the local caller.
  if (
    failure &&
    typeof failure === 'object' &&
    Number.isSafeInteger(failure.runId) &&
    failure.runId > 0 &&
    Number.isSafeInteger(failure.runAttempt) &&
    failure.runAttempt > 0 &&
    [
      'failure',
      'cancelled',
      'timed_out',
      'action_required',
      'neutral',
      'skipped',
      'stale',
      'startup_failure'
    ].includes(failure.conclusion)
  )
    return `Trusted quality run ${failure.runId}, attempt ${failure.runAttempt}: ${failure.conclusion}`
  return PUBLIC_REVIEW_FAILURE
}

export async function publishQuality(policy, api, head, evidence, failure) {
  requireDedicatedApp(policy)
  sha(head)
  let verified
  if (evidence) verified = await trustedRun(api, policy, 'quality', evidence.runId, head)
  const completed = Boolean(verified || failure)
  const result = await publishCheck(api, policy, {
    name: QUALITY_CHECK_NAME,
    head_sha: head,
    status: completed ? 'completed' : 'queued',
    external_id: sha256(canonical({ head, evidence: verified ?? null, failure: failure ?? null })),
    ...(completed
      ? { conclusion: failure ? 'failure' : 'success', completed_at: new Date().toISOString() }
      : {}),
    ...(verified ? { details_url: verified.url } : {}),
    output: {
      title: verified
        ? 'Trusted quality gates passed'
        : failure
          ? 'Quality gates failed'
          : 'Waiting for trusted quality gates',
      summary: failure
        ? qualityFailureSummary(failure)
        : verified
          ? QUALITY_MARKER + Buffer.from(JSON.stringify(verified)).toString('base64')
          : 'Only the configured default-branch workflow can satisfy this gate.'
    }
  })
  return { id: result.id, completed, passed: Boolean(verified && !failure) }
}

/** API failures retain a retryable request; an unchanged check is de-duplicated by publishCheck. */
export async function settleQuality(policy, api, head, dispatch) {
  try {
    const quality = await findTrustedQuality(api, policy, head)
    if (quality?.failed) {
      await publishQuality(policy, api, head, null, {
        runId: quality.runId,
        runAttempt: quality.runAttempt,
        conclusion: quality.conclusion
      })
      return { finished: true, monitorQuality: quality }
    }
    if (quality && !quality.pending) {
      await publishQuality(policy, api, head, quality)
      return { finished: true, monitorQuality: { ...quality, status: 'completed', conclusion: 'success' } }
    }
    if (!quality) await dispatch()
    await publishQuality(policy, api, head, null)
    return { finished: false, monitorQuality: quality ?? undefined }
  } catch (error) {
    const message = String(error).slice(0, 1000)
    try {
      await publishQuality(policy, api, head, null, message)
    } catch {
      /* Retry after GitHub connectivity returns. */
    }
    return { finished: false, error: message }
  }
}
