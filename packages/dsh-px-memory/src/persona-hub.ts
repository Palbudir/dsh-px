import { MemoryError, isInternalSession, validId, projectKey, type MemoryStore } from './store'
import { service } from './history'
import { continuationRequests } from './continuation'
import { rejectUnauthenticatedRequest } from '../../shared/request-trust'
import { resourceToolCatalog } from './persona-resources'
import type { PersonaNavigation } from './persona-navigation'

export interface PersonaHubView {
  nativeNavigation: boolean
  revision: number
  selectedPersonaId: string
  personas: Array<{ id: string; name: string; revision: number; archived: boolean; sessionCount: number }>
  workspaces: Array<{ id: string; title: string; path: string }>
  sessions: Array<{
    id: string
    cwd: string | null
    updatedAt: number
    running: boolean
    live: boolean
    personaRevision: number | null
    channel: string | null
  }>
  total: number
  nextOffset: number | null
}

/** Human-facing catalog. Reads native summaries; never resumes or rebinds an existing session. */
export async function personaHubView(
  host: any,
  store: MemoryStore,
  personaId?: string,
  offset = 0,
  currentSessionId?: string
): Promise<PersonaHubView> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 20000) throw new MemoryError('分页位置无效')
  const state = store.read(),
    current =
      currentSessionId && !isInternalSession(currentSessionId) ? state.bindings[currentSessionId] : undefined,
    selected =
      personaId ?? (current?.purpose || current?.pending ? undefined : current?.personaId) ?? 'default'
  if (!state.personas.some((p) => p.id === selected)) throw new MemoryError('人格不存在', 404)
  const controller = service(host, 'sessionController')
  if (!controller?.list) throw new MemoryError('原生会话目录不可用', 503)
  const native = await controller.list({})
  if (!Array.isArray(native?.items)) throw new MemoryError('原生会话目录未返回有效结果', 503)
  const rows = native.items.filter((row: any) => {
    const binding = state.bindings[row.sessionId]
    return (
      !isInternalSession(row.sessionId) && !binding?.purpose && !binding?.pending && row.origin !== 'subagent'
    )
  })
  const selectedRows = rows.filter(
    (row: any) => (state.bindings[row.sessionId]?.personaId ?? 'default') === selected
  )
  const workspaceRegistry = service(host, 'workspaceRegistry')
  return {
    nativeNavigation: controller.pxPersonaCreationVersion === 1,
    revision: state.revision,
    selectedPersonaId: selected,
    personas: state.personas.map((p) => ({
      id: p.id,
      name: p.name,
      revision: p.revision,
      archived: p.archived === true,
      sessionCount: rows.filter(
        (row: any) => (state.bindings[row.sessionId]?.personaId ?? 'default') === p.id
      ).length
    })),
    sessions: selectedRows.slice(offset, offset + 50).map((row: any) => ({
      id: row.sessionId,
      cwd: row.cwd ?? null,
      updatedAt: row.updatedAt,
      running: row.running === true,
      live: row.agentAvailable === true,
      personaRevision: state.bindings[row.sessionId]?.personaRevision ?? null,
      channel: state.bindings[row.sessionId]?.channel?.provider ?? null
    })),
    total: selectedRows.length,
    nextOffset: offset + 50 < selectedRows.length ? offset + 50 : null,
    workspaces: (workspaceRegistry?.list?.() ?? []).map((w: any) => ({
      id: w.id,
      title: w.title ?? w.path,
      path: w.path
    }))
  }
}

