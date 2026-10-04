import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'
import {
  FEATURE_BUNDLES,
  FOUNDATION_PLUGINS,
  LEGACY_FEATURE_BUNDLES,
  isFeatureName,
  validFeatureList,
  type PackDistribution
} from '../shared/distribution'
import { assertRegularOrAbsent, renameWithRetry, writeAtomic } from './native-atomic'

type Files = Record<string, string | null>
interface State {
  schemaVersion: 1
  phase: 'pending' | 'installed' | 'failed'
  version: string
  specs: Record<string, string>
  seenFeatures?: string[]
}
export interface CompositionOptions {
  profile: string
  directory: string
  version: string
  install: (args: string[]) => Promise<void>
  log?: (message: string) => void
}
const TRACKED = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', 'cordis.yml']
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'))
}
function snapshot(profile: string): Files {
  for (const name of TRACKED) assertRegularOrAbsent(join(profile, name), 'Profile file')
  return Object.fromEntries(
    TRACKED.map((name) => [
      name,
      existsSync(join(profile, name)) ? readFileSync(join(profile, name)).toString('base64') : null
    ])
  )
}
function restore(profile: string, files: Files): void {
  if (
    !files ||
    typeof files !== 'object' ||
    TRACKED.some(
      (name) =>
        !Object.hasOwn(files, name) ||
        (files[name] !== null &&
          (typeof files[name] !== 'string' ||
            Buffer.from(files[name]!, 'base64').toString('base64') !== files[name]))
    )
  )
    throw Error('Invalid composition backup; original files preserved')
  for (const name of TRACKED) {
    if (!Object.hasOwn(files, name)) throw Error('Incomplete composition backup')
    if (files[name] === null) rmSync(join(profile, name), { force: true })
    else writeAtomic(join(profile, name), Buffer.from(files[name]!, 'base64'))
  }
}
function validState(value: any): value is State {
  return (
    value?.schemaVersion === 1 &&
    ['pending', 'installed', 'failed'].includes(value.phase) &&
    typeof value.version === 'string' &&
    value.specs &&
    typeof value.specs === 'object' &&
    !Array.isArray(value.specs) &&
    Object.entries(value.specs).every(([name, spec]) => isFeatureName(name) && typeof spec === 'string') &&
    (value.seenFeatures === undefined ||
      (Array.isArray(value.seenFeatures) && value.seenFeatures.every(isFeatureName)))
  )
}
function ownedFeatureSpec(profile: string, own: string, name: string, spec: unknown): spec is string {
  if (typeof spec !== 'string' || !spec.startsWith('file:')) return false
  const path = resolve(profile, spec.slice(5))
  return (
    dirname(path).toLowerCase() === resolve(own).toLowerCase() &&
    new RegExp(`^${name}-[a-f0-9]{64}\\.tgz$`).test(path.replaceAll('\\', '/').split('/').at(-1) ?? '')
  )
}
function migratePatch(text: string, bundles: string[], owned: Set<string>, packEnabled: boolean): string {
  const doc = parseDocument(text, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (v: string) => v }]
  })
  if (doc.errors.length) throw Error('Profile patch cannot be migrated')
  if (doc.contents === null) return text
  if (!isSeq(doc.contents)) throw Error('Profile patch must be a sequence')
  const names = [
    ...FOUNDATION_PLUGINS,
    ...FEATURE_BUNDLES.filter((n) => n !== 'dsh-px-files'),
    'dsh-better-sidebar'
  ]
  let changed = false
  const switches = new Map<string, Array<{ index: number; value: unknown }>>()
  for (const [index, row] of doc.contents.items.entries())
    if (isMap(row)) {
      const id = doc.getIn([index, 'id']),
        name = doc.getIn([index, 'name'])
      const expected = id === 'better-sidebar' ? 'dsh-better-sidebar' : id
      if (typeof name === 'string' && typeof expected === 'string' && names.includes(expected as any)) {
        const path = name.replaceAll('\\', '/')
        if (path.endsWith(`/node_modules/${expected}/lib/index.js`)) {
          doc.setIn([index, 'name'], expected)
          changed = true
        }
      }
      const mapped = expected === 'dsh-better-sidebar' ? 'dsh-px-files' : expected
      const normalized = doc.getIn([index, 'name'])
      if (
        typeof mapped === 'string' &&
        owned.has(mapped) &&
        (normalized === undefined || normalized === expected) &&
        row.has('disabled')
      ) {
        switches.set(mapped, [
          ...(switches.get(mapped) ?? []),
          { index, value: doc.getIn([index, 'disabled']) }
        ])
      }
    }
  for (const [feature, rows] of switches) {
    if (rows.some((row) => typeof row.value !== 'boolean')) continue
    if (rows.at(-1)!.value === true || !packEnabled) {
      const at = bundles.indexOf(feature)
      if (at >= 0) bundles.splice(at, 1)
    } else if (!bundles.includes(feature)) bundles.push(feature)
    for (const row of rows) doc.deleteIn([row.index, 'disabled'])
    changed = true
  }
  return changed ? String(doc) : text
}

