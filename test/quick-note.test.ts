import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'

const code = buildSync({
  entryPoints: ['packages/dsh-px-annotations/src/client/quick-note.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '*client/data', '*client/drafts'],
  logLevel: 'silent'
}).outputFiles[0].text

function fixture() {
  let cursor = 0,
    queued = true,
    tree: any,
    closed = false,
    locked = false,
    current = 's',
    phase = 'plain'
  let draft: any = { note: '', saved: null },
    input = '已有草稿',
    revision = 1,
    busy = false
  const hooks: any[] = [],
    effects: any[] = [],
    pending: Array<() => void> = []
  const posts: any[] = [],
    insertions: any[] = []
  const update = () => {
    queued = true
  }
  const react = {
    useState(seed: any) {
      const id = cursor++
      if (!(id in hooks)) hooks[id] = typeof seed === 'function' ? seed() : seed
      return [
        hooks[id],
        (value: any) => {
          hooks[id] = typeof value === 'function' ? value(hooks[id]) : value
          update()
        }
      ]
    },
    useRef(value: any) {
      const id = cursor++
      return (hooks[id] ??= { current: value })
    },
    useEffect(callback: any, deps: any[]) {
      const id = cursor++,
        old = effects[id]
      if (!old || deps.some((d, i) => !Object.is(d, old.deps[i]))) {
        pending.push(() => {
          old?.cleanup?.()
          effects[id].cleanup = callback()
        })
        effects[id] = { deps }
      }
    }
  }
  const scope = {
    bail(explicit: unknown, name: string, payload: any) {
      assert.equal(explicit, scope)
      assert.equal(name, 'slash/input-insert-text')
      insertions.push(payload)
      input += payload.text
      revision++
      return true
    }
  }
  const ctx: any = {
    sessions: {
      list: { getSnapshot: () => ({ current, ids: [current], byId: { [current]: {} } }) },
      scope: () => scope
    },
    conversation: {
      input: {
        for: () => ({
          state: { getSnapshot: () => ({ draft: input, draftRev: revision, phase }) },
          notify() {}
        })
      }
    }
  }
  const selection = { sessionId: 's', messageId: 'm', quote: '原句', left: 100, top: 100 }
  const module = { exports: {} as any }
  runInNewContext(code, {
    module,
    exports: module.exports,
    window: {
      innerWidth: 800,
      innerHeight: 600,
      addEventListener() {},
      removeEventListener() {},
      getSelection: () => ({ removeAllRanges() {} })
    },
    document: { addEventListener() {}, removeEventListener() {} },
    require(name: string) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime')
        return {
          jsx: (type: any, props: any) => ({ type, props }),
          jsxs: (type: any, props: any) => ({ type, props })
        }
      if (name.endsWith('/drafts'))
        return {
          useDraft: () => [
            draft,
            (d: any) => {
              draft = d
              update()
            },
            '',
            true,
            () => {
              draft = { note: '', saved: null }
              update()
            },
            false
          ]
        }
      if (name.endsWith('/data'))
        return {
          errorText: (e: any) => e.message,
          useOperation: () => [
            busy,
            async (fn: any) => {
              busy = true
              update()
              try {
                return await fn()
              } finally {
                busy = false
                update()
              }
            }
          ],
          post: (route: string, body: any) =>
            new Promise((resolve, reject) => {
              posts.push({
                route,
                body,
                resolve: () => resolve({ ...body, id: 'a', seq: 4, updatedAt: 1 }),
                reject
              })
            })
        }
      throw Error(name)
    }
  })
  const props = {
    ctx,
    selection,
    lock(value: boolean) {
      locked = value
    },
    close: () => {
      closed = true
      locked = false
      for (const effect of effects) effect?.cleanup?.()
    }
  }
  const render = () => {
    if (closed) return tree
    for (let n = 0; queued && n < 20; n++) {
      queued = false
      cursor = 0
      tree = module.exports.QuickNote(props)
      pending.splice(0).forEach((fn) => fn())
    }
    return tree
  }
  const walk = (node: any): any[] =>
    !node
      ? []
      : Array.isArray(node)
        ? node.flatMap(walk)
        : typeof node !== 'object'
          ? []
          : [node, ...walk(node.props?.children)]
  const button = (label: string) =>
    walk(render()).find((n) => n.type === 'button' && n.props.children === label)
  return {
    posts,
    insertions,
    button,
    render,
    get draft() {
      return draft
    },
    get input() {
      return input
    },
    get closed() {
      return closed
    },
    get locked() {
      return locked
    },
    note(value: string) {
      const field = walk(render()).find((n) => n.type === 'textarea')
      field.props.onChange({ target: { value } })
      render()
    },
    expand() {
      walk(render())
        .find((n) => n.type === 'button' && Array.isArray(n.props.children))!
        .props.onClick()
      render()
    },
    session(value: string) {
      current = value
    },
    phase(value: string) {
      phase = value
    },
    unmount() {
      for (const effect of effects) effect?.cleanup?.()
    }
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('quick annotation adds once, preserves existing draft and does not submit', async () => {
  const f = fixture()
  f.expand()
  f.note('我的意见')
  const add = f.button('加入对话').props.onClick
  add()
  add()
  assert.equal(f.posts.length, 1)
  assert.equal(f.posts[0].body.note, '我的意见')
  f.posts[0].resolve()
  await tick()
  f.render()
  assert.equal(f.insertions.length, 1)
  assert.match(f.input, /^已有草稿\n\n/)
  assert.match(f.input, /原句/)
  assert.match(f.input, /我的意见/)
  assert.equal(f.closed, true)
  assert.equal(f.locked, false, 'completing one note must allow the next sentence selection')
  assert.equal(f.draft.note, '')
})

test('insertion failure retains note and saved identity; retry does not duplicate annotations', async () => {
  const f = fixture()
  f.expand()
  f.note('保留')
  f.phase('submitting')
  f.button('加入对话').props.onClick()
  f.posts[0].resolve()
  await tick()
  f.render()
  assert.equal(f.closed, false)
  assert.equal(f.insertions.length, 0)
  assert.equal(f.draft.note, '保留')
  assert.equal(f.draft.saved.id, 'a')
  f.phase('plain')
  f.button('加入对话').props.onClick()
  await tick()
  assert.equal(f.posts.length, 1)
  assert.equal(f.insertions.length, 1)
})

test('a late save cannot insert into a switched or unmounted conversation', async () => {
  for (const unmount of [false, true]) {
    const f = fixture()
    f.button('添加到对话').props.onClick()
    if (unmount) f.unmount()
    else f.session('other')
    f.posts[0].resolve()
    await tick()
    assert.equal(f.insertions.length, 0)
    assert.equal(f.draft.saved.id, 'a', 'saved note remains available after returning to the selection')
  }
})

test('save failure keeps typed comment and leaves the native draft unchanged', async () => {
  const f = fixture()
  f.expand()
  f.note('不丢失')
  f.button('加入对话').props.onClick()
  f.posts[0].reject(Error('offline'))
  await tick()
  f.render()
  assert.equal(f.draft.note, '不丢失')
  assert.equal(f.input, '已有草稿')
  assert.equal(f.closed, false)
})
