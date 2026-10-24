import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { apply } from '../packages/dsh-px-taskflow/src/index'

test('native classification permits evidence overlap while reads retain session snapshots and checkpoints stay exclusive', async () => {
  const tools = new Map<string, any>()
  const ctx: any = {
    tools: { register: (definition: any) => tools.set(definition.name, definition) },
    systemPrompt: { section: () => () => {} },
    effect: (fn: any) => fn(),
    inject: (names: string[], install: any) => {
      if (names.every((name) => ctx[name])) install(ctx)
    }
  }
  apply(ctx)
  const nativeMode = (name: string) =>
    ToolRuntime.prototype.executionMode.call(
      { resolveExecution: (key: string) => tools.get(key) } as unknown as ToolRuntime,
      { name, arguments: {} } as any
    ).kind
  for (const name of ['task_state', 'task_review', 'task_evidence'])
    assert.equal(nativeMode(name), 'parallel')
  assert.equal(nativeMode('task_checkpoint'), 'exclusive')
  const session = (id: string, text: string) => ({
    header: { id },
    snapshotEvents: () => [
      { seq: 0, time: 0, type: 'tool/call', data: { callId: 'same-call', name: 'read', arguments: '{}' } },
      {
        seq: 1,
        time: 1,
        type: 'tool/result',
        data: {
          message: { role: 'tool', toolCallId: 'same-call', content: [{ type: 'text', text }] }
        }
      }
    ]
  })
  const a = { id: 'a', session: session('a', 'only-a') }
  const b = { id: 'b', session: session('b', 'only-b') }
  const read = (agent: any) =>
    tools.get('task_evidence').execute(
      { callId: 'same-call' },
      {
        agent,
        signal: new AbortController().signal
      }
    )
  const values = await Promise.all(Array.from({ length: 40 }, (_, i) => read(i % 2 ? b : a)))
  values.forEach((value, i) => assert.equal(JSON.parse(value).output, i % 2 ? 'only-b' : 'only-a'))
  // A later read observes the new snapshot; a previous call's returned JSON stays immutable.
  a.session = session('a', 'new-a')
  assert.equal(JSON.parse(await read(a)).output, 'new-a')
  assert.equal(JSON.parse(values[0]).output, 'only-a')
})
