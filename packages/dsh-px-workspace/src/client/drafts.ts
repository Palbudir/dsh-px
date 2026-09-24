import { useState } from 'react'
import { createDraftCell, createDraftRegistry } from '../../../shared/draft-store'
import { useSnapshot, isOperationPending } from './data'

const prefix = 'dsh-px.draft.v1.'
const cells = createDraftRegistry(48, (key) => !isOperationPending(key.slice(prefix.length)))
/** The native sidebar unmounts inactive bodies. Keep edits above that lifetime. */
export function useDraft<T extends object>(
  key: string,
  initial: () => T,
  validate?: (value: T) => boolean
): [T, (next: T | ((old: T) => T)) => void, string, boolean, (cleanValue?: T) => void, boolean] {
  const [{ cell, available }] = useState(() => {
    let storage: Storage | undefined
    try {
      storage = sessionStorage
    } catch {
      /* memory only */
    }
    const seed = initial()
    const acquired = cells.acquire(prefix + key, seed, storage, validate)
    return { cell: acquired ?? createDraftCell(key, seed), available: Boolean(acquired) }
  })
  const value = useSnapshot(cell)
  return [
    value,
    (next) => {
      if (available) cell.set(next)
    },
    cell.isUnreadable()
      ? '此窗口草稿格式无法恢复，原记录尚未覆盖。确认放弃后可重新编辑。'
      : !available
        ? '未保存草稿缓存已满，已暂停新建编辑。请先保存已有草稿，再重新打开此面板。'
        : cell.isPersisted()
          ? ''
          : '窗口存储不可用，本次页面内仍保留草稿；刷新或关闭前请保存。',
    available && !cell.isUnreadable(),
    (cleanValue) => cell.clear(cleanValue),
    cell.isUnreadable()
  ]
}
