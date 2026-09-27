const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
export function validNoteDraft(value: { source: unknown; editing: unknown }): boolean {
  const source = value.source
  if (
    source !== null &&
    (!record(source) ||
      typeof source.id !== 'string' ||
      typeof source.text !== 'string' ||
      !finite(source.seq) ||
      !finite(source.length) ||
      !finite(source.offset) ||
      (source.nextOffset !== null && !finite(source.nextOffset)) ||
      !['user', 'assistant'].includes(String(source.role)))
  )
    return false
  const editing = value.editing
  return (
    editing === null ||
    (record(editing) &&
      typeof editing.id === 'string' &&
      typeof editing.messageId === 'string' &&
      typeof editing.sessionId === 'string' &&
      typeof editing.quote === 'string' &&
      typeof editing.note === 'string' &&
      finite(editing.updatedAt))
  )
}
export function validScheduleDraft(value: { editing: unknown; kind: string }): boolean {
  if (!['once', 'interval', 'daily'].includes(value.kind)) return false
  const editing = value.editing
  if (editing === null) return true
  if (
    !record(editing) ||
    typeof editing.id !== 'string' ||
    typeof editing.sessionId !== 'string' ||
    typeof editing.title !== 'string' ||
    typeof editing.prompt !== 'string' ||
    typeof editing.enabled !== 'boolean' ||
    !finite(editing.updatedAt) ||
    !record(editing.timing)
  )
    return false
  const rule = editing.timing
  return rule.kind === 'once'
    ? finite(rule.at)
    : rule.kind === 'interval'
      ? finite(rule.minutes)
      : rule.kind === 'daily' && typeof rule.time === 'string'
}
