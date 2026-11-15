/** Only committed native public output is deliverable. Reasoning and tool payloads never enter this path. */
export function channelTaskOutput(event: { seq: number; type: string; data: any }) {
  const text =
    event.type === 'assistant/message'
      ? (event.data.message?.content ?? [])
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n')
      : event.type === 'turn/end' &&
          ['error', 'aborted', 'blocked', 'max-tokens', 'interrupted'].includes(event.data.reason?.kind)
        ? '任务本轮未完成（' + event.data.reason.kind + '）。执行记录保留，未自动重新执行。'
        : ''
  if (!text.trim()) return []
  const chunks: string[] = []
  for (let at = 0; at < text.length;) {
    let end = Math.min(at + 3400, text.length)
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
    chunks.push(text.slice(at, end))
    at = end
  }
  return chunks.map((part, i) => ({
    key: `task-event:${event.seq}:${i}`,
    body: (chunks.length > 1 ? `任务输出 ${i + 1}/${chunks.length}\n` : '') + part
  }))
}
