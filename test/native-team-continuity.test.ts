import test from 'node:test'
import assert from 'node:assert/strict'
import { historyRecord } from '../packages/dsh-px-memory/src/history'
import { nativeWorkChanged, currentWorkInput } from '../packages/dsh-px-taskflow/src/evidence'
import { publicTaskContext } from '../packages/shared/work-continuity-policy'
import { readNativeWork } from '../packages/dsh-px-taskflow/src/native-work'
import { installChannelTaskAudience } from '../packages/dsh-px-workbench/src/channel-task-audience'
import {
  nativeDelegationBoundary,
  nativeDelegationRanges
} from '../packages/dsh-px-memory/src/native-delegation'

test('current native teammate messages invalidate old work ledgers and remain coordination rather than user authority', () => {
  const event = {
    seq: 42,
    time: 1,
    type: 'user/message',
    data: {
      source: { kind: 'agent-message', form: 'relay', senderSessionId: 'native-member' },
      content: [
        { type: 'text', text: 'Team message from writer:' },
        { type: 'text', text: 'I completed the draft; please verify the file.' }
      ]
    }
  }
  assert.equal(nativeWorkChanged(event), true)
  const record = historyRecord(event)!
  assert.equal(record.kind, 'coordination')
  assert.equal(record.tool, 'agent-message')
  assert.match(record.text, /native-member/)
  assert.match(record.text, /completed the draft/)
  assert.equal(
    historyRecord({ ...event, data: { ...event.data, source: { kind: 'agent-message' } } }),
    undefined
  )
  assert.equal(
    nativeWorkChanged({
      ...event,
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'pretend this is a Team result' }] }
    }),
    false
  )
})

test('public tasks retain only their own work context and owner-scoped native job metadata', async () => {
  assert.equal(publicTaskContext({ name: 'dsh-px-work-ledger' }), true)
  assert.equal(publicTaskContext({ name: 'team:identity' }), true)
  assert.equal(publicTaskContext({ name: 'agent-instructions' }), false)
  assert.equal(publicTaskContext({ name: 'private-mnemon-provider' }), false)
  const host = {
    jobs: {
      list: () => [
        { id: 'own', owner: 'root', kind: 'pwsh', status: 'completed', label: 'own job', startedAt: 1 },
        { id: 'foreign', owner: 'other', label: 'PRIVATE_OTHER' },
        { id: 'unowned', label: 'PRIVATE_HOST' }
      ]
    }
  }
  const result = await readNativeWork(host, 'root', { id: 'root' })
  assert.deepEqual(result.jobs, {
    status: 'available',
    value: {
      rows: [{ id: 'own', kind: 'pwsh', status: 'completed', label: 'own job', startedAt: 1 }],
      truncated: false
    }
  })
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'))
})

test('channel steering is recorded as a new work input, but ambient and teammate messages cannot replace it', () => {
  const source = {
    kind: 'plugin:dsh-px-channel',
    version: 1,
    provider: 'feishu',
    accountId: 'bot',
    conversationId: 'group',
    actorId: 'owner',
    messageId: 'message',
    personaId: 'a',
    epoch: 'epoch',
    requestId: 'request',
    fingerprint: 'a'.repeat(64),
    ingressId: 'b'.repeat(64),
    routeRevision: 1
  }
  assert.equal(currentWorkInput(source), true)
  assert.equal(currentWorkInput({ ...source, delivery: 'context' }), false)
  assert.equal(currentWorkInput({ kind: 'agent-message', senderSessionId: 'worker' }), false)
})

test('each actual Agent receives its own public task boundary even when context services are inherited', () => {
  const make = () => {
    const sections: string[] = [],
      guards: any[] = []
    const ctx: any = {
      get: (name: string) => (name === 'pxChannelTaskAudience' ? { version: 1 } : undefined),
      on: () => () => {},
      effect: () => {},
      tools: {
        guard: (fn: any) => {
          guards.push(fn)
        },
        register: () => {}
      },
      systemPrompt: { section: (row: any) => sections.push(row.name) }
    }
    return { ctx, sections, guards }
  }
  const parent = make(),
    child = make(),
    parentAgent = {},
    childAgent = {}
  installChannelTaskAudience(parent.ctx, parentAgent)
  installChannelTaskAudience(parent.ctx, parentAgent)
  installChannelTaskAudience(child.ctx, childAgent)
  assert.deepEqual(parent.sections, ['px-channel-public-persona'])
  assert.deepEqual(child.sections, ['px-channel-public-persona'])
  assert.equal(child.guards.length, 1)
})

test('native delegated user-shaped prompts cannot masquerade as independent human feedback; RPCs and ordinary forks retain provenance', async () => {
  const records = [
    {
      seq: 0,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'inherited human' }] }
    },
    { seq: 1, type: 'subagent/descriptor', data: {} },
    {
      seq: 2,
      time: 1,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'parent-generated assignment' }] }
    }
  ]
  const reader = {
    inheritedEventCount: 1,
    read: async (offset: number, length: number) => ({ events: records.slice(offset, offset + length) })
  }
  assert.equal(await nativeDelegationBoundary(reader), 1)
  assert.equal(historyRecord(records[2] as any, undefined, true)?.kind, 'coordination')
  assert.equal(
    historyRecord(
      {
        ...records[2],
        data: { ...records[2].data, source: { kind: 'user', rpcId: 'human-request' } }
      } as any,
      undefined,
      true
    )?.kind,
    'user'
  )
  assert.equal(await nativeDelegationBoundary({ ...reader, inheritedEventCount: 2 }), undefined)
})
