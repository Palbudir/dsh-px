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
import { channelMessageOrigin, conversationalSource } from '../packages/shared/channel-source'

test('generic channel provenance selects Feishu scenes without mixing a QQ sender with identical IDs', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-feishu-scene-')),
    store = new MemoryStore(join(root, 'memory.json'))
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  store.bind('feishu', {
    channel: {
      provider: 'feishu',
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
      instructions: 'PRIVATE',
      memoryEnabled: true,
      expression: {
        ...expressionStarter('balanced'),
        scenes: [
          {
            id: 'known',
            scene: 'chat',
            provider: 'feishu',
            participantId: '23007',
            instructions: 'FEISHU_MEMBER_STYLE'
          }
        ]
      }
    },
    'feishu',
    null
  )
  store.action(store.read().revision, { type: 'adopt-version' }, 'feishu', null)
  let turn = 1
  const agent = { session: { id: 'feishu', header: { id: 'feishu' }, snapshotEvents: () => [] } },
    identity = new TurnIdentity(store, () => ({ lastTurn: turn }))
  const source = {
    kind: 'plugin:dsh-px-channel',
    version: 1,
    provider: 'feishu',
    accountId: '12001',
    conversationId: 'group:34011',
    actorId: '23007',
    messageId: 'om_1',
    fingerprint: 'a'.repeat(64),
    ingressId: 'b'.repeat(64),
    personaId: store.read().bindings.feishu.personaId,
    routeRevision: 1,
    epoch: 'run',
    requestId: 'request'
  }
  assert.equal(channelMessageOrigin(source)?.senderId, '23007')
  assert.equal(conversationalSource(source), true)
  assert.equal(conversationalSource({ ...source, version: undefined }), false)
  identity.claim(
    agent,
    {
      source: {
        kind: 'plugin:dsh-onebot',
        pxQq: { version: 1, accountId: '12001', conversationId: 'group:34011', senderId: '23007' }
      }
    },
    1
  )
  assert.deepEqual(identity.interaction(agent).participants, [])
  turn = 2
  identity.claim(agent, { source }, 2)
  assert.deepEqual(identity.interaction(agent).participants, ['23007'])
  assert.match(
    renderPersonaExpression(identity.current(agent).expression, identity.interaction(agent)),
    /FEISHU_MEMBER_STYLE/
  )
  assert.doesNotMatch(identity.current(agent).instructions, /PRIVATE/)
  identity.claim(agent, { source: { ...source, actorId: '45009' } }, 2)
  assert.deepEqual(
    identity.interaction(agent).participants,
    ['23007'],
    'late steering cannot replace turn identity'
  )
})

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
  let nativeTurn = 1
  const nativeIdentity = new TurnIdentity(store, () => ({ lastTurn: nativeTurn }))
  const nativeAgent = {
    session: { id: 's', header: { id: 's' }, snapshotEvents: () => [{ seq: 0, type: 'turn/start' }] }
  }
  // Native inputs have been claimed, but have not yet been persisted as user/message at assembly time.
  nativeIdentity.claim(nativeAgent, { source: origin('23007') }, 1)
  nativeIdentity.claim(
    nativeAgent,
    { source: { ...origin('99999'), pxQq: { ...origin('99999').pxQq, conversationId: 'group:other' } } },
    1
  )
  assert.deepEqual(nativeIdentity.interaction(nativeAgent).participants, ['23007'])
  nativeIdentity.claim(nativeAgent, { source: origin('45009') }, 1)
  assert.deepEqual(
    nativeIdentity.interaction(nativeAgent).participants,
    ['23007'],
    'later steering does not rewrite the turn expression'
  )
  nativeTurn = 2
  assert.deepEqual(
    nativeIdentity.interaction(nativeAgent).participants,
    [],
    'a previous claim cannot supply the next turn identity'
  )
  nativeTurn = 3
  nativeIdentity.claim(nativeAgent, { source: origin('45009') }, 3)
  assert.deepEqual(nativeIdentity.interaction(nativeAgent).participants, ['45009'])
  assert.ok(
    !renderPersonaExpression(
      nativeIdentity.current(nativeAgent).expression,
      nativeIdentity.interaction(nativeAgent)
    ).includes('KNOWN_MEMBER_STYLE')
  )
})
