import fs from 'node:fs'
import { resolve, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const parent = fs.realpathSync(tmpdir()),
  root = fs.mkdtempSync(join(parent, 'px-im-mode-'))
let passed = false
try {
  if (!process.argv[2]) throw Error('Expected an isolated derived IM package directory')
  const pkg = resolve(process.argv[2])
  const rawStore = await import(pathToFileURL(join(pkg, 'src/channels/feishu/plugin-config-store.mjs')))
  const rawController = await import(pathToFileURL(join(pkg, 'src/channels/feishu/multi-bot-controller.mjs')))

  const results = []
  for (const [label, classes] of [['source', { ...rawStore, ...rawController }]]) {
    const { PluginConfigStore, MultiBotDshFeishuController } = classes
    const path = join(root, label + '.json')
    let store = await new PluginConfigStore(path).load()
    const entry = {
      id: 'bot_test',
      appId: 'cli_test',
      secretRef: 'QA_SECRET',
      ownerOpenIds: ['ou_owner'],
      domain: 'feishu',
      botOpenId: 'ou_bot',
      botName: 'Test bot'
    }
    await store.saveBot(entry)
    await store.saveBot({ ...entry, id: 'bot_other', appId: 'cli_other', secretRef: 'QA_OTHER' })
    const other = JSON.stringify(store.getBot('bot_other'))
    let starts = 0,
      failStart = false,
      failStop = false,
      active = 0,
      mode,
      controller,
      release
    const make = () =>
      new MultiBotDshFeishuController({
        configStore: store,
        credentials: { resolve: async () => ({ value: 'synthetic-secret' }) },
        registerApp: async () => {
          throw Error('Registration forbidden')
        },
        verifyApp: async () => ({ openId: 'ou_bot' }),
        logger: { info() {}, warn() {}, error() {} },
        createRuntime: async ({ config }) => {
          let running = false
          return {
            status: { ready: false, feishuLongConnectionState: 'idle', harnessReachable: false },
            async start() {
              if (config.id === 'bot_test') {
                starts++
                mode = config.consumerMode
                if (failStart) throw Error('START_FAILURE')
                active++
                assert.equal(active, 1, 'same account must never overlap runtimes')
              }
              running = true
              this.status = { ready: true, feishuLongConnectionState: 'connected', harnessReachable: true }
            },
            async stop() {
              if (config.id === 'bot_test') {
                if (failStop) throw Error('STOP_FAILURE')
                if (running) active--
              }
              running = false
              this.status = { ready: false, feishuLongConnectionState: 'idle', harnessReachable: false }
            }
          }
        }
      })
    try {
      controller = make()
      await controller.initialize()
      let description = await controller.describeDeliveryAccount('bot_test')
      const fp = description.account.fingerprint
      assert.equal(description.reception.mode, 'standalone')
      assert.equal(description.reception.active, false)
      assert.ok(description.capabilities.includes('consumer-mode-control-px1'))
      const options = () => ({
        expectedFingerprint: fp,
        expectedRevision: controller.pxReceptionState('bot_test').revision
      })
      const beforeTakeover = options()
      await assert.rejects(
        controller.consumeInbound('bot_test', {
          expectedFingerprint: fp,
          expectedRevision: 'stale',
          onEvent: async () => ({ accepted: true })
        }),
        (e) => e.code === 'consumer-state-changed'
      )
      release = await controller.consumeInbound('bot_test', {
        expectedFingerprint: fp,
        onEvent: async () => ({ accepted: true })
      })
      assert.equal(controller.pxReceptionState('bot_test').active, true)
      await assert.rejects(
        controller.restoreInbound('bot_test', options()),
        (e) => e.code === 'consumer-conflict'
      )
      release()
      assert.equal(controller.pxReceptionState('bot_test').active, false)
      await assert.rejects(
        controller.restoreInbound('bot_test', beforeTakeover),
        (e) => e.code === 'consumer-state-changed'
      )
      await assert.rejects(
        controller.restoreInbound('bot_test', { ...options(), expectedFingerprint: 'f'.repeat(64) }),
        (e) => e.code === 'account-changed'
      )
      assert.equal(store.getBot('bot_test').consumerMode, 'external-consumer')
      failStop = true
      await assert.rejects(controller.restoreInbound('bot_test', options()), /STOP_FAILURE/)
      assert.equal(active, 1)
      assert.equal(store.getBot('bot_test').consumerMode, 'external-consumer')
      assert.equal(controller.pxReceptionState('bot_test').stopUncertain, true)
      failStop = false
      await controller.restoreInbound('bot_test', options())
      assert.equal(mode, 'standalone')
      assert.equal(active, 1)
      release = await controller.consumeInbound('bot_test', {
        expectedFingerprint: fp,
        onEvent: async () => ({ accepted: true })
      })
      release()
      failStart = true
      await assert.rejects(controller.restoreInbound('bot_test', options()), /START_FAILURE/)
      assert.equal(store.getBot('bot_test').consumerMode, 'standalone')
      assert.equal(active, 0)
      failStart = false
      await controller.initialize()
      assert.equal(active, 1)
      failStop = true
      await assert.rejects(
        controller.consumeInbound('bot_test', {
          expectedFingerprint: fp,
          onEvent: async () => ({ accepted: true })
        }),
        /STOP_FAILURE/
      )
      assert.equal(active, 1)
      assert.equal(controller.pxReceptionState('bot_test').stopUncertain, true)
      failStop = false
      release = await controller.consumeInbound('bot_test', {
        expectedFingerprint: fp,
        onEvent: async () => ({ accepted: true })
      })
      release()
      const obsolete = options()
      await controller.close()
      assert.equal(active, 0)
      store = await new PluginConfigStore(path).load()
      controller = make()
      await controller.initialize()
      assert.equal(mode, 'external-consumer')
      await assert.rejects(
        controller.restoreInbound('bot_test', obsolete),
        (e) => e.code === 'consumer-state-changed'
      )
      const abort = new AbortController()
      abort.abort()
      await assert.rejects(controller.restoreInbound('bot_test', { ...options(), signal: abort.signal }))
      await controller.restoreInbound('bot_test', options())
      assert.equal(mode, 'standalone')
      assert.equal(active, 1)
      assert.equal(JSON.stringify(store.getBot('bot_other')), other)
      results.push({
        label,
        pass: true,
        starts,
        accountCheck: true,
        leaseCheck: true,
        staleCheck: true,
        stopFailureRetainsHandle: true,
        startFailureTruthful: true,
        restartStaleCheck: true,
        otherAccountUnchanged: true
      })
    } finally {
      failStop = false
      release?.()
      await controller?.close()
      assert.equal(active, 0)
    }
  }
  passed = true
  console.log('Native IM mode and failure recovery checks passed (SDK runtime controlled).')
} finally {
  if (!resolve(root).startsWith(parent + sep)) throw Error('Invalid verification directory')
  if (passed) fs.rmSync(root, { recursive: true, force: true })
  else console.error('Mode verification evidence retained:', root)
}
