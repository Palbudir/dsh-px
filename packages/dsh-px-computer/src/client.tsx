import { useEffect, useState } from 'react'
import { createNativeSidebar } from '../../shared/native-sidebar'
import { installUiStyles, controlStyle, cardStyle } from '../../shared/ui'
import { requestJson } from '../../shared/client-http'
import type { ComputerSettings } from './settings'
import type { ActivityEntry } from './runtime'
import type { AccessPolicy } from './authorization'

export const inject: string[] = []

interface View {
  settings: ComputerSettings
  session: {
    policy?: AccessPolicy
    observedApps?: Array<{ key: string; label: string }>
    observedSites?: string[]
    paused: boolean
    apps: Array<{ key: string; label: string }>
    foreground?: Array<{ key: string; label: string }>
    sites: string[]
    log: ActivityEntry[]
  }
  status: {
    driverLoaded: boolean
    browserOpen: boolean
    browserHeldElsewhere: boolean
    edgeExtension: boolean
    platform: string
  }
}

const BROWSER_LABEL: Record<string, string> = {
  off: '关闭',
  isolated: '独立浏览器（不保存登录）',
  profile: 'PX 专用浏览器（保存在其中的登录）',
  extension: '接管我的 Edge（需 Playwright 扩展）'
}
const OUTCOME: Record<ActivityEntry['outcome'], string> = {
  ok: '工具已返回',
  error: '失败',
  denied: '已拦截',
  rejected: '未获允许'
}
const EXTENSION_URL = 'https://microsoftedge.microsoft.com/addons/search/playwright%20extension'

function time(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
}

