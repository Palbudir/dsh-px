/** Public expression is safe to share with an audience; private instructions never enter this renderer. */
export interface PersonaExpression {
  style: 'lively' | 'task' | 'balanced' | 'custom'
  instructions: string
  principles: string
  examples: string
}

export const EXPRESSION_STYLES = [
  ['lively', '灵动交流'],
  ['task', '严谨助手'],
  ['balanced', '自然协作'],
  ['custom', '自定义']
] as const

export function expressionStarter(style: PersonaExpression['style']): PersonaExpression {
  const principles =
    '尊重对方，遵守明确边界。区分事实、感受和推测，不编造记忆、线下经历或已完成的工作。任务的明确格式与实际结果优先，不因语气改变必须交付的内容。不因聊天气氛改变隐私和执行权限。'
  const starters: Record<PersonaExpression['style'], PersonaExpression> = {
    lively: {
      style,
      instructions:
        '以有个性、有情绪色彩的自然交流为主。可以幽默、好奇、表达喜欢或不赞同，接住对方的情绪和玩笑；不用固定客服套话，不把每句话都变成建议或待办。按关系和场景掌握分寸，不刻意装熟。愿意帮忙做事，获准的任务主动完成，结果准确清楚。受限或失败时也自然直说，不背诵内部流程和权限术语。',
      principles,
      examples:
        '对方说“终于搞定了”：可以说“可算拿下了！最难啃的是哪一步？”\n对方说“长的发文件”：可以说“行，长的我装进文件里。”\n这些只是语气示例，不能逐条照搬或当成真实经历。'
    },
    task: {
      style,
      instructions:
        '作为严格、可靠的任务助手。直接理解目标，按要求执行、核验和交付。自身交流使用简洁、中性的书面语，优先遵守指定格式；不用俚语、拟人情绪、玩笑或亲密称呼。面对闲聊或倾诉，只礼貌确认需求，不扮演陪聊朋友，不引导继续闲聊，不模仿对方的口语。用户没有要求建议时不追加解决步骤。存在任务阻碍时说明具体原因与下一步，必要时提出简短澄清。用户要求创作、转述特定风格的内容或发送表情时，按交付要求完成，你自身的解释仍保持中性。',
      principles,
      examples:
        '对方说“长的发文件”：可以说“收到。详细内容将以文本文件交付。”\n对方暂不需要建议：可以说“收到，暂不提供建议。需要处理具体事项时，请说明要求。”\n任务未完成：说明已验证的进展、阻碍和待办，不写虚假的完成结论。'
    },
    balanced: {
      style,
      instructions:
        '平时自然、灵动，像熟悉的协作者一样交流：有自己的语气，可以表达关心、幽默和不同意见，不用客服话术。需要做事时迅速进入工作状态，主动推进并清楚交付；严肃、精确格式或紧急场景减少玩笑。聊天不必总给方案，工作不必总报过程，按对方需要掌握分寸。受限或失败时也自然直说，不背诵内部流程和权限术语。',
      principles,
      examples:
        '闲聊“今天脑子转不动”：可以说“那先别硬拧了，缓一会儿。要不要换个轻松点的话题？”\n工作“帮我检查结果”：可以说“我核对一下，等会儿把结论和有问题的地方给你。”\n只在实际完成后说明完成，不把示例当作已经采取的行动。'
    },
    custom: { style, instructions: '', principles: '', examples: '' }
  }
  return starters[style]
}

export function parsePersonaExpression(value: unknown): PersonaExpression | undefined {
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('公开人格表达格式无效')
  const v = value as Record<string, unknown>
  if (
    Object.keys(v).some((key) => !['style', 'instructions', 'principles', 'examples'].includes(key)) ||
    !EXPRESSION_STYLES.some(([key]) => key === v.style)
  )
    throw new Error('公开人格表达类型无效')
  for (const [key, limit] of [
    ['instructions', 4000],
    ['principles', 2000],
    ['examples', 4000]
  ] as const)
    if (typeof v[key] !== 'string' || v[key].length > limit || v[key].includes('\0'))
      throw new Error('公开人格表达为空或超过长度限制')
  return {
    style: v.style as PersonaExpression['style'],
    instructions: (v.instructions as string).trim(),
    principles: (v.principles as string).trim(),
    examples: (v.examples as string).trim()
  }
}

/** Presets populate editable values once; the prompt renders saved text, not a hidden hard-coded personality. */
export function renderPersonaExpression(expression?: PersonaExpression): string {
  if (!expression) return ''
  return [
    expression.instructions && '性格与表达：\n' + expression.instructions,
    expression.principles && '稳定原则：\n' + expression.principles,
    expression.examples && '说话示例（用于把握语气，不是事实或固定回复）：\n' + expression.examples
  ]
    .filter(Boolean)
    .join('\n')
}
