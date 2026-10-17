import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import {
  delegatedContract,
  delegatedKnowledgeCaller
} from '../packages/dsh-px-memory/src/knowledge-delegation'
import { TurnIdentity } from '../packages/dsh-px-memory/src/identity'

test('native Team retained knowledge View keeps contract and actual writer without crossing identities', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'px-delegation-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new MemoryStore(join(dir, 'memory.json'))
  const make = (id: string, parentSession?: string, origin = 'subagent') => ({
    session: { id, header: { id, cwd: dir, parentSession, origin }, snapshotEvents: () => [] }
  })
  const parent = make('parent'),
    child = make('child', 'parent'),
    grandchild = make('grandchild', 'child')
  const agents = new Map([parent, child, grandchild].map((a) => [a.session.id, a]))
  store.bind('parent', { locked: true })
  const identity = new TurnIdentity(store)
  identity.current(child)
  identity.current(grandchild)
  assert.equal(store.read().bindings.child.locked, true)
  const get = (id: string) => agents.get(id),
    owner = { sessionId: 'parent', project: dir }
  assert.equal(
    delegatedContract(grandchild, get, (id) => (id === 'parent' ? 'source:knowledge' : undefined), store),
    'source:knowledge'
  )
  assert.equal(delegatedKnowledgeCaller(owner, grandchild, get, store).sessionId, 'grandchild')
  assert.equal(
    delegatedContract(make('independent', 'parent', 'user'), get, () => undefined, store),
    undefined
  )
  assert.throws(() => delegatedKnowledgeCaller(owner, make('child', 'unrelated'), get, store), /不属于/)
  assert.throws(
    () =>
      delegatedKnowledgeCaller(
        owner,
        { session: { ...child.session, header: { ...child.session.header, cwd: join(dir, 'other') } } },
        get,
        store
      ),
    /不一致/
  )
  store.action(store.read().revision, { type: 'create', name: 'Other' }, 'other', null)
  assert.throws(() => delegatedKnowledgeCaller(owner, make('other', 'parent'), get, store), /不一致/)
})
