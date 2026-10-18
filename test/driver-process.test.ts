import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
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

test('native SDK error variants preserve their actionable code and reason', async (t) => {
  const { worker } = fixture(
    t,
    3000,
    `export const CuaDriver={async create(){return {async callTool(){const error=Error('DriverError.Tool');error.inner={tool:'list_windows',errorCode:'session_expired',message:'The transport session is no longer active'};throw error;}}}}`
  )
  await assert.rejects(
    worker.callTool('list_windows', '{}'),
    /\[session_expired\] The transport session is no longer active/
  )
})

test('ending one session transport cannot poison another; reopening requires explicit release', async (t) => {
  const { worker } = fixture(
    t,
    3000,
    `let next=0;
    export const CuaDriver={async create(){const id=++next;let ended=false;return {
      uniffiDestroy(){ended=true},
      async callTool(name){
        if(ended){const error=Error('DriverError.Tool');error.inner={tool:name,errorCode:'1',message:"session 'sdk-11111111-1111-1111-1111-111111111111' has ended; tool call 'list_windows' was rejected. Call start_session to revive it."};throw error;}
        if(name==='end-transport')ended=true;
        return {rawJson:JSON.stringify({id})};
      }
    }}};
  `
  )
  const read = async (scope: string) =>
    JSON.parse((await worker.callTool('list_windows', '{}', { scope })).rawJson).id
  const first = await read('session-a'),
    second = await read('session-b')
  assert.notEqual(first, second)
  await worker.callTool('end-transport', '{}', { scope: 'session-a' })
  await assert.rejects(read('session-a'), (error: any) => error.code === 'driver_session_ended')
  assert.equal(await read('session-b'), second)
  await assert.rejects(read('session-a'), /恢复/)
  await worker.callTool('__px_close_scope', '{}', { scope: 'session-a' })
  assert.notEqual(await read('session-a'), first)
  assert.equal(await read('session-b'), second)
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

test('explicit resume replaces ended named sessions before the first read, without replay or cross-session changes', async (t) => {
  const { worker } = fixture(
    t,
    3000,
    `
    let next=0;const ended=new Set();const started=[];
    export const CuaDriver={async create(){const id=++next;return {
      uniffiDestroy(){},
      async callTool(name,json){
        const args=JSON.parse(json);
        if(name==='start_session'){ended.delete(args.session);started.push(args.session);}
        else if(name==='end_session')ended.add(args.session);
        else if(ended.has(args.session)){
          const error=Error('DriverError.Tool');
          error.inner={errorCode:'1',message:"session '"+args.session+"' has ended; tool call '"+name+"' was rejected. Call start_session to revive it."};throw error;
        }
        return {rawJson:JSON.stringify({content:[],structuredContent:{id,args,started:[...started]}})};
      }
    }}};
  `
  )
  const driver = new DesktopDriver(async () => worker)
  const a = driver.forSession('session-a'),
    b = driver.forSession('session-b')
  await a.call('start_session', { session: 'px-aaaa' }, signal())
  const initial = await a.call('get_window_state', { session: 'px-aaaa' }, signal())
  const other = await b.call('get_window_state', { session: 'px-bbbb' }, signal())
  await a.call('end_session', { session: 'px-aaaa' }, signal())
  await assert.rejects(
    a.call('get_window_state', { session: 'px-aaaa' }, signal()),
    (e: any) => e.code === 'driver_session_ended'
  )
  // A fresh SDK connection alone does not remove the service's named-session tombstone.
  await driver.releaseSession('session-a')
  const resumed = await a.call('get_window_state', { session: 'px-aaaa' }, signal())
  assert.notEqual(resumed.structuredContent.id, initial.structuredContent.id)
  assert.notEqual(resumed.structuredContent.args.session, initial.structuredContent.args.session)
  assert.deepEqual(resumed.structuredContent.started, ['px-aaaa'])
  const later = await a.call('start_session', { session: 'px-aaaa' }, signal())
  assert.equal(later.structuredContent.args.session, resumed.structuredContent.args.session)
  const unchanged = await b.call('get_window_state', { session: 'px-bbbb' }, signal())
  assert.equal(unchanged.structuredContent.id, other.structuredContent.id)
  assert.equal(unchanged.structuredContent.args.session, other.structuredContent.args.session)
  await driver.close()
})

test('release rejects previously queued work only for its scope', async () => {
  let unblock!: () => void, entered!: () => void
  const gate = new Promise<void>((resolve) => {
    unblock = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const calls: string[] = []
  const driver = new DesktopDriver(async () => ({
    async callTool(name, json) {
      if (name === 'hold-other') {
        entered()
        await gate
      }
      calls.push(name)
      return { rawJson: JSON.stringify({ structuredContent: JSON.parse(json) }) }
    },
    async shutdown() {}
  }))
  const active = driver.call('hold-other', {}, signal(), 'other')
  await started
  const stale = assert.rejects(driver.call('click', { session: 'px-a' }, signal(), 'a'), /原排队动作未执行/)
  const released = driver.releaseSession('a')
  unblock()
  await active
  await stale
  await released
  assert.ok(!calls.includes('click'))
  const fresh = await driver.call('get_window_state', { session: 'px-a' }, signal(), 'a')
  assert.notEqual(fresh.structuredContent.session, 'px-a')
  await driver.close()
})

test('an unrelated named-session error is not mistaken for the caller session ending', async (t) => {
  const { worker } = fixture(
    t,
    3000,
    `export const CuaDriver={async create(){return {async callTool(){const error=Error('DriverError.Tool');error.inner={errorCode:'1',message:"session 'px-unrelated' has ended; tool call 'get_window_state' was rejected."};throw error;}}}}`
  )
  await assert.rejects(
    worker.callTool('get_window_state', '{"session":"px-owned"}', { scope: 'owned' }),
    (e: any) => e.code !== 'driver_session_ended' && /px-unrelated/.test(e.message)
  )
})

test('abort during native initialization also settles promptly', async (t) => {
  const f = fixture(t, 3000, 'await new Promise(() => {});')
  const ac = new AbortController()
  const call = f.worker.callTool('read', '{}', { signal: ac.signal })
  setTimeout(() => ac.abort(), 30)
  await assert.rejects(call, /取消/)
})

test('native mode verifies binaries and connects only to its owned daemon endpoint', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'px-native-driver-test-'))
  const binaryPath = join(dir, 'cua-driver.exe')
  writeFileSync(binaryPath, 'verified test fixture')
  const digest = createHash('sha256').update('verified test fixture').digest('hex')
  writeFileSync(
    join(dir, 'sdk.mjs'),
    `
    let options;
    export const EmbeddedPermissionMode = { Standard: 0 };
    export const EmbeddedDriverHostOptions = { create: value => value };
    export const EmbeddedCuaDriverHost = { withOptions(value) {
      options=value;
      return { async start(){return {socketPath:'owned-private-endpoint',driverVersion:'0.28.0',generation:'one'}},
        async stop(){}, waitForExit(){return new Promise(()=>{})} };
    }};
    export const CuaDriver = {
      create(){throw Error('must not use DPI-virtualized in-process runtime')},
      connect(endpoint){
        if(endpoint!=='owned-private-endpoint')throw Error('must not attach shared daemon');
        return {async callTool(){return {rawJson:JSON.stringify({endpoint,options})}}};
      }
    };
  `
  )
  const worker = new DriverProcess(pathToFileURL(join(dir, 'sdk.mjs')).href, () => {}, 3000, {
    binaryPath,
    version: '0.28.0',
    files: { 'cua-driver.exe': digest }
  })
  t.after(async () => {
    await worker.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })
  const result = JSON.parse((await worker.callTool('read', '{}')).rawJson)
  assert.equal(result.endpoint, 'owned-private-endpoint')
  assert.equal(result.options.binaryPath, binaryPath)
  assert.equal(result.options.dangerouslyBypassApprovals, false)
  assert.equal(result.options.permissionMode, 0)
  assert.deepEqual(result.options.environment, [{ name: 'CUA_DRIVER_RS_TELEMETRY_ENABLED', value: 'false' }])
})

test('tampered native executable is rejected before starting or attaching a daemon', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'px-native-integrity-test-'))
  writeFileSync(join(dir, 'fake.mjs'), fake)
  writeFileSync(join(dir, 'cua-driver.exe'), 'changed')
  const worker = new DriverProcess(pathToFileURL(join(dir, 'fake.mjs')).href, () => {}, 3000, {
    binaryPath: join(dir, 'cua-driver.exe'),
    version: '0.28.0',
    files: { 'cua-driver.exe': '0'.repeat(64) }
  })
  t.after(async () => {
    await worker.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })
  await assert.rejects(worker.callTool('read', '{}'), /原生驱动校验失败/)
})
