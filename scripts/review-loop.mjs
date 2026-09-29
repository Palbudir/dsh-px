import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonical, sha256 } from './review-core.mjs'
import { REVIEW_PARSER_FILES, verifyReviewParserPayload } from './review-parser.mjs'

const self = fileURLToPath(import.meta.url)
const selfDigest = sha256(readFileSync(self))
export const LOOP_INTERVAL_MS = 120000
const stateName = 'review-loop-state.json',
  stopName = 'review-loop-stop.json',
  stopAckName = 'review-loop-stop-ack.json'
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)

function regularFile(path, optional = false) {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error('Expected a private regular file: ' + basename(path))
  } catch (error) {
    if (!optional || error.code !== 'ENOENT') throw error
  }
}
function json(path) {
  regularFile(path)
  const source = readFileSync(path, 'utf8')
  try {
    return JSON.parse(source)
  } catch {
    throw new Error('Cannot read trusted JSON: ' + basename(path))
  }
}
function optionalJson(path) {
  try {
    return json(path)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
export function saveLoopJson(
  path,
  value,
  {
    rename = renameSync,
    wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    platform = process.platform,
    now = Date.now,
    deadline = Infinity
  } = {}
) {
  regularFile(path, true)
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600, flush: true })
    // Windows readers may briefly deny replacement. Never delete the destination to work around it.
    for (let attempt = 0; ; attempt++) {
      if (now() >= deadline) throw new Error('Control file write deadline expired')
      regularFile(path, true)
      regularFile(temporary)
      try {
        rename(temporary, path)
        break
      } catch (error) {
        if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 9)
          throw error
        wait(Math.min(20, Math.max(0, deadline - now())))
      }
    }
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}
const save = saveLoopJson

/** No repository checkout or mutable candidate scripts may serve as an installation. */
export function verifyLoopInstallation(directory) {
  const root = realpathSync(directory)
  for (let at = root; ; at = dirname(at)) {
    if (existsSync(join(at, '.git')))
      throw new Error('The review loop must be installed outside a Git checkout')
    if (dirname(at) === at) break
  }
  const config = json(join(root, 'worker.json')),
    installation = json(join(root, 'installation.json'))
  const policy = json(join(root, 'public-policy.json'))
  if (
    typeof config.directory !== 'string' ||
    realpathSync(config.directory).toLowerCase() !== root.toLowerCase()
  )
    throw new Error('Trusted installation path mismatch')
  if (
    config.repository !== 'Palbudir/dsh-px' ||
    config.branch !== 'master' ||
    policy.repository !== config.repository ||
    policy.branch !== config.branch
  )
    throw new Error('Trusted worker repository identity mismatch')
  const files = installation.files
  if (
    !files ||
    typeof files !== 'object' ||
    Array.isArray(files) ||
    Object.keys(files).length > 100 ||
    files['review-loop.mjs'] !== selfDigest ||
    !files['review-worker.mjs'] ||
    !files['review-upstream.mjs'] ||
    !files['check-secrets.mjs']
  )
    throw new Error('Install the independently reviewed loop and worker before starting')
  for (const [name, digest] of Object.entries(files)) {
    if (
      (!/^(?:(?:review|release)-[\w-]+|check-secrets)\.mjs$/.test(name) &&
        !Object.hasOwn(REVIEW_PARSER_FILES, name)) ||
      !/^[a-f0-9]{64}$/.test(digest)
    )
      throw new Error('Invalid trusted script manifest')
    const file = join(root, name)
    regularFile(file)
    if (sha256(readFileSync(file)) !== digest)
      throw new Error('Trusted scripts changed; review and reinstall before starting')
  }
  verifyReviewParserPayload(root, files)
  const digest = sha256(canonical(files))
  if (
    digest !== installation.workerDigest ||
    digest !== config.workerDigest ||
    digest !== policy.workerDigest
  )
    throw new Error('Worker installation digest mismatch')
  // workerDigest continues to identify code only. A running loop also binds the
  // complete configuration and policy, without logging their potentially private values.
  const identity = sha256(canonical({ workerDigest: digest, config, policy }))
  return { directory: root, worker: join(root, 'review-worker.mjs'), digest, identity }
}

/** Separate from worker-lock.sqlite so the normal worker can acquire its own lease. */
export function acquireLoopLock(directory) {
  const file = join(directory, 'review-loop-lock.sqlite')
  regularFile(file, true)
  const lock = new DatabaseSync(file)
  try {
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
  } catch (error) {
    lock.close()
    if (error.errcode === 5 || error.errcode === 6) return null
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try {
      lock.exec('ROLLBACK')
    } finally {
      lock.close()
    }
  }
}

