export interface FetchResult {
  statusCode: number
  body: { content: string }
  truncated: boolean
}
export type FetchPage = (request: { url: string }, signal?: AbortSignal) => Promise<FetchResult>
export interface NetworkCheck {
  checkedAt: string
  checks: {
    url: string
    ok: boolean
    status: number | null
    chars: number
    truncated: boolean
    message: string
  }[]
}
const targets = ['https://nodejs.org/api/test.html', 'https://www.typescriptlang.org/docs/']
function explanation(error: unknown): string {
  const code = (error as { code?: string })?.code
  if (code === 'WEB_BLOCKED_URL') return '公开页面的地址被网络策略拒绝。请检查代理来源；不要关闭地址保护。'
  if (code === 'WEB_ABORTED' || code === 'WEB_FETCH_TIMEOUT' || (error as Error)?.name === 'TimeoutError')
    return '读取超时，请检查本机代理是否运行。'
  if (code?.startsWith('WEB_PROVIDER')) return '网页读取服务不可用，请检查当前 DSH 组合。'
  return '网页读取失败，请检查代理连接与服务日志。'
}
/** Fixed public targets, through the exact ctx.web provider used by the Agent; no alternate downloader. */
export async function checkWebAccess(fetchPage: FetchPage): Promise<NetworkCheck> {
  return {
    checkedAt: new Date().toISOString(),
    checks: await Promise.all(
      targets.map(async (url) => {
        try {
          const result = await fetchPage({ url }, AbortSignal.timeout(10000))
          const ok = result.statusCode >= 200 && result.statusCode < 300 && result.body.content.length > 0
          return {
            url,
            ok,
            status: result.statusCode,
            chars: result.body.content.length,
            truncated: result.truncated,
            message: ok ? '网页正文读取成功' : `服务返回 HTTP ${result.statusCode}，尚未取得可用正文`
          }
        } catch (error) {
          return { url, ok: false, status: null, chars: 0, truncated: false, message: explanation(error) }
        }
      })
    )
  }
}
