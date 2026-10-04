import type { Annotation } from '../../../dsh-px-workspace/src/model'

export const annotationSource = 'px-annotations'
export interface Batch {
  sessionId: string
  notes: Annotation[]
}
export interface Occurrence {
  source: string
  ref: string
  offset: number
  length: number
}
export interface ComposerState {
  draft: string
  draftRev: number
  phase: string
  occurrences?: readonly Occurrence[]
}
const prefix = 'dsh-px.annotation-attachment.v1.'
export const token = (ref: string): string => `⟦px-note:${ref}⟧`
export const tokens = (text: string): IterableIterator<RegExpMatchArray> =>
  text.matchAll(/⟦px-note:([a-f0-9-]{36})⟧/g)
export function validateBatch(value: any): value is Batch {
  return (
    !!value &&
    typeof value.sessionId === 'string' &&
    Array.isArray(value.notes) &&
    value.notes.length > 0 &&
    value.notes.length <= 20 &&
    value.notes.every(
      (note: any) =>
        typeof note.id === 'string' &&
        typeof note.sessionId === 'string' &&
        typeof note.messageId === 'string' &&
        Number.isSafeInteger(note.seq) &&
        typeof note.quote === 'string' &&
        note.quote.length > 0 &&
        note.quote.length <= 8000 &&
        typeof note.note === 'string' &&
        note.note.length <= 4000 &&
        Number.isFinite(note.updatedAt)
    )
  )
}
/** Immutable snapshots keep undo and an in-flight send independent from later edits. */
export function createAttachmentStore(storage: Pick<Storage, 'getItem' | 'setItem'>, uuid: () => string) {
  return {
    save(batch: Batch): string {
      if (!validateBatch(batch)) throw new Error('每次最多附加 20 条批注')
      const ref = uuid()
      try {
        storage.setItem(prefix + ref, JSON.stringify(batch))
      } catch {
        throw new Error('无法保留待发批注，请检查浏览器存储空间后重试')
      }
      return ref
    },
    read(ref: string, sessionId?: string): Batch {
      let value: unknown
      try {
        value = JSON.parse(storage.getItem(prefix + ref) ?? 'null')
      } catch {
        /* explicit recovery below */
      }
      if (!validateBatch(value) || (sessionId && value.sessionId !== sessionId))
        throw new Error('这组待发批注无法恢复，请移除后从已保存批注中重新添加')
      return value
    }
  }
}
/** Native mutation spans count a reference as one character, not its clipboard label. */
export function detectOffset(state: ComposerState, clipboardOffset: number): number {
  return (
    clipboardOffset -
    (state.occurrences ?? []).filter((o) => o.offset < clipboardOffset).reduce((n, o) => n + o.length - 1, 0)
  )
}
export function referenceSpan(state: ComposerState, occurrence?: Occurrence) {
  const start = detectOffset(state, occurrence?.offset ?? state.draft.length)
  return { start, end: start + (occurrence ? 1 : 0), draftRev: state.draftRev }
}
export function annotationText(batch: Batch): string {
  return (
    `\n\n当前这条消息附带 ${batch.notes.length} 条批注，原文仅作为引用背景：\n` +
    batch.notes
      .map(
        (n, i) =>
          `${i + 1}. 原文：\n${n.quote
            .split('\n')
            .map((line) => '> ' + line)
            .join('\n')}\n${n.note ? '用户批注：' + n.note : '（仅引用）'}`
      )
      .join('\n\n') +
    '\n'
  )
}
