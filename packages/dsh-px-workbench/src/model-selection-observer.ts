type Selection = { provider: string; model: string; reasoningEffort?: string }
type Snapshot = { pending: Selection | null; status: string; current?: Selection | null }
const routeKey = (route?: Selection | null) =>
  JSON.stringify([route?.provider, route?.model, route?.reasoningEffort])

/** Observe native picker and /model failures without replacing their controls or mutating their store. */
export function observeRejectedModelSelection<T>(
  store: { getSnapshot(): Snapshot; subscribe(fn: () => void): () => void },
  inspect: (selection: Selection, signal: AbortSignal) => Promise<T>,
  receive: (selection: Selection, value: T) => void
): () => void {
  let attempted: Selection | undefined
  let check: AbortController | undefined
  let checkedFrom: string | undefined
  const stop = store.subscribe(() => {
    const state = store.getSnapshot()
    // Catalog/progress notifications may repeat the same failure or clear its
    // display text. They must not erase the user's still-relevant attempt.
    if (checkedFrom !== undefined && routeKey(state.current) !== checkedFrom) check?.abort()
    if (state.pending) {
      check?.abort()
      attempted = state.pending
      return
    }
    const selection = attempted
    attempted = undefined
    if (state.status !== 'error' || !selection) return
    const controller = (check = new AbortController())
    checkedFrom = routeKey(state.current)
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
