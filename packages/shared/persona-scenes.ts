export interface PersonaSceneRule {
  id: string
  scene: 'any' | 'chat' | 'work' | 'delivery'
  provider?: string
  accountId?: string
  conversationId?: string
  participantId?: string
  instructions: string
}
export interface PersonaInteraction {
  provider: string
  accountId?: string
  conversationId?: string
  participants: readonly string[]
  activity: 'conversation' | 'work' | 'auto'
}
export const SCENE_LABELS = {
  any: '任何场合',
  chat: '日常交流',
  work: '协作工作',
  delivery: '正式交付'
} as const

export function parseSceneRules(value: unknown): PersonaSceneRule[] | undefined {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > 12) throw Error('场景表达最多 12 条')
  const ids = new Set<string>()
  const rules = value.map((rule) => {
    if (
      !rule ||
      typeof rule !== 'object' ||
      Array.isArray(rule) ||
      Object.keys(rule).some(
        (key) =>
          ![
            'id',
            'scene',
            'provider',
            'accountId',
            'conversationId',
            'participantId',
            'instructions'
          ].includes(key)
      ) ||
      typeof rule.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(rule.id) ||
      ids.has(rule.id) ||
      !Object.hasOwn(SCENE_LABELS, rule.scene) ||
      typeof rule.instructions !== 'string' ||
      rule.instructions.length > 1000 ||
      rule.instructions.includes('\0')
    )
      throw Error('场景表达格式无效')
    ids.add(rule.id)
    for (const key of ['provider', 'accountId', 'conversationId', 'participantId'])
      if (
        rule[key] !== undefined &&
        (typeof rule[key] !== 'string' ||
          !rule[key].trim() ||
          rule[key].length > 200 ||
          /[\r\n\0]/.test(rule[key]))
      )
        throw Error('场景对象标识无效')
    if (rule.provider && !/^[a-z][a-z0-9.-]{0,79}$/.test(rule.provider)) throw Error('场景渠道无效')
    if ((rule.accountId || rule.conversationId || rule.participantId) && !rule.provider)
      throw Error('指定账号、对象或聊天时必须同时选择渠道')
    return { ...rule, instructions: rule.instructions.trim() } as PersonaSceneRule
  })
  if (rules.reduce((size, rule) => size + rule.instructions.length, 0) > 4000)
    throw Error('场景表达合计最多 4000 字')
  return rules
}

/** Identity selectors use trusted source IDs. Scene choice remains a communication rule, not an ACL. */
export function renderSceneRules(
  rules: readonly PersonaSceneRule[] | undefined,
  context?: PersonaInteraction
): string {
  if (!rules?.length || !context) return ''
  const matching = rules
    .filter(
      (rule) =>
        rule.instructions.trim() &&
        (!rule.provider || rule.provider === context.provider) &&
        (!rule.accountId || rule.accountId === context.accountId) &&
        (!rule.conversationId || rule.conversationId === context.conversationId) &&
        (!rule.participantId || context.participants.includes(rule.participantId))
    )
    .sort(
      (a, b) =>
        [a.provider, a.accountId, a.conversationId, a.participantId].filter(Boolean).length -
        [b.provider, b.accountId, b.conversationId, b.participantId].filter(Boolean).length
    )
  if (!matching.length) return ''
  return (
    '对象与场景表达（只调整沟通方式，不改变资料受众、稳定原则或执行权限；按当前实际场景应用，对象规则仅用于与该对象交流）：\n' +
    matching
      .map(
        (rule) =>
          `${SCENE_LABELS[rule.scene]}${rule.participantId ? '，对象 ' + rule.participantId : ''}：${rule.instructions}`
      )
      .join('\n')
  )
}
