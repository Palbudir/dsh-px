import { useState } from 'react'

const labels = [
  ['confirmed', '确认正确'],
  ['useful', '应用有帮助'],
  ['not-applicable', '此处不适用'],
  ['disputed', '内容不正确']
] as const
export function MemoryFeedbackPanel({
  value,
  busy,
  disabled,
  submit,
  readSource
}: {
  value: any
  busy: boolean
  disabled?: boolean
  submit: (kind: string, reason: string) => Promise<void>
  readSource?: (ref: { sessionId: string; seq: number }) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <details style={{ marginTop: 12 }}>
      <summary>
        使用反馈 · {value?.disputed ? '需纠正' : value?.confirmed ? '用户已确认' : '尚未确认'} · 权重{' '}
        {value?.strength ?? 0}
      </summary>
      <p className="px-muted">
        反馈绑定当前修订，只影响此人格在当前受众下的使用。重复点击不累计票数。标为不正确后停止采用，修改正文后再核对；正文的纠正和遗忘仍通过对应编辑入口完成。
      </p>
      <label>
        反馈原因{' '}
        <input
          aria-label="记忆反馈原因"
          value={reason}
          maxLength={1000}
          disabled={busy || disabled}
          onChange={(e: any) => setReason(e.target.value)}
        />
      </label>
      <div className="px-actions">
        {labels.map(([kind, label]) => (
          <button
            key={kind}
            disabled={busy || disabled || !reason.trim()}
            onClick={() => {
              void submit(kind, reason.trim())
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {(value?.entries ?? []).map((entry: any, index: number) => (
        <div key={index} style={{ marginTop: 8 }}>
          {labels.find(([kind]) => kind === entry.kind)?.[1] ?? entry.kind} ·{' '}
          {entry.actor === 'human' ? '用户反馈' : '模型应用记录'}：{entry.reason}
          {entry.evidence && readSource && (
            <button disabled={busy} onClick={() => readSource(entry.evidence)}>
              读取原始依据
            </button>
          )}
        </div>
      ))}
    </details>
  )
}
