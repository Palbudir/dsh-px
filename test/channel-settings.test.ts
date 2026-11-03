import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
  NativeChannelSettings,
  defaultChannelAttention,
  parseChannelConfiguration
} from '../packages/dsh-px-workbench/src/channel-settings'

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
