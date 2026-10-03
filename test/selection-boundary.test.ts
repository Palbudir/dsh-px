import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'

test('selection accepts an empty turn-tail boundary but rejects cross-message text and streaming nodes', () => {
  const code = buildSync({
    entryPoints: ['packages/dsh-px-annotations/src/client/selection.tsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    logLevel: 'silent'
  }).outputFiles[0].text
  let outsideText = '',
    endInMessage = false,
    settled = true
  let domSession = 'session-a'
  const seat = { getAttribute: () => 'native-node-key', closest: () => ({ getAttribute: () => domSession }) }
  class Element {
    constructor(readonly start: boolean) {}
    closest(selector: string) {
      return selector === '[data-chat-node-key]'
        ? this.start || endInMessage
          ? seat
          : { getAttribute: () => 'turn-tail' }
        : null
    }
  }
  const range = {
    startContainer: new Element(true),
    endContainer: new Element(false),
    cloneRange: () => ({
      setStartAfter: (value: unknown) => assert.equal(value, seat),
      toString: () => outsideText
    }),
    getBoundingClientRect: () => ({ left: 100, bottom: 200 })
  }
  const module = { exports: {} as any }
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: () => ({}),
    Element,
    window: {
      innerWidth: 1280,
      innerHeight: 900,
      getSelection: () => ({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => range,
        toString: () => '原句\n\n'
      })
    }
  })
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => ({
          current: 'session-a',
          ids: ['session-a'],
          byId: { 'session-a': { id: 'session-a' } }
        })
      }
    }
  }
  const node = () => ({
    kind: 'assistant-step',
    data: { finalNode: settled ? { messageId: 'message-a' } : undefined }
  })
  const reader = { binding: () => ({ target: () => ({ getSnapshot: () => ({ nodes: { get: node } }) }) }) }
  const read = () => module.exports.readSentenceSelection(ctx, reader)
  assert.equal(read().quote, '原句')
  outsideText = '另一条消息'
  assert.equal(read(), null)
  endInMessage = true
  assert.equal(read().messageId, 'message-a')
  domSession = 'side-session'
  assert.equal(read(), null, 'a repeated node key in a side conversation must not quote the main session')
  domSession = 'session-a'
  settled = false
  assert.equal(read(), null)
})
