import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { buildSync } from 'esbuild'
import { acquireMigrationLease, claimMigrationDirectory } from '../src/main/migration-lease'
import { withManagedProfileMaintenance } from '../src/main/managed-plugins'

test('migration lease excludes competing connections during stale-owner recovery and releases on completion', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'px-migration-lease-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const release = acquireMigrationLease(home)
  try {
    assert.throws(() => acquireMigrationLease(home), /另一个进程/)
  } finally {
    release()
  }
  release()
  acquireMigrationLease(home)()
})

test('claim retries transient Windows failures but never replaces a newly appeared owner', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'px-migration-claim-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const source = join(home, 'mine'),
    target = join(home, 'lock')
  mkdirSync(source)
  writeFileSync(join(source, 'owner.json'), 'mine')
  let attempts = 0
  await claimMigrationDirectory(source, target, {
    platform: 'win32',
    wait: async () => {},
    rename: (a, b) => {
      if (++attempts === 1) throw Object.assign(new Error('busy'), { code: 'EPERM' })
      renameSync(a, b)
    }
  })
  assert.equal(attempts, 2)
  assert.equal(readFileSync(join(target, 'owner.json'), 'utf8'), 'mine')
  rmSync(target, { recursive: true })
  mkdirSync(source)
  writeFileSync(join(source, 'owner.json'), 'mine')
  attempts = 0
  await assert.rejects(
    claimMigrationDirectory(source, target, {
      platform: 'win32',
      rename: () => {
        attempts++
        throw Object.assign(new Error('busy'), { code: 'EPERM' })
      },
      wait: async () => {
        mkdirSync(target)
        writeFileSync(join(target, 'owner.json'), 'competitor')
      }
    }),
    /已被认领/
  )
  assert.equal(attempts, 1)
  assert.equal(readFileSync(join(target, 'owner.json'), 'utf8'), 'competitor')
  assert.equal(readFileSync(join(source, 'owner.json'), 'utf8'), 'mine')
})

test('two real maintenance processes cannot both reclaim a stale owner; crashed lease owners can recover', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'px-maintenance-race-'))
  const children: ChildProcess[] = []
  t.after(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close')
        child.kill()
        await closed
      }
    rmSync(home, { recursive: true, force: true })
  })
  const lock = join(home, '.dsh-px-migration-lock')
  mkdirSync(lock)
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 999999, processIdentity: 'expired' }))
  const module = join(home, 'maintenance.mjs')
  buildSync({
    entryPoints: ['src/main/managed-plugins.ts'],
    outfile: module,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external'
  })
  const code = `const {withManagedProfileMaintenance}=await import(process.argv[1]);try{await withManagedProfileMaintenance({home:process.argv[2],profileName:'web'},()=>{console.log('HELD');return new Promise(()=>{setInterval(()=>{},1000)})})}catch(e){if(!String(e).includes('另一个进程'))throw e;console.log('BUSY')}`
  const start = () => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', code, pathToFileURL(module).href, home],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    children.push(child)
    const result = new Promise<string>((resolve, reject) => {
      let output = '',
        errors = ''
      const timer = setTimeout(() => reject(new Error('Child did not settle: ' + errors)), 10000)
      child.stderr!.on('data', (b) => {
        errors += b
      })
      child.stdout!.on('data', (b) => {
        output += b
        if (/HELD|BUSY/.test(output)) {
          clearTimeout(timer)
          resolve(output.includes('HELD') ? 'HELD' : 'BUSY')
        }
      })
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.on('close', (code) => {
        if (code) {
          clearTimeout(timer)
          reject(new Error(errors))
        }
      })
    })
    return { child, result }
  }
  const a = start(),
    b = start()
  const results = await Promise.all([a.result, b.result])
  assert.deepEqual([...results].sort(), ['BUSY', 'HELD'])
  const owner = results[0] === 'HELD' ? a.child : b.child
  assert.equal(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')).pid, owner.pid)
  const closed = once(owner, 'close')
  owner.kill()
  await closed
  let entered = 0
  await withManagedProfileMaintenance({ home, profileName: 'web' }, () => {
    entered++
  })
  assert.equal(entered, 1)
})
