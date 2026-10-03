import { useEffect, useState } from 'react'
import type { Client } from '../../../dsh-px-workspace/src/client/contracts'
import { requestQuote } from '../../../dsh-px-workspace/src/client/data'
import { selectedSession } from '../../../shared/native-navigation'
import { panelAvailability } from '../../../dsh-px-workspace/src/client/panel-availability'

export interface ConversationReader {
  binding(id: string): {
    target(name: 'chat'): { getSnapshot(): { nodes: { get(key: string): any } } | undefined }
  }
}
export interface SentenceSelection {
  sessionId: string
  messageId: string
  quote: string
  left: number
  top: number
}

/** Pinned native chat seats identify a node; the native snapshot supplies its durable message identity. */
export function readSentenceSelection(ctx: Client, reader: ConversationReader): SentenceSelection | null {
  const selected = window.getSelection()
  if (!selected || selected.isCollapsed || selected.rangeCount !== 1) return null
  const range = selected.getRangeAt(0)
  const element = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement)
  const start = element(range.startContainer),
    end = element(range.endContainer)
  if (!start || !end || start.closest('input,textarea,[contenteditable],button,[role="dialog"],.px-ui'))
    return null
  const seat = start.closest('[data-chat-node-key]')
  if (!seat) return null
  if (seat !== end.closest('[data-chat-node-key]')) {
    // Triple-click paragraph selection can end at offset 0 of the following
    // native turn-tail. Admit its empty boundary, never another message's text.
    const outside = range.cloneRange()
    outside.setStartAfter(seat)
    if (outside.toString().trim()) return null
  }
  const quote = selected.toString().trim()
  if (!quote || quote.length > 8000) return null
  const sessionId = selectedSession(
    ctx.sessions.list.getSnapshot(),
    ctx.layout?.panelInfo?.getSnapshot().activePanelId ?? null
  )
  // Native node keys are only unique within a session; a side conversation can
  // contain the same key as the active main conversation.
  const owner = seat.closest('[data-conversation-session]')?.getAttribute('data-conversation-session')
  if (!sessionId || owner !== sessionId) return null
  const node = reader
    .binding(sessionId)
    .target('chat')
    .getSnapshot()
    ?.nodes.get(seat.getAttribute('data-chat-node-key')!)
  const messageId =
    node?.kind === 'assistant-step'
      ? node.data?.finalNode?.messageId
      : node?.kind === 'user' || node?.kind === 'steering'
        ? node.id
        : undefined
  if (typeof messageId !== 'string' || !messageId) return null
  const rect = range.getBoundingClientRect()
  return {
    sessionId,
    messageId,
    quote,
    left: Math.max(8, Math.min(window.innerWidth - 160, rect.left)),
    top: Math.max(48, Math.min(window.innerHeight - 44, rect.bottom + 6))
  }
}

export function SelectionAction({ ctx, reader }: { ctx: Client; reader: ConversationReader }): unknown {
  const [selection, setSelection] = useState<SentenceSelection | null>(null)
  useEffect(() => {
    const update = (): void => {
      try {
        setSelection(readSentenceSelection(ctx, reader))
      } catch {
        setSelection(null)
      }
    }
    const clear = (): void => setSelection(null)
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') clear()
    }
    document.addEventListener('selectionchange', update)
    document.addEventListener('pointerup', update)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', clear, true)
    window.addEventListener('resize', clear)
    const unsubscribe = ctx.sessions.list.subscribe(() => {
      const active = selectedSession(
        ctx.sessions.list.getSnapshot(),
        ctx.layout?.panelInfo?.getSnapshot().activePanelId ?? null
      )
      setSelection((current) => (current && current.sessionId !== active ? null : current))
    })
    return () => {
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('pointerup', update)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', clear, true)
      window.removeEventListener('resize', clear)
      unsubscribe()
    }
  }, [ctx, reader])
  if (!selection) return null
  const open = (): void => {
    try {
      const current = selectedSession(
        ctx.sessions.list.getSnapshot(),
        ctx.layout?.panelInfo?.getSnapshot().activePanelId ?? null
      )
      if (current !== selection.sessionId) throw new Error('会话已切换，请重新选择原句')
      const live = ctx.capabilities.getSnapshot()
      const available = panelAvailability(live, 'px-notes')
      if (!available.enabled) throw new Error(available.reason)
      requestQuote(selection.sessionId, selection.messageId, selection.quote)
      live.sidebar!.openTab({ type: 'px-notes' }, { sessionId: selection.sessionId })
      setSelection(null)
    } catch (error) {
      const scope = ctx.sessions.scope(selection.sessionId)
      if (scope)
        ctx.conversation.input
          .for(scope)
          .notify('error', error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div
      className="px-ui px-selection-action"
      style={{
        position: 'fixed',
        left: selection.left,
        top: selection.top,
        zIndex: 1000,
        pointerEvents: 'auto'
      }}
    >
      <button className="px-primary" onPointerDown={(event: any) => event.preventDefault()} onClick={open}>
        引用并批注
      </button>
    </div>
  )
}
