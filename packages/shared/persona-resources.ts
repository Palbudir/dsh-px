/** Additional constraints only. Native tool, sandbox and application permissions still decide access. */
export interface PersonaResources {
  revision: number
  tools: { mode: 'native' | 'selected'; names: string[] }
  channels: { mode: 'native' | 'selected'; accounts: Array<{ provider: string; accountId: string }> }
  /** Optional end of this grant. Expiry closes access, never restores a broader default. */
  expiresAt?: string
}

export function parsePersonaResources(value: unknown): PersonaResources | undefined {
  if (value === undefined) return
  const v = value as PersonaResources
  const id = (s: unknown, max: number) =>
    typeof s === 'string' && s.trim() === s && !!s && s.length <= max && !/[\r\n\0]/.test(s)
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 1 ||
    !v.tools ||
    !['native', 'selected'].includes(v.tools.mode) ||
    !Array.isArray(v.tools.names) ||
    v.tools.names.length > 400 ||
    v.tools.names.some((name) => !id(name, 160) || !/^[a-zA-Z0-9_.-]+$/.test(name)) ||
    new Set(v.tools.names).size !== v.tools.names.length ||
    !v.channels ||
    !['native', 'selected'].includes(v.channels.mode) ||
    !Array.isArray(v.channels.accounts) ||
    v.channels.accounts.length > 100 ||
    v.channels.accounts.some(
      (row) => !row || !id(row.provider, 80) || !/^[a-z0-9-]+$/.test(row.provider) || !id(row.accountId, 200)
    ) ||
    new Set(v.channels.accounts.map((row) => JSON.stringify([row.provider, row.accountId]))).size !==
      v.channels.accounts.length ||
    (v.expiresAt !== undefined &&
      (typeof v.expiresAt !== 'string' || !Number.isFinite(Date.parse(v.expiresAt))))
  )
    throw new Error('人格资源规则无效')
  return structuredClone(v)
}

export function personaToolAllowed(
  policy: PersonaResources | undefined,
  name: string,
  now = Date.now()
): boolean {
  if (policy?.expiresAt && Date.parse(policy.expiresAt) <= now) return false
  return !policy || policy.tools.mode === 'native' || policy.tools.names.includes(name)
}

export function personaChannelAllowed(
  policy: PersonaResources | undefined,
  provider: string,
  accountId: string,
  now = Date.now()
): boolean {
  if (policy?.expiresAt && Date.parse(policy.expiresAt) <= now) return false
  return (
    !policy ||
    policy.channels.mode === 'native' ||
    policy.channels.accounts.some((row) => row.provider === provider && row.accountId === accountId)
  )
}
