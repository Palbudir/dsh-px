import { useEffect, useRef, useState } from 'react'
import type { Client } from '../../../dsh-px-workspace/src/client/contracts'
import type { Annotation } from '../../../dsh-px-workspace/src/model'
import { post, errorText, useOperation } from '../../../dsh-px-workspace/src/client/data'
import { useDraft } from '../../../dsh-px-workspace/src/client/drafts'
import { validNoteDraft } from '../../../dsh-px-workspace/src/client/draft-validation'
import type { AnnotationAttachments } from './attachments'
import { selectedSession } from '../../../shared/native-navigation'
import { Icon, ConfirmDelete } from '../../../shared/ui'
import type { SentenceSelection } from './selection'

interface Draft {
  note: string
  saved: Annotation | null
}

/** A selection owns its draft, so another selection never needs a replacement dialog. */
export function QuickNote({
  ctx,
  attachments,
  selection,
  lock,
  close
}: {
  ctx: Client
  attachments: AnnotationAttachments
  selection: SentenceSelection
  lock: (value: boolean) => void
  close: () => void
}): unknown {
  const key = `quick-note:${JSON.stringify([selection.sessionId, selection.messageId, selection.quote])}`
  const [draft, setDraft, warning, available, clearDraft, unreadable] = useDraft<Draft>(
    key,
    () => ({ note: '', saved: null }),
    (value) =>
      typeof value.note === 'string' &&
      value.note.length <= 4000 &&
      validNoteDraft({ source: null, editing: value.saved }) &&
      (!value.saved ||
        (value.saved.sessionId === selection.sessionId &&
          value.saved.messageId === selection.messageId &&
          value.saved.quote === selection.quote &&
          Number.isSafeInteger(value.saved.seq)))
  )
  const [expanded, expand] = useState(Boolean(draft.note || draft.saved || warning))
  const [failure, fail] = useState('')
  const [busy, run] = useOperation(key)
  const running = useRef(false),
    alive = useRef(true),
    root = useRef<any>(null)
  const [viewport, resize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    alive.current = true
    const update = (): void => resize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', update)
    return () => {
      alive.current = false
      window.removeEventListener('resize', update)
    }
  }, [])
  useEffect(() => {
    lock(expanded || busy)
    if (expanded) root.current?.querySelector('textarea')?.focus()
    return () => lock(false)
  }, [expanded, busy])
  useEffect(() => {
    if (!expanded) return
    const outside = (event: PointerEvent): void => {
      if (!running.current && !root.current?.contains(event.target)) close()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.isComposing && !running.current) {
        event.preventDefault()
        close()
      }
    }
    const scroll = (event: Event): void => {
      if (!running.current && !root.current?.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    document.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('scroll', scroll, true)
    }
  }, [expanded, close])
  const assertCurrent = (): void => {
    if (
      selectedSession(
        ctx.sessions.list.getSnapshot(),
        ctx.layout?.panelInfo?.getSnapshot().activePanelId ?? null
      ) !== selection.sessionId
    )
      throw new Error('会话已切换；批注已保留，请回到原会话继续')
  }
  async function add(): Promise<void> {
    if (running.current || busy || !available) return
    running.current = true
    lock(true)
    fail('')
    try {
      await run(async () => {
        assertCurrent()
        // The server validates the selected quote against the durable message.
        // Retain the saved identity if native draft insertion needs a retry.
        let saved = draft.saved
        if (!saved || saved.note !== draft.note) {
          saved = await post<Annotation>('annotations', {
            action: 'save',
            sessionId: selection.sessionId,
            messageId: selection.messageId,
            quote: selection.quote,
            note: draft.note,
            ...(saved ? { id: saved.id, updatedAt: saved.updatedAt } : {})
          })
          setDraft({ note: draft.note, saved })
        }
        if (!alive.current) return
        assertCurrent()
        attachments.attach(saved)
        clearDraft()
        window.getSelection()?.removeAllRanges()
        close()
      })
    } catch (error) {
      if (alive.current) {
        fail(errorText(error))
        expand(true)
      }
    } finally {
      running.current = false
    }
  }
  const width = Math.min(expanded ? 340 : 240, viewport.width - 16)
  return (
    <div
      ref={root}
      className="px-ui px-selection-action"
      role={expanded ? 'dialog' : 'group'}
      aria-label={expanded ? '添加批注' : '选中文字操作'}
      style={{
        position: 'fixed',
        zIndex: 1000,
        pointerEvents: 'auto',
        boxSizing: 'border-box',
        animation: 'px-feedback-in 130ms ease-out',
        width,
        left: Math.max(8, Math.min(selection.left, viewport.width - width - 8)),
        top: Math.max(48, Math.min(selection.top, viewport.height - (expanded ? 260 : 52))),
        maxHeight: Math.max(100, viewport.height - 64),
        overflowY: 'auto',
        background: 'var(--px-bg)',
        border: '1px solid var(--px-border)',
        borderRadius: 12,
        boxShadow: '0 6px 24px #0002',
        padding: expanded ? 12 : 4
      }}
    >
      {expanded ? (
        <>
          <blockquote
            style={{
              margin: '0 0 8px',
              paddingLeft: 8,
              borderLeft: '2px solid var(--px-border)',
              color: 'var(--px-muted)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              overflowWrap: 'anywhere'
            }}
            title={selection.quote}
          >
            {selection.quote}
          </blockquote>
          <textarea
            aria-label="批注"
            placeholder="写下你的想法…"
            rows={2}
            maxLength={4000}
            style={{ width: '100%', resize: 'vertical', minHeight: 64, maxHeight: 140 }}
            value={draft.note}
            disabled={busy || !available}
            onChange={(event: any) => setDraft({ ...draft, note: event.target.value })}
            onKeyDown={(event: any) => {
              if (
                event.key === 'Enter' &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent?.isComposing
              ) {
                event.preventDefault()
                void add()
              }
            }}
          />
          {warning ? <p className="px-muted">{warning}</p> : null}
          {unreadable ? (
            <ConfirmDelete label="放弃无法恢复的草稿" onConfirm={async () => clearDraft()} />
          ) : null}
          {failure ? <p role="alert">{failure}</p> : null}
          <div className="px-actions" style={{ marginBottom: 0, justifyContent: 'space-between' }}>
            <button disabled={busy} onClick={close} title="草稿保留，重新选中原句可继续">
              收起
            </button>
            <button
              className="px-primary"
              disabled={busy || !available}
              onClick={() => void add()}
              title="Ctrl+Enter · 加入草稿，不会自动发送"
            >
              {busy ? '正在添加…' : '加入对话'}
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            disabled={busy || !available}
            onPointerDown={(e: any) => e.preventDefault()}
            onClick={() => void add()}
          >
            添加到对话
          </button>
          <button
            disabled={busy}
            onPointerDown={(e: any) => e.preventDefault()}
            onClick={() => {
              lock(true)
              expand(true)
            }}
          >
            <Icon name="note" />
            批注
          </button>
        </div>
      )}
    </div>
  )
}