/** A single native install applies the full dependency composition while the Desktop profile is locked/offline. */
export async function provisionNativeComposition(
  options: CompositionOptions
): Promise<'installed' | 'unchanged' | 'user-managed' | 'failed'> {
  const log = options.log ?? console.error
  const own = join(options.profile, '.dsh-px')
  mkdirSync(own, { recursive: true })
  if (!lstatSync(own).isDirectory() || lstatSync(own).isSymbolicLink())
    throw Error('Composition state must be profile-owned')
  const statePath = join(own, 'composition-state.json'),
    backupPath = join(own, 'composition-rollback.json')
  assertRegularOrAbsent(statePath)
  assertRegularOrAbsent(backupPath)
  let state: State | undefined
  if (existsSync(statePath)) {
    try {
      const value = readJson(statePath)
      if (!validState(value)) throw Error('Invalid state')
      state = value
    } catch {
      renameWithRetry(statePath, statePath + '.corrupt-' + randomUUID())
      const current = readJson(join(options.profile, 'package.json'))
      if (!current.dependencies?.['dsh-px-pack']) {
        state = {
          schemaVersion: 1,
          phase: 'installed',
          version: 'recovered',
          seenFeatures: [...FEATURE_BUNDLES],
          specs: Object.fromEntries(
            Object.keys(current.dependencies ?? {})
              .filter(isFeatureName)
              .flatMap((name) =>
                ownedFeatureSpec(options.profile, own, name, current.dependencies?.[name])
                  ? [[name, current.dependencies[name]]]
                  : []
              )
          )
        }
        writeAtomic(statePath, JSON.stringify(state))
      }
      log('[dsh-px] Preserved unreadable composition state; recovering only still-declared managed features')
    }
  }
  const recover = async (files: Files): Promise<void> => {
    restore(options.profile, files)
    await options.install(files['pnpm-lock.yaml'] === null ? ['install'] : ['install', '--frozen-lockfile'])
    restore(options.profile, files)
  }
  if (state?.phase === 'pending') {
    try {
      const backup = readJson(backupPath)
      if (backup.previousState !== null && !validState(backup.previousState))
        throw Error('Invalid prior composition state')
      await recover(backup.files)
      state = backup.previousState ?? undefined
      if (state) writeAtomic(statePath, JSON.stringify(state))
      else rmSync(statePath, { force: true })
    } catch {
      throw Error('PX composition recovery failed; refusing to start a mixed plugin installation')
    }
  }
  const manifest = readJson(join(options.profile, 'package.json'))
  const legacy = manifest.dependencies?.['dsh-px-pack']
  if (
    !state &&
    !legacy &&
    ((manifest.dsh?.profile?.bundles ?? []).includes('dsh-px-core') ||
      Object.keys(manifest.dependencies ?? {})
        .filter(isFeatureName)
        .some((name) => ownedFeatureSpec(options.profile, own, name, manifest.dependencies?.[name])))
  ) {
    state = {
      schemaVersion: 1,
      phase: 'installed',
      version: 'recovered',
      seenFeatures: [...FEATURE_BUNDLES],
      specs: Object.fromEntries(
        Object.keys(manifest.dependencies ?? {})
          .filter(isFeatureName)
          .flatMap((name) =>
            ownedFeatureSpec(options.profile, own, name, manifest.dependencies?.[name])
              ? [[name, manifest.dependencies[name]]]
              : []
          )
      )
    }
    writeAtomic(statePath, JSON.stringify(state))
  }
  const legacyStatePath = join(own, 'pack-state.json')
  let legacyState: any
  if (existsSync(legacyStatePath)) {
    assertRegularOrAbsent(legacyStatePath)
    try {
      legacyState = readJson(legacyStatePath)
    } catch {
      renameWithRetry(legacyStatePath, legacyStatePath + '.corrupt-' + randomUUID())
      // Absence after an earlier installation can mean an intentional uninstall.
      if (!state && !legacy) return 'user-managed'
      log('[dsh-px] Preserved unreadable legacy receipt; using the declared managed archive')
    }
  }
  if (!state && legacyState?.phase === 'user-managed') return 'user-managed'
  if (!state && legacyState && !legacy) return 'user-managed'
  if (legacy) {
    const managed =
      typeof legacy === 'string' &&
      legacy.startsWith('file:') &&
      /^pack-[a-f0-9]{64}\.tgz$/.test(legacy.replaceAll('\\', '/').split('/').at(-1) ?? '') &&
      dirname(resolve(options.profile, legacy.slice(5))).toLowerCase() === resolve(own).toLowerCase()
    if (!managed || legacyState?.phase === 'user-managed') return 'user-managed'
  }
  const distribution: PackDistribution = readJson(join(options.directory, 'distribution.json'))
  if (
    distribution.schemaVersion !== 1 ||
    distribution.version !== options.version ||
    distribution.foundation?.name !== 'dsh-px-core' ||
    !validFeatureList(distribution.features)
  )
    throw Error('Wrong Pack composition')
  const selected: string[] = manifest.dsh?.profile?.bundles ?? []
  const wasEnabled = !legacy || selected.includes('dsh-px-pack')
  const next = structuredClone(manifest)
  next.dependencies ??= {}
  next.dsh ??= {}
  next.dsh.profile ??= {}
  const bundles = selected.filter((n) => n !== 'dsh-px-pack')
  const specs: Record<string, string> = {}
  const seen = new Set(
    state?.version === 'recovered'
      ? [...distribution.features.map((f) => f.name), ...Object.keys(state.specs)]
      : (state?.seenFeatures ?? (state ? [...LEGACY_FEATURE_BUNDLES, ...Object.keys(state.specs)] : []))
  )
  if (!state && !bundles.includes('dsh-px-core')) bundles.push('dsh-px-core')
  for (const feature of distribution.features) {
    if (
      feature.version !== options.version ||
      feature.file !== `distribution/${feature.name}-${options.version}.tgz` ||
      !/^[a-f0-9]{64}$/.test(feature.sha256)
    )
      throw Error('Invalid feature artifact')
    const bytes = readFileSync(join(options.directory, feature.file))
    if (hash(bytes) !== feature.sha256) throw Error('Feature artifact digest mismatch')
    const current = manifest.dependencies?.[feature.name],
      previous = state?.specs[feature.name]
    const newlyOffered = !!state && !seen.has(feature.name) && current === undefined
    if (state ? !newlyOffered && (!previous || current !== previous) : current !== undefined) continue
    // A directly installed community sidebar remains user-owned and is not shadowed.
    if (feature.name === 'dsh-px-files' && manifest.dependencies?.['dsh-better-sidebar']) continue
    const cached = join(own, `${feature.name}-${feature.sha256}.tgz`)
    assertRegularOrAbsent(cached, 'Feature archive')
    if (!existsSync(cached) || hash(readFileSync(cached)) !== feature.sha256) writeAtomic(cached, bytes)
    const spec = 'file:' + cached.replaceAll('\\', '/')
    specs[feature.name] = spec
    next.dependencies[feature.name] = spec
    if ((!state || newlyOffered) && wasEnabled && !bundles.includes(feature.name)) bundles.push(feature.name)
  }
  delete next.dependencies['dsh-px-pack']
  next.dsh.profile.bundles = bundles
  const patchPath = join(options.profile, 'cordis.patch.yml')
  const patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  const migrated = legacy ? migratePatch(patch, bundles, new Set(Object.keys(specs)), wasEnabled) : patch
  const identities = Object.keys(specs).every((name) => {
    try {
      return readJson(join(options.profile, 'node_modules', name, 'package.json')).version === options.version
    } catch {
      return false
    }
  })
  if (
    state?.phase === 'installed' &&
    state.version === options.version &&
    JSON.stringify(next) === JSON.stringify(manifest) &&
    migrated === patch &&
    identities
  )
    return 'unchanged'
  const before = snapshot(options.profile)
  writeAtomic(backupPath, JSON.stringify({ files: before, previousState: state ?? null }))
  const pending: State = {
    schemaVersion: 1,
    phase: 'pending',
    version: options.version,
    specs,
    seenFeatures: [...new Set([...seen, ...distribution.features.map((f) => f.name)])]
  }
  writeAtomic(statePath, JSON.stringify(pending))
  try {
    writeAtomic(join(options.profile, 'package.json'), JSON.stringify(next, null, 2) + '\n')
    if (migrated !== patch) writeAtomic(patchPath, migrated)
    await options.install(['install'])
    for (const name of Object.keys(specs))
      if (readJson(join(options.profile, 'node_modules', name, 'package.json')).version !== options.version)
        throw Error('Feature installation did not produce the expected version')
    writeAtomic(statePath, JSON.stringify({ ...pending, phase: 'installed' }, null, 2) + '\n')
    return 'installed'
  } catch {
    try {
      await recover(before)
    } catch {
      throw Error('PX composition rollback failed; refusing to start a mixed plugin installation')
    }
    if (state) writeAtomic(statePath, JSON.stringify(state, null, 2) + '\n')
    else rmSync(statePath, { force: true })
    log('[dsh-px] Composition upgrade failed; restored previous profile and dependencies; retry on restart')
    return 'failed'
  }
}
