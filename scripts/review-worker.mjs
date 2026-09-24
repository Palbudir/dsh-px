import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, renameSync } from 'node:fs'
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
  decodeSource
} from './review-core.mjs'
import { command, runReviewBatch } from './review-process.mjs'
import { createAppClient } from './review-app.mjs'
import { publishReview, publishQuality, settleQuality } from './review-verify.mjs'
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
  sha(await git(['rev-parse', request.head + '^{commit}']))
  const mergeBase = sha(await git(['merge-base', request.base, request.head]))
  const names = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    .decode(await git(['diff', '--name-only', '--no-renames', '-z', mergeBase, request.head], true, true))
    .split('\0')
    .filter(Boolean)
  const readBlob = async (ref, path) => {
    if (!(await git(['ls-tree', ref, '--', path]))) return ''
    return decodeSource(await git(['show', `${ref}:${path}`], true, true), path)
  }
  const files = []
  for (const path of names) {
    const before = await readBlob(mergeBase, path),
      after = await readBlob(request.head, path)
    files.push({ path, before, after, binary: before.includes('\0') || after.includes('\0') })
  }
  const tree = sha(await git(['rev-parse', request.head + '^{tree}']))
  const contextFiles = ['README.md', 'package.json', 'config/plugins.json', 'docs/STATUS.md']
  const context =
    `Repository: ${config.repository}\nBase: ${request.base}\nMerge base: ${mergeBase}\nHead: ${request.head}\nChanged paths: ${JSON.stringify(names)}\n` +
    (
      await Promise.all(
        contextFiles.map(async (path) => `CONTEXT ${path}\n${await readBlob(request.head, path)}`)
      )
    ).join('\n')
  const batches = splitBatches(files, context, config.maxBatchChars ?? 120000)
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
    filesDigest: sha256(
      canonical(files.map((f) => ({ path: f.path, before: sha256(f.before), after: sha256(f.after) })))
    )
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
    const activeHeads = new Set()
    for (let page = 1; page <= 100; page++) {
      const branches = await gh(`repos/${config.repository}/branches?per_page=100&page=${page}`)
      for (const branch of branches) activeHeads.add(branch.commit.sha)
      if (branches.length < 100) break
      if (page === 100) throw new Error('Active branch audit limit reached')
    }
    for (const record of Object.values(state))
      if (record.monitorQuality && !activeHeads.has(record.head)) delete record.monitorQuality
    const saveState = () => {
      const temporary = statePath + '.' + randomUUID() + '.tmp'
      writeFileSync(temporary, JSON.stringify(state, null, 2), { flush: true, mode: 0o600 })
      renameSync(temporary, statePath)
    }
    const keyOf = (run) => `${run.id}-${run.run_attempt ?? 1}`
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
    const selected = runs
      .filter(
        (r) =>
          r.conclusion === 'success' &&
          (rerun
            ? String(r.id) === rerun
            : (!state[keyOf(r)]?.complete || state[keyOf(r)]?.monitorQuality) &&
              (state[keyOf(r)]?.retryAt ?? 0) <= Date.now())
      )
      .sort(
        (a, b) =>
          Number(Boolean(state[keyOf(a)]?.monitorQuality)) -
            Number(Boolean(state[keyOf(b)]?.monitorQuality)) ||
          (state[keyOf(a)]?.retryAt ?? 0) - (state[keyOf(b)]?.retryAt ?? 0) ||
          a.id - b.id
      )
    for (const run of selected.slice(0, Number(process.env.DSH_PX_REVIEW_MAX_JOBS ?? 1))) {
      const directory = join(root, 'jobs', keyOf(run))
      mkdirSync(directory, { recursive: true })
      let request
      try {
        const previous = state[keyOf(run)]
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
          const pr = await gh(`repos/${config.repository}/pulls/${request.pullRequest}`)
          if (pr.head.repo?.full_name !== config.repository)
            throw new Error('Fork PRs require explicit maintainer import into a local branch')
          if (pr.head.sha !== request.head) {
            state[keyOf(run)] = { complete: true, obsolete: true }
            saveState()
            continue
          }
          request.base = sha(pr.base.sha)
        } else if (request.head !== run.head_sha) throw new Error('Push request SHA mismatch')
        else if (run.head_branch !== config.branch) {
          request.base = sha((await gh(`repos/${config.repository}/branches/${config.branch}`)).commit.sha)
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
        let finished = false,
          monitorQuality
        if (appApi) {
          const review = await publishReview(report, policy, appApi)
          if (review.conclusion !== 'success') {
            await publishQuality(
              policy,
              appApi,
              request.head,
              null,
              'Independent source review must pass before quality admission.'
            )
            finished = !review.retryable
          } else {
            const settled = await settleQuality(policy, appApi, request.head, () =>
              gh(
                `repos/${config.repository}/actions/workflows/${policy.trustedQuality.workflowId}/dispatches`,
                { method: 'POST', body: { ref: config.branch, inputs: { head: request.head } } }
              )
            )
            finished = settled.finished
            monitorQuality = settled.monitorQuality
            if (settled.error) process.exitCode = 1
          }
        }
        state[keyOf(run)] = {
          complete: finished,
          verdict: payload.verdict,
          head: request.head,
          base: request.base,
          retryAt: Date.now() + (appApi ? 60000 : 300000),
          monitorQuality,
          workerDigest: config.workerDigest
        }
        console.log(
          JSON.stringify({
            runId: run.id,
            head: request.head,
            verdict: payload.verdict,
            published: publishing,
            complete: finished
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
            await publishQuality(policy, appApi, state[keyOf(run)].head, null, String(error).slice(0, 1000))
          } catch {
            /* The existing check cannot be changed while GitHub is unreachable; retry the monitor. */
          }
        }
        if (request && appApi) {
          try {
            const problem = String(error).slice(0, 500)
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
