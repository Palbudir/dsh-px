export interface NativeTaskReason {
  kind: 'running-agent' | 'queued-input' | 'background-job'
  sessionId?: string
  sessionTitle?: string
  jobId?: string
  count?: number
  status?: string
}
export interface NativeTaskInspection {
  active: boolean
  configurationNotices: number
  total: number
  items: NativeTaskReason[]
}

/** Native approval-policy notifications do not start work; actual waiting approvals have a running agent. */
export function inspectNativeTasks(
  agents: readonly any[],
  jobs: { list(id?: string): readonly any[] }
): NativeTaskInspection {
  const items: NativeTaskReason[] = []
  let configurationNotices = 0
  const titles = new Map<string, string>()
  for (const agent of agents) {
    const sessionId = String(agent.id ?? agent.session?.id ?? '')
    let sessionTitle: string | undefined
    try {
      const value = agent.ctx?.get?.('sessionProjections')?.stateOf?.(agent.session, 'title')?.title
      if (typeof value === 'string' && value.trim()) sessionTitle = value.slice(0, 80)
    } catch {}
    if (sessionTitle) titles.set(sessionId, sessionTitle)
    if (agent.status === 'running') items.push({ kind: 'running-agent', sessionId, sessionTitle })
    let queued = 0
    for (const [target, messages] of [
      ['next-turn', agent.inbox.nextTurn],
      ['next-step', agent.inbox.nextStep]
    ] as const) {
      for (const message of messages) {
        if (target === 'next-step' && message.source?.kind === 'user-approval') configurationNotices++
        else queued++
      }
    }
    if (queued) items.push({ kind: 'queued-input', sessionId, sessionTitle, count: queued })
  }
  const seen = new Set<string>()
  for (const owner of [undefined, ...agents]) {
    for (const job of jobs.list(owner?.id)) {
      if (job.status !== 'running' && job.status !== 'stopping') continue
      const jobId = typeof job.id === 'string' ? job.id : undefined
      if (jobId && seen.has(jobId)) continue
      if (jobId) seen.add(jobId)
      const sessionId = typeof job.owner === 'string' ? job.owner : owner?.id
      items.push({
        kind: 'background-job',
        jobId,
        sessionId,
        sessionTitle: titles.get(sessionId),
        status: job.status
      })
    }
  }
  return { active: items.length > 0, configurationNotices, total: items.length, items: items.slice(0, 20) }
}

export function describeNativeTasks(report: NativeTaskInspection | undefined, chinese: boolean): string {
  if (!report || !Array.isArray(report.items)) return ''
  const lines = report.items.slice(0, 20).map((item) => {
    const owner = item.sessionTitle
      ? `${item.sessionTitle} (${item.sessionId?.slice(-8) ?? ''})`
      : item.sessionId
        ? item.sessionId.slice(0, 80)
        : chinese
          ? '全局'
          : 'Global'
    if (item.kind === 'running-agent')
      return chinese ? `• ${owner}：正在运行或等待确认` : `• ${owner}: running or awaiting approval`
    if (item.kind === 'queued-input')
      return chinese ? `• ${owner}：${item.count} 条待处理输入` : `• ${owner}: ${item.count} queued inputs`
    return chinese
      ? `• ${owner}：后台任务 ${item.jobId ?? ''}（${item.status}）`
      : `• ${owner}: background job ${item.jobId ?? ''} (${item.status})`
  })
  if (report.total > lines.length)
    lines.push(chinese ? `另有 ${report.total - lines.length} 项` : `${report.total - lines.length} more`)
  return lines.join('\n')
}
