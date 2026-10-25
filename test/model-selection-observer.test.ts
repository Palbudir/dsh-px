import test from 'node:test'
import assert from 'node:assert/strict'
import { observeRejectedModelSelection } from '../packages/dsh-px-workbench/src/model-selection-observer'

test('native selection observer captures fast failures, ignores successful selection, and cancels stale continuation checks', async () => {
  const selected = { provider: 'test', model: 'large' }
  let snapshot = { pending: null as typeof selected | null, status: 'ready' }
  const listeners = new Set<() => void>()
  const store = {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    }
  }
  const pending: { signal: AbortSignal; resolve: (value: boolean) => void }[] = []
  const received: string[] = []
  const stop = observeRejectedModelSelection(
    store,
    (_selection, signal) => new Promise<boolean>((resolve) => pending.push({ signal, resolve })),
    (selection, value) => {
      if (value) received.push(selection.model)
    }
  )
  const publish = (status: string, selection: typeof selected | null = null) => {
    snapshot = { status, pending: selection }
    for (const fn of listeners) fn()
  }
  publish('selecting', selected)
  publish('ready')
  assert.equal(pending.length, 0)
  publish('selecting', selected)
  publish('error')
  assert.equal(pending.length, 1)
  publish('error')
  publish('ready')
  assert.equal(pending[0]!.signal.aborted, false, 'an unrelated catalog notification keeps the check alive')
  publish('selecting', { ...selected, model: 'same-tier' })
  pending[0]!.resolve(true)
  await Promise.resolve()
  assert.equal(pending[0]!.signal.aborted, true)
  assert.deepEqual(received, [])
  publish('ready')
  publish('selecting', selected)
  publish('error')
  pending[1]!.resolve(true)
  await Promise.resolve()
  assert.deepEqual(received, ['large'])
  publish('selecting', selected)
  publish('error')
  stop()
  pending[2]!.resolve(true)
  await Promise.resolve()
  assert.equal(pending[2]!.signal.aborted, true)
  assert.equal(listeners.size, 0)
  assert.deepEqual(received, ['large'])
})

test('native selection observer suppresses a late check after another client changes the current model', async () => {
  let state = {
    current: { provider: 'p', model: 'old' },
    pending: null as { provider: string; model: string } | null,
    status: 'ready'
  }
  let listener = () => {}
  let resolve!: (value: boolean) => void
  let received = false
  const stop = observeRejectedModelSelection(
    {
      getSnapshot: () => state,
      subscribe: (fn) => {
        listener = fn
        return () => {}
      }
    },
    () =>
      new Promise<boolean>((done) => {
        resolve = done
      }),
    () => {
      received = true
    }
  )
  state = { ...state, pending: { provider: 'p', model: 'large' }, status: 'selecting' }
  listener()
  state = { ...state, pending: null, status: 'error' }
  listener()
  state = { ...state, current: { provider: 'p', model: 'elsewhere' }, status: 'ready' }
  listener()
  resolve(true)
  await Promise.resolve()
  assert.equal(received, false)
  stop()
})
