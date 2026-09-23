import { useState } from 'react'
import { createDraftCell } from '../../../shared/draft-store'
import { useSnapshot } from './data'

const cells = new Map<string, ReturnType<typeof createDraftCell<any>>>()
/** The native sidebar unmounts inactive bodies. Keep edits above that lifetime. */
export function useDraft<T extends object>(
  key: string,
  initial: () => T
): [T, (next: T | ((old: T) => T)) => void, string] {
  const [cell] = useState(() => {
    let cell = cells.get(key)
    if (!cell) {
      let storage: Storage | undefined
      try {
        storage = sessionStorage
      } catch {
        /* memory only */
      }
      cell = createDraftCell('dsh-px.draft.v1.' + key, initial(), storage)
      cells.set(key, cell)
    }
    return cell as ReturnType<typeof createDraftCell<T>>
  })
  const value = useSnapshot(cell)
  return [
    value,
    (next) => {
      cell.set(next)
    },
    cell.isPersisted() ? '' : '浏览器存储不可用，本次页面内仍保留草稿；刷新前请保存。'
  ]
}
