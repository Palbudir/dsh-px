import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { inspectOneBot } from '../packages/dsh-px-qq/src/connection'

function factory(online: boolean, statusFirst: boolean) {
  return class Socket extends EventEmitter {
    calls: any[] = []
    constructor() {
      super()
      queueMicrotask(() => this.emit('open'))
    }
    send(raw: string) {
      this.calls.push(JSON.parse(raw))
      if (this.calls.length !== 2) return
      const calls = [...this.calls].sort((a) => ((a.action === 'get_status') === statusFirst ? -1 : 1))
      queueMicrotask(() =>
        calls.forEach((m) =>
          this.emit(
            'message',
            JSON.stringify({
              status: 'ok',
              echo: m.echo,
              data:
                m.action === 'get_status' ? { online, good: online } : { user_id: 12345, nickname: 'fixture' }
            })
          )
        )
      )
    }
    terminate() {}
  }
}
test('connection probe requires both account identity and actual online state in either reply order', async () => {
  for (const statusFirst of [false, true]) {
    assert.deepEqual(
      await inspectOneBot('ws://127.0.0.1:3001', 'fixture', undefined, factory(true, statusFirst)),
      { accountId: '12345', nickname: 'fixture' }
    )
    await assert.rejects(
      inspectOneBot('ws://127.0.0.1:3001', 'fixture', undefined, factory(false, statusFirst)),
      /不在线/
    )
  }
})