/** A new ordinary session gets identity before native creation. Retrying the same request is safe. */
export async function createHubSession(host: any, store: MemoryStore, args: any): Promise<string> {
  if (
    typeof args.requestId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(args.requestId)
  )
    throw new MemoryError('新会话请求标识无效')
  const personaId = validId(args.personaId),
    workspaceId = validId(args.workspaceId)
  const state = store.read(),
    persona = state.personas.find((p) => p.id === personaId && !p.archived)
  if (!persona) throw new MemoryError('人格不存在或已归档')
  const workspace = service(host, 'workspaceRegistry')
    ?.list?.()
    .find((w: any) => w.id === workspaceId)
  if (!workspace) throw new MemoryError('请先添加或选择有效工作区')
  const id = 'session-' + args.requestId,
    existing = state.bindings[id]
  if (
    existing &&
    (existing.personaId !== personaId ||
      existing.creationWorkspaceId !== workspaceId ||
      existing.createdFrom ||
      existing.handoff ||
      existing.channel)
  )
    throw new MemoryError('此请求已经用于另一项会话创建', 409)
  const controller = service(host, 'sessionController')
  if (!controller?.create) throw new MemoryError('原生会话创建服务不可用', 503)
  if (existing && !existing.pending) {
    const current = await controller.inspect(id)
    if (projectKey(current.meta.cwd) !== projectKey(workspace.path))
      throw new MemoryError('原生会话的工作区已经改变，请重新创建', 409)
    return id
  }
  store.bind(id, { personaId, pending: true, creationWorkspaceId: workspaceId })
  await controller.create({ sessionId: id, workspaceId })
  store.bind(id, { personaId })
  return id
}

export function registerPersonaHub(ctx: any, store: MemoryStore, navigation?: PersonaNavigation): () => void {
  const once = continuationRequests()
  const injection = ctx.inject(['connection', 'webServer', 'sessionController'], (host: any) =>
    host.webServer.register({
      kind: 'exact',
      path: '/dsh-px-personas',
      handler: async (req: any, res: any) => {
        if (rejectUnauthenticatedRequest(req, res, host.connection)) return
        const send = (status: number, value: any) => {
          res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
          })
          res.end(JSON.stringify(value))
        }
        try {
          if (req.method === 'GET') {
            const query = new URL(req.url, 'http://127.0.0.1').searchParams
            if (query.get('view') === 'resources') {
              const access = service(host, 'pxPersonaResources')
              if (!access) throw new MemoryError('人格资源服务未就绪', 503)
              return send(200, {
                ...access.inspect(validId(query.get('personaId'))),
                tools: resourceToolCatalog(host)
              })
            }
            return send(
              200,
              await personaHubView(
                host,
                store,
                query.get('personaId') ?? undefined,
                Number(query.get('offset') ?? 0),
                query.get('currentSessionId') ?? undefined
              )
            )
          }
          if (req.method !== 'POST') return send(405, { error: '请使用 GET 或 POST' })
          if (!String(req.headers['content-type']).startsWith('application/json'))
            throw new MemoryError('请使用 JSON', 415)
          const chunks: Buffer[] = []
          let length = 0
          for await (const chunk of req) {
            length += Buffer.byteLength(chunk)
            if (length > 96000) throw new MemoryError('请求过大', 413)
            chunks.push(Buffer.from(chunk))
          }
          let args: any
          try {
            args = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            throw new MemoryError('JSON 无效')
          }
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new MemoryError('操作无效')
          if (args.type === 'navigate-new') {
            if (!navigation) throw new MemoryError('人格导航服务未就绪', 503)
            return send(200, await navigation.create(host, args))
          }
          if (args.type === 'create-persona') return send(200, store.createPersona(args.name))
          if (args.type === 'resources') {
            const access = service(host, 'pxPersonaResources')
            if (!access) throw new MemoryError('人格资源服务未就绪', 503)
            access.save(args.personaId, args.revision, args.policy)
            return send(200, access.inspect(args.personaId))
          }
          if (args.type !== 'create-session') throw new MemoryError('操作无效')
          const createdSessionId = await once(
            args.requestId,
            JSON.stringify([args.personaId, args.workspaceId]),
            () => createHubSession(host, store, args)
          )
          return send(200, { createdSessionId })
        } catch (error) {
          send(error instanceof MemoryError ? error.status : 503, {
            error: error instanceof Error ? error.message : '人格目录不可用'
          })
        }
      }
    })
  )
  return () => injection.dispose()
}
