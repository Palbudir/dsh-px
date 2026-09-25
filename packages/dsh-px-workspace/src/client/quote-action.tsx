import type { Client } from './contracts'
import { requestQuote, quoteRequests } from './data'
import { panelAvailability, usePanelCapabilities } from './panel-availability'
import { Icon } from '../../../shared/ui'

export function QuoteAction({
  ctx,
  sessionId,
  messageId
}: {
  ctx: Client
  sessionId: string
  messageId: string
}): unknown {
  const availability = panelAvailability(usePanelCapabilities(ctx), 'px-notes')
  return (
    <span className="px-ui">
      <button
        className="px-quote-action"
        disabled={!availability.enabled}
        title={availability.enabled ? '引用或批注这条消息' : `引用与批注不可用：${availability.reason}`}
        onClick={() => {
          let requestToken: string | undefined
          try {
            const live = ctx.capabilities.getSnapshot()
            const current = panelAvailability(live, 'px-notes')
            if (!current.enabled) throw new Error(current.reason)
            requestQuote(sessionId, messageId)
            requestToken = quoteRequests.getSnapshot()[sessionId]?.token
            live.sidebar!.openTab({ type: 'px-notes', meta: { messageId } }, { sessionId })
          } catch (err) {
            if (requestToken) quoteRequests.consume(sessionId, requestToken)
            const scope = ctx.sessions.scope(sessionId)
            if (scope)
              ctx.conversation.input
                .for(scope)
                .notify('error', err instanceof Error ? err.message : String(err))
          }
        }}
      >
        <Icon name="note" />
        引用 / 批注
      </button>
    </span>
  )
}
