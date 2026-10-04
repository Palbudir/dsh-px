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

export const name = 'dsh-px-memory'
export const inject: string[] = []
interface Agent {
  session: { id: string; header: { id: string; cwd?: string; parentSession?: string } }
}
export function apply(ctx: any): void {
  const root = process.env.DSH_HOME
  if (!root) throw new Error('DSH_HOME 未设置，无法保存人格与记忆')
  const store = new MemoryStore(join(root, 'storages', name, 'memory.json'))
  const active = new WeakMap<Agent, { turn: number; persona: Persona }>()
  ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    const parent = agent.session.header.parentSession
    if (!parent) return
    try {
      const state = store.read()
      if (!Object.hasOwn(state.sessions, agent.session.id) && state.sessions[parent])
        store.change(state.revision, (next) => {
          next.sessions[agent.session.id] = state.sessions[parent]
        })
    } catch (error) {
      ctx.logger?.warn('无法继承人格配置：%s', String(error))
    }
  })
  ctx.on('agent/pre-step', ({ agent, turn }: { agent: Agent; turn: number }, next: () => unknown) => {
    try {
      if (active.get(agent)?.turn !== turn)
        active.set(agent, { turn, persona: store.persona(store.read(), agent.session.id) })
    } catch {
      active.delete(agent)
    }
    return next()
  })
  const current = (agent: Agent): Persona =>
    active.get(agent)?.persona ?? store.persona(store.read(), agent.session.id)
  ctx.inject(['systemPrompt'], (host: any) =>
    host.effect(
      () =>
        host.systemPrompt.context({
          name: 'dsh-px-persona-memory',
          order: 500,
          text: ({ agent }: { agent?: Agent }) => {
            if (!agent) return ''
            try {
              return memoryContext(current(agent), projectKey(agent.session.header.cwd))
            } catch {
              return 'PX 人格与记忆暂时无法读取。请告知用户检查人格与记忆面板，不推测已保存的内容。原生会话可继续使用。'
            }
          }
        }),
      'memory: persona context'
    )
  )
  ctx.inject(['tools'], (host: any) => {
    host.tools.register({
      name: 'persona_memory',
      description:
        '读取当前人格的长期记忆。仅用户明确要求记住、修改或忘记时写入；不要保存临时进度。先 read 获取 revision，再 save/forget。scope=project 仅当前目录；persona 跨目录。已保存内容从下轮起使用。',
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
          state = store.read(),
          p = current(agent),
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
              const { meta } = await host.sessionController.inspect(id)
              const project = projectKey(meta.cwd)
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
                store.action(args.revision, args, id, project)
              }
              const state = store.read(),
                persona = store.persona(state, id)
              send(200, {
                revision: state.revision,
                personas: state.personas.map((p) => ({ id: p.id, name: p.name })),
                persona,
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
