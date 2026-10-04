import type { Client } from '../../../dsh-px-workspace/src/client/contracts'
import type { Annotation } from '../../../dsh-px-workspace/src/model'
import { requestJson } from '../../../shared/client-http'
import { base, errorText } from '../../../dsh-px-workspace/src/client/data'
import {
  annotationSource,
  annotationText,
  createAttachmentStore,
  detectOffset,
  referenceSpan,
  token,
  tokens,
  type ComposerState,
  type Batch
} from './attachment-model'

export function createAnnotationAttachments(ctx: Client) {
  const store = createAttachmentStore(
    {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value)
    },
    () => crypto.randomUUID()
  )
  let preview: { sessionId: string; ref: string } | null = null
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const fn of listeners) fn()
  }
  let ready = false
  const input = (id: string) => {
    const scope = ctx.sessions.scope(id)
    if (!scope) throw new Error('请先打开目标会话')
    const facade = ctx.conversation.input.for(scope)
    return { scope, facade, state: facade.state.getSnapshot() as ComposerState }
  }
  function write(sessionId: string, notes: Annotation[], previous?: string): void {
    if (!ready) throw new Error('批注输入功能尚未就绪，请稍后重试')
    const { scope, state } = input(sessionId)
    if (state.phase !== 'plain') throw new Error('正在发送，请稍后修改批注')
    const matches = (state.occurrences ?? []).filter(
      (o) => o.source === annotationSource && (!previous || o.ref === previous)
    )
    if (matches.length > 1) throw new Error('输入框含有重复批注标签，请先删除多余标签')
    const occurrence = matches[0]
    if (previous && !occurrence) throw new Error('待发批注已变化，请重新打开后重试')
    const ref = notes.length ? store.save({ sessionId, notes }) : ''
    const span = referenceSpan(state, occurrence)
    const accepted = ref
      ? scope.bail(scope, 'slash/input-insert-reference', {
          reference: {
            source: annotationSource,
            ref,
            label: `${notes.length} 条批注`,
            appearance: 'session',
            clipboardText: token(ref)
          },
          span
        })
      : scope.bail(scope, 'slash/input-insert-text', { text: '', span })
    if (accepted !== true) throw new Error('输入框已变化，请重试')
    if (preview?.sessionId === sessionId) {
      preview = ref ? { sessionId, ref } : null
      notify()
    }
  }
  const service = {
    activation: {
      getSnapshot: () => ready,
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => {
          listeners.delete(fn)
        }
      }
    },
    getSnapshot: () => preview,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    close: () => {
      preview = null
      notify()
    },
    read: store.read,
    replace: write,
    attach(note: Annotation): void {
      const { state } = input(note.sessionId)
      const occurrence = state.occurrences?.find((o) => o.source === annotationSource)
      const notes = occurrence ? store.read(occurrence.ref, note.sessionId).notes : []
      // Retrying a successful save must not attach the same annotation twice.
      write(note.sessionId, [...notes.filter((n) => n.id !== note.id), note])
    },
    recover(sessionId: string): void {
      if (!ready) return
      const { scope, state } = input(sessionId)
      if (state.phase !== 'plain') return
      // The native draft mirror persists clipboard text. Restore one token per
      // revision; the next snapshot restores the next one without stale spans.
      for (const match of tokens(state.draft)) {
        if (state.occurrences?.some((o) => match.index! >= o.offset && match.index! < o.offset + o.length))
          continue
        let label = '批注待恢复',
          ref = match[1]
        try {
          label = `${store.read(ref, sessionId).notes.length} 条批注`
        } catch {
          ref = `unavailable:${ref}`
        }
        const start = detectOffset(state, match.index!)
        scope.bail(scope, 'slash/input-insert-reference', {
          reference: {
            source: annotationSource,
            ref,
            label,
            appearance: 'session',
            clipboardText: match[0]
          },
          span: { start, end: start + match[0].length, draftRev: state.draftRev }
        })
        return
      }
    }
  }
  ctx.inject(['inputTriggers'], (host) => {
    host.effect(() => {
      const off = host.inputTriggers.registerSource({
        trigger: '@',
        name: annotationSource,
        showGroupTitle: false,
        candidates: async () => [],
        onPick: () => undefined,
        warm: (session: { sessionId: string }) =>
          queueMicrotask(() => {
            if (ready && ctx.sessions.scope(session.sessionId)) service.recover(session.sessionId)
          }),
        openReference: (session: { sessionId: string }, reference: { ref: string }) => {
          preview = { sessionId: session.sessionId, ref: reference.ref }
          notify()
          return true
        },
        codec: {
          clipboardText: token,
          serialize: async (ref: string, signal: AbortSignal) => {
            const batch = store.read(ref)
            try {
              await Promise.all(
                batch.notes.map((note) =>
                  requestJson(`${base}/selection`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal,
                    body: JSON.stringify({
                      sessionId: note.sessionId,
                      messageId: note.messageId,
                      quote: note.quote
                    })
                  })
                )
              )
              return annotationText(batch)
            } catch (error) {
              const scope = ctx.sessions.scope(batch.sessionId)
              if (scope && !signal.aborted)
                ctx.conversation.input
                  .for(scope)
                  .notify('error', `批注未发送，草稿已保留：${errorText(error)}`)
              throw error
            }
          }
        }
      })
      ready = true
      notify()
      return () => {
        ready = false
        service.close()
        off()
      }
    }, 'annotations: structured input source')
  })
  return service
}
export type AnnotationAttachments = ReturnType<typeof createAnnotationAttachments>
