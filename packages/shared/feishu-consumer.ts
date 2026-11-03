import { feishuEvidence, type FeishuAccountBinding } from './feishu-evidence'
import type { ChannelInbox, ChannelInboxEvent, ChannelRecipient } from './channel-inbox'

export interface NativeFeishuIntake {
  contractVersion: number
  inboundVersion: number
  describeBot(botId: string): Promise<{
    version: number
    botId: string
    channel: string
    connected: boolean
    account: { fingerprint: string }
    capabilities: string[]
  }>
  consumeInbound(
    botId: string,
    options: {
      expectedFingerprint: string
      signal: AbortSignal
      onEvent: (event: unknown, context: { signal: AbortSignal }) => Promise<{ accepted: true }>
    }
  ): Promise<() => void>
}
export interface FeishuConsumerOptions {
  epoch: string
  signal?: AbortSignal
  authorize: (event: ChannelInboxEvent) => boolean
  destination: (event: ChannelInboxEvent) => ChannelRecipient
  available: (signal: AbortSignal) => void | Promise<void>
  failed: (error: unknown) => void | Promise<void>
}

/** Only call after an explicit account takeover choice; native consumption changes persistent bot mode. */
export async function startFeishuConsumer(
  native: NativeFeishuIntake,
  account: FeishuAccountBinding,
  inbox: ChannelInbox,
  options: FeishuConsumerOptions
): Promise<{ dispose: () => void }> {
  if (
    typeof options.epoch !== 'string' ||
    !options.epoch.trim() ||
    options.epoch.length > 512 ||
    /[\r\n\0]/.test(options.epoch)
  )
    throw Error('接收生命周期标识无效')
  account = Object.freeze({ botId: account.botId, fingerprint: account.fingerprint })
  if (native.contractVersion !== 1 || native.inboundVersion !== 1) throw Error('飞书原生接收接口不兼容')
  const controller = new AbortController(),
    signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  signal.throwIfAborted()
  const description = await native.describeBot(account.botId)
  signal.throwIfAborted()
  if (
    description.version !== 1 ||
    description.channel !== 'feishu' ||
    description.botId !== account.botId ||
    description.account?.fingerprint !== account.fingerprint ||
    description.connected !== true ||
    !['exclusive-text-consumer', 'reply-text-checked'].every((cap) => description.capabilities?.includes(cap))
  )
    throw Error('飞书账号身份、连接或接收能力尚未就绪')
  let active = false,
    release: (() => void) | undefined
  const report = (error: unknown) => {
    try {
      void Promise.resolve(options.failed(error)).catch(() => {})
    } catch {}
  }
  const notify = () => {
    if (!active || signal.aborted) return
    try {
      void Promise.resolve(options.available(signal)).catch(report)
    } catch (error) {
      report(error)
    }
  }
  const dispose = () => {
    active = false
    signal.removeEventListener('abort', dispose)
    const previous = release
    release = undefined
    controller.abort(new Error('PX 飞书接收已停止'))
    if (typeof previous === 'function') {
      try {
        previous()
      } catch (error) {
        report(error)
      }
    }
  }
  signal.addEventListener('abort', dispose, { once: true })
  try {
    release = await native.consumeInbound(account.botId, {
      expectedFingerprint: account.fingerprint,
      signal,
      onEvent: async (value, context) => {
        const deliverySignal = AbortSignal.any([signal, context.signal])
        deliverySignal.throwIfAborted()
        const { event, attention } = feishuEvidence(value, account),
          envelope: ChannelInboxEvent = {
            provider: 'feishu',
            accountId: account.botId,
            fingerprint: account.fingerprint,
            eventId: event.eventId,
            messageId: event.messageId,
            conversationId: event.conversation.id,
            actorId: event.actor.id,
            kind: attention.kind,
            mentioned: event.mentionedAccount,
            at: event.at,
            text: event.text,
            reply: { ...event.reply }
          }
        if (!options.authorize(envelope)) throw Error('此飞书消息不在获准接收范围内')
        const destination = options.destination(envelope)
        const result = inbox.accept(envelope, destination, deliverySignal)
        if (!result.duplicate) notify()
        return { accepted: true }
      }
    })
    signal.throwIfAborted()
    if (typeof release !== 'function') throw Error('原生飞书接口未返回接收释放句柄')
    inbox.recoverInterrupted(options.epoch)
    active = true
    notify()
    return { dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
