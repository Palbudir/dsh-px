import { rejectUntrustedRequest } from '../../shared/request-trust'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { artifacts, messages, type RecordEvent } from './model'
import { identifier, InputError, Scheduler, WorkspaceStore } from './store'
import { readFailure } from '../../shared/session-errors'

export const name = 'dsh-px-workspace'
export const inject: string[] = []
export const DEFAULTS = { routePrefix: '/dsh-px-workspace' }
interface Session {
  header: { id: string; cwd?: string; origin?: string }
  snapshotEvents: () => readonly RecordEvent[]
}
interface Host {
  sessions: { get: (id: string) => Session | undefined }
  sessionController: {
    inspect: (id: string) => Promise<{ meta: Session['header']; events: readonly RecordEvent[] }>
    prompt: (
      request: {
        requestId: string
        sessionId: string
        mode: 'queue'
        content: Array<{ type: 'text'; text: string }>
        clientTimeZone: string
      },
      signal: AbortSignal
    ) => Promise<{ accepted: true }>
  }
  webServer: {
    register: (route: {
      kind: 'exact'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }) => () => void
  }
  effect: (fn: () => () => void, label?: string) => void
  logger?: { warn: (...args: unknown[]) => void }
}
async function body(req: IncomingMessage): Promise<any> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json'))
    throw new InputError('请使用 JSON 请求', 415)
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > 64000) throw new InputError('请求内容过大', 413)
    chunks.push(Buffer.from(chunk))
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    return data
  } catch {
    throw new InputError('JSON 内容无效')
  }
}
function numberParam(params: URLSearchParams, key: string, fallback: number): number {
  if (!params.has(key)) return fallback
  const v = params.get(key)!
  if (!/^\d{1,15}$/.test(v) || params.getAll(key).length !== 1) throw new InputError('分页参数无效')
  return Number(v)
}
export function apply(ctx: { inject: (services: string[], cb: (host: Host) => void) => unknown }): void {
  ctx.inject(['webServer', 'sessions', 'sessionController'], (host) => {
    const lifetime = new AbortController()
    let store: WorkspaceStore | undefined,
      scheduler: Scheduler | undefined,
      loadError = ''
    const inspect = async (
      id: string
    ): Promise<{ meta: Session['header']; events: readonly RecordEvent[] }> => {
      const live = host.sessions.get(identifier(id))
      return live
        ? { meta: live.header, events: live.snapshotEvents() }
        : await host.sessionController.inspect(id)
    }
    const target = async (id: string): Promise<void> => {
      const { meta } = await inspect(id)
      if (meta.origin === 'subagent') throw new InputError('定时任务请选择普通会话；子 Agent 由其父任务管理')
    }
    try {
      if (!process.env.DSH_HOME) throw new Error('DSH_HOME 未设置')
      store = new WorkspaceStore(join(process.env.DSH_HOME, 'storages', name, 'workspace.json'))
      scheduler = new Scheduler(store, async (schedule, requestId) => {
        await target(schedule.sessionId)
        const result = await host.sessionController.prompt(
          {
            requestId,
            sessionId: schedule.sessionId,
            mode: 'queue',
            clientTimeZone: schedule.timeZone,
            content: [
              {
                type: 'text',
                text: `定时任务「${schedule.title}」\n这是用户保存的定时任务，请按当前会话的权限执行：\n\n${schedule.prompt}`
              }
            ]
          },
          lifetime.signal
        )
        if (result?.accepted !== true) throw new Error('会话未确认接收')
      })
    } catch (error) {
      loadError = String(error)
      host.logger?.warn(name, loadError)
    }
    host.effect(() => {
      const timer = setInterval(() => {
        void scheduler?.tick().catch((error) => host.logger?.warn('定时任务检查失败', String(error)))
      }, 2000)
      timer.unref()
      return () => {
        clearInterval(timer)
        scheduler?.stop()
        lifetime.abort()
      }
    }, 'workspace: scheduler')
    for (const route of ['content', 'message', 'annotations', 'schedules'] as const)
      host.effect(
        () =>
          host.webServer.register({
            kind: 'exact',
            path: `/${name}/${route}`,
            handler: async (req, res) => {
              if (rejectUntrustedRequest(req, res)) return
              const send = (status: number, data: unknown): void => {
                res.writeHead(status, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Cache-Control': 'no-store'
                })
                res.end(JSON.stringify(data))
              }
              try {
                if (!store || !scheduler) throw new InputError(loadError || '会话工作区未初始化', 503)
                if (req.method !== 'GET' && req.method !== 'POST')
                  throw new InputError('不支持此请求方法', 405)
                const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
                if (req.method === 'POST') {
                  if (req.headers['x-dsh-px-request'] !== '1') throw new InputError('请求校验失败', 403)
                  if (route !== 'annotations' && route !== 'schedules')
                    throw new InputError('此接口只读', 405)
                  const input = await body(req)
                  if (route === 'annotations') {
                    if (input.action === 'delete') {
                      store.deleteAnnotation(input)
                      return send(200, { ok: true })
                    }
                    if (input.action !== 'save') throw new InputError('操作无效')
                    const { events } = await inspect(identifier(input.sessionId))
                    const source = messages(events).find((m) => m.id === input.messageId)
                    if (!source) throw new InputError('引用的消息不存在或没有可引用的正文', 404)
                    return send(200, store.saveAnnotation(input, source))
                  }
                  if (input.action === 'save') {
                    await target(identifier(input.sessionId))
                    return send(200, scheduler.save(input))
                  }
                  if (input.action === 'delete') {
                    scheduler.remove(input)
                    return send(200, { ok: true })
                  }
                  if (input.action === 'run') return send(200, await scheduler.run(identifier(input.id)))
                  throw new InputError('操作无效')
                }
                if (route === 'schedules')
                  return send(200, { schedules: store.schedules(), timeZone: scheduler.zone })
                const id = identifier(params.get('sessionId'))
                if (route === 'annotations')
                  return send(200, store.annotations(id, params.get('before') ?? undefined))
                const { events } = await inspect(id)
                const all = messages(events)
                if (route === 'message') {
                  const m = all.find((m) => m.id === params.get('messageId'))
                  if (!m) throw new InputError('消息不存在或没有可引用正文', 404)
                  const offset = numberParam(params, 'offset', 0),
                    length = m.text.length
                  if (offset > length) throw new InputError('正文偏移超过长度')
                  return send(200, {
                    ...m,
                    text: m.text.slice(offset, offset + 32000),
                    length,
                    offset,
                    nextOffset: offset + 32000 < length ? offset + 32000 : null
                  })
                }
                const before = numberParam(params, 'before', Number.MAX_SAFE_INTEGER)
                const page = all.filter((m) => m.seq < before).slice(-20)
                send(200, {
                  messages: page.map((m) => ({ ...m, text: m.text.slice(0, 240) })).reverse(),
                  nextBefore: all.some((m) => m.seq < (page[0]?.seq ?? 0)) ? page[0].seq : null,
                  artifacts: artifacts(events)
                })
              } catch (error: any) {
                if (error instanceof InputError)
                  send(error.status, { error: error.message, retryable: false })
                else {
                  host.logger?.warn(`${name}/${route}`, String(error))
                  const failure = readFailure(error)
                  send(failure.status, failure)
                }
              }
            }
          }),
        `workspace: ${route}`
      )
  })
}
