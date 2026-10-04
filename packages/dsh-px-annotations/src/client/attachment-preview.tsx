import { useEffect, useRef, useState } from 'react'
import type { AnnotationAttachments } from './attachments'
import type { Batch, ComposerState } from './attachment-model'
import { useSnapshot, errorText } from '../../../dsh-px-workspace/src/client/data'
import type { Client } from '../../../dsh-px-workspace/src/client/contracts'
import { selectedSession } from '../../../shared/native-navigation'
import { Icon } from '../../../shared/ui'

/** Mount with the native input seat; recovery never replaces the user's text. */
export function AttachmentRecovery({
  attachments,
  session,
  input
}: {
  attachments: AnnotationAttachments
  session: { sessionId: string }
  input: ComposerState
}): unknown {
  const ready = useSnapshot(attachments.activation)
  useEffect(() => {
    attachments.recover(session.sessionId)
  }, [attachments, session.sessionId, input.draftRev, input.phase, ready])
  return null
}

export function AttachmentPreview({
  ctx,
  attachments
}: {
  ctx: Client
  attachments: AnnotationAttachments
}): unknown {
  const chosen = useSnapshot(attachments)
  const [editing, setEditing] = useState<{ sessionId: string; id: string; note: string } | null>(null)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const root = useRef<any>(null)
  const [anchor, setAnchor] = useState({ left: 24, bottom: 140, height: 400 })
  useEffect(() => {
    if (!chosen) return
    // Pinned native ReferenceChipNode is the only DOM adapter used for placement.
    const chip = [...document.querySelectorAll('[data-composer-chip="px-annotations"]')].find((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    const rect = chip?.getBoundingClientRect()
    setAnchor({
      left: Math.max(8, Math.min(rect?.left ?? 24, window.innerWidth - 396)),
      bottom: rect ? window.innerHeight - rect.top + 8 : 140,
      height: Math.max(120, (rect?.top ?? window.innerHeight - 140) - 64)
    })
    const scroll = (event: Event): void => {
      if (!root.current?.contains(event.target)) attachments.close()
    }
    const resize = (): void => attachments.close()
    const outside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target)) attachments.close()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.isComposing) attachments.close()
    }
    document.addEventListener('scroll', scroll, true)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [chosen, attachments])
  useEffect(() => {
    const closeOther = (): void => {
      if (
        chosen &&
        selectedSession(
          ctx.sessions.list.getSnapshot(),
          ctx.layout?.panelInfo?.getSnapshot().activePanelId ?? null
        ) !== chosen.sessionId
      )
        attachments.close()
    }
    const off = ctx.sessions.list.subscribe(closeOther),
      offLayout = ctx.layout?.panelInfo?.subscribe(closeOther)
    return () => {
      off()
      offLayout?.()
    }
  }, [chosen, ctx, attachments])
  useEffect(() => {
    setError('')
  }, [chosen?.ref])
  if (!chosen) return null
  let batch: Batch | undefined,
    missing = ''
  try {
    batch = attachments.read(chosen.ref, chosen.sessionId)
  } catch (e) {
    missing = errorText(e)
  }
  const act = async (fn: () => Promise<void> | void): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      ref={root}
      className="px-ui"
      role="dialog"
      aria-label="待发送批注"
      style={{
        position: 'fixed',
        left: anchor.left,
        bottom: anchor.bottom,
        width: 380,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: anchor.height,
        overflow: 'auto',
        zIndex: 1050,
        pointerEvents: 'auto',
        padding: 14,
        boxSizing: 'border-box',
        background: 'var(--px-bg)',
        color: 'var(--px-fg)',
        border: '1px solid var(--px-border)',
        borderRadius: 12,
        boxShadow: '0 8px 28px #0002'
      }}
      onKeyDown={(e: any) => {
        if (e.key === 'Escape' && !e.nativeEvent?.isComposing && !busy) attachments.close()
      }}
    >
      <div className="px-actions" style={{ justifyContent: 'space-between', marginTop: 0 }}>
        <strong>{batch ? `${batch.notes.length} 条批注` : '待发送批注'}</strong>
        <button aria-label="关闭批注预览" disabled={busy} onClick={attachments.close}>
          <Icon name="close" />
        </button>
      </div>
      {missing || error ? <p role="alert">{missing || error}</p> : null}
      {batch?.notes.map((note, index) => (
        <article key={note.id} style={{ borderTop: '1px solid var(--px-border)', padding: '12px 0' }}>
          <div className="px-actions" style={{ justifyContent: 'space-between', margin: 0 }}>
            <small className="px-muted">{index + 1}. 所选文字</small>
            <span style={{ display: 'flex', gap: 6 }}>
              <button
                disabled={busy}
                aria-label={`编辑批注 ${index + 1}`}
                onClick={() => setEditing({ sessionId: chosen.sessionId, id: note.id, note: note.note })}
              >
                编辑
              </button>
              <button
                disabled={busy}
                aria-label={`移除批注 ${index + 1}`}
                onClick={() =>
                  void act(() => {
                    attachments.replace(
                      chosen.sessionId,
                      batch!.notes.filter((_, i) => i !== index),
                      chosen.ref
                    )
                    if (editing?.id === note.id) setEditing(null)
                  })
                }
              >
                <Icon name="close" />
              </button>
            </span>
          </div>
          <blockquote
            style={{
              margin: '8px 0',
              paddingLeft: 10,
              borderLeft: '2px solid var(--px-border)',
              maxHeight: 120,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere'
            }}
          >
            {note.quote}
          </blockquote>
          {editing?.sessionId === chosen.sessionId && editing.id === note.id ? (
            <>
              <textarea
                aria-label={`批注 ${index + 1} 的意见`}
                rows={2}
                maxLength={4000}
                disabled={busy}
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={editing.note}
                onChange={(e: any) => setEditing({ ...editing, note: e.target.value })}
              />
              <div className="px-actions">
                <button
                  className="px-primary"
                  disabled={busy}
                  onClick={() =>
                    void act(() => {
                      attachments.replace(
                        chosen.sessionId,
                        batch!.notes.map((n, i) => (i === index ? { ...n, note: editing.note } : n)),
                        chosen.ref
                      )
                      setEditing(null)
                    })
                  }
                >
                  保存修改
                </button>
                <button disabled={busy} onClick={() => setEditing(null)}>
                  取消
                </button>
              </div>
            </>
          ) : (
            <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              <span className="px-muted">我的批注：</span>
              {note.note || '仅引用'}
            </p>
          )}
        </article>
      ))}
      <button
        disabled={busy}
        onClick={() =>
          void act(() => {
            attachments.replace(chosen.sessionId, [], chosen.ref)
            setEditing(null)
          })
        }
      >
        全部移除
      </button>
      <p className="px-muted" style={{ marginBottom: 0 }}>
        随消息发送；这里的修改仅影响待发副本。
      </p>
    </div>
  )
}
