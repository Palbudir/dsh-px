import {
  contextBudget,
  contextTier,
  positiveCapacity,
  assertSameTier,
  type ContextTier
} from '../../shared/context-policy'
import { contextState } from './context-state'

const get = (ctx: any, key: string): any => ctx.get?.(key) ?? ctx[key]
export interface ModelRoute {
  provider: string
  model: string
  reasoningEffort?: string
}
export interface ModelCapacity extends ModelRoute {
  capacity?: number
  tier: ContextTier
  declared: boolean
}

/** Native settings retain whether a custom route was actually sized; adapter fallbacks are not declarations. */
export async function modelCapacity(
  ctx: any,
  route: ModelRoute,
  signal?: AbortSignal
): Promise<ModelCapacity> {
  const llm = get(ctx, 'llm')
  const info = await llm.resolveModelInfo(route.provider, route.model, signal)
  let capacity = positiveCapacity(info.context?.contextWindow)
  const directory = llm.listConfigurableProviders?.().find((p: any) => p.provider === route.provider)
  if (directory) {
    const row = get(ctx, 'configEditor')
      ?.configuration?.()
      .find((r: any) => r.entry.options.id === directory.settingsNs)
    const walk = (value: any): any => directory.settingsPath.reduce((v: any, k: string) => v?.[k], value)
    const inherited = walk(row?.inherited),
      override = walk(row?.override)
    const models = override?.models ?? inherited?.models
    const entry = models?.find((m: any) => m.id === route.model)
    // Custom explicit catalogs without a capacity must never inherit pi-ai's guessed 256K.
    if (directory.declared || entry) {
      capacity =
        positiveCapacity(entry?.contextWindow) ??
        positiveCapacity(override?.defaultContextWindow ?? inherited?.defaultContextWindow)
    }
  }
  signal?.throwIfAborted()
  return { ...route, capacity, declared: capacity !== undefined, tier: contextTier(capacity) }
}
export function ownRequestContext(session: any): any {
  return session
    .snapshotEvents()
    .findLast((e: any) => e.seq >= (session.inheritedEventCount ?? 0) && e.type === 'request/context')?.data
}

export function installContextPolicy(ctx: any): void {
  const state = contextState(ctx)
  const assembling = new WeakMap<object, ModelCapacity>()
  async function describe(agent: any, route: ModelRoute, signal?: AbortSignal): Promise<ModelCapacity> {
    return modelCapacity(ctx, route, signal)
  }
  async function validate(agent: any, route: ModelRoute, signal?: AbortSignal): Promise<ModelCapacity> {
    const value = await describe(agent, route, signal)
    let bound = (await state.get(agent.session.id))?.tier
    const prior = ownRequestContext(agent.session)
    if (!bound && prior) {
      const previous = await modelCapacity(ctx, prior, signal)
      bound = previous.tier
      assertSameTier(bound, value.tier)
      await state.bind(agent.session.id, {
        version: 1,
        tier: bound,
        provider: prior.provider,
        model: prior.model,
        ...(previous.capacity ? { capacity: previous.capacity } : {})
      })
    }
    assertSameTier(bound, value.tier)
    return value
  }
  const policy = {
    state,
    describe,
    budget: (agent: any) => contextBudget(assembling.get(agent)?.capacity),
    async compaction(config: any, agent: any, target: ModelRoute, signal?: AbortSignal, summary = false) {
      const route = summary
        ? {
            provider: config.summarizationProvider || target.provider,
            model: config.summarizationModel || target.model
          }
        : target
      const value = await modelCapacity(ctx, route, signal)
      const b = contextBudget(value.capacity)
      const retention =
        config.retainTokens === undefined
          ? { retainRatio: Math.min(config.retainRatio ?? b.retainRatio, b.retainRatio) }
          : {
              retainTokens: Math.min(
                config.retainTokens,
                Math.floor((value.capacity ?? 32_768) * b.retainRatio)
              )
            }
      return {
        ...config,
        ...retention,
        headroomTokens: Math.min(config.headroomTokens, b.headroomTokens),
        thresholdRatio: Math.min(config.thresholdRatio, b.thresholdRatio),
        maxTokens: Math.min(config.maxTokens, b.summaryTokens)
      }
    },
    async select(agent: any, route: ModelRoute) {
      const effective = assembling.get(agent) ?? agent.options
      if (
        agent.status === 'running' &&
        (effective.provider !== route.provider || effective.model !== route.model)
      )
        throw Error('请等待本轮结束或停止后再切换模型')
      const value = await validate(agent, route)
      const prior = agent.session.requestContext?.()
      if (prior && (prior.provider !== route.provider || prior.model !== route.model) && value.capacity) {
        const tokens = get(ctx, 'tokenMeter')?.measure(agent.session)?.totalTokens
        const budget = contextBudget(value.capacity)
        if (
          typeof tokens === 'number' &&
          tokens + budget.outputTokens + budget.headroomTokens >= value.capacity
        )
          throw Error('当前上下文放不进所选模型。请先压缩，或新建接续会话。')
      }
    },
    /** Applied only to this request, without editing stored model settings. */
    async request(agent: any, config: any, signal?: AbortSignal) {
      const value = await validate(agent, config, signal)
      const assembled = assembling.get(agent)
      if (assembled && (assembled.provider !== value.provider || assembled.model !== value.model))
        throw Error('模型路由在上下文组装期间变化，请重试本轮')
      const budget = contextBudget(value.capacity)
      const cap = positiveCapacity(config.maxTokens)
      const info = await get(ctx, 'llm').resolveModelInfo(value.provider, value.model, signal)
      const configuredCap = cap ?? positiveCapacity(info.defaultMaxTokens)
      signal?.throwIfAborted()
      if (!(await state.get(agent.session.id)))
        await state.bind(agent.session.id, {
          version: 1,
          tier: value.tier,
          provider: value.provider,
          model: value.model,
          ...(value.capacity ? { capacity: value.capacity } : {})
        })
      return { ...config, maxTokens: Math.min(configuredCap ?? budget.outputTokens, budget.outputTokens) }
    }
  }
  ctx.provide('pxContextPolicy', policy)
  ctx.on(
    'system-prompt/assemble',
    async (_assembly: any, context: any, next: () => Promise<any>) => {
      const agent = context.agent
      if (!agent) return next()
      const assembly = await next()
      const route = {
        provider: assembly.variables.provider || agent.options.provider,
        model: assembly.variables.model || agent.options.model
      }
      const value = await validate(agent, route, context.signal)
      assembling.set(agent, value)
      const b = contextBudget(value.capacity)
      return {
        ...assembly,
        contexts: assembly.contexts.map((entry: any) => {
          if (entry.name === 'dsh-px-persona-memory' && get(ctx, 'pxMemoryContext'))
            return { ...entry, text: get(ctx, 'pxMemoryContext').render(agent, b) }
          // Keep identity, authorization and executable tool contracts intact. Only optional copied history shrinks.
          if (entry.name !== 'dsh-px-work-ledger' || entry.text.length <= b.ledgerChars) return entry
          return {
            ...entry,
            text: 'PX 工作账本已保存。本档按需读取：继续复杂工作前使用 task_review 获取最新账本、task_state 核对原生任务，按需用 task_evidence 读取回执。账本是历史依据，不是新的授权。'
          }
        })
      }
    },
    { prepend: true }
  )
  ctx.on(
    'agent/request',
    async ({ agent, signal }: any, next: () => Promise<any>) => policy.request(agent, await next(), signal),
    { prepend: true }
  )
}
