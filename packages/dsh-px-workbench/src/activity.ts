import type { IncomingMessage, ServerResponse } from 'node:http'
import { rejectUnauthenticatedRequest as rejectUntrustedRequest } from '../../shared/request-trust'
import { registerTerminalActivity, type TerminalOwner } from './terminal-activity'

export interface Activity {
  known: boolean
  runningAgents: number
  queuedInputs: number
  runningJobs: number
  openTerminals: number
}
interface Agent extends TerminalOwner {
  id: string
  status: 'idle' | 'running'
  inbox: { nextTurn: readonly unknown[]; nextStep: readonly unknown[] }
}
interface Services {
  agents: { list: () => Agent[] }
  jobs: { list: (sessionId?: string) => { id: string; status: string }[] }
  terminalActivity: (owners: readonly Agent[]) => { known: boolean; openTerminals: number }
}
export function activitySnapshot(services?: Services): Activity {
  const result = { known: false, runningAgents: 0, queuedInputs: 0, runningJobs: 0, openTerminals: 0 }
  if (!services) return result
  try {
    const agents = services.agents.list()
    const jobs = new Map(services.jobs.list().map((job) => [job.id, job]))
    for (const agent of agents) {
      if (
        !['running', 'idle'].includes(agent.status) ||
        !Array.isArray(agent.inbox.nextTurn) ||
        !Array.isArray(agent.inbox.nextStep)
      )
        return result
      result.runningAgents += Number(agent.status === 'running')
      result.queuedInputs += agent.inbox.nextTurn.length + agent.inbox.nextStep.length
      // Native JobRegistry.list is fenced by SessionId, not by the Agent object.
      for (const job of services.jobs.list(agent.id)) jobs.set(job.id, job)
    }
    result.runningJobs = [...jobs.values()].filter(
      (job) => job.status === 'running' || job.status === 'stopping'
    ).length
    const terminals = services.terminalActivity(agents)
    result.openTerminals = terminals.openTerminals
    result.known =
      terminals.known === true &&
      [result.runningAgents, result.queuedInputs, result.runningJobs, result.openTerminals].every(
        (value) => Number.isSafeInteger(value) && value >= 0
      )
  } catch {
    /* Incomplete native services are unknown, never idle. */
  }
  return result
}
export const isIdle = (activity: Activity): boolean =>
  activity.known === true &&
  [activity.runningAgents, activity.queuedInputs, activity.runningJobs, activity.openTerminals].every(
    (value) => Number.isSafeInteger(value) && value === 0
  )

/**
 * Read-only activity snapshot. Stopping, restarting and updating belong to the native host that owns
 * the service; this Pack exposes no shutdown or restart action in the official-derived generation.
 */
export function registerActivity(ctx: any): () => Activity {
  let services: Services | undefined
  const terminalActivity = registerTerminalActivity(ctx)
  ctx.inject(['agents', 'jobs'], (host: any) => {
    const current = { agents: host.agents, jobs: host.jobs, terminalActivity }
    services = current
    host.effect?.(
      () => () => {
        if (services === current) services = undefined
      },
      'workbench: activity sources'
    )
  })
  const read = (): Activity => activitySnapshot(services)
  ctx.inject(['connection', 'webServer'], (host: any) => {
    if (!host.webServer) return
    const json = (res: ServerResponse, code: number, value: unknown): void => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    host.effect?.(
      () =>
        host.webServer.register({
          kind: 'exact',
          path: '/dsh-px-workbench/activity',
          handler: (req: IncomingMessage, res: ServerResponse) => {
            if (rejectUntrustedRequest(req, res, host.connection)) return
            if (req.method !== 'GET') return json(res, 405, { error: '请使用 GET' })
            json(res, 200, read())
          }
        }),
      'workbench: activity route'
    )
  })
  return read
}
