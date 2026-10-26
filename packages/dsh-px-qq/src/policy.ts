import { qqMessageOrigin, type QqMessageOrigin } from '../../shared/channel-source'
import type { SessionChannel } from '../../dsh-px-memory/src/store'

export interface QqSettings {
  enabled: boolean
  accountId: string
  authorizedUsers: string[]
  personaId: string
  workspace: string
  publicIntroduction: string
  endpoint: string
  secretRef: string
  model?: { provider: string; model: string; reasoningEffort?: string }
}
export const DEFAULT_QQ_SETTINGS: QqSettings = {
  enabled: false,
  accountId: '',
  authorizedUsers: [],
  personaId: '',
  workspace: '',
  publicIntroduction: '',
  endpoint: 'ws://127.0.0.1:64327',
  secretRef: ''
}
export class QqError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}
export function qqId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{4,19}$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new QqError('请输入有效的数字 QQ 号')
  return value
}
export function conversation(value: string): { kind: 'private' | 'group'; peer: string } {
  const match = /^(private|group):([1-9]\d{4,19})$/.exec(value)
  if (!match) throw new QqError('QQ 会话标识无效')
  return { kind: match[1] as 'private' | 'group', peer: qqId(match[2]) }
}
export function localEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new QqError('OneBot 地址无效')
  }
  if (
    url.protocol !== 'ws:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new QqError('本版仅连接本机 OneBot WebSocket；令牌须填写在专用字段')
  return url.href
}
export function channelFor(settings: QqSettings, chatId: string): SessionChannel {
  const chat = conversation(chatId)
  return {
    provider: 'qq',
    accountId: qqId(settings.accountId),
    conversationId: chatId,
    access: chat.kind === 'private' && settings.authorizedUsers.includes(chat.peer) ? 'owner' : 'public',
    publicInstructions: settings.publicIntroduction,
    ...(chat.kind === 'group'
      ? {
          workspace:
            settings.workspace.replace(/[\\/]$/, '') + '/groups/' + settings.accountId + '/' + chat.peer
        }
      : {})
  }
}
export function messageSource(settings: QqSettings, chatId: string, senderId: string, messageId?: string) {
  const chat = conversation(chatId)
  qqId(senderId)
  if (chat.kind === 'private' && chat.peer !== senderId) throw new QqError('私聊发送者与会话不一致', 403)
  return {
    kind: 'plugin:dsh-onebot',
    pxQq: {
      version: 1,
      accountId: qqId(settings.accountId),
      conversationId: chatId,
      senderId,
      ...(messageId ? { messageId } : {})
    } satisfies QqMessageOrigin
  }
}

/** Authorize from messages actually admitted into this native turn, not a mutable "last sender" flag. */
export function taskRequester(
  settings: QqSettings,
  channel: SessionChannel,
  events: readonly { type: string; data?: any }[]
): string | undefined {
  let start = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'turn/end') return undefined
    if (events[i].type === 'turn/start') {
      start = i
      break
    }
  }
  if (start < 0) return undefined
  const speakers: string[] = []
  for (const event of events.slice(start + 1)) {
    if (event.type !== 'user/message') continue
    const source = event.data?.source,
      origin = qqMessageOrigin(source)
    if (!origin) {
      if (source?.kind === 'user' || String(source?.kind).startsWith('plugin:')) return undefined
      continue
    }
    if (
      origin.accountId !== settings.accountId ||
      origin.accountId !== channel.accountId ||
      origin.conversationId !== channel.conversationId ||
      !settings.authorizedUsers.includes(origin.senderId)
    )
      return undefined
    speakers.push(origin.senderId)
  }
  return speakers.length && speakers.every((id) => id === speakers[0]) ? speakers[0] : undefined
}
