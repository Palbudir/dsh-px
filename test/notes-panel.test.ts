import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { createQuoteRequests } from '../packages/shared/quote-requests'
import { createDraftCell } from '../packages/shared/draft-store'

// Execute the actual component. The deterministic hook scheduler controls only
// rendering and HTTP completion; it does not reproduce the selection algorithm.
const source = (
  await build({
    entryPoints: ['packages/dsh-px-annotations/src/client/notes.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'notes-component-fixture',
        setup(builder) {
          builder.onResolve({ filter: /(?:\/data$|\/drafts$|client-http$|shared\/ui$)/ }, (args) => ({
            path: args.path.endsWith('/data')
              ? 'fixture-data'
              : args.path.endsWith('/drafts')
                ? 'fixture-drafts'
                : args.path.endsWith('client-http')
                  ? 'fixture-http'
                  : 'fixture-ui',
            external: true
          }))
        }
      }
    ]
  })
).outputFiles[0].text

function message(id: string) {
  return { id, seq: 1, role: 'assistant', text: `Message ${id}`, length: 9, offset: 0, nextOffset: null }
}
function fixture(
  options: {
    selected?: string
    initialMessage?: string | null
    draft?: Record<string, unknown>
    busy?: boolean
    available?: boolean
  } = {}
) {
  let queued = true,
    cursor = 0,
    rendering: any,
    effects: Array<() => void> = [],
    hooks: any[] = [],
    effectHooks: any[] = []
  let busy = options.busy ?? false,
    available = options.available ?? true
  const update = () => {
    queued = true
  }
  const requests: Array<{ id: string; aborted: boolean; finish: () => void; fail: () => void }> = []
  const quotes = createQuoteRequests()
  quotes.subscribe(update)
  if (options.selected) quotes.request('s', options.selected)
  const draft = createDraftCell<any>('notes:s', {
    source: null,
    quote: '',
    note: '',
    editing: null,
    initialized: false,
    collapsed: false,
    dirty: false,
    requestToken: '',
    ...options.draft
  })
  draft.subscribe(update)
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
        effectHooks[id] = { deps, cleanup: old?.cleanup, callback }
        effects.push(() => {
          effectHooks[id].cleanup?.()
          effectHooks[id].cleanup = callback()
        })
      }
    }
  }
  const data = {
    base: '/dsh-px-workspace',
    errorText: String,
    stamp: String,
    post: async () => ({}),
    useOperation: () => [busy, (fn: () => unknown) => fn()],
    useSnapshot: () => quotes.getSnapshot(),
    quoteRequests: quotes,
    useData: (url: string) => ({
      data: url.includes('/annotations?')
        ? { annotations: [], total: 0, nextBefore: null }
        : { messages: [message('B')], nextBefore: null },
      error: '',
      loading: false,
      refresh() {}
    })
  }
  const http = {
    requestJson(url: string, options: { signal: AbortSignal }) {
      const id = new URL(url, 'http://localhost').searchParams.get('messageId')!
      return new Promise((resolve, reject) => {
        const request = {
          id,
          aborted: false,
          finish: () => resolve(message(id)),
          fail: () => reject(Error('fixture read failure'))
        }
        // Deliberately permit an aborted request to resolve late, as a non-cooperative transport can.
        options.signal.addEventListener(
          'abort',
          () => {
            request.aborted = true
          },
          { once: true }
        )
        requests.push(request)
      })
    }
  }
  const drafts = { useDraft: () => [draft.getSnapshot(), draft.set, '', available, draft.clear, false] }
  const module: { exports: any } = { exports: {} }
  const jsx = (type: any, props: any) => ({ type, props })
  runInNewContext(source, {
    module,
    exports: module.exports,
    AbortController,
    URL,
    require: (id: string) =>
      (
        ({
          react,
          'react/jsx-runtime': { jsx, jsxs: jsx },
          'fixture-data': data,
          'fixture-drafts': drafts,
          'fixture-http': http,
          'fixture-ui': { ConfirmDelete() {} }
        }) as Record<string, unknown>
      )[id]
  })
  async function flush() {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (queued) {
        queued = false
        cursor = 0
        effects = []
        rendering = module.exports.NotesPanel({
          ctx: {},
          scope: { sessionId: 's' },
          visible: true,
          tab: {
            meta: { messageId: options.initialMessage === null ? undefined : (options.initialMessage ?? 'A') }
          }
        })
        const pending = effects
        effects = []
        pending.forEach((effect) => effect())
      }
      await Promise.resolve()
      if (!queued) {
        await Promise.resolve()
        if (!queued) return
      }
    }
    throw Error('component render did not settle')
  }
  function nodes(value: any): any[] {
    if (Array.isArray(value)) return value.flatMap(nodes)
    if (!value || typeof value !== 'object') return []
    return [value, ...nodes(value.props?.children)]
  }
  return {
    requests,
    draft,
    quotes,
    flush,
    request: (id: string) => quotes.request('s', id),
    button: (label: string) =>
      nodes(rendering).find((node) => node.type === 'button' && node.props.children === label),
    setBusy: (value: boolean) => {
      busy = value
      update()
    },
    setAvailable: (value: boolean) => {
      available = value
      update()
    },
    remount() {
      for (const effect of effectHooks) effect?.cleanup?.()
      hooks = []
      effectHooks = []
      update()
    },
    replayEffects() {
      for (const effect of effectHooks) effect?.cleanup?.()
      for (const effect of effectHooks) if (effect) effect.cleanup = effect.callback()
      update()
    }
  }
}

