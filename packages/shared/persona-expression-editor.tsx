import { controlStyle } from './ui'
import { EXPRESSION_STYLES, expressionStarter, type PersonaExpression } from './persona-expression'
import { SCENE_LABELS, type PersonaSceneRule } from './persona-scenes'

export function PersonaExpressionEditor({
  value,
  disabled,
  onChange
}: {
  value: PersonaExpression | null
  disabled: boolean
  onChange: (value: PersonaExpression | null) => void
}): unknown {
  const editScene = (id: string, patch: Partial<PersonaSceneRule>) => {
    if (value)
      onChange({
        ...value,
        scenes: value.scenes?.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
      })
  }
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: '16px 0' }}>
      <legend>性格与场景表达</legend>
      <p style={{ opacity: 0.7 }}>
        同一人格可以按对象和场合调整说法。这里只配置表达与协作方式；资料可见范围和实际工具权限分别管理。
      </p>
      <label>
        表达起点
        <select
          aria-label="人格表达起点"
          style={{ ...controlStyle, marginLeft: 8 }}
          value={value?.style ?? ''}
          onChange={(e: any) => {
            const style = e.target.value as PersonaExpression['style'] | ''
            if (!style) return onChange(null)
            if (style === 'custom') return onChange({ ...(value ?? expressionStarter('custom')), style })
            if (
              value &&
              !window.confirm('用所选起点替换当前尚未保存的公开表达内容？私人协作要求和记忆不变。')
            )
              return
            onChange({ ...expressionStarter(style), ...(value?.scenes ? { scenes: value.scenes } : {}) })
          }}
        >
          <option value="">沿用原有配置</option>
          {EXPRESSION_STYLES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {value && (
        <>
          <p style={{ opacity: 0.7 }}>起点只填入下面的文字；可以直接修改，保存后的实际文字决定表达。</p>
          {(
            [
              ['instructions', '性格与语气', 4000, 5],
              ['principles', '稳定原则', 2000, 3],
              ['examples', '说话示例', 4000, 4]
            ] as const
          ).map(([key, label, max, rows]) => (
            <label key={key} style={{ display: 'block', marginTop: 12 }}>
              {label}
              <textarea
                aria-label={label}
                rows={rows}
                maxLength={max}
                value={value[key]}
                style={{ ...controlStyle, width: '100%', resize: 'vertical' }}
                onChange={(e: any) => onChange({ ...value, [key]: e.target.value })}
              />
            </label>
          ))}
          <details style={{ marginTop: 16 }}>
            <summary>按场景与对象调整（可选）</summary>
            <p className="px-muted">
              基础表达用于所有场合。以下规则只用于匹配的渠道和对象；对象使用真实编号，不按昵称匹配。最多 12
              条、合计 4000 字。未填写的规则不生效，内容会提供给对应场合的模型。
            </p>
            {(value.scenes ?? []).map((rule, index) => (
              <div key={rule.id} className="px-card" style={{ marginTop: 8 }}>
                <div className="px-actions">
                  <label>
                    场合{' '}
                    <select
                      aria-label={`场景 ${index + 1} 场合`}
                      value={rule.scene}
                      onChange={(event: any) => editScene(rule.id, { scene: event.target.value })}
                    >
                      {Object.entries(SCENE_LABELS).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    渠道{' '}
                    <select
                      aria-label={`场景 ${index + 1} 渠道`}
                      value={rule.provider ?? ''}
                      onChange={(event: any) =>
                        editScene(rule.id, {
                          provider: event.target.value || undefined,
                          accountId: undefined,
                          conversationId: undefined,
                          participantId: undefined
                        })
                      }
                    >
                      <option value="">所有已接入渠道</option>
                      <option value="local">本机</option>
                      <option value="qq">QQ</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...value, scenes: value.scenes?.filter((item) => item.id !== rule.id) })
                    }
                  >
                    移除此规则
                  </button>
                </div>
                {rule.provider === 'qq' && (
                  <label>
                    对象 QQ 号（留空适用于该渠道）
                    <input
                      aria-label={`场景 ${index + 1} 对象编号`}
                      maxLength={200}
                      value={rule.participantId ?? ''}
                      onChange={(event: any) =>
                        editScene(rule.id, { participantId: event.target.value.trim() || undefined })
                      }
                    />
                  </label>
                )}
                <textarea
                  aria-label={`场景 ${index + 1} 表达要求`}
                  rows={3}
                  maxLength={1000}
                  value={rule.instructions}
                  placeholder="例如：交付工作时先说结果，必要时给出依据；闲聊时可以自然活泼。"
                  style={{ ...controlStyle, width: '100%', marginTop: 8 }}
                  onChange={(event: any) => editScene(rule.id, { instructions: event.target.value })}
                />
              </div>
            ))}
            <button
              type="button"
              disabled={(value.scenes?.length ?? 0) >= 12}
              onClick={() =>
                onChange({
                  ...value,
                  scenes: [
                    ...(value.scenes ?? []),
                    { id: crypto.randomUUID(), scene: 'any', instructions: '' }
                  ]
                })
              }
            >
              添加场景规则
            </button>
          </details>
        </>
      )}
    </fieldset>
  )
}
