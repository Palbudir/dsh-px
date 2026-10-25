import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction/checkpoint'

/** Keep automatic pressure from repeatedly rewriting a lone, already-small checkpoint. */
export function skipRepeatedCheckpoint(
  agent: any,
  range: { start: number; end: number },
  measurement: { nodes?: readonly { seq: number; tokens: number }[] },
  spec: { maxTokens?: number }
): boolean {
  if (!range || range.start !== range.end || !Number.isSafeInteger(range.start)) return false
  if (!Number.isSafeInteger(spec?.maxTokens) || spec.maxTokens! <= 0) return false
  const priced = measurement?.nodes?.find((node) => node.seq === range.start)
  if (!priced || !Number.isFinite(priced.tokens) || priced.tokens <= 0 || priced.tokens > spec.maxTokens!)
    return false
  const event = agent.session?.eventAt?.(range.start)
  return (
    event?.type === 'user/message' && !!event.data?.source && isCompactCheckpointSource(event.data.source)
  )
}
