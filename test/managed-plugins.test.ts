import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  renameSync,
  cpSync,
  statSync,
  symlinkSync,
  realpathSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import {
  ensureManagedPlugins,
  recoverManagedPluginMigration,
  listManagedPluginBackups,
  MANAGED_PLUGIN_NAMES
} from '../src/main/managed-plugins'
import { inspectManagedPlugins } from '../src/shared/runtime-integrity'
import { inspectSidebarCompatibility } from '../src/shared/sidebar-compatibility'

function write(path: string, contents: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}
function makeBundle(root: string, name: string, version: string): void {
  write(
    join(root, 'package.json'),
    JSON.stringify({
      name,
      version,
      type: 'module',
      files: ['lib', 'cordis.patch.yml'],
      exports: { '.': './lib/index.js', './client': './lib/client.js' },
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } }
    })
  )
  write(join(root, 'lib/index.js'), `export const version = '${version}'\n`)
  write(join(root, 'lib/client.js'), `export const version = '${version}'\n`)
  write(join(root, 'cordis.patch.yml'), '[]\n')
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-transaction-'))
  const home = join(root, 'home'),
    seedHome = join(root, 'seed'),
    profile = join(home, 'profiles/web')
  const deps = Object.fromEntries(MANAGED_PLUGIN_NAMES.map((name) => [name, 'file:C:/old-install/' + name]))
  const bundles = [...MANAGED_PLUGIN_NAMES.filter((name) => name !== 'dsh-px-taskflow'), 'thirdparty']
  write(
    join(profile, 'package.json'),
    JSON.stringify({
      custom: 'KEEP',
      dependencies: { ...deps, thirdparty: 'file:../../thirdparty' },
      dsh: { profile: { bundles } }
    })
  )
  write(join(profile, 'cordis.patch.yml'), 'USER PATCH\n')
  write(join(profile, 'pnpm-lock.yaml'), 'OLD LOCKFILE\n')
  write(join(home, 'settings.yaml'), 'MODEL SETTINGS')
  write(join(home, '.credentials.yaml'), 'PRIVATE CREDENTIALS')
  write(join(home, 'sessions/existing.log'), 'EXISTING HISTORY')
  write(join(profile, 'node_modules/thirdparty/package.json'), '{"name":"thirdparty","version":"7.0.0"}')
  write(join(profile, 'node_modules/thirdparty/data.txt'), 'ORIGINAL DEPENDENCY')
  for (const name of MANAGED_PLUGIN_NAMES) {
    makeBundle(join(seedHome, 'profiles/web/node_modules', name), name, '2.0.0')
    makeBundle(join(profile, 'node_modules', name), name, '1.0.0')
  }
  return { root, home, seedHome, profile, options: { home, seedHome, profileName: 'web', identity: 'v2' } }
}

