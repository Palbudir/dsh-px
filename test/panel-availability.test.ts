import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { createCapabilities } from '../packages/shared/client-capabilities'
import { createQuoteRequests } from '../packages/shared/quote-requests'

const entries = {
  SessionBar: 'packages/dsh-px-workspace/src/client/session-bar.tsx',
  QuoteAction: 'packages/dsh-px-workspace/src/client/quote-action.tsx',
  ArtifactsPanel: 'packages/dsh-px-workspace/src/client/artifacts.tsx',
  Entry: 'packages/dsh-px-workspace/src/client.tsx'
}
const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(entries).map(async ([name, entry]) => {
      const result = await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'browser',
        jsx: 'automatic',
        external: ['react', 'react/jsx-runtime'],
        logLevel: 'silent',
        plugins: [
          {
            name: 'panel-component-fixture',
            setup(builder) {
              builder.onResolve(
                { filter: /(?:^\.\/data$|^\.\/layout$|^\.\/host-layout$|shared\/ui$)/ },
                (args) => ({
                  path: args.path.endsWith('/data')
                    ? 'fixture-data'
                    : args.path.endsWith('/layout')
                      ? 'fixture-layout'
                      : args.path.endsWith('/host-layout')
                        ? 'fixture-host'
                        : 'fixture-ui',
                  external: true
                })
              )
            }
          }
        ]
      })
      return [name, result.outputFiles[0].text]
    })
  )
)

