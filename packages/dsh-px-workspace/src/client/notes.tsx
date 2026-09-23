import { useOperation } from './data'
import { useEffect, useRef, useState } from 'react'
import type { Panel, Client } from './contracts'
import type { Content } from './panel-types'
import type { Annotation, Message } from '../model'
import { requestJson } from '../../../shared/client-http'
import { insertQuote } from '../client-input'
import { base, stamp, useData, errorText, post, quoteRequests, useSnapshot } from './data'
import { useDraft } from './drafts'
import { ConfirmDelete } from '../../../shared/ui'
type Source = Message & { length: number; offset: number; nextOffset: number | null }
interface NoteDraft {
  source: Source | null
  quote: string
  note: string
  editing: Annotation | null
  initialized: boolean
  requestToken?: string
  collapsed: boolean
}
export function NotesPanel({ ctx, scope, visible, tab }: Panel & { ctx: Client }): unknown {
  const selection = useSnapshot(quoteRequests)[scope.sessionId]
  const [before, setBefore] = useState<number | null>(null)
  const { data, error, refresh } = useData<Content>(
    `${base}/content?sessionId=${encodeURIComponent(scope.sessionId)}${before === null ? '' : '&before=' + before}`,
    visible
  )
  const [noteBefore, setNoteBefore] = useState<string | null>(null)
  const notes = useData<{ annotations: Annotation[]; total: number; nextBefore: string | null }>(
    `${base}/annotations?sessionId=${encodeURIComponent(scope.sessionId)}${noteBefore ? '&before=' + encodeURIComponent(noteBefore) : ''}`,
    visible
  )
  const [editor, setEditor, draftWarning] = useDraft<NoteDraft>(`notes:${scope.sessionId}`, () => ({
    source: null,
    quote: '',
    note: '',
    editing: null,
    initialized: false,
    collapsed: false
  }))
  const { source, quote, note, editing } = editor
  const setQuote = (quote: string): void => setEditor((old) => ({ ...old, quote }))
  const setNote = (note: string): void => setEditor((old) => ({ ...old, note }))
  const setEditing = (editing: Annotation | null): void => setEditor((old) => ({ ...old, editing }))
  const setSource = (source: Source | null): void =>
    setEditor((old) => ({ ...old, source, initialized: true }))
  const [notice, setNotice] = useState(''),
    [failure, setFailure] = useState(''),
    [localBusy, setBusy] = useState(false)
  const [operationBusy, runOperation] = useOperation(`notes:${scope.sessionId}`)
  const busy = localBusy || operationBusy
  const revision = useRef(0)
  const active = useRef(true),
    sourceRequest = useRef<AbortController | null>(null)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      sourceRequest.current?.abort()
    }
  }, [])
  async function choose(id: string, existing: Annotation | null = null, offset = 0): Promise<void> {
    if (operationBusy) return
    const rev = ++revision.current
    sourceRequest.current?.abort()
    const controller = new AbortController()
    sourceRequest.current = controller
    setBusy(true)
    setFailure('')
    setNotice('')
    try {
      const value = await requestJson<Source>(
        `${base}/message?sessionId=${encodeURIComponent(scope.sessionId)}&messageId=${encodeURIComponent(id)}&offset=${offset}`,
        { signal: controller.signal }
      )
      if (rev !== revision.current || !active.current) return
      setEditor({
        source: value,
        editing: existing,
        quote: existing?.quote ?? value.text.slice(0, 8000),
        note: existing?.note ?? '',
        initialized: true,
        collapsed: false,
        requestToken: selection?.token
      })
    } catch (e) {
      if (active.current && rev === revision.current && !controller.signal.aborted) setFailure(errorText(e))
    } finally {
      if (active.current && rev === revision.current) setBusy(false)
    }
  }
  useEffect(() => {
    if (selection && selection.token !== editor.requestToken) void choose(selection.messageId)
    else if (!editor.initialized && tab.meta?.messageId) void choose(tab.meta.messageId)
  }, [selection, tab.meta?.messageId, operationBusy])
  const draft = source
    ? { sessionId: scope.sessionId, messageId: source.id, seq: source.seq, quote, note }
    : null
  const validQuote = !!quote && (!!source?.text.includes(quote) || editing?.quote === quote)
  async function action(fn: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true)
    setFailure('')
    setNotice('')
    try {
      await runOperation(fn)
      setNoteBefore(null)
      notes.refresh()
      setNotice(success)
    } catch (e) {
      setFailure(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  function insert(a: Pick<Annotation, 'sessionId' | 'seq' | 'quote' | 'note'>): void {
    try {
      insertQuote(ctx, scope.sessionId, a)
      setFailure('')
      setNotice('已加入草稿，检查后发送。')
    } catch (e) {
      setFailure(errorText(e))
    }
  }
  return (
    <div className="px-ui px-panel">
      <h3>引用与批注</h3>
      <p className="px-muted">选择原文并添加批注。切换面板会保留草稿；点击引用才会加入会话输入框。</p>
      {draftWarning ? <p role="alert">{draftWarning}</p> : null}
      {source && editor.collapsed ? (
        <button onClick={() => setEditor((old) => ({ ...old, collapsed: false }))}>继续编辑草稿</button>
      ) : null}
      {failure || error || notes.error ? <p role="alert">{failure || error || notes.error}</p> : null}
      {notice ? (
        <p role="status" className="px-feedback">
          {notice}
        </p>
      ) : null}
      {source && !editor.collapsed ? (
        <section className="px-card" aria-label="批注编辑器">
          <fieldset disabled={busy}>
            <h4>
              {source.role === 'user' ? '用户' : '助手'} · 记录 {source.seq}
            </h4>
            <label>
              消息原文（可选中一段作为引用）
              <textarea
                aria-label="消息原文"
                readOnly
                rows={5}
                value={source.text}
                onSelect={(e: any) => {
                  const el = e.currentTarget
                  if (el.selectionEnd > el.selectionStart)
                    setQuote(source.text.slice(el.selectionStart, el.selectionEnd).slice(0, 8000))
                }}
              />
            </label>
            {source.length > source.text.length ? (
              <p className="px-muted">
                显示 {source.offset + 1}–{source.offset + source.text.length} / {source.length} 字符。
                {source.nextOffset !== null ? (
                  <button disabled={busy} onClick={() => void choose(source.id, null, source.nextOffset!)}>
                    后续正文
                  </button>
                ) : null}
                {source.offset > 0 ? <button onClick={() => void choose(source.id)}>返回开头</button> : null}
              </p>
            ) : null}
            <label>
              引用片段 · {quote.length} 字符（最多 8000）
              <textarea
                aria-label="引用片段"
                rows={3}
                maxLength={8000}
                value={quote}
                onInput={(e: any) => setQuote(e.currentTarget.value)}
                onChange={(e: any) => setQuote(e.target.value)}
              />
            </label>
            <p className="px-muted">可选中上方原文，也可在这里删去不需要的部分；须保留连续的原文。</p>
            {quote && !validQuote ? (
              <p role="alert">此片段不在当前原文中，请恢复原文；补充意见请写在批注里。</p>
            ) : null}
            <label>
              我的批注
              <textarea
                aria-label="我的批注"
                maxLength={4000}
                value={note}
                onChange={(e: any) => setNote(e.target.value)}
                placeholder="需要修改的地方、补充要求或待核对的问题…"
              />
            </label>
            <div className="px-actions">
              <button
                className="px-primary"
                disabled={busy || !validQuote}
                onClick={() =>
                  void action(async () => {
                    const saved = await post<Annotation>('annotations', {
                      action: 'save',
                      ...draft,
                      ...(editing ? { id: editing.id, updatedAt: editing.updatedAt } : {})
                    })
                    setEditing(saved)
                  }, '批注已保存')
                }
              >
                {editing ? '更新批注' : '保存批注'}
              </button>
              <button disabled={busy || !validQuote} onClick={() => draft && insert(draft)}>
                引用到输入框
              </button>
              <button disabled={busy} onClick={() => setEditor((old) => ({ ...old, collapsed: true }))}>
                收起编辑器
              </button>
            </div>
          </fieldset>
        </section>
      ) : null}
      <h4>已保存 · {notes.data?.total ?? 0}</h4>
      <div className="px-actions">
        {noteBefore ? <button onClick={() => setNoteBefore(null)}>最新批注</button> : null}
        {notes.data?.nextBefore ? (
          <button onClick={() => setNoteBefore(notes.data!.nextBefore)}>更早批注</button>
        ) : null}
      </div>
      <span className="px-load-status" role="status">
        {notes.loading ? '正在读取批注…' : ''}
      </span>
      {notes.data?.annotations.map((a) => (
        <article className="px-card" key={a.id}>
          <small className="px-muted">
            记录 {a.seq} · {stamp(a.updatedAt)}
          </small>
          <blockquote>{a.quote}</blockquote>
          {a.note ? <p>{a.note}</p> : null}
          <div className="px-actions">
            <button disabled={busy} onClick={() => insert(a)}>
              引用到输入框
            </button>
            <button disabled={busy} onClick={() => void choose(a.messageId, a)}>
              查看原文 / 编辑
            </button>
            <ConfirmDelete
              label="删除批注"
              disabled={busy}
              onConfirm={() =>
                action(async () => {
                  await post('annotations', { action: 'delete', id: a.id, updatedAt: a.updatedAt })
                  if (editing?.id === a.id) {
                    setEditing(null)
                    setSource(null)
                  }
                }, '批注已删除')
              }
            />
          </div>
        </article>
      ))}
      <h4>会话正文</h4>
      <div className="px-actions">
        <button
          onClick={() => {
            setBefore(null)
            refresh()
          }}
        >
          最新正文
        </button>
        {data?.nextBefore !== null && data?.nextBefore !== undefined ? (
          <button onClick={() => setBefore(data.nextBefore)}>更早正文</button>
        ) : null}
      </div>
      {data?.messages.length === 0 ? <p>还没有可引用的正文。</p> : null}
      {data?.messages.map((m) => (
        <article className="px-card" key={m.id}>
          <small>
            {m.role === 'user' ? '用户' : '助手'} · {stamp(m.time)}
          </small>
          <p>{m.text}</p>
          <button disabled={busy} onClick={() => void choose(m.id)}>
            引用 / 批注此消息
          </button>
        </article>
      ))}
    </div>
  )
}
