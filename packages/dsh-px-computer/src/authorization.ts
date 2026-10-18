import type { Agent } from './runtime'

export type AccessPolicy = 'full' | 'ask' | 'never' | 'unknown'

/** Read the effective native policy, not model text or a cached grant from an earlier preset. */
export function accessPolicy(ctx: any, agent?: Agent): AccessPolicy {
  if (!agent) return 'unknown'
  const get = (name: string) => ctx.get?.(name) ?? ctx[name]
  try {
    const approval = get('approval')?.effectivePolicy?.(agent.session)
    if (approval === 'ask') return 'ask'
    if (approval !== 'never') return 'unknown'
    const presets = get('permissionPresets')
    const selected = presets?.current?.(agent.session)
    if (selected && selected !== 'auto' && selected !== 'custom') {
      const spec = presets.resolve(selected)
      if (spec.sandbox === 'danger-full-access' && spec.approval === 'never') return 'full'
    }
    return 'never'
  } catch {
    return 'unknown'
  }
}