const panelIds = [
  'editor',
  'terminal',
  'px-artifacts',
  'git',
  'dsh-px-taskflow',
  'subagent',
  'px-notes',
  'px-schedules'
]
function sidebarFixture(ids = panelIds) {
  const descriptors = new Map(ids.map((id) => [id, { id }])),
    disabled = new Set<string>(),
    registry = new Set<() => void>(),
    state = new Set<() => void>()
  const calls: Array<{ method: string; args: unknown[] }> = []
  let failOpen = false
  let tabError: (() => void) | undefined
  const service = {
    getTab: (id: string) => descriptors.get(id),
    isTabEnabled: (id: string) => !disabled.has(id),
    subscribe: (fn: () => void) => {
      registry.add(fn)
      return () => {
        registry.delete(fn)
      }
    },
    subscribeState: (fn: () => void) => {
      state.add(fn)
      return () => {
        state.delete(fn)
      }
    },
    getSnapshot: () => ({}),
    registerTab: (_definition: unknown) => () => {},
    openTab: (...args: unknown[]) => {
      tabError?.()
      calls.push({ method: 'tab', args })
    },
    openFile: (...args: unknown[]) => {
      if (failOpen) throw Error('fixture file provider failed')
      calls.push({ method: 'file', args })
    }
  }
  return {
    service,
    calls,
    registry,
    state,
    register: (id: string) => {
      descriptors.set(id, { id })
      registry.forEach((fn) => fn())
    },
    unregister: (id: string) => {
      descriptors.delete(id)
      registry.forEach((fn) => fn())
    },
    setEnabled: (id: string, value: boolean) => {
      if (value) disabled.delete(id)
      else disabled.add(id)
      state.forEach((fn) => fn())
    },
    failOpen: () => {
      failOpen = true
    },
    failTab: (before?: () => void) => {
      tabError = () => {
        before?.()
        throw Error('fixture tab provider failed')
      }
    }
  }
}
function nativeFixture() {
  const kinds = new Set<string>(),
    listeners = new Set<() => void>(),
    calls: unknown[][] = []
  return {
    listeners,
    calls,
    registry: {
      get: (kind: string) => (kinds.has(kind) ? { kind } : undefined),
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => {
          listeners.delete(fn)
        }
      }
    },
    controller: {
      openTabIn: (...args: unknown[]) => {
        calls.push(args)
      }
    },
    setRegistered: (value: boolean) => {
      if (value) kinds.add('terminal')
      else kinds.delete('terminal')
      listeners.forEach((fn) => fn())
    }
  }
}
function fixture(name: keyof typeof entries, sidebar = sidebarFixture()) {
  let cursor = 0,
    queued = true,
    tree: any,
    effects: Array<() => void> = []
  const hooks: any[] = [],
    effectHooks: any[] = []
  const update = () => {
    queued = true
  }
  const native = nativeFixture()
  native.setRegistered(true)
  const capabilities = createCapabilities<any>({
    sidebar: sidebar.service,
    terminal: native.controller,
    nativeTabs: native.registry
  })
  const quotes = createQuoteRequests(),
    notifications: string[] = []
  const sessions = createCapabilities({
    current: 's',
    phase: 'ready',
    ids: ['s'],
    byId: { s: { id: 's', title: 'Session', displayTitle: 'Session', running: false, cwd: 'C:/fixture' } },
    jobsBySession: {}
  })
  const ctx: any = {
    capabilities,
    sessions: { list: sessions, scope: () => ({ sessionId: 's' }), clear: () => {} },
    uiWorkspace: { openSession: () => {}, startSession: () => {} },
    conversation: {
      input: { for: () => ({ notify: (_level: string, text: string) => notifications.push(text) }) }
    }
  }
  const react = {
    useState(initial: any) {
      const id = cursor++
      if (!(id in hooks)) hooks[id] = typeof initial === 'function' ? initial() : initial
      return [
        hooks[id],
        (value: any) => {
          const next = typeof value === 'function' ? value(hooks[id]) : value
          if (!Object.is(next, hooks[id])) {
            hooks[id] = next
            update()
          }
        }
      ]
    },
    useRef(initial: any) {
      const id = cursor++
      if (!(id in hooks)) hooks[id] = { current: initial }
      return hooks[id]
    },
    useEffect(callback: () => any, deps: any[]) {
      const id = cursor++,
        old = effectHooks[id]
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
        effectHooks[id] = { deps, callback, cleanup: old?.cleanup }
        effects.push(() => {
          effectHooks[id].cleanup?.()
          effectHooks[id].cleanup = callback()
        })
      }
    }
  }
  function useSnapshot(store: any) {
    const [value, set] = react.useState(store.getSnapshot)
    react.useEffect(() => {
      const changed = () => set(store.getSnapshot())
      changed()
      return store.subscribe(changed)
    }, [store])
    return value
  }
  let tabs = { ids: ['s'], pins: [], closed: [], titles: { s: 'Session' } }
  const data = {
    useSnapshot,
    errorText: String,
    quoteRequests: quotes,
    requestQuote: quotes.request,
    base: '/fixture',
    stamp: String,
    useData: () => ({
      data: {
        artifacts: [{ path: 'C:/fixture/result.md', description: 'Result', time: 1 }],
        artifactTotal: 1,
        nextArtifactBefore: null
      },
      error: '',
      loading: false,
      refresh: () => {}
    })
  }
  const layout = {
    useSessionLayout: () => ({
      tabs,
      ready: true,
      warning: '',
      setTabs: (value: any) => {
        const next = typeof value === 'function' ? value(tabs) : value
        if (!Object.is(next, tabs)) {
          tabs = next
          update()
        }
      },
      restore: () => {},
      keepCurrent: () => {}
    })
  }
  const module: { exports: any } = { exports: {} }
  const jsx = (type: any, props: any) => ({ type, props })
  const windowListeners = new Set<unknown>()
  runInNewContext(sources[name], {
    module,
    exports: module.exports,
    requestAnimationFrame: (fn: () => void) => fn(),
    document: {
      querySelector: () => null,
      createElement: () => ({ remove: () => {} }),
      head: { appendChild: () => {} }
    },
    window: {
      addEventListener: (_name: string, fn: unknown) => windowListeners.add(fn),
      removeEventListener: (_name: string, fn: unknown) => windowListeners.delete(fn)
    },
    require: (id: string) =>
      (
        ({
          react,
          'react/jsx-runtime': { jsx, jsxs: jsx },
          'fixture-data': data,
          'fixture-layout': layout,
          'fixture-host': { attachToolbarLayout: () => () => {}, isTypingTarget: () => false },
          'fixture-ui': { Icon() {}, ConfirmDelete() {}, installUiStyles() {} }
        }) as any
      )[id]
  })
  function flush() {
    for (let n = 0; n < 30; n++) {
      if (!queued) return
      queued = false
      cursor = 0
      effects = []
      tree = module.exports[name]({
        ctx,
        scope: { sessionId: 's', cwd: 'C:/fixture' },
        visible: true,
        tab: {},
        sessionId: 's',
        messageId: 'm'
      })
      const pending = effects
      effects = []
      pending.forEach((effect) => effect())
    }
    throw Error('component did not settle')
  }
  const nodes = (value: any): any[] =>
    Array.isArray(value)
      ? value.flatMap(nodes)
      : value && typeof value === 'object'
        ? [value, ...nodes(value.props?.children)]
        : []
  const text = (value: any): string =>
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : Array.isArray(value)
        ? value.map(text).join('')
        : value?.props
          ? text(value.props.children)
          : ''
  return {
    ctx,
    sidebar,
    native,
    quotes,
    notifications,
    capabilities,
    module,
    flush,
    button: (label: string) => nodes(tree).find((node) => node.type === 'button' && text(node) === label),
    warning: () => text(nodes(tree).find((node) => node.props?.className === 'px-dependency-warning')),
    allText: () => text(tree),
    destroy: () => {
      for (const effect of effectHooks) effect?.cleanup?.()
      assert.equal(windowListeners.size, 0)
    }
  }
}

