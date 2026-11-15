import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
  NativeChannelSettings,
  channelRoute,
  defaultChannelAttention,
  parseChannelConfiguration
} from '../packages/dsh-px-workbench/src/channel-settings'

test('chat persona revisions stay local and returning to default never revives an earlier session generation', async () => {
  const entry = { options: { id: 'dsh-px-channel-settings', config: {} as any } }
  const settings = new NativeChannelSettings({
    configuration: () => [{ entry }],
    edit: async (_: any, update: any) => {
      entry.options.config = update(entry.options.config)
    }
  })
  let state = await settings.save(settings.read().revision, {
    version: 1,
    accounts: [
      {
        provider: 'feishu',
        accountId: 'bot',
        fingerprint: 'a'.repeat(64),
        enabled: true,
        personaId: 'a',
        workspace: resolve('build-test'),
        routeRevision: 1,
        authorizedUsers: [],
        publicInstructions: '',
        attention: defaultChannelAttention()
      }
    ]
  })
  const account = () => state.configuration.accounts[0]
  const original = channelRoute(account(), 'chat-one')
  state = await settings.changeRoute(state.revision, 'bot', 'chat-one', 'b')
  const pinned = channelRoute(account(), 'chat-one')
  assert.equal(pinned.personaId, 'b')
  assert.ok(pinned.routeRevision > original.routeRevision)
  assert.deepEqual(channelRoute(account(), 'chat-two'), original)
  account().personaId = 'c'
  state = await settings.save(state.revision, state.configuration)
  assert.deepEqual(channelRoute(account(), 'chat-one'), pinned)
  assert.equal(channelRoute(account(), 'chat-two').personaId, 'c')
  state = await settings.changeRoute(state.revision, 'bot', 'chat-one', null)
  const inherited = channelRoute(account(), 'chat-one')
  assert.equal(inherited.personaId, 'c')
  assert.ok(inherited.routeRevision > pinned.routeRevision)
  state = await settings.changeRoute(state.revision, 'bot', 'chat-one', null, true)
  assert.ok(channelRoute(account(), 'chat-one').routeRevision > inherited.routeRevision)
  const stale = state.revision
  state = await settings.changeRoute(state.revision, 'bot', 'chat-one', 'b')
  await assert.rejects(settings.changeRoute(stale, 'bot', 'chat-one', 'a'), /已变化/)
  const proposed = structuredClone(state.configuration)
  proposed.accounts[0].routes = []
  await assert.rejects(settings.save(state.revision, proposed), /聊天人格入口/)
})

test('native channel settings retain unrelated configuration, reject races and version only routing changes', async () => {
  const entry = { options: { id: 'dsh-px-channel-settings', config: { external: { keep: true } } as any } }
  let intervene = false
  const editor = {
    configuration: () => [{ entry }],
    edit: async (_: unknown, update: (v: any) => any) => {
      if (intervene) entry.options.config = { ...entry.options.config, otherWindow: true }
      entry.options.config = update(entry.options.config)
    }
  }
  const settings = new NativeChannelSettings(editor),
    initial = settings.read(),
    account = {
      provider: 'feishu',
      accountId: 'bot_test',
      fingerprint: 'a'.repeat(64),
      enabled: false,
      personaId: 'default',
      workspace: resolve('build-test'),
      routeRevision: 99,
      authorizedUsers: [],
      publicInstructions: '',
      attention: defaultChannelAttention()
    }
  let saved = await settings.save(initial.revision, { version: 1, accounts: [account] })
  assert.deepEqual(entry.options.config.external, { keep: true })
  assert.equal(saved.configuration.accounts[0].routeRevision, 1)
  saved.configuration.accounts[0].attention.mode = 'focus'
  saved = await settings.save(saved.revision, saved.configuration)
  assert.equal(saved.configuration.accounts[0].routeRevision, 1)
  saved.configuration.accounts[0].personaId = 'other'
  saved = await settings.save(saved.revision, saved.configuration)
  assert.equal(saved.configuration.accounts[0].routeRevision, 2)
  intervene = true
  await assert.rejects(settings.save(saved.revision, saved.configuration), /其他窗口/)
  assert.equal(entry.options.config.otherWindow, true)
  assert.equal(settings.read().configuration.accounts[0].routeRevision, 2)
  assert.throws(() => parseChannelConfiguration({ version: 1, accounts: [account, account] }), /一个接收方/)
})

test('persona mail settings use native CAS without replacing channel or third-party configuration', async () => {
  const entry = {
    options: {
      id: 'dsh-px-channel-settings',
      disabled: false,
      config: { external: { keep: true }, pxChannels: { version: 1, accounts: [] } } as any
    }
  }
  const settings = new NativeChannelSettings({
    configuration: () => [{ entry }],
    edit: async (_: any, update: any) => {
      entry.options.config = update(entry.options.config)
    }
  })
  const empty = settings.readMail()
  assert.deepEqual(empty.relations, [])
  const saved = await settings.saveMail(empty.revision, [
    { id: 'a-b', from: 'a', to: 'b', audience: { kind: 'personal' } }
  ])
  assert.equal(saved.relations.length, 1)
  assert.deepEqual(settings.read().configuration, { version: 1, accounts: [] })
  assert.deepEqual(entry.options.config.external, { keep: true })
  await assert.rejects(settings.saveMail(empty.revision, []), /已变化/)
  entry.options.disabled = true
  assert.equal(settings.readMail().componentEnabled, false)
})
