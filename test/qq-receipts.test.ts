import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { QqReceipts, UncertainQqReceipt, receiptKey } from '../packages/dsh-px-qq/src/receipts'

test('concurrent delivery and a restarted adapter do not repeat one accepted native input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'px-qq-receipts-')),
    file = join(root, 'receipts.json')
  try {
    const store = new QqReceipts(file),
      key = receiptKey('transfer', ['account', 'group', 'message'])
    let calls = 0,
      release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const operation = async () => {
      calls++
      await held
      return { sessionId: 'session-a', messageId: 'input-a' }
    }
    const a = store.once(key, operation),
      b = store.once(key, operation)
    release()
    const [first, second] = await Promise.all([a, b])
    assert.equal(calls, 1)
    assert.deepEqual(first, second)
    const restarted = new QqReceipts(file)
    assert.equal(
      (
        await restarted.once(key, async () => {
          calls++
          return undefined
        })
      ).duplicate,
      true
    )
    assert.equal(calls, 1)
    assert.match(await readFile(file, 'utf8'), /processed/)
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    await rm(root, { recursive: true, force: true })
  }
})

test('uncertain dispatch is retained and cannot be auto-replayed; a new user request has a different identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'px-qq-uncertain-')),
    file = join(root, 'receipts.json')
  try {
    const store = new QqReceipts(file),
      old = receiptKey('inbound', ['account', 'chat', 'old'])
    let calls = 0
    await assert.rejects(
      store.once(old, async () => {
        calls++
        throw Error('unknown native outcome')
      }),
      /unknown/
    )
    const restarted = new QqReceipts(file)
    await assert.rejects(
      restarted.once(old, async () => {
        calls++
        return undefined
      }),
      UncertainQqReceipt
    )
    assert.equal(calls, 1)
    await restarted.once(receiptKey('inbound', ['account', 'chat', 'new']), async () => {
      calls++
      return undefined
    })
    assert.equal(calls, 2)
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    await rm(root, { recursive: true, force: true })
  }
})
