import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NetworkStatus } from '../shared/network-status'

const proxyNames = ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']
export interface WindowsProxy { enabled: boolean, server: string, pac: boolean }
export interface ProxySelection { additions: Record<string, string>, status: NetworkStatus }

/** Only user-owned startup settings are inspected; project .env files never choose a proxy. */
export function homeHasProxy (content: string): boolean {
  return content.split(/\r?\n/).some(line => {
    const match = /^\s*(?:export\s+)?(https?_proxy|all_proxy)\s*=\s*(.*?)\s*$/i.exec(line)
    if (!match) return false
    const value = match[2].replace(/\s+#.*$/, '').trim()
    return value !== '' && !value.startsWith('#') && value !== "''" && value !== '""'
  })
}
function localProxyUrl (value: string): string | null {
  try {
    const url = new URL(value.includes('://') ? value : 'http://' + value)
    // This release automatically inherits only an already configured local HTTP(S) proxy.
    // Remote, authenticated, SOCKS and PAC proxies remain explicit DSH environment configuration.
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port === '0' || !/:\d+(?:\/)?$/.test(value)) return null
    if (!['localhost', '[::1]'].includes(url.hostname) && !/^127(?:\.\d{1,3}){3}$/.test(url.hostname)) return null
    return url.origin
  } catch { return null }
}
export function selectProxy (env: NodeJS.ProcessEnv, homeEnv: string, system: WindowsProxy | null, platform = process.platform): ProxySelection {
  const status = (source: NetworkStatus['source'], message: string, additions: Record<string, string> = {}): ProxySelection => ({
    additions, status: { source, message, checkedAt: new Date().toISOString(), protocols: Object.keys(additions).map(k => k === 'HTTP_PROXY' ? 'HTTP' : 'HTTPS') }
  })
  if (proxyNames.some(name => Boolean(env[name]?.trim()))) return status('environment', '沿用启动环境中的显式代理配置。')
  if (homeHasProxy(homeEnv)) return status('home-env', '沿用 DSH 数据目录 .env 中的显式代理配置。')
  if (env.DSH_PX_SYSTEM_PROXY === '0') return status('disabled', '已关闭系统代理自动接入；未改动显式代理设置。')
  if (platform !== 'win32') return status('direct', '未注入系统代理；沿用 DSH 网络策略。')
  if (!system) return status('unavailable', '未能读取 Windows 代理设置；可用 DSH 数据目录 .env 配置 HTTP_PROXY / HTTPS_PROXY。')
  if (system.pac) return status('unsupported', '检测到 PAC 自动代理，本版不转换 PAC 规则；请显式配置 DSH 的 HTTP(S) 代理。')
  if (!system.enabled || !system.server.trim()) return status('direct', 'Windows 未启用静态代理；未注入代理环境变量。')
  const parts = system.server.split(';').map(s => s.trim()).filter(Boolean)
  const additions: Record<string, string> = {}
  if (parts.length === 1 && !parts[0].includes('=')) {
    const url = localProxyUrl(parts[0])
    if (url) { additions.HTTP_PROXY = url; additions.HTTPS_PROXY = url }
  } else {
    for (const part of parts) {
      const match = /^(http|https)=(.+)$/i.exec(part)
      if (!match) continue
      const url = localProxyUrl(match[2])
      if (!url) return status('unsupported', '系统代理包含无法自动接入的地址，请显式配置 DSH 的 HTTP(S) 代理。')
      additions[match[1].toUpperCase() + '_PROXY'] = url
    }
    // A partial protocol map would acquire DSH's HTTPS-to-HTTP fallback, changing Windows semantics.
    if (!additions.HTTP_PROXY || !additions.HTTPS_PROXY) return status('unsupported', '系统代理按协议配置不完整，本版不推断其他协议，请显式配置 DSH 代理。')
  }
  if (!Object.keys(additions).length) return status('unsupported', '系统代理不是可自动接入的本机 HTTP(S) 地址；请显式配置 DSH 代理。')
  return status('system', '已接入 Windows 中配置的本机 HTTP(S) 代理。仅继承代理地址；保留显式 NO_PROXY，回环地址由 DSH 保持直连。Windows 高级绕过通配符不转换。', additions)
}
async function registryValue (name: string): Promise<string | null> {
  return await new Promise((resolve) => {
    execFile('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', name],
      { encoding: 'utf8', windowsHide: true, timeout: 2500, maxBuffer: 16384 }, (error, stdout) => {
        if (error) return resolve(null)
        const match = new RegExp('^\\s*' + name + '\\s+REG_\\w+\\s+(.*)$', 'm').exec(stdout)
        resolve(match?.[1].trim() ?? null)
      })
  })
}
export async function resolveHarnessProxy (home: string, env = process.env): Promise<ProxySelection> {
  let homeEnv: string
  try { homeEnv = await readFile(join(home, '.env'), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { additions: {}, status: { source: 'unavailable', checkedAt: new Date().toISOString(), protocols: [], message: '无法核对 DSH .env，未自动覆盖代理配置。请检查目录权限。' } }
    homeEnv = ''
  }
  // Do not read OS settings when the user explicitly selected the proxy policy.
  if (proxyNames.some(name => Boolean(env[name]?.trim())) || homeHasProxy(homeEnv) || env.DSH_PX_SYSTEM_PROXY === '0' || process.platform !== 'win32') return selectProxy(env, homeEnv, null)
  const [enabled, server, pac] = await Promise.all(['ProxyEnable', 'ProxyServer', 'AutoConfigURL'].map(registryValue))
  return selectProxy(env, homeEnv, enabled === null ? null : { enabled: Number(enabled) === 1, server: server ?? '', pac: Boolean(pac) })
}
