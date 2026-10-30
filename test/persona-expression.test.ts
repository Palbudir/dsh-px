import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { MemoryStore, memoryContext } from '../packages/dsh-px-memory/src/store'
import { expressionStarter, renderPersonaExpression } from '../packages/shared/persona-expression'
import { installPublicQqAgent } from '../packages/dsh-px-qq/src/public-agent'

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'px-persona-expression-'))
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  })
  const file = join(dir, 'memory.json')
  return { file, store: new MemoryStore(file) }
}

test('expression is revisioned, never inherited from a later version, and old private instructions stay private', (t) => {
  const { file, store } = fixture(t)
  let state = store.bind('old', { locked: true })
  state = store.action(
    state.revision,
    {
      type: 'configure',
      name: '角色',
      instructions: 'PRIVATE-ONLY-731',
      memoryEnabled: true,
      expression: expressionStarter('lively')
    },
    'old',
    null
  )
  assert.equal(store.persona(state, 'old').expression, undefined)
  store.bind('new', { personaId: 'default', locked: true })
  store.bind('group', {
    personaId: 'default',
    locked: true,
    channel: {
      provider: 'qq',
      accountId: '11001',
      conversationId: 'group:22002',
      access: 'public',
      publicInstructions: '渠道背景'
    }
  })
  const restarted = new MemoryStore(file)
  const group = restarted.persona(restarted.read(), 'group')
  assert.equal(group.expression?.style, 'lively')
  assert.equal(group.instructions, '渠道背景')
  assert.ok(!JSON.stringify(group).includes('PRIVATE-ONLY'))
  assert.ok(!memoryContext(group, null).includes('PRIVATE-ONLY'))
  assert.ok(memoryContext(restarted.persona(restarted.read(), 'new'), null).includes('PRIVATE-ONLY'))
  const prior = renderPersonaExpression(group.expression)
  state = store.action(
    store.read().revision,
    {
      type: 'configure',
      name: '角色',
      instructions: 'PRIVATE-ONLY-731',
      memoryEnabled: true,
      expression: expressionStarter('task')
    },
    'new',
    null
  )
  assert.equal(renderPersonaExpression(store.persona(state, 'group').expression), prior)
  state = store.action(state.revision, { type: 'adopt-version' }, 'new', null)
  assert.equal(store.persona(state, 'new').expression?.style, 'task')
  assert.equal(store.persona(state, 'group').expression?.style, 'lively')
})

test('legacy callers preserve expression; clearing it is explicit and malformed settings cannot corrupt storage', (t) => {
  const { file, store } = fixture(t)
  let state = store.action(
    0,
    {
      type: 'configure',
      name: '角色',
      instructions: '',
      memoryEnabled: true,
      expression: expressionStarter('balanced')
    },
    'a',
    null
  )
  state = store.action(
    state.revision,
    { type: 'configure', name: '新名', instructions: '', memoryEnabled: false },
    'a',
    null
  )
  assert.equal(store.persona(state, 'a').expression?.style, 'balanced')
  const before = readFileSync(file, 'utf8')
  assert.throws(
    () =>
      store.action(
        state.revision,
        {
          type: 'configure',
          name: '新名',
          instructions: '',
          memoryEnabled: true,
          expression: { ...expressionStarter('custom'), principles: 'x'.repeat(2001) }
        },
        'a',
        null
      ),
    /表达/
  )
  assert.equal(readFileSync(file, 'utf8'), before)
  state = store.action(
    state.revision,
    {
      type: 'configure',
      name: '新名',
      instructions: '',
      memoryEnabled: false,
      expression: null
    },
    'a',
    null
  )
  assert.equal(store.persona(state, 'a').expression, undefined)
})

test('public native preset uses edited expression text, not the starter label, with unchanged tool boundary', (t) => {
  const { store } = fixture(t)
  store.action(
    0,
    {
      type: 'configure',
      name: '角色',
      instructions: 'OWNER-SECRET-732',
      memoryEnabled: true,
      expression: {
        ...expressionStarter('lively'),
        instructions: '本次实际配置：严格回答 JSON',
        examples: ''
      }
    },
    'owner',
    null
  )
  store.bind('group', {
    locked: true,
    channel: {
      provider: 'qq',
      accountId: '11001',
      conversationId: 'group:22002',
      access: 'public',
      publicInstructions: ''
    }
  })
  const sections: any[] = [],
    guards: any[] = [],
    tools: any[] = []
  const ctx: any = {
    pxMemoryChannels: {
      version: 1,
      inspect: (id: string) => ({
        binding: store.read().bindings[id],
        persona: store.persona(store.read(), id)
      })
    },
    tools: {
      presentAs: () => () => {},
      guard: (v: any) => {
        guards.push(v)
        return () => {}
      },
      register: (v: any) => {
        tools.push(v)
        return () => {}
      }
    },
    systemPrompt: {
      section: (v: any) => {
        sections.push(v)
        return () => {}
      }
    },
    on: () => () => {},
    effect: (work: any) => {
      const value = work()
      if (value?.next)
        for (const _ of value) {
        }
    }
  }
  installPublicQqAgent(ctx)
  const agent = { session: { id: 'group' } }
  const prompt = sections[0].text({ agent })
  assert.match(prompt, /本次实际配置：严格回答 JSON/)
  assert.ok(!prompt.includes('OWNER-SECRET'))
  assert.ok(!prompt.includes('以有个性、有情绪色彩'))
  assert.equal(guards[0]({ agent, name: 'write' }), '此 QQ 聊天没有本机执行或私有资料权限')
  assert.equal(guards[0]({ agent, name: 'qq_expression' }), undefined)
  assert.equal(guards[0]({ agent, name: 'qq_task' }), '当前轮没有获授权成员的 QQ 请求，或 QQ 接入已关闭')
})
