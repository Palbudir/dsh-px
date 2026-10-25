type Selection = { provider: string; model: string; reasoningEffort?: string }
type Snapshot = { pending: Selection | null; status: string }

/** Observe native picker and /model failures without replacing their controls or mutating their store. */
export function observeRejectedModelSelection<T>(
  store: { getSnapshot(): Snapshot; subscribe(fn: () => void): () => void },
  inspect: (selection: Selection, signal: AbortSignal) => Promise<T>,
  receive: (selection: Selection, value: T) => void
): () => void {
  let attempted: Selection | undefined
  let check: AbortController | undefined
  const stop = store.subscribe(() => {
    const state = store.getSnapshot()
    check?.abort()
    if (state.pending) {
      attempted = state.pending
      return
    }
    const selection = attempted
    attempted = undefined
    if (state.status !== 'error' || !selection) return
    const controller = (check = new AbortController())
    void inspect(selection, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) receive(selection, value)
      })
      .catch(() => {
        // The native picker already reports the selection failure.
      })
  })
  return () => {
    stop()
    check?.abort()
  }
}