test('transaction preserves complete old profile and user disable preferences, without installer tools', async () => {
  const f = fixture()
  try {
    let validated = 0
    assert.equal(
      await ensureManagedPlugins({
        ...f.options,
        validate: async (staging) => {
          validated++
          assert.notEqual(staging, f.home)
          assert.equal(existsSync(join(staging, '.credentials.yaml')), false)
          assert.equal(
            JSON.parse(readFileSync(join(f.profile, 'node_modules/dsh-px-updater/package.json'), 'utf8'))
              .version,
            '1.0.0'
          )
        }
      }),
      true
    )
    assert.equal(await ensureManagedPlugins(f.options), false)
    assert.equal(validated, 1)
    const pkg = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8'))
    assert.equal(pkg.custom, 'KEEP')
    assert.equal(pkg.dependencies.thirdparty, 'file:../../thirdparty')
    assert.ok(!pkg.dsh.profile.bundles.includes('dsh-px-taskflow'), 'user-disabled bundle stays disabled')
    assert.equal(readFileSync(join(f.home, '.credentials.yaml'), 'utf8'), 'PRIVATE CREDENTIALS')
    assert.equal(readFileSync(join(f.home, 'sessions/existing.log'), 'utf8'), 'EXISTING HISTORY')
    assert.equal(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8'), 'USER PATCH\n')
    const backups = listManagedPluginBackups(f.home)
    assert.equal(backups.total, 1)
    const old = join(f.home, backups.items[0].path)
    assert.equal(
      JSON.parse(readFileSync(join(old, 'node_modules/dsh-px-updater/package.json'), 'utf8')).version,
      '1.0.0'
    )
    write(join(f.profile, 'node_modules/thirdparty/data.txt'), 'USER EDIT AFTER UPGRADE')
    assert.equal(
      readFileSync(join(old, 'node_modules/thirdparty/data.txt'), 'utf8'),
      'ORIGINAL DEPENDENCY',
      'backup does not share mutable inodes'
    )
    const marker = JSON.parse(readFileSync(join(f.home, '.dsh-px-managed-plugins.json'), 'utf8'))
    assert.equal(marker.plugins.length, 4)
    assert.ok(
      marker.plugins.every(
        (plugin: { files: Record<string, string> }) => Object.keys(plugin.files).length === 4
      )
    )
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('unknown custom sidebar packages are preserved and do not cause repeat migrations', async () => {
  const f = fixture()
  try {
    const packageDirectory = join(f.profile, 'node_modules/dsh-better-sidebar')
    write(
      join(packageDirectory, 'package.json'),
      JSON.stringify({ name: 'dsh-better-sidebar', version: '0.19.1' })
    )
    write(join(packageDirectory, 'lib/index.js'), 'USER CUSTOM SIDEBAR')
    assert.equal(await ensureManagedPlugins(f.options), true)
    assert.equal(inspectSidebarCompatibility(f.profile).state, 'unknown')
    assert.equal(readFileSync(join(packageDirectory, 'lib/index.js'), 'utf8'), 'USER CUSTOM SIDEBAR')
    assert.equal(await ensureManagedPlugins(f.options), false)
    assert.equal(listManagedPluginBackups(f.home).total, 1)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('a missing host entry or forged completed marker cannot pass migration', async () => {
  const f = fixture()
  try {
    rmSync(join(f.seedHome, 'profiles/web/node_modules/dsh-px-updater/lib/index.js'))
    await assert.rejects(ensureManagedPlugins(f.options))
    assert.equal(existsSync(join(f.home, '.dsh-px-managed-plugins.json')), false)
    makeBundle(join(f.seedHome, 'profiles/web/node_modules/dsh-px-updater'), 'dsh-px-updater', '2.0.0')
    await ensureManagedPlugins(f.options)
    rmSync(join(f.profile, 'node_modules/dsh-px-updater/lib/index.js'))
    assert.equal(await ensureManagedPlugins(f.options), true)
    assert.equal(existsSync(join(f.profile, 'node_modules/dsh-px-updater/lib/index.js')), true)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('failed validation and rename boundary recover all old dependencies and can retry', async () => {
  const f = fixture()
  try {
    const before = readFileSync(join(f.profile, 'package.json'), 'utf8')
    await assert.rejects(
      ensureManagedPlugins({
        ...f.options,
        validate: async () => {
          throw new Error('disk full / validation failure')
        }
      }),
      /完整旧 profile 已恢复/
    )
    assert.equal(readFileSync(join(f.profile, 'package.json'), 'utf8'), before)
    await assert.rejects(
      ensureManagedPlugins({
        ...f.options,
        onPhase: (phase) => {
          if (phase === 'old-moved') throw new Error('injected rename failure')
        }
      }),
      /完整旧 profile 已恢复/
    )
    assert.equal(readFileSync(join(f.profile, 'package.json'), 'utf8'), before)
    assert.equal(
      readFileSync(join(f.profile, 'node_modules/thirdparty/data.txt'), 'utf8'),
      'ORIGINAL DEPENDENCY'
    )
    assert.equal(await ensureManagedPlugins(f.options), true)
    assert.equal(await recoverManagedPluginMigration(f.options), 'none')
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('restart restores interrupted swap even when power loss preceded the next journal write', async () => {
  const f = fixture()
  try {
    const id = randomUUID(),
      backup = join(f.home, 'backups/managed-profiles', id, 'profile')
    mkdirSync(join(backup, '..'), { recursive: true })
    renameSync(f.profile, backup)
    write(
      join(f.home, '.dsh-px-profile-transaction.json'),
      JSON.stringify({
        schemaVersion: 1,
        id,
        identity: 'v2',
        profileName: 'web',
        phase: 'validated',
        createdAt: new Date().toISOString(),
        plugins: inspectManagedPlugins(join(f.seedHome, 'profiles/web'), 'bundled-runtime')
      })
    )
    assert.equal(await recoverManagedPluginMigration(f.options), 'restored')
    assert.equal(
      readFileSync(join(f.profile, 'node_modules/thirdparty/data.txt'), 'utf8'),
      'ORIGINAL DEPENDENCY'
    )
    assert.equal(await ensureManagedPlugins(f.options), true)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('concurrent calls serialize; internal links and external user links retain their meaning', async () => {
  const f = fixture()
  try {
    const external = join(f.root, 'external')
    write(join(external, 'package.json'), '{"name":"external"}')
    symlinkSync(
      join(f.profile, 'node_modules/thirdparty'),
      join(f.profile, 'node_modules/internal-link'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    symlinkSync(
      external,
      join(f.profile, 'node_modules/external-link'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    const results = await Promise.all([ensureManagedPlugins(f.options), ensureManagedPlugins(f.options)])
    assert.deepEqual(results, [true, false])
    assert.equal(
      realpathSync(join(f.profile, 'node_modules/internal-link')),
      realpathSync(join(f.profile, 'node_modules/thirdparty'))
    )
    assert.equal(realpathSync(join(f.profile, 'node_modules/external-link')), realpathSync(external))
    const backup = join(f.home, listManagedPluginBackups(f.home).items[0].path)
    assert.equal(
      realpathSync(join(backup, 'node_modules/internal-link')),
      realpathSync(join(backup, 'node_modules/thirdparty'))
    )
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('invalid transaction paths fail closed and preserve external files', async () => {
  const f = fixture()
  try {
    write(
      join(f.home, '.dsh-px-profile-transaction.json'),
      JSON.stringify({ schemaVersion: 1, id: '../../outside', profileName: 'web', phase: 'old-moved' })
    )
    await assert.rejects(recoverManagedPluginMigration(f.options), /路径标识无效/)
    assert.ok(existsSync(join(f.profile, 'package.json')))
    assert.equal(readdirSync(f.root).length, 2)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('a large profile keeps the event loop and progress live through copy and failure cleanup', async (t) => {
  const f = fixture()
  try {
    const large = join(f.profile, 'node_modules/thirdparty/large.dat')
    writeFileSync(large, Buffer.alloc(32 * 1024 * 1024, 0x71))
    for (let i = 0; i < 1500; i++)
      write(join(f.profile, 'node_modules/thirdparty/many', `${i}.txt`), 'fixture')
    let ticks = 0,
      maximumGap = 0,
      last = performance.now()
    const progress: number[] = []
    const heartbeat = setInterval(() => {
      const now = performance.now()
      maximumGap = Math.max(maximumGap, now - last)
      last = now
      ticks++
    }, 10)
    try {
      await assert.rejects(
        ensureManagedPlugins({
          ...f.options,
          onProgress: (value) => {
            progress.push(value.copied)
          },
          validate: async () => {
            throw new Error('failure after complete copy')
          }
        }),
        /完整旧 profile 已恢复/
      )
    } finally {
      clearInterval(heartbeat)
    }
    assert.ok(ticks >= 3, `event loop ticks: ${ticks}`)
    assert.ok(maximumGap < 5000, `maximum observed heartbeat gap: ${maximumGap} ms`)
    assert.ok(progress.length >= 2 && progress.at(-1)! >= 1500)
    t.diagnostic(
      `heartbeat ticks=${ticks}; maximum gap=${maximumGap.toFixed(1)}ms; progress updates=${progress.length}; copied=${progress.at(-1)}`
    )
    assert.equal(readFileSync(large).length, 32 * 1024 * 1024)
    assert.equal(
      JSON.parse(readFileSync(join(f.profile, 'node_modules/dsh-px-updater/package.json'), 'utf8')).version,
      '1.0.0'
    )
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('a recycled live PID does not retain an old process migration lock', async () => {
  const f = fixture()
  try {
    write(
      join(f.home, '.dsh-px-migration-lock/owner.json'),
      JSON.stringify({ pid: process.pid, processIdentity: 'previous-process-generation' })
    )
    assert.equal(await ensureManagedPlugins(f.options), true)
    assert.equal(existsSync(join(f.home, '.dsh-px-migration-lock')), false)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('an inactive developer package keeps its dangling directory link without blocking upgrades', async () => {
  const f = fixture()
  try {
    const missing = join(f.root, 'disabled-developer-source')
    mkdirSync(missing)
    symlinkSync(
      missing,
      join(f.profile, 'node_modules/disabled-local-plugin'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    rmSync(missing, { recursive: true })
    assert.equal(await ensureManagedPlugins(f.options), true)
    mkdirSync(missing)
    write(join(missing, 'package.json'), '{"name":"disabled-local-plugin"}')
    assert.equal(realpathSync(join(f.profile, 'node_modules/disabled-local-plugin')), realpathSync(missing))
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('configuration edits made while the staging profile is prepared are preserved and require a retry', async () => {
  const f = fixture()
  try {
    await assert.rejects(
      ensureManagedPlugins({
        ...f.options,
        validate: async () => {
          write(join(f.profile, 'cordis.patch.yml'), 'NEW USER PATCH DURING MIGRATION')
        }
      }),
      /准备期间变更/
    )
    assert.equal(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8'), 'NEW USER PATCH DURING MIGRATION')
    assert.equal(
      JSON.parse(readFileSync(join(f.profile, 'node_modules/dsh-px-updater/package.json'), 'utf8')).version,
      '1.0.0'
    )
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

function firstSeedFixture() {
  const f = fixture(),
    source = join(f.seedHome, 'profiles/web')
  const manifest = {
    private: true,
    dshPx: { seedSource: 'catalog' },
    dependencies: Object.fromEntries(
      MANAGED_PLUGIN_NAMES.map((name) => [name, `file:./.dsh-px-packages/${name}`])
    ),
    dsh: { profile: { bundles: [...MANAGED_PLUGIN_NAMES] } }
  }
  write(join(source, 'package.json'), JSON.stringify(manifest))
  write(join(source, 'cordis.patch.yml'), '[]\n')
  write(join(source, 'cordis.yml'), '[]\n')
  write(join(source, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  write(join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  for (const name of MANAGED_PLUGIN_NAMES)
    cpSync(join(source, 'node_modules', name), join(source, '.dsh-px-packages', name), { recursive: true })
  rmSync(f.profile, { recursive: true, force: true })
  cpSync(source, f.profile, { recursive: true })
  write(join(f.home, '.dsh-px-seed-claimed'), 'owned first preparation')
  const entry = join(f.root, 'native-validator.cjs')
  write(
    entry,
    `const fs=require('node:fs'),path=require('node:path'); if(!process.argv.includes('--dump-config'))process.exit(2); fs.writeFileSync(path.join(process.env.DSH_HOME,'profiles/web/cordis.yml'),'# native generated\\n[]\\n'); console.log('- id: native-fixture');`
  )
  return { ...f, options: { ...f.options, adoptSeed: true, runtimeNode: process.execPath, dshEntry: entry } }
}

test('a verified owned first seed is adopted without a second profile copy or backup', async () => {
  const f = firstSeedFixture()
  try {
    const file = join(f.profile, 'node_modules/dsh-px-updater/lib/index.js')
    const originalInode = statSync(file).ino
    const phases: string[] = []
    let validated = false
    assert.equal(
      await ensureManagedPlugins({
        ...f.options,
        onPhase: (phase) => {
          phases.push(phase)
        },
        validate: async (home) => {
          validated = true
          assert.notEqual(home, f.home)
          assert.match(readFileSync(join(home, 'profiles/web/cordis.yml'), 'utf8'), /native generated/)
        }
      }),
      true
    )
    assert.equal(validated, true)
    assert.deepEqual(phases, [], 'no full migration transaction was needed')
    assert.equal(listManagedPluginBackups(f.home).total, 0)
    assert.equal(statSync(file).ino, originalInode)
    assert.equal(
      readFileSync(join(f.profile, 'cordis.yml'), 'utf8'),
      '[]\n',
      'native validation only rewrites the disposable config view'
    )
    assert.equal(
      JSON.parse(readFileSync(join(f.home, '.dsh-px-managed-plugins.json'), 'utf8')).adoptedSeed,
      true
    )
    assert.equal(await ensureManagedPlugins(f.options), false)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

for (const difference of [
  'missing-claim',
  'managed-before',
  'changed-patch',
  'changed-client',
  'missing-vendor'
] as const) {
  test(`first-seed adoption falls back to the full transaction: ${difference}`, async () => {
    const f = firstSeedFixture()
    try {
      if (difference === 'missing-claim') rmSync(join(f.home, '.dsh-px-seed-claimed'))
      if (difference === 'managed-before')
        write(join(f.home, '.dsh-px-managed-plugins.json'), '{"schemaVersion":1,"identity":"old"}')
      if (difference === 'changed-patch') write(join(f.profile, 'cordis.patch.yml'), '[]\n# user change\n')
      if (difference === 'changed-client')
        write(join(f.profile, 'node_modules/dsh-px-updater/lib/client.js'), 'broken entry')
      if (difference === 'missing-vendor')
        rmSync(join(f.profile, '.dsh-px-packages/dsh-px-updater/lib/client.js'))
      assert.equal(await ensureManagedPlugins(f.options), true)
      assert.equal(listManagedPluginBackups(f.home).total, 1)
      assert.equal(
        JSON.parse(readFileSync(join(f.home, '.dsh-px-managed-plugins.json'), 'utf8')).adoptedSeed,
        false
      )
      if (difference === 'changed-patch')
        assert.equal(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8'), '[]\n# user change\n')
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })
}
