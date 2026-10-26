/// <reference path="./modules.d.ts" />
import { randomUUID } from 'node:crypto'
import { localEndpoint, QqError } from './policy'

/** A bounded read-only probe. Real message execution remains in the community transport. */
export async function inspectOneBot(endpoint: string, token: string, signal?: AbortSignal, factory?: any) {
  const WebSocket = factory ?? (await import('ws')).default
  const url = localEndpoint(endpoint)
  if (!token || token.length > 4096) throw new QqError('请先配置有效的 OneBot 令牌')
  return new Promise<{ accountId: string; nickname: string }>((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: { Authorization: 'Bearer ' + token },
      maxPayload: 1024 * 1024
    })
    const echo = randomUUID(),
      statusEcho = randomUUID()
    let identity: { accountId: string; nickname: string } | undefined,
      online = false
    let settled = false
    const finish = (error?: Error, value?: { accountId: string; nickname: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      socket.removeAllListeners()
      socket.on('error', () => {})
      socket.terminate()
      error ? reject(error) : resolve(value!)
    }
    const abort = () => finish(new QqError('连接检查已取消', 409))
    const timer = setTimeout(() => finish(new QqError('连接检查超时，请确认 QQ 桥已启动并登录', 503)), 10000)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    socket.on('open', () => {
      socket.send(JSON.stringify({ action: 'get_login_info', params: {}, echo }))
      socket.send(JSON.stringify({ action: 'get_status', params: {}, echo: statusEcho }))
    })
    socket.on('error', () => finish(new QqError('无法连接本机 OneBot，请检查地址、端口和令牌', 503)))
    socket.on('close', () => finish(new QqError('OneBot 在检查期间断开，请重试', 503)))
    socket.on('message', (raw: any) => {
      let reply: any
      try {
        reply = JSON.parse(String(raw))
      } catch {
        return
      }
      if (reply.echo === statusEcho) {
        if (reply.status !== 'ok' || reply.data?.online !== true || reply.data?.good === false)
          return finish(new QqError('QQ 桥可连接，但 QQ 账号不在线，请在桥接界面完成登录', 503))
        online = true
        if (identity) finish(undefined, identity)
        return
      }
      if (reply.echo !== echo) return
      const accountId = String(reply.data?.user_id ?? '')
      if (reply.status !== 'ok' || !/^[1-9]\d{4,19}$/.test(accountId)) {
        finish(new QqError('QQ 尚未完成登录，或接口返回了无效账号', 503))
        return
      }
      identity = { accountId, nickname: String(reply.data?.nickname ?? '').slice(0, 100) }
      if (online) finish(undefined, identity)
    })
  })
}
