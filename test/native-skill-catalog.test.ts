import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Script } from 'node:vm'
import { setTimeout as delay } from 'node:timers/promises'
import { patchNativeSkillCatalog } from '../src/shared/native-skill-catalog'

const require = createRequire(import.meta.url)
const original = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-skill/client'), 'utf8')
const row = (name: string, path = '/project/' + name) => ({
  name,
  path,
  description: name,
  modelInvocable: true
})
function fixture(load: (id: string, signal: AbortSignal) => Promise<any[]>) {
  let plugin: any,
    source: any,
    unregistered = false
  const events = new Map<string, () => void>(),
    disposed: Array<() => void> = [],
    opened: string[] = []
  new Script(patchNativeSkillCatalog(original)).runInNewContext({
    window: {
      __ModuleLoader__: {
        load: (definition: any) => {
          plugin = definition.factory((name: string) => {
            if (name === '@deepseek-ai/dsh-client-ui-primitives')
              return {
                rankByName: (items: any[], query: string) => items.filter((row) => row.name.includes(query))
              }
            if (name === 'react' || name === 'react/jsx-runtime') return {}
            throw Error('Unexpected native client dependency: ' + name)
          })
        }
      }
    },
    AbortController,
    console
  })
  const ctx = {
    effect: (fn: () => (() => void) | void) => {
      const off = fn()
      if (off) disposed.push(off)
    },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    uiConversation: { userText: { register: () => {} } },
    slots: { inject: (_: string, fn: () => void) => fn(), register: () => () => {} },
    remote: {
      skills: {
        list: async ({ sessionId }: any, signal: AbortSignal) => ({
          ok: true,
          value: { skills: await load(sessionId, signal) }
        })
      },
      $on: (name: string, fn: () => void) => events.set(name, fn)
    },
    sessions: {
      binding: () => ({}),
      using: (_: string, __: unknown, fn: (reference: any) => Promise<any>) =>
        fn({ binding: { session: { getSnapshot: () => ({ openState: 'open' }) } } }),
      subagentAddress: () => undefined,
      scope: () => ({}),
      list: { getSnapshot: () => ({ byId: { a: { cwd: '/project' }, b: { cwd: '/project' } } }) }
    },
    sidebarRight: { openResource: (path: string) => opened.push(path) },
    on: (name: string, fn: () => void) => events.set(name, fn),
    get: (name: string) => {
      assert.equal(name, 'inputTriggers')
      return {
        registerSource: (value: any) => {
          source = value
          return () => {
            unregistered = true
          }
        }
      }
    }
  }
  plugin.apply(ctx)
  return {
    source,
    events,
    opened,
    dispose: () => {
      for (const off of disposed.reverse()) off()
    },
    get unregistered() {
      return unregistered
    }
  }
}
const query = (source: any, id = 'a') =>
  source.candidates({ sessionId: id }, { query: '', signal: new AbortController().signal })

test('patched pinned native client refreshes lookups and previews without a refetch-notify loop', async (t) => {
  let calls = 0,
    catalog = [row('own-private', '/project/v1')]
  const f = fixture(async (id) => {
    calls++
    return id === 'a' ? catalog : [row('other-private')]
  })
  const notifications: Promise<unknown>[] = []
  const off = f.source.subscribeLexicon({ sessionId: 'a' }, () => {
    notifications.push(query(f.source))
  })
  t.after(() => {
    off()
    f.dispose()
  })
  assert.equal((await query(f.source))[0].name, 'own-private')
  await Promise.all(notifications)
  const settled = calls
  await delay(10)
  assert.equal(calls, settled, 'no background polling after the names settle')
  catalog = []
  assert.deepEqual(Array.from(await query(f.source)), [], 'disabled native catalog no longer appears')
  await Promise.all(notifications)
  assert.deepEqual(Array.from(f.source.lexicon({ sessionId: 'a' })), [])
  assert.equal((await query(f.source, 'b'))[0].name, 'other-private')
  catalog = [row('own-private', '/project/v2')]
  await query(f.source)
  await Promise.all(notifications)
  catalog = [row('own-private', '/project/v3')]
  f.source.openReference({ sessionId: 'a' }, { ref: '/own-private' })
  assert.equal(f.opened.length, 0, 'an old cached path must not open immediately')
  await delay(0)
  assert.equal(f.opened.length, 1)
  assert.equal(f.opened[0], 'dsh-resource://file/session/a/v3')
  assert.deepEqual(Array.from(f.source.lexicon({ sessionId: 'b' })), ['other-private'])
})

test('pinned native cache coalesces concurrent reads and ignores responses after reset or disposal', async () => {
  const pending: Array<{ signal: AbortSignal; resolve: (value: any[]) => void }> = []
  const f = fixture(async (_id, signal) => new Promise((resolve) => pending.push({ signal, resolve })))
  f.source.warm({ sessionId: 'a' })
  const first = query(f.source),
    firstResult = first.catch((error: Error) => error.name)
  assert.equal(pending.length, 1)
  f.events.get('connection/reset')!()
  assert.equal(pending[0].signal.aborted, true)
  const fresh = query(f.source)
  assert.equal(pending.length, 2)
  pending[1].resolve([row('current')])
  assert.equal((await fresh)[0].name, 'current')
  pending[0].resolve([row('stale-private')])
  assert.equal(await firstResult, 'AbortError')
  assert.deepEqual(Array.from(f.source.lexicon({ sessionId: 'a' })), ['current'])
  const last = query(f.source),
    stopped = last.catch((error: Error) => error.name)
  assert.equal(pending.length, 3)
  f.dispose()
  assert.equal(f.unregistered, true)
  assert.equal(pending[2].signal.aborted, true)
  pending[2].resolve([row('after-disposal')])
  assert.equal(await stopped, 'AbortError')
  assert.equal(f.source.lexicon({ sessionId: 'a' }), undefined)
})

test('failed catalog refresh clears stale names and the pinned patch rejects unknown behavior', async (t) => {
  let fail = false
  const f = fixture(async () => {
    if (fail) throw Error('native registry unavailable')
    return [row('private')]
  })
  t.after(f.dispose)
  await query(f.source)
  fail = true
  await assert.rejects(query(f.source), /registry unavailable/)
  assert.equal(f.source.lexicon({ sessionId: 'a' }), undefined)
  assert.throws(
    () =>
      patchNativeSkillCatalog(
        original.replace('const skills = ctx.remote.skills;', 'const skills = untrusted;')
      ),
    /pinned/
  )
  assert.throws(() => patchNativeSkillCatalog(patchNativeSkillCatalog(original)), /pinned/)
})
