import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DriverProcess } from '../packages/dsh-px-computer/src/driver-process'
import { DesktopDriver } from '../packages/dsh-px-computer/src/desktop'

const fake = `export class CuaDriver {
  static async create() { return new CuaDriver() }
  async callTool(name, args) {
    if (name === 'crash') process.exit(19);
    if (name === 'hang') await new Promise(() => {});
    if (name === 'error') throw Error('driver rejected action');
    return {rawJson: JSON.stringify({content: [], structuredContent: {pid: process.pid, args: JSON.parse(args)}})};
  }
}`
function fixture(t: any, timeout = 3000, source = fake) {
  const dir = mkdtempSync(join(tmpdir(), 'px-driver-test-'))
  writeFileSync(join(dir, 'fake.mjs'), source)
  let resets = 0
  const worker = new DriverProcess(pathToFileURL(join(dir, 'fake.mjs')).href, () => resets++, timeout)
  t.after(async () => {
    await worker.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })
  return { worker, resets: () => resets }
}
const signal = () => new AbortController().signal

test('native calls run outside host; driver errors do not replay an action', async (t) => {
  const { worker } = fixture(t)
  const value = JSON.parse((await worker.callTool('read', '{"target":7}')).rawJson)
  assert.notEqual(value.structuredContent.pid, process.pid)
  assert.deepEqual(value.structuredContent.args, { target: 7 })
  await assert.rejects(worker.callTool('error', '{}'), /driver rejected/)
  const after = JSON.parse((await worker.callTool('read', '{}')).rawJson)
  assert.equal(after.structuredContent.pid, value.structuredContent.pid)
})

test('crashed worker rejects current action and resets only on a new explicit call', async (t) => {
  const f = fixture(t)
  const before = JSON.parse((await f.worker.callTool('read', '{}')).rawJson)
  await assert.rejects(f.worker.callTool('crash', '{}'), /19/)
  assert.equal(f.resets(), 1)
  const after = JSON.parse((await f.worker.callTool('read', '{}')).rawJson)
  assert.notEqual(after.structuredContent.pid, before.structuredContent.pid)
})

test('abort interrupts blocked native call, invalidates observations, and releases serial queue', async (t) => {
  const f = fixture(t)
  const driver = new DesktopDriver(async () => f.worker)
  await driver.call('read', {}, signal())
  const ac = new AbortController()
  const blocked = driver.call('hang', {}, ac.signal)
  const queued = driver.call('read', { next: true }, signal())
  setTimeout(() => ac.abort(), 50)
  await assert.rejects(blocked, /取消/)
  const next = await queued
  assert.equal(next.structuredContent.args.next, true)
  assert.equal(f.resets(), 1)
  await driver.close()
})

test('timeout reports unknown result without automatic replay', async (t) => {
  const f = fixture(t, 500)
  await f.worker.callTool('read', '{}')
  await assert.rejects(f.worker.callTool('hang', '{}'), /结果未知/)
  assert.equal(f.resets(), 1)
})

test('close stops a blocked driver rather than waiting for the call to finish', async (t) => {
  const f = fixture(t)
  const driver = new DesktopDriver(async () => f.worker)
  await driver.call('read', {}, signal())
  const rejected = assert.rejects(driver.call('hang', {}, signal()), /关闭/)
  await new Promise((resolve) => setTimeout(resolve, 30))
  await driver.close()
  await rejected
  assert.equal(driver.loaded, false)
})

test('abort during native initialization also settles promptly', async (t) => {
  const f = fixture(t, 3000, 'await new Promise(() => {});')
  const ac = new AbortController()
  const call = f.worker.callTool('read', '{}', { signal: ac.signal })
  setTimeout(() => ac.abort(), 30)
  await assert.rejects(call, /取消/)
})
