import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { rejectUnauthenticatedRequest as rejectUntrustedRequest } from '../../shared/request-trust'
import { readJsonBody } from './http'
import { readServiceState } from './status'
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
  jobs: { list: (owner?: Agent) => { id: string; status: string }[] }
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
      for (const job of services.jobs.list(agent)) jobs.set(job.id, job)
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

export function registerActivity(ctx: any): () => Activity {
  let services: Services | undefined
  let shutdownRequested = false
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
    host.effect?.(() => {
      const dispose = [
        host.webServer.register({
          kind: 'exact',
          path: '/dsh-px-workbench/activity',
          handler: (req: IncomingMessage, res: ServerResponse) => {
            if (rejectUntrustedRequest(req, res, host.connection)) return
            if (req.method !== 'GET') return json(res, 405, { error: '请使用 GET' })
            json(res, 200, { ...read(), instanceId: process.env.DSH_PX_INSTANCE_ID ?? null })
          }
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/dsh-px-workbench/shutdown',
          handler: async (req: IncomingMessage, res: ServerResponse) => {
            if (rejectUntrustedRequest(req, res, host.connection)) return
            if (req.method !== 'POST') return json(res, 405, { error: '请使用 POST' })
            if (req.headers['x-dsh-px-request'] !== '1')
              return json(res, 403, { error: '请从本机应用提交请求' })
            try {
              const request = await readJsonBody(req, 4096)
              if (
                typeof request.requestId !== 'string' ||
                !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(request.requestId)
              )
                return json(res, 400, { error: '停机请求编号无效' })
              const state = readServiceState()
              if (
                !state?.instanceId ||
                request.instanceId !== state.instanceId ||
                request.instanceId !== process.env.DSH_PX_INSTANCE_ID
              )
                return json(res, 409, { error: '桌面实例已变更或断开，请重新连接。' })
              if (request.mode !== 'idle' && request.mode !== 'cancel')
                return json(res, 400, { error: '停机方式无效' })
              if (shutdownRequested) return json(res, 409, { error: '服务已在停止，请等待结果。' })
              const activity = read()
              if (!activity.known) return json(res, 503, { error: '无法确认原生任务状态，服务未停止。' })
              if (request.mode === 'idle' && !isIdle(activity))
                return json(res, 409, { error: '仍有任务、排队输入或未关闭的终端，服务未停止。', activity })
              const root = host.root
              if (typeof root?.fiber?.dispose !== 'function')
                return json(res, 503, { error: '当前核心不支持正常停机，服务未停止。' })
              const dir = process.env.DSH_PX_USER_DATA!
              const path = join(dir, 'shutdown-ack.json')
              const ack = {
                instanceId: request.instanceId,
                requestId: request.requestId,
                mode: request.mode,
                acceptedAt: new Date().toISOString()
              }
              const save = (extra: object = {}): void => {
                mkdirSync(dir, { recursive: true })
                writeFileSync(path + '.tmp', JSON.stringify({ ...ack, ...extra }))
                renameSync(path + '.tmp', path)
              }
              const saveOutcome = (extra: object): void => {
                try {
                  save(extra)
                } catch {
                  process.stderr.write('[dsh-px] 无法保存原生停机结果；请结合进程状态检查。\n')
                }
              }
              save()
              shutdownRequested = true
              json(res, 202, { ...ack, activity })
              // This timer must survive disposal of the route's own plugin scope.
              setTimeout(() => {
                if (request.mode === 'idle' && !isIdle(read())) {
                  shutdownRequested = false
                  saveOutcome({ errorCode: 'NEW_ACTIVITY', error: '停机前出现新任务，已保留运行中的服务。' })
                  return
                }
                void Promise.resolve()
                  .then(() => root.fiber.dispose())
                  .then(
                    () => saveOutcome({ disposedAt: new Date().toISOString() }),
                    () => {
                      shutdownRequested = false
                      saveOutcome({ errorCode: 'DISPOSE_FAILED', error: '原生停机未完成，请查看服务日志。' })
                    }
                  )
              }, 0)
            } catch (err) {
              json(res, 400, { error: err instanceof Error ? err.message : '无法读取停机请求' })
            }
          }
        })
      ]
      return () => dispose.forEach((fn) => fn())
    }, 'workbench: activity and shutdown routes')
  })
  return read
}