test('SessionBar uses actual descriptors and reacts to registration alone, unloading and re-registration', (t) => {
  const side = sidebarFixture(panelIds.filter((id) => id !== 'dsh-px-taskflow')),
    f = fixture('SessionBar', side)
  t.after(f.destroy)
  f.flush()
  assert.equal(side.service.isTabEnabled('dsh-px-taskflow'), true)
  assert.equal(f.button('执行记录').props.disabled, true)
  assert.match(f.button('执行记录').props.title, /尚未加载/)
  assert.match(f.warning(), /执行记录/)
  assert.equal(f.button('文件').props.disabled, false)
  side.register('dsh-px-taskflow')
  f.flush()
  const stale = f.button('执行记录')
  assert.equal(stale.props.disabled, false)
  assert.equal(f.warning(), '')
  stale.props.onClick()
  assert.equal(side.calls.length, 1)
  side.unregister('dsh-px-taskflow')
  stale.props.onClick() // A callback captured before unload must recheck the live provider.
  f.flush()
  assert.equal(side.calls.length, 1)
  assert.equal(f.button('执行记录').props.disabled, true)
  side.register('dsh-px-taskflow')
  f.flush()
  f.button('执行记录').props.onClick()
  f.flush()
  assert.equal(side.calls.length, 2)
  assert.equal(f.warning(), '')
  side.setEnabled('dsh-px-taskflow', false)
  f.flush()
  assert.equal(f.button('执行记录').props.disabled, true)
  assert.match(f.button('执行记录').props.title, /已.*禁用/)
  side.setEnabled('dsh-px-taskflow', true)
  f.flush()
  assert.equal(f.button('执行记录').props.disabled, false)
})

test('SessionBar observes service replacement and releases both registry and preference subscriptions', (t) => {
  const f = fixture('SessionBar')
  t.after(f.destroy)
  f.flush()
  assert.equal(f.sidebar.registry.size, 1)
  assert.equal(f.sidebar.state.size, 1)
  f.capabilities.set({ sidebar: undefined })
  f.flush()
  assert.equal(f.sidebar.registry.size, 0)
  assert.equal(f.sidebar.state.size, 0)
  assert.equal(f.button('文件').props.disabled, true)
  const next = sidebarFixture()
  f.capabilities.set({ sidebar: next.service })
  f.flush()
  assert.equal(next.registry.size, 1)
  assert.equal(next.state.size, 1)
  f.button('文件').props.onClick()
  assert.equal(next.calls.length, 1)
  assert.equal(f.sidebar.calls.length, 0)
  f.destroy()
  assert.equal(next.registry.size, 0)
  assert.equal(next.state.size, 0)
  assert.equal(f.native.listeners.size, 0)
})

