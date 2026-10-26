/** Mnemon and AgentInstructions append native messages after prompt assembly, outside contexts[].
 * Refresh after assembly: the pinned Mnemon installs a later prepend hook at agent/created.
 * A setup-time filter alone would run inside that hook and miss the appended snapshots.
 */
export function publicInputBoundary(ctx: any): (agentCtx?: any) => void {
  const active = new Map<any, () => void>()
  const release = (scope: any) => {
    active.get(scope)?.()
    active.delete(scope)
  }
  ctx.on('agent/disposed', ({ agent }: any) => release(agent.ctx))
  ctx.effect(
    () => () => {
      for (const scope of active.keys()) release(scope)
    },
    'qq: public input boundary'
  )
  return (scope = ctx) => {
    release(scope)
    active.set(
      scope,
      scope.on(
        'agent/pre-step',
        async (_payload: any, next: () => Promise<any>) => {
          const decision = await next()
          if (!Array.isArray(decision.messages)) return decision
          return {
            ...decision,
            messages: decision.messages.filter(
              (message: any) =>
                !['dsh-mnemon', 'plugin:dsh-mnemon', 'agent-instructions'].includes(message.source?.kind)
            )
          }
        },
        { prepend: true }
      )
    )
  }
}
