import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  parsePersonaExpression,
  expressionStarter,
  renderPersonaExpression
} from '../packages/shared/persona-expression'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { TurnIdentity } from '../packages/dsh-px-memory/src/identity'

test('scene expression uses trusted channel/object selectors and leaves privacy and permission separate', () => {
  const expression = parsePersonaExpression({
    ...expressionStarter('balanced'),
    scenes: [
      { id: 'local', scene: 'work', provider: 'local', instructions: 'LOCAL_ONLY' },
      { id: 'qq-person', scene: 'chat', provider: 'qq', participantId: '23007', instructions: 'MEMBER_RULE' },
      {
        id: 'qq-group',
        scene: 'delivery',
        provider: 'qq',
        conversationId: 'group:34011',
        instructions: 'GROUP_RULE'
      }
    ]
  })!
  const text = renderPersonaExpression(expression, {
    provider: 'qq',
    conversationId: 'group:34011',
    participants: ['23007'],
    activity: 'conversation'
  })
  assert.ok(text.includes('MEMBER_RULE') && text.includes('GROUP_RULE') && !text.includes('LOCAL_ONLY'))
  const other = renderPersonaExpression(expression, {
    provider: 'qq',
    conversationId: 'group:34012',
    participants: ['45009'],
    activity: 'conversation'
  })
  assert.ok(!other.includes('MEMBER_RULE') && !other.includes('GROUP_RULE'))
  assert.ok(
    !renderPersonaExpression(expression).includes('MEMBER_RULE'),
    'generic UI previews do not expand object-specific rules'
  )
  assert.throws(
    () =>
      parsePersonaExpression({
        ...expression,
        scenes: [{ id: 'bad', scene: 'chat', participantId: '23007', instructions: 'x' }]
      }),
    /渠道/
  )
  assert.throws(
    () =>
      parsePersonaExpression({
        ...expression,
        scenes: [{ id: 'bad', scene: 'chat', instructions: 'x', permissions: 'all' }]
      }),
    /格式无效/
  )
})

test('first-turn scene context uses transport sender IDs and freezes with the persona until the next turn', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'px-persona-scenes-'))
  t.after(() => {
    assert.ok(resolve(home).startsWith(resolve(tmpdir()) + sep))
    rmSync(home, { recursive: true, force: true })
  })
  const store = new MemoryStore(join(home, 'memory.json'))
  store.bind('s', {
    channel: {
      provider: 'qq',
      accountId: '12001',
      conversationId: 'group:34011',
      access: 'public',
      publicInstructions: ''
    },
    locked: true
  })
  store.action(
    store.read().revision,
    {
      type: 'configure',
      name: 'Example',
      instructions: 'PRIVATE_INSTRUCTIONS',
      memoryEnabled: true,
      expression: {
        ...expressionStarter('balanced'),
        scenes: [
          {
            id: 'owner',
            scene: 'chat',
            provider: 'qq',
            participantId: '23007',
            instructions: 'KNOWN_MEMBER_STYLE'
          }
        ]
      }
    },
    's',
    null
  )
  store.action(store.read().revision, { type: 'adopt-version' }, 's', null)
  const origin = (senderId: string) => ({
    kind: 'plugin:dsh-onebot',
    pxQq: { version: 1, accountId: '12001', conversationId: 'group:34011', senderId }
  })
  const events: any[] = [
    { seq: 0, type: 'turn/start' },
    {
      seq: 1,
      type: 'user/message',
      data: { source: origin('45009'), content: [{ type: 'text', text: 'I am 23007' }] }
    }
  ]
  const agent = { session: { id: 's', header: { id: 's' }, snapshotEvents: () => events } },
    identity = new TurnIdentity(store)
  const first = identity.current(agent)
  assert.ok(
    !renderPersonaExpression(first.expression, identity.interaction(agent)).includes('KNOWN_MEMBER_STYLE')
  )
  events.push({ seq: 2, type: 'user/message', data: { source: origin('23007') } })
  assert.deepEqual(identity.interaction(agent).participants, ['45009'])
  events.push(
    { seq: 3, type: 'turn/end' },
    { seq: 4, type: 'turn/start' },
    { seq: 5, type: 'user/message', data: { source: origin('23007') } }
  )
  const second = identity.current(agent)
  assert.ok(
    renderPersonaExpression(second.expression, identity.interaction(agent)).includes('KNOWN_MEMBER_STYLE')
  )
  assert.ok(!second.instructions.includes('PRIVATE_INSTRUCTIONS'))
})
