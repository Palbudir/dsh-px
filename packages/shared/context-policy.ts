export type ContextTier = 'minimum' | 'brief' | 'full'
export const TIER_LABELS: Record<ContextTier, string> = {
  minimum: '最低限度',
  brief: '简略',
  full: '完整'
}
export function positiveCapacity(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}
export function contextTier(capacity?: number): ContextTier {
  return !capacity || capacity <= 65_536 ? 'minimum' : capacity <= 262_144 ? 'brief' : 'full'
}
/** Unknown capacity selects the minimum injection policy; this is not a claim about server capacity. */
export function contextBudget(capacity?: number) {
  const tier = contextTier(capacity)
  const planningWindow = capacity ?? 32_768
  return {
    tier,
    capacity,
    outputTokens: Math.max(1, Math.floor(Math.min(planningWindow / 8, tier === 'full' ? 131_072 : 16_384))),
    headroomTokens: Math.max(1, Math.floor(Math.min(planningWindow / 16, 65_536))),
    summaryTokens: Math.max(1, Math.floor(Math.min(planningWindow / 16, 32_768))),
    retainRatio: 0.12,
    // The native engine also caps this by window - completion reserve - headroom.
    // Small windows otherwise re-summarize tiny prefixes while the current user input is pinned.
    thresholdRatio: tier === 'minimum' ? 0.85 : 0.75,
    memoryChars: tier === 'minimum' ? 2048 : tier === 'brief' ? 8192 : 24_000,
    handoffChars: tier === 'minimum' ? 2000 : tier === 'brief' ? 6000 : 12_000,
    ledgerChars: tier === 'minimum' ? 2400 : tier === 'brief' ? 8000 : 24_000
  }
}
/** Complete entries only; raw data remains retrievable via the ordinary native tools. */
export function budgetEntries<T>(entries: readonly T[], chars: number): { entries: T[]; omitted: number } {
  const selected: T[] = []
  let used = 2
  for (const entry of entries) {
    const cost = JSON.stringify(entry).length + 1
    if (used + cost > chars) continue
    selected.push(entry)
    used += cost
  }
  return { entries: selected, omitted: entries.length - selected.length }
}
export function assertSameTier(bound: ContextTier | undefined, target: ContextTier): void {
  if (bound && bound !== target)
    throw Object.assign(
      new Error(
        `本会话固定为「${TIER_LABELS[bound]}」档。所选模型属于「${TIER_LABELS[target]}」档，请新建接续会话。`
      ),
      { code: 'PX_CONTEXT_TIER_CHANGE' }
    )
}
