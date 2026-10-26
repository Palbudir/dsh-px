import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { rejectUnauthenticatedRequest } from '../../shared/request-trust'
import { DEFAULT_QQ_SETTINGS, QqError, type QqSettings } from './policy'
import { NativeQqSettings, parseQqSettings } from './settings'
import { QqSessionPolicy } from './session-policy'
import { inspectOneBot } from './connection'
import { installPublicQqAgent } from './public-agent'
import { QqReceipts } from './receipts'
import qqCommunity from '../../../config/qq-community.json'

export const name = 'dsh-px-qq'
export const inject: string[] = []
export async function apply(ctx: any, config: { publicAgent?: boolean } = {}): Promise<void> {
  if (config.publicAgent === true) {
    await ctx.inject(['tools', 'systemPrompt'], (host: any) => installPublicQqAgent(host))
    return
  }
  ctx.inject(
    [
      'configEditor',
      'credentials',
      'agentPresets',
      'connection',
      'webServer',
      'pxMemoryChannels',
      'pxContextPolicy'
    ],
    (host: any) => activateHost(host)
  )
}
async function activateHost(ctx: any): Promise<void> {
  const home = process.env.DSH_HOME
  if (!home) throw new Error('DSH_HOME 未设置')
  const settings = new NativeQqSettings(ctx.configEditor)
  const receipts = new QqReceipts(join(home, 'storages', name, 'receipts.json'))
  let current: QqSessionPolicy | undefined
  ctx.on('agent/created', ({ agent }: any) => {
    current?.created(agent)
  })
  ctx.on('session/event', (session: any, event: any) => {
    current?.event(session, event)
  })
  let activationProblem: string | undefined
  for (const [event, kind] of [
    ['approval/request', 'approval'],
    ['user-questions/request', 'question']
  ] as const)
    ctx.on(
      event,
      (request: any, next: () => Promise<unknown>) =>
        current ? current.interaction(kind, request, next) : next(),
      { prepend: true }
    )
  const compatibleMember = () => {
    try {
      const require = createRequire(import.meta.url)
      const manifest = JSON.parse(readFileSync(require.resolve('dsh-onebot-qq/package.json'), 'utf8'))
      return (
        manifest.name === qqCommunity.name &&
        manifest.version === qqCommunity.derivedVersion &&
        manifest.dshPx?.compatibility === 'qq-v1' &&
        manifest.dshPx?.upstreamIntegrity === qqCommunity.integrity &&
        manifest.dshPx?.upstreamCommit === qqCommunity.sourceCommit
      )
    } catch {
      return false
    }
  }
  const ownedAgents = (accountId: string): any[] => {
    const ids = new Set(ctx.pxMemoryChannels.channelBindings(accountId).map((b: any) => b.sessionId))
    return (ctx.get('agents')?.list() ?? []).filter((a: any) => ids.has(a.session.id))
  }
  const busyAgents = (accountId: string) =>
    ownedAgents(accountId).filter(
      (a: any) => a.status === 'running' || a.inbox.nextTurn.length || a.inbox.nextStep.length
    )
  let publicPreset: Promise<void> | undefined
  const ensurePublicPreset = () =>
    (publicPreset ??= (async () => {
      const preset = await ctx.agentPresets.register({
        id: 'px-qq-public',
        name: 'QQ 公共交流（渠道管理）',
        description: '由 QQ 渠道创建，只使用当前聊天和共享知识；普通新会话无需选择此预设。',
        plugins: [
          { id: 'px-qq-audience', name: 'dsh-px-qq', config: { publicAgent: true } },
          {
            id: 'persona',
            name: '@deepseek-ai/dsh-persona',
            config: { prefix: 'You are a helpful conversational assistant.' }
          },
          { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
          {
            id: 'compaction',
            name: 'cordis:group',
            group: true,
            isolate: { compaction: true },
            config: [
              { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
              { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' }
            ]
          }
        ]
      })
      ctx.effect(() => preset, 'qq: public native preset')
    })().catch((error) => {
      publicPreset = undefined
      throw error
    }))
  ctx.provide('pxQq', {
    version: 1,
    canRunGroupTask: (sessionId: string) => current?.canRunGroupTask(sessionId) ?? false,
    workspace: (chatId: string) => current?.workspace(chatId),
    canDelegate: (exec: any, channel: any) => current?.canDelegate(exec, channel) ?? false,
    delegate: (exec: any, channel: any) => {
      if (!current) throw new QqError('QQ 接入已关闭，未投递任务', 409)
      return current.delegate(exec, channel)
    },
    activate: async (owner: any, raw: unknown) => {
      activationProblem = undefined
      let created: QqSessionPolicy | undefined
      try {
        const configuration = parseQqSettings(raw ?? {})
        if (!configuration.enabled) return undefined
        await receipts.ready()
        if (!compatibleMember())
          throw new QqError('当前 QQ 社区成员不是配套的 PX 兼容版本，已保留原安装与配置', 409)
        await ensurePublicPreset()
        if (!ctx.pxMemoryChannels.personas().some((p: any) => p.id === configuration.personaId))
          throw new QqError('请选择仍可用的 QQ 人格', 409)
        if (configuration.model) await ctx.get('llm').resolveCallConfig(configuration.model)
        const token = (await ctx.credentials.resolve(configuration.secretRef))?.value
        if (typeof token !== 'string' || !token || /[\r\n]/.test(token))
          throw new QqError('QQ 连接令牌不可用，请重新配置')
        mkdirSync(configuration.workspace, { recursive: true })
        const policy = new QqSessionPolicy(ctx, configuration, receipts)
        created = policy
        current = policy
        owner.effect(
          () => () => {
            const stopped = policy.dispose()
            if (current === policy) current = undefined
            return stopped
          },
          'qq: scoped channel policy'
        )
        return Object.assign(policy, {
          nativeConfig: (base: any) => ({
            ...base,
            mode: 'forward',
            url: configuration.endpoint,
            accessToken: token,
            botQQ: configuration.accountId,
            workspacePath: configuration.workspace,
            agentPreset: '',
            mediaDir: join(home, 'storages', name, 'channel'),
            dmPolicy: 'open',
            allowAllUsers: true,
            allowFrom: [],
            adminUsers: configuration.authorizedUsers,
            groupPolicy: 'open',
            groupAllowFrom: [],
            requireMention: true,
            ignoreSelf: true,
            interimMessages: true,
            interimRecall: false,
            textImageThreshold: 0,
            sttEnabled: false,
            newMessagePolicy: 'queue',
            autoSteerPolicy: 'admin',
            injectEnabled: false,
            recordInbound: false,
            traceEnabled: false,
            logLevel: 'warn'
          })
        })
      } catch (error) {
        created?.dispose()
        if (created && current === created) current = undefined
        activationProblem = (error instanceof Error ? error.message : 'QQ 配置未能激活').slice(0, 500)
        // Keep the native configuration component active so a missing persona/model/credential
        // can be repaired from settings instead of making configEditor reject all later edits.
        return undefined
      }
    }
  })
  let lastConfiguration: { revision: string; settings: QqSettings } | undefined
  const snapshot = async () => {
    let config: { revision: string; settings: QqSettings }
    try {
      config = settings.read()
      lastConfiguration = structuredClone(config)
    } catch (error) {
      return {
        installed: compatibleMember(),
        componentEnabled: false,
        revision: lastConfiguration?.revision ?? '',
        settings: lastConfiguration?.settings ?? { ...DEFAULT_QQ_SETTINGS },
        credentialConfigured: false,
        personas: ctx.pxMemoryChannels.personas(),
        workspaces: [],
        active: 0,
        connection: {
          state: 'error',
          message:
            (error instanceof Error ? error.message : 'QQ 社区成员未就绪') +
            (error instanceof QqError && error.status === 400
              ? '。请打开配置文件修复格式，原配置未覆盖。'
              : lastConfiguration
                ? '。当前暂显示上次读取的配置；重新启用后会读取实际配置。'
                : '。启用后会显示已保存的配置。')
        }
      }
    }
    const compatible = compatibleMember()
    const componentEnabled = settings.componentEnabled()
    return {
      installed: compatible,
      componentEnabled,
      ...config,
      sessionModelSelection: typeof ctx.get('sessionController')?.selectModelForSession === 'function',
      suggestedWorkspace: join(home, 'im', 'qq'),
      credentialConfigured: !!(
        config.settings.secretRef && (await ctx.credentials.describe(config.settings.secretRef)).configured
      ),
      personas: ctx.pxMemoryChannels.personas(),
      workspaces: (ctx.get('workspaceRegistry')?.list() ?? []).map((w: any) => ({ id: w.id, path: w.path })),
      active: busyAgents(config.settings.accountId).length,
      pendingInteractions: current?.pendingInteractions() ?? [],
      connection: !componentEnabled
        ? { state: 'offline', message: 'QQ 社区组件已停用。请在“插件”页面重新启用配套的 dsh-onebot-qq。' }
        : compatible
          ? (current?.snapshot() ?? {
              state: activationProblem ? 'error' : 'offline',
              message:
                activationProblem ??
                (config.settings.enabled ? 'QQ 连接正在准备，或依赖尚未就绪' : '未开启 QQ 接入')
            })
          : {
              state: 'error',
              message: '未找到配套的 QQ 兼容成员。已保留你自行安装的版本，请按使用文档选择兼容版本后再启用。'
            }
    }
  }
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-px-qq',
        handler: async (request: any, response: any) => {
          if (rejectUnauthenticatedRequest(request, response, ctx.connection)) return
          const send = (status: number, value: unknown) => {
            response.writeHead(status, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store'
            })
            response.end(JSON.stringify(value))
          }
          try {
            if (request.method === 'GET') return send(200, await snapshot())
            if (request.method !== 'POST') return send(405, { error: 'Method not allowed' })
            const chunks: Buffer[] = []
            let length = 0
            for await (const chunk of request) {
              const bytes = Buffer.from(chunk)
              if ((length += bytes.length) > 64000) throw new QqError('设置内容过大', 413)
              chunks.push(bytes)
            }
            let input: any
            try {
              input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            } catch {
              throw new QqError('请求格式无效')
            }
            const state = settings.read()
            if (input.action === 'answer-interaction') {
              if (!current) throw new QqError('QQ 接入未开启', 409)
              return send(200, { message: current.answerInteraction(input) })
            }
            if (input.action === 'model-catalog')
              return send(200, await ctx.get('sessionController').modelCatalog())
            if (input.action === 'create-persona')
              return send(200, ctx.pxMemoryChannels.createPersona(input.name))
            if (input.action === 'save') {
              if (!settings.componentEnabled())
                throw new QqError('请先在插件页面重新启用 QQ 社区组件，再修改其连接配置', 409)
              if (!compatibleMember())
                throw new QqError('请先安装配套的 QQ 兼容成员，未修改已有插件配置', 409)
              if (busyAgents(state.settings.accountId).length)
                throw new QqError('QQ 会话仍有任务，请先等待完成或点击“停止当前任务”后再保存', 409)
              if (input.revision !== state.revision) throw new QqError('设置已变化，请刷新后重试', 409)
              const ref = state.settings.secretRef
              const next = parseQqSettings({
                ...input.settings,
                enabled: false,
                secretRef: ref
              })
              if (
                input.secret !== undefined &&
                (typeof input.secret !== 'string' ||
                  !input.secret ||
                  input.secret.length > 4096 ||
                  /[\r\n]/.test(input.secret))
              )
                throw new QqError('令牌格式无效')
              if (input.secret) {
                next.secretRef = 'PX_QQ_ONEBOT_' + randomUUID().replaceAll('-', '_')
              }
              next.enabled = input.settings.enabled
              const clean = parseQqSettings(next)
              if (
                clean.enabled &&
                !ctx.pxMemoryChannels.personas().some((p: any) => p.id === clean.personaId)
              )
                throw new QqError('所选人格已不可用，请重新选择')
              if (clean.enabled && clean.model) await ctx.get('llm').resolveCallConfig(clean.model)
              if (input.secret) await ctx.credentials.set(clean.secretRef, input.secret)
              await settings.save(state.revision, clean)
              return send(200, await snapshot())
            }
            if (input.action === 'test-connection') {
              const token = (await ctx.credentials.resolve(state.settings.secretRef))?.value
              const result = await inspectOneBot(state.settings.endpoint, token ?? '')
              if (result.accountId !== state.settings.accountId)
                throw new QqError('连接成功，但登录账号与填写的 QQ 号不一致', 409)
              return send(200, { ...result, message: 'QQ 账号核对通过' })
            }
            if (input.action === 'send-test') {
              if (!current) throw new QqError('请先开启 QQ 接入', 409)
              await current.sendTest()
              return send(200, { message: '已向第一位授权成员的私聊发送连接测试消息' })
            }
            if (input.action === 'retry-persistence') {
              if (!current) throw new QqError('QQ 接入未开启', 409)
              await current.retryPersistence()
              return send(200, {
                message: '接续记录已保存。未受理的消息请重新发送；已执行的任务不会自动重跑。'
              })
            }
            if (input.action === 'stop') {
              for (const agent of busyAgents(state.settings.accountId)) agent.cancel({ kind: 'user' })
              return send(200, { message: '已请求停止 QQ 会话的当前回合；后台任务仍按 DSH 原生规则处理' })
            }
            throw new QqError('未知操作')
          } catch (error) {
            send(error instanceof QqError ? error.status : 503, {
              error: error instanceof Error ? error.message : 'QQ 操作未完成'
            })
          }
        }
      }),
    'qq: authenticated configuration'
  )
}
