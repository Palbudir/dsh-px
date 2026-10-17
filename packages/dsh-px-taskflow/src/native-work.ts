/** Read native Goal/Team owners without creating a second task store or waking an agent. */
import { readFailure } from '../../shared/session-errors'
export interface NativeGoal {
  id: string
  revision: number
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  blockedReason?: { code: string; message: string }
  roundsStarted: number
  maxGoalRounds: number
  activation: 'armed' | 'disarmed' | 'unknown'
}
export interface NativeTeam {
  id: string
  role: 'lead' | 'teammate' | 'stored'
  members: Array<{ id: string; name: string; role: string; status: string }>
  tasks: Array<{
    id: string
    revision: number
    subject: string
    status: string
    ownerName?: string
    blockedBy: string[]
    ready: boolean
    writeScopeWarnings: string[]
  }>
  taskCount: number
  truncated: boolean
}
export type NativeValue<T> =
  { status: 'available'; value: T | null } | { status: 'unavailable' | 'error'; reason: string }
export interface NativeWork {
  sessionId: string
  source: 'live' | 'stored'
  goal: NativeValue<NativeGoal>
  team: NativeValue<NativeTeam>
}
interface StoredCut {
  header: { id: string; parentSession?: string }
  values: Record<string, any>
  goalFailure?: string
  ownedSubagent: boolean
}
const storedCuts = new WeakMap<
  object,
  { projections: any; goals: any; teams: any; entries: Map<string, { revision: string; cut: StoredCut }> }
>()
const unavailable = (reason: string): NativeValue<never> => ({ status: 'unavailable', reason })
const failure = (error: unknown): NativeValue<never> => ({
  status: 'error',
  reason: error instanceof Error ? error.message : String(error)
})
const service = (host: any, name: string): any =>
  typeof host.get === 'function' ? host.get(name) : host[name]

/** Bind a saved ledger to exact native owners; no invented ids, status mutations or second tasks. */
export function checkpointNativeRefs(
  host: any,
  agent: any,
  taskIds: unknown
): import('./evidence').Checkpoint['native'] {
  const ids = taskIds === undefined ? [] : taskIds
  if (
    !Array.isArray(ids) ||
    ids.length > 10 ||
    !ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)
  )
    throw Error('nativeTaskIds 必须是最多 10 个原生任务编号')
  const native: NonNullable<import('./evidence').Checkpoint['native']> = {}
  const goal = service(host, 'goals')?.get(agent)
  if (goal) native.goal = { id: goal.id, revision: goal.revision }
  if (ids.length) {
    const teams = service(host, 'agentTeams')
    if (!teams?.membership || !teams?.getTask) throw Error('原生团队服务未启用')
    const team = teams.membership(agent)
    native.team = {
      id: team.id,
      tasks: [...new Set<string>(ids)].map((id) => {
        const task = teams.getTask(agent, id)
        if (!task) throw Error(`原生团队任务不存在：${id}`)
        return { id: task.id, revision: task.revision }
      })
    }
  }
  return Object.keys(native).length ? native : undefined
}

/** Preserve the native live activation flag; stored goals must never imply continuation is armed. */
function goalValue(value: any, live: boolean): NativeGoal | null {
  if (!value) return null
  return {
    id: value.id,
    revision: value.revision,
    objective: value.objective,
    phase: value.phase,
    ...(value.blockedReason ? { blockedReason: value.blockedReason } : {}),
    roundsStarted: value.roundsStarted,
    maxGoalRounds: value.maxGoalRounds,
    activation: live && ['armed', 'disarmed'].includes(value.activation) ? value.activation : 'unknown'
  }
}
function teamValue(id: string, role: NativeTeam['role'], members: any[], tasks: any[]): NativeTeam {
  return {
    id,
    role,
    members: members.map((m) => ({ id: m.id, name: m.name, role: m.role, status: m.status ?? m.phase })),
    tasks: tasks.slice(0, 50).map((t) => ({
      id: t.id,
      revision: t.revision,
      subject: t.subject,
      status: t.status,
      ...(t.ownerName ? { ownerName: t.ownerName } : {}),
      blockedBy: t.blockedBy,
      ready: t.ready,
      writeScopeWarnings: t.writeScopeWarnings
    })),
    taskCount: tasks.length,
    truncated: tasks.length > 50
  }
}