test('terminal requires a real native kind and retains the targeted native fallback without bypassing preferences', (t) => {
  const f = fixture('SessionBar')
  t.after(f.destroy)
  f.flush()
  f.sidebar.unregister('terminal')
  f.flush()
  assert.equal(f.button('终端').props.disabled, false, 'another registered native terminal remains usable')
  f.button('终端').props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(f.native.calls[0])), ['s', 'terminal', { revealIfOpened: true }])
  assert.equal(f.sidebar.calls.length, 0)
  f.sidebar.setEnabled('terminal', false)
  f.flush()
  assert.equal(f.button('终端').props.disabled, true)
  f.capabilities.set({ sidebar: undefined })
  f.flush()
  assert.equal(
    f.button('终端').props.disabled,
    false,
    'native-only terminal provider can work without betterSidebar'
  )
  f.native.setRegistered(false)
  f.flush()
  assert.equal(
    f.button('终端').props.disabled,
    true,
    'a controller without a terminal provider is not a capability'
  )
  assert.match(f.warning(), /终端/)
  f.native.setRegistered(true)
  f.flush()
  assert.equal(f.button('终端').props.disabled, false)
  f.capabilities.set({ terminal: undefined })
  f.flush()
  assert.equal(f.button('终端').props.disabled, true)
})

test('footer quote actions never enqueue or open a disabled/missing notes provider and recover when registered', (t) => {
  const side = sidebarFixture(panelIds.filter((id) => id !== 'px-notes')),
    f = fixture('QuoteAction', side)
  t.after(f.destroy)
  f.flush()
  assert.equal(f.button('引用 / 批注').props.disabled, true)
  f.button('引用 / 批注').props.onClick()
  assert.equal(f.quotes.getSnapshot().s, undefined)
  assert.equal(side.calls.length, 0)
  assert.match(f.notifications.at(-1)!, /尚未加载/)
  side.register('px-notes')
  f.flush()
  const stale = f.button('引用 / 批注')
  assert.equal(stale.props.disabled, false)
  stale.props.onClick()
  assert.equal(f.quotes.getSnapshot().s.messageId, 'm')
  assert.equal(side.calls.length, 1)
  f.quotes.consume('s')
  side.setEnabled('px-notes', false)
  stale.props.onClick()
  f.flush()
  assert.equal(f.quotes.getSnapshot().s, undefined)
  assert.equal(side.calls.length, 1)
  assert.equal(f.button('引用 / 批注').props.disabled, true)
  assert.match(f.notifications.at(-1)!, /禁用/)
  side.setEnabled('px-notes', true)
  f.flush()
  f.button('引用 / 批注').props.onClick()
  assert.equal(f.quotes.getSnapshot().s.messageId, 'm')
  assert.equal(side.calls.length, 2)
})

for (const newer of [false, true])
  test(`failed quote opening reclaims only its own queued token (newer selection: ${newer})`, (t) => {
    const f = fixture('QuoteAction')
    t.after(f.destroy)
    f.flush()
    f.quotes.request('other', 'keep-other-session')
    f.sidebar.failTab(() => {
      if (newer) f.quotes.request('s', 'newer-message')
    })
    f.button('引用 / 批注').props.onClick()
    assert.equal(f.quotes.getSnapshot().s?.messageId, newer ? 'newer-message' : undefined)
    assert.equal(f.quotes.getSnapshot().other.messageId, 'keep-other-session')
    assert.match(f.notifications.at(-1)!, /fixture tab provider failed/)
  })

test('artifact opens show missing/disabled editor state, recheck stale callbacks and report provider errors', (t) => {
  const side = sidebarFixture(panelIds.filter((id) => id !== 'editor')),
    f = fixture('ArtifactsPanel', side)
  t.after(f.destroy)
  f.flush()
  assert.equal(f.button('打开产物').props.disabled, true)
  assert.match(f.allText(), /文件预览暂不可用/)
  f.button('打开产物').props.onClick()
  f.flush()
  assert.equal(side.calls.length, 0)
  side.register('editor')
  f.flush()
  const stale = f.button('打开产物')
  assert.equal(stale.props.disabled, false)
  stale.props.onClick()
  f.flush()
  assert.equal(side.calls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(side.calls[0].args)), [
    { sessionId: 's', cwd: 'C:/fixture' },
    'C:/fixture/result.md'
  ])
  side.setEnabled('editor', false)
  stale.props.onClick()
  f.flush()
  assert.equal(side.calls.length, 1)
  assert.equal(f.button('打开产物').props.disabled, true)
  assert.match(f.allText(), /禁用/)
  side.setEnabled('editor', true)
  f.flush()
  side.failOpen()
  f.button('打开产物').props.onClick()
  f.flush()
  assert.match(f.allText(), /fixture file provider failed/)
})

