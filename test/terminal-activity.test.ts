import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  createTerminalActivityReader,
  type NativeTerminalRegistry,
  type TerminalSources
} from '../packages/dsh-px-workbench/src/terminal-activity'
import { activitySnapshot, isIdle } from '../packages/dsh-px-workbench/src/activity'
import { SIDEBAR_TERMINAL_PATCH_ID } from '../packages/shared/sidebar-terminal-contract'
import {
  applySidebarCompatibility,
  inspectSidebarCompatibility,
  patchSidebarSource,
  SIDEBAR_SOURCE,
  SIDEBAR_TERMINAL_ADAPTER_SOURCE
} from '../src/shared/sidebar-compatibility'

function tracked() {
  const exits: Array<() => void> = []
  const channels: Array<() => void> = []
  const alive = new Set<number>()
  let killed = 0
  const factory = vm.runInNewContext(SIDEBAR_TERMINAL_ADAPTER_SOURCE + '\ndshPxTrackTerminals', {
    setInterval,
    clearInterval,
    process: {
      kill: (pid: number) => {
        if (!alive.has(pid)) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      }
    }
  })
  return {
    exits,
    channels,
    alive,
    killed: () => killed,
    tracker: factory({
      spawn: () => {
        const pid = 1000 + exits.length
        alive.add(pid)
        return {
          pid,
          onExit: (fn: () => void) => {
            exits.push(() => {
              alive.delete(pid)
              fn()
            })
            channels.push(fn)
          },
          kill: () => {
            killed++
          }
        }
      }
    })
  }
}
test('both sidebar PTY users remain counted after close until actual exit, and teardown awaits every PTY', async () => {
  const f = tracked(),
    t = f.tracker
  const ui = t.adapter.spawn('shell'),
    agent = t.adapter.spawn('shell')
  assert.equal(t.snapshot().openTerminals, 2)
  ui.kill()
  assert.equal(t.snapshot().openTerminals, 2, 'requesting kill does not prove exit')
  f.exits[0]()
  assert.equal(t.snapshot().openTerminals, 1)
  t.beginClose()
  assert.throws(() => t.adapter.spawn('shell'), /stopping/)
  let settled = false
  const cleanup = t.waitUntilClosed().then(() => {
    settled = true
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(settled, false)
  agent.kill()
  f.exits[1]()
  await cleanup
  assert.equal(t.snapshot().openTerminals, 0)
  assert.equal(t.snapshot().closing, true)
  assert.equal(f.killed(), 2)
})
test('a PTY that cannot be observed makes activity unknown, and spawn failure does not create phantom idle success', () => {
  const factory = vm.runInNewContext(SIDEBAR_TERMINAL_ADAPTER_SOURCE + '\ndshPxTrackTerminals', {
    setInterval,
    clearInterval,
    process: { kill: () => {} }
  })
  const failure = factory({
    spawn: () => {
      throw Error('spawn failed')
    }
  })
  assert.throws(() => failure.adapter.spawn(), /spawn failed/)
  assert.equal(failure.snapshot().openTerminals, 0)
  const unobservable = factory({
    spawn: () => ({
      onExit: () => {
        throw Error('observe failed')
      },
      kill: () => {}
    })
  })
  assert.throws(() => unobservable.adapter.spawn(), /observe failed/)
  assert.equal(unobservable.snapshot().known, false)
  assert.equal(unobservable.snapshot().openTerminals, 1)
  assert.equal(factory(null).snapshot().openTerminals, 0)
})
test('pipe closure cannot claim an active process exited, and lost exit events still drain after OS death', async () => {
  const f = tracked(),
    tracker = f.tracker
  tracker.adapter.spawn()
  f.channels[0]()
  assert.equal(tracker.snapshot().known, false)
  assert.equal(tracker.snapshot().openTerminals, 1)
  let settled = false
  const pending = tracker.waitUntilClosed().then(() => {
    settled = true
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(settled, false)
  f.alive.clear()
  await pending
  assert.equal(tracker.snapshot().known, true)
  assert.equal(tracker.snapshot().openTerminals, 0)
  tracker.adapter.spawn()
  f.alive.clear()
  assert.equal(
    tracker.snapshot().openTerminals,
    0,
    'OS death is sufficient even if exit notification was lost'
  )
})
test('missing/disabled sidebar and incompatible activity contract are distinct from an idle service', () => {
  const read = createTerminalActivityReader()
  let disabled = false,
    count = 2,
    service: any
  const sources: TerminalSources = {
    entries: () => [{ options: { name: 'dsh-better-sidebar' }, disabled }],
    sidebar: () => service,
    native: () => undefined
  }
  assert.equal(read([], sources).known, false)
  for (const known of ['false', 1]) {
    service = {
      version: 1,
      patchId: SIDEBAR_TERMINAL_PATCH_ID,
      snapshot: () => ({ known, openTerminals: 0, closing: false })
    }
    assert.equal(createTerminalActivityReader()([], sources).known, false)
  }
  service = {
    version: 1,
    patchId: SIDEBAR_TERMINAL_PATCH_ID,
    snapshot: () => ({ known: true, openTerminals: count, closing: false })
  }
  assert.deepEqual(read([], sources), { known: true, openTerminals: 2 })
  service = undefined
  disabled = true
  assert.equal(read([], sources).openTerminals, 2, 'unmount does not erase previously observed PTYs')
  count = 0
  assert.deepEqual(read([], sources), { known: true, openTerminals: 0 })
  assert.equal(createTerminalActivityReader()([], sources).known, true)
  assert.equal(
    createTerminalActivityReader()([]).known,
    false,
    'without native loader evidence, absence is unknown'
  )
  service = {
    version: 2,
    patchId: 'other',
    snapshot: () => ({ known: true, openTerminals: 0, closing: false })
  }
  assert.equal(read([], sources).known, false)
})
test('native terminal pending spawns and removed owners are retained through native cleanup', () => {
  const read = createTerminalActivityReader(),
    owner = { ctx: { get: () => undefined } }
  let active = true,
    published = 0
  const registry: NativeTerminalRegistry = {
    hasOwnerActivity: () => active,
    list: () => Array.from({ length: published })
  }
  const sources: TerminalSources = { entries: () => [], sidebar: () => undefined, native: () => registry }
  assert.equal(read([owner], sources).openTerminals, 1)
  published = 2
  assert.equal(read([owner], sources).openTerminals, 2)
  sources.native = () =>
    new Proxy(registry, {
      get: (target, key) => (key === Symbol.for('cordis.original') ? target : Reflect.get(target, key))
    })
  for (let n = 0; n < 100; n++)
    assert.equal(
      read([owner], sources).openTerminals,
      2,
      'caller-bound Cordis proxies still identify one native registry'
    )
  assert.equal(read([], sources).openTerminals, 2)
  active = false
  assert.equal(read([], sources).openTerminals, 0)
})
test('workbench does not report idle for open, invalid or unavailable terminal resources', () => {
  for (const terminal of [
    { known: true, openTerminals: 1 },
    { known: true, openTerminals: NaN },
    { known: false, openTerminals: 0 },
    { known: 'false' as any, openTerminals: 0 }
  ]) {
    assert.equal(
      isIdle(
        activitySnapshot({
          agents: { list: () => [] },
          jobs: { list: () => [] },
          terminalActivity: () => terminal
        })
      ),
      false
    )
  }
})
test('compatibility helper preserves unknown and linked packages', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-sidebar-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const profile = join(root, 'profile'),
    pkg = join(profile, 'node_modules', SIDEBAR_SOURCE.name)
  mkdirSync(join(pkg, 'lib'), { recursive: true })
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: SIDEBAR_SOURCE.name, version: SIDEBAR_SOURCE.version })
  )
  writeFileSync(join(pkg, 'lib/index.js'), 'user source')
  assert.equal(applySidebarCompatibility(profile).state, 'unknown')
  assert.equal(readFileSync(join(pkg, 'lib/index.js'), 'utf8'), 'user source')
  const second = join(root, 'linked')
  mkdirSync(join(second, 'node_modules'), { recursive: true })
  symlinkSync(pkg, join(second, 'node_modules', SIDEBAR_SOURCE.name), 'junction')
  assert.equal(applySidebarCompatibility(second).state, 'unknown')
  assert.equal(readFileSync(join(pkg, 'lib/index.js'), 'utf8'), 'user source')
  assert.throws(() => patchSidebarSource('user source'), /原始来源/)
})
// The positive source integration is also run against npm-verified bytes during runtime staging.
const original = resolve('build-test/sidebar-source-0.19.1/index.original.js')
test(
  'verified original host transforms to fixed digest and atomic patching is idempotent',
  { skip: !existsSync(original) },
  (t) => {
    const root = mkdtempSync(join(tmpdir(), 'dshpx-sidebar-known-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const pkg = join(root, 'node_modules', SIDEBAR_SOURCE.name)
    mkdirSync(join(pkg, 'lib'), { recursive: true })
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: SIDEBAR_SOURCE.name, version: SIDEBAR_SOURCE.version })
    )
    writeFileSync(join(pkg, 'lib/index.js'), readFileSync(original))
    assert.equal(inspectSidebarCompatibility(root).state, 'original-known')
    const patched = applySidebarCompatibility(root)
    assert.equal(patched.state, 'patched-known')
    assert.equal(patched.sha256, SIDEBAR_SOURCE.patchedSha256)
    assert.deepEqual(applySidebarCompatibility(root), patched)
    const code = readFileSync(join(pkg, 'lib/index.js'), 'utf8')
    assert.equal(createHash('sha256').update(code).digest('hex'), SIDEBAR_SOURCE.patchedSha256)
    assert.match(code, /ctx\.provide\("dshPxSidebarTerminals"/)
    assert.match(code, /await dshPxTerminals\.waitUntilClosed\(\)/)
  }
)
