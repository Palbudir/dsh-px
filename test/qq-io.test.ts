import test from 'node:test'
import assert from 'node:assert/strict'
import { QqSessionPolicy } from '../packages/dsh-px-qq/src/session-policy'
import { DEFAULT_QQ_SETTINGS, channelFor } from '../packages/dsh-px-qq/src/policy'

function fixture() {
  const settings = { ...DEFAULT_QQ_SETTINGS, accountId: '12001', authorizedUsers: ['23007'], personaId: 'p' }
  const channel = channelFor(settings, 'private:23007'),
    guards: Array<(exec: any) => string | undefined> = []
  const memory = {
    version: 1,
    bind() {},
    inspect: (id: string) => ({ binding: id === 'owner' ? { personaId: 'p', channel } : undefined })
  }
  const policy = new QqSessionPolicy(
    { get: (name: string) => (name === 'pxMemoryChannels' ? memory : undefined) },
    settings,
    {} as any
  )
  policy.installScope(
    {
      tools: {
        guard: (g: any) => {
          guards.push(g)
        }
      }
    },
    'owner',
    'private:23007'
  )
  return { policy, guard: guards[0] }
}
test('QQ native tool guard rejects unknown callers and raw file-upload bypasses', () => {
  const { policy, guard } = fixture()
  const owner = { session: { id: 'owner' } }
  assert.match(guard({ name: 'qq_send_file' })!, /授权私聊/)
  assert.match(
    guard({ name: 'qq_napcat_api', agent: owner, arguments: { action: 'upload_private_file' } })!,
    /qq_send_file/
  )
  assert.equal(guard({ name: 'qq_send_file', agent: owner, arguments: { path: 'test.txt' } }), undefined)
  assert.equal(guard({ name: 'read', arguments: {} }), undefined)
  policy.dispose()
  assert.match(guard({ name: 'qq_send_file', agent: owner })!, /授权私聊/)
})
test('cancelled QQ tool IO cannot begin after an asynchronous wait', async () => {
  const { policy } = fixture(),
    controller = new AbortController()
  let release!: () => void,
    sent = 0
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const work = policy.runTool(
    { name: 'qq_send_image', agent: { session: { id: 'owner' } }, signal: controller.signal },
    async () => {
      await waiting
      policy.beforeConnectionCall()
      sent++
    }
  )
  controller.abort(new Error('stopped'))
  release()
  await assert.rejects(work, /stopped/)
  assert.equal(sent, 0)
  policy.dispose()
})
