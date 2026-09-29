import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTerminalActivityReader,
  type NativeTerminalRegistry,
  type TerminalSources
} from '../packages/dsh-px-workbench/src/terminal-activity'
import { activitySnapshot, isIdle } from '../packages/dsh-px-workbench/src/activity'
import { SIDEBAR_TERMINAL_PATCH_ID } from '../packages/shared/sidebar-terminal-contract'

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
