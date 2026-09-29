import { installUiStyles, controlStyle, cardStyle } from '../../shared/ui'
import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/cordis'
import type { LocalStatus } from './status'
import type { NetworkCheck } from './network'
import { requestJson } from '../../shared/client-http'
import { createCapabilities, pageCarrier } from '../../shared/client-capabilities'

export const inject = ['slots', 'locale']
const prefix = '/dsh-px-workbench'
const button = controlStyle
const card = { ...cardStyle, marginBottom: 12 }
const prompts = [
  {
    title: '熟悉项目',
    text: '先阅读当前工作区的说明和代码，解释项目的用途、运行方式与最值得修复的一个问题。请给出文件依据，这一步先不要修改代码。'
  },
  {
    title: '完成一次修改',
    text: '在当前工作区完成下面的修改：[填写需求]。先读项目约定，说明影响范围，再实现并运行相关验证；最后列出修改文件、验证结果和未解决的问题。'
  },
  {
    title: '验证工具可用',
    text: '在当前工作区创建 agent-smoke.txt，写入 DSH-PX agent smoke OK。必须实际调用文件工具写入，再用 Shell 读取验证，报告实际路径与读取内容。不要修改其他文件。'
  }
]

const dependencyLabels: Record<string, string> = {
  sessions: '会话状态',
  uiWorkspace: '会话与工作区操作',
  conversation: '会话输入与引用',
  betterSidebar: '侧边卡片（文件、产物、批注、定时任务、执行记录）',
  sidebarRight: '原生终端容器'
}
type CapabilityStore = ReturnType<typeof createCapabilities<Record<string, boolean>>>
function Workbench({ capabilities }: { capabilities: CapabilityStore }): unknown {
  const [activated, setActivated] = useState(capabilities.getSnapshot)
  useEffect(() => capabilities.subscribe(() => setActivated(capabilities.getSnapshot())), [capabilities])
  const carrier = pageCarrier((window as unknown as { dshDesktop?: unknown }).dshDesktop)
  const [data, setData] = useState<LocalStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [path, setPath] = useState('')
  const [adding, setAdding] = useState(false)
  const [workspaceMessage, setWorkspaceMessage] = useState('')
  const [networkCheck, setNetworkCheck] = useState<NetworkCheck | null>(null)
  const [networkBusy, setNetworkBusy] = useState(false)
  const [networkError, setNetworkError] = useState('')
  async function checkNetwork(): Promise<void> {
    setNetworkBusy(true)
    setNetworkError('')
    try {
      setNetworkCheck(await requestJson<NetworkCheck>(`${prefix}/network-check`, { method: 'POST' }))
    } catch (err) {
      setNetworkError(err instanceof Error ? err.message : String(err))
    } finally {
      setNetworkBusy(false)
    }
  }
  async function addWorkspace(): Promise<void> {
    setAdding(true)
    setWorkspaceMessage('')
    try {
      const result = await requestJson<{ message: string }>(
        `${prefix}/workspace?path=${encodeURIComponent(path.trim())}`,
        { method: 'POST' }
      )
      setWorkspaceMessage(result.message)
    } catch (err) {
      setWorkspaceMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }
  async function refresh(): Promise<void> {
    setBusy(true)
    try {
      setData(await requestJson<LocalStatus>(`${prefix}/status`))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async (): Promise<void> => {
      try {
        const value = await requestJson<LocalStatus>(`${prefix}/status`)
        if (active) {
          setData(value)
          setError(null)
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err))
      }
      if (active) timer = setTimeout(() => void poll(), 5000)
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [])
  return (
    <div
      className="px-ui"
      style={{ display: 'grid', gap: 16, minWidth: 0, overflowWrap: 'anywhere', paddingBottom: 20 }}
    >
      <div>
        <h2 style={{ margin: '0 0 8px' }}>运行与帮助</h2>
        <p style={{ margin: 0, opacity: 0.7, lineHeight: 1.7 }}>查看当前连接、运行诊断或配置工作区。</p>
      </div>
      <section style={card} aria-label="当前连接">
        <h3 style={{ marginTop: 0 }}>当前连接</h3>
        <p>
          {carrier === 'desktop' ? '桌面窗口' : '浏览器页面'} · {data ? '原生 DSH 服务' : '正在识别服务…'}
        </p>
        <p style={{ fontSize: 13, opacity: 0.75 }}>
          此服务由原生宿主（桌面客户端或 dsh
          web）持有。重启、退出与客户端更新请使用宿主自身的入口；本整合包不控制这些操作，也不据此判断宿主状态。
        </p>
        <p style={{ fontSize: 12, opacity: 0.65 }}>
          会话标签随当前服务保存；未保存的批注和定时草稿只保留在当前窗口，关闭前请保存。
        </p>
        {data?.activity.known ? (
          <p>
            活动：{data.activity.runningAgents} 个 Agent · {data.activity.runningJobs} 个后台任务 ·{' '}
            {data.activity.queuedInputs} 条排队输入 · {data.activity.openTerminals} 项打开的终端资源
          </p>
        ) : (
          <p>任务或终端状态尚未确认；请检查运行诊断及侧栏兼容性，不能据此判断服务空闲。</p>
        )}
      </section>
      <details style={card} open={data ? !data.credentialsFile : false}>
        <summary style={{ cursor: 'pointer' }}>首次配置与添加工作区</summary>
        <section aria-label="开始任务">
          <ol style={{ paddingLeft: 22, lineHeight: 1.9 }}>
            <li>在设置的模型提供商中配置模型和密钥。</li>
            <li>关闭设置，在侧栏添加本机项目文件夹，再新建会话。</li>
            <li>选择标准模式与模型，描述需求；按提示审阅工具权限和修改结果。</li>
          </ol>
          <label htmlFor="dsh-px-workspace" style={{ fontSize: 13 }}>
            本机项目文件夹
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0 16px' }}>
            <input
              id="dsh-px-workspace"
              value={path}
              placeholder="C:\Projects\demo"
              onChange={(e: { target: { value: string } }) => setPath(e.target.value)}
              style={{ ...button, minWidth: 0, flex: '1 1 240px', cursor: 'text' }}
            />
            <button style={button} disabled={adding || !path.trim()} onClick={() => void addWorkspace()}>
              {adding ? '添加中…' : '添加工作区'}
            </button>
          </div>
          {workspaceMessage ? (
            <p role="status" style={{ fontSize: 13 }}>
              {workspaceMessage}
            </p>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {prompts.map((p) => (
              <button
                key={p.title}
                style={button}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(p.text)
                    .then(() => setMessage(`已复制“${p.title}”，粘贴到新会话即可。`))
                    .catch(() => setMessage(`复制失败，请手动复制：${p.text}`))
                }}
              >
                复制：{p.title}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, opacity: 0.65, marginBottom: 0 }}>
            首次验证建议使用空文件夹。模型能否连接以真实任务结果为准。
          </p>
        </section>
      </details>
      <details style={card}>
        <summary style={{ cursor: 'pointer' }}>本机运行诊断</summary>
        <section aria-label="本机运行检查">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <h3>本机运行检查</h3>
            <button style={button} disabled={busy} onClick={() => void refresh()}>
              {busy ? '检查中…' : '重新检查'}
            </button>
          </div>
          {error ? <p role="alert">检查失败：{error}。可重新检查，或通过原生宿主重启服务。</p> : null}
          {!data ? (
            <p>正在读取本机状态…</p>
          ) : (
            <>
              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: '100px minmax(0,1fr)',
                  gap: '10px 12px',
                  fontSize: 13,
                  lineHeight: 1.6
                }}
              >
                <dt>服务标识</dt>
                <dd style={{ margin: 0 }}>{data.serviceId ?? '未提供'}</dd>
                <dt>Agent 服务</dt>
                <dd style={{ margin: 0 }}>
                  {error ? '连接中断，以下为上次检查结果' : '已连接'} · 启动于{' '}
                  {new Date(data.startedAt).toLocaleTimeString()}
                </dd>
                <dt>宿主管理</dt>
                <dd style={{ margin: 0 }}>
                  由原生宿主负责；本整合包不提供重启、安装或退出操作，此处不显示宿主进程状态。
                </dd>
                <dt>Node</dt>
                <dd style={{ margin: 0 }}>
                  {data.node.version}
                  <br />
                  {data.node.path}
                </dd>
                <dt>数据目录</dt>
                <dd style={{ margin: 0 }}>
                  {data.home ?? '未知'}
                  <br />
                  {data.writable ? '目录权限允许写入' : '目录不可写，请检查权限'}
                </dd>
                {data.tools.map((t) => (
                  <div key={t.name} style={{ display: 'contents' }}>
                    <dt>{t.name}</dt>
                    <dd style={{ margin: 0 }}>
                      {t.path ? `已找到：${t.path}` : 'PATH 中未找到，请安装或调整本机环境后重启'}
                    </dd>
                  </div>
                ))}
                <dt>模型凭据</dt>
                <dd style={{ margin: 0 }}>
                  {data.credentialsFile
                    ? '存在凭据文件，连接能力需实际运行任务验证'
                    : '未发现凭据文件，请在模型设置中配置（环境变量配置也可能可用）'}
                </dd>
                <dt>网页网络</dt>
                <dd style={{ margin: 0 }}>
                  代理与网络限制由原生 DSH 管理。可执行下方网页读取检查。
                  <br />
                  <small>代理设置在服务启动时生效；系统代理改变后需重启服务。</small>
                </dd>
              </dl>
              <section aria-label="网页读取检查" style={{ margin: '16px 0' }}>
                <button
                  style={button}
                  disabled={networkBusy || Boolean(error)}
                  onClick={() => void checkNetwork()}
                >
                  {networkBusy ? '正在读取公开文档…' : '检查网页读取'}
                </button>
                <p style={{ fontSize: 12, opacity: 0.7 }}>
                  使用 Agent 同一网页服务读取 Node.js 与 TypeScript 官方文档，不调用模型。
                </p>
                {networkError ? (
                  <p role="alert">
                    {networkError}
                    {networkCheck ? ' 下方为上次检查结果。' : ''}
                  </p>
                ) : null}
                {networkCheck ? (
                  <div role="status">
                    {networkCheck.checks.map((check) => (
                      <div key={check.url} style={{ marginTop: 8 }}>
                        <strong>{check.ok ? '可读取' : '未通过'}</strong> · {check.message}
                        <div>
                          <code>{check.url}</code>
                        </div>
                        {check.ok ? (
                          <small>
                            HTTP {check.status} · 已取得 {check.chars} 字符
                            {check.truncated ? '（服务已截断）' : ''}
                          </small>
                        ) : null}
                      </div>
                    ))}
                    <small>检查于 {new Date(networkCheck.checkedAt).toLocaleString()}</small>
                  </div>
                ) : null}
              </section>
              <p style={{ fontSize: 12, opacity: 0.6 }}>
                检查时间：{new Date(data.checkedAt).toLocaleString()} · 工具路径检查不代表命令已执行成功。
              </p>
            </>
          )}
        </section>
      </details>
      <details style={card}>
        <summary style={{ cursor: 'pointer' }}>高级：插件诊断清单</summary>
        <section aria-label="插件清单">
          <h3 style={{ marginTop: 0 }}>当前 Profile 的插件</h3>
          <h4>当前页面实际可用服务</h4>
          {Object.entries(dependencyLabels).map(([id, label]) => (
            <p key={id}>
              {activated[id] ? '可用' : '未启用'} · {label}
            </p>
          ))}
          {Object.keys(dependencyLabels).some((id) => !activated[id]) ? (
            <p role="status">
              未启用的服务会使对应功能不可用。请在插件设置检查是否启用相关插件，恢复后重启服务；原生会话功能可继续使用。禁用侧边卡片会同时停用依赖它的多个面板。
            </p>
          ) : null}
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            沿用 DSH
            插件市场管理插件。安装或更改组合包后重启服务生效；这里显示安装与清单状态，不代表每个插件运行正常。
          </p>
          {data?.profileError ? <p role="alert">无法读取插件清单：{data.profileError}</p> : null}
          {data?.plugins.map((p) => (
            <div key={p.name} style={{ padding: '10px 0', borderTop: '1px solid #8883', fontSize: 13 }}>
              <strong>{p.name}</strong>
              <div style={{ opacity: 0.7, marginTop: 4 }}>
                {p.version ?? '未安装或包不可读'} · {p.enabled ? '已加入组合包' : '未加入组合包'}
              </div>
            </div>
          ))}
          {data && !data.profileError && data.plugins.length === 0 ? <p>此 Profile 暂无额外插件。</p> : null}
        </section>
      </details>
      {message ? (
        <p role="status" style={{ ...card, margin: 0 }}>
          {message}
        </p>
      ) : null}
    </div>
  )
}

export function apply(
  ctx: ClientContext & { inject: (services: string[], callback: (host: any) => void) => unknown }
): void {
  installUiStyles(ctx)
  const capabilities = createCapabilities<Record<string, boolean>>({})
  for (const name of Object.keys(dependencyLabels))
    ctx.inject([name], (host) => {
      capabilities.set({ [name]: true })
      host.effect(() => () => capabilities.set({ [name]: false }), `workbench: ${name} activation`)
    })
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'dsh-px-workbench', order: 110, label: '运行与帮助' },
      () => <Workbench capabilities={capabilities} />
    )
  )
}
