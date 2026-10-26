import test from 'node:test'
import assert from 'node:assert/strict'
import { NativeQqSettings, parseQqSettings } from '../packages/dsh-px-qq/src/settings'
import { DEFAULT_QQ_SETTINGS } from '../packages/dsh-px-qq/src/policy'

test('native QQ edits preserve foreign settings and reject a concurrent writer before mutation', async () => {
  const entry = {
    options: { id: 'dsh-onebot', config: { foreignOption: 731, pxQq: { ...DEFAULT_QQ_SETTINGS } } }
  }
  let writes = 0
  const store = new NativeQqSettings({
    configuration: () => [{ entry }],
    edit: async (_: unknown, update: (v: any) => any) => {
      entry.options.config = update(entry.options.config)
      writes++
    }
  })
  const a = store.read(),
    b = store.read()
  const saved = await store.save(a.revision, { ...a.settings, publicIntroduction: '群内可见' })
  assert.equal(entry.options.config.foreignOption, 731)
  assert.equal(saved.settings.publicIntroduction, '群内可见')
  await assert.rejects(store.save(b.revision, b.settings), /设置已变化/)
  assert.equal(writes, 1)
})

test('QQ defaults stay disconnected and invalid enabled configurations cannot reach activation', () => {
  assert.equal(parseQqSettings({}).enabled, false)
  assert.throws(() => parseQqSettings({ enabled: true }), /启用前/)
  assert.throws(() => parseQqSettings({ accountId: '11001', authorizedUsers: ['11001'] }), /负责人/)
  assert.throws(() => parseQqSettings({ authorizedUsers: ['not-an-id'] }), /QQ 号/)
  assert.throws(() => parseQqSettings({ endpoint: 'ws://remote.example' }), /本机/)
  assert.throws(() => parseQqSettings({ workspace: 'relative/project' }), /完整/)
  assert.throws(() => parseQqSettings({ publicIntroduction: 'x'.repeat(2001) }), /长度/)
  assert.throws(() => parseQqSettings({ accessToken: 'must-not-persist-here' }), /未知字段/)
})