/** Drain the child before reporting its real result; an abort never abandons it. */
export function runInstalledWorker(installation, { spawnChild = spawn, maxLogBytes = 2 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxLogBytes) || maxLogBytes < 1) throw new Error('Invalid log limit')
  const file = join(installation.directory, 'worker-latest.log')
  regularFile(file, true)
  const fd = openSync(file, 'w', 0o600)
  return new Promise((resolveResult, reject) => {
    let written = 0,
      truncated = false,
      logError,
      settled = false
    const log = (chunk) => {
      if (logError) return
      try {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const keep = Math.min(bytes.length, Math.max(0, maxLogBytes - written))
        if (keep) {
          writeSync(fd, bytes.subarray(0, keep))
          written += keep
        }
        if (keep < bytes.length && !truncated) {
          truncated = true
          writeSync(fd, '\n[review-loop] Further output omitted from latest log.\n')
        }
      } catch (error) {
        logError = error
      }
    }
    const finish = (code, signal, error) => {
      if (settled) return
      settled = true
      const result = {
        exitCode: Number.isInteger(code) && code >= 0 ? (code === 0 && (error || signal) ? 1 : code) : 1,
        signal: signal ?? null,
        ...(error ? { error: String(error.message ?? error).slice(0, 1000) } : {})
      }
      try {
        writeSync(fd, '\n[review-loop] ' + JSON.stringify(result) + '\n')
        closeSync(fd)
      } catch (failure) {
        logError ??= failure
        try {
          closeSync(fd)
        } catch {}
      }
      if (logError) reject(new Error('Worker finished, but its latest log could not be saved'))
      else resolveResult(result)
    }
    log('[review-loop] Started ' + new Date().toISOString() + '\n')
    if (logError) {
      closeSync(fd)
      reject(new Error('Cannot initialize worker log'))
      return
    }
    try {
      const child = spawnChild(process.execPath, [installation.worker, '--publish'], {
        cwd: installation.directory,
        env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let childError
      child.stdout?.on('data', log)
      child.stderr?.on('data', log)
      child.stdout?.on('error', (error) => {
        logError ??= error
      })
      child.stderr?.on('error', (error) => {
        logError ??= error
      })
      child.once('error', (error) => {
        childError = error
      })
      child.once('close', (code, signal) => finish(code, signal, childError))
    } catch (error) {
      finish(null, null, error)
    }
  })
}

async function waitInterval(milliseconds, shouldStop) {
  const deadline = Date.now() + milliseconds
  while (!shouldStop() && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, Math.min(500, Math.max(1, deadline - Date.now()))))
}

/** Sequential polling; fatal identity/I/O errors stop without manufacturing a review/check. */
export async function runReviewLoop(
  { directory, once = false, signal, intervalMs = LOOP_INTERVAL_MS },
  { invoke = runInstalledWorker, wait = waitInterval } = {}
) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new Error('Invalid loop interval')
  const installation = verifyLoopInstallation(directory)
  const unlock = acquireLoopLock(installation.directory)
  if (!unlock) return { busy: true, runs: 0, exitCode: 0 }
  const instanceId = randomUUID(),
    statePath = join(installation.directory, stateName)
  let runs = 0,
    lastWorker = null,
    phase = 'starting',
    stopReceipt = null,
    controlError,
    controlTimer
  const shouldStop = () => signal?.aborted || stopReceipt !== null || controlError !== undefined
  const verifyIdentity = () => {
    if (verifyLoopInstallation(installation.directory).identity !== installation.identity)
      throw new Error(
        'Installation identity changed; verify configuration and policy before restarting the loop'
      )
  }
  const state = (nextPhase, extra = {}) => {
    phase = nextPhase
    save(statePath, {
      instanceId,
      pid: process.pid,
      digest: installation.digest,
      installationIdentity: installation.identity,
      phase,
      runs,
      lastWorker,
      ...(stopReceipt ? { stopReceipt } : {}),
      updatedAt: new Date().toISOString(),
      ...extra
    })
  }
  // Only the process holding this loop lease can acknowledge its current instance.
  // Poll while a worker is active so delivery confirmation does not cancel that worker.
  const receiveStop = () => {
    try {
      const request = optionalJson(join(installation.directory, stopName))
      if (
        !request ||
        request.instanceId !== instanceId ||
        !uuid(request.requestId) ||
        request.requestId === stopReceipt?.requestId
      )
        return
      const now = Date.now(),
        issued = Date.parse(request.requestedAt),
        expires = Date.parse(request.expiresAt)
      if (
        !Number.isFinite(issued) ||
        !Number.isFinite(expires) ||
        issued > now + 5000 ||
        expires < now ||
        expires <= issued ||
        expires - issued > 60000
      )
        return
      const receipt = { instanceId, requestId: request.requestId, acceptedAt: new Date().toISOString() }
      save(join(installation.directory, stopAckName), receipt)
      stopReceipt = receipt
      state(phase)
    } catch (error) {
      controlError = error
      clearInterval(controlTimer)
    }
  }
  try {
    state('starting')
    controlTimer = setInterval(receiveStop, 50)
    receiveStop()
    while (!shouldStop()) {
      verifyIdentity()
      state('running')
      lastWorker = await invoke(installation)
      runs++
      verifyIdentity()
      if (once || shouldStop()) break
      state('waiting')
      await wait(intervalMs, shouldStop)
    }
    if (controlError) throw controlError
    state('stopped')
    return { busy: false, runs, exitCode: once ? (lastWorker?.exitCode ?? 0) : 0, lastWorker }
  } catch (error) {
    try {
      state('stopped', { error: String(error.message ?? error).slice(0, 1000) })
    } catch {}
    throw error
  } finally {
    clearInterval(controlTimer)
    unlock()
  }
}

