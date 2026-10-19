import test from 'node:test'
import assert from 'node:assert/strict'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { memoryNavigation } from '../packages/dsh-px-memory/src/workspace-navigation'

function setup(initiallyDeclared = true) {
  const core = new SlotCore() as any
  const native = () => 'native',
    px = () => 'px',
    icon = () => 'icon'
  let offRoot = () => {},
    offNative = () => {}
  const declare = () => {
    offRoot = core.register(
      {
        name: 'root',
        children: {
          main: { kind: 'keyed', scope: 'root' },
          'sidebar.panellist': { kind: 'list', scope: 'root' }
        }
      },
      () => null
    )
    offNative = core.register({ name: 'main', key: 'mnemon' }, native)
    core.register({ name: 'sidebar.panellist', id: 'mnemon', label: '记忆系统' }, icon)
  }
  if (initiallyDeclared) declare()
  const inject = (slot: string, setup: () => () => void) => {
    let cleanup: (() => void) | undefined,
      epoch = -1
    const refresh = () => {
      const next = core.declarationEpoch(slot)
      if (next === epoch) return
      epoch = next
      cleanup?.()
      cleanup = undefined
      if (core.spec(slot)) cleanup = setup()
    }
    const off = core.subscribeDeclaration(slot, refresh)
    refresh()
    return () => {
      off()
      cleanup?.()
    }
  }
  let activePanelId: string | null = 'mnemon'
  const listeners = new Set<() => void>()
  const host = {
    slots: {
      register: core.register.bind(core),
      entries: core.entries.bind(core),
      subscribe: core.subscribe.bind(core),
      inject
    },
    layout: {
      panelInfo: {
        getSnapshot: () => ({ activePanelId }),
        subscribe: (f: () => void) => {
          listeners.add(f)
          return () => listeners.delete(f)
        }
      },
      selectPanel: (id: string | null) => {
        activePanelId = id
        for (const f of listeners) f()
      }
    }
  }
  const navigation = memoryNavigation(host, px, icon)
  return {
    core,
    host,
    native,
    px,
    navigation,
    offNative: () => offNative(),
    declare,
    collapse: () => offRoot()
  }
}
test('native priority shadowing keeps one entry and restores the community owner when PX stops', () => {
  const f = setup()
  assert.equal(f.core.entriesOfSlot('main')[0].component, f.px)
  assert.equal(f.core.entriesOfSlot('sidebar.panellist').length, 1)
  assert.equal(f.core.entriesOfSlot('sidebar.panellist')[0].options.label, '记忆与知识')
  f.navigation.dispose()
  assert.equal(f.core.entriesOfSlot('main')[0].component, f.native)
  assert.equal(f.core.entriesOfSlot('sidebar.panellist')[0].options.label, '记忆系统')
})
test('advanced view delegates to the native owner, and leaving it restores the unified home without leaks', () => {
  const f = setup()
  for (let i = 0; i < 3; i++) {
    f.navigation.openNative()
    assert.equal(f.core.entriesOfSlot('main')[0].component, f.native)
    f.host.layout.selectPanel(null)
    f.navigation.open()
    assert.equal(f.core.entriesOfSlot('main')[0].component, f.px)
    assert.equal(f.core.entries('main').length, 2)
  }
  f.navigation.dispose()
})
test('missing native view reports a real limitation while persona and history remain accessible', () => {
  const f = setup()
  f.offNative()
  assert.throws(() => f.navigation.openNative(), /原生记忆管理页未启用/)
  assert.equal(f.core.entriesOfSlot('main')[0].component, f.px)
  f.navigation.dispose()
})
test('disposing PX while the advanced view is open does not remove the native view or remount PX', () => {
  const f = setup()
  f.navigation.openNative()
  f.navigation.dispose()
  f.host.layout.selectPanel(null)
  assert.equal(f.core.entriesOfSlot('main')[0].component, f.native)
  assert.equal(f.core.entries('main').length, 1)
})

test('advanced navigation survives native declaration teardown and recreation', () => {
  const f = setup()
  f.navigation.openNative()
  f.collapse()
  f.declare()
  assert.equal(f.core.entriesOfSlot('main')[0].component, f.native)
  f.host.layout.selectPanel(null)
  f.navigation.open()
  assert.equal(f.core.entriesOfSlot('main')[0].component, f.px)
  f.navigation.dispose()
})
test('opening before native declarations is safe and reconciles once they become available', () => {
  const f = setup(false)
  f.navigation.open()
  assert.equal(f.core.entriesOfSlot('main').length, 0)
  f.declare()
  assert.equal(f.core.entriesOfSlot('main')[0].component, f.px)
  f.navigation.dispose()
})
test('removing the native owner from another window while advanced is open restores the PX page', async () => {
  const f = setup()
  f.navigation.openNative()
  f.offNative()
  await Promise.resolve()
  assert.equal(f.core.entriesOfSlot('main')[0].component, f.px)
  f.navigation.dispose()
})
