import { useState } from 'react'
import type { PendingInteraction } from './channel-interactions'

export function ChannelInteractionPanel({
  items,
  answer
}: {
  items: PendingInteraction[]
  answer: (input: { id: string; decision?: string; question?: number; answer?: string }) => Promise<void>
}) {
  const [draft, setDraft] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(''),
    [error, setError] = useState<{ id: string; text: string } | null>(null)
  const submit = async (input: Parameters<typeof answer>[0]) => {
    setBusy(input.id)
    setError(null)
    try {
      await answer(input)
    } catch (e) {
      setError({ id: input.id, text: e instanceof Error ? e.message : '回答未提交' })
    } finally {
      setBusy('')
    }
  }
  if (!items.length && !error) return null
  return (
    <section aria-label="渠道待处理请求">
      <h4>待处理请求</h4>
      <p className="px-muted">
        这是原生任务正在等待的同一个请求。处理、取消或过期后，旧答案不能再次执行操作。
      </p>
      {error && !items.some((p) => p.id === error.id) && <p role="alert">{error.text}</p>}
      {items.map((p) => (
        <div key={p.id} className="px-card">
          <strong>
            {p.chatId}
            {p.requesterId ? ` · 发起成员 ${p.requesterId}` : ''}
          </strong>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{p.text}</pre>
          {error?.id === p.id && <p role="alert">{error.text}</p>}
          {p.kind === 'approval' ? (
            <div className="px-actions">
              <button disabled={!!busy} onClick={() => void submit({ id: p.id, decision: 'allowed-once' })}>
                批准一次
              </button>
              <button disabled={!!busy} onClick={() => void submit({ id: p.id, decision: 'rejected' })}>
                拒绝
              </button>
            </div>
          ) : (
            p.questions?.map((q, index) => (
              <div key={q.id}>
                <label>
                  {index + 1}. {q.question}
                  {p.answered.includes(index) ? '（已记录，可重新填写）' : ''}
                  <input
                    aria-label={'回答第 ' + (index + 1) + ' 题'}
                    style={{ width: '100%' }}
                    value={draft[p.id + ':' + index] ?? ''}
                    placeholder="选项序号或文字"
                    onChange={(e: any) =>
                      setDraft((old) => ({ ...old, [p.id + ':' + index]: e.target.value }))
                    }
                  />
                </label>
                <button
                  disabled={!!busy || !draft[p.id + ':' + index]?.trim()}
                  onClick={() =>
                    void submit({ id: p.id, question: index + 1, answer: draft[p.id + ':' + index] })
                  }
                >
                  提交本题
                </button>
              </div>
            ))
          )}
        </div>
      ))}
    </section>
  )
}
