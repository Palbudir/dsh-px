import * as z from 'zod/mini'
import type { ContextTier } from '../../shared/context-policy'

const route = { provider: z.string(), model: z.string(), reasoningEffort: z.optional(z.string()) }
const binding = z.object({
  version: z.literal(1),
  tier: z.enum(['minimum', 'brief', 'full']),
  ...route,
  capacity: z.optional(z.int().check(z.minimum(1)))
})
const continuation = z.object({ sourceSessionId: z.string(), ...route })
export interface ContextBinding {
  version: 1
  tier: ContextTier
  provider: string
  model: string
  capacity?: number
}

/** Authoritative plugin metadata belongs in the native storage domain, not an unrecognized session-log event. */
export function contextState(ctx: any) {
  let opened: Promise<any> | undefined
  const domain = (): Promise<any> => {
    if (!opened) {
      const facility = ctx.get?.('storageDomain') ?? ctx.storageDomain
      if (!facility) throw Error('原生上下文档位存储尚未就绪')
      opened = facility.open({
        name: 'px_context_policy',
        version: 1,
        layout: 'per-record',
        tables: { bindings: { valueSchema: binding }, continuations: { valueSchema: continuation } }
      })
    }
    return opened!
  }
  ctx.effect?.(
    () => () =>
      opened?.then(
        (d) => d.close(),
        () => {}
      ),
    'workbench: native context policy storage'
  )
  return {
    async get(id: string): Promise<ContextBinding | undefined> {
      return (await domain()).table('bindings').get(id)
    },
    async bind(id: string, value: ContextBinding): Promise<void> {
      await (await domain()).table('bindings').put(id, binding.parse(value))
    },
    async continuation(id: string): Promise<any> {
      return (await domain()).table('continuations').get(id)
    },
    async rememberContinuation(id: string, value: any): Promise<void> {
      await (await domain()).table('continuations').put(id, continuation.parse(value))
    }
  }
}
