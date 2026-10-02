import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { assertRegularOrAbsent, isAtomicTemporary, renameWithRetry, writeAtomic } from './native-atomic'

export { writeAtomic } from './native-atomic'

/** The dependency files of a profile as they were before an install; `null` means absent. */
type ProfileSnapshot = ReadonlyArray<{ path: string; bytes: Buffer | null }>
const PROFILE_FILES = ['package.json', 'pnpm-lock.yaml']
function snapshotProfile(profile: string): ProfileSnapshot {
  return PROFILE_FILES.map((name) => {
    const path = join(profile, name)
    assertRegularOrAbsent(path, `Profile ${name}`)
    return { path, bytes: existsSync(path) ? readFileSync(path) : null }
  })
}
/** Put back the dependency files so the next Host start sees the previous Pack selection. */
function restoreProfile(profile: string, snapshot: ProfileSnapshot): void {
  for (const { path, bytes } of snapshot) {
    const current = existsSync(path) ? readFileSync(path) : null
    if (bytes === null ? current === null : current !== null && current.equals(bytes)) continue
    if (bytes === null) rmSync(path, { force: true })
    else writeAtomic(path, bytes)
  }
}

/**
 * Durable provisioning record in `<profile>/.dsh-px/pack-state.json`.
 * - `pending`: an install of `targetSpec` started; `previousSpec` is the dependency it replaces.
 * - `failed`: the last install attempt failed; the Host runs with `previousSpec` (or without a Pack).
 * - `installed`: `targetSpec` is the managed dependency.
 * - `user-managed`: PX never changes the dependency again in this profile.
 */
interface ProvisionState {
  schemaVersion: 1
  phase: 'pending' | 'installed' | 'failed' | 'user-managed'
  version: string
  sha256: string
  previousSpec: string | null
  /** Managed dependency spec; null only for `user-managed`. */
  targetSpec: string | null
  /** Consecutive attempts for this `sha256`; reset on success or a new bundled Pack. */
  attempts?: number
  /** Redacted message of the last failure; profile and home paths are replaced by placeholders. */
  lastError?: string
  updatedAt?: string
}
export type NativePackProvisionResult = 'installed' | 'unchanged' | 'repaired' | 'user-managed' | 'failed'
export interface NativePackProvision {
  profile: string
  archive: string
  version: string
  sha256: string
  /** Native runPluginCommand, using its own package lock, compatibility checks and reconciliation. */
  install: (archive: string, options?: { repair: boolean }) => Promise<void>
  /** Diagnostic sink; defaults to console.error so the native Desktop log captures it. */
  log?: (message: string) => void
}

const STATE_FILE = 'pack-state.json'
const CACHE_PATTERN = /^pack-[a-f0-9]{64}\.tgz$/
const CORRUPT_MARKER = '.corrupt-'
/** Quarantined files kept for diagnosis; older ones are removed. */
const CORRUPT_RETAINED = 3
const ERROR_LIMIT = 500

