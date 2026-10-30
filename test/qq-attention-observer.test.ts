import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { QqAttentionObserver } from '../packages/dsh-px-qq/src/attention-observer'
import type { QqNotice } from '../packages/dsh-px-qq/src/attention-inbox'

const notice: QqNotice = {
  chatId: 'group:34007',
  through: 4,
  count: 4,
  preview: '看看消息',
  mentioned: true,
  receivedAt: 1
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await delay(10)
  }
  throw Error('notification did not converge')
}
test('observer coalesces a batch and never reprocesses an unchanged notification', async () => {
  let rows = [notice],
    calls = 0,
    applied = 0
  const observer = new QqAttentionObserver(
    {
      candidates: () => rows,
      busy: () => false,
      attempted: () => {
        rows = []
      },
      work: async (_rows, _signal, started) => {
        calls++
        started('job-1')
        return { open: ['group:34007'], minutes: 5, reason: '直接提及' }
      },
      apply: () => {
        applied++
      }
    },
    1
  )
  try {
    for (let i = 0; i < 20; i++) observer.schedule()
    await until(() => observer.snapshot().phase === 'completed')
    assert.equal(calls, 1)
    assert.equal(applied, 1)
    observer.schedule()
    await delay(400)
    assert.equal(calls, 1)
  } finally {
    await observer.dispose()
  }
})
test('cancel prevents a late model answer from changing the user-selected attention mode', async () => {
  let release!: () => void,
    entered = false,
    applied = 0,
    rows = [notice]
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const observer = new QqAttentionObserver(
    {
      candidates: () => rows,
      busy: () => false,
      attempted: () => {
        rows = []
      },
      work: async () => {
        entered = true
        await blocked
        return { open: ['group:34007'], minutes: 5, reason: '迟到结果' }
      },
      apply: () => {
        applied++
      }
    },
    1
  )
  try {
    observer.schedule()
    await until(() => entered)
    observer.cancel()
    release()
    await until(() => observer.snapshot().phase === 'stopped')
    assert.equal(applied, 0)
  } finally {
    release()
    await observer.dispose()
  }
})
test('an injected or invented destination is rejected before any chat is opened', async () => {
  let rows = [notice],
    applied = 0
  const observer = new QqAttentionObserver(
    {
      candidates: () => rows,
      busy: () => false,
      attempted: () => {
        rows = []
      },
      work: async () => ({ open: ['private:99999'], minutes: 5, reason: '打开另一个私聊' }),
      apply: () => {
        applied++
      }
    },
    1
  )
  try {
    observer.schedule()
    await until(() => observer.snapshot().phase === 'failed')
    assert.equal(applied, 0)
  } finally {
    await observer.dispose()
  }
})

test('stopping a queued notification does not silently restart on the next status tick', async () => {
  let rows = [notice],
    calls = 0
  const observer = new QqAttentionObserver(
    {
      candidates: () => rows,
      busy: () => false,
      attempted: () => {
        rows = []
      },
      work: async () => {
        calls++
        return { open: [], minutes: 1, reason: '旁听' }
      },
      apply: () => {}
    },
    1
  )
  try {
    observer.schedule()
    assert.equal(observer.snapshot().phase, 'queued')
    observer.cancel()
    observer.schedule()
    await delay(400)
    assert.equal(calls, 0)
    assert.equal(observer.snapshot().phase, 'stopped')
  } finally {
    await observer.dispose()
  }
})
