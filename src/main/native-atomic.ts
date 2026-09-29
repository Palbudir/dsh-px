import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'

// Same bounded cadence as the native @deepseek-ai/dsh-atomic-write rename (8 retries, 20ms doubling to 200ms).
const TRANSIENT_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])
const RETRY_LIMIT = 8
const RETRY_INITIAL_MS = 20
const RETRY_MAX_MS = 200

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Run a filesystem operation, retrying Windows transient interference (antivirus, indexers, open handles).
 * @param operation - synchronous step whose failure may be transient.
 * @param windows - whether transient Windows codes are retried; tests pass true on any platform.
 * @returns the operation result.
 */
export function retryTransient<T>(operation: () => T, windows = process.platform === 'win32'): T {
  let delay = RETRY_INITIAL_MS
  for (let retries = 0; ; retries++) {
    try {
      return operation()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code ?? ''
      if (!windows || !TRANSIENT_CODES.has(code) || retries >= RETRY_LIMIT) throw error
    }
    sleepSync(delay)
    delay = Math.min(delay * 2, RETRY_MAX_MS)
  }
}

/** Rename with bounded transient-error retries; used for replacement and quarantine. */
export function renameWithRetry(from: string, to: string): void {
  retryTransient(() => renameSync(from, to))
}

/** Reject an existing target that is not a regular file (directory, symlink, junction). */
export function assertRegularOrAbsent(path: string, label = 'Target'): void {
  if (existsSync(path) && !lstatSync(path).isFile()) throw new Error(`${label} must be a regular file`)
}

/**
 * Replace a file atomically: exclusive-create a random sibling, write, fsync, rename with retries.
 * The temporary file is always removed when the replacement does not complete.
 * @param file - final path; an existing entry must be a regular file.
 * @param bytes - complete next content.
 */
export function writeAtomic(file: string, bytes: string | Buffer): void {
  assertRegularOrAbsent(file)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(fd, bytes)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameWithRetry(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
}