/** Request a graceful stop of this instance; the currently running worker is allowed to finish. */
export async function requestLoopStop(directory, { timeoutMs = 3000, pollMs = 50 } = {}) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60000 ||
    !Number.isSafeInteger(pollMs) ||
    pollMs < 1
  )
    throw new Error('Invalid stop acknowledgement timeout')
  const installation = verifyLoopInstallation(directory)
  const unlock = acquireLoopLock(installation.directory)
  if (unlock) {
    unlock()
    return { requested: false, reason: 'not-running' }
  }
  const state = json(join(installation.directory, stateName))
  if (!uuid(state.instanceId) || !['starting', 'running', 'waiting'].includes(state.phase))
    throw new Error('Loop is changing state; retry the stop request')
  const requestId = randomUUID(),
    now = Date.now(),
    deadline = now + timeoutMs
  save(
    join(installation.directory, stopName),
    {
      instanceId: state.instanceId,
      requestId,
      requestedAt: new Date(now).toISOString(),
      expiresAt: new Date(deadline).toISOString()
    },
    { deadline }
  )
  while (Date.now() <= deadline) {
    const current = optionalJson(join(installation.directory, stateName))
    if (current?.instanceId !== state.instanceId)
      throw new Error('Loop instance changed; the stop request was not confirmed. Check state and retry.')
    const receipt = optionalJson(join(installation.directory, stopAckName))
    const acceptedAt = Date.parse(receipt?.acceptedAt)
    if (
      receipt?.instanceId === state.instanceId &&
      receipt.requestId === requestId &&
      Number.isFinite(acceptedAt) &&
      acceptedAt >= now &&
      acceptedAt <= deadline
    )
      return {
        requested: true,
        ...receipt,
        message:
          'The named loop instance acknowledged the request and will exit after its current worker finishes.'
      }
    const pending = optionalJson(join(installation.directory, stopName))
    if (pending?.requestId !== requestId || pending.instanceId !== state.instanceId)
      throw new Error('Stop request was superseded and not confirmed. Check state and retry.')
    if (current.phase === 'stopped') break
    await new Promise((done) => setTimeout(done, Math.min(pollMs, Math.max(1, deadline - Date.now()))))
  }
  throw new Error('Stop request was not acknowledged by its loop owner. Check state before retrying.')
}

export async function main(args = process.argv.slice(2), directory = dirname(self)) {
  if (!args.length) {
    console.log('Not started. Use --publish [--once] to run, or --stop to stop after the current worker.')
    return 0
  }
  if (args.length === 1 && args[0] === '--stop') {
    console.log(JSON.stringify(await requestLoopStop(directory)))
    return 0
  }
  if (
    !args.includes('--publish') ||
    args.some((arg) => !['--publish', '--once'].includes(arg)) ||
    new Set(args).size !== args.length
  )
    throw new Error(
      'Use --publish [--once], or --stop; no worker path or credentials are accepted as arguments'
    )
  const controller = new AbortController(),
    stop = () => controller.abort()
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    const result = await runReviewLoop({
      directory,
      once: args.includes('--once'),
      signal: controller.signal
    })
    console.log(JSON.stringify(result))
    return result.exitCode
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}
if (process.argv[1] && resolve(process.argv[1]) === self) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error('[review-loop] ' + String(error.message ?? error))
    process.exitCode = 1
  }
}
