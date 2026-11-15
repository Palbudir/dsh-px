import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { FeishuTasks } from '../packages/dsh-px-workbench/src/feishu-tasks'
import {
  defaultChannelAttention,
  type ChannelAccount
} from '../packages/dsh-px-workbench/src/channel-settings'

test('task participant status excludes account diagnostics and stopping an older task does not depend on UI pagination', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'px-task-authority-'))
  const account: ChannelAccount = {
    provider: 'feishu',
    accountId: 'bot',
    fingerprint: 'a'.repeat(64),
    enabled: true,
    personaId: 'default',
    workspace: directory,
    routeRevision: 1,
    authorizedUsers: ['owner', 'other'],
    publicInstructions: '',
    attention: defaultChannelAttention()
  }
  const bindings: any[] = []
  const host = {
    agents: { get: () => undefined },
    pxPersonaResources: { allowsChannel: () => true },
    pxMemoryChannels: {
      channelBindings: () => bindings,
      inspect: (id: string) => ({ binding: bindings.find((r) => r.sessionId === id) })
    }
  }
  const tasks = new FeishuTasks(
    host,
    account,
    () => account,
    () => true,
    directory,
    'epoch',
    async () => {}
  )
  t.after(async () => {
    await tasks.dispose()
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
    rmSync(directory, { recursive: true, force: true })
  })
  for (let i = 0; i < 102; i++) {
    const taskId = 'task-' + i,
      actorId = i === 101 ? 'other' : 'owner',
      chat = i === 101 ? 'other-chat' : 'chat'
    bindings.push({
      sessionId: taskId,
      personaId: 'default',
      channel: {
        provider: 'feishu',
        accountId: 'bot',
        conversationId: chat,
        access: 'public',
        task: { rootSessionId: taskId, requesterId: actorId }
      }
    })
    const recipient = { personaId: 'default', routeRevision: 1, executionSessionId: taskId }
    const accepted = tasks.inbox.accept(
      {
        provider: 'feishu',
        accountId: 'bot',
        fingerprint: account.fingerprint,
        eventId: 'event-' + i,
        messageId: 'message-' + i,
        conversationId: chat,
        actorId,
        kind: 'group',
        mentioned: true,
        at: new Date().toISOString(),
        text: 'task',
        reply: { messageId: 'message-' + i }
      },
      recipient
    )
    const claim = { ...recipient, sessionId: taskId, requestId: 'request-' + i, epoch: 'epoch' }
    assert.equal(tasks.inbox.claim(accepted.id, claim), true)
    assert.equal(tasks.inbox.admit(accepted.id, claim, 'native-' + i), true)
  }
  const view = tasks.status({ conversationId: 'chat', requesterId: 'owner' })
  assert.equal(view.total, 101)
  assert.equal(view.records.length, 100)
  assert.equal(view.partial, true)
  assert.ok(
    view.records.every(
      (r: { requesterId: string; conversationId: string }) =>
        r.requesterId === 'owner' && r.conversationId === 'chat'
    )
  )
  assert.equal('errors' in view, false)
  assert.equal('receipts' in view, false)
  let stopped = ''
  tasks.stopTask = async (id) => {
    stopped = id
  }
  await tasks.stopForRequester('task-0', 'chat', 'owner')
  assert.equal(stopped, 'task-0')
  await assert.rejects(tasks.stopForRequester('task-101', 'chat', 'owner'), /不属于/)
  account.authorizedUsers = []
  await assert.rejects(tasks.stopForRequester('task-0', 'chat', 'owner'), /授权/)
})
