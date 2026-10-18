import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { InputInstances, INSTANCE_PROTOCOL } from '../packages/dsh-px-computer/src/instances'

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'px-instance-test-'))
  const instance = randomUUID(),
    token = 'a'.repeat(64),
    pid = 123,
    lease = randomUUID()
  let frame = randomUUID(),
    held = false,
    slow = false
  const calls: string[] = []
  const status = () => ({
    protocol: INSTANCE_PROTOCOL,
    instance,
    pid,
    isolated: true,
    application: 'fixture',
    active: held,
    held_keys: held ? [26] : [],
    held_buttons: [],
    native_left_pressed: false,
    native_forward_pressed: held,
    native_attack_pressed: false
  })
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`)
    calls.push(req.url!)
    let text = ''
    for await (const chunk of req) text += chunk
    const body = text ? JSON.parse(text) : {}
    let result: any = status()
    if (req.url === '/observe') {
      frame = randomUUID()
      result = {
        ...result,
        frame_id: frame,
        png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        input_width: 1,
        input_height: 1
      }
    }
    if (req.url === '/lease') {
      held = true
      result.lease = lease
    }
    if (req.url === '/release') held = false
    if (req.url === '/input') {
      assert.equal(body.lease, lease)
      assert.equal(body.frame_id, frame)
      assert.match(body.request_id, /^[a-f0-9-]{36}$/)
      if (slow) await new Promise((r) => setTimeout(r, 300))
      held = false
      result = { ...result, ok: true, released: true, elapsed_ms: 10 }
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(result))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  await writeFile(
    join(directory, instance + '.json'),
    JSON.stringify({ protocol: INSTANCE_PROTOCOL, instance, pid, port, token })
  )
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
    await rm(directory, { recursive: true, force: true })
  })
  return {
    client: new InputInstances(directory),
    instance,
    calls,
    held: () => held,
    slow: () => {
      slow = true
    },
    directory
  }
}
test('independent input consumes a session-owned observation and releases its lease', async (t) => {
  const f = await fixture(t),
    signal = new AbortController().signal
  assert.equal((await f.client.list(signal)).length, 1)
  const state = await f.client.observe('a', f.instance, signal)
  const frame = state.text.match(/frame_id=([a-f0-9-]+)/)![1]
  const args = { instance: f.instance, frame_id: frame, duration_ms: 10, keys: ['W'] }
  await assert.rejects(f.client.input('b', args, signal), /先观察/)
  await f.client.input('a', args, signal)
  assert.equal(f.held(), false)
  assert.equal(f.calls.filter((p) => p === '/input').length, 1)
  assert.ok(f.calls.includes('/release'))
  await assert.rejects(f.client.input('a', args, signal), /先观察/)
})
test('native cancellation sends release independently of the aborted action signal', async (t) => {
  const f = await fixture(t),
    controller = new AbortController()
  const state = await f.client.observe('a', f.instance, controller.signal)
  f.slow()
  const action = f.client.input(
    'a',
    { instance: f.instance, frame_id: state.text.match(/frame_id=([a-f0-9-]+)/)![1], duration_ms: 1000 },
    controller.signal
  )
  setTimeout(() => controller.abort(Error('native stop')), 70)
  await assert.rejects(action, /native stop/)
  assert.ok(f.calls.includes('/release'))
  assert.equal(f.held(), false)
})
test('connection discovery never accepts a URL or a descriptor for a different instance', async (t) => {
  const f = await fixture(t),
    signal = new AbortController().signal
  await assert.rejects(f.client.observe('a', 'http://external.invalid', signal), /ID 无效/)
  await writeFile(
    join(f.directory, f.instance + '.json'),
    JSON.stringify({
      protocol: INSTANCE_PROTOCOL,
      instance: randomUUID(),
      pid: 123,
      port: 1234,
      token: 'b'.repeat(64)
    })
  )
  assert.deepEqual(await f.client.list(signal), [])
  assert.equal(f.calls.length, 0)
})

test('pause and resume invalidate an old observation without sending input', async (t) => {
  const f = await fixture(t),
    signal = new AbortController().signal
  const state = await f.client.observe('a', f.instance, signal)
  f.client.forget('a')
  await assert.rejects(
    f.client.input(
      'a',
      { instance: f.instance, frame_id: state.text.match(/frame_id=([a-f0-9-]+)/)![1], duration_ms: 10 },
      signal
    ),
    /先观察/
  )
  assert.equal(f.calls.filter((p) => p === '/input').length, 0)
})
