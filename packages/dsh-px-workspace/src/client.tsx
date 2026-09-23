import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../dsh-px-updater/src/client-data'
import { type Annotation, type Artifact, type Message, type Schedule, type Timing } from './model'
import { insertQuote } from './client-input'

export const inject = ['slots', 'sessions', 'uiWorkspace', 'conversation', 'betterSidebar']
interface Snapshot<T> { getSnapshot: () => T, subscribe: (cb: () => void) => () => void }
interface SessionRow { id: string, displayTitle: string, cwd?: string, origin?: string, running: boolean, completed?: boolean }
interface SessionList { current?: string, phase: string, ids: string[], byId: Record<string, SessionRow>, jobsBySession: Record<string, unknown[]> }
interface Scope { sessionId: string, cwd?: string }
interface Panel { scope: Scope, visible: boolean, tab: { meta?: { messageId?: string } } }
interface Client {
  sessions: { list: Snapshot<SessionList>, scope: (id: string) => any, clear: () => void }
  uiWorkspace: { openSession: (id: string) => void, startSession: () => void }
  conversation: { input: { for: (ctx: any) => { state: Snapshot<{ draft: string, draftRev: number, phase: string }>, notify: (level: 'info' | 'error', text: string) => void } } }
  betterSidebar: { registerTab: (tab: any) => () => void, openTab: (seed: any, scope?: Scope) => void, openFile: (scope: Scope, path: string, title?: string) => void }
  slots: { inject: (name: string, fn: () => unknown) => unknown, register: (entry: any, component: any) => unknown }
  effect: (fn: () => () => void, name?: string) => void
}
const base = '/dsh-px-workspace'
const errorText = (e: unknown): string => e instanceof Error ? e.message : String(e)
const stamp = (time: number | null): string => time === null ? '已暂停' : new Date(time).toLocaleString()
const post = <T,>(route: string, value: unknown): Promise<T> => requestJson<T>(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
// Native single tabs focus an existing view without replacing its params. A small
// plugin-owned observable routes repeated quote selections into that same view.
let quoteSelections: Record<string, { messageId: string, revision: number }> = {}
let quoteRevision = 0
const quoteListeners = new Set<() => void>()
const quoteRequests: Snapshot<typeof quoteSelections> = { getSnapshot: () => quoteSelections, subscribe: cb => { quoteListeners.add(cb); return () => { quoteListeners.delete(cb) } } }
function requestQuote (sessionId: string, messageId: string): void {
  quoteSelections = { ...quoteSelections, [sessionId]: { messageId, revision: ++quoteRevision } }
  for (const cb of quoteListeners) cb()
}
function useSnapshot<T> (store: Snapshot<T>): T {
  const [value, set] = useState(store.getSnapshot)
  useEffect(() => { const refresh = (): void => set(store.getSnapshot()); refresh(); return store.subscribe(refresh) }, [store])
  return value
}
function useData<T> (url: string, enabled: boolean): { data: T | null, error: string, refresh: () => void } {
  const [data, set] = useState<T | null>(null), [error, setError] = useState(''), [revision, revise] = useState(0)
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>
    set(null); setError('')
    if (!enabled) return
    const read = async (): Promise<void> => {
      try { const value = await requestJson<T>(url); if (alive) { set(value); setError('') } }
      catch (e) { if (alive) setError(errorText(e)) }
      if (alive) timer = setTimeout(() => void read(), 5000)
    }
    void read()
    return () => { alive = false; clearTimeout(timer) }
  }, [url, enabled, revision])
  return { data, error, refresh: () => revise(n => n + 1) }
}
const css = `
body[data-dsh-px-workspace] div:has(> [data-shell-overlay]){padding-top:82px;box-sizing:border-box}
body[data-dsh-px-workspace] div[data-rightbar-fullscreen]:has(> [data-shell-overlay]){padding-top:0}
[data-rightbar-fullscreen] .px-bar{display:none}
.px-bar{position:absolute;left:0;right:0;top:0;height:82px;box-sizing:border-box;pointer-events:auto;background:var(--dsw-alias-bg-base,#fff);border-bottom:1px solid #8883;color:inherit;font-size:12px;display:flex;flex-direction:column;padding:4px 10px;gap:4px}
.px-tabs,.px-tools,.px-actions{display:flex;align-items:center;gap:6px;min-width:0}
.px-tabs{height:37px}.px-tabstrip{display:flex;flex:1;overflow:auto;gap:4px;min-width:60px}
.px-tab{display:flex;align-items:center;flex:none;max-width:230px;border:1px solid #8883;border-radius:7px;background:#8881}
.px-tab[data-active=true]{border-color:#4b7fe9;background:#4b7fe917}.px-tab>button{border:0;background:transparent;padding:6px;white-space:nowrap}
.px-tab>button[role=tab]{overflow:hidden;text-overflow:ellipsis;max-width:175px}.px-tab>button:focus-visible{outline:2px solid #4b7fe9}
.px-tools{height:31px;overflow-x:auto;flex:none}.px-status{margin-left:auto;white-space:nowrap;opacity:.65}
.px-bar button,.px-panel button,.px-quote-action{font:inherit;color:inherit;cursor:pointer;border:1px solid #8885;border-radius:6px;padding:4px 8px;background:transparent;white-space:nowrap}
.px-bar button:disabled,.px-panel button:disabled{opacity:.45;cursor:default}.px-bar select{color:inherit;background:var(--dsw-alias-bg-base,#fff);border:1px solid #8885;border-radius:6px;max-width:135px;padding:4px}
.px-panel{font-size:13px;line-height:1.6;padding:16px;height:100%;overflow:auto;overflow-wrap:anywhere;box-sizing:border-box}
.px-panel h3{margin:0 0 8px}.px-panel h4{margin:4px 0}.px-muted{opacity:.65;font-size:12px}.px-card{border:1px solid #8884;border-radius:9px;padding:12px;margin:10px 0}
.px-panel textarea,.px-panel input,.px-panel select{box-sizing:border-box;display:block;width:100%;font:inherit;color:inherit;background:var(--dsw-alias-bg-base,#fff);border:1px solid #8886;border-radius:6px;padding:7px;margin:4px 0 10px}
.px-panel textarea{resize:vertical;min-height:75px}.px-panel label{display:block}.px-panel label.px-check{display:flex;gap:6px;align-items:center}.px-panel input[type=checkbox]{display:inline;width:auto;margin:0}
.px-panel pre,.px-panel blockquote{white-space:pre-wrap;margin:8px 0;max-height:240px;overflow:auto;font:inherit}.px-panel blockquote{border-left:3px solid #4b7fe9;padding-left:10px}
.px-panel [role=alert]{color:var(--dsw-alias-text-error,#c34747)}.px-actions{flex-wrap:wrap;margin:6px 0}.px-primary{background:#4b7fe915!important;border-color:#4b7fe9!important}
@media(max-width:800px){.px-status{display:none}.px-tabs>select{max-width:95px}.px-bar{padding-left:5px;padding-right:5px}}
`
interface TabState { ids: string[], pins: string[], closed: string[] }
const tabKey = 'dsh-px.session-tabs.v1'
function loadTabs (): TabState {
  try {
    const p = JSON.parse(localStorage.getItem(tabKey) ?? '{}')
    const ids = (v: unknown): string[] => Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && /^[\w-]{1,200}$/.test(x)))].slice(0, 60) : []
    return { ids: ids(p.ids), pins: ids(p.pins), closed: ids(p.closed).slice(0, 10) }
  } catch { return { ids: [], pins: [], closed: [] } }
}
function SessionBar ({ ctx }: { ctx: Client }): unknown {
  const sessions = useSnapshot(ctx.sessions.list), [tabs, setTabs] = useState(loadTabs), [error, setError] = useState('')
  const current = sessions.current
  useEffect(() => {
    if (!current) return
    setTabs(old => old.ids.includes(current) ? old : { ...old, ids: [...old.ids, current], closed: old.closed.filter(id => id !== current) })
  }, [current])
  useEffect(() => { try { localStorage.setItem(tabKey, JSON.stringify(tabs)) } catch { setError('无法保存标签状态；本次打开的标签仍可使用。') } }, [tabs])
  const open = (id: string): void => {
    try { ctx.uiWorkspace.openSession(id); setError('') } catch (e) { setError(errorText(e)) }
  }
  const close = (id: string): void => {
    const index = tabs.ids.indexOf(id), remaining = tabs.ids.filter(x => x !== id)
    setTabs(old => ({ ids: old.ids.filter(x => x !== id), pins: old.pins.filter(x => x !== id), closed: [id, ...old.closed.filter(x => x !== id)].slice(0, 10) }))
    if (id === current) {
      const next = remaining.slice(index).concat(remaining.slice(0, index).reverse()).find(x => sessions.byId[x])
      if (next) open(next); else ctx.sessions.clear()
    }
  }
  const reopen = (): void => { const id = tabs.closed.find(id => sessions.byId[id]); if (id) open(id) }
  useEffect(() => {
    const keydown = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || !e.altKey || document.querySelector('[role=dialog],[role=alertdialog]')) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const ids = tabs.ids.filter(id => sessions.byId[id]), at = ids.indexOf(current ?? '')
        if (!ids.length) return
        e.preventDefault(); open(ids[(at + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length])
      } else if (e.key.toLowerCase() === 't') { e.preventDefault(); reopen() }
    }
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown)
  }, [tabs, current, sessions])
  const scope = current ? { sessionId: current, cwd: sessions.byId[current]?.cwd } : undefined
  const panel = (type: string, bottom = false): void => {
    if (!scope) return
    try { ctx.betterSidebar.openTab({ type, ...(bottom ? { target: 'bottom' } : {}) }, scope); setError('') } catch (e) { setError(errorText(e)) }
  }
  const ids = [...tabs.ids.filter(id => tabs.pins.includes(id)), ...tabs.ids.filter(id => !tabs.pins.includes(id))]
  return <div className="px-bar" aria-label="DSH-PX 会话工作区">
    <div className="px-tabs"><strong style={{ flex: 'none', padding: '0 5px' }}>DSH-PX</strong>
      <div className="px-tabstrip" role="tablist" aria-label="已打开会话">{ids.map(id => <div className="px-tab" key={id} data-active={id === current}>
        <button role="tab" aria-selected={id === current} disabled={!sessions.byId[id]} title={`${sessions.byId[id]?.displayTitle ?? '暂不可用的会话'} · Ctrl+Alt+方向键切换`} onClick={() => open(id)}>{sessions.byId[id]?.running ? '◉ ' : sessions.byId[id]?.completed ? '✓ ' : ''}{sessions.byId[id]?.displayTitle ?? id}</button>
        <button title={tabs.pins.includes(id) ? '取消固定' : '固定标签'} aria-label={`${tabs.pins.includes(id) ? '取消固定' : '固定'} ${sessions.byId[id]?.displayTitle ?? id}`} onClick={() => setTabs(old => ({ ...old, pins: old.pins.includes(id) ? old.pins.filter(x => x !== id) : [...old.pins, id] }))}>{tabs.pins.includes(id) ? '◆' : '◇'}</button>
        <button title="关闭标签（任务继续运行）" aria-label={`关闭标签 ${sessions.byId[id]?.displayTitle ?? id}`} onClick={() => close(id)}>×</button>
      </div>)}</div>
      <button onClick={() => ctx.uiWorkspace.startSession()} title="在当前工作区新建会话">＋ 新会话</button>
      <select aria-label="打开已有会话" value="" onChange={(e: any) => open(e.target.value)}><option value="">打开会话…</option>{sessions.ids.filter(id => sessions.byId[id]?.origin !== 'subagent').map(id => <option key={id} value={id}>{sessions.byId[id].displayTitle}</option>)}</select>
      <button disabled={!tabs.closed.some(id => sessions.byId[id])} onClick={reopen} title="恢复最近关闭的标签 · Ctrl+Alt+T">↶</button>
    </div>
    <div className="px-tools">
      {([['editor', '文件'], ['terminal', '终端'], ['px-artifacts', '产物'], ['git', '变更'], ['subagent', '后台任务'], ['px-notes', '引用与批注'], ['px-schedules', '定时任务']] as const).map(([type, label]) => <button key={type} disabled={!scope} onClick={() => panel(type, type === 'terminal')}>{label}</button>)}
      <span className="px-status" role={error ? 'alert' : 'status'}>{error || (current ? sessions.byId[current]?.running ? 'Agent 正在执行 · 可切换会话' : '关闭标签会保留会话与后台任务' : '选择或新建一个会话开始')}</span>
    </div>
  </div>
}
interface Content { messages: Message[], nextBefore: number | null, artifacts: Artifact[] }
function ArtifactsPanel ({ ctx, scope, visible }: Panel & { ctx: Client }): unknown {
  const { data, error, refresh } = useData<Content>(`${base}/content?sessionId=${encodeURIComponent(scope.sessionId)}`, visible)
  return <div className="px-panel"><h3>会话产物</h3><p className="px-muted">汇总 Agent 使用 present 声明的交付。打开的是文件当前内容；原文件移动或删除后需要重新定位。</p>
    <button onClick={refresh}>刷新产物</button>{error ? <p role="alert">{error}</p> : null}
    {!data && !error ? <p>正在读取…</p> : null}{data?.artifacts.length === 0 ? <p>尚无已声明的产物。可以让 Agent 完成任务后使用 present 交付文件。</p> : null}
    {data?.artifacts.map(a => <article className="px-card" key={a.path}><strong>{a.path.split(/[\\/]/).pop()}</strong><p>{a.description || '未填写说明'}</p><p className="px-muted">{a.path}<br/>{stamp(a.time)}</p><button onClick={() => ctx.betterSidebar.openFile(scope, a.path)}>打开产物</button></article>)}
  </div>
}
type Source = Message & { length: number, offset: number, nextOffset: number | null }
function NotesPanel ({ ctx, scope, visible, tab }: Panel & { ctx: Client }): unknown {
  const selection = useSnapshot(quoteRequests)[scope.sessionId]
  const [before, setBefore] = useState<number | null>(null)
  const { data, error, refresh } = useData<Content>(`${base}/content?sessionId=${encodeURIComponent(scope.sessionId)}${before === null ? '' : '&before=' + before}`, visible)
  const notes = useData<{ annotations: Annotation[] }>(`${base}/annotations?sessionId=${encodeURIComponent(scope.sessionId)}`, visible)
  const [source, setSource] = useState<Source | null>(null), [quote, setQuote] = useState(''), [note, setNote] = useState(''), [editing, setEditing] = useState<Annotation | null>(null)
  const [notice, setNotice] = useState(''), [failure, setFailure] = useState(''), [busy, setBusy] = useState(false)
  const revision = useRef(0)
  async function choose (id: string, existing: Annotation | null = null, offset = 0): Promise<void> {
    const rev = ++revision.current
    setBusy(true); setFailure(''); setNotice('')
    try {
      const value = await requestJson<Source>(`${base}/message?sessionId=${encodeURIComponent(scope.sessionId)}&messageId=${encodeURIComponent(id)}&offset=${offset}`)
      if (rev !== revision.current) return
      setSource(value); setEditing(existing); setQuote(existing?.quote ?? value.text.slice(0, 8000)); setNote(existing?.note ?? '')
    } catch (e) { if (rev === revision.current) setFailure(errorText(e)) } finally { if (rev === revision.current) setBusy(false) }
  }
  useEffect(() => { const id = selection?.messageId ?? tab.meta?.messageId; if (id) void choose(id) }, [selection, tab.meta?.messageId])
  const draft = source ? { sessionId: scope.sessionId, messageId: source.id, seq: source.seq, quote, note } : null
  const validQuote = !!quote && (!!source?.text.includes(quote) || editing?.quote === quote)
  async function action (fn: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true); setFailure(''); setNotice('')
    try { await fn(); notes.refresh(); setNotice(success) } catch (e) { setFailure(errorText(e)) } finally { setBusy(false) }
  }
  function insert (a: Pick<Annotation, 'sessionId' | 'seq' | 'quote' | 'note'>): void {
    try { insertQuote(ctx, scope.sessionId, a); setFailure(''); setNotice('已加入草稿，检查后发送。') } catch (e) { setFailure(errorText(e)) }
  }
  return <div className="px-panel"><h3>引用与批注</h3><p className="px-muted">选择用户或助手正文，保存原文片段与批注。批注保存在本机，点击引用才会加入输入框。</p>
    {failure || error || notes.error ? <p role="alert">{failure || error || notes.error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {source ? <section className="px-card" aria-label="批注编辑器"><h4>{source.role === 'user' ? '用户' : '助手'} · 记录 {source.seq}</h4>
      <label>消息原文（可选中一段作为引用）<textarea aria-label="消息原文" readOnly rows={5} value={source.text} onSelect={(e: any) => { const el = e.currentTarget; if (el.selectionEnd > el.selectionStart) setQuote(source.text.slice(el.selectionStart, el.selectionEnd).slice(0, 8000)) }}/></label>
      {source.length > source.text.length ? <p className="px-muted">显示 {source.offset + 1}–{source.offset + source.text.length} / {source.length} 字符。{source.nextOffset !== null ? <button disabled={busy} onClick={() => void choose(source.id, null, source.nextOffset!)}>后续正文</button> : null}{source.offset > 0 ? <button onClick={() => void choose(source.id)}>返回开头</button> : null}</p> : null}
      <label>引用片段 · {quote.length} 字符（最多 8000）<textarea aria-label="引用片段" rows={3} maxLength={8000} value={quote} onInput={(e: any) => setQuote(e.currentTarget.value)} onChange={(e: any) => setQuote(e.target.value)}/></label>
      <p className="px-muted">可选中上方原文，也可在这里删去不需要的部分；须保留连续的原文。</p>{quote && !validQuote ? <p role="alert">此片段不在当前原文中，请恢复原文；补充意见请写在批注里。</p> : null}
      <label>我的批注<textarea aria-label="我的批注" maxLength={4000} value={note} onChange={(e: any) => setNote(e.target.value)} placeholder="需要修改的地方、补充要求或待核对的问题…"/></label>
      <div className="px-actions"><button className="px-primary" disabled={busy || !validQuote} onClick={() => void action(async () => { const saved = await post<Annotation>('annotations', { action: 'save', ...draft, ...(editing ? { id: editing.id, updatedAt: editing.updatedAt } : {}) }); setEditing(saved) }, '批注已保存')}>{editing ? '更新批注' : '保存批注'}</button>
        <button disabled={busy || !validQuote} onClick={() => draft && insert(draft)}>引用到输入框</button><button disabled={busy} onClick={() => { setSource(null); setEditing(null) }}>收起编辑器</button></div>
    </section> : null}
    <h4>已保存 · {notes.data?.annotations.length ?? 0}</h4>
    {notes.data?.annotations.map(a => <article className="px-card" key={a.id}><small className="px-muted">记录 {a.seq} · {stamp(a.updatedAt)}</small><blockquote>{a.quote}</blockquote>{a.note ? <p>{a.note}</p> : null}<div className="px-actions"><button disabled={busy} onClick={() => insert(a)}>引用到输入框</button><button disabled={busy} onClick={() => void choose(a.messageId, a)}>查看原文 / 编辑</button><button disabled={busy} onClick={() => void action(async () => { await post('annotations', { action: 'delete', id: a.id, updatedAt: a.updatedAt }); if (editing?.id === a.id) { setEditing(null); setSource(null) } }, '批注已删除')}>删除批注</button></div></article>)}
    <h4>会话正文</h4><div className="px-actions"><button onClick={() => { setBefore(null); refresh() }}>最新正文</button>{data?.nextBefore !== null && data?.nextBefore !== undefined ? <button onClick={() => setBefore(data.nextBefore)}>更早正文</button> : null}</div>
    {data?.messages.length === 0 ? <p>还没有可引用的正文。</p> : null}{data?.messages.map(m => <article className="px-card" key={m.id}><small>{m.role === 'user' ? '用户' : '助手'} · {stamp(m.time)}</small><p>{m.text}</p><button disabled={busy} onClick={() => void choose(m.id)}>引用 / 批注此消息</button></article>)}
  </div>
}
function localTime (time: number): string { const d = new Date(time); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
function SchedulesPanel ({ ctx, scope, visible }: Panel & { ctx: Client }): unknown {
  const sessions = useSnapshot(ctx.sessions.list), { data, error, refresh } = useData<{ schedules: Schedule[], timeZone: string }>(`${base}/schedules`, visible)
  const [editing, setEditing] = useState<Schedule | null>(null), [form, setForm] = useState(false), [title, setTitle] = useState(''), [prompt, setPrompt] = useState('')
  const [sessionId, setSessionId] = useState(scope.sessionId), [kind, setKind] = useState<Timing['kind']>('once'), [at, setAt] = useState(localTime(Date.now() + 300000)), [minutes, setMinutes] = useState('60'), [daily, setDaily] = useState('09:00'), [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [notice, setNotice] = useState('')
  const begin = (s: Schedule | null): void => {
    setEditing(s); setTitle(s?.title ?? ''); setPrompt(s?.prompt ?? ''); setSessionId(s?.sessionId ?? scope.sessionId); setKind(s?.timing.kind ?? 'once'); setEnabled(s?.enabled ?? true)
    setAt(localTime(s?.timing.kind === 'once' ? s.timing.at : Date.now() + 300000)); setMinutes(String(s?.timing.kind === 'interval' ? s.timing.minutes : 60)); setDaily(s?.timing.kind === 'daily' ? s.timing.time : '09:00'); setForm(true); setFailure(''); setNotice('')
  }
  async function action (fn: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true); setFailure(''); setNotice('')
    try { await fn(); refresh(); setNotice(success) } catch (e) { setFailure(errorText(e)) } finally { setBusy(false) }
  }
  const rule = (): Timing => kind === 'once' ? { kind, at: new Date(at).getTime() } : kind === 'interval' ? { kind, minutes: Number(minutes) } : { kind, time: daily }
  const timingText = (t: Timing): string => t.kind === 'once' ? '一次 · ' + stamp(t.at) : t.kind === 'interval' ? `每 ${t.minutes} 分钟` : `每天 ${t.time}`
  return <div className="px-panel"><h3>定时任务</h3><p className="px-muted">应用运行时向指定会话投递，沿用该会话的模型与权限。忙碌时进入队列；退出期间不执行，恢复后重复任务只补最新一次。时区：{data?.timeZone ?? '读取中'}。</p>
    <div className="px-actions"><button className="px-primary" disabled={busy} onClick={() => begin(null)}>新建定时任务</button><button onClick={refresh}>刷新任务</button></div>
    {failure || error ? <p role="alert">{failure || error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {form ? <section className="px-card" aria-label="定时任务编辑器"><h4>{editing ? '编辑任务' : '新建任务'}</h4>
      <label>任务名称<input aria-label="任务名称" maxLength={100} value={title} onChange={(e: any) => setTitle(e.target.value)}/></label>
      <label>目标会话<select aria-label="目标会话" value={sessionId} onChange={(e: any) => setSessionId(e.target.value)}>{!sessions.byId[sessionId] ? <option value={sessionId}>{sessionId}（暂不可用）</option> : null}{sessions.ids.filter(id => sessions.byId[id]?.origin !== 'subagent').map(id => <option key={id} value={id}>{sessions.byId[id].displayTitle}</option>)}</select></label>
      <label>执行要求<textarea aria-label="执行要求" rows={4} maxLength={4000} value={prompt} onChange={(e: any) => setPrompt(e.target.value)} placeholder="例如：检查项目测试，汇报新增失败和对应文件。"/></label>
      <label>触发方式<select aria-label="触发方式" value={kind} onChange={(e: any) => setKind(e.target.value)}><option value="once">指定时间执行一次</option><option value="interval">固定间隔</option><option value="daily">每天</option></select></label>
      {kind === 'once' ? <label>本机时间<input aria-label="本机时间" type="datetime-local" value={at} onInput={(e: any) => setAt(e.currentTarget.value)} onChange={(e: any) => setAt(e.target.value)}/></label> : kind === 'interval' ? <label>间隔（分钟）<input aria-label="间隔分钟" type="number" min={1} max={525600} value={minutes} onInput={(e: any) => setMinutes(e.currentTarget.value)} onChange={(e: any) => setMinutes(e.target.value)}/></label> : <label>每日时间<input aria-label="每日时间" type="time" value={daily} onInput={(e: any) => setDaily(e.currentTarget.value)} onChange={(e: any) => setDaily(e.target.value)}/></label>}
      <label className="px-check"><input type="checkbox" checked={enabled} onChange={(e: any) => setEnabled(e.target.checked)}/>启用此任务</label>
      <div className="px-actions"><button className="px-primary" disabled={busy || !title.trim() || !prompt.trim()} onClick={() => void action(async () => { await post('schedules', { action: 'save', ...(editing ? { id: editing.id, updatedAt: editing.updatedAt } : {}), title, prompt, sessionId, timing: rule(), enabled }); setForm(false) }, '定时任务已保存')}>保存定时任务</button><button disabled={busy} onClick={() => setForm(false)}>取消编辑</button></div>
    </section> : null}
    {data?.schedules.length === 0 ? <p>尚未配置定时任务。</p> : null}
    {data?.schedules.map(s => <article className="px-card" key={s.id}><h4>{s.title} · {s.enabled ? '已启用' : '已暂停'}</h4><p>{s.prompt}</p><p className="px-muted">会话：{sessions.byId[s.sessionId]?.displayTitle ?? s.sessionId}<br/>{timingText(s.timing)} · {s.timeZone}<br/>下次：{stamp(s.nextAt)}</p>
      {s.history[0]?.status === 'uncertain' ? <p role="alert">{s.history[0].detail} 检查会话后再手动投递或启用。</p> : null}
      <div className="px-actions"><button onClick={() => ctx.uiWorkspace.openSession(s.sessionId)}>打开会话</button><button disabled={busy} onClick={() => begin(s)}>编辑任务</button><button disabled={busy} onClick={() => void action(() => post('schedules', { ...s, action: 'save', enabled: !s.enabled }), s.enabled ? '任务已暂停' : '任务已启用')}>{s.enabled ? '暂停任务' : '启用任务'}</button>
        <button disabled={busy} onClick={() => void action(async () => { const result = await post<Schedule>('schedules', { action: 'run', id: s.id }); if (result.history[0]?.status !== 'queued') throw new Error(result.history[0]?.detail ?? '投递尚未确认') }, '已投递到目标会话；这不代表 Agent 已完成。')}>立即投递一次</button>
        <button disabled={busy} onClick={() => void action(() => post('schedules', { action: 'delete', id: s.id, updatedAt: s.updatedAt }), '任务已删除；已投递的会话消息会保留。')}>删除任务</button></div>
      <details><summary>最近投递 · {s.history.length} 次</summary><p className="px-muted">“已投递”表示会话接收。执行进展和最终结果请打开目标会话查看。</p>{s.history.map(h => <p key={h.requestId}>{stamp(h.time)} · {h.status === 'queued' ? '已投递' : h.status === 'dispatching' ? '投递中' : '未确认 / 已暂停'}{h.detail ? <small><br/>{h.detail}</small> : null}</p>)}</details>
    </article>)}
  </div>
}
export function apply (ctx: Client): void {
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style); document.body.setAttribute('data-dsh-px-workspace', ''); return () => { style.remove(); document.body.removeAttribute('data-dsh-px-workspace') } }, 'workspace: layout')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-px-workspace', order: 0, registrant: 'dsh-px-workspace' }, () => <SessionBar ctx={ctx}/>))
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'dsh-px-quote', order: 95, registrant: 'dsh-px-workspace' }, (p: { sessionId: string, messageId: string }) => <button className="px-quote-action" title="引用或批注这条消息" onClick={() => { requestQuote(p.sessionId, p.messageId); ctx.betterSidebar.openTab({ type: 'px-notes', meta: { messageId: p.messageId } }, { sessionId: p.sessionId }) }}>引用 / 批注</button>))
  for (const [id, title, component, icon] of [
    ['px-artifacts', '产物', ArtifactsPanel, '▣'], ['px-notes', '引用与批注', NotesPanel, '❞'], ['px-schedules', '定时任务', SchedulesPanel, '◷']
  ] as const) ctx.effect(() => ctx.betterSidebar.registerTab({ id, title, order: 16, single: true, icon, component: (p: Panel) => { const Component = component; return <Component key={p.scope.sessionId} {...p} ctx={ctx}/> } }), `workspace: ${id}`)
}
