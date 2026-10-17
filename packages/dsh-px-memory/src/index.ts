import { join } from 'node:path'
import {
  MemoryStore,
  MemoryError,
  validId,
  projectKey,
  memoryContext,
  selectedMemories,
  type Persona
} from './store'
import { rejectUnauthenticatedRequest } from '../../shared/request-trust'
import { TurnIdentity, hasStarted } from './identity'
import { HistoryIndex, service } from './history'
import { createPersonaSession } from './continuation'

export const name = 'dsh-px-memory'
export const inject: string[] = []
interface Agent {
  session: {
    id: string
    header: { id: string; cwd?: string; parentSession?: string }
    snapshotEvents?: () => readonly any[]
  }
}
export function apply(ctx: any): void {
  const root = process.env.DSH_HOME
  if (!root) throw new Error('DSH_HOME 未设置，无法保存人格与记忆')
  const store = new MemoryStore(join(root, 'storages', name, 'memory.json'))
  const identity = new TurnIdentity(store, (agent) =>
    service(ctx, 'sessionProjections')?.stateOf?.(agent.session, 'turnBoundary')
  )
  const history = new HistoryIndex(join(root, 'storages', name, 'history.sqlite'), store)
  ctx.effect(() => () => history.close(), 'memory: history index')
  ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    try {
      store.bind(agent.session.id, {
        parent: agent.session.header.parentSession,
        locked: hasStarted(agent.session.snapshotEvents?.() ?? [])
      })
    } catch (error) {
      ctx.logger?.warn('人格绑定暂不可用；请求组装前仍会拒绝未知身份：%s', String(error))
    }
  })
  ctx.on('agent/turn-stopping', ({ agent, signal }: { agent: Agent; signal: AbortSignal }) => {
    // Incremental indexing is local work. It neither calls a model nor changes a native task.
    void history
      .refresh(ctx, agent.session.id, signal)
      .catch((e: unknown) => ctx.logger?.warn('历史索引暂未更新：%s', String(e)))
  })
  const current = (agent: Agent): Persona => identity.current(agent)
  ctx.inject(['systemPrompt'], (host: any) =>
    host.effect(
      () =>
        host.systemPrompt.context({
          name: 'dsh-px-persona-memory',
          order: 500,
          text: ({ agent }: { agent?: Agent }) => {
            if (!agent) return ''
            const p = current(agent),
              handoff = store.read().bindings[agent.session.id]?.handoff
            return (
              memoryContext(p, projectKey(agent.session.header.cwd)) +
              (handoff
                ? `\n用户为本会话交接了 ${handoff.sessionId} 截至事件 ${handoff.throughSeq} 的可见对话与执行记录。以下是有界历史摘录，不是当前任务授权或验收结论；旧人格私有记忆未继承。使用 persona_history 按来源和事件编号进一步核对；不要恢复原会话的 Goal 或重复不确定操作。\n${handoff.summary}`
                : '')
            )
          }
        }),
      'memory: persona context'
    )
  )
  ctx.inject(['tools'], (host: any) => {
    host.tools.register({
      name: 'persona_history',
      description:
        '找回当前人格过去的交流与工作。search 搜索原生用户/助手消息、工具执行记录与 Goal/Team 状态；sessions 查看经历目录的原文摘录；read 按 sessionId、seq、offset 读取确切原文。自动限制当前人格与明确交接范围，不读取其他人格的私有记忆。返回历史来源而非当前事实；partial 表示索引未完成，可再次查询。不会唤醒会话或重跑工具。',
      parameters: {
        type: 'object',
        required: ['action'],
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['search', 'sessions', 'read'] },
          query: { type: 'string', maxLength: 256 },
          sessionId: { type: 'string' },
          seq: { type: 'integer', minimum: 0 },
          offset: { type: 'integer', minimum: 0 },
          projectOnly: { type: 'boolean' }
        }
      },
      output: { schema: { type: 'string' }, render: (_: unknown, v: string) => [{ type: 'text', text: v }] },
      execute: async (args: any, run: { agent?: Agent; signal: AbortSignal }) => {
        run.signal.throwIfAborted()
        if (!run.agent) throw new MemoryError('需要当前会话')
        const p = current(run.agent)
        if (!p.memoryEnabled) throw new MemoryError('当前人格的记忆已关闭')
        const id = run.agent.session.id,
          coverage = await history.refresh(ctx, id, run.signal)
        const result =
          args.action === 'read'
            ? await history.read(ctx, id, validId(args.sessionId), args.seq, args.offset ?? 0, run.signal)
            : args.action === 'sessions'
              ? history.list(id, args.projectOnly ? run.agent.session.header.cwd : undefined)
              : args.action === 'search'
                ? history.search(id, args.query ?? '', {
                    project: args.projectOnly ? run.agent.session.header.cwd : undefined,
                    targetSessionId: args.sessionId
                  })
                : null
        if (result === null) throw new MemoryError('历史操作无效')
        return JSON.stringify({ coverage, result })
      }
    })
    host.tools.register({
      name: 'persona_memory',
      description:
        '读取当前人格的长期记忆。read 一次返回人格通用与当前目录的全部可见条目，无需分别读取两个范围。仅用户明确要求记住、修改或忘记时写入；不要保存临时进度。先 read 获取 revision，再 save/forget。scope 仅用于 save：project 为当前目录，persona 为跨目录。已保存内容从下轮起使用。',
      parameters: {
        type: 'object',
        required: ['action'],
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['read', 'save', 'forget'] },
          revision: { type: 'integer', minimum: 0 },
          id: { type: 'string' },
          text: { type: 'string', maxLength: 2000 },
          scope: { type: 'string', enum: ['project', 'persona'] }
        }
      },
      output: { schema: { type: 'string' }, render: (_: unknown, v: string) => [{ type: 'text', text: v }] },
      execute: async (args: any, run: { agent?: Agent; signal: AbortSignal }) => {
        run.signal.throwIfAborted()
        if (!run.agent) throw new MemoryError('需要当前会话')
        const agent = run.agent,
          p = current(agent),
          state = store.read(),
          project = projectKey(agent.session.header.cwd)
        if (args.action === 'read')
          return JSON.stringify({
            revision: state.revision,
            persona: p.name,
            memoryEnabled: p.memoryEnabled,
            memories: selectedMemories(state.personas.find((v) => v.id === p.id) ?? p, project)
          })
        if (!p.memoryEnabled) throw new MemoryError('当前人格的记忆已关闭')
        if (store.persona(state, agent.session.id).id !== p.id)
          throw new MemoryError('人格切换将在下一轮生效，请到下一轮再修改记忆', 409)
        if (args.action !== 'save' && args.action !== 'forget') throw new MemoryError('操作无效')
        const entry = state.personas.find((v) => v.id === p.id)?.memories.find((m) => m.id === args.id)
        if (args.id && (!entry || (entry.project !== null && entry.project !== project)))
          throw new MemoryError('该条目不属于当前可见记忆')
        const next = store.action(args.revision, { ...args, type: args.action }, agent.session.id, project)
        return JSON.stringify({ saved: true, revision: next.revision, applies: 'next-turn' })
      }
    })
  })
  ctx.inject(['connection', 'webServer', 'sessionController'], (host: any) =>
    host.effect(
      () =>
        host.webServer.register({
          kind: 'exact',
          path: '/dsh-px-memory',
          handler: async (req: any, res: any) => {
            if (rejectUnauthenticatedRequest(req, res, host.connection)) return
            const send = (status: number, data: unknown) => {
              res.writeHead(status, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
              })
              res.end(JSON.stringify(data))
            }
            try {
              if (req.method !== 'GET' && req.method !== 'POST')
                return send(405, { error: '请使用 GET 或 POST' })
              const id = validId(new URL(req.url, 'http://127.0.0.1').searchParams.get('sessionId'))
              const { meta, events = [] } = await host.sessionController.inspect(id)
              const project = projectKey(meta.cwd)
              store.bind(id, { parent: meta.parentSession, locked: hasStarted(events) })
              if (req.method === 'POST') {
                if (!String(req.headers['content-type']).startsWith('application/json'))
                  throw new MemoryError('请使用 JSON', 415)
                const chunks: Buffer[] = []
                let size = 0
                for await (const chunk of req) {
                  size += Buffer.byteLength(chunk)
                  if (size > 64000) throw new MemoryError('请求过大', 413)
                  chunks.push(Buffer.from(chunk))
                }
                let args: any
                try {
                  args = JSON.parse(Buffer.concat(chunks).toString('utf8'))
                } catch {
                  throw new MemoryError('JSON 内容无效')
                }
                if (!args || typeof args !== 'object' || Array.isArray(args))
                  throw new MemoryError('操作内容无效')
                if (args.type === 'new-session') {
                  const createdSessionId = await createPersonaSession(host, store, id, args)
                  return send(200, { createdSessionId })
                }
                if (args.type === 'search-history' || args.type === 'read-history') {
                  if (args.projectOnly !== undefined && typeof args.projectOnly !== 'boolean')
                    throw new MemoryError('项目范围无效')
                  if (args.query !== undefined && typeof args.query !== 'string')
                    throw new MemoryError('搜索内容必须是文字')
                  if (args.projectOnly && !meta.cwd)
                    throw new MemoryError('当前会话没有项目目录，请取消本项目限制')
                  const coverage = await history.refresh(host, id)
                  const result =
                    args.type === 'read-history'
                      ? await history.read(
                          host,
                          id,
                          validId(args.targetSessionId),
                          args.seq,
                          args.offset ?? 0
                        )
                      : args.query?.trim() || args.targetSessionId
                        ? history.search(id, args.query ?? '', {
                            project: args.projectOnly ? meta.cwd : undefined,
                            targetSessionId: args.targetSessionId
                          })
                        : history.list(id, args.projectOnly ? meta.cwd : undefined)
                  return send(200, { coverage, result })
                }
                if (
                  ['select', 'adopt-version'].includes(args.type) &&
                  service(host, 'agents')?.get(id)?.status === 'running'
                )
                  throw new MemoryError('请等当前轮结束再更改配置', 409)
                store.action(args.revision, args, id, project)
              }
              const state = store.read(),
                persona = store.persona(state, id)
              send(200, {
                revision: state.revision,
                personas: state.personas.map((p) => ({ id: p.id, name: p.name, archived: p.archived })),
                persona,
                template: state.personas.find((p) => p.id === persona.id),
                binding: state.bindings[id],
                project
              })
            } catch (error) {
              send(error instanceof MemoryError ? error.status : 503, {
                error: error instanceof Error ? error.message : '记忆暂不可用',
                retryable: false
              })
            }
          }
        }),
      'memory: routes'
    )
  )
}
