import { useOperation } from '../../../dsh-px-workspace/src/client/data'
import { useEffect, useRef, useState } from 'react'
import type { Panel, Client } from '../../../dsh-px-workspace/src/client/contracts'
import type { Content } from '../../../dsh-px-workspace/src/client/panel-types'
import type { Annotation, Message } from '../../../dsh-px-workspace/src/model'
import { requestJson } from '../../../shared/client-http'
import type { AnnotationAttachments } from './attachments'
import {
  base,
  stamp,
  useData,
  errorText,
  post,
  quoteRequests,
  useSnapshot
} from '../../../dsh-px-workspace/src/client/data'
import { useDraft } from '../../../dsh-px-workspace/src/client/drafts'
import { ConfirmDelete } from '../../../shared/ui'
import { StorageNotice } from '../../../dsh-px-workspace/src/client/storage-notice'
import { validNoteDraft } from '../../../dsh-px-workspace/src/client/draft-validation'
import { quoteWhitespace } from '../../../shared/quote-whitespace'
type Source = Message & { length: number; offset: number; nextOffset: number | null; rendered?: boolean }
interface NoteDraft {
  source: Source | null
  quote: string
  note: string
  editing: Annotation | null
  initialized: boolean
  requestToken?: string
  collapsed: boolean
  dirty: boolean
}
interface SourceChoice {
  id: string
  existing: Annotation | null
  offset: number
  quote?: string
}
export function NotesPanel({
  ctx,
  scope,
  visible,
  tab,
  attachments
}: Panel & { ctx: Client; attachments: AnnotationAttachments }): unknown {
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
  const [editor, setEditor, draftWarning, draftAvailable, clearDraft, unreadableDraft] = useDraft<NoteDraft>(
    `notes:${scope.sessionId}`,
    () => ({
      source: null,
      quote: '',
      note: '',
      editing: null,
      initialized: false,
      collapsed: false,
      dirty: false,
      requestToken: ''
    }),
    validNoteDraft
  )
  const { source, quote, note, editing } = editor
  const resetEditor = (): void =>
    clearDraft({
      source: null,
      quote: '',
      note: '',
      editing: null,
      initialized: true,
      collapsed: false,
      dirty: false,
      requestToken: ''
    })
  const setQuote = (quote: string): void => setEditor((old) => ({ ...old, quote, dirty: true }))
  const setNote = (note: string): void => setEditor((old) => ({ ...old, note, dirty: true }))
  const [notice, setNotice] = useState(''),
    [failure, setFailure] = useState(''),
    [localBusy, setBusy] = useState(false)
  const [operationBusy, runOperation] = useOperation(`notes:${scope.sessionId}`)
  const busy = localBusy || operationBusy
  const [replacement, setReplacement] = useState<SourceChoice | null>(null)
  const [sourceRetry, setSourceRetry] = useState<SourceChoice | null>(null)
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
  async function choose(
    id: string,
    existing: Annotation | null = null,
    offset = 0,
    replace = false,
    request?: { token: string } | 'initial',
    selectedQuote?: string
  ): Promise<void> {
    if (operationBusy || !draftAvailable) return
    const pending = quoteRequests.getSnapshot()[scope.sessionId]
    const requestToken = typeof request === 'object' ? request.token : undefined
    if (requestToken && pending?.token !== requestToken) return
    if (request === 'initial' && pending) return
    if (request === undefined) {
      // A direct list/edit/retry choice is newer than any queued quote request.
      // Claim it before consuming that request so initial metadata cannot return.
      setEditor((old) => ({ ...old, initialized: true, requestToken: pending?.token ?? old.requestToken }))
      if (pending) quoteRequests.consume(scope.sessionId, pending.token)
    }
    if ((editor.dirty || note !== (editing?.note ?? '')) && !replace) {
      // Keep the existing draft while the user decides. A consumed request must
      // not expose the tab's old initial message as a new selection.
      setEditor((old) => ({ ...old, initialized: true, requestToken: requestToken ?? old.requestToken }))
      if (requestToken) quoteRequests.consume(scope.sessionId, requestToken)
      setReplacement({ id, existing, offset, quote: selectedQuote })
      return
    }
    setReplacement(null)
    setSourceRetry(null)
    const rev = ++revision.current
    sourceRequest.current?.abort()
    const controller = new AbortController()
    sourceRequest.current = controller
    setBusy(true)
    setFailure('')
    setNotice('')
    try {
      const value =
        selectedQuote === undefined
          ? await requestJson<Source>(
              `${base}/message?sessionId=${encodeURIComponent(scope.sessionId)}&messageId=${encodeURIComponent(id)}&offset=${offset}`,
              { signal: controller.signal }
            )
          : await requestJson<Source>(`${base}/selection`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: scope.sessionId, messageId: id, quote: selectedQuote }),
              signal: controller.signal
            })
      if (rev !== revision.current || !active.current) return
      setEditor({
        source: value,
        editing: existing,
        quote: existing?.quote ?? selectedQuote ?? value.text.slice(0, 8000),
        note: existing?.note ?? '',
        initialized: true,
        collapsed: false,
        dirty: false,
        requestToken: requestToken ?? ''
      })
      // Retain the selection until its source is loaded. Clearing it earlier
      // lets the initial tab.meta fallback abort a newer in-flight selection.
      if (requestToken) quoteRequests.consume(scope.sessionId, requestToken)
    } catch (e) {
      if (active.current && rev === revision.current && !controller.signal.aborted) {
        setFailure(errorText(e))
        setSourceRetry({ id, existing, offset, quote: selectedQuote })
      }
    } finally {
      if (active.current && rev === revision.current) setBusy(false)
    }
  }
  useEffect(() => {
    const pending = quoteRequests.getSnapshot()[scope.sessionId]
    if (pending && pending.token !== editor.requestToken)
      void choose(pending.messageId, null, 0, false, { token: pending.token }, pending.quote)
    else if (!pending && !editor.initialized && tab.meta?.messageId)
      void choose(tab.meta.messageId, null, 0, false, 'initial')
  }, [selection, tab.meta?.messageId, operationBusy, draftAvailable])
  const draft = source
    ? { sessionId: scope.sessionId, messageId: source.id, seq: source.seq, quote, note }
    : null
  const validQuote =
    !!quote &&
    ((source?.rendered
      ? quoteWhitespace(source.text).includes(quoteWhitespace(quote))
      : !!source?.text.includes(quote)) ||
      editing?.quote === quote)
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
  function insert(a: Pick<Annotation, 'sessionId' | 'seq' | 'quote' | 'note'> & Partial<Annotation>): void {
    void action(async () => {
      const saved = a.id ? (a as Annotation) : await post<Annotation>('annotations', { action: 'save', ...a })
      attachments.attach(saved)
    }, '已添加批注附件，请检查后发送。')
  }
  return (
    <div className="px-ui px-panel">
      <h3>引用与批注</h3>
      <p className="px-muted">这里管理已保存的批注。想对一句话提意见，可直接在对话中选中文字，点击“批注”。</p>
      {draftWarning ? <p role="alert">{draftWarning}</p> : null}
      {unreadableDraft ? (
        <ConfirmDelete label="放弃无法恢复的草稿" onConfirm={async () => resetEditor()} />
      ) : null}
      <StorageNotice
        visible={visible}
        onRestored={() => {
          notes.refresh()
          refresh()
        }}
      />
      {replacement ? (
        <section className="px-card" role="alert">
          <p>当前批注有未保存修改。保存或保留当前草稿后，再切换引用。</p>
          <div className="px-actions">
            <button onClick={() => setReplacement(null)}>保留当前草稿</button>
            <button
              disabled={busy}
              onClick={() =>
                void choose(
                  replacement.id,
                  replacement.existing,
                  replacement.offset,
                  true,
                  undefined,
                  replacement.quote
                )
              }
            >
              放弃修改并切换
            </button>
          </div>
        </section>
      ) : null}
      {source && editor.collapsed ? (
        <button onClick={() => setEditor((old) => ({ ...old, collapsed: false }))}>继续编辑草稿</button>
      ) : null}
      {failure || error || notes.error ? <p role="alert">{failure || error || notes.error}</p> : null}
      {sourceRetry ? (
        <button
          disabled={busy || !draftAvailable}
          onClick={() =>
            void choose(
              sourceRetry.id,
              sourceRetry.existing,
              sourceRetry.offset,
              false,
              undefined,
              sourceRetry.quote
            )
          }
        >
          重试读取原文
        </button>
      ) : null}
      {notice ? (
        <p role="status" className="px-feedback">
          {notice}
        </p>
      ) : null}
      {source && !editor.collapsed ? (
        <section className="px-card" aria-label="批注编辑器">
          <fieldset disabled={busy || !draftAvailable}>
            <h4>
              {source.role === 'user' ? '用户' : '助手'} · 记录 {source.seq}
            </h4>
            <label>
              消息正文（可选中一段作为引用）
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
            <p className="px-muted">可选中上方正文，也可删去不需要的部分；引用须对应这条消息的连续内容。</p>
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
                    clearDraft({ ...editor, editing: saved, dirty: false })
                    notes.refresh()
                    try {
                      attachments.attach(saved)
                    } catch (error) {
                      throw new Error(`批注已保存，但未能加入草稿：${errorText(error)}`)
                    }
                  }, '批注已保存并加入会话草稿，请检查后发送。')
                }
              >
                保存并加入会话
              </button>
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
                    clearDraft({ ...editor, editing: saved, dirty: false })
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
              <ConfirmDelete
                label="放弃草稿"
                disabled={busy}
                onConfirm={async () => {
                  resetEditor()
                  setReplacement(null)
                }}
              />
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
                    resetEditor()
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
