import { controlStyle } from './ui'
import { EXPRESSION_STYLES, expressionStarter, type PersonaExpression } from './persona-expression'

export function PersonaExpressionEditor({
  value,
  disabled,
  onChange
}: {
  value: PersonaExpression | null
  disabled: boolean
  onChange: (value: PersonaExpression | null) => void
}): unknown {
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: '16px 0' }}>
      <legend>公开的性格与表达</legend>
      <p style={{ opacity: 0.7 }}>
        QQ
        群聊、私聊和工作会话共用这份表达配置。只填写可以公开的性格与原则，私人资料放在私人协作要求或记忆中。
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
            onChange(expressionStarter(style))
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
        </>
      )}
    </fieldset>
  )
}
