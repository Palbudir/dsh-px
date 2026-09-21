import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/cordis'
import type { LocalStatus } from './status'
import { requestJson } from '../../dsh-px-updater/src/client-data'

export const inject = ['slots', 'locale']
const prefix = '/dsh-px-workbench'
const button = { border: '1px solid currentColor', borderRadius: 8, padding: '7px 12px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 }
const card = { border: '1px solid #8884', borderRadius: 12, padding: 16, minWidth: 0 }
const prompts = [
  { title: '熟悉项目', text: '先阅读当前工作区的说明和代码，解释项目的用途、运行方式与最值得修复的一个问题。请给出文件依据，这一步先不要修改代码。' },
  { title: '完成一次修改', text: '在当前工作区完成下面的修改：[填写需求]。先读项目约定，说明影响范围，再实现并运行相关验证；最后列出修改文件、验证结果和未解决的问题。' },
  { title: '验证工具可用', text: '在当前工作区创建 agent-smoke.txt，写入 DSH-PX agent smoke OK。必须实际调用文件工具写入，再用 Shell 读取验证，报告实际路径与读取内容。不要修改其他文件。' }
]

function Workbench (): unknown {
  const [data, setData] = useState<LocalStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [path, setPath] = useState('')
  const [adding, setAdding] = useState(false)
  const [workspaceMessage, setWorkspaceMessage] = useState('')
  async function addWorkspace (): Promise<void> {
    setAdding(true); setWorkspaceMessage('')
    try {
      const result = await requestJson<{ message: string }>(`${prefix}/workspace?path=${encodeURIComponent(path.trim())}`, { method: 'POST' })
      setWorkspaceMessage(result.message)
    } catch (err) { setWorkspaceMessage(err instanceof Error ? err.message : String(err)) }
    finally { setAdding(false) }
  }
  async function refresh (): Promise<void> {
    setBusy(true)
    try { setData(await requestJson<LocalStatus>(`${prefix}/status`)); setError(null) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async (): Promise<void> => {
      try { const value = await requestJson<LocalStatus>(`${prefix}/status`); if (active) { setData(value); setError(null) } }
      catch (err) { if (active) setError(err instanceof Error ? err.message : String(err)) }
      if (active) timer = setTimeout(() => void poll(), 5000)
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [])
  async function restart (): Promise<void> {
    setRestarting(true); setConfirm(false)
    try {
      const result = await requestJson<{ message: string }>(`${prefix}/restart`, { method: 'POST' })
      setMessage(result.message)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setRestarting(false) }
  }
  return <div style={{ display: 'grid', gap: 16, minWidth: 0, overflowWrap: 'anywhere', paddingBottom: 20 }}>
    <div><h2 style={{ margin: '0 0 8px' }}>运行与帮助</h2><p style={{ margin: 0, opacity: .7, lineHeight: 1.7 }}>从工作区开始，让 Agent 读取文件、执行工具并交付可检查的结果。</p></div>
    <section style={card} aria-label="开始任务">
      <h3 style={{ marginTop: 0 }}>开始一个任务</h3>
      <ol style={{ paddingLeft: 22, lineHeight: 1.9 }}>
        <li>在设置的模型提供商中配置模型和密钥。</li>
        <li>关闭设置，在侧栏添加本机项目文件夹，再新建会话。</li>
        <li>选择标准模式与模型，描述需求；按提示审阅工具权限和修改结果。</li>
      </ol>
      <label htmlFor="dsh-px-workspace" style={{ fontSize: 13 }}>本机项目文件夹</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0 16px' }}>
        <input id="dsh-px-workspace" value={path} placeholder="C:\Projects\demo" onChange={(e: { target: { value: string } }) => setPath(e.target.value)} style={{ ...button, minWidth: 0, flex: '1 1 240px', cursor: 'text' }} />
        <button style={button} disabled={adding || !path.trim()} onClick={() => void addWorkspace()}>{adding ? '添加中…' : '添加工作区'}</button>
      </div>
      {workspaceMessage ? <p role="status" style={{ fontSize: 13 }}>{workspaceMessage}</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{prompts.map(p => <button key={p.title} style={button} onClick={() => {
        void navigator.clipboard.writeText(p.text).then(() => setMessage(`已复制“${p.title}”，粘贴到新会话即可。`)).catch(() => setMessage(`复制失败，请手动复制：${p.text}`))
      }}>复制：{p.title}</button>)}</div>
      <p style={{ fontSize: 12, opacity: .65, marginBottom: 0 }}>首次验证建议使用空文件夹。模型能否连接以真实任务结果为准。</p>
    </section>
    <details style={card}><summary style={{ cursor: 'pointer' }}>本机运行诊断与服务恢复</summary>
    <section aria-label="本机运行检查">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><h3>本机运行检查</h3><button style={button} disabled={busy} onClick={() => void refresh()}>{busy ? '检查中…' : '重新检查'}</button></div>
      {error ? <p role="alert">检查失败：{error}。可重新检查，或到桌面窗口恢复服务。</p> : null}
      {!data ? <p>正在读取本机状态…</p> : <>
        <dl style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,1fr)', gap: '10px 12px', fontSize: 13, lineHeight: 1.6 }}>
          <dt>Agent 服务</dt><dd style={{ margin: 0 }}>{error ? '连接中断，以下为上次检查结果' : '已连接'} · 启动于 {new Date(data.startedAt).toLocaleTimeString()}</dd>
          <dt>桌面外壳</dt><dd style={{ margin: 0 }}>{data.service?.message ?? '未连接（可继续使用浏览器中的 Agent）'}</dd>
          <dt>Node</dt><dd style={{ margin: 0 }}>{data.node.version}<br/>{data.node.path}</dd>
          <dt>数据目录</dt><dd style={{ margin: 0 }}>{data.home ?? '未知'}<br/>{data.writable ? '目录权限允许写入' : '目录不可写，请检查权限'}</dd>
          {data.tools.map(t => <div key={t.name} style={{ display: 'contents' }}><dt>{t.name}</dt><dd style={{ margin: 0 }}>{t.path ? `已找到：${t.path}` : 'PATH 中未找到，请安装或调整本机环境后重启'}</dd></div>)}
          <dt>模型凭据</dt><dd style={{ margin: 0 }}>{data.credentialsFile ? '存在凭据文件，连接能力需实际运行任务验证' : '未发现凭据文件，请在模型设置中配置（环境变量配置也可能可用）'}</dd>
        </dl>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><button style={button} disabled={!data.canRestart || Boolean(error) || restarting} onClick={() => setConfirm(true)}>重启本机服务</button></div>
        {confirm ? <div role="alert" style={{ marginTop: 12 }}><p>重启会中断正在执行的任务。请先等待任务结束；已有会话与配置会保留。</p><button style={button} disabled={restarting} onClick={() => void restart()}>确认重启</button> <button style={button} onClick={() => setConfirm(false)}>取消</button></div> : null}
        <p style={{ fontSize: 12, opacity: .6 }}>检查时间：{new Date(data.checkedAt).toLocaleString()} · 工具路径检查不代表命令已执行成功。</p>
      </>}
    </section>
    </details>
    <details style={card}><summary style={{ cursor: 'pointer' }}>高级：插件诊断清单</summary>
    <section aria-label="插件清单"><h3 style={{ marginTop: 0 }}>当前 Profile 的插件</h3>
      <p style={{ fontSize: 12, opacity: .7 }}>沿用 DSH 插件市场管理插件。安装或更改组合包后重启服务生效；这里显示安装与清单状态，不代表每个插件运行正常。</p>
      {data?.profileError ? <p role="alert">无法读取插件清单：{data.profileError}</p> : null}
      {data?.plugins.map(p => <div key={p.name} style={{ padding: '10px 0', borderTop: '1px solid #8883', fontSize: 13 }}><strong>{p.name}</strong><div style={{ opacity: .7, marginTop: 4 }}>{p.version ?? '未安装或包不可读'} · {p.enabled ? '已加入组合包' : '未加入组合包'}</div></div>)}
      {data && !data.profileError && data.plugins.length === 0 ? <p>此 Profile 暂无额外插件。</p> : null}
    </section>
    </details>
    {message ? <p role="status" style={{ ...card, margin: 0 }}>{message}</p> : null}
  </div>
}

export function apply (ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-px-workbench', order: 110, label: '运行与帮助' }, Workbench))
}
