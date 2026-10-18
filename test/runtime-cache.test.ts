import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { materializePackRuntime } from '../src/main/runtime-cache'
import { FOUNDATION_PLUGINS } from '../src/shared/distribution'

function fixture(t: TestContext) {
  const parent = fs.realpathSync(tmpdir())
  const root = fs.realpathSync(fs.mkdtempSync(join(parent, 'px-runtime-cache-')))
  const write = (name: string, value: object) => {
    const path = join(root, name)
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, JSON.stringify(value))
  }
  write('runtime/desktop-runtime.json', { fixture: true })
  write('runtime/node_modules/@deepseek-ai/dsh/package.json', { name: '@deepseek-ai/dsh', dependencies: {} })
  write('runtime/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js', {})
  write('foundation/package.json', {
    name: 'dsh-px-core',
    version: 'fixture',
    dependencies: Object.fromEntries(FOUNDATION_PLUGINS.map((name) => [name, 'fixture']))
  })
  for (const name of FOUNDATION_PLUGINS) write(`foundation/node_modules/${name}/package.json`, { name })
  t.after(() => {
    assert.ok(root.startsWith(parent + sep))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  })
  return {
    root,
    options: {
      profile: join(root, 'profile'),
      bundledRuntime: join(root, 'runtime'),
      foundationDirectory: join(root, 'foundation'),
      hostKey: 'fixture-host',
      packSha256: 'a'.repeat(64),
      version: 'fixture'
    }
  }
}

test('runtime cache activation retries transient Windows renames and reuses only completed views', async (t) => {
  const f = fixture(t),
    original = fs.renameSync
  const attempts = new Map<string, number>()
  fs.renameSync = (from, to) => {
    if (String(from).startsWith(f.root + sep)) {
      const name = basename(String(to)),
        count = (attempts.get(name) ?? 0) + 1
      attempts.set(name, count)
      if (process.platform === 'win32' && count < 3)
        throw Object.assign(new Error('temporary Windows interference'), { code: 'EPERM' })
    }
    original(from, to)
  }
  syncBuiltinESMExports()
  t.after(() => {
    fs.renameSync = original
    syncBuiltinESMExports()
  })
  const view = await materializePackRuntime(f.options)
  assert.equal(attempts.size, 2, 'Both host and Pack publication must use the retried rename path')
  assert.ok([...attempts.values()].every((count) => count === (process.platform === 'win32' ? 3 : 1)))
  assert.ok(fs.existsSync(join(view, '.px-runtime-cache.json')))
  const anchor = JSON.parse(fs.readFileSync(join(view, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
  assert.equal(anchor.dependencies['dsh-px-core'], 'fixture')
  const beforeReuse = [...attempts]
  assert.equal(await materializePackRuntime(f.options), view)
  assert.deepEqual([...attempts], beforeReuse, 'A ready cache must not be rebuilt')
})

test('persistent cache rename denial never publishes a ready path and later recovery needs no deletion', async (t) => {
  const f = fixture(t),
    original = fs.renameSync
  let blocked = true,
    attempts = 0
  fs.renameSync = (from, to) => {
    if (blocked && String(from).startsWith(f.root + sep)) {
      attempts++
      throw Object.assign(new Error('persistent directory lock'), { code: 'EPERM' })
    }
    original(from, to)
  }
  syncBuiltinESMExports()
  t.after(() => {
    fs.renameSync = original
    syncBuiltinESMExports()
  })
  await assert.rejects(materializePackRuntime(f.options), /persistent directory lock/)
  assert.equal(attempts, process.platform === 'win32' ? 9 : 1)
  const cache = join(f.options.profile, '.dsh-px/runtime-cache')
  assert.ok(fs.readdirSync(cache).every((name) => name.startsWith('.host-')))
  blocked = false
  const view = await materializePackRuntime(f.options)
  assert.ok(fs.existsSync(join(view, '.px-runtime-cache.json')))
})
