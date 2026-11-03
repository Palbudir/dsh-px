import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { ChannelSupervisor } from '../packages/shared/channel-supervisor'
type Config = { accountId: string; enabled: boolean; revision: number; mode: string }
async function until(check: () => boolean) {
  const end = Date.now() + 2000
  while (!check()) {
    if (Date.now() > end) assert.fail('supervisor timeout')
    await delay(5)
  }
}
function fixture(t: any) {
  const runtimes = new Map<string, Runtime>(),
    errors: unknown[] = [],
    created: Runtime[] = []
  class Runtime {
    stopped = false
    started = false
    disposed = false
    refreshes = 0
    stops = 0
    failStop = false
    gate?: Promise<void>
    constructor(readonly config: Config) {}
    matches(next: Config) {
      return !this.stopped && next.revision === this.config.revision
    }
    refreshAttention() {
      this.refreshes++
    }
    requestStop() {
      this.stopped = true
    }
    async start() {
      this.started = true
    }
    async dispose() {
      this.stops++
      if (this.failStop) throw Error('stop failed')
      await this.gate
      this.disposed = true
    }
  }
  const supervisor = new ChannelSupervisor<Config, Runtime>(
    runtimes,
    (config) => {
      const r = new Runtime(config)
      created.push(r)
      return r
    },
    (_id, error) => errors.push(error)
  )
  t.after(async () => {
    for (const r of created) {
      r.failStop = false
      r.gate = undefined
    }
    await supervisor.close()
  })
  const config = (accountId: string, revision = 1, mode = 'normal'): Config => ({
    accountId,
    revision,
    mode,
    enabled: true
  })
  return { runtimes, errors, created, supervisor, config }
}
test('attention edits keep the live account and another slow account cannot block replacement', async (t) => {
  const f = fixture(t)
  f.supervisor.update([f.config('a'), f.config('b')])
  await until(() => f.created.length === 2)
  const a = f.runtimes.get('a')!,
    b = f.runtimes.get('b')!
  f.supervisor.update([f.config('a', 1, 'focus'), f.config('b')])
  await until(() => a.refreshes > 0)
  assert.equal(f.created.length, 2)
  assert.equal(a.stops, 0)
  assert.equal(b.stops, 0)
  let release!: () => void
  a.gate = new Promise<void>((done) => {
    release = done
  })
  f.supervisor.update([f.config('a', 2), f.config('b', 2)])
  try {
    await until(() => f.runtimes.get('b')?.config.revision === 2)
    assert.equal(f.runtimes.get('a'), a)
    assert.equal(b.disposed, true)
  } finally {
    release()
  }
  await until(() => f.runtimes.get('a')?.config.revision === 2)
  assert.equal(f.errors.length, 0)
})
test('a failed stop does not spin or overlap owners and can be explicitly retried', async (t) => {
  const f = fixture(t)
  f.supervisor.update([f.config('a')])
  await until(() => f.created.length === 1)
  const a = f.runtimes.get('a')!
  a.failStop = true
  f.supervisor.update([f.config('a', 2)])
  await until(() => f.errors.length === 1)
  await delay(30)
  assert.equal(a.stops, 1)
  assert.equal(f.created.length, 1)
  a.failStop = false
  f.supervisor.retry('a')
  await until(() => f.created.length === 2)
  assert.equal(f.runtimes.get('a')?.config.revision, 2)
})
test('temporary pause survives unrelated edits and explicit resume uses the latest configuration', async (t) => {
  const f = fixture(t)
  f.supervisor.update([f.config('a'), f.config('b')])
  await until(() => f.created.length === 2)
  await f.supervisor.pause('a')
  assert.equal(f.runtimes.has('a'), false)
  f.supervisor.update([f.config('a', 2), f.config('b', 1, 'focus')])
  await delay(20)
  assert.equal(f.runtimes.has('a'), false)
  f.supervisor.retry('a')
  await until(() => f.runtimes.has('a'))
  assert.equal(f.runtimes.get('a')?.config.revision, 2)
})