for (const selected of ['A', undefined])
  test(`latest explicit quote wins over initial tab metadata (${selected ? 'initial selection' : 'metadata fallback'})`, async () => {
    const f = fixture({ selected })
    await f.flush()
    assert.deepEqual(
      f.requests.map((request) => request.id),
      ['A']
    )
    f.request('B')
    await f.flush()
    assert.deepEqual(
      f.requests.map((request) => request.id),
      ['A', 'B']
    )
    assert.equal(f.requests[0].aborted, true)
    f.requests[1].finish()
    await f.flush()
    f.requests[0].finish()
    await f.flush()
    assert.equal(f.draft.getSnapshot().source.id, 'B')
    assert.equal(f.quotes.getSnapshot().s, undefined)
  })

test('failed explicit source keeps its target and has an explicit retry without a fallback loop', async () => {
  const f = fixture({ selected: 'B' })
  await f.flush()
  f.requests[0].fail()
  await f.flush()
  assert.equal(f.requests.length, 1)
  assert.equal(f.quotes.getSnapshot().s.messageId, 'B')
  const retry = f.button('重试读取原文')
  assert.ok(retry)
  retry.props.onClick()
  await f.flush()
  assert.deepEqual(
    f.requests.map((request) => request.id),
    ['B', 'B']
  )
  f.requests[1].finish()
  await f.flush()
  assert.equal(f.draft.getSnapshot().source.id, 'B')
  assert.equal(f.button('重试读取原文'), undefined)
})

for (const outcome of ['success', 'failure'])
  test(`a newer local list choice supersedes a failed global request (${outcome})`, async () => {
    const f = fixture({ selected: 'A' })
    await f.flush()
    f.requests[0].fail()
    await f.flush()
    const local = f.button('引用 / 批注此消息')
    assert.equal(local.props.disabled, false, 'the real enabled list action is exercised')
    local.props.onClick()
    await f.flush()
    assert.deepEqual(
      f.requests.map((request) => request.id),
      ['A', 'B']
    )
    assert.equal(f.quotes.getSnapshot().s, undefined)
    if (outcome === 'success') f.requests[1].finish()
    else f.requests[1].fail()
    await f.flush()
    f.setBusy(true)
    await f.flush()
    f.setBusy(false)
    await f.flush()
    assert.deepEqual(
      f.requests.map((request) => request.id),
      ['A', 'B'],
      'save-state changes cannot replay A'
    )
    if (outcome === 'failure') {
      f.button('重试读取原文').props.onClick()
      await f.flush()
      assert.deepEqual(
        f.requests.map((request) => request.id),
        ['A', 'B', 'B']
      )
      f.requests[2].finish()
      await f.flush()
    }
    assert.equal(f.draft.getSnapshot().source.id, 'B')
  })

test('a queued local callback also wins while the older global HTTP request remains pending', async () => {
  const f = fixture({ initialMessage: null })
  await f.flush()
  const local = f.button('引用 / 批注此消息')
  assert.equal(local.props.disabled, false)
  f.request('A')
  await f.flush()
  // Exercise a handler captured before the busy render, rather than clicking a disabled DOM button.
  local.props.onClick()
  await f.flush()
  assert.deepEqual(
    f.requests.map((request) => request.id),
    ['A', 'B']
  )
  assert.equal(f.requests[0].aborted, true)
  f.requests[1].finish()
  await f.flush()
  f.requests[0].finish()
  await f.flush()
  f.setBusy(true)
  await f.flush()
  f.setBusy(false)
  await f.flush()
  assert.equal(f.quotes.getSnapshot().s, undefined)
  assert.equal(f.draft.getSnapshot().source.id, 'B')
  assert.equal(f.requests.length, 2)
})

test('declining replacement preserves unsaved content without reopening stale metadata', async () => {
  const f = fixture({
    selected: 'B',
    draft: { source: message('C'), quote: 'Message C', note: 'keep unsaved', dirty: true }
  })
  await f.flush()
  assert.equal(f.requests.length, 0)
  f.button('保留当前草稿').props.onClick()
  await f.flush()
  assert.equal(f.draft.getSnapshot().source.id, 'C')
  assert.equal(f.draft.getSnapshot().note, 'keep unsaved')
  assert.equal(f.requests.length, 0)
  f.request('D')
  await f.flush()
  f.button('放弃修改并切换').props.onClick()
  await f.flush()
  assert.deepEqual(
    f.requests.map((request) => request.id),
    ['D']
  )
  f.requests[0].finish()
  await f.flush()
  assert.equal(f.draft.getSnapshot().source.id, 'D')
})

test('blocked quote requests resume when a save finishes or draft recovery becomes available', async () => {
  for (const unavailable of ['busy', 'draft']) {
    const f = fixture({ selected: 'B', busy: unavailable === 'busy', available: unavailable !== 'draft' })
    await f.flush()
    assert.equal(f.requests.length, 0)
    f.setBusy(false)
    f.setAvailable(true)
    await f.flush()
    assert.deepEqual(
      f.requests.map((request) => request.id),
      ['B']
    )
    f.requests[0].finish()
    await f.flush()
    assert.equal(f.draft.getSnapshot().source.id, 'B')
  }
})

for (const lifecycle of ['remount', 'replayEffects'] as const)
  test(`pending explicit quote survives ${lifecycle} and ignores an abandoned response`, async () => {
    const f = fixture({ selected: 'B' })
    await f.flush()
    f[lifecycle]()
    await f.flush()
    assert.deepEqual(
      f.requests.map((request) => request.id),
      ['B', 'B']
    )
    assert.equal(f.requests[0].aborted, true)
    f.requests[1].finish()
    await f.flush()
    f.requests[0].finish()
    await f.flush()
    assert.equal(f.draft.getSnapshot().source.id, 'B')
  })
