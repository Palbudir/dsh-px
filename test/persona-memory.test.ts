import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { MemoryStore, memoryContext, projectKey } from '../packages/dsh-px-memory/src/store'
import { apply } from '../packages/dsh-px-memory/src/index'
import { Readable } from 'node:stream'

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'px-memory-'))
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  const file = join(dir, 'memory.json'),
    store = new MemoryStore(file)
  return { dir, file, store }
}
test('personas isolate config and memories across sessions and persist across restart', (t) => {
  const { store, file } = fixture(t)
  let s = store.action(0, { type: 'save', text: '使用中文', scope: 'persona' }, 'a', null)
  s = store.action(s.revision, { type: 'create', name: '研究助手' }, 'b', null)
  const second = store.persona(s, 'b').id
  s = store.action(
    s.revision,
    { type: 'configure', name: '研究助手', instructions: '给出来源', memoryEnabled: true },
    'b',
    null
  )
  assert.equal(store.persona(s, 'b').memories.length, 0)
  assert.equal(store.persona(s, 'a').memories[0].text, '使用中文')
  const reopened = new MemoryStore(file)
  assert.equal(reopened.persona(reopened.read(), 'b').id, second)
  assert.equal(reopened.persona(reopened.read(), 'b').instructions, '给出来源')
})
test('project filtering, correction, deletion and stale revisions keep the right memory', (t) => {
  const { store } = fixture(t)
  let s = store.action(0, { type: 'save', text: 'A 项目使用 npm', scope: 'project' }, 'a', 'a-project')
  const id = s.personas[0].memories[0].id
  assert.ok(!memoryContext(s.personas[0], 'b-project').includes('npm'))
  s = store.action(
    s.revision,
    { type: 'save', id, text: 'A 项目改用 pnpm', scope: 'project' },
    'a',
    'a-project'
  )
  assert.equal(s.personas[0].memories.length, 1)
  assert.ok(memoryContext(s.personas[0], 'a-project').includes('pnpm'))
  const old = s.revision
  s = store.action(s.revision, { type: 'forget', id }, 'a', 'a-project')
  assert.throws(
    () => store.action(old, { type: 'save', id, text: '复活', scope: 'persona' }, 'a', null),
    /记录已变化/
  )
  assert.equal(store.read().personas[0].memories.length, 0)
})
test('deleting a persona resets its bindings but preserves other personas and stale writers cannot restore it', (t) => {
  const { store } = fixture(t)
  let s = store.action(0, { type: 'create', name: '临时角色' }, 'a', null)
  const id = store.persona(s, 'a').id
  s = store.action(s.revision, { type: 'select', personaId: id }, 'b', null)
  s = store.action(s.revision, { type: 'save', text: '旧记忆', scope: 'persona' }, 'a', null)
  const old = s.revision
  s = store.action(s.revision, { type: 'delete-persona' }, 'a', null)
  assert.equal(store.persona(s, 'b').id, 'default')
  assert.equal(s.personas.length, 1)
  assert.throws(
    () =>
      store.action(
        old,
        { type: 'configure', name: '复活', instructions: '', memoryEnabled: true },
        'b',
        null
      ),
    /记录已变化/
  )
  assert.throws(() => store.action(s.revision, { type: 'delete-persona' }, 'a', null), /不能删除/)
})
test('invalid input, budgets and corrupt storage never overwrite the last valid state', (t) => {
  const { store, file } = fixture(t)
  let s = store.action(0, { type: 'save', text: '保留原件', scope: 'persona' }, 'a', null)
  assert.throws(() =>
    store.action(s.revision, { type: 'save', text: 'x'.repeat(2001), scope: 'persona' }, 'a', null)
  )
  assert.equal(store.read().revision, s.revision)
  for (let i = 0; i < 3; i++)
    s = store.action(s.revision, { type: 'save', text: 'x'.repeat(2000), scope: 'persona' }, 'a', null)
  assert.throws(
    () => store.action(s.revision, { type: 'save', text: 'x'.repeat(2000), scope: 'persona' }, 'a', null),
    /8000/
  )
  assert.equal(store.read().revision, s.revision)
  writeFileSync(file, '{invalid')
  assert.throws(() => store.change(0, () => {}))
})
test('native hook snapshot changes only on next turn and storage failure does not stop conversation', async (t) => {
  const { dir } = fixture(t),
    old = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(() => {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
  })
  const hooks = new Map<string, any>(),
    contexts: any[] = [],
    tools: any[] = []
  const host = {
    on: (name: string, fn: any) => hooks.set(name, fn),
    effect: (fn: any) => fn(),
    systemPrompt: {
      context: (c: any) => {
        contexts.push(c)
        return () => {}
      }
    },
    tools: { register: (t: any) => tools.push(t) },
    inject: (names: string[], cb: any) => {
      if (!names.includes('webServer')) cb(host)
    }
  }
  apply(host)
  const store = new MemoryStore(join(dir, 'storages/dsh-px-memory/memory.json'))
  const agent = { session: { id: 's', header: { id: 's', cwd: dir } } }
  const step = hooks.get('agent/pre-step'),
    render = () => contexts[0].text({ agent })
  await step({ agent, turn: 1 }, () => 'next')
  let s = store.action(0, { type: 'create', name: '新角色' }, 's', projectKey(dir))
  assert.ok(!render().includes('新角色'))
  await step({ agent, turn: 2 }, () => 'next')
  assert.ok(render().includes('新角色'))
  const invoke = (args: any) => tools[0].execute(args, { agent, signal: new AbortController().signal })
  const before = JSON.parse(await invoke({ action: 'read' }))
  await invoke({ action: 'save', revision: before.revision, text: '跨会话约定', scope: 'persona' })
  assert.ok(!render().includes('跨会话约定'))
  await step({ agent, turn: 3 }, () => 'next')
  assert.ok(render().includes('跨会话约定'))
  s = store.read()
  store.action(
    s.revision,
    { type: 'configure', name: '新角色', instructions: '', memoryEnabled: false },
    's',
    projectKey(dir)
  )
  await step({ agent, turn: 4 }, () => 'next')
  assert.ok(!render().includes('跨会话约定'))
  await assert.rejects(
    invoke({ action: 'save', revision: store.read().revision, text: '不能保存', scope: 'persona' }),
    /关闭/
  )
  writeFileSync(join(dir, 'storages/dsh-px-memory/memory.json'), '{broken')
  assert.equal(await step({ agent, turn: 5 }, () => 'still-running'), 'still-running')
  assert.match(render(), /暂时无法读取/)
})

