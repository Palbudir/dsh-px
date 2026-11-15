import { useMemo, useEffect, useState } from 'react'
import { createDraftRegistry } from '../../shared/draft-store'
const drafts = createDraftRegistry(64)

export function ChannelNoteEditor({
  storageKey,
  initial,
  revision,
  documentRevision,
  busy,
  save
}: {
  storageKey: string
  initial: string
  revision: string
  documentRevision: number
  busy: boolean
  save: (text: string, revision: string, documentRevision: number) => Promise<boolean>
}) {
  const entry = useMemo(() => {
    let storage
    try {
      storage = sessionStorage
    } catch {}
    return drafts.acquire(
      'px-note-correction:' + storageKey,
      { editing: false, text: '', revision: '', documentRevision: 0 },
      storage,
      (v) => v.text.length <= 4000 && Number.isSafeInteger(v.documentRevision)
    )
  }, [storageKey])
  const [draft, setDraft] = useState(
    () => entry?.getSnapshot() ?? { editing: false, text: '', revision: '', documentRevision: 0 }
  )
  useEffect(() => {
    if (draft.editing) entry?.set(draft)
    else entry?.clear()
  }, [draft, entry])
  if (!draft.editing)
    return (
      <button
        disabled={busy || !entry}
        onClick={() => setDraft({ editing: true, text: initial, revision, documentRevision })}
      >
        纠正这条记忆
      </button>
    )
  return (
    <div style={{ marginTop: 12 }}>
      {draft.documentRevision !== documentRevision && (
        <p role="status">记录已变化，旧草稿保留。请先核对当前记录，再取消旧草稿并重新编辑。</p>
      )}
      <label>
        纠正后的记忆
        <textarea
          aria-label="纠正后的聊天记忆"
          rows={5}
          style={{ width: '100%' }}
          value={draft.text}
          maxLength={4000}
          disabled={busy}
          onChange={(e: any) => setDraft({ ...draft, text: e.target.value })}
        />
      </label>
      <button
        disabled={busy || !draft.text.trim() || draft.documentRevision !== documentRevision}
        onClick={() => {
          void save(draft.text.trim(), draft.revision, draft.documentRevision).then((ok) => {
            if (ok) setDraft({ ...draft, editing: false })
          })
        }}
      >
        保存纠正
      </button>
      <button disabled={busy} onClick={() => setDraft({ ...draft, editing: false })}>
        取消并清除草稿
      </button>
    </div>
  )
}