const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
function dependency(profile: string): string | null {
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  const value = manifest.dependencies?.['dsh-px-pack']
  if (value !== undefined && typeof value !== 'string') throw new Error('Invalid Pack dependency declaration')
  return value ?? null
}
function installed(profile: string, version: string): boolean {
  const file = join(profile, 'node_modules/dsh-px-pack/package.json')
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    return manifest.name === 'dsh-px-pack' && manifest.version === version
  } catch {
    return false
  }
}
function validState(state: unknown): state is ProvisionState {
  if (typeof state !== 'object' || state === null) return false
  const value = state as Record<string, unknown>
  return (
    value.schemaVersion === 1 &&
    typeof value.phase === 'string' &&
    ['pending', 'installed', 'failed', 'user-managed'].includes(value.phase) &&
    typeof value.version === 'string' &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    (typeof value.targetSpec === 'string' || (value.targetSpec === null && value.phase === 'user-managed')) &&
    (value.previousSpec === null || typeof value.previousSpec === 'string') &&
    (value.attempts === undefined ||
      (Number.isSafeInteger(value.attempts) && (value.attempts as number) >= 0))
  )
}
function quarantine(path: string): string {
  const target = `${path}${CORRUPT_MARKER}${randomUUID()}`
  renameWithRetry(path, target)
  return target
}
/** Corrupt or empty state is quarantined; provisioning then continues as if no state existed. */
function loadState(file: string, log: (message: string) => void): ProvisionState | undefined {
  assertRegularOrAbsent(file, 'Pack state')
  if (!existsSync(file)) return
  let state: unknown
  try {
    state = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    // Unparseable (including empty) state carries no decision to preserve.
    void error
  }
  if (validState(state)) return state
  const moved = quarantine(file)
  log(`[dsh-px] Pack state was unreadable and was moved to ${moved}; continuing without it`)
  return
}
function saveState(file: string, state: ProvisionState): void {
  writeAtomic(file, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + '\n')
}
function redact(error: unknown, profile: string): string {
  let text = error instanceof Error ? error.message : String(error)
  const home = homedir()
  for (const [path, label] of [
    [profile, '<profile>'],
    [home, '~']
  ] as const)
    for (const form of [path, path.replaceAll('\\', '/')]) if (form) text = text.split(form).join(label)
  return text.replace(/\s+/g, ' ').trim().slice(0, ERROR_LIMIT)
}
/** Absolute path of a `file:` spec resolved against the profile, or undefined for other specs. */
function specPath(spec: string | null, profile: string): string | undefined {
  if (!spec?.startsWith('file:')) return
  const path = spec.slice('file:'.length)
  return isAbsolute(path) ? resolve(path) : resolve(profile, path)
}
/** Spec equality with `file:` paths compared after resolution (case-insensitive on Windows). */
function sameSpec(a: string | null, b: string | null, profile: string): boolean {
  if (a === b) return true
  const left = specPath(a, profile)
  const right = specPath(b, profile)
  if (!left || !right) return false
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}
/** Whether `spec` names a PX cache archive directly inside this profile's `.dsh-px` directory. */
function ownCache(spec: string | null, directory: string, profile: string): boolean {
  const path = specPath(spec, profile)
  if (!path || !CACHE_PATTERN.test(basename(path))) return false
  const parent = dirname(path)
  return process.platform === 'win32'
    ? parent.toLowerCase() === resolve(directory).toLowerCase()
    : parent === resolve(directory)
}
function inside(directory: string, path: string): boolean {
  const rel = relative(directory, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}
/**
 * Remove temporaries a crashed `writeAtomic` left behind; the caller's profile lock excludes live writers.
 * Only regular files matching the exact `writeAtomic` name rule are removed; directories, links and other
 * files (including other tools' `*.tmp`) are left alone, and a failed removal never stops provisioning.
 */
function removeTemporaries(directory: string, log: (message: string) => void): void {
  for (const name of readdirSync(directory)) {
    if (!isAtomicTemporary(name)) continue
    const path = join(directory, name)
    try {
      if (lstatSync(path).isFile()) rmSync(path, { force: true })
    } catch (error) {
      // Only the error code is logged: the message would carry the profile path.
      const code = (error as NodeJS.ErrnoException | null)?.code ?? 'unknown'
      log(`[dsh-px] Stale temporary ${name} could not be removed (${code}); continuing`)
    }
  }
}
function pruneCorrupt(directory: string): void {
  const corrupt = readdirSync(directory)
    .filter((name) => name.includes(CORRUPT_MARKER))
    .map((name) => ({ name, time: statSync(join(directory, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
  for (const { name } of corrupt.slice(CORRUPT_RETAINED)) rmSync(join(directory, name), { force: true })
}
/** Keep only the current cache and the archive the current dependency points to. */
function pruneCaches(directory: string, keep: readonly (string | undefined)[]): void {
  for (const name of readdirSync(directory)) {
    if (!CACHE_PATTERN.test(name)) continue
    const path = join(directory, name)
    if (!keep.some((kept) => kept !== undefined && resolve(kept).toLowerCase() === path.toLowerCase()))
      rmSync(path, { force: true })
  }
}
function verifiedBundle(options: NativePackProvision): Buffer {
  const bytes = readFileSync(options.archive)
  if (!/^[a-f0-9]{64}$/.test(options.sha256) || hash(bytes) !== options.sha256)
    throw new Error('Bundled Pack archive integrity mismatch')
  return bytes
}
/** Ensure the cache holds exactly the verified bytes; returns whether it was rewritten. */
function writeCache(cached: string, bytes: Buffer, sha256: string): boolean {
  assertRegularOrAbsent(cached, 'Pack cache')
  if (existsSync(cached)) {
    try {
      if (hash(readFileSync(cached)) === sha256) return false
    } catch {
      // Only this owned cache is replaced; no ACL or external package is changed.
    }
    quarantine(cached)
  }
  writeAtomic(cached, bytes)
  return true
}
function cacheValid(cached: string, sha256: string): boolean {
  try {
    return lstatSync(cached).isFile() && hash(readFileSync(cached)) === sha256
  } catch {
    return false
  }
}

/** Hoisted pnpm reads the old manifest even with --force. Preserve an unreadable owned package first. */
function preserveDamagedHoistedPack(
  profile: string,
  directory: string,
  log: (message: string) => void
): void {
  const modules = join(profile, 'node_modules')
  const pack = join(modules, 'dsh-px-pack')
  try {
    const manifest = JSON.parse(readFileSync(join(pack, 'package.json'), 'utf8'))
    // A readable old version needs only a normal upgrade, including user-configured linked layouts.
    if (typeof manifest?.name === 'string' && typeof manifest?.version === 'string') return
  } catch {
    // Keep the corrupt bytes intact, including hardlinks; renaming the directory changes no file content.
  }
  // Physical ownership checks apply only when preservation may move the damaged package.
  if (!existsSync(modules)) return
  const parent = lstatSync(modules)
  if (!parent.isDirectory() || parent.isSymbolicLink())
    throw new Error('Pack repair requires a profile-owned node_modules directory')
  if (!existsSync(pack)) return
  const entry = lstatSync(pack)
  // Isolated pnpm uses a link into its store. Native --force repairs that layout; never move its target.
  if (entry.isSymbolicLink()) return
  if (!entry.isDirectory()) throw new Error('Pack repair requires an installed package directory')
  const target = join(directory, `recovery-pack-${randomUUID()}`)
  if (!inside(resolve(profile), resolve(pack)) || !inside(resolve(profile), resolve(target)))
    throw new Error('Pack recovery path is outside the profile')
  renameWithRetry(pack, target)
  log(`[dsh-px] Preserved damaged managed Pack at ${target}; reinstalling through the native manager`)
}

/**
 * Provision the bundled Pack into a native Desktop profile before the Host starts.
 * Never throws: every failure is logged and, once an install was decided, recorded as `failed`, so the
 * Host still starts without a Pack or with the previous one. The next start retries automatically.
 * Host must be stopped; caller holds the native Desktop profile lock for this entire operation.
 * @param options - profile, bundled archive and its verified identity, and the native install callback.
 * @returns what this start did.
 */
export async function provisionNativePack(options: NativePackProvision): Promise<NativePackProvisionResult> {
  const log = options.log ?? ((message: string) => console.error(message))
  const directory = join(options.profile, '.dsh-px')
  let file: string | undefined
  let failure: ProvisionState | undefined
  let snapshot: ProfileSnapshot | undefined
  try {
    if (!existsSync(directory)) mkdirSync(directory)
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
      throw new Error('Pack state directory must be an owned directory')
    // Profile-root temporaries come from writeAtomic callers such as the cordis.patch.yml defaults.
    removeTemporaries(options.profile, log)
    removeTemporaries(directory, log)
    file = join(directory, STATE_FILE)
    const state = loadState(file, log)
    pruneCorrupt(directory)
    const current = dependency(options.profile)
    // pnpm's durable file dependency must survive later Desktop resource replacement.
    const cached = join(directory, `pack-${options.sha256}.tgz`)
    const targetSpec = 'file:' + cached.replaceAll('\\', '/')
    if (state?.phase === 'user-managed') return 'user-managed'
    // First adoption never takes over a user's existing dependency. Removal and custom replacement persist.
    // Without state (first start, or state quarantined as corrupt) a dependency on PX's own cache archive in
    // this profile is still PX-managed: only PX writes `.dsh-px/pack-<sha256>.tgz`, so it is verified and upgraded.
    const managed = !state
      ? current === null || ownCache(current, directory, options.profile)
      : state.phase === 'installed'
        ? sameSpec(current, state.targetSpec, options.profile)
        : sameSpec(current, state.targetSpec, options.profile) ||
          sameSpec(current, state.previousSpec, options.profile)
    if (!managed) {
      saveState(file, {
        schemaVersion: 1,
        phase: 'user-managed',
        version: options.version,
        sha256: options.sha256,
        previousSpec: current,
        targetSpec: null
      })
      return 'user-managed'
    }
    const retry = state !== undefined && state.phase !== 'installed' ? state : undefined
    const pending: ProvisionState = {
      schemaVersion: 1,
      phase: 'pending',
      version: options.version,
      sha256: options.sha256,
      previousSpec:
        retry && sameSpec(current, retry.targetSpec, options.profile) ? retry.previousSpec : current,
      targetSpec,
      attempts: (retry?.sha256 === options.sha256 ? (retry.attempts ?? 0) : 0) + 1
    }
    // Cache verification can also fail; establish durable failure information before that branch.
    failure = pending
    const manifestMatches = installed(options.profile, options.version)
    const repair = sameSpec(current, targetSpec, options.profile) && !manifestMatches
    if (
      state?.phase === 'installed' &&
      state.sha256 === options.sha256 &&
      state.version === options.version &&
      sameSpec(state.targetSpec, targetSpec, options.profile) &&
      manifestMatches
    ) {
      let result: NativePackProvisionResult = 'unchanged'
      if (!cacheValid(cached, options.sha256)) {
        // The installed package identity matches; restoring the file dependency needs no reinstall.
        writeCache(cached, verifiedBundle(options), options.sha256)
        log('[dsh-px] Restored missing or damaged Pack cache from the bundled archive')
        result = 'repaired'
      }
      pruneCaches(directory, [cached, specPath(current, options.profile)])
      return result
    }
    const previousPath = specPath(state?.targetSpec ?? null, options.profile)
    // A copied profile keeps absolute file: specs to the source profile; this profile rebuilds its own cache.
    if (previousPath && state?.targetSpec === current && !inside(directory, previousPath))
      log(
        '[dsh-px] Managed Pack dependency points outside this profile; reinstalling from this profile cache'
      )
    writeCache(cached, verifiedBundle(options), options.sha256)
    saveState(file, pending)
    // The native manager restores the profile manifest only for a compatibility denial; a failed pnpm
    // run can leave package.json naming the new Pack. Keep the files to put them back on failure.
    snapshot = snapshotProfile(options.profile)
    // A different archive/version still cannot replace a hoisted package with an unreadable manifest.
    // Keep --force limited to same-spec repairs; normal upgrades use native add after preservation.
    if (!manifestMatches) preserveDamagedHoistedPack(options.profile, directory, log)
    await options.install(cached, { repair })
    if (
      !sameSpec(dependency(options.profile), targetSpec, options.profile) ||
      !installed(options.profile, options.version)
    )
      throw new Error('Native Pack install did not produce the expected dependency; retry required')
    // The install is verified: a later failure (state write, cache pruning) must not roll it back.
    snapshot = undefined
    saveState(file, {
      schemaVersion: 1,
      phase: 'installed',
      version: pending.version,
      sha256: pending.sha256,
      previousSpec: pending.previousSpec,
      targetSpec
    })
    failure = undefined
    pruneCaches(directory, [cached, specPath(dependency(options.profile), options.profile)])
    return 'installed'
  } catch (error) {
    const message = redact(error, options.profile)
    if (snapshot) {
      try {
        restoreProfile(options.profile, snapshot)
      } catch (restoreError) {
        log(`[dsh-px] Profile manifest could not be restored: ${redact(restoreError, options.profile)}`)
      }
    }
    log(`[dsh-px] Pack provisioning failed; the Host starts with the previous Pack state: ${message}`)
    if (file && failure) {
      try {
        saveState(file, { ...failure, phase: 'failed', lastError: message })
      } catch (stateError) {
        log(`[dsh-px] Pack failure could not be recorded: ${redact(stateError, options.profile)}`)
      }
    }
    return 'failed'
  }
}
