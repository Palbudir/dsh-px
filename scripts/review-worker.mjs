import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
  renameSync,
  unlinkSync
} from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonical,
  sha256,
  sha,
  aggregate,
  attest,
  encodeReport,
  splitBatches,
  requestFromZip,
  validateRequest,
  verifyAttestation,
  collectReviewContext,
  parseReviewTree
} from './review-core.mjs'
import { command, runReviewBatch } from './review-process.mjs'
import { createAppClient } from './review-app.mjs'
import { PUBLIC_REVIEW_FAILURE, publishReview, publishQuality, settleQuality } from './review-verify.mjs'
import { findTrustedQuality, qualityChanged } from './review-trusted-ci.mjs'

/** An OS-backed SQLite lock is released even if the worker process crashes. */
export function acquireReviewLock(directory) {
  const lock = new DatabaseSync(join(directory, 'worker-lock.sqlite'))
  try {
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
  } catch {
    lock.close()
    return null
  }
  return () => {
    lock.exec('ROLLBACK')
    lock.close()
  }
}

export const reviewRunKey = (run) => `${run.id}-${run.run_attempt ?? 1}`

/** Only a complete branch inventory may prove that a push's branch was deleted. */
export async function readBranchHeads(api, repository) {
  const heads = new Map()
  for (let page = 1; page <= 100; page++) {
    const branches = await api(`repos/${repository}/branches?per_page=100&page=${page}`)
    if (!Array.isArray(branches)) throw new Error('Invalid branch inventory')
    for (const branch of branches) {
      if (typeof branch.name !== 'string' || !branch.name) throw new Error('Invalid branch identity')
      heads.set(branch.name, sha(branch.commit?.sha))
    }
    if (branches.length < 100) return heads
  }
  throw new Error('Active branch audit limit reached')
}

/** Branch identity matters: the same SHA on another branch does not keep an old push current. */
function obsoletePush(run, branchHeads) {
  if (run.event !== 'push') return null
  if (typeof run.head_branch !== 'string' || !run.head_branch) throw new Error('Invalid push branch')
  const head = sha(run.head_sha)
  const currentHead = branchHeads.get(run.head_branch)
  if (currentHead === undefined) return { head, currentHead: null, reason: 'branch-deleted' }
  if (sha(currentHead) !== head) return { head, currentHead, reason: 'head-superseded' }
  return null
}

function retireReviewRun(state, run, obsolete, now) {
  const key = reviewRunKey(run),
    previous = state[key]
  if (
    previous?.obsolete &&
    previous.obsoleteReason === obsolete.reason &&
    previous.observedHead === obsolete.currentHead &&
    previous.integratedInto === obsolete.integratedInto
  )
    return
  state[key] = {
    complete: true,
    obsolete: true,
    obsoleteReason: obsolete.reason,
    branch: run.head_branch,
    head: obsolete.head,
    observedHead: obsolete.currentHead,
    ...(obsolete.integratedInto ? { integratedInto: obsolete.integratedInto } : {}),
    settledAt: now,
    priorState: previous?.obsolete ? previous.priorState : previous
  }
}

/** Retire obsolete pushes before applying the job budget; retirement is not a review verdict. */
export function selectReviewRuns(runs, state, branchHeads, { rerun, now = Date.now() } = {}) {
  for (const run of runs) {
    if (run.conclusion !== 'success' || (rerun && String(run.id) !== rerun)) continue
    const key = reviewRunKey(run),
      previous = state[key]
    if (!rerun && previous?.complete && !previous.monitorQuality) continue
    const obsolete = obsoletePush(run, branchHeads)
    if (!obsolete) continue
    retireReviewRun(state, run, obsolete, now)
  }
  return runs
    .filter(
      (run) =>
        run.conclusion === 'success' &&
        !obsoletePush(run, branchHeads) &&
        (rerun
          ? String(run.id) === rerun
          : (!state[reviewRunKey(run)]?.complete || state[reviewRunKey(run)]?.monitorQuality) &&
            (state[reviewRunKey(run)]?.retryAt ?? 0) <= now)
    )
    .sort(
      (a, b) =>
        Number(Boolean(state[reviewRunKey(a)]?.monitorQuality)) -
          Number(Boolean(state[reviewRunKey(b)]?.monitorQuality)) ||
        (state[reviewRunKey(a)]?.retryAt ?? 0) - (state[reviewRunKey(b)]?.retryAt ?? 0) ||
        a.id - b.id
    )
}

