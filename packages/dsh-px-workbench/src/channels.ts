import { ChannelSupervisor } from '../../shared/channel-supervisor'
import { join } from 'node:path'
import { rejectUnauthenticatedRequest } from '../../shared/request-trust'
import { readJsonBody } from './http'
import { NativeChannelSettings, ChannelError, type ChannelAccount } from './channel-settings'
import { FeishuChannel } from './feishu-channel'
import { CHANNEL_CONVERSATION_TOOLS } from '../../shared/channel-source'

/** Optional channel services never prevent the workbench's file/context/diagnostic services from loading. */
export function registerChannels(ctx: any): void {
  ctx.inject(['pxAudiencePolicies'], (host: any) =>
    host.effect(
      () =>
        host.pxAudiencePolicies.register('feishu', {
          section: 'px-channel-public-persona',
          check: (exec: any, binding: any) => {
            if (binding.channel.task) return '此渠道的任务授权尚未就绪，未执行本机操作'
            if (!CHANNEL_CONVERSATION_TOOLS.includes(exec.name))
              return '公共渠道会话没有本机执行或私有信息权限'
          }
        }),
      'channels: public execution policy'
    )
  )
  const runtimes = new Map<string, FeishuChannel>(),
    failures = new Map<string, string>()
  let settings: NativeChannelSettings | undefined,
    available = false,
    im: any,
    memory: any
  let supervisor: ChannelSupervisor<ChannelAccount, FeishuChannel> | undefined,
    synchronise: (() => void) | undefined
  ctx.on('px/channels-settings', () => synchronise?.())
  ctx.provide('pxChannels', {
    version: 1,
    tool: (name: string, args: any, exec: any) => {
      const runtime = [...runtimes.values()].find((row) => row.owns(exec.agent))
      if (!runtime) throw new ChannelError('此会话的渠道接入未运行', 503)
      return runtime.tool(name, args, exec)
    }
  })
  ctx.inject(['configEditor'], (host: any) => {
    const current = new NativeChannelSettings(host.configEditor)
    settings = current
    host.effect(
      () => () => {
        if (settings === current) settings = undefined
      },
      'channels: native profile configuration'
    )
  })
  ctx.inject(
    [
      'configEditor',
      'dshIm',
      'pxMemoryChannels',
      'pxPersonaResources',
      'agents',
      'agentPresets',
      'agentDefaultModel',
      'sessionProjections',
      'sessions',
      'sessionPersistence',
      'sessionController',
      'workspaceController',
      'workspaceRegistry'
    ],
    async (host: any) => {
      const ownSettings = new NativeChannelSettings(host.configEditor),
        ownIm = host.dshIm
      const home = process.env.DSH_HOME
      if (!home) {
        failures.set('configuration', 'DSH_HOME 未设置')
        return
      }
      im = ownIm
      memory = host.pxMemoryChannels
      let preset: any
      try {
        preset = await host.agentPresets.register({
          id: 'px-channel-public',
          name: '公共渠道交流（渠道管理）',
          description: '由渠道创建，固定人格与聊天受众，普通新会话无需选择。',
          plugins: [
            { id: 'px-channel-audience', name: 'dsh-px-workbench', config: { publicChannel: true } },
            {
              id: 'persona',
              name: '@deepseek-ai/dsh-persona',
              config: { prefix: 'Follow the configured persona and current conversation context.' }
            },
            { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
            { id: 'persona-mail-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
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
      } catch (error) {
        failures.set('preset', String(error))
        return
      }
      const current = new ChannelSupervisor<ChannelAccount, FeishuChannel>(
        runtimes,
        (account) =>
          new FeishuChannel(
            host,
            account,
            () => {
              const latest = ownSettings.read(),
                value = latest.configuration.accounts.find((row) => row.accountId === account.accountId)
              return value && latest.componentEnabled ? value : undefined
            },
            join(home, 'storages', 'dsh-px-channels')
          ),
        (id, error) => failures.set(id, error instanceof Error ? error.message : '渠道操作未完成'),
        (id) => failures.delete(id)
      )
      const sync = () => {
        try {
          const next = ownSettings.read()
          failures.delete('configuration')
          current.update(next.componentEnabled ? next.configuration.accounts : [])
        } catch (error) {
          failures.set('configuration', String(error))
          current.update([])
        }
      }
      supervisor = current
      synchronise = sync
      available = true
      host.effect(
        () => async () => {
          if (supervisor === current) {
            supervisor = undefined
            synchronise = undefined
            available = false
            im = undefined
            memory = undefined
          }
          await current.close()
          if (typeof preset === 'function') await preset()
        },
        'channels: native consumer and Agent ownership'
      )
      sync()
    }
  )
  ctx.inject(['connection', 'webServer'], (host: any) => {
    const send = (res: any, status: number, value: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      })
      res.end(JSON.stringify(value))
    }
    host.effect(
      () =>
        host.webServer.register({
          kind: 'exact',
          path: '/dsh-px-channels',
          handler: async (req: any, res: any) => {
            if (rejectUnauthenticatedRequest(req, res, host.connection)) return
            try {
              if (!settings) throw new ChannelError('原生渠道配置服务尚未就绪', 503)
              if (req.method === 'GET' && new URL(req.url, 'http://127.0.0.1').searchParams.has('describe')) {
                const id = new URL(req.url, 'http://127.0.0.1').searchParams.get('describe')
                if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ChannelError('机器人标识无效')
                if (!im) throw new ChannelError('原生 IM 服务未就绪', 503)
                const description = await im.describeBot(id)
                if (
                  description?.botId !== id ||
                  description.channel !== 'feishu' ||
                  !/^[a-f0-9]{64}$/.test(description.account?.fingerprint ?? '')
                )
                  throw new ChannelError('账号身份无法确认', 409)
                return send(res, 200, {
                  accountId: id,
                  name:
                    typeof description.account.name === 'string'
                      ? description.account.name.slice(0, 200)
                      : id,
                  fingerprint: description.account.fingerprint,
                  connected: description.connected === true,
                  supported:
                    im.pxModeControlVersion === 1 &&
                    description.capabilities?.includes('consumer-mode-control-px1') === true,
                  reception: description.reception ?? null
                })
              }
              if (req.method === 'GET') {
                let accounts: unknown[] = [],
                  discoveryError: string | undefined
                try {
                  accounts = im ? await im.listBots() : []
                } catch (error) {
                  discoveryError = error instanceof Error ? error.message : '无法读取原生账号列表'
                }
                return send(res, 200, {
                  ...settings.read(),
                  available,
                  personas: memory?.personas() ?? [],
                  accounts,
                  discoveryError,
                  runtimes: [...runtimes.values()].map((runtime) => runtime.status()),
                  failures: [...failures].map(([id, error]) => ({ id, error }))
                })
              }
              if (req.method !== 'POST') return send(res, 405, { error: '请使用 GET 或 POST' })
              if (req.headers['x-dsh-px-request'] !== '1') throw new ChannelError('请从本机渠道页面提交', 403)
              const body = await readJsonBody(req)
              if (body.type === 'save') {
                const saved = await settings.save(body.revision, body.configuration)
                synchronise?.()
                return send(res, 200, saved)
              }
              if (body.type === 'stop') {
                if (typeof body.accountId !== 'string') throw new ChannelError('账号无效')
                if (supervisor) await supervisor.pause(body.accountId)
                return send(res, 200, { stopped: true, persistent: false })
              }
              if (body.type === 'retry-account') {
                const snapshot = settings.read()
                if (
                  !supervisor ||
                  !snapshot.componentEnabled ||
                  !snapshot.configuration.accounts.some(
                    (row) => row.accountId === body.accountId && row.enabled
                  )
                )
                  throw new ChannelError('账号接收未启用或服务未就绪', 409)
                supervisor.retry(body.accountId)
                return send(res, 200, { accepted: true })
              }
              if (['reconcile', 'resolve-reply', 'retry'].includes(body.type)) {
                const runtime = runtimes.get(body.accountId)
                if (!runtime) throw new ChannelError('此账号的接收方未运行', 409)
                if (body.type === 'reconcile') void runtime.reconcile()
                else {
                  if (typeof body.id !== 'string' || !body.id || body.id.length > 200)
                    throw new ChannelError('记录标识无效')
                  if (body.type === 'retry') runtime.retry(body.id)
                  else {
                    if (typeof body.revision !== 'string' || !['sent', 'release'].includes(body.decision))
                      throw new ChannelError('回复核对参数无效')
                    runtime.resolveReply(body.id, body.revision, body.decision)
                  }
                }
                return send(res, 200, { accepted: true })
              }
              throw new ChannelError('未知渠道管理操作')
            } catch (error: any) {
              send(res, error instanceof ChannelError ? error.status : 500, {
                error: error?.message ?? '渠道服务不可用'
              })
            }
          }
        }),
      'channels: authenticated settings API'
    )
  })
}
