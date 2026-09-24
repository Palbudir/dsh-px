import { rejectUntrustedRequest } from '../../shared/request-trust'
import { isAbsolute } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { HostPluginContext, HostResponse } from '@deepseek-ai/cordis'
import { localStatus } from './status'
import { checkWebAccess, type FetchPage, type NetworkCheck } from './network'
import { createLayoutStore, LayoutError } from './layout'
import { readJsonBody } from './http'
import { registerActivity } from './activity'
import { requestShellAction, ShellUnavailable } from '../../shared/shell-protocol'

export const name = 'dsh-px-workbench'
export const inject: string[] = []
export const DEFAULTS = { routePrefix: '/dsh-px-workbench' }

function json(res: HostResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function apply(ctx: HostPluginContext): void {
  const activity = registerActivity(ctx)
  let workspaceController:
    { create: (request: { path: string }) => Promise<{ created: boolean }> } | undefined
  ctx.inject(['workspaceController'], (host) => {
    const current = (host as typeof host & { workspaceController: NonNullable<typeof workspaceController> })
      .workspaceController
    workspaceController = current
    host.effect?.(
      () => () => {
        if (workspaceController === current) workspaceController = undefined
      },
      'workbench: workspace capability'
    )
  })
  ctx.inject(['webServer', 'web'], (host) => {
    const web = (host as typeof host & { web?: { fetch: FetchPage } }).web
    if (!host.webServer || !web) return
    let pending: Promise<NetworkCheck> | null = null
    host.effect?.(
      () =>
        host.webServer!.register({
          kind: 'exact',
          path: `${DEFAULTS.routePrefix}/network-check`,
          handler: async (req, res) => {
            if (rejectUntrustedRequest(req, res)) return
            if (req.method !== 'POST') return json(res, 405, { error: '请使用 POST' })
            if (req.headers?.['x-dsh-px-request'] !== '1')
              return json(res, 403, { error: '请从本机工作台提交请求' })
            if (new URL(req.url ?? '/', 'http://127.0.0.1').search)
              return json(res, 400, { error: '网络检查仅使用固定的公开文档地址' })
            pending ??= checkWebAccess((request, signal) => web.fetch(request, signal)).finally(() => {
              pending = null
            })
            json(res, 200, await pending)
          }
        }),
      'dsh-px-workbench: network check'
    )
  })
  ctx.inject(['webServer'], (ctx) => {
    if (!ctx.webServer) return
    const dispose = [
      ctx.webServer.register({
        kind: 'exact',
        path: `${DEFAULTS.routePrefix}/status`,
        handler: (req, res) => {
          if (rejectUntrustedRequest(req, res)) return
          if (req.method !== 'GET') return json(res, 405, { error: '请使用 GET' })
          json(res, 200, localStatus(activity()))
        }
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${DEFAULTS.routePrefix}/restart`,
        handler: async (req, res) => {
          if (rejectUntrustedRequest(req, res)) return
          if (req.method !== 'POST') return json(res, 405, { error: '请使用 POST' })
          if (req.headers?.['x-dsh-px-request'] !== '1')
            return json(res, 403, { error: '请从本机工作台提交请求' })
          if (!localStatus().canRestart)
            return json(res, 409, { error: '桌面服务未就绪或正在重启，请在桌面窗口重试。' })
          try {
            const receipt = await requestShellAction(process.env.DSH_PX_USER_DATA, 'restart')
            json(res, 202, {
              ok: true,
              ...receipt,
              message: '桌面应用已收到重启请求；服务上的所有页面将重新连接。'
            })
          } catch (err) {
            json(res, err instanceof ShellUnavailable ? err.status : 503, {
              error: err instanceof Error ? err.message : '无法提交重启请求，请通过桌面托盘重试。'
            })
          }
        }
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${DEFAULTS.routePrefix}/cancel-pending`,
        handler: async (req, res) => {
          if (rejectUntrustedRequest(req, res)) return
          if (req.method !== 'POST') return json(res, 405, { error: '请使用 POST' })
          if (req.headers?.['x-dsh-px-request'] !== '1')
            return json(res, 403, { error: '请从本机应用提交请求' })
          try {
            json(res, 202, {
              ok: true,
              ...(await requestShellAction(process.env.DSH_PX_USER_DATA, 'cancel-pending'))
            })
          } catch (err) {
            json(res, err instanceof ShellUnavailable ? err.status : 503, {
              error: err instanceof Error ? err.message : '取消请求未完成'
            })
          }
        }
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${DEFAULTS.routePrefix}/layout`,
        handler: async (req, res) => {
          if (rejectUntrustedRequest(req, res)) return
          if (!process.env.DSH_HOME)
            return json(res, 503, { error: '服务未提供数据目录，标签仍可在当前窗口使用。' })
          const store = createLayoutStore(process.env.DSH_HOME)
          try {
            if (req.method === 'GET') return json(res, 200, store.read())
            if (req.method !== 'POST') return json(res, 405, { error: '请使用 GET 或 POST' })
            if (req.headers?.['x-dsh-px-request'] !== '1')
              return json(res, 403, { error: '请从本机页面保存布局' })
            json(res, 200, store.write(await readJsonBody(req as IncomingMessage)))
          } catch (err) {
            json(res, err instanceof LayoutError ? err.status : 400, {
              error: err instanceof Error ? err.message : '布局操作失败'
            })
          }
        }
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${DEFAULTS.routePrefix}/workspace`,
        handler: async (req, res) => {
          if (rejectUntrustedRequest(req, res)) return
          if (req.method !== 'POST') return json(res, 405, { error: '请使用 POST' })
          if (req.headers?.['x-dsh-px-request'] !== '1')
            return json(res, 403, { error: '请从本机工作台提交请求' })
          const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
          const path = params.get('path')?.trim()
          if (!path || path.length > 4096 || params.getAll('path').length !== 1 || !isAbsolute(path)) {
            return json(res, 400, { error: '请输入已存在文件夹的完整路径，例如 C:\\Projects\\demo' })
          }
          const controller = workspaceController
          if (!controller) return json(res, 503, { error: 'DSH 工作区服务未就绪' })
          try {
            const value = await controller.create({ path })
            json(res, 200, {
              message: value.created
                ? '工作区已添加。关闭设置后可在选择工作区菜单中开始会话。'
                : '此工作区已存在。关闭设置后可选择它并开始会话。'
            })
          } catch (err) {
            json(res, 400, {
              error: `无法添加工作区，请确认文件夹存在并可访问：${err instanceof Error ? err.message : String(err)}`
            })
          }
        }
      })
    ]
    ctx.effect?.(() => () => dispose.forEach((fn) => fn()), 'dsh-px-workbench: routes')
  })
}
