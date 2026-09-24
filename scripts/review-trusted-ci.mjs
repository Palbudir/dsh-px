import { sha, sourceDigest } from './review-core.mjs'

export function runTitle(kind, head, version) {
  sha(head)
  return kind === 'quality' ? `dsh-px-quality:${head}` : `dsh-px-build:${head}:${version}`
}
/** Verify the actual default-branch workflow identity, not its freely chosen job/check name. */
export async function trustedRun(api, policy, kind, id, head, version) {
  const expected = kind === 'quality' ? policy.trustedQuality : policy.trustedBuild
  if (!expected || !Number.isSafeInteger(expected.workflowId) || expected.workflowId <= 0)
    throw new Error(`Trusted ${kind} workflow is not configured`)
  const run = await api(`repos/${policy.repository}/actions/runs/${id}`)
  if (
    run.workflow_id !== expected.workflowId ||
    run.path !== expected.path ||
    run.event !== 'workflow_dispatch' ||
    run.head_branch !== policy.branch ||
    run.display_title !== runTitle(kind, head, version) ||
    run.repository?.full_name !== policy.repository ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  )
    throw new Error(`Untrusted or unsuccessful ${kind} workflow run`)
  const branch = await api(`repos/${policy.repository}/branches/${policy.branch}`)
  if (!branch.protected) throw new Error('Trusted controller branch is not protected')
  const comparison = await api(
    `repos/${policy.repository}/compare/${sha(run.head_sha)}...${sha(branch.commit.sha)}`
  )
  if (!['ahead', 'identical'].includes(comparison.status))
    throw new Error('Workflow controller is not from protected branch history')
  if (!expected.files || !Object.keys(expected.files).length || !Object.hasOwn(expected.files, expected.path))
    throw new Error('Trusted controller source hashes are missing')
  for (const [path, digest] of Object.entries(expected.files)) {
    const file = await api(`repos/${policy.repository}/contents/${path}?ref=${run.head_sha}`)
    if (sourceDigest(Buffer.from(file.content, 'base64')) !== digest)
      throw new Error(`Unapproved controller source: ${path}`)
  }
  return {
    runId: run.id,
    runAttempt: run.run_attempt,
    workflowId: run.workflow_id,
    path: run.path,
    targetHead: head,
    controllerSha: run.head_sha,
    conclusion: run.conclusion,
    url: run.html_url
  }
}
export async function findTrustedQuality(api, policy, head) {
  if (!policy.trustedQuality?.workflowId) throw new Error('Trusted quality workflow is not configured')
  for (let page = 1; page <= 20; page++) {
    const data = await api(
      `repos/${policy.repository}/actions/workflows/${policy.trustedQuality.workflowId}/runs?event=workflow_dispatch&branch=${policy.branch}&per_page=100&page=${page}`
    )
    const candidates = data.workflow_runs
      .filter((run) => run.display_title === runTitle('quality', head))
      .sort((a, b) => b.id - a.id)
    if (candidates.length) {
      if (candidates[0].status !== 'completed')
        return {
          pending: true,
          runId: candidates[0].id,
          runAttempt: candidates[0].run_attempt,
          status: candidates[0].status,
          conclusion: candidates[0].conclusion
        }
      if (candidates[0].conclusion !== 'success')
        return {
          failed: true,
          runId: candidates[0].id,
          runAttempt: candidates[0].run_attempt,
          status: candidates[0].status,
          conclusion: candidates[0].conclusion
        }
      return await trustedRun(api, policy, 'quality', candidates[0].id, head)
    }
    if (data.workflow_runs.length < 100) return null
  }
  throw new Error('Trusted quality run search exceeded its bounded history')
}
export function qualityChanged(previous, current) {
  return (
    !previous ||
    previous.runId !== current.id ||
    previous.runAttempt !== current.run_attempt ||
    previous.status !== current.status ||
    previous.conclusion !== current.conclusion
  )
}