/** Uses the pinned public projection restore contract; opens only read handles and never an Agent. */
async function readCut(host: any, id: string): Promise<StoredCut> {
  const projections = service(host, 'sessionProjections')
  if (!projections?.snapshot || !projections?.restore) throw Error('宿主未提供原生状态投影接口')
  const session = service(host, 'sessions')?.get(id)
  if (session) {
    if (session.header?.isSeeded && !Number.isSafeInteger(session.inheritedEventCount))
      throw Error('宿主未提供分叉会话的继承边界')
    return {
      header: session.header,
      values: projections.snapshot(session, ['goal', 'agentTeam']).values,
      goalFailure: projections.stateOf?.(session, 'goal')?.failure ?? undefined,
      ownedSubagent: session
        .snapshotEvents(session.inheritedEventCount ?? 0)
        .some((event: any) => event.type === 'subagent/descriptor')
    }
  }
  const persistence = service(host, 'sessionPersistence')
  if (!persistence?.open) throw Error('宿主未提供会话存储')
  const goals = service(host, 'goals'),
    teams = service(host, 'agentTeams')
  let cache = storedCuts.get(host)
  if (!cache || cache.projections !== projections || cache.goals !== goals || cache.teams !== teams) {
    cache = { projections, goals, teams, entries: new Map() }
    storedCuts.set(host, cache)
  }
  const revision = (await persistence.stat?.(id))?.revision
  const saved = cache.entries.get(id)
  if (revision && saved && saved.revision === revision) {
    cache.entries.delete(id)
    cache.entries.set(id, saved)
    return saved.cut
  }
  const handle = await persistence.open(id, 'read')
  let readFailed = false
  try {
    const { events } = await handle.read()
    if (handle.header?.isSeeded && !Number.isSafeInteger(handle.inheritedEventCount))
      throw Error('宿主未提供分叉会话的继承边界')
    const { snapshot, checkpoint } = projections.restore(
      {},
      events,
      0,
      handle.header,
      handle.inheritedEventCount ?? 0
    )
    const cut = {
      header: handle.header,
      values: { goal: snapshot.values.goal, agentTeam: snapshot.values.agentTeam },
      goalFailure: checkpoint?.goal?.val?.failure ?? undefined,
      // A provider-owned child must not become an implicit team root. The descriptor belongs
      // to this suffix only; inherited descriptors in ordinary forks do not confer membership.
      ownedSubagent: events
        .slice(handle.inheritedEventCount ?? 0)
        .some((event: any) => event.type === 'subagent/descriptor')
    }
    // Cache native projections only, never the potentially huge raw transcript. Changes in native
    // services invalidate the cache when a feature is disabled/reloaded without changing the log.
    if (revision && (await persistence.stat?.(id))?.revision === revision) {
      cache.entries.delete(id)
      cache.entries.set(id, { revision, cut })
      while (cache.entries.size > 8) cache.entries.delete(cache.entries.keys().next().value!)
    }
    return cut
  } catch (error) {
    readFailed = true
    throw error
  } finally {
    try {
      await handle.close()
    } catch (error) {
      cache.entries.delete(id)
      if (!readFailed) throw error
    }
  }
}

/** Live reads use the real Agent as credential; inactive sessions use native read-side projections. */
export async function readNativeWork(host: any, sessionId: string, suppliedAgent?: any): Promise<NativeWork> {
  const agent = suppliedAgent ?? service(host, 'agents')?.get(sessionId)
  const result: NativeWork = {
    sessionId,
    source: agent ? 'live' : 'stored',
    goal: unavailable('原生目标服务未启用'),
    team: unavailable('智能体团队未启用')
  }
  if (agent) {
    const goals = service(host, 'goals'),
      teams = service(host, 'agentTeams')
    if (goals?.get) {
      try {
        result.goal = { status: 'available', value: goalValue(goals.get(agent), true) }
      } catch (error) {
        result.goal = failure(error)
      }
    }
    if (teams?.membership && teams?.listTasks && teams?.listMembers) {
      try {
        const membership = teams.membership(agent)
        result.team = {
          status: 'available',
          value: teamValue(membership.id, membership.role, teams.listMembers(agent), teams.listTasks(agent))
        }
      } catch (error: any) {
        result.team =
          error?.code === 'TEAM_NOT_MEMBER' ? unavailable('此子智能体不属于原生团队') : failure(error)
      }
    }
    return result
  }
  const projections = service(host, 'sessionProjections')
  if (!projections) return result
  let cut: StoredCut
  try {
    cut = await readCut(host, sessionId)
  } catch (error) {
    return { ...result, goal: failure(error), team: failure(error) }
  }
  if (service(host, 'goals') && Object.hasOwn(cut.values, 'goal') && cut.values.goal !== undefined) {
    const value = cut.values.goal
    result.goal = cut.goalFailure
      ? { status: 'error', reason: cut.goalFailure }
      : {
          status: 'available',
          value: value ? goalValue({ ...value.goal, roundsStarted: value.roundsStarted }, false) : null
        }
  }
  if (service(host, 'agentTeams') && cut.values.agentTeam !== undefined) {
    try {
      let teamId = sessionId,
        team = cut.values.agentTeam
      // A parent link alone does not make an ordinary fork a teammate: the native roster must agree.
      if (cut.header.parentSession) {
        let parent: StoredCut | undefined
        try {
          parent = await readCut(host, cut.header.parentSession)
        } catch (error) {
          // Native ordinary forks remain independent roots after a parent is removed. A provider-
          // owned child must never become a new team just because its parent cannot be read.
          if (cut.ownedSubagent || readFailure(error).status !== 404) throw error
        }
        const parentTeam = parent?.values.agentTeam
        if (parentTeam?.failure) throw Error(parentTeam.failure)
        if (
          parentTeam?.members?.some(
            (m: any) => m.id === sessionId && ['active', 'provisioning'].includes(m.phase)
          )
        ) {
          teamId = cut.header.parentSession
          team = parentTeam
        }
      }
      if (teamId === sessionId && cut.ownedSubagent) {
        result.team = unavailable('此子智能体未归属于原生团队')
        return result
      }
      if (team?.failure) throw Error(team.failure)
      result.team = {
        status: 'available',
        value: team ? teamValue(teamId, 'stored', team.members, team.tasks) : null
      }
    } catch (error) {
      result.team = failure(error)
    }
  }
  return result
}
