import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { randomUUID } from 'node:crypto'
import {
  createAttachmentStore,
  referenceSpan,
  token,
  annotationText
} from '../packages/dsh-px-annotations/src/client/attachment-model'

const note = (id: string, text = '3456') => ({
  id,
  sessionId: 's',
  messageId: 'm',
  seq: 8,
  quote: '原句',
  note: text,
  updatedAt: 1,
  role: 'assistant' as const,
  sourceHash: 'hash'
})
const storage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v)
    },
    values
  }
}
test('attachment snapshots survive reload and remain immutable after editing a later version', () => {
  const s = storage(),
    store = createAttachmentStore(s, randomUUID)
  const first = store.save({ sessionId: 's', notes: [note('a')] })
  const second = store.save({ sessionId: 's', notes: [note('a', '新的意见'), note('b')] })
  const reloaded = createAttachmentStore(s, randomUUID)
  assert.equal(reloaded.read(first).notes[0].note, '3456')
  assert.equal(reloaded.read(second, 's').notes.length, 2)
  assert.throws(() => reloaded.read(first, 'another'), /无法恢复/)
  assert.match(annotationText(reloaded.read(second)), /新的意见/)
  assert.doesNotMatch(annotationText(reloaded.read(second)), /px-note:/)
})
test('native spans account for preceding file and session reference chips', () => {
  const file = { source: 'reference', ref: 'f', offset: 0, length: 12 }
  const batch = { source: 'px-annotations', ref: 'n', offset: 14, length: 48 }
  const state = { draft: 'x'.repeat(64), draftRev: 4, phase: 'plain', occurrences: [file, batch] }
  assert.deepEqual(referenceSpan(state, batch), { start: 3, end: 4, draftRev: 4 })
  assert.deepEqual(referenceSpan(state), { start: 6, end: 6, draftRev: 4 })
})

const compiled = buildSync({
  entryPoints: ['packages/dsh-px-annotations/src/client/attachments.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['react'],
  logLevel: 'silent'
}).outputFiles[0].text
function fixture() {
  const s = storage(),
    writes: any[] = [],
    requests: any[] = [],
    cleanup: Array<() => void> = []
  const notices: string[] = []
  let failRequest = false,
    source: any,
    state: any = { draft: '正文', draftRev: 1, phase: 'plain', occurrences: [] }
  const scope = {
    bail(dispatch: unknown, name: string, payload: any) {
      assert.equal(dispatch, scope)
      writes.push({ name, payload })
      return true
    }
  }
  const ctx = {
    sessions: { scope: (id: string) => (id === 's' ? scope : undefined) },
    conversation: {
      input: {
        for: () => ({
          state: { getSnapshot: () => state },
          notify: (_level: string, text: string) => notices.push(text)
        })
      }
    },
    inject(names: string[], fn: (host: any) => void) {
      assert.deepEqual([...names], ['inputTriggers'])
      fn({
        effect: (effect: () => () => void) => cleanup.push(effect()),
        inputTriggers: {
          registerSource(value: any) {
            source = value
            return () => {
              source = undefined
            }
          }
        }
      })
    }
  }
  const module = { exports: {} as any }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    crypto: { randomUUID },
    localStorage: s,
    require: () => ({}),
    URL,
    Headers,
    AbortController,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    window: { location: { href: 'http://127.0.0.1/' } },
    fetch: async (_url: unknown, init: any) => {
      requests.push(JSON.parse(init.body))
      if (failRequest) return new Response(JSON.stringify({ error: '暂时离线' }), { status: 503 })
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  })
  const service = module.exports.createAnnotationAttachments(ctx)
  return {
    service,
    writes,
    requests,
    s,
    notices,
    failRequest() {
      failRequest = true
    },
    get source() {
      return source
    },
    set state(value: any) {
      state = value
    },
    cleanup() {
      cleanup.forEach((fn) => fn())
    }
  }
}
test('actual input adapter groups comments into one native reference, serializes only on send, and permits removing all', async () => {
  const f = fixture()
  f.service.attach(note('a'))
  assert.equal(f.requests.length, 0)
  const first = f.writes[0].payload.reference
  assert.equal(f.writes[0].name, 'slash/input-insert-reference')
  assert.equal(first.label, '1 条批注')
  f.state = {
    draft: '正文' + first.clipboardText,
    draftRev: 2,
    phase: 'plain',
    occurrences: [{ ...first, offset: 2, length: first.clipboardText.length }]
  }
  f.service.attach(note('b', '第二条'))
  const second = f.writes[1].payload.reference
  assert.equal(second.label, '2 条批注')
  assert.equal(f.service.read(first.ref).notes.length, 1)
  const body = await f.source.codec.serialize(second.ref, new AbortController().signal)
  assert.match(body, /3456/)
  assert.match(body, /第二条/)
  assert.equal(f.requests.length, 2)
  f.service.replace('s', [], first.ref)
  assert.equal(f.writes[2].name, 'slash/input-insert-text')
  assert.equal(f.writes[2].payload.text, '')
  f.cleanup()
  assert.throws(() => f.service.attach(note('b')), /尚未就绪/)
})

test('serialization failure reports the error to the owning input and keeps the batch snapshot', async () => {
  const f = fixture()
  f.service.attach(note('a'))
  const ref = f.writes[0].payload.reference.ref
  f.failRequest()
  await assert.rejects(() => f.source.codec.serialize(ref, new AbortController().signal), /暂时离线/)
  assert.equal(f.service.read(ref).notes[0].note, '3456')
  assert.match(f.notices[0], /批注未发送，草稿已保留/)
})
test('plain persisted tokens become native references; missing or foreign snapshots cannot serialize', async () => {
  const f = fixture()
  f.service.attach(note('a'))
  const ref = f.writes[0].payload.reference
  f.state = { draft: '正文' + ref.clipboardText, draftRev: 5, phase: 'plain', occurrences: [] }
  f.service.recover('s')
  assert.equal(f.writes[1].payload.reference.label, '1 条批注')
  assert.equal(f.writes[1].payload.span.start, 2)
  assert.equal(f.writes[1].payload.span.end, 2 + ref.clipboardText.length)
  f.s.values.clear()
  f.service.recover('s')
  const missing = f.writes[2].payload.reference
  assert.equal(missing.label, '批注待恢复')
  await assert.rejects(() => f.source.codec.serialize(missing.ref, new AbortController().signal), /无法恢复/)
  f.state = { draft: token(ref.ref), draftRev: 6, phase: 'submitting', occurrences: [] }
  f.service.recover('s')
  assert.equal(f.writes.length, 3)
})
