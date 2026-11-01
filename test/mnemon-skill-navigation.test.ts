import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { mountMnemonSkillPage } from '../packages/dsh-px-memory/src/mnemon-skill-slot'
import { skillAnchorName } from '../packages/dsh-px-memory/src/workspace-navigation'

test('skill detail adapter preserves native capability props and withdraws when the source owner disappears', async () => {
  const core = new SlotCore() as any,
    slot = 'mnemon.source.page'
  const root = core.register(
    { name: 'root', children: { [slot]: { kind: 'list', scope: 'root' } } },
    () => null
  )
  const metadata = { group: 'skills', primary: true },
    Native = Object.assign(() => null, { mnemonNavigation: metadata })
  const original = core.register({ name: slot, id: 'skills/library' }, Native)
  const host = {
    slots: {
      inject: (_name: string, fn: () => () => void) => fn(),
      register: core.register.bind(core),
      entries: core.entries.bind(core),
      subscribe: core.subscribe.bind(core)
    }
  }
  const open = () => true,
    dispose = mountMnemonSkillPage(host, (Native) => (source: unknown) => ({ Native, source, open }))
  const winner = core.entriesOfSlot(slot)[0].component
  assert.notEqual(winner, Native)
  assert.equal(winner.mnemonNavigation, metadata)
  const props = {
    sessionId: 'a',
    sourceTypeId: 'skills',
    sourceInstanceKey: 'native-instance',
    management: { read: () => {} },
    navigationInput: { seed: 'review:original', nonce: 1 }
  }
  const element = winner(props)
  assert.equal(element.Native, Native)
  assert.equal(element.source, props, 'the native instance capability is not rebuilt or widened')
  assert.equal(element.open, open)
  original()
  await setImmediate()
  assert.equal(core.entriesOfSlot(slot).length, 0, 'no phantom Source page after removal')
  const Updated = Object.assign(() => null, { mnemonNavigation: { ...metadata, detail: 'updated' } })
  const newer = core.register({ name: slot, id: 'skills/library' }, Updated)
  await setImmediate()
  assert.equal(core.entriesOfSlot(slot)[0].component(props).Native, Updated)
  dispose()
  assert.equal(core.entriesOfSlot(slot)[0].component, Updated)
  newer()
  root()
})

test('only same-session skill-name anchors enter the scoped viewer; other Source requests remain native', () => {
  assert.equal(
    skillAnchorName({ page: 'skills/library', seed: 'name:own-procedure', sessionId: 'a' }, 'a'),
    'own-procedure'
  )
  assert.equal(
    skillAnchorName({ page: 'skills/library', seed: 'name:own-procedure', sessionId: 'b' }, 'a'),
    undefined
  )
  assert.equal(skillAnchorName({ page: 'skills/library', seed: 'name:own-procedure' }), undefined)
  assert.equal(
    skillAnchorName({ page: 'skills/library', seed: 'review:original', sessionId: 'a' }, 'a'),
    undefined
  )
  assert.equal(
    skillAnchorName({ page: 'documents/library', seed: 'name:own-procedure', sessionId: 'a' }, 'a'),
    undefined
  )
  assert.equal(
    skillAnchorName({ page: 'skills/library', seed: 'name:../other', sessionId: 'a' }, 'a'),
    undefined
  )
})
