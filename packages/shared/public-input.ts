/** Mnemon and AgentInstructions append native messages after prompt assembly, outside contexts[].
 * Refresh after assembly: the pinned Mnemon installs a later prepend hook at agent/created.
 * A setup-time filter alone would run inside that hook and miss the appended snapshots.
 */
export function publicInputBoundary(
  ctx: any,
  authority?: (agent: any, messages: any[]) => string | undefined,
  channel = {
    sourceKind: 'plugin:dsh-onebot',
    noticeKind: 'px-qq-authority',
    label: 'qq: public input boundary'
  }
): (agentCtx?: any, agent?: any) => void {
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
    channel.label
  )
  return (scope = ctx, agent?: any) => {
    release(scope)
    active.set(
      scope,
      scope.on(
        'agent/pre-step',
        async (_payload: any, next: () => Promise<any>) => {
          const decision = await next()
          if (!Array.isArray(decision.messages)) return decision
          const messages = decision.messages.filter(
            (message: any) =>
              !['dsh-mnemon', 'plugin:dsh-mnemon', 'agent-instructions'].includes(message.source?.kind)
          )
          // The native inbox is claimed before prompt assembly, but persisted after pre-step.
          // Describe that actual pending batch; execution still revalidates committed provenance.
          const notice = agent && authority?.(agent, messages)
          if (notice && messages.some((message: any) => message.source?.kind === channel.sourceKind))
            messages.push({
              id: randomUUID(),
              role: 'user',
              source: { kind: channel.noticeKind },
              content: [{ type: 'text', text: notice }]
            })
          return {
            ...decision,
            messages
          }
        },
        { prepend: true }
      )
    )
  }
}
import { randomUUID } from 'node:crypto'
