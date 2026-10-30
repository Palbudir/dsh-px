import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attentionDelivery, parseAttention, QqAttentionControl } from '../packages/dsh-px-qq/src/attention'
import { parseQqSettings } from '../packages/dsh-px-qq/src/settings'
import { channelFor } from '../packages/dsh-px-qq/src/policy'

const group = { chatId: 'group:22002', mentioned: false, self: false }
test('normal mode reads direct requests and watched groups, previews other groups, and focus covers every received group', () => {
  const normal = parseAttention({ focusedChats: ['group:33003'] })
  assert.equal(attentionDelivery(normal, group).content, 'preview')
  assert.equal(attentionDelivery(normal, { ...group, mentioned: true }).content, 'full')
  assert.equal(attentionDelivery(normal, { ...group, chatId: 'private:44004' }).content, 'full')
  assert.equal(attentionDelivery(normal, { ...group, chatId: 'group:33003' }).content, 'full')
  for (const chatId of ['group:22002', 'group:33003', 'group:55005', 'private:44004'])
    assert.equal(attentionDelivery(parseAttention({ mode: 'focus' }), { ...group, chatId }).content, 'full')
  for (const mode of ['focus', 'normal', 'notifications'])
    assert.equal(attentionDelivery(parseAttention({ mode }), { ...group, self: true }).content, 'ignore')
})
test('notification mode never delivers full chat content; mute and mention overrides apply independently', () => {
  const config = parseAttention({ mode: 'notifications', mutedChats: ['group:22002', 'private:44004'] })
  assert.deepEqual(attentionDelivery(config, group), { content: 'preview', notify: false, reason: 'muted' })
  assert.equal(attentionDelivery(config, { ...group, mentioned: true }).notify, true)
  assert.equal(
    attentionDelivery({ ...config, mentionOverridesMute: false }, { ...group, mentioned: true }).notify,
    false
  )
  assert.equal(attentionDelivery(config, { ...group, chatId: 'private:44004' }).notify, false)
  assert.equal(attentionDelivery(config, { ...group, chatId: 'private:66006' }).notify, true)
  assert.equal(attentionDelivery(config, { ...group, chatId: 'group:55005' }).notify, false)
  assert.equal(
    attentionDelivery({ ...config, notifyGroups: true }, { ...group, chatId: 'group:55005' }).notify,
    true
  )
  for (const mentioned of [true, false])
    assert.equal(attentionDelivery(config, { ...group, mentioned }).content, 'preview')
})
test('attention cannot mutate execution authority or public audience, including malformed settings', () => {
  const settings = parseQqSettings({ accountId: '11001', authorizedUsers: ['44004'] })
  for (const mode of ['focus', 'normal', 'notifications']) {
    const value = parseQqSettings({ ...settings, attention: parseAttention({ mode }) })
    assert.equal(channelFor(value, 'group:22002').access, 'public')
    assert.equal(channelFor(value, 'private:44004').access, 'owner')
    assert.equal(channelFor(value, 'private:66006').access, 'public')
  }
  assert.throws(() => parseAttention({ authorizedUsers: ['66006'] }), /未知/)
  assert.throws(() => parseAttention({ mutedChats: ['group:__proto__'] }), /列表/)
  assert.throws(() => parseAttention({ notifyDirect: 'false' }), /布尔/)
  const a = parseAttention({}),
    b = parseAttention({})
  a.focusedChats.push('group:22002')
  assert.deepEqual(b.focusedChats, [])
})
test('agent attention changes expire, cannot open invented chats, and never override a later user choice', () => {
  let time = 1000
  const controller = new QqAttentionControl(parseAttention({ mode: 'notifications' }), () => time)
  assert.throws(
    () => controller.adjust({ chatId: 'group:33003', minutes: 5, reason: '看看' }, ['group:22002']),
    /已收到/
  )
  controller.adjust({ mode: 'normal', chatId: 'group:22002', minutes: 5, reason: '查看刚收到的提问' }, [
    'group:22002'
  ])
  assert.equal(controller.effective().mode, 'normal')
  assert.equal(attentionDelivery(controller.effective(), group).content, 'full')
  time += 300000
  assert.equal(controller.effective().mode, 'notifications')
  assert.deepEqual(controller.effective().focusedChats, [])
  controller.adjust({ mode: 'focus', minutes: 1, reason: '临时关注' }, [])
  controller.userSettings(parseAttention({ mode: 'notifications', allowAgentChanges: false }))
  assert.equal(controller.snapshot().temporary, null)
  assert.throws(() => controller.adjust({ mode: 'focus', minutes: 1, reason: '再次改变' }, []), /固定/)
  assert.equal(controller.effective().mode, 'notifications')
})

test('opening one notification does not wake unrelated private chats or mentions', () => {
  const controller = new QqAttentionControl(parseAttention({ mode: 'notifications' }))
  controller.adjust({ chatId: 'group:22002', minutes: 5, reason: '查看这个群' }, ['group:22002'])
  const active = controller.effective()
  assert.equal(active.mode, 'notifications')
  assert.equal(attentionDelivery(active, group).content, 'full')
  assert.equal(
    attentionDelivery(active, { ...group, chatId: 'group:33003', mentioned: true }).content,
    'preview'
  )
  assert.equal(attentionDelivery(active, { ...group, chatId: 'private:44004' }).content, 'preview')
})
