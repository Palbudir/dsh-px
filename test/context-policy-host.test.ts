import test from 'node:test'
import assert from 'node:assert/strict'
import { installContextPolicy, modelCapacity } from '../packages/dsh-px-workbench/src/context-policy'

function harness() {
  const handlers = new Map<string, Function>(),
    services: any = {}
  const capacity: Record<string, number | undefined> = {
    small: 32768,
    small64: 65536,
    medium: 131072,
    large: 1048576,
    unknown: undefined
  }
  services.llm = {
    resolveModelInfo: async (provider: string, model: string) => ({
      provider,
      id: model,
      context: capacity[model] ? { contextWindow: capacity[model] } : undefined
    }),
    listConfigurableProviders: () => []
  }
  let tokens = 1000
  services.tokenMeter = { measure: () => ({ totalTokens: tokens }) }
  const tables = new Map<string, Map<string, any>>()
  services.storageDomain = {
    open: async (spec: any) => ({
      table: (name: string) => {
        if (!tables.has(name)) tables.set(name, new Map())
        return {
          get: (id: string) => tables.get(name)!.get(id),
          put: async (id: string, value: any) => {
            tables.get(name)!.set(id, spec.tables[name].valueSchema.parse(value))
          }
        }
      },
      close: async () => {}
    })
  }
  const ctx = {
    get: (key: string) => services[key],
    provide: (key: string, v: any) => {
      services[key] = v
    },
    on: (name: string, fn: Function) => handlers.set(name, fn)
  }
  installContextPolicy(ctx)
  const events: any[] = []
  const agent = {
    options: { provider: 'test', model: 'small' },
    status: 'idle',
    session: {
      id: 'session-test',
      inheritedEventCount: 0,
      snapshotEvents: () => events,
      requestContext: () => events.findLast((e) => e.type === 'request/context')?.data,
      append: (type: string, data: any) => events.push({ seq: events.length, type, data })
    }
  }
  return {
    ctx,
    services,
    handlers,
    agent,
    events,
    setTokens: (value: number) => {
      tokens = value
    }
  }
}
test('native policy binds only at request; checks persisted tier, current request routing, and exact smaller capacity', async () => {
  const h = harness(),
    p = h.services.pxContextPolicy,
    signal = new AbortController().signal
  await p.select(h.agent, { provider: 'test', model: 'large' })
  assert.equal(h.events.length, 0)
  const assembly = {
    variables: { provider: 'test', model: 'small' },
    contexts: [
      { name: 'identity', text: 'NEVER_TRUNCATE' },
      { name: 'dsh-px-work-ledger', text: 'x'.repeat(8000) }
    ],
    sections: [],
    tools: []
  }
  const output = await h.handlers.get('system-prompt/assemble')!(
    assembly,
    { agent: h.agent, signal },
    async () => assembly
  )
  assert.equal(output.contexts[0].text, 'NEVER_TRUNCATE')
  assert.match(output.contexts[1].text, /task_review/)
  assert.equal(h.events.length, 0)
  const config = await p.request(h.agent, { provider: 'test', model: 'small' }, signal)
  assert.equal(config.maxTokens, 4096)
  assert.equal((await p.state.get(h.agent.session.id)).tier, 'minimum')
  assert.equal(h.events.length, 0, 'no unknown vocabulary is written to the native session log')
  await assert.rejects(p.select(h.agent, { provider: 'test', model: 'large' }), /新建接续/)
  await p.select(h.agent, { provider: 'test', model: 'small64' })
  h.events.push({
    seq: 0,
    type: 'request/context',
    data: { provider: 'test', model: 'small64', contextWindow: 65536 }
  })
  h.setTokens(30000)
  await assert.rejects(p.select(h.agent, { provider: 'test', model: 'small' }), /放不进/)
  h.agent.status = 'running'
  await assert.rejects(p.select(h.agent, { provider: 'test', model: 'small64' }), /本轮结束/)
  await assert.rejects(p.request(h.agent, { provider: 'test', model: 'small64' }, signal), /组装期间变化/)
})
test('a new native child may choose its own tier despite inherited parent requests', async () => {
  const h = harness()
  h.events.push({
    seq: 0,
    type: 'request/context',
    data: { provider: 'test', model: 'large', contextWindow: 1048576 }
  })
  h.agent.session.inheritedEventCount = 1
  await h.services.pxContextPolicy.request(h.agent, { provider: 'test', model: 'small' })
  assert.equal((await h.services.pxContextPolicy.state.get(h.agent.session.id)).tier, 'minimum')
})
test('custom model fallback is not treated as declared 256K; explicit route and model capacities win', async () => {
  const h = harness()
  h.services.llm.resolveModelInfo = async () => ({ context: { contextWindow: 262144 } })
  h.services.llm.listConfigurableProviders = () => [
    { provider: 'custom', declared: true, settingsNs: 'llm', settingsPath: ['providers', 'custom'] }
  ]
  const row: any = {
    entry: { options: { id: 'llm' } },
    inherited: { providers: { custom: { models: [{ id: 'm' }] } } },
    override: {}
  }
  h.services.configEditor = { configuration: () => [row] }
  assert.equal((await modelCapacity(h.ctx, { provider: 'custom', model: 'm' })).capacity, undefined)
  row.override = { providers: { custom: { defaultContextWindow: 32768 } } }
  assert.equal((await modelCapacity(h.ctx, { provider: 'custom', model: 'm' })).capacity, 32768)
  row.inherited.providers.custom.models[0].contextWindow = 131072
  assert.equal((await modelCapacity(h.ctx, { provider: 'custom', model: 'm' })).tier, 'brief')
})
test('native compaction policy leaves small models space and respects stricter user limits', async () => {
  const h = harness(),
    p = h.services.pxContextPolicy
  const defaults = {
    headroomTokens: 65536,
    maxTokens: 65536,
    thresholdRatio: 0.8,
    retainRatio: 0.16,
    summarizationProvider: '',
    summarizationModel: ''
  }
  const small = await p.compaction(defaults, h.agent, { provider: 'test', model: 'small' })
  assert.equal(small.headroomTokens, 2048)
  assert.equal(small.maxTokens, 2048)
  assert.equal(small.thresholdRatio, defaults.thresholdRatio)
  const strict = await p.compaction(
    { ...defaults, maxTokens: 512, headroomTokens: 0, thresholdRatio: 0.5, retainTokens: 64 },
    h.agent,
    { provider: 'test', model: 'small' }
  )
  assert.equal(strict.maxTokens, 512)
  assert.equal(strict.headroomTokens, 0)
  assert.equal(strict.thresholdRatio, 0.5)
  assert.equal(strict.retainTokens, 64)
})