test('HTTP memory saves preserve UTF-8 split across network chunks and reject stale edits', async (t) => {
  const { dir } = fixture(t),
    old = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(() => {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
  })
  let handler: any
  const host = {
    on: () => {},
    effect: (fn: any) => fn(),
    connection: { requestRejection: () => undefined },
    webServer: {
      register: (route: any) => {
        handler = route.handler
        return () => {}
      }
    },
    sessionController: { inspect: async () => ({ meta: { cwd: dir } }) },
    inject: (names: string[], cb: any) => {
      if (names.includes('webServer')) cb(host)
    }
  }
  apply(host)
  const post = async (revision: number) => {
    const bytes = Buffer.from(
      JSON.stringify({ type: 'save', revision, text: '保留中文和 emoji 🧠', scope: 'persona' })
    )
    const req: any = Readable.from([...bytes].map((byte) => Buffer.from([byte])))
    Object.assign(req, {
      method: 'POST',
      url: '/dsh-px-memory?sessionId=s',
      headers: { host: '127.0.0.1', 'content-type': 'application/json', 'x-dsh-px-request': '1' }
    })
    let status = 0,
      body: any
    await handler(req, { writeHead: (n: number) => (status = n), end: (v: string) => (body = JSON.parse(v)) })
    return { status, body }
  }
  const first = await post(0)
  assert.equal(first.status, 200)
  assert.equal(first.body.persona.memories[0].text, '保留中文和 emoji 🧠')
  assert.equal((await post(0)).status, 409)
})
