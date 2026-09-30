import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTerminalActivityReader,
  registerTerminalActivity,
  type BrowserTerminalController,
  type NativeTerminalRegistry,
  type TerminalSources
} from '../packages/dsh-px-workbench/src/terminal-activity'
import { activitySnapshot, isIdle } from '../packages/dsh-px-workbench/src/activity'

const idleNative: NativeTerminalRegistry = { hasOwnerActivity: () => false, list: () => [] }
const noShells: BrowserTerminalController = { list: () => [] }
const owner = (id = 'session-1') => ({ id, ctx: { get: () => undefined } })

test('without both terminal services, terminal activity is unknown rather than idle', () => {
  assert.equal(createTerminalActivityReader()([]).known, false)
})

test('real composition: terminalController at host level, terminals only inside each Agent', () => {
  // Official presets isolate `terminals` inside each Agent's plugin group; only
  // `terminalController` is a host service. Activity must be known in that composition.
  const effects: Array<() => void> = []
  const injected = new Map<string, (host: any) => void>()
  const read = registerTerminalActivity({
    inject: (names, apply) => injected.set(names[0], apply)
  })
  assert.equal(read([owner()]).known, false, 'before terminalController is bound')
  injected.get('terminalController')!({
    terminalController: { list: (id: string) => (id === 'session-1' ? [{ id: 'shell' }] : []) },
    effect: (setup: () => () => void) => effects.push(setup())
  })
  const agentTerminals: NativeTerminalRegistry = { hasOwnerActivity: () => true, list: () => [{}, {}] }
  const withTerminals = {
    id: 'session-1',
    ctx: { get: (name: string) => (name === 'terminals' ? agentTerminals : undefined) }
  }
  const withoutTerminals = { id: 'session-2', ctx: { get: () => undefined } }
  assert.deepEqual(read([withTerminals, withoutTerminals]), { known: true, openTerminals: 3 })
  // An Agent that leaves the list keeps its terminals counted until its registry drains.
  assert.deepEqual(read([withoutTerminals]), { known: true, openTerminals: 2 })
  const fresh = registerTerminalActivity({ inject: (names, apply) => injected.set(names[0], apply) })
  injected.get('terminalController')!({ terminalController: { list: () => [] }, effect: () => {} })
  assert.deepEqual(fresh([withoutTerminals]), { known: true, openTerminals: 0 })
  // Disposing terminalController makes the count unknown again.
  for (const dispose of effects) dispose()
  assert.equal(read([withoutTerminals]).known, false)
})

test('no Agent terminal and no open sidebar shell reports a known zero', () => {
  assert.deepEqual(
    createTerminalActivityReader()([owner()], { native: () => idleNative, browser: noShells }),
    { known: true, openTerminals: 0 }
  )
})

test('an open sidebar shell (terminalController) is counted, so the service never looks idle', () => {
  const shells: BrowserTerminalController = {
    list: (sessionId) => (sessionId === 'session-1' ? [{ id: 'shell-a' }, { id: 'shell-b' }] : [])
  }
  const read = createTerminalActivityReader()
  const sources: TerminalSources = { native: () => idleNative, browser: shells }
  assert.deepEqual(read([owner('session-1'), owner('session-2')], sources), {
    known: true,
    openTerminals: 2
  })
  assert.equal(
    isIdle(
      activitySnapshot({
        agents: { list: () => [] },
        jobs: { list: () => [] },
        terminalActivity: () => read([owner('session-1')], sources)
      })
    ),
    false
  )
})

test('an incompatible native registry or shell list is unknown, never idle', () => {
  const broken = { hasOwnerActivity: () => 'yes', list: () => [] } as unknown as NativeTerminalRegistry
  assert.equal(
    createTerminalActivityReader()([owner()], { native: () => broken, browser: noShells }).known,
    false
  )
  const throwing: NativeTerminalRegistry = {
    hasOwnerActivity: () => {
      throw new Error('incompatible')
    },
    list: () => []
  }
  assert.equal(
    createTerminalActivityReader()([owner()], { native: () => throwing, browser: noShells }).known,
    false
  )
  const badShells = { list: () => 'x' } as unknown as BrowserTerminalController
  assert.equal(
    createTerminalActivityReader()([owner()], { native: () => idleNative, browser: badShells }).known,
    false
  )
  // An owner without a Session id cannot be matched to its sidebar shells.
  assert.equal(
    createTerminalActivityReader()([{ ctx: { get: () => undefined } }], {
      native: () => idleNative,
      browser: noShells
    }).known,
    false
  )
})

test('native terminal pending spawns and removed owners are retained through native cleanup', () => {
  const read = createTerminalActivityReader(),
    agent = owner()
  let active = true,
    published = 0
  const registry: NativeTerminalRegistry = {
    hasOwnerActivity: () => active,
    list: () => Array.from({ length: published })
  }
  const sources: TerminalSources = { native: () => registry, browser: noShells }
  assert.equal(read([agent], sources).openTerminals, 1)
  published = 2
  assert.equal(read([agent], sources).openTerminals, 2)
  sources.native = () =>
    new Proxy(registry, {
      get: (target, key) => (key === Symbol.for('cordis.original') ? target : Reflect.get(target, key))
    })
  for (let n = 0; n < 100; n++)
    assert.equal(
      read([agent], sources).openTerminals,
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