/** A retained branch may already be merged. Compare immutable SHAs before it consumes a job slot. */
export async function selectCurrentReviewRuns(api, config, runs, state, branchHeads, options = {}) {
  const now = options.now ?? Date.now()
  const selected = selectReviewRuns(runs, state, branchHeads, { ...options, now })
  const current = []
  const comparisons = new Map()
  for (const run of selected) {
    if (run.event === 'push' && run.head_branch !== config.branch) {
      const head = sha(run.head_sha),
        master = sha(branchHeads.get(config.branch))
      if (!comparisons.has(head)) {
        const comparison = await api(`repos/${config.repository}/compare/${head}...${master}`)
        const mergeBase = sha(comparison?.merge_base_commit?.sha)
        if (
          comparison?.base_commit?.sha !== head ||
          !['ahead', 'behind', 'diverged', 'identical'].includes(comparison.status)
        )
          throw new Error('Invalid push ancestry comparison')
        let integrated = false
        if (comparison.status === 'ahead' || comparison.status === 'identical') {
          if (
            mergeBase !== head ||
            comparison.behind_by !== 0 ||
            (comparison.status === 'identical'
              ? head !== master || comparison.ahead_by !== 0
              : !Number.isSafeInteger(comparison.ahead_by) || comparison.ahead_by <= 0)
          )
            throw new Error('Inconsistent push ancestry comparison')
          integrated = true
        }
        comparisons.set(head, integrated)
      }
      if (comparisons.get(head)) {
        retireReviewRun(
          state,
          run,
          { head, currentHead: head, reason: 'already-integrated', integratedInto: master },
          now
        )
        continue
      }
    }
    current.push(run)
  }
  return current
}

export function pushReviewBase(request, run, branchHeads, branch) {
  if (run.event !== 'push' || request.head !== run.head_sha) throw new Error('Push request SHA mismatch')
  if (obsoletePush(run, branchHeads)) throw new Error('Push request is no longer current')
  // A current default-branch push reviews against its recorded parent, never against itself.
  return sha(run.head_branch === branch ? request.base : branchHeads.get(branch))
}

/** Check current PR metadata before cached reviews, quality monitoring or model/publication work. */
export async function admitPullRequest(api, config, run, request, state, { now = Date.now() } = {}) {
  if (
    request.kind !== 'pull_request' ||
    !Number.isSafeInteger(request.pullRequest) ||
    request.pullRequest < 1 ||
    request.runId !== run.id ||
    request.runAttempt !== (run.run_attempt ?? 1)
  )
    throw new Error('Invalid pull request admission identity')
  const pr = await api(`repos/${config.repository}/pulls/${request.pullRequest}`)
  if (
    pr?.number !== request.pullRequest ||
    pr.base?.repo?.full_name !== config.repository ||
    !['open', 'closed'].includes(pr.state)
  )
    throw new Error('Invalid or unknown current pull request metadata')
  const observedHead = sha(pr.head?.sha),
    currentBase = sha(pr.base.sha)
  if (pr.state === 'open' && pr.head.repo?.full_name !== config.repository)
    throw new Error('Fork PRs require explicit maintainer import into a local branch')
  const reason =
    pr.state === 'closed' ? 'pull-request-closed' : observedHead !== request.head ? 'head-superseded' : null
  if (reason) {
    const key = reviewRunKey(run),
      previous = state[key]
    if (
      !previous?.obsolete ||
      previous.obsoleteReason !== reason ||
      previous.pullRequest !== request.pullRequest ||
      previous.observedHead !== observedHead
    )
      state[key] = {
        complete: true,
        obsolete: true,
        obsoleteReason: reason,
        pullRequest: request.pullRequest,
        head: request.head,
        observedHead,
        observedState: pr.state,
        settledAt: now,
        priorState: previous?.obsolete ? previous.priorState : previous
      }
    return false
  }
  request.base = currentBase
  return true
}

/** Prepare exact Git source and complete bounded context without invoking the model. */
export async function prepareReviewSnapshot(config, request, git) {
  sha(await git(['rev-parse', request.head + '^{commit}']))
  sha(await git(['rev-parse', request.base + '^{commit}']))
  const mergeBase = sha(await git(['merge-base', request.base, request.head]))
  const names = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    .decode(await git(['diff', '--name-only', '--no-renames', '-z', mergeBase, request.head], true, true))
    .split('\0')
    .filter(Boolean)
  const snapshot = await collectReviewContext(
    { ...request, repository: config.repository, mergeBase, names },
    {
      list: async (ref) => parseReviewTree(await git(['ls-tree', '-r', '-l', '-z', ref], true, true)),
      read: (ref, path) => git(['show', `${ref}:${path}`], true, true)
    },
    config.contextLimits
  )
  const batches = splitBatches(snapshot.files, snapshot.context, config.maxBatchChars ?? 500000)
  return { ...snapshot, batches, mergeBase, tree: sha(await git(['rev-parse', request.head + '^{tree}'])) }
}