function ComputerPanel({ sessionId, visible }: { sessionId: string; visible: boolean }): unknown {
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const url = `/dsh-px-computer?sessionId=${encodeURIComponent(sessionId)}`
  useEffect(() => {
    if (!visible) return
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const data = await requestJson<View>(url, { signal: ac.signal })
        if (!ac.signal.aborted) {
          setView(data)
          setError('')
        }
      } catch (e: any) {
        if (!ac.signal.aborted) setError(String(e.message))
      }
      if (!ac.signal.aborted) timer = setTimeout(() => void refresh(), 2500)
    }
    void refresh()
    return () => {
      ac.abort()
      clearTimeout(timer)
    }
  }, [url, visible])
  const act = async (action: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setView(
        await requestJson<View>(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...action, revision: view?.settings.revision })
        })
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const s = view?.settings
  const supported = view?.status.platform === 'win32'
  const apps = view?.session.observedApps ?? view?.session.apps ?? []
  const sites = view?.session.observedSites ?? view?.session.sites ?? []
  return (
    <div
      className="px-ui"
      style={{ padding: 16, height: '100%', overflow: 'auto', overflowWrap: 'anywhere', fontSize: 13 }}
    >
      <h3>电脑操作</h3>
      <p className="px-muted">
        开启后，agent
        可以在你授权的范围内查看并操作本机应用和网页。普通访问遵循会话权限：完全权限直接执行，其余模式首次确认；删除、发送、付款等动作仍需单独确认。终端、密码管理器、安全软件、远程控制软件和
        DSH 本身始终不能操作。
      </p>
      {error && <p role="alert">{error}</p>}
      {!view && !error && <p>正在读取…</p>}
      {view && !supported && <p className="px-empty">电脑操作目前只支持 Windows。</p>}
      {view && s && supported && (
        <>
          <div style={{ ...cardStyle, margin: '12px 0' }}>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <input
                type="checkbox"
                disabled={busy}
                checked={s.desktop}
                onChange={(e: any) => void act({ action: 'settings', desktop: e.target.checked })}
              />{' '}
              操作桌面应用
            </label>
            {s.desktop && (
              <label style={{ display: 'block', margin: '8px 0 12px' }}>
                桌面操作方式
                <select
                  aria-label="桌面操作方式"
                  style={{ ...controlStyle, width: '100%', marginTop: 6 }}
                  disabled={busy}
                  value={s.desktopForeground ? 'ask' : 'background'}
                  onChange={(e: any) =>
                    void act({ action: 'settings', desktopForeground: e.target.value === 'ask' })
                  }
                >
                  <option value="background">仅后台操作</option>
                  <option value="ask">允许前台操作（遵循会话权限）</option>
                </select>
                <small className="px-muted">
                  完全权限会话直接控制窗口，其余模式每个窗口首次确认。暂停会中止控制；后台模式不会自动抢占前台。
                </small>
              </label>
            )}
            {s.desktop && (
              <label style={{ display: 'block', marginTop: 8 }}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={s.independentInstances === true}
                  onChange={(e: any) =>
                    void act({ action: 'settings', independentInstances: e.target.checked })
                  }
                />{' '}
                允许独立应用输入桥（需应用另行支持）
                <span className="px-muted" style={{ display: 'block', marginTop: 4 }}>
                  使用应用内虚拟输入，不移动你的鼠标。普通窗口不会因此获得后台输入能力；当前适配 Minecraft
                  26.3 的独立 Fabric 实例。
                </span>
              </label>
            )}
            <label style={{ display: 'block' }}>
              浏览器
              <select
                aria-label="浏览器模式"
                style={{ ...controlStyle, width: '100%', marginTop: 6 }}
                disabled={busy}
                value={s.browser}
                onChange={(e: any) => void act({ action: 'settings', browser: e.target.value })}
              >
                {Object.entries(BROWSER_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {s.browser !== 'off' && s.browser !== 'extension' && (
              <label style={{ display: 'block', marginTop: 8 }}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={s.headless}
                  onChange={(e: any) => void act({ action: 'settings', headless: e.target.checked })}
                />{' '}
                后台运行浏览器（不显示窗口）
              </label>
            )}
            {s.browser === 'isolated' && (
              <p className="px-muted">
                每个会话使用自己的临时浏览器实例，与日常浏览器的标签和登录分开。后台运行时不显示窗口，也不占用系统鼠标。
              </p>
            )}
            {s.browser === 'extension' && (
              <p className="px-muted">
                {view.status.edgeExtension
                  ? '已检测到 Playwright 扩展。每次连接时 Edge 会打开确认页，由你选择共享哪个标签页。'
                  : '尚未在 Edge 中检测到 Playwright 扩展。请先从 Edge 扩展商店安装 “Playwright Extension”，安装由你自己完成。'}{' '}
                {!view.status.edgeExtension && (
                  <a href={EXTENSION_URL} target="_blank" rel="noreferrer">
                    打开扩展商店
                  </a>
                )}
              </p>
            )}
            {s.browser !== 'off' && s.browser !== 'isolated' && (
              <p className="px-muted">
                这个模式包含登录状态：完全权限会话直接访问，其余模式首次访问网站前询问。
              </p>
            )}
          </div>

          <div className="px-actions">
            {view.session.paused ? (
              <button
                className="px-primary"
                style={controlStyle}
                disabled={busy}
                onClick={() => void act({ action: 'resume' })}
              >
                恢复本会话的电脑操作
              </button>
            ) : (
              <button
                className="px-danger"
                style={controlStyle}
                disabled={busy || (!s.desktop && s.browser === 'off')}
                onClick={() => void act({ action: 'pause' })}
              >
                停止并暂停本会话
              </button>
            )}
            {view.status.browserHeldElsewhere && (
              <button
                style={controlStyle}
                disabled={busy}
                onClick={() => void act({ action: 'release-browser' })}
              >
                释放被其他会话占用的浏览器
              </button>
            )}
          </div>
          {view.session.paused && <p role="status">已暂停：agent 在本会话中的电脑和浏览器操作都会被拒绝。</p>}
          {!!view.session.foreground?.length && (
            <div className="px-card">
              <strong>本会话可前台控制的窗口</strong>
              <ul>
                {view.session.foreground.map((window) => (
                  <li key={window.key}>{window.label}</li>
                ))}
              </ul>
              <button
                style={controlStyle}
                disabled={busy}
                onClick={() => void act({ action: 'revoke-window-control' })}
              >
                停止并撤销窗口控制
              </button>
            </div>
          )}

          {view.session.policy === 'full' && (
            <p role="status">
              本会话为完全权限：已开启能力内的普通操作直接执行，无需设置始终允许。敏感动作仍单独确认。
            </p>
          )}
          {view.session.policy === 'never' && (
            <p role="status">
              本会话关闭了确认提示，但不是完全权限。请在下方授权应用或网站；需要窗口控制或敏感动作确认时，先切换到“工作区内修改”等可询问模式。
            </p>
          )}
          {(apps.length > 0 || sites.length > 0) && (
            <details style={{ ...cardStyle, margin: '12px 0' }} open>
              <summary>应用与网站授权</summary>
              <p className="px-muted">
                这里列出本会话已识别的目标；未获允许的目标也可直接授权。设置后让 Agent
                重试，不会自动重放之前的动作。
              </p>
              {apps.map((app) => (
                <div key={app.key} className="px-actions">
                  <span style={{ flex: 1 }}>{app.label}</span>
                  {view.session.policy === 'full' && <span className="px-muted">随完全权限允许</span>}
                  {view.session.policy !== 'full' &&
                    !s.alwaysAllowApps.some((a) => a.key === app.key) &&
                    (view.session.apps.some((a) => a.key === app.key) ? (
                      <span className="px-muted">本会话已允许</span>
                    ) : (
                      <button
                        style={controlStyle}
                        disabled={busy || view.session.paused || !s.desktop}
                        onClick={() => void act({ action: 'allow-app', key: app.key })}
                      >
                        本会话允许
                      </button>
                    ))}
                  {s.alwaysAllowApps.some((a) => a.key === app.key) ? (
                    <span className="px-muted">始终允许</span>
                  ) : view.session.policy !== 'full' ? (
                    <button
                      style={controlStyle}
                      disabled={busy || view.session.paused || !s.desktop}
                      onClick={() => void act({ action: 'always-allow-app', key: app.key, label: app.label })}
                    >
                      设为始终允许
                    </button>
                  ) : null}
                </div>
              ))}
              {sites.map((site) => (
                <div key={site} className="px-actions">
                  <span style={{ flex: 1 }}>{site}</span>
                  {view.session.policy === 'full' && <span className="px-muted">随完全权限允许</span>}
                  {view.session.policy !== 'full' &&
                    !s.alwaysAllowSites.includes(site) &&
                    (view.session.sites.includes(site) ? (
                      <span className="px-muted">本会话已允许</span>
                    ) : (
                      <button
                        style={controlStyle}
                        disabled={busy || view.session.paused || s.browser === 'off'}
                        onClick={() => void act({ action: 'allow-site', site })}
                      >
                        本会话允许
                      </button>
                    ))}
                  {s.alwaysAllowSites.includes(site) ? (
                    <span className="px-muted">始终允许</span>
                  ) : view.session.policy !== 'full' ? (
                    <button
                      style={controlStyle}
                      disabled={busy || view.session.paused || s.browser === 'off'}
                      onClick={() => void act({ action: 'always-allow-site', site })}
                    >
                      设为始终允许
                    </button>
                  ) : null}
                </div>
              ))}
            </details>
          )}

          {(s.alwaysAllowApps.length > 0 || s.alwaysAllowSites.length > 0) && (
            <details style={{ ...cardStyle, margin: '12px 0' }}>
              <summary>始终允许（所有会话）</summary>
              {s.alwaysAllowApps.map((app) => (
                <div key={app.key} className="px-actions">
                  <span style={{ flex: 1 }}>{app.label}</span>
                  <button
                    style={controlStyle}
                    disabled={busy}
                    onClick={() => void act({ action: 'forget-app', key: app.key })}
                  >
                    撤销
                  </button>
                </div>
              ))}
              {s.alwaysAllowSites.map((site) => (
                <div key={site} className="px-actions">
                  <span style={{ flex: 1 }}>{site}</span>
                  <button
                    style={controlStyle}
                    disabled={busy}
                    onClick={() => void act({ action: 'forget-site', site })}
                  >
                    撤销
                  </button>
                </div>
              ))}
            </details>
          )}

          <h4>操作记录</h4>
          {view.session.log.length === 0 ? (
            <p className="px-empty">本会话还没有电脑操作。</p>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {view.session.log.map((entry, index) => (
                <li
                  key={`${entry.at}-${index}`}
                  style={{ borderBottom: '1px solid var(--px-border)', padding: '6px 0' }}
                >
                  <div className="px-actions" style={{ margin: 0 }}>
                    <span className="px-muted">{time(entry.at)}</span>
                    <code>{entry.tool}</code>
                    <span className={entry.outcome === 'ok' ? 'px-muted' : 'px-danger'}>
                      {OUTCOME[entry.outcome]}
                    </span>
                  </div>
                  <div>{entry.target}</div>
                  {entry.detail && <div className="px-muted">{entry.detail}</div>}
                  {entry.message && <div className="px-muted">{entry.message}</div>}
                </li>
              ))}
            </ol>
          )}
          <p className="px-muted">记录只保存在本次运行中，最多 200 条；确认与拒绝也写入会话日志。</p>
        </>
      )}
    </div>
  )
}

export function apply(ctx: any): void {
  installUiStyles(ctx)
  ctx.inject(['sidebarRight', 'sidebarRightTabs', 'slots'], (host: any) =>
    host.effect(
      () =>
        createNativeSidebar(host).registerTab({
          id: 'dsh-px-computer',
          title: '电脑操作',
          order: 18,
          component: ({ scope, visible }) => (
            <ComputerPanel key={scope.sessionId} sessionId={scope.sessionId} visible={visible} />
          )
        }),
      'computer: panel'
    )
  )
}