test('client entry owns the quote footer contribution through the sidebar injection effect', () => {
  const f = fixture('Entry') as any,
    slots: Array<{ entry: any; component: any }> = [],
    injections: Array<{ names: string[]; callback: (host: any) => void }> = [],
    sidebarEffects: Array<() => void> = []
  f.ctx.slots = {
    // Mirrors the pinned slot service: `inject` hands back the callback's own return value, so a
    // contribution registered directly inside that callback ends up with no owner.
    inject: (_name: string, fn: () => any) => fn(),
    register: (entry: any, component: any) => {
      slots.push({ entry, component })
      return () => slots.splice(slots.indexOf(entry), 1)
    }
  }
  f.module.exports.apply({
    ...f.ctx,
    effect: () => () => {},
    inject: (names: string[], callback: (host: any) => void) => {
      injections.push({ names, callback })
    }
  })
  assert.equal(
    slots.some((slot) => slot.entry?.name === 'shell.overlay'),
    true
  )
  injections
    .find((entry) => entry.names.includes('betterSidebar'))!
    .callback({
      betterSidebar: f.sidebar.service,
      slots: f.ctx.slots,
      effect: (fn: () => () => void) => sidebarEffects.push(fn())
    })
  assert.equal(slots.filter((slot) => slot.entry?.id === 'dsh-px-quote').length, 1)
  // Unloading the provider runs exactly the effects it owns. The footer's contribution must be
  // among them, while the shell overlay stays owned by the workspace plugin that registered it.
  sidebarEffects.forEach((fn) => fn())
  assert.equal(
    slots.filter((slot) => slot.entry?.id === 'dsh-px-quote').length,
    0,
    'the quote footer must be released with the sidebar provider that registered it'
  )
  assert.equal(slots.filter((slot) => slot.entry?.name === 'shell.overlay').length, 1)
})

test('client entry binds native registry availability to its provider lifetime', () => {
  const f = fixture('Entry'),
    injections: Array<{ names: string[]; callback: (host: any) => void }> = [],
    slots: any[] = [],
    rootEffects: Array<() => void> = []
  const raw = {
    ...f.ctx,
    slots: {
      inject: (_name: string, fn: () => void) => fn(),
      register: (entry: any, component: any) => {
        slots.push({ entry, component })
        return () => {}
      }
    },
    effect: (fn: () => () => void) => {
      rootEffects.push(fn())
    },
    inject: (names: string[], callback: (host: any) => void) => {
      injections.push({ names, callback })
    }
  }
  f.module.exports.apply(raw)
  const wrapper = slots.find((slot) => slot.entry.id === 'dsh-px-workspace').component()
  const capabilities = wrapper.props.ctx.capabilities
  assert.equal(capabilities.getSnapshot().nativeTabs, undefined)
  const injection = injections.find((entry) => entry.names.includes('sidebarRightTabs'))!
  const firstOff: Array<() => void> = [],
    secondOff: Array<() => void> = []
  injection.callback({
    sidebarRightTabs: f.native.registry,
    effect: (fn: () => () => void) => firstOff.push(fn())
  })
  assert.equal(capabilities.getSnapshot().nativeTabs, f.native.registry)
  const second = nativeFixture().registry
  injection.callback({ sidebarRightTabs: second, effect: (fn: () => () => void) => secondOff.push(fn()) })
  firstOff.forEach((fn) => fn())
  assert.equal(capabilities.getSnapshot().nativeTabs, second)
  secondOff.forEach((fn) => fn())
  assert.equal(capabilities.getSnapshot().nativeTabs, undefined)
  rootEffects.reverse().forEach((fn) => fn())
})