export async function reviewSnapshot(config, request, directory, invoke = runReviewBatch) {
  const mirror = join(config.directory, 'mirror.git')
  const git = (args, raw = false, binary = false) =>
    command(
      config.git,
      [
        '-c',
        'core.hooksPath=' + join(config.directory, 'empty-hooks'),
        '-c',
        'core.attributesFile=' + join(config.directory, 'empty-attributes'),
        '-c',
        'diff.external=',
        '-c',
        'protocol.file.allow=never',
        '-c',
        'protocol.ext.allow=never',
        '--git-dir',
        mirror,
        ...args
      ],
      { maxBytes: 64000000, trim: !raw, binary }
    )
  if (!existsSync(mirror)) await command(config.git, ['init', '--bare', mirror])
  await git([
    'fetch',
    '--no-tags',
    '--force',
    `https://github.com/${config.repository}.git`,
    request.head,
    request.base
  ])
  const { files, batches, tree, mergeBase, context, identities, projections, metrics } =
    await prepareReviewSnapshot(config, request, git)
  writeFileSync(
    join(directory, 'source-context.json'),
    JSON.stringify(
      {
        head: request.head,
        base: request.base,
        mergeBase,
        metrics,
        contextDigest: sha256(context),
        sources: identities,
        projections,
        batches: batches.map((batch) => ({ id: batch.id, chars: batch.text.length }))
      },
      null,
      2
    )
  )
  const results = []
  for (const batch of batches) {
    results.push(await invoke(config, request, batch, directory))
    writeFileSync(
      join(directory, 'progress.json'),
      JSON.stringify({ head: request.head, completed: results.length, total: batches.length })
    )
  }
  return {
    ...aggregate(request, batches, results),
    tree,
    mergeBase,
    contextDigest: sha256(context),
    filesDigest: sha256(
      canonical(files.map((f) => ({ path: f.path, before: sha256(f.before), after: sha256(f.after) })))
    )
  }
}

function savePublicationStatus(directory, status) {
  const target = join(directory, 'publication-status.json'),
    temporary = target + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, JSON.stringify(status, null, 2), { flag: 'wx', flush: true, mode: 0o600 })
    renameSync(temporary, target)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

/** Publication failures are local operational evidence, separate from the signed source verdict. */
export async function publishReviewRequest({ report, policy, api, dispatch, directory }) {
  let phase = 'review-publication'
  const errors = []
  const identity = {
    head: report.payload.head,
    base: report.payload.base,
    sourceVerdict: report.payload.verdict
  }
  const recordError = (reason) => {
    errors.push({ phase, reason: String(reason).slice(0, 4000), at: Date.now() })
    savePublicationStatus(directory, { ...identity, phase, status: 'failed', errors })
  }
  const finish = (result) => {
    if (!errors.length)
      savePublicationStatus(directory, {
        ...identity,
        phase,
        status: result.finished ? 'settled' : 'pending',
        monitorQuality: result.monitorQuality,
        errors: [],
        updatedAt: Date.now()
      })
    return {
      ...result,
      ...(errors.length ? { error: errors.at(-1).reason, errorPhase: errors.at(-1).phase } : {})
    }
  }
  try {
    const review = await publishReview(report, policy, api)
    if (review.conclusion !== 'success') {
      recordError(review.problem)
      phase = 'quality-admission'
      await publishQuality(
        policy,
        api,
        report.payload.head,
        null,
        'Independent source review must pass before quality admission.'
      )
      return finish({ finished: !review.retryable })
    }
    phase = 'quality-publication'
    const settled = await settleQuality(policy, api, report.payload.head, async () => {
      phase = 'quality-dispatch'
      const result = await dispatch()
      phase = 'quality-publication'
      return result
    })
    if (settled.error) recordError(settled.error)
    return finish({ finished: settled.finished, monitorQuality: settled.monitorQuality })
  } catch (error) {
    recordError(error)
    throw error
  }
}

