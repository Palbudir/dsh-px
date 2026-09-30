import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTerminalActivityReader,
  type NativeTerminalRegistry,
  type TerminalSources
} from '../packages/dsh-px-workbench/src/terminal-activity'
import { activitySnapshot, isIdle } from '../packages/dsh-px-workbench/src/activity'

test('without the native terminals service, terminal activity is unknown rather than idle', () => {
  assert.equal(createTerminalActivityReader()([]).known, false)
})

test('an available native terminals service with no activity reports a known zero', () => {
  const idle: NativeTerminalRegistry = { hasOwnerActivity: () => false, list: () => [] }
  const owner = { ctx: { get: () => undefined } }
  assert.deepEqual(createTerminalActivityReader()([owner], { native: () => idle }), {
    known: true,
    openTerminals: 0
  })
})

test('an incompatible native registry is unknown, never idle', () => {
  const owner = { ctx: { get: () => undefined } }
  const broken = { hasOwnerActivity: () => 'yes', list: () => [] } as unknown as NativeTerminalRegistry
  assert.equal(createTerminalActivityReader()([owner], { native: () => broken }).known, false)
  const throwing: NativeTerminalRegistry = {
    hasOwnerActivity: () => {
      throw new Error('incompatible')
    },
    list: () => []
  }
  assert.equal(createTerminalActivityReader()([owner], { native: () => throwing }).known, false)
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
  const sources: TerminalSources = { native: () => registry }
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
