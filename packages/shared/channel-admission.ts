import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { ChannelInbox, IngressClaim, PendingChannelMessage } from './channel-inbox'

interface ChannelMessageSource {
  kind: 'plugin:dsh-px-channel'
  ingressId: string
  provider: string
  accountId: string
  fingerprint: string
  conversationId: string
  messageId: string
  actorId: string
  personaId: string
  routeRevision: number
  epoch: string
  requestId: string
}
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:dsh-px-channel': ChannelMessageSource
  }
}

/** These ports are held only by the Host coordinator, never reconstructed from model input. */
export interface NativeChannelAdmission {
  agent: Agent
  sessions: Pick<SessionStore, 'flush'>
  // Recheck live ownership, persona, audience and current permission at the exact insertion boundary.
  validate: (message: PendingChannelMessage, claim: IngressClaim) => boolean
}

function sourceFor(row: PendingChannelMessage, claim: IngressClaim): ChannelMessageSource {
  return {
    kind: 'plugin:dsh-px-channel',
    ingressId: row.id,
    provider: row.event.provider,
    accountId: row.event.accountId,
    fingerprint: row.event.fingerprint,
    conversationId: row.event.conversationId,
    messageId: row.event.messageId,
    actorId: row.event.actorId,
    personaId: claim.personaId,
    routeRevision: claim.routeRevision,
    epoch: claim.epoch,
    requestId: claim.requestId
  }
}

/** Native acceptance is distinct from execution or delivery of an answer. Never retry an ambiguous insert. */
export async function admitChannelMessage(
  inbox: ChannelInbox,
  row: PendingChannelMessage,
  claim: IngressClaim,
  native: NativeChannelAdmission,
  signal: AbortSignal,
  wake = true
): Promise<boolean> {
  signal.throwIfAborted()
  if (native.agent.session.id !== claim.sessionId || !native.validate(row, claim))
    throw Error('渠道消息的原生会话、人格或受众已改变，未投递')
  const message = createUserMessage({
    source: sourceFor(row, claim),
    content: [{ type: 'text', text: row.event.text }]
  })
  signal.throwIfAborted()
  if (!inbox.claim(row.id, claim)) return false
  try {
    // No await between the ownership check, durable claim and native insertion.
    if (wake) native.agent.followup(message)
    else native.agent.inject(message)
    if (!(await native.sessions.flush(native.agent.session))) throw Error('原生会话未提供持久写入回执')
    if (!inbox.admit(row.id, claim, message.id)) throw Error('渠道收件回执归属已改变')
    return true
  } catch (error) {
    inbox.uncertain(row.id, claim)
    throw error
  }
}

/** Read and flush existing native evidence only. Cancellation/removal from the native inbox is not replay. */
export async function reconcileChannelAdmission(
  inbox: ChannelInbox,
  key: string,
  native: Pick<NativeChannelAdmission, 'agent' | 'sessions'>,
  signal: AbortSignal
): Promise<boolean> {
  signal.throwIfAborted()
  const receipt = inbox.receipt(key)
  if (!receipt?.claim || !['dispatching', 'uncertain'].includes(receipt.phase)) return false
  const { claim, source: event } = receipt
  if (native.agent.session.id !== claim.sessionId) throw Error('原生收件核对会话不匹配')
  const expected = sourceFor(
    { id: key, seq: 0, event: { ...event, text: '' }, recipient: receipt.recipient },
    claim
  )
  const found = new Set<string>()
  const check = (message: UserMessage) => {
    if (message.source.kind !== expected.kind) return
    if (
      Object.entries(expected).every(
        ([key, value]) => (message.source as unknown as Record<string, unknown>)[key] === value
      )
    )
      found.add(message.id)
  }
  for (const entry of native.agent.session.snapshotEvents()) {
    if (entry.type === 'user/message') check(entry.data)
    else if (entry.type === 'agent/inbox/spliced') entry.data.inserted.forEach(check)
  }
  signal.throwIfAborted()
  if (!found.size) return false
  if (found.size !== 1) throw Error('原生收件存在多个不同回执，需要人工核对')
  if (!(await native.sessions.flush(native.agent.session))) throw Error('原生会话未提供持久写入回执')
  return inbox.admit(key, claim, [...found][0])
}
