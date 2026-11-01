import { join } from 'node:path'
import { ChannelNotes, type ChannelNoteInput } from './channel-notes'
import { QQ_CONVERSATION_TOOLS, qqMessageOrigin } from '../../shared/channel-source'
import {
  MemoryStore,
  MemoryError,
  validId,
  isInternalSession,
  isAttentionSession,
  projectKey,
  memoryContext,
  selectedMemories,
  publicSession,
  type SessionChannel,
  type SessionBinding,
  type Persona
} from './store'
import { rejectUnauthenticatedRequest } from '../../shared/request-trust'
import { TurnIdentity, hasStarted } from './identity'
import { renderPersonaExpression } from '../../shared/persona-expression'
import { HistoryIndex, service } from './history'
import { createPersonaSession, continuationRequests } from './continuation'
import { KnowledgeBank, type KnowledgeCaller } from './knowledge'
import { knowledgeAction, pxKnowledgeSource, knowledgeContractText } from './knowledge-source'
import { observeFile, skillAction } from './native-resources'
import { installKnowledgeToolRouting } from './knowledge-tools'
import { delegatedContract, delegatedKnowledgeCaller } from './knowledge-delegation'
import { ExperienceService } from './experience-service'
import { runAnalysisTask } from './experience-task'
import { inspectMemorySession } from './session-context'
import { installPersonaSkillProviders } from './persona-skills'
import { registerPersonaHub } from './persona-hub'
import { PersonaNavigation } from './persona-navigation'
import { PersonaResourceAccess, installPersonaResourceAccess } from './persona-resources'
import { SegmentRuntime } from './segment-runtime'
import { registerSegmentBoundary } from './segment-context'
import { nativeHistoryGuard, nativeHistoryScope } from './native-history-policy'
import { HotMemory } from './hot-memory'
import { currentMemoryEvidence } from './hot-memory-evidence'

