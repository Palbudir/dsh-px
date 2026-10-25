import { createHash, randomUUID } from 'node:crypto'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  realpathSync,
  renameSync,
  rmSync,
  existsSync
} from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'

export const FIXED_ZOD_VERSION = '4.6.7'
export const ZOD_SOURCE = 'node_modules/@deepseek-ai/dsh-typert-protocol/node_modules/zod'
const ZOD_TARGET = 'node_modules/zod'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Check the shell and host bytes in the final archive, including removal of obsolete files. */
export function verifyPackagedDependencyOverrides(paths, read, inventory) {
  const expected = inventory.files.filter((entry) => entry.path.startsWith(ZOD_SOURCE + '/'))
  if (!expected.some((entry) => entry.path === ZOD_SOURCE + '/package.json'))
    throw Error('Fixed dependency inventory is missing')
  for (const prefix of ['node_modules/zod/', 'dsh/node_modules/zod/']) {
    const names = expected.map((entry) => prefix + entry.path.slice(ZOD_SOURCE.length + 1)).sort()
    const actual = paths.filter((path) => path.startsWith(prefix)).sort()
    if (JSON.stringify(actual) !== JSON.stringify(names))
      throw Error('Packaged dependency file list differs: ' + prefix)
    for (const entry of expected) {
      const bytes = read(prefix + entry.path.slice(ZOD_SOURCE.length + 1))
      if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256)
        throw Error('Packaged dependency bytes differ: ' + prefix + entry.path)
    }
    if (JSON.parse(read(prefix + 'package.json').toString('utf8')).version !== FIXED_ZOD_VERSION)
      throw Error('Packaged dependency version differs: ' + prefix)
  }
  const note = JSON.parse(read('dsh/px-dependency-overrides.json').toString('utf8'))
  if (
    !note.overrides?.some(
      (entry) =>
        entry.name === 'zod' && entry.version === FIXED_ZOD_VERSION && entry.reason === 'GHSA-mrhx-c7xc-m3w5'
    )
  )
    throw Error('Packaged dependency override record is missing')
}

/** Copy the already bundled, inventory-verified fixed version into the private PX runtime only. */
export function applyRuntimeDependencyOverrides(runtime, inventory) {
  const root = realpathSync(runtime)
  if (readdirSync(join(root, 'node_modules')).some((name) => /^zod\.px-(?:stage|old)-/.test(name)))
    throw Error('Incomplete private runtime dependency override; rebuild this private runtime')
  const within = (path) => {
    const absolute = resolve(path),
      rel = relative(root, absolute)
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || resolve(root, rel) !== absolute)
      throw Error('Runtime dependency path is outside the private runtime')
    const actual = realpathSync(absolute)
    if (!actual.startsWith(root + sep) || lstatSync(absolute).isSymbolicLink())
      throw Error('Runtime dependency must not redirect outside its private directory')
    return absolute
  }
  const source = within(join(root, ZOD_SOURCE)),
    target = within(join(root, ZOD_TARGET))
  const sourcePackage = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  const targetPackage = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  if (
    sourcePackage.name !== 'zod' ||
    sourcePackage.version !== FIXED_ZOD_VERSION ||
    targetPackage.name !== 'zod' ||
    !['4.4.3', FIXED_ZOD_VERSION].includes(targetPackage.version)
  )
    throw Error('Unexpected native Zod versions; review the fixed runtime dependency contract')
  const files = inventory.files.filter((entry) => entry.path.startsWith(ZOD_SOURCE + '/'))
  if (!files.length || !files.some((entry) => entry.path === ZOD_SOURCE + '/package.json'))
    throw Error('Fixed Zod source is missing from the official runtime inventory')
  const payload = files.map((entry) => {
    const name = entry.path.slice(ZOD_SOURCE.length + 1)
    if (
      !name ||
      name.split('/').some((part) => !part || part === '.' || part === '..') ||
      name.includes('\\')
    )
      throw Error('Unsafe runtime dependency inventory path')
    const bytes = readFileSync(within(join(source, name)))
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256)
      throw Error('Fixed Zod source differs from the official runtime inventory: ' + name)
    return { name, bytes, entry }
  })
  const walk = (directory, prefix = '') =>
    readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        if (entry.isSymbolicLink()) throw Error('Runtime dependency contains a redirected file')
        const name = prefix + entry.name
        return entry.isDirectory()
          ? walk(join(directory, entry.name), name + '/')
          : entry.isFile()
            ? [name]
            : []
      })
      .sort()
  const expected = payload.map((entry) => entry.name).sort()
  if (JSON.stringify(walk(source)) !== JSON.stringify(expected))
    throw Error('Fixed Zod source has untracked files')
  if (targetPackage.version === FIXED_ZOD_VERSION) {
    if (
      JSON.stringify(walk(target)) !== JSON.stringify(expected) ||
      payload.some((entry) => hash(readFileSync(join(target, entry.name))) !== entry.entry.sha256)
    )
      throw Error('Previously overridden Zod differs from its fixed inventory')
  } else {
    const staging = target + '.px-stage-' + randomUUID(),
      backup = target + '.px-old-' + randomUUID()
    mkdirSync(staging)
    try {
      for (const entry of payload) {
        const file = join(staging, entry.name)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, entry.bytes)
      }
      within(staging)
      renameSync(target, backup)
      try {
        renameSync(staging, target)
      } catch (error) {
        renameSync(backup, target)
        throw error
      }
      // Both resolved package directories must stay inside the exact private runtime before removal.
      rmSync(within(backup), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      try {
        rmSync(within(staging), { recursive: true, force: true })
      } catch {}
      throw error
    }
  }
  const note = {
    schemaVersion: 1,
    overrides: [
      {
        name: 'zod',
        originalVersion: '4.4.3',
        version: FIXED_ZOD_VERSION,
        source: ZOD_SOURCE,
        reason: 'GHSA-mrhx-c7xc-m3w5',
        originalPackageDeclarationsPreserved: true
      }
    ]
  }
  const notePath = 'px-dependency-overrides.json',
    noteBytes = Buffer.from(JSON.stringify(note, null, 2) + '\n')
  if (existsSync(join(root, notePath))) within(join(root, notePath))
  writeFileSync(join(root, notePath), noteBytes)
  inventory.files = inventory.files.filter(
    (entry) => !entry.path.startsWith(ZOD_TARGET + '/') && entry.path !== notePath
  )
  inventory.files.push(...payload.map(({ name, entry }) => ({ ...entry, path: ZOD_TARGET + '/' + name })), {
    path: notePath,
    bytes: noteBytes.length,
    sha256: hash(noteBytes),
    executable: false
  })
  inventory.files.sort((a, b) => a.path.localeCompare(b.path))
  return { version: FIXED_ZOD_VERSION, directory: target, files: payload.length }
}
