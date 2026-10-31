import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { KnowledgeBank, type KnowledgeCaller } from '../packages/dsh-px-memory/src/knowledge'
import { knowledgeAction } from '../packages/dsh-px-memory/src/knowledge-source'

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'px-feedback-')),
    store = new MemoryStore(join(root, 'memory.json'))
  store.bind('a')
  const p = store.createPersona('B')
  store.bind('b', { personaId: p.id })
  const a: KnowledgeCaller = { sessionId: 'a', project: root, actor: 'human' },
    b: KnowledgeCaller = { sessionId: 'b', project: root, actor: 'human' }
  let onEvidence: (() => Promise<void>) | undefined
  const evidence = async (_: KnowledgeCaller, source: string, seq: number) => {
    if (source !== 'a') throw Error('source is outside caller scope')
    await onEvidence?.()
    return seq === 1
      ? { kind: 'assistant', text: 'I know this is correct' }
      : seq === 2
        ? { kind: 'tool-result', tool: 'verify', failed: true, text: 'FAIL' }
        : seq === 3
          ? { kind: 'user', text: 'Please try this' }
          : { kind: 'tool-result', tool: 'verify', failed: false, text: 'REAL-SUCCESS-SAME-SOURCE' }
  }
  let bank = new KnowledgeBank(join(root, 'bank'), store, undefined, evidence)
  t.after(async () => {
    await bank.dispose()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  const write = async (key: string, body: string) =>
    bank.write(a, 'project', { key, body, revision: (await bank.catalog(a, 'project')).revision })
  return {
    a,
    b,
    root,
    store,
    get bank() {
      return bank
    },
    write,
    setEvidenceHook: (hook: () => Promise<void>) => {
      onEvidence = hook
    },
    reopen: async () => {
      await bank.dispose()
      bank = new KnowledgeBank(join(root, 'bank'), store, undefined, evidence)
    }
  }
}

test('feedback ranks equally relevant native documents, stays persona-local and repeated retrieval never strengthens it', async (t) => {
  const f = fixture(t),
    first = await f.write('alpha', 'memorytoken 方法 A'),
    second = await f.write('beta', 'memorytoken 方法 B')
  const vote = {
    id: first.document.id,
    documentRevision: 1,
    kind: 'confirmed' as const,
    reason: '已核对这版'
  }
  assert.equal((await f.bank.feedback(f.a, 'project', vote)).duplicate, false)
  assert.equal((await f.bank.feedback(f.a, 'project', { ...vote, reason: '再点一次' })).duplicate, true)
  const search = await f.bank.search(f.a, 'project', 'memorytoken')
  assert.equal(search.results[0].id, first.document.id)
  assert.equal(search.results[0].feedback.strength, 2)
  assert.equal(search.results.find((d: any) => d.id === second.document.id).feedback.strength, 0)
  await f.bank.search(f.a, 'project', 'memorytoken')
  await f.reopen()
  assert.equal((await f.bank.read(f.a, 'project', first.document.id)).document.feedback.count, 1)
  assert.equal((await f.bank.read(f.b, 'project', first.document.id)).document.feedback.count, 0)
  assert.equal((await f.bank.feedback(f.a, 'project', vote)).duplicate, true)
})

test('human dispute overrides positive feedback; native correction/archive and stale references dominate all old weights', async (t) => {
  const f = fixture(t),
    first = await f.write('主题', 'WRONG_OLD_memorytoken')
  const base = { id: first.document.id, documentRevision: 1, reason: '核对记录' }
  await f.bank.feedback(f.a, 'project', { ...base, kind: 'confirmed' })
  await f.bank.feedback(f.a, 'project', { ...base, kind: 'disputed' })
  assert.equal((await f.bank.search(f.a, 'project', 'memorytoken')).results.length, 0)
  const normal = await f.bank.read(f.a, 'project', first.document.id)
  assert.equal(normal.document.current, false)
  assert.equal(normal.document.body, undefined)
  assert.match((await f.bank.read(f.a, 'project', first.document.id, true)).document.body, /WRONG/)
  const correct = await f.write('主题', 'CORRECT_NEW_memorytoken')
  assert.equal(correct.document.revision, 2)
  assert.equal(correct.document.current, true)
  assert.equal(correct.document.feedback.count, 0)
  await assert.rejects(f.bank.feedback(f.a, 'project', { ...base, kind: 'useful' }), /已变化/)
  const archived = await f.bank.archive(f.a, 'project', correct.document.id, correct.revision, 2)
  assert.equal(archived.document.current, false)
  await assert.rejects(
    f.bank.feedback(f.a, 'project', { ...base, documentRevision: 2, kind: 'confirmed' }),
    /归档/
  )
  assert.equal((await f.bank.search(f.a, 'project', 'CORRECT_NEW')).results.length, 0)
})

test('model application feedback requires scoped native evidence, cannot confirm itself and deduplicates copies', async (t) => {
  const f = fixture(t),
    first = await f.write('方法', '可复用步骤'),
    caller = { ...f.a, actor: 'model' as const }
  const input = { id: first.document.id, documentRevision: 1, kind: 'useful' as const, reason: '本次有帮助' }
  await assert.rejects(f.bank.feedback(caller, 'project', input), /原始事件/)
  await assert.rejects(f.bank.feedback(caller, 'project', { ...input, kind: 'confirmed' }), /用户操作/)
  for (const seq of [1, 2, 3])
    await assert.rejects(f.bank.feedback(caller, 'project', { ...input, evidence: { sessionId: 'a', seq } }))
  await assert.rejects(
    f.bank.feedback(caller, 'project', { ...input, evidence: { sessionId: 'b', seq: 10 } }),
    /outside caller/
  )
  const one = await f.bank.feedback(caller, 'project', { ...input, evidence: { sessionId: 'a', seq: 10 } })
  assert.equal(one.feedback.confirmed, false)
  assert.equal(one.feedback.strength, 1)
  const duplicate = await f.bank.feedback(caller, 'project', {
    ...input,
    evidence: { sessionId: 'a', seq: 11 }
  })
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.feedback.count, 1)
  // Actor supplied in tool JSON must not become human authority.
  await assert.rejects(
    knowledgeAction(f.bank, caller, {
      ...input,
      action: 'feedback',
      scope: 'project',
      actor: 'human',
      kind: 'confirmed'
    }),
    /用户操作/
  )
})

test('an asynchronous feedback reader cannot reapply a forgotten or corrected revision', async (t) => {
  const f = fixture(t),
    first = await f.write('主题', 'OLD'),
    caller = { ...f.a, actor: 'model' as const }
  f.setEvidenceHook(async () => {
    await f.write('主题', 'NEW')
  })
  await assert.rejects(
    f.bank.feedback(caller, 'project', {
      id: first.document.id,
      documentRevision: 1,
      kind: 'useful',
      reason: '迟到结果',
      evidence: { sessionId: 'a', seq: 10 }
    }),
    /迟到反馈/
  )
  const current = await f.bank.read(f.a, 'project', first.document.id)
  assert.equal(current.document.body, 'NEW')
  assert.equal(current.document.feedback.count, 0)
})