export const name = 'dsh-px-memory'
export const inject: string[] = []
interface Agent {
  session: {
    id: string
    header: { id: string; cwd?: string; parentSession?: string; origin?: string }
    snapshotEvents?: () => readonly any[]
  }
}
export function apply(ctx: any): void {
  const root = process.env.DSH_HOME
  if (!root) throw new Error('DSH_HOME 未设置，无法保存人格与记忆')
  const store = new MemoryStore(join(root, 'storages', name, 'memory.json'))
  ctx.provide('pxNativeHistorySubjects', {
    version: 1,
    scope: (agent: any, tool: string) => nativeHistoryScope(store, agent, tool)
  })
  ctx.effect(() => {
    const navigation = new PersonaNavigation(store, join(root, 'storages', name, 'navigation.sqlite'))
    const off = registerPersonaHub(ctx, store, navigation)
    return () => {
      off()
      navigation.close()
    }
  }, 'memory: persona workspace API')
  const channelBindings = new WeakMap<object, SessionBinding | null>()
  const bindingFor = (agent: Agent | undefined): SessionBinding | undefined => {
    if (!agent) return
    if (!channelBindings.has(agent) || channelBindings.get(agent) === null)
      channelBindings.set(agent, store.read().bindings[agent.session.id] ?? null)
    return channelBindings.get(agent) ?? undefined
  }
  ctx.on(
    'system-prompt/assemble',
    async (_assembly: any, context: any, next: () => Promise<any>) => {
      const assembly = await next()
      if (
        publicSession(bindingFor(context.agent)) &&
        !assembly.sections.some((section: any) => section.name === 'px-qq-public-persona')
      )
        throw new MemoryError('QQ 公共会话的权限预设未就绪，请启用配套 QQ 能力或新建普通会话', 409)
      return assembly
    },
    { prepend: true }
  )
  ctx.inject(['tools'], (host: any) =>
    host.effect(
      () =>
        host.tools.guard((exec: any) => {
          const adapted = host.tools.get?.(exec.name, exec.agent)?.pxSubjectPolicyVersion === 1
          const historyDenial = nativeHistoryGuard(store, exec, adapted)
          if (historyDenial) return historyDenial
          const binding = bindingFor(exec.agent)
          if (!publicSession(binding)) return
          if (binding!.channel?.task) {
            if (!service(host, 'pxQq')?.canRunGroupTask(exec.agent?.session.id))
              return '群任务授权不可用，请检查 QQ 接入与授权成员'
            return
          }
          if (!['qq_public_knowledge', 'qq_task', ...QQ_CONVERSATION_TOOLS].includes(exec.name))
            return '公共 QQ 会话没有本机执行或私有信息权限'
          if (exec.name === 'qq_task' && !service(host, 'pxQq')?.canDelegate(exec, binding!.channel))
            return '当前 QQ 请求没有私有任务授权'
        }),
      'memory: durable public channel boundary'
    )
  )
  const modelContinuation = continuationRequests()
  const identity = new TurnIdentity(store, (agent) =>
    service(ctx, 'sessionProjections')?.stateOf?.(agent.session, 'turnBoundary')
  )
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }: any) => identity.claim(agent, message, turn))
  const resourceAccess = new PersonaResourceAccess(
    store,
    identity,
    (id) => service(ctx, 'agents')?.get(id),
    (child, parent) => service(ctx, 'agents')?.isOwnedBy?.(child.session.id, parent) === true
  )
  ctx.effect(() => installPersonaResourceAccess(ctx, resourceAccess), 'memory: persona resource access')
  const contracts = new Map<string, { turn: number; instance: string }>()
  const currentTurn = (agent: Agent): number =>
    service(ctx, 'sessionProjections')?.stateOf?.(agent.session, 'turnBoundary')?.lastTurn ??
    agent.session.snapshotEvents?.().findLast((e) => e.type === 'turn/start')?.data?.turn ??
    0
  ctx.effect(() => () => contracts.clear(), 'memory: current knowledge contracts')
  const knowledge = new KnowledgeBank(
    join(root, 'storages', 'dsh-px-knowledge-scopes'),
    store,
    (caller, path) => observeFile(ctx, caller, path),
    (caller, source, seq, signal) => history.read(ctx, caller.sessionId, source, seq, 0, signal)
  )
  // Local plugin contract only: remote callers still go through their authenticated channel owner.
  const channelNotes = new ChannelNotes(
    store,
    knowledge,
    (caller, source, seq, signal) => history.read(ctx, caller, source, seq, 0, signal),
    (sessionId) => {
      const channel = store.read().bindings[sessionId]?.channel
      const events: any[] = service(ctx, 'agents')?.get(sessionId)?.session.snapshotEvents() ?? []
      const start = events.findLastIndex((event) => event.type === 'turn/start')
      if (start < 0 || !channel) return []
      return events
        .slice(start + 1)
        .filter((event) => {
          const origin = qqMessageOrigin(event.data?.source)
          return (
            event.type === 'user/message' &&
            origin?.accountId === channel.accountId &&
            origin.conversationId === channel.conversationId
          )
        })
        .slice(-6)
        .map((event) => ({
          sessionId,
          seq: event.seq,
          userId: qqMessageOrigin(event.data.source)!.senderId,
          excerpt: (event.data.content ?? [])
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('\n')
            .slice(0, 2000)
        }))
    }
  )
  ctx.provide('pxMemoryChannels', {
    version: 1,
    capabilities: { conversationMemoryIsolation: 1, personaSkills: 1, sceneExpression: 1 },
    conversationNotes: (sessionId: string, input: ChannelNoteInput, signal: AbortSignal) =>
      channelNotes.execute(sessionId, input, signal),
    createPersona: (name: string) => store.createPersona(name),
    beginAttention: (sessionId: string, personaId: string) => {
      if (!isAttentionSession(sessionId)) throw new MemoryError('通知会话标识无效')
      // The legacy marker means internal analysis. Keep it readable by earlier Packs on rollback;
      // reserved IDs and native Job kinds distinguish attention from experience work.
      store.bind(sessionId, { personaId, purpose: 'experience', locked: true, pending: true })
    },
    releaseAttention: (ids: string[]) => store.releaseInternalBindings(ids.filter(isAttentionSession)),
    runAttentionAnalysis: (
      parent: any,
      prompt: string,
      schema: object,
      signal: AbortSignal,
      options: any
    ) => {
      if (!isAttentionSession(parent?.id) || service(ctx, 'agents')?.get(parent.id) !== parent)
        throw new MemoryError('通知分析缺少原生所有者', 403)
      return runAnalysisTask(
        { on: ctx.on.bind(ctx), get: (key: string) => service(parent.ctx, key) ?? service(ctx, key) },
        parent,
        prompt,
        schema,
        signal,
        { ...options, kind: 'attention' }
      )
    },
    personas: () =>
      store
        .read()
        .personas.filter((p) => !p.archived)
        .map((p) => ({ id: p.id, name: p.name, revision: p.revision, expression: p.expression })),
    channelBindings: (accountId: string) =>
      Object.entries(store.read().bindings)
        .filter(
          ([, binding]) => binding.channel?.provider === 'qq' && binding.channel.accountId === accountId
        )
        .map(([sessionId, binding]) => ({
          sessionId,
          personaId: binding.personaId,
          channel: binding.channel,
          createdAt: binding.createdAt,
          pending: binding.pending
        })),
    bind: (sessionId: string, personaId: string, channel: SessionChannel, sourceSessionId?: string) =>
      store.bind(sessionId, {
        ...(sourceSessionId ? { parent: sourceSessionId } : { personaId }),
        channel,
        pending: !service(ctx, 'agents')?.get(sessionId)
      }),
    currentPersona: (agent: Agent) => identity.current(agent),
    expressionContext: (agent: Agent) => identity.interaction(agent),
    inherit: (sessionId: string, parent?: string) => {
      if (parent && store.read().bindings[parent]?.channel) store.bind(sessionId, { parent, locked: true })
    },
    inspect: (sessionId: string) => {
      const state = store.read()
      return { binding: state.bindings[sessionId], persona: store.persona(state, sessionId) }
    },
    sharedKnowledge: async (
      sessionId: string,
      project: string,
      input: { scope: 'project' | 'global'; query?: string; id?: string }
    ) => {
      if (!['project', 'global'].includes(input.scope) || !store.read().bindings[sessionId])
        throw new MemoryError('公共知识请求范围无效', 403)
      const caller = { sessionId, project, actor: 'model' as const }
      return input.id
        ? knowledge.read(caller, input.scope, input.id)
        : knowledge.search(caller, input.scope, input.query ?? '')
    },
    continue: (sessionId: string, args: any, signal?: AbortSignal) =>
      createPersonaSession(ctx, store, sessionId, args, signal)
  })
  ctx.effect(() => () => knowledge.dispose(), 'memory: knowledge sources')
  ctx.inject(['mnemonMemory', 'tools', 'agents'], (host: any) =>
    host.effect(() => installKnowledgeToolRouting(host), 'memory: native knowledge tool routing')
  )
  const knowledgeEnabled = (caller: KnowledgeCaller): boolean => {
    const agent = service(ctx, 'agents')?.get(caller.sessionId)
    if (agent) {
      try {
        const persona = identity.current(agent)
        return persona.memoryEnabled && !persona.archived
      } catch {
        return false
      }
    }
    const s = store.read(),
      binding = s.bindings[caller.sessionId],
      persona = s.personas.find((p) => p.id === binding?.personaId)
    return !!persona && persona.memoryEnabled && !persona.archived && !binding?.pending
  }
  ctx.inject(['mnemonMemory'], (host: any) =>
    host.effect(
      () =>
        host.mnemonMemory.installContributions(
          {
            plugin: {
              apiVersion: 'dsh-mnemon/plugin/v1',
              packageName: 'dsh-px-memory',
              label: { en: 'PX Knowledge', 'zh-CN': 'PX 知识' },
              description: {
                en: 'Persona and shared knowledge with versioned sources.',
                'zh-CN': '人格私有与公共知识，保留修订与来源。'
              },
              roles: ['source'],
              provides: [{ id: 'px-scoped-knowledge' }]
            },
            sources: [
              pxKnowledgeSource(
                knowledge,
                knowledgeEnabled,
                async (caller, input, signal) => {
                  if (input.action === 'feedback') return // Persona/audience-local, not a shared-content edit.
                  if (input.action !== 'share' && input.scope !== 'global') return
                  const approval = service(host, 'approval'),
                    agent = service(host, 'agents')?.get(caller.sessionId)
                  if (!approval?.request || !agent) throw new MemoryError('共享知识需要当前会话中的原生确认')
                  const decision = await approval.request({
                    agent,
                    toolName: 'mnemon_view_action',
                    reason: 'Share or change globally reusable PX knowledge',
                    displayReason: {
                      zh: `允许${input.action === 'share' ? '分享这条知识到 ' + input.targetScope : '修改全局共享知识'}？`,
                      en: 'Allow sharing or modifying globally shared knowledge?'
                    },
                    signal
                  })
                  if (decision !== 'allowed-once') throw new MemoryError('知识共享未获确认，未修改内容', 409)
                },
                (caller, instance) => {
                  const agent = service(ctx, 'agents')?.get(caller.sessionId)
                  if (agent) contracts.set(caller.sessionId, { turn: currentTurn(agent), instance })
                },
                (caller) => {
                  const agents = service(ctx, 'agents')
                  return delegatedKnowledgeCaller(
                    caller,
                    agents?.currentInitiator?.(),
                    (id) => agents?.get(id),
                    store
                  )
                }
              )
            ]
          },
          { instanceId: 'dsh-px-knowledge' }
        ),
      'memory: Mnemon source'
    )
  )
  ctx.inject(['systemPrompt'], (host: any) =>
    host.effect(
      () =>
        host.systemPrompt.section({
          name: 'dsh-px-current-knowledge-contract',
          order: 501,
          text: ({ agent }: { agent?: Agent }) => {
            if (!agent) return ''
            if (!knowledgeEnabled({ sessionId: agent.session.id })) return ''
            const agents = service(ctx, 'agents')
            const instance = delegatedContract(
              agent,
              (id) => agents?.get(id),
              (id) => {
                const binding = contracts.get(id)
                return binding && (id !== agent.session.id || binding.turn === currentTurn(agent))
                  ? binding.instance
                  : undefined
              },
              store
            )
            return instance ? knowledgeContractText(instance) : ''
          }
        }),
      'memory: compression-stable native operation contract'
    )
  )
  const history = new HistoryIndex(join(root, 'storages', name, 'history.sqlite'), store)
  ctx.effect(() => () => history.close(), 'memory: history index')
  const hot = new HotMemory(
    store,
    join(root, 'storages', name, 'hot-feedback.sqlite'),
    (caller, source, seq, signal) => history.read(ctx, caller, source, seq, 0, signal)
  )
  ctx.effect(() => () => hot.close(), 'memory: hot memory feedback')
  const segments = new SegmentRuntime(
    ctx,
    store,
    knowledge,
    history,
    join(root, 'storages', name, 'segments.sqlite')
  )
  ctx.effect(() => () => segments.dispose(), 'memory: background segments')
  ctx.effect(() => store.subscribe(() => segments.changed()), 'memory: segment identity invalidation')
  ctx.provide('pxContextSegments', {
    snapshot: (id: string) => segments.snapshot(id),
    cancel: (id: string) => segments.cancel(id)
  })
  ctx.inject(['jobs'], (host: any) =>
    host.effect(
      () => host.jobs.attachController('px-context-segments'),
      'memory: native segment job controller'
    )
  )
  ctx.inject(['llm', 'tokenMeter', 'sessionProjections', 'agents'], (host: any) => {
    host.effect(() => registerSegmentBoundary(host), 'memory: native stable segment cursor')
    void segments
      .ready()
      .catch((error) => ctx.logger?.warn('后台片段提交服务未启动；原生压缩继续：%s', String(error)))
  })
  ctx.on(
    'agent/pre-step',
    async ({ agent, signal }: any, next: () => Promise<any>) => {
      await segments.boundary(agent, signal)
      return next()
    },
    { prepend: true }
  )
  ctx.on('agent/turn-stopping', ({ agent, signal }: any) => {
    if (signal.aborted) segments.cancel(agent.session.id, '本轮已停止')
    else segments.schedule(agent)
  })
  ctx.on('session/event', (session: any, event: any) => {
    if (event.surfaceOp?.op === 'replace') segments.surfaceChanged(session)
    if (
      event.type === 'turn/end' &&
      ['aborted', 'interrupted', 'error', 'blocked', 'max-tokens'].includes(event.data?.reason?.kind)
    )
      segments.cancel(session.id, '来源轮次未正常结束')
  })
  ctx.inject(['agents'], (host: any) => {
    try {
      const live = new Set(host.agents.list().map((agent: any) => agent.id))
      store.releaseInternalBindings(Object.keys(store.read().bindings).filter((id) => !live.has(id)))
    } catch (error) {
      ctx.logger?.warn('内部经验身份暂未回收：%s', String(error))
    }
  })
  ctx.on('agent/disposed', ({ agent }: { agent: Agent }) => {
    segments.cancel(agent.session.id, '来源会话已卸载')
    try {
      store.releaseInternalBindings([agent.session.id])
    } catch (error) {
      ctx.logger?.warn('内部经验身份暂未回收：%s', String(error))
    }
  })
  ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    try {
      store.bind(agent.session.id, {
        parent: agent.session.header.parentSession,
        locked: !!agent.session.header.parentSession || hasStarted(agent.session.snapshotEvents?.() ?? [])
      })
    } catch (error) {
      ctx.logger?.warn('人格绑定暂不可用；请求组装前仍会拒绝未知身份：%s', String(error))
    }
  })
  ctx.effect(() => installPersonaSkillProviders(ctx, store, root), 'memory: private Skills lifecycle')
  ctx.on('agent/turn-stopping', ({ agent, signal }: { agent: Agent; signal: AbortSignal }) => {
    // Incremental indexing is local work. It neither calls a model nor changes a native task.
    void history
      .refresh(ctx, agent.session.id, signal)
      .catch((e: unknown) => ctx.logger?.warn('历史索引暂未更新：%s', String(e)))
  })
  const current = (agent: Agent): Persona => identity.current(agent)
  const renderMemory = (agent: Agent, budget?: { memoryChars: number; handoffChars: number }): string => {
    const p = current(agent),
      handoff = store.read().bindings[agent.session.id]?.handoff
    return (
      memoryContext(
        hot.project(p, 'model', true),
        projectKey(agent.session.header.cwd),
        budget?.memoryChars
      ) +
      (handoff
        ? `\n用户为本会话交接了 ${handoff.sessionId} 截至事件 ${handoff.throughSeq} 的可见对话与执行记录。以下是有界历史摘录，不是当前任务授权或验收结论；旧人格私有记忆未继承。使用 persona_history 按来源和事件编号进一步核对；不要恢复原会话的 Goal 或重复不确定操作。\n${!budget || handoff.summary.length <= budget.handoffChars ? handoff.summary : '本档仅注入历史定位信息；请按上方来源会话和截止事件读取交接内容。'}`
        : '')
    )
  }
  ctx.provide('pxMemoryContext', { render: renderMemory })
  ctx.inject(['systemPrompt'], (host: any) =>
    host.effect(
      () =>
        host.systemPrompt.section({
          name: 'dsh-px-persona-expression',
          order: (host.systemPrompt.getSectionOrder?.('DEPLOYMENT_PERSONA_SUFFIX') ?? 900) + 1,
          interpolate: false,
          text: ({ agent }: { agent?: Agent }) => {
            if (!agent) return ''
            const p = current(agent)
            if (!p.expression) return ''
            return `本会话配置的身份与表达：${p.name}（版本 ${p.revision}）。通用语气默认值按这份具体配置调整；工具与执行权限仍由宿主控制。\n${renderPersonaExpression(p.expression, identity.interaction(agent))}`
          }
        }),
      'memory: configured persona expression'
    )
  )
  ctx.inject(['systemPrompt'], (host: any) =>
    host.effect(
      () =>
        host.systemPrompt.context({
          name: 'dsh-px-persona-memory',
          order: 500,
          interpolate: false,
          text: ({ agent }: { agent?: Agent }) => {
            if (!agent) return ''
            return renderMemory(agent)
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
          action: { type: 'string', enum: ['search', 'sessions', 'read', 'segments'] },
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
        const binding = store.read().bindings[run.agent.session.id]
        const channelMemory =
          publicSession(binding) &&
          store
            .read()
            .personas.some(
              (persona) => persona.id === binding?.personaId && persona.memoryEnabled && !persona.archived
            )
        const localContext =
          args.action === 'segments' || (args.action === 'read' && args.sessionId === run.agent.session.id)
        if (!p.memoryEnabled && !channelMemory && !localContext)
          throw new MemoryError('当前人格的跨会话记忆已关闭；仍可按原始事件读取本会话上下文')
        if (args.action === 'segments')
          return JSON.stringify({
            source: 'native-compaction-segments',
            sessionId: run.agent.session.id,
            segments: segments.modelSnapshot(run.agent.session.id)
          })
        const id = run.agent.session.id,
          coverage = localContext ? { currentSessionOnly: true } : await history.refresh(ctx, id, run.signal)
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
        '读取当前人格的长期约定。read 返回通用及当前目录的现行条目；historical=true 才显示已标记错误的现存条目。仅用户明确要求记住、修改或忘记时 save/forget，不保存临时进度。先 read 获取整体 revision，再写入；scope 为 project 或 persona。新内容下轮常驻使用，纠正/忘记会使旧内容立即退出后续注入。feedback 只记录 useful/not-applicable，须引用原始事件；entryRevision 是具体条目版本，不是写入用的整体 revision。evidence 是 save 的可选原始依据，省略时关联本轮用户输入；没有依据时标为模型整理，不假称已证实。',
      parameters: {
        type: 'object',
        required: ['action'],
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['read', 'save', 'forget', 'feedback'] },
          revision: { type: 'integer', minimum: 0 },
          id: { type: 'string' },
          text: { type: 'string', maxLength: 2000 },
          scope: { type: 'string', enum: ['project', 'persona'] },
          historical: { type: 'boolean' },
          entryRevision: { type: 'integer', minimum: 1 },
          kind: { type: 'string', enum: ['useful', 'not-applicable'] },
          reason: { type: 'string', maxLength: 1000 },
          evidence: {
            type: 'array',
            maxItems: 6,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sessionId', 'seq'],
              properties: { sessionId: { type: 'string' }, seq: { type: 'integer', minimum: 0 } }
            }
          }
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
        if (store.persona(state, agent.session.id).id !== p.id)
          throw new MemoryError('人格切换将在下一轮生效，请到下一轮再读取或修改记忆', 409)
        if (args.action === 'read')
          return JSON.stringify({
            revision: state.revision,
            persona: p.name,
            memoryEnabled: p.memoryEnabled,
            memories: selectedMemories(
              hot.project(store.persona(state, agent.session.id), 'model', args.historical !== true),
              project
            )
          })
        if (publicSession(state.bindings[agent.session.id]))
          throw new MemoryError('公共聊天不能修改人格私有记忆', 403)
        if (!p.memoryEnabled || !store.persona(state, agent.session.id).memoryEnabled)
          throw new MemoryError('当前人格的记忆已关闭')
        if (args.action === 'feedback')
          return JSON.stringify(
            await hot.judge(
              { sessionId: agent.session.id, project, actor: 'model' },
              { ...args, evidence: args.evidence?.[0] },
              run.signal
            )
          )
        if (args.action !== 'save' && args.action !== 'forget') throw new MemoryError('操作无效')
        const entry = state.personas.find((v) => v.id === p.id)?.memories.find((m) => m.id === args.id)
        if (args.id && (!entry || (entry.project !== null && entry.project !== project)))
          throw new MemoryError('该条目不属于当前可见记忆')
        const next =
          args.action === 'save'
            ? await hot.save(
                { sessionId: agent.session.id, project, actor: 'model' },
                args.revision,
                args,
                args.evidence ?? (await currentMemoryEvidence(ctx, agent, run.signal)),
                run.signal
              )
            : store.action(args.revision, { ...args, type: args.action }, agent.session.id, project)
        return JSON.stringify({ saved: true, revision: next.revision, applies: 'next-turn' })
      }
    })
  })
  ctx.inject(['connection', 'webServer', 'sessionController'], (host: any) => {
    const experience = new ExperienceService(host, store, join(root, 'storages', 'dsh-px-experience'), root)
    host.effect(() => () => experience.dispose(), 'memory: experience lifecycle')
    return host.effect(
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
              if (isInternalSession(id)) throw new MemoryError('内部后台记录请从对应功能页查看', 409)
              const { meta, events = [] } = await inspectMemorySession(host, store, id)
              const project = projectKey(meta.cwd)
              store.bind(id, {
                parent: meta.parentSession,
                locked: !!meta.parentSession || hasStarted(events)
              })
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
                if (args.type === 'new-model-session') {
                  if (
                    typeof args.provider !== 'string' ||
                    typeof args.model !== 'string' ||
                    (args.reasoningEffort !== undefined && typeof args.reasoningEffort !== 'string')
                  )
                    throw new MemoryError('模型选择无效')
                  const route = {
                    provider: args.provider,
                    model: args.model,
                    ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {})
                  }
                  const createdSessionId = await modelContinuation(
                    args.requestId,
                    JSON.stringify([id, route]),
                    async () => {
                      await host.get('llm').resolveCallConfig(route)
                      const persona = store.persona(store.read(), id)
                      const createdSessionId = await createPersonaSession(host, store, id, {
                        ...args,
                        personaId: persona.id,
                        handoff: true
                      })
                      const created = await host.sessionController.inspect(createdSessionId)
                      const contextState = host.get('pxContextPolicy')?.state
                      if (!contextState) throw new MemoryError('模型档位服务未就绪', 503)
                      const marker = await contextState.continuation(createdSessionId)
                      if (marker) {
                        if (
                          marker.provider !== route.provider ||
                          marker.model !== route.model ||
                          marker.reasoningEffort !== route.reasoningEffort ||
                          marker.sourceSessionId !== id
                        )
                          throw new MemoryError('该接续请求已用于其他模型', 409)
                        return createdSessionId
                      }
                      if (hasStarted(created.events))
                        throw new MemoryError('接续会话已经开始，请在新会话中选择模型', 409)
                      await host.sessionController.selectModel({ sessionId: createdSessionId, ...route })
                      await contextState.rememberContinuation(createdSessionId, {
                        sourceSessionId: id,
                        ...route
                      })
                      return createdSessionId
                    }
                  )
                  return send(200, { createdSessionId })
                }
                if (args.type === 'knowledge') {
                  const result = await knowledgeAction(
                    knowledge,
                    { sessionId: id, project: meta.cwd, actor: 'human' },
                    args.input
                  )
                  return send(200, result)
                }
                if (args.type === 'segments') {
                  const input = args.input
                  if (
                    !input ||
                    !['status', 'configure', 'stop', 'retry', 'accept', 'dismiss'].includes(input.action)
                  )
                    throw new MemoryError('后台整理操作无效')
                  if (input.action === 'configure') segments.configure(id, input.revision, input.enabled)
                  if (input.action === 'stop') segments.cancel(id)
                  if (input.action === 'retry') segments.requestRetry(id)
                  if (input.action === 'accept' || input.action === 'dismiss')
                    await segments.decideMemory(id, validId(input.id), input.index, input.action, meta.cwd)
                  return send(200, segments.snapshot(id))
                }
                if (args.type === 'conversation-memory') {
                  if (
                    !['catalog', 'search', 'read', 'feedback', 'correct', 'archive'].includes(
                      args.input?.action
                    )
                  )
                    throw new MemoryError('请使用聊天记忆的只读操作')
                  return send(
                    200,
                    await channelNotes.execute(id, args.input, new AbortController().signal, 'human')
                  )
                }
                if (args.type === 'skills')
                  return send(
                    200,
                    await skillAction(host, { sessionId: id, project: meta.cwd }, root, args.input)
                  )
                if (args.type === 'experience')
                  return send(
                    200,
                    await experience.request({ sessionId: id, project: meta.cwd, actor: 'human' }, args.input)
                  )
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
                if (args.type === 'memory-feedback')
                  await hot.judge({ sessionId: id, project, actor: 'human' }, args)
                else if (args.type === 'save')
                  await hot.save({ sessionId: id, project, actor: 'human' }, args.revision, args)
                else store.action(args.revision, args, id, project)
              }
              const state = store.read(),
                persona = hot.project(store.persona(state, id), 'human')
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
  })
}
