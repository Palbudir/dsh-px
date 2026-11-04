import test from 'node:test'
import assert from 'node:assert/strict'
import { ForegroundResource } from '../packages/dsh-px-computer/src/foreground-resource'
import { DesktopDriver } from '../packages/dsh-px-computer/src/desktop'

const signal = () => new AbortController().signal
test('foreground reservations expire without stealing active input; old generations cannot release a successor', () => {
  let now = 0
  const resource = new ForegroundResource(() => now)
  const a = resource.reserve('a', 1000)
  resource.enter('a', a.generation)
  now = 1001
  assert.equal(resource.availability('b').available, false)
  assert.throws(() => resource.reserve('b'), /占用|释放/)
  assert.throws(() => resource.assertCurrent('a', a.generation), /到期|释放/)
  resource.leave('a', a.generation)
  const next = resource.reserve('a', 1000)
  assert.notEqual(next.generation, a.generation)
  assert.throws(() => resource.release('a', a.generation), /旧记录/)
  assert.throws(() => resource.reserve('a', 1000, a.generation), /旧记录/)
  assert.equal(resource.snapshot()?.generation, next.generation)
  resource.cancelOwner('a', a.generation)
  assert.equal(resource.snapshot()?.generation, next.generation)
  resource.reserve('a', 60_000)
  const long = resource.snapshot()!.expiresAt
  resource.reserve('a', 1000)
  assert.equal(resource.snapshot()?.expiresAt, long)
  resource.reset()
})

test('foreground waiting is cancellable and reports availability without acquiring it', async () => {
  const resource = new ForegroundResource(),
    a = resource.reserve('a')
  const cancelled = new AbortController()
  const rejected = assert.rejects(resource.waitAvailable('b', cancelled.signal, 1000), /cancel wait/)
  const waiting = resource.waitAvailable('c', signal(), 1000)
  cancelled.abort(Error('cancel wait'))
  await rejected
  assert.equal(resource.snapshot()?.sessionId, 'a')
  resource.release('a', a.generation)
  assert.equal((await waiting).available, true)
  assert.equal(resource.snapshot(), null)
})

test('desktop foreground steps retain one owner while background reads remain usable', async () => {
  const calls: string[] = []
  const driver = new DesktopDriver(async () => ({
    callTool: async (name, _args, options) => {
      calls.push(`${options?.scope}:${name}`)
      return { rawJson: '{"content":[]}' }
    },
    shutdown: async () => {}
  }))
  try {
    await driver.call('get_window_state', {}, signal(), 'b')
    await driver.call('click', { delivery_mode: 'foreground' }, signal(), 'a')
    await driver.call('get_window_state', {}, signal(), 'a')
    await assert.rejects(
      async () => driver.call('click', { delivery_mode: 'foreground' }, signal(), 'b'),
      /占用/
    )
    await driver.call('get_window_state', {}, signal(), 'b')
    await driver.call('click', { delivery_mode: 'foreground' }, signal(), 'a')
    driver.foreground.cancelOwner('a')
    // b observed before a's second click, so its coordinates must not be replayed.
    await assert.rejects(driver.call('click', { delivery_mode: 'foreground' }, signal(), 'b'), /重新观察/)
    await driver.call('bring_to_front', {}, signal(), 'b')
    await assert.rejects(driver.call('click', { delivery_mode: 'foreground' }, signal(), 'b'), /重新观察/)
    await driver.call('get_window_state', {}, signal(), 'b')
    await driver.call('click', { delivery_mode: 'foreground' }, signal(), 'b')
    assert.equal(calls.filter((c) => c === 'b:click').length, 1)
    assert.equal(calls.filter((c) => c === 'a:click').length, 2)
  } finally {
    await driver.close()
  }
})

test('releasing a queued reservation cancels its original effect without revoking a new generation', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const calls: string[] = []
  const driver = new DesktopDriver(async () => ({
    callTool: async (name) => {
      calls.push(name)
      if (name === 'background-read') await pending
      return { rawJson: '{"content":[]}' }
    },
    shutdown: async () => {}
  }))
  const read = driver.call('background-read', {}, signal(), 'b')
  await new Promise((resolve) => setImmediate(resolve))
  const queued = driver.call('click', { delivery_mode: 'foreground' }, signal(), 'a')
  const rejected = assert.rejects(queued, /到期|释放/)
  const old = driver.foreground.snapshot()!
  driver.foreground.release('a', old.generation)
  const next = driver.foreground.reserve('c')
  finish()
  await read
  await rejected
  assert.deepEqual(calls, ['background-read'])
  assert.equal(driver.foreground.snapshot()?.generation, next.generation)
  await driver.close()
})

test('release during driver loading prevents pending foreground effects and retains occupancy until settled', async () => {
  let ready!: (value: any) => void
  const loading = new Promise<any>((resolve) => {
    ready = resolve
  })
  let effects = 0
  const driver = new DesktopDriver(() => loading)
  const action = driver.call('bring_to_front', {}, signal(), 'a')
  const rejected = assert.rejects(action, /到期|释放/)
  await new Promise((resolve) => setImmediate(resolve))
  const current = driver.foreground.snapshot()!
  driver.foreground.release('a', current.generation)
  assert.equal(driver.foreground.availability('b').available, false)
  ready({
    callTool: async () => {
      effects++
      return { rawJson: '{}' }
    },
    shutdown: async () => {}
  })
  await rejected
  assert.equal(effects, 0)
  assert.equal(driver.foreground.availability('b').available, true)
  await driver.close()
})
