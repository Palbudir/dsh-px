import { join } from 'node:path'
import { rejectUnauthenticatedRequest } from '../../shared/request-trust'
import { readJsonBody } from './http'
import { NativeChannelSettings, ChannelError } from './channel-settings'
import { FeishuChannel } from './feishu-channel'

/** Optional channel services never prevent the workbench's file/context/diagnostic services from loading. */
export function registerChannels(ctx: any): void {
  const runtimes = new Map<string, FeishuChannel>(),
    failures = new Map<string, string>()
  let settings: NativeChannelSettings | undefined,
    available = false,
    im: any,
    memory: any
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
      'sessionController',
      'workspaceController',
      'workspaceRegistry'
    ],
    async (host: any) => {
      const ownSettings = new NativeChannelSettings(host.configEditor),
        owned: FeishuChannel[] = []
      im = host.dshIm
      memory = host.pxMemoryChannels
      available = true
      const preset = await host.agentPresets.register({
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
      host.effect(
        () => async () => {
          available = false
          const settled = await Promise.allSettled(
            owned.map(async (runtime) => {
              await runtime.dispose()
              if (runtimes.get(runtime.accountId) === runtime) runtimes.delete(runtime.accountId)
            })
          )
          if (typeof preset === 'function') await preset()
          if (im === host.dshIm) {
            im = undefined
            memory = undefined
          }
          if (settled.some((row) => row.status === 'rejected'))
            throw new ChannelError('部分渠道尚未完成停止', 503)
        },
        'channels: native consumer and Agent ownership'
      )
      try {
        const home = process.env.DSH_HOME
        if (!home) throw new ChannelError('DSH_HOME 未设置')
        await Promise.allSettled(
          ownSettings
            .read()
            .configuration.accounts.filter((row) => row.enabled)
            .map(async (account) => {
              let runtime: FeishuChannel | undefined
              try {
                runtime = new FeishuChannel(
                  host,
                  account,
                  () =>
                    ownSettings
                      .read()
                      .configuration.accounts.find((row) => row.accountId === account.accountId),
                  join(home, 'storages', 'dsh-px-channels')
                )
                owned.push(runtime)
                runtimes.set(account.accountId, runtime)
                await runtime.start()
                failures.delete(account.accountId)
              } catch (error) {
                failures.set(account.accountId, error instanceof Error ? error.message : '渠道接收未启动')
                if (runtime) {
                  try {
                    await runtime.dispose()
                    runtimes.delete(account.accountId)
                  } catch {}
                }
              }
            })
        )
      } catch (error) {
        failures.set('configuration', String(error))
      }
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
              if (req.method === 'GET')
                return send(res, 200, {
                  ...settings.read(),
                  available,
                  personas: memory?.personas() ?? [],
                  accounts: im ? await im.listBots() : [],
                  runtimes: [...runtimes.values()].map((runtime) => runtime.status()),
                  failures: [...failures].map(([id, error]) => ({ id, error }))
                })
              if (req.method !== 'POST') return send(res, 405, { error: '请使用 GET 或 POST' })
              if (req.headers['x-dsh-px-request'] !== '1') throw new ChannelError('请从本机渠道页面提交', 403)
              const body = await readJsonBody(req)
              if (body.type === 'save')
                return send(res, 200, await settings.save(body.revision, body.configuration))
              if (body.type === 'stop') {
                if (typeof body.accountId !== 'string') throw new ChannelError('账号无效')
                const runtime = runtimes.get(body.accountId)
                if (runtime) {
                  await runtime.dispose()
                  runtimes.delete(body.accountId)
                }
                return send(res, 200, { stopped: true, persistent: false })
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
