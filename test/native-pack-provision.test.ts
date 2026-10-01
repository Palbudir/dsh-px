import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { provisionNativePack, type NativePackProvision } from '../src/main/native-pack-provision'
import { isAtomicTemporary, retryTransient, writeAtomic } from '../src/main/native-atomic'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

function fixture(root = mkdtempSync(join(tmpdir(), 'px-provision-'))) {
  if (!existsSync(join(root, 'package.json')))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['core'] } } })
    )
  let runs = 0
  const logs: string[] = []
  const pack = (version: string): NativePackProvision => {
    const archive = join(root, `bundled-${version}.tgz`)
    writeFileSync(archive, `archive ${version}`)
    return {
      profile: root,
      archive,
      version,
      sha256: sha(`archive ${version}`),
      log: (message) => logs.push(message),
      install: async (path: string) => {
        runs++
        const manifest = readJson(join(root, 'package.json'))
        manifest.dependencies['dsh-px-pack'] = 'file:' + path.replaceAll('\\', '/')
        writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
        mkdirSync(join(root, 'node_modules/dsh-px-pack'), { recursive: true })
        writeFileSync(
          join(root, 'node_modules/dsh-px-pack/package.json'),
          JSON.stringify({ name: 'dsh-px-pack', version })
        )
      }
    }
  }
  const offline = (options: NativePackProvision): NativePackProvision => ({
    ...options,
    install: async () => {
      runs++
      throw Error(`pnpm ENOTFOUND registry while reading ${root}\\node_modules`)
    }
  })
  return {
    root,
    options: pack('0.2.0'),
    pack,
    offline,
    logs,
    runs: () => runs,
    state: () => readJson(join(root, '.dsh-px/pack-state.json')),
    dependency: () => readJson(join(root, 'package.json')).dependencies['dsh-px-pack'],
    cache: (options: NativePackProvision) => join(root, '.dsh-px', `pack-${options.sha256}.tgz`),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

test('partial owned archive cache is repaired from verified bundled bytes on retry', async () => {
  const f = fixture()
  try {
    mkdirSync(join(f.root, '.dsh-px'))
    writeFileSync(f.cache(f.options), 'partial')
    assert.equal(await provisionNativePack(f.options), 'installed')
    assert.equal(readFileSync(f.cache(f.options), 'utf8'), 'archive 0.2.0')
    assert.equal(f.runs(), 1)
  } finally {
    f.cleanup()
  }
})

test('managed Pack installs once and respects subsequent removal', async () => {
  const f = fixture()
  try {
    assert.equal(await provisionNativePack(f.options), 'installed')
    assert.equal(await provisionNativePack(f.options), 'unchanged')
    assert.equal(f.runs(), 1)
    writeFileSync(join(f.root, 'package.json'), JSON.stringify({ dependencies: {} }))
    assert.equal(await provisionNativePack(f.options), 'user-managed')
    assert.equal(f.state().phase, 'user-managed')
    assert.equal(await provisionNativePack(f.options), 'user-managed')
    assert.equal(f.runs(), 1)
  } finally {
    f.cleanup()
  }
})

test('offline first install is non-fatal, recorded without secrets, and retried on the next start', async () => {
  const f = fixture()
  try {
    assert.equal(await provisionNativePack(f.offline(f.options)), 'failed')
    const failed = f.state()
    assert.equal(failed.phase, 'failed')
    assert.equal(failed.attempts, 1)
    assert.match(failed.lastError, /ENOTFOUND/)
    assert.ok(!failed.lastError.includes(f.root), 'profile path is redacted')
    assert.equal(f.dependency(), undefined, 'Host starts without a Pack')
    assert.ok(f.logs.some((line) => /Pack provisioning failed/.test(line)))
    assert.equal(await provisionNativePack(f.offline(f.options)), 'failed')
    assert.equal(f.state().attempts, 2)
    assert.equal(await provisionNativePack(f.options), 'installed')
    assert.equal(f.state().phase, 'installed')
    assert.equal(f.state().attempts, undefined)
    assert.equal(f.state().lastError, undefined)
  } finally {
    f.cleanup()
  }
})

test('failed v2 upgrade keeps v1 dependency and cache usable, then a retry upgrades and prunes', async () => {
  const f = fixture()
  try {
    const v1 = f.pack('0.1.0')
    const v2 = f.pack('0.2.0')
    assert.equal(await provisionNativePack(v1), 'installed')
    const v1Spec = f.dependency()
    assert.equal(await provisionNativePack(f.offline(v2)), 'failed')
    assert.equal(f.dependency(), v1Spec)
    assert.equal(readFileSync(f.cache(v1), 'utf8'), 'archive 0.1.0')
    assert.equal(readJson(join(f.root, 'node_modules/dsh-px-pack/package.json')).version, '0.1.0')
    assert.equal(f.state().phase, 'failed')
    assert.equal(f.state().previousSpec, v1Spec)
    // A failed state still counts the old dependency as managed on the next start.
    assert.equal(await provisionNativePack(f.offline(v2)), 'failed')
    assert.equal(readFileSync(f.cache(v1), 'utf8'), 'archive 0.1.0')
    assert.equal(await provisionNativePack(v2), 'installed')
    assert.equal(readJson(join(f.root, 'node_modules/dsh-px-pack/package.json')).version, '0.2.0')
    assert.ok(!existsSync(f.cache(v1)), 'superseded cache is removed after success')
    assert.ok(existsSync(f.cache(v2)))
  } finally {
    f.cleanup()
  }
})

test('an install that fails after rewriting package.json leaves the previous selection in place', async () => {
  const f = fixture()
  try {
    const v1 = f.pack('0.1.0')
    const v2 = f.pack('0.2.0')
    assert.equal(await provisionNativePack(v1), 'installed')
    const v1Manifest = readFileSync(join(f.root, 'package.json'))
    writeFileSync(join(f.root, 'pnpm-lock.yaml'), 'lock v1\n')
    // A failed pnpm run that already wrote the new dependency and lockfile (no native rollback).
    const partial: NativePackProvision = {
      ...v2,
      install: async (path: string) => {
        const manifest = readJson(join(f.root, 'package.json'))
        manifest.dependencies['dsh-px-pack'] = 'file:' + path.replaceAll('\\', '/')
        writeFileSync(join(f.root, 'package.json'), JSON.stringify(manifest))
        writeFileSync(join(f.root, 'pnpm-lock.yaml'), 'lock v2 partial\n')
        throw Error('pnpm exited with code 1')
      }
    }
    assert.equal(await provisionNativePack(partial), 'failed')
    assert.deepEqual(readFileSync(join(f.root, 'package.json')), v1Manifest, 'package.json is restored')
    assert.equal(readFileSync(join(f.root, 'pnpm-lock.yaml'), 'utf8'), 'lock v1\n', 'lockfile is restored')
    assert.equal(f.state().phase, 'failed')
    // A first install that fails removes a lockfile it created instead of leaving it behind.
    const g = fixture()
    try {
      const original = readFileSync(join(g.root, 'package.json'))
      const first: NativePackProvision = {
        ...g.options,
        install: async (path: string) => {
          const manifest = readJson(join(g.root, 'package.json'))
          manifest.dependencies['dsh-px-pack'] = 'file:' + path.replaceAll('\\', '/')
          writeFileSync(join(g.root, 'package.json'), JSON.stringify(manifest))
          writeFileSync(join(g.root, 'pnpm-lock.yaml'), 'lock partial\n')
          throw Error('pnpm exited with code 1')
        }
      }
      assert.equal(await provisionNativePack(first), 'failed')
      assert.deepEqual(readFileSync(join(g.root, 'package.json')), original)
      assert.ok(!existsSync(join(g.root, 'pnpm-lock.yaml')), 'a lockfile the failed run created is removed')
    } finally {
      g.cleanup()
    }
    // The next start still upgrades normally.
    assert.equal(await provisionNativePack(v2), 'installed')
    assert.equal(readJson(join(f.root, 'node_modules/dsh-px-pack/package.json')).version, '0.2.0')
  } finally {
    f.cleanup()
  }
})

test('a failure after a verified install never rolls the install back', async () => {
  const f = fixture()
  try {
    const v1 = f.pack('0.1.0')
    const v2 = f.pack('0.2.0')
    assert.equal(await provisionNativePack(v1), 'installed')
    // A directory in place of a cache file makes pruning after the v2 install fail.
    mkdirSync(join(f.root, '.dsh-px', `pack-${'f'.repeat(64)}.tgz`))
    const pinned = join(f.root, '.dsh-px', `pack-${'f'.repeat(64)}.tgz`, 'held')
    writeFileSync(pinned, 'x')
    const result = await provisionNativePack(v2)
    // Whatever pruning reports, the verified v2 dependency stays and the profile stays PX-managed.
    assert.ok(result === 'installed' || result === 'failed')
    assert.equal(readJson(join(f.root, 'node_modules/dsh-px-pack/package.json')).version, '0.2.0')
    assert.equal(f.dependency(), 'file:' + f.cache(v2).replaceAll('\\', '/'))
    assert.notEqual(await provisionNativePack(v2), 'user-managed')
  } finally {
    f.cleanup()
  }
})

test('bad bundled archives and invalid dependency declarations do not throw or install', async () => {
  const f = fixture()
  try {
    assert.equal(await provisionNativePack({ ...f.options, sha256: '0'.repeat(64) }), 'failed')
    assert.equal(f.runs(), 0)
    writeFileSync(join(f.root, 'package.json'), '{"dependencies":{"dsh-px-pack":1}}')
    assert.equal(await provisionNativePack(f.options), 'failed')
    assert.equal(f.runs(), 0)
  } finally {
    f.cleanup()
  }
})

test('existing user Pack is persisted as user managed and later removal is not reinstalled', async () => {
  const f = fixture()
  try {
    writeFileSync(
      join(f.root, 'package.json'),
      JSON.stringify({ dependencies: { 'dsh-px-pack': 'custom-spec' } })
    )
    assert.equal(await provisionNativePack(f.options), 'user-managed')
    assert.equal(f.state().phase, 'user-managed')
    assert.equal(f.state().previousSpec, 'custom-spec')
    writeFileSync(join(f.root, 'package.json'), JSON.stringify({ dependencies: {} }))
    assert.equal(await provisionNativePack(f.options), 'user-managed')
    assert.equal(f.runs(), 0)
  } finally {
    f.cleanup()
  }
})

test('corrupt or empty state is quarantined and provisioning follows the no-state rules', async () => {
  for (const content of ['', '{"schemaVersion":1', '{"schemaVersion":9}']) {
    const f = fixture()
    try {
      mkdirSync(join(f.root, '.dsh-px'))
      writeFileSync(join(f.root, '.dsh-px/pack-state.json'), content)
      assert.equal(await provisionNativePack(f.options), 'installed')
      const quarantined = readdirSync(join(f.root, '.dsh-px')).filter((n) =>
        n.startsWith('pack-state.json.corrupt-')
      )
      assert.equal(quarantined.length, 1)
      assert.equal(readFileSync(join(f.root, '.dsh-px', quarantined[0]), 'utf8'), content)
    } finally {
      f.cleanup()
    }
  }
  const f = fixture()
  try {
    writeFileSync(
      join(f.root, 'package.json'),
      JSON.stringify({ dependencies: { 'dsh-px-pack': 'custom-spec' } })
    )
    mkdirSync(join(f.root, '.dsh-px'))
    writeFileSync(join(f.root, '.dsh-px/pack-state.json'), '')
    assert.equal(await provisionNativePack(f.options), 'user-managed')
    assert.equal(f.runs(), 0)
  } finally {
    f.cleanup()
  }
})

test('corrupt state with a dependency on the PX profile cache stays managed and upgrades', async () => {
  const f = fixture()
  try {
    const v1 = f.pack('0.1.0')
    const v2 = f.pack('0.2.0')
    assert.equal(await provisionNativePack(v1), 'installed')
    const v1Spec = f.dependency()
    writeFileSync(join(f.root, '.dsh-px/pack-state.json'), '{"schemaVersion":1')
    assert.equal(await provisionNativePack(v2), 'installed')
    assert.equal(f.state().phase, 'installed')
    assert.equal(f.state().previousSpec, v1Spec)
    assert.equal(f.dependency(), 'file:' + f.cache(v2).replaceAll('\\', '/'))
    assert.equal(readJson(join(f.root, 'node_modules/dsh-px-pack/package.json')).version, '0.2.0')
    assert.ok(!existsSync(f.cache(v1)), 'superseded cache is pruned')
    assert.equal(await provisionNativePack(v2), 'unchanged')
    assert.equal(f.runs(), 2)
    // Same version after corruption: the managed path verifies the cache and settles on installed again.
    writeFileSync(join(f.root, '.dsh-px/pack-state.json'), '')
    writeFileSync(f.cache(v2), 'tampered')
    assert.equal(await provisionNativePack(v2), 'installed')
    assert.equal(readFileSync(f.cache(v2), 'utf8'), 'archive 0.2.0')
    assert.equal(await provisionNativePack(v2), 'unchanged')
  } finally {
    f.cleanup()
  }
})

test('corrupt state does not adopt cache-like specs outside this profile .dsh-px directory', async () => {
  const f = fixture()
  const other = fixture()
  try {
    for (const spec of [
      'file:' + other.cache(other.options).replaceAll('\\', '/'),
      'file:' + join(f.root, `pack-${f.options.sha256}.tgz`).replaceAll('\\', '/'),
      'file:' + join(f.root, '.dsh-px', 'custom.tgz').replaceAll('\\', '/')
    ]) {
      writeFileSync(join(f.root, 'package.json'), JSON.stringify({ dependencies: { 'dsh-px-pack': spec } }))
      rmSync(join(f.root, '.dsh-px'), { recursive: true, force: true })
      mkdirSync(join(f.root, '.dsh-px'))
      writeFileSync(join(f.root, '.dsh-px/pack-state.json'), '{')
      assert.equal(await provisionNativePack(f.options), 'user-managed', spec)
      assert.equal(f.dependency(), spec)
    }
    assert.equal(f.runs(), 0)
  } finally {
    f.cleanup()
    other.cleanup()
  }
})

test('stale writeAtomic temporaries are removed from the profile root without touching other entries', async () => {
  assert.ok(isAtomicTemporary(`package.json.${randomUUID()}.tmp`))
  for (const name of [
    'x.tmp',
    `${randomUUID()}.tmp`,
    `a.${randomUUID()}.tmp.bak`,
    `a.${randomUUID().toUpperCase()}.tmp`
  ])
    assert.ok(!isAtomicTemporary(name), name)
  const f = fixture()
  try {
    const stale = `cordis.patch.yml.${randomUUID()}.tmp`
    const staleDirectory = `package.json.${randomUUID()}.tmp`
    writeFileSync(join(f.root, stale), 'stale')
    mkdirSync(join(f.root, staleDirectory))
    writeFileSync(join(f.root, 'user-notes.tmp'), 'keep')
    writeFileSync(join(f.root, 'cordis.patch.yml.1234.tmp'), 'keep')
    mkdirSync(join(f.root, '.dsh-px'))
    mkdirSync(join(f.root, '.dsh-px', `pack-state.json.${randomUUID()}.tmp`))
    assert.equal(await provisionNativePack(f.options), 'installed')
    assert.ok(!existsSync(join(f.root, stale)))
    assert.ok(existsSync(join(f.root, staleDirectory)), 'directories are never removed')
    assert.ok(existsSync(join(f.root, 'user-notes.tmp')))
    assert.ok(existsSync(join(f.root, 'cordis.patch.yml.1234.tmp')))
    assert.equal(readdirSync(join(f.root, '.dsh-px')).filter((n) => n.endsWith('.tmp')).length, 1)
  } finally {
    f.cleanup()
  }
})

test('unchanged start restores a missing or damaged cache without reinstalling', async () => {
  const f = fixture()
  try {
    assert.equal(await provisionNativePack(f.options), 'installed')
    rmSync(f.cache(f.options))
    assert.equal(await provisionNativePack(f.options), 'repaired')
    assert.equal(readFileSync(f.cache(f.options), 'utf8'), 'archive 0.2.0')
    writeFileSync(f.cache(f.options), 'tampered')
    assert.equal(await provisionNativePack(f.options), 'repaired')
    assert.equal(readFileSync(f.cache(f.options), 'utf8'), 'archive 0.2.0')
    assert.equal(await provisionNativePack(f.options), 'unchanged')
    assert.equal(f.runs(), 1)
  } finally {
    f.cleanup()
  }
})

test('quarantined files and stray temporaries are bounded', async () => {
  const f = fixture()
  try {
    mkdirSync(join(f.root, '.dsh-px'))
    for (let i = 0; i < 6; i++) {
      writeFileSync(f.cache(f.options), 'bad')
      assert.equal(await provisionNativePack(f.offline(f.options)), 'failed')
    }
    writeFileSync(join(f.root, '.dsh-px', `pack-state.json.${randomUUID()}.tmp`), 'stale')
    writeFileSync(join(f.root, '.dsh-px', `pack-${'a'.repeat(64)}.tgz`), 'orphan')
    assert.equal(await provisionNativePack(f.options), 'installed')
    const names = readdirSync(join(f.root, '.dsh-px'))
    assert.ok(names.filter((n) => n.includes('.corrupt-')).length <= 3)
    assert.ok(!names.some((n) => n.endsWith('.tmp')))
    assert.deepEqual(names.filter((n) => n.endsWith('.tgz')).sort(), [`pack-${f.options.sha256}.tgz`])
  } finally {
    f.cleanup()
  }
})

test('managed file dependency copied from another profile is reinstalled from this profile cache', async () => {
  const source = fixture()
  const copy = fixture()
  try {
    assert.equal(await provisionNativePack(source.options), 'installed')
    // Whole-directory import: state and package.json still name the source profile's cache.
    mkdirSync(join(copy.root, '.dsh-px'))
    writeFileSync(
      join(copy.root, '.dsh-px/pack-state.json'),
      readFileSync(join(source.root, '.dsh-px/pack-state.json'))
    )
    writeFileSync(join(copy.root, 'package.json'), readFileSync(join(source.root, 'package.json')))
    mkdirSync(join(copy.root, 'node_modules/dsh-px-pack'), { recursive: true })
    writeFileSync(
      join(copy.root, 'node_modules/dsh-px-pack/package.json'),
      JSON.stringify({ name: 'dsh-px-pack', version: '0.2.0' })
    )
    const options = { ...copy.options, sha256: source.options.sha256 }
    assert.equal(await provisionNativePack(copy.offline(options)), 'failed')
    assert.equal(copy.state().phase, 'failed')
    assert.equal(await provisionNativePack(options), 'installed')
    assert.equal(copy.dependency(), 'file:' + copy.cache(options).replaceAll('\\', '/'))
    assert.equal(readFileSync(copy.cache(options), 'utf8'), 'archive 0.2.0')
    assert.ok(copy.logs.some((line) => /outside this profile/.test(line)))
    assert.equal(await provisionNativePack(options), 'unchanged')
  } finally {
    source.cleanup()
    copy.cleanup()
  }
})

test('atomic writes retry transient errors a bounded number of times and never leave temporaries', () => {
  let calls = 0
  assert.equal(
    retryTransient(() => {
      if (++calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      return 'ok'
    }, true),
    'ok'
  )
  assert.equal(calls, 3)
  calls = 0
  assert.throws(
    () =>
      retryTransient(() => {
        calls++
        throw Object.assign(new Error('denied'), { code: 'EPERM' })
      }, true),
    /denied/
  )
  assert.equal(calls, 9)
  calls = 0
  assert.throws(() =>
    retryTransient(() => {
      calls++
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }, true)
  )
  assert.equal(calls, 1)
  const root = mkdtempSync(join(tmpdir(), 'px-atomic-'))
  try {
    const target = join(root, 'dir-target')
    mkdirSync(target)
    assert.throws(() => writeAtomic(target, 'x'), /regular file/)
    writeAtomic(join(root, 'file'), 'content')
    assert.equal(readFileSync(join(root, 'file'), 'utf8'), 'content')
    assert.deepEqual(readdirSync(root).sort(), ['dir-target', 'file'])
    // Cleanup after a completed rename would only fail on the missing temporary (e.g. EBUSY); it is skipped.
    const busyRemove = (): void => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    }
    writeAtomic(join(root, 'file'), 'next', { rename: renameSync, remove: busyRemove })
    assert.equal(readFileSync(join(root, 'file'), 'utf8'), 'next')
    // A failed rename still removes its temporary.
    const removed: string[] = []
    assert.throws(
      () =>
        writeAtomic(join(root, 'file'), 'lost', {
          rename: () => {
            throw Object.assign(new Error('locked'), { code: 'EPERM' })
          },
          remove: (path) => {
            removed.push(path)
            rmSync(path, { force: true })
          }
        }),
      /locked/
    )
    assert.equal(removed.length, 1)
    assert.equal(readFileSync(join(root, 'file'), 'utf8'), 'next')
    assert.deepEqual(readdirSync(root).sort(), ['dir-target', 'file'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
