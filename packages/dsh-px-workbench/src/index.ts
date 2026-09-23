import { rejectUntrustedRequest } from '../../shared/request-trust'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { HostPluginContext, HostResponse } from '@deepseek-ai/cordis'
import { localStatus } from './status'
import { checkWebAccess, type FetchPage, type NetworkCheck } from './network'

export const name = 'dsh-px-workbench'
export const inject: string[] = []
export const DEFAULTS = { routePrefix: '/dsh-px-workbench' }

function json(res: HostResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function apply(ctx: HostPluginContext): void {
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
  ctx.inject(['webServer', 'workspaceController'], (ctx) => {
    if (!ctx.webServer) return
    const dispose = [
      ctx.webServer.register({
        kind: 'exact',
        path: `${DEFAULTS.routePrefix}/status`,
        handler: (req, res) => {
          if (rejectUntrustedRequest(req, res)) return
          if (req.method !== 'GET') return json(res, 405, { error: '请使用 GET' })
          json(res, 200, localStatus())
        }
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${DEFAULTS.routePrefix}/restart`,
        handler: (req, res) => {
          if (rejectUntrustedRequest(req, res)) return
          if (req.method !== 'POST') return json(res, 405, { error: '请使用 POST' })
          if (req.headers?.['x-dsh-px-request'] !== '1')
            return json(res, 403, { error: '请从本机工作台提交请求' })
          if (!localStatus().canRestart)
            return json(res, 409, { error: '桌面服务未就绪或正在重启，请在桌面窗口重试。' })
          try {
            const dir = join(process.env.DSH_PX_USER_DATA!, 'update-bridge')
            mkdirSync(dir, { recursive: true })
            const dest = join(dir, 'restart.req')
            writeFileSync(dest + '.tmp', new Date().toISOString())
            renameSync(dest + '.tmp', dest)
            json(res, 202, { message: '已提交重启请求；桌面窗口将重新连接。' })
          } catch {
            json(res, 503, { error: '无法提交重启请求，请通过桌面托盘重试。' })
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
          const controller = (
            ctx as HostPluginContext & {
              workspaceController?: { create: (request: { path: string }) => Promise<{ created: boolean }> }
            }
          ).workspaceController
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
