import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { FOUNDATION_PLUGINS } from '../shared/distribution'

const hash = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex')
const foundation = new Set<string>(['dsh-px-core', ...FOUNDATION_PLUGINS])
const marker = '.px-runtime-cache.json'
const mutable = new Set([
  'package.json',
  'desktop-runtime.json',
  'node_modules/@deepseek-ai/dsh/package.json'
])
async function present(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function entries(root: string, skipFoundation = false): Promise<string[]> {
  const result: string[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(join(root, directory), { withFileTypes: true })) {
      const name = directory ? directory + '/' + entry.name : entry.name
      if (
        name === marker ||
        name === '.px-runtime-ready' ||
        (skipFoundation &&
          name.startsWith('node_modules/') &&
          foundation.has(name.slice('node_modules/'.length)))
      )
        continue
      const info = entry.isSymbolicLink() ? await fs.stat(join(root, name)) : entry
      if (info.isDirectory()) await visit(name)
      else if (info.isFile()) result.push(name)
      else throw Error('Unsupported file in bundled runtime')
    }
  }
  await visit('')
  return result
}

async function copyFiles(source: string, target: string, files: string[], link: boolean): Promise<void> {
  const directories = [...new Set(files.map((file) => dirname(join(target, file))))]
  for (const path of directories) await fs.mkdir(path, { recursive: true })
  const iterator = files.values()
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, async () => {
      for (const file of iterator) {
        const from = join(source, file),
          to = join(target, file)
        if (link && !mutable.has(file)) {
          try {
            await fs.link(from, to)
            continue
          } catch {
            /* non-NTFS volumes may require a real copy */
          }
        }
        // Use the public readFile API: Electron supports virtual asar paths here.
        await fs.writeFile(to, await fs.readFile(from))
      }
    })
  )
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}

async function ready(directory: string, expected: object): Promise<boolean> {
  try {
    const state = JSON.parse(await fs.readFile(join(directory, marker), 'utf8'))
    return (
      Object.entries(expected).every(([key, value]) => state[key] === value) &&
      (await present(join(directory, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'))) &&
      (await present(join(directory, 'desktop-runtime.json')))
    )
  } catch {
    return false
  }
}

/** Runtime caches contain only replaceable program files, never sessions, credentials or profile settings. */
export async function materializePackRuntime(options: {
  profile: string
  bundledRuntime: string
  hostKey: string
  packSha256: string
  version: string
  foundationDirectory: string
}): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(options.packSha256)) throw Error('Invalid Pack digest')
  const cache = join(options.profile, '.dsh-px', 'runtime-cache')
  await fs.mkdir(cache, { recursive: true })
  if ((await fs.lstat(cache)).isSymbolicLink()) throw Error('Runtime cache must be profile-owned')
  const hostKey = hash(options.hostKey)
  const base = join(cache, 'host-' + hostKey.slice(0, 20))
  const baseIdentity = { schemaVersion: 1, hostKey }
  if (!(await ready(base, baseIdentity))) {
    if (await present(base)) await fs.rename(base, base + '.incomplete-' + randomUUID())
    const staging = join(cache, '.host-' + randomUUID())
    await fs.mkdir(staging)
    await copyFiles(options.bundledRuntime, staging, await entries(options.bundledRuntime, true), false)
    await fs.writeFile(join(staging, marker), JSON.stringify(baseIdentity))
    await fs.rename(staging, base)
  }
  const view = join(cache, 'pack-' + hostKey.slice(0, 12) + '-' + options.packSha256.slice(0, 20))
  const identity = { ...baseIdentity, packSha256: options.packSha256, version: options.version }
  if (await ready(view, identity)) return view
  if (await present(view)) await fs.rename(view, view + '.incomplete-' + randomUUID())
  const staging = join(cache, '.pack-' + randomUUID())
  await fs.mkdir(staging)
  await copyFiles(base, staging, await entries(base), true)
  const core = JSON.parse(await fs.readFile(join(options.foundationDirectory, 'package.json'), 'utf8'))
  if (
    core.name !== 'dsh-px-core' ||
    core.version !== options.version ||
    JSON.stringify(Object.keys(core.dependencies ?? {}).sort()) !==
      JSON.stringify([...FOUNDATION_PLUGINS].sort())
  )
    throw Error('Pack foundation does not match its declared version')
  await copyFiles(
    options.foundationDirectory,
    join(staging, 'node_modules/dsh-px-core'),
    await entries(options.foundationDirectory),
    false
  )
  for (const name of FOUNDATION_PLUGINS) {
    const source = join(options.foundationDirectory, 'node_modules', name)
    await copyFiles(source, join(staging, 'node_modules', name), await entries(source), false)
  }
  const anchor = join(staging, 'node_modules/@deepseek-ai/dsh/package.json')
  const native = JSON.parse(await fs.readFile(anchor, 'utf8'))
  native.dependencies = { ...native.dependencies, 'dsh-px-core': options.version, ...core.dependencies }
  await fs.writeFile(anchor, JSON.stringify(native, null, 2) + '\n')
  await fs.writeFile(join(staging, marker), JSON.stringify(identity))
  await fs.rename(staging, view)
  return view
}

/** Reject a forged persisted runtime pointer before a CLI can load code through it. */
export function managedRuntimePath(profile: string, path: string): string {
  const root = resolve(profile, '.dsh-px', 'runtime-cache'),
    target = resolve(path)
  const name = relative(root, target)
  if (!target.startsWith(root + sep) || !/^pack-[a-f0-9]{12}-[a-f0-9]{20}$/.test(name))
    throw Error('Runtime pointer is outside the managed cache')
  return target
}
