export type ChannelControl = {
  kind: 'approve' | 'reject' | 'answer'
  id: string
  question?: number
  answer?: string
}
/** These commands are interpreted only after a transport has authenticated the actor and chat. */
export function channelControl(text: string): ChannelControl | undefined {
  const match = /^\/(approve|reject|answer)(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!match) return
  const kind = match[1].toLowerCase() as ChannelControl['kind'],
    args = (match[2] ?? '').trim()
  if (kind === 'answer') {
    const input = /^(Q[a-f0-9]{10})\s+([1-9]\d*)\s+([\s\S]+)$/.exec(args)
    return { kind, id: input?.[1] ?? '', question: Number(input?.[2]), answer: input?.[3] }
  }
  return { kind, id: /^A[a-f0-9]{10}$/.test(args) ? args : '' }
}
export interface ChannelControlAudit {
  version: 1
  provider: 'feishu'
  accountId: string
  conversationId: string
  actorId: string
  messageId: string
  requestId: string
  sessionId: string
  control: ChannelControl['kind']
  text: string
  meaning: 'authenticated-control-attempt-not-task-completion'
  response?: { question: number; questionText: string; selected: string[]; custom?: string }
}
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:dsh-px/channel-control': ChannelControlAudit
  }
}
export function controlAudit(value: unknown): ChannelControlAudit | undefined {
  const v = value as ChannelControlAudit
  const id = (text: unknown) =>
    typeof text === 'string' && !!text && text.length <= 512 && !/[\r\n\0]/.test(text)
  if (
    v?.version !== 1 ||
    v.provider !== 'feishu' ||
    v.meaning !== 'authenticated-control-attempt-not-task-completion' ||
    ![v.accountId, v.conversationId, v.actorId, v.messageId, v.requestId, v.sessionId].every(id) ||
    !['approve', 'reject', 'answer'].includes(v.control) ||
    typeof v.text !== 'string' ||
    v.text.length > 16000
  )
    return
  if (
    v.response &&
    (!Number.isSafeInteger(v.response.question) ||
      v.response.question < 1 ||
      v.response.question > 12 ||
      typeof v.response.questionText !== 'string' ||
      v.response.questionText.length > 4000 ||
      !Array.isArray(v.response.selected) ||
      v.response.selected.some((s) => typeof s !== 'string' || s.length > 4000) ||
      (v.response.custom !== undefined &&
        (typeof v.response.custom !== 'string' || v.response.custom.length > 8000)))
  )
    return
  return v
}
