/** A responsive observation over native work. Never consumes job output, wakes peers or cancels work. */
export const EXECUTION_POLICY = `For substantive tasks, deliver a useful draft or a verified intermediate artifact as soon as it is ready. Report material findings and blockers; do not replace results with repeated status text. Batch independent concurrency-safe reads, and use bounded native PTC programs for deterministic short sequences. Start long commands as native background Jobs and retain their ids; do other ready work while they run. When the user explicitly requests a workflow or large multi-agent orchestration and the native workflow tool is available, prefer run_in_background: true for long workflows; retain its Job id and inspect native progress/output instead of launching a duplicate. Use Team only when permitted. Coordinate native task dependencies, revisions and disjoint write scopes; a ready task does not itself wake its inactive owner. Wake required inactive owners through the native Team tools before waiting. When genuinely blocked on owned Jobs or active teammates, prefer task_wait over long blocking job_output/wait_agent calls: new steering can end this observation. After wake, reconcile current user corrections and task revisions before consuming results with job_output or the native Team tools. Do not restart a job because a wait returned, treat an accepted message as completion, or give a final completion claim before required work and checks settle.`

export interface WaitAgent {
  id: string
  inbox?: { nextStep?: Array<{ id?: string }> }
}
interface WaitHost {
  on: (event: string, handler: (payload: any) => void) => () => void
  get?: (name: string) => any
  jobs?: any
  agentTeams?: any
}
export type WorkWakeReason = 'message' | 'job-change' | 'team-change' | 'timeout' | 'no-progress'
export interface WorkWake {
  reason: WorkWakeReason
  elapsedMs: number
  jobIds: string[]
  note: string
}
const active = (job: any) => job.status === 'running' || job.status === 'stopping'
const service = (host: WaitHost, name: 'jobs' | 'agentTeams') => host.get?.(name) ?? host[name]

export async function waitForNativeWork(
  host: WaitHost,
  agent: WaitAgent,
  signal: AbortSignal,
  timeoutMs = 30_000
): Promise<WorkWake> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000)
    throw Error('等待时长须为 1000～60000 毫秒')
  signal.throwIfAborted()
  const started = Date.now(),
    jobs = service(host, 'jobs'),
    teams = service(host, 'agentTeams'),
    local = new AbortController()
  let resolveWake!: (reason: WorkWakeReason) => void, rejectWake!: (reason: unknown) => void
  const wake = new Promise<WorkWakeReason>((resolve, reject) => {
    resolveWake = resolve
    rejectWake = reject
  })
  let settled = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    teamWait: Promise<unknown> | undefined
  const cleanup: Array<() => void> = []
  const finish = (reason: WorkWakeReason) => {
    if (settled) return
    settled = true
    resolveWake(reason)
  }
  const abort = () => {
    if (settled) return
    settled = true
    rejectWake(signal.reason)
  }
  const jobIds = new Set<string>()
  try {
    signal.addEventListener('abort', abort, { once: true })
    cleanup.push(() => signal.removeEventListener('abort', abort))
    // Subscribe before checking pending input, closing the observation/registration gap.
    cleanup.push(
      host.on('agent/inbox/inserted', ({ agent: target, message }) => {
        if (target === agent && agent.inbox?.nextStep?.some((item) => item.id === message.id))
          finish('message')
      })
    )
    if (jobs?.events?.subscribe && jobs.list) {
      cleanup.push(
        jobs.events.subscribe({ owner: agent.id }, (event: any) => {
          if (jobIds.has(event.job.id) && ['settled', 'removed', 'stopping'].includes(event.type))
            finish('job-change')
        })
      )
      for (const job of jobs.list(agent.id)) if (active(job)) jobIds.add(job.id)
    }
    let peerActive = false
    if (teams?.listMembers && teams.waitForChange) {
      try {
        peerActive = teams
          .listMembers(agent)
          .some(
            (member: any) => member.id !== agent.id && ['running', 'provisioning'].includes(member.status)
          )
      } catch (error: any) {
        if (error?.code !== 'TEAM_NOT_MEMBER') throw error
      }
      if (peerActive) {
        // The native waiter observes team/task changes; abort below releases only this subscription.
        teamWait = Promise.resolve(teams.waitForChange(agent, Math.max(10_000, timeoutMs), local.signal))
          .then((result: any) => {
            if (!result?.timedOut) finish('team-change')
          })
          .catch((error: unknown) => {
            if (!local.signal.aborted && !settled) {
              settled = true
              rejectWake(error)
            }
          })
      }
    }
    if (agent.inbox?.nextStep?.length) finish('message')
    else if (!jobIds.size && !peerActive) finish('no-progress')
    timer = setTimeout(() => finish('timeout'), timeoutMs)
    if (signal.aborted) abort()
    const reason = await wake
    signal.throwIfAborted()
    return {
      reason,
      elapsedMs: Math.max(0, Date.now() - started),
      jobIds: [...jobIds],
      note:
        reason === 'no-progress'
          ? '没有观察到可等待的原生后台作业或活动成员。检查任务依赖与负责人；等待不会启动工作。'
          : '等待已返回。先处理新指令，再核对原生任务状态；作业输出仍通过 job_output 读取。不要重复启动已有工作。'
    }
  } finally {
    if (timer) clearTimeout(timer)
    for (const dispose of cleanup.reverse()) dispose()
    local.abort(new Error('PX work observation ended'))
    await teamWait
  }
}