async function main() {
  const root = dirname(fileURLToPath(import.meta.url))
  if (!existsSync(join(root, 'installation.json')) || !existsSync(join(root, 'worker.json')))
    throw new Error('Run the installed trusted worker, not repository scripts')
  const config = JSON.parse(readFileSync(join(root, 'worker.json'), 'utf8'))
  if (realpathSync(root).toLowerCase() !== config.directory.toLowerCase())
    throw new Error('Trusted installation path mismatch')
  const installation = JSON.parse(readFileSync(join(root, 'installation.json'), 'utf8'))
  for (const [path, digest] of Object.entries(installation.files))
    if (sha256(readFileSync(join(root, path))) !== digest)
      throw new Error('Trusted worker changed; reinstall after independent review')
  if (sha256(canonical(installation.files)) !== config.workerDigest)
    throw new Error('Worker installation digest mismatch')
  if ((await command(config.codex, ['--version'])) !== config.cliVersion)
    throw new Error('Codex CLI changed; repeat capability and fixture validation before reinstalling')
  const gh = async (route, options = {}) => {
    const args = ['api', route]
    if (options.method) args.push('--method', options.method)
    if (options.body) args.push('--input', '-')
    const value = await command(config.gh, args, {
      input: options.body ? JSON.stringify(options.body) : undefined,
      binary: options.binary
    })
    return options.binary ? value : value ? JSON.parse(value) : null
  }
  const actual = await gh('user')
  if (actual.login !== config.publisher)
    throw new Error('Authenticated publisher differs from trusted installation')
  const policy = JSON.parse(readFileSync(join(root, 'public-policy.json'), 'utf8'))
  const publishing = process.argv.includes('--publish')
  if (publishing && config.githubApp?.appId !== policy.reviewAppId)
    throw new Error('Configured review App does not match trusted policy')
  const appApi = publishing ? await createAppClient(config) : undefined
  const unlock = acquireReviewLock(root)
  if (!unlock) {
    console.log(JSON.stringify({ busy: true }))
    return
  }
  try {
    mkdirSync(join(root, 'empty-hooks'), { recursive: true })
    writeFileSync(join(root, 'empty-attributes'), '')
    const statePath = join(root, 'queue-state.json')
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
    const branchHeads = await readBranchHeads(gh, config.repository)
    const activeHeads = new Set(branchHeads.values())
    for (const record of Object.values(state))
      if (record.monitorQuality && !activeHeads.has(record.head)) delete record.monitorQuality
    const saveState = () => {
      const temporary = statePath + '.' + randomUUID() + '.tmp'
      writeFileSync(temporary, JSON.stringify(state, null, 2), { flush: true, mode: 0o600 })
      renameSync(temporary, statePath)
    }
    const keyOf = reviewRunKey
    const rerun = process.argv.find((arg) => arg.startsWith('--rerun='))?.slice('--rerun='.length)
    const runs = []
    for (let page = 1; page <= 100; page++) {
      const data = await gh(
        `repos/${config.repository}/actions/workflows/review-request.yml/runs?per_page=100&page=${page}&status=completed`
      )
      runs.push(...data.workflow_runs)
      if (
        data.workflow_runs.length < 100 ||
        (!rerun &&
          data.workflow_runs.every((r) => state[keyOf(r)]?.complete && !state[keyOf(r)]?.monitorQuality))
      )
        break
      if (page === 100) throw new Error('Review backlog exceeds one scan; no requests were silently dropped')
    }
    const selected = await selectCurrentReviewRuns(gh, config, runs, state, branchHeads, { rerun })
    saveState() // Obsolete-only batches must also settle durably, without publishing a check.
    for (const run of selected.slice(0, Number(process.env.DSH_PX_REVIEW_MAX_JOBS ?? 1))) {
      const directory = join(root, 'jobs', keyOf(run))
      mkdirSync(directory, { recursive: true })
      let request
      try {
        const previous = state[keyOf(run)]
        const artifacts = await gh(`repos/${config.repository}/actions/runs/${run.id}/artifacts`)
        const artifact = artifacts.artifacts.find(
          (a) => a.name === `review-request-${run.run_attempt ?? 1}` && !a.expired
        )
        if (!artifact) throw new Error('Review request artifact is missing or expired')
        request = validateRequest(
          requestFromZip(
            await gh(`repos/${config.repository}/actions/artifacts/${artifact.id}/zip`, { binary: true })
          ),
          config.repository
        )
        if (request.runId !== run.id || request.runAttempt !== (run.run_attempt ?? 1))
          throw new Error('Review request run mismatch')
        if (request.kind === 'pull_request') {
          if (!(await admitPullRequest(gh, config, run, request, state))) {
            saveState()
            continue
          }
        } else request.base = pushReviewBase(request, run, branchHeads, config.branch)
        if (!rerun && previous?.monitorQuality && previous.workerDigest === config.workerDigest) {
          const latest = await findTrustedQuality(gh, policy, previous.head)
          if (!latest) throw new Error('The monitored trusted quality run is no longer available')
          const current = {
            id: latest.runId,
            run_attempt: latest.runAttempt,
            status: latest.status ?? 'completed',
            conclusion: latest.conclusion
          }
          if (!previous.monitorError && !qualityChanged(previous.monitorQuality, current)) {
            previous.retryAt = Date.now() + 60000
            saveState()
            continue
          }
        }
        // No new shell, repository script, package lifecycle, or model credential exists in the source snapshot.
        const cachePath = join(
          root,
          'cache-' +
            sha256(
              canonical({
                head: request.head,
                base: request.base,
                workerDigest: config.workerDigest,
                model: config.codexOverrides
              })
            ) +
            '.json'
        )
        let cached
        if (!rerun && existsSync(cachePath)) {
          try {
            cached = verifyAttestation(
              JSON.parse(readFileSync(cachePath, 'utf8')),
              JSON.parse(readFileSync(join(root, 'public-policy.json'), 'utf8')),
              { head: request.head, base: request.base }
            )
          } catch {
            /* A cache never weakens the validation of a new independent review. */
          }
        }
        const result = cached ?? (await reviewSnapshot(config, request, directory))
        const payload = {
          version: 1,
          repository: config.repository,
          publisher: config.publisher,
          workerDigest: config.workerDigest,
          head: request.head,
          base: request.base,
          completedAt: cached?.completedAt ?? Date.now(),
          reviewer: {
            cliVersion: await command(config.codex, ['--version']),
            configurationDigest: sha256(canonical(config.codexOverrides))
          },
          ...result,
          requestRunId: run.id,
          requestAttempt: run.run_attempt ?? 1
        }
        const report = attest(payload, config.keyId, readFileSync(join(root, 'signing-key.pem')))
        if (payload.verdict === 'pass') writeFileSync(cachePath, JSON.stringify(report), { mode: 0o600 })
        writeFileSync(join(directory, 'attestation.json'), JSON.stringify(report, null, 2))
        const encoded = encodeReport(report)
        const publication = appApi
          ? await publishReviewRequest({
              report,
              policy,
              api: appApi,
              directory,
              dispatch: () =>
                gh(
                  `repos/${config.repository}/actions/workflows/${policy.trustedQuality.workflowId}/dispatches`,
                  { method: 'POST', body: { ref: config.branch, inputs: { head: request.head } } }
                )
            })
          : { finished: false }
        if (publication.error) process.exitCode = 1
        state[keyOf(run)] = {
          complete: publication.finished,
          verdict: payload.verdict,
          head: request.head,
          base: request.base,
          retryAt: Date.now() + (appApi ? 60000 : 300000),
          monitorQuality: publication.monitorQuality,
          workerDigest: config.workerDigest,
          ...(publication.error
            ? { error: publication.error, errorPhase: publication.errorPhase, monitorError: true }
            : {})
        }
        console.log(
          JSON.stringify({
            runId: run.id,
            head: request.head,
            verdict: payload.verdict,
            published: publishing,
            complete: publication.finished
          })
        )
      } catch (error) {
        state[keyOf(run)] = {
          ...state[keyOf(run)],
          complete: false,
          monitorError: true,
          retryAt: Date.now() + 300000,
          error: String(error).slice(0, 500)
        }
        console.error(JSON.stringify({ runId: run.id, state: 'failed', error: String(error).slice(0, 500) }))
        process.exitCode = 1
        if (!request && appApi && state[keyOf(run)].head) {
          try {
            await publishQuality(policy, appApi, state[keyOf(run)].head, null, PUBLIC_REVIEW_FAILURE)
          } catch {
            /* The existing check cannot be changed while GitHub is unreachable; retry the monitor. */
          }
        }
        if (request && appApi) {
          try {
            const problem = PUBLIC_REVIEW_FAILURE
            const report = attest(
              {
                version: 1,
                repository: config.repository,
                publisher: config.publisher,
                workerDigest: config.workerDigest,
                head: request.head,
                base: request.base,
                requestRunId: run.id,
                requestAttempt: run.run_attempt ?? 1,
                completedAt: Date.now(),
                verdict: 'fail',
                findings: [],
                blockers: [problem],
                batches: [{ id: 'worker-failure', digest: sha256(problem) }]
              },
              config.keyId,
              readFileSync(join(root, 'signing-key.pem'))
            )
            await publishReview(report, policy, appApi)
          } catch {
            console.error('Could not publish worker failure; the required review remains missing or pending.')
          }
        }
      }
      saveState()
    }
    if (!selected.length) console.log(JSON.stringify({ pending: 0 }))
  } finally {
    unlock()
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
