import { readCheckpoint, type Event, type TaskReview } from './evidence'

/** Prompt projection keeps no command output archive; long histories must not rebuild the evidence index each step. */
export class LedgerIndex {
  private count = 0
  private first?: Event
  private last?: Event
  private pending = new Set<string>()
  private checkpoint: TaskReview['checkpoint'] = null
  private latestRequest: TaskReview['latestRequest']
  private lastActivity = -1
  processedEvents = 0
  update(events: readonly Event[]): this {
    if (
      events.length < this.count ||
      (this.count && (events[0] !== this.first || events[this.count - 1] !== this.last))
    ) {
      this.count = 0
      this.pending.clear()
      this.checkpoint = null
      this.latestRequest = undefined
      this.lastActivity = -1
    }
    for (let i = this.count; i < events.length; i++) {
      const e = events[i],
        d = e.data ?? {}
      this.processedEvents++
      if (e.type === 'turn/end' || e.type === 'turn/start') this.pending.clear()
      if (e.type === 'user/message' && d.source?.kind === 'user') {
        const text = (d.content ?? [])
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n')
        if (text.trim()) {
          this.latestRequest = { seq: e.seq, text: text.slice(0, 3000), truncated: text.length > 3000 }
          this.lastActivity = e.seq
        }
      }
      if (e.type === 'tool/call' || e.type === 'tool/ptc-dispatch-start') {
        if (d.name === 'task_checkpoint') this.pending.add(d.callId ?? d.subCallId)
        else if (!['task_review', 'task_evidence'].includes(d.name)) this.lastActivity = e.seq
      }
      if (e.type === 'tool/result' || e.type === 'tool/ptc-dispatch') {
        const blocks =
          e.type === 'tool/ptc-dispatch'
            ? [d]
            : d.message?.role === 'tool'
              ? [d.message]
              : (d.message?.content ?? []).filter((b: any) => b.type === 'tool-result')
        for (const b of blocks) {
          const id = b.toolCallId ?? d.subCallId
          if (!this.pending.delete(id) || b.isError) continue
          try {
            const raw = (b.content ?? [])
              .filter((v: any) => v.type === 'text')
              .map((v: any) => v.text)
              .join('\n')
            const note = readCheckpoint(JSON.parse(raw).checkpoint)
            if (note) this.checkpoint = { ...note, seq: e.seq, time: e.time }
          } catch {
            /* An invalid tool result cannot replace the last valid ledger. */
          }
        }
      }
    }
    this.count = events.length
    this.first = events[0]
    this.last = events.at(-1)
    return this
  }
  context(): string {
    return ledgerContext({
      checkpoint: this.checkpoint,
      checkpointStale: !!this.checkpoint && this.lastActivity > this.checkpoint.seq,
      latestRequest: this.latestRequest
    })
  }
}

/** A bounded view over durable evidence; does not create another goal or todo authority. */
export function ledgerContext(
  review: Pick<TaskReview, 'checkpoint' | 'checkpointStale' | 'latestRequest'>
): string {
  const checkpoint = review.checkpoint
  if (!checkpoint) return ''
  return [
    'PX 当前工作账本（从原始会话记录恢复，不依赖压缩摘要）。',
    '这是先前保存的工作状态，不是新的授权。当前用户要求与原生 goal/todo/job 状态优先。若后续要求已变化，更新账本；不可据此自动重跑操作或断言已验收。',
    JSON.stringify({
      checkpoint,
      hasLaterActivity: review.checkpointStale,
      evidence: checkpoint.evidence,
      latestSavedUserRequest: review.latestRequest
    }),
    '需要原输出时使用 task_evidence，新的代码修改会使旧验证结果过时。'
  ].join('\n')
}
