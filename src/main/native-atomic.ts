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

/** Replaceable filesystem steps of `writeAtomic`; tests inject failures here. */
export interface AtomicOperations {
  rename: (from: string, to: string) => void
  remove: (path: string) => void
}
const defaultOperations: AtomicOperations = {
  rename: renameWithRetry,
  remove: (path) => rmSync(path, { force: true })
}

/**
 * Replace a file atomically: exclusive-create a random sibling, write, fsync, rename with retries.
 * The temporary file is removed when the replacement does not complete; after a completed rename it no longer exists.
 * @param file - final path; an existing entry must be a regular file.
 * @param bytes - complete next content.
 * @param operations - rename and cleanup steps; defaults to the retried native operations.
 */
export function writeAtomic(
  file: string,
  bytes: string | Buffer,
  operations: AtomicOperations = defaultOperations
): void {
  assertRegularOrAbsent(file)
  const temporary = `${file}.${randomUUID()}.tmp`
  let renamed = false
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(fd, bytes)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    operations.rename(temporary, file)
    renamed = true
  } finally {
    // After a successful rename the temporary no longer exists; cleanup must not turn success into failure.
    if (!renamed) operations.remove(temporary)
  }
}
