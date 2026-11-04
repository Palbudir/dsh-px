const get = (ctx: any, key: string) => (ctx.get ? ctx.get(key) : ctx[key])
function stopAgent(agent: any) {
  try {
    const goals = get(agent.ctx, 'goals'),
      goal = goals?.get(agent)
    if (goal?.phase === 'active') goals.pause(agent, { id: goal.id, revision: goal.revision })
  } finally {
    agent.cancel({ kind: 'user' })
  }
}
/** Cancel native actors and drain selected children; unrelated owners and future delegation survive. */
export async function stopNativeTaskActors(
  host: any,
  agents: any[],
  stopping: Map<string, number>
): Promise<void> {
  // A native Team Lead can be idle while its members are working. Cancel every owned
  // task actor before awaiting quiescence; cancelling the Lead alone does not stop Teams.
  const byId = new Map(agents.map((agent) => [agent.session.id, agent])),
    canceledWakes = new Set<string>()
  for (const id of byId.keys()) stopping.set(id, (stopping.get(id) ?? 0) + 1)
  // Native teardown still delivers a settlement notice. Cancel only notices from the exact
  // actors being stopped, through the native inbox; its durable splice preserves the receipt.
  const unlisten = host.on?.('agent/inbox/inserted', ({ agent, message }: any) => {
    const target = byId.get(agent.id)
    if (
      target &&
      get(host, 'agents')?.get(agent.id) === target &&
      message.source?.kind === 'subagent-settled' &&
      byId.has(message.source.senderSessionId)
    )
      if (target.inbox.remove(message.id)) canceledWakes.add(agent.id)
  })
  // Native followup still wakes an idle Agent after a listener removes its message.
  // Reject only that empty wake; an independent new user input is never consumed here.
  const unguard = host.on?.(
    'agent/pre-step',
    async ({ agent, messages }: any, next: any) => {
      const target = byId.get(agent.id)
      if (
        target &&
        get(host, 'agents')?.get(agent.id) === target &&
        canceledWakes.delete(agent.id) &&
        !messages.length
      ) {
        target.cancel({ kind: 'user' })
        return { kind: 'reject' }
      }
      return next()
    },
    { prepend: true }
  )
  try {
    const jobWaits: Promise<any>[] = [],
      stopErrors: unknown[] = []
    for (const agent of agents) {
      try {
        stopAgent(agent)
      } catch (error) {
        stopErrors.push(error)
      }
      try {
        const jobs = get(agent.ctx, 'jobs')
        for (const job of jobs?.list(agent.session.id) ?? []) {
          if (job.owner !== agent.session.id || !['running', 'stopping'].includes(job.status)) continue
          try {
            jobs.kill(job.id, agent.session.id, '渠道任务已停止')
            jobWaits.push(
              Promise.resolve(jobs.wait(job.id, 30000, agent.session.id)).then((state) => {
                if (['running', 'stopping'].includes(state.status))
                  throw Error('后台作业尚未确认停止：' + job.id)
              })
            )
          } catch (error) {
            stopErrors.push(error)
          }
        }
      } catch (error) {
        stopErrors.push(error)
      }
    }
    // Selected-child teardown preserves future delegation by the same live parent.
    const parents = new Map<any, string[]>(),
      registry = get(host, 'agents')
    for (const agent of agents) {
      // Fresh native children need not have fork lineage; runtime ownership is authoritative.
      const parent = agents.find((candidate) => registry?.isOwnedBy?.(agent.session.id, candidate) === true)
      if (!parent) continue
      const ids = parents.get(parent) ?? []
      ids.push(agent.session.id)
      parents.set(parent, ids)
    }
    const subagents = get(host, 'subagents'),
      draining: Promise<unknown>[] = []
    if (subagents?.drainChildren) {
      for (const [parent, ids] of parents) draining.push(subagents.drainChildren(parent, ids))
    }
    const settled = await Promise.allSettled([...draining, ...jobWaits])
    // Native settlement may have opened an empty parent turn while children were draining.
    // Sample whenIdle after those receipts, keeping the step fence until that wake has settled.
    const idle = await Promise.allSettled(agents.map((agent) => agent.whenIdle()))
    const failed = [...settled, ...idle].find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    if (stopErrors.length) throw new AggregateError(stopErrors, '部分任务停止状态尚未确认')
  } finally {
    unguard?.()
    unlisten?.()
    for (const id of byId.keys()) {
      const remaining = (stopping.get(id) ?? 1) - 1
      if (remaining) stopping.set(id, remaining)
      else stopping.delete(id)
    }
  }
}
