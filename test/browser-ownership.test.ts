import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  BrowserSessions,
  type BrowserClient,
  type BrowserLaunchOptions
} from '../packages/dsh-px-computer/src/browser'
import { McpStdioClient } from '../packages/dsh-px-computer/src/mcp-stdio'
import { BrowserResourceWaits } from '../packages/dsh-px-computer/src/resource-wait'
import { SessionStates } from '../packages/dsh-px-computer/src/runtime'

const deferred = <T = void>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const signal = () => new AbortController().signal
const options = (mode: BrowserLaunchOptions['mode']): BrowserLaunchOptions => ({
  mode,
  headless: true,
  cli: 'fixture',
  node: process.execPath,
  electron: false,
  profileDir: 'fixture'
})
const result = { content: [{ type: 'text', text: 'fixture result' }] }
const fake = (overrides: Partial<BrowserClient> = {}): BrowserClient => ({
  alive: true,
  start: async () => {},
  callTool: async () => result,
  close: async () => {},
  ...overrides
})
const directory = (t: any) => {
  const dir = mkdtempSync(join(tmpdir(), 'px-browser-owner-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('shared browser ownership survives slow and failed shutdown; stale release cannot stop a successor', async (t) => {
  const closing = deferred(),
    directoryPath = directory(t)
  let count = 0,
    fail = false
  const browsers = new BrowserSessions(
    () => options('profile'),
    directoryPath,
    {},
    () => {
      count++
      return fake({
        close: async () => {
          await closing.promise
          if (fail) throw Error('not exited')
        }
      })
    }
  )
  await browsers.call('a', undefined, 'a', 'browser_snapshot', {}, signal())
  const original = browsers.ownership()[0]
  const close = browsers.close('a')
  assert.equal(browsers.holder(), 'a')
  assert.equal(browsers.ownership()[0].phase, 'closing')
  await assert.rejects(browsers.call('b', undefined, 'b', 'browser_snapshot', {}, signal()), /另一个会话/)
  assert.equal(count, 1)
  fail = true
  closing.resolve()
  await assert.rejects(close, /not exited/)
  assert.equal(browsers.holder(), 'a')
  assert.equal(browsers.ownership()[0].phase, 'close-failed')
  await assert.rejects(browsers.call('a', undefined, 'a', 'browser_snapshot', {}, signal()), /not exited/)
  fail = false
  await browsers.release('a', original.generation)
  await browsers.call('a', undefined, 'a', 'browser_snapshot', {}, signal())
  assert.notEqual(browsers.ownership()[0].generation, original.generation)
  await assert.rejects(browsers.release('a', original.generation), /占用已变化/)
  assert.equal(browsers.holder(), 'a')
  await browsers.closeAll()
})

test('late startup failure cannot remove a new connection with the same session ID', async (t) => {
  const opening = deferred(),
    dir = directory(t)
  let count = 0
  const browsers = new BrowserSessions(
    () => options('profile'),
    dir,
    {},
    () => {
      const index = ++count
      return fake({ start: () => (index === 1 ? opening.promise : Promise.resolve()) })
    }
  )
  const old = browsers.call('a', undefined, 'a', 'browser_snapshot', {}, signal())
  const rejected = assert.rejects(old, /old start failed/)
  await browsers.close('a')
  await browsers.call('a', undefined, 'a', 'browser_snapshot', {}, signal())
  const successor = browsers.ownership()[0].generation
  opening.reject(Error('old start failed'))
  await rejected
  assert.equal(browsers.ownership()[0].generation, successor)
  assert.equal(browsers.holder(), 'a')
  await browsers.closeAll()
})

test('isolated browsers overlap while cancellation retains the old connection until it exits', async (t) => {
  const first = deferred<typeof result>(),
    closing = deferred(),
    dir = directory(t)
  let count = 0,
    secondCalled = false
  const browsers = new BrowserSessions(
    () => options('isolated'),
    dir,
    {},
    () => {
      const index = ++count
      return fake({
        callTool: async (_name, _args, input) => {
          if (index !== 1) {
            secondCalled = true
            return result
          }
          return new Promise((resolve, reject) => {
            input.addEventListener('abort', () => reject(input.reason), { once: true })
            first.promise.then(resolve, reject)
          })
        },
        close: () => (index === 1 ? closing.promise : Promise.resolve())
      })
    }
  )
  const cancel = new AbortController()
  const a = browsers.call('a', undefined, 'a', 'browser_snapshot', {}, cancel.signal)
  await browsers.call('b', undefined, 'b', 'browser_snapshot', {}, signal())
  assert.equal(secondCalled, true)
  assert.equal(browsers.ownership().find((r) => r.sessionId === 'a')?.activeCalls, 1)
  let finished = false
  const rejected = assert.rejects(a, /stop/).then(() => {
    finished = true
  })
  cancel.abort(Error('stop'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(finished, false)
  assert.equal(browsers.ownership().find((r) => r.sessionId === 'a')?.phase, 'closing')
  await assert.rejects(browsers.call('a', undefined, 'a', 'browser_snapshot', {}, signal()), /正在释放/)
  closing.resolve()
  await rejected
  assert.equal(
    browsers.ownership().some((r) => r.sessionId === 'a'),
    false
  )
  await browsers.closeAll()
})

test('MCP close callers await confirmed process exit rather than only a kill request', async (t) => {
  const dir = directory(t),
    file = join(dir, 'server.mjs')
  writeFileSync(
    file,
    `import {createInterface} from 'node:readline';
const read=createInterface({input:process.stdin});const keep=setInterval(()=>{},1000);
read.on('line',line=>{const m=JSON.parse(line);if(m.id)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{}}:{content:[{type:'text',text:String(process.pid)}]}})+'\\n')});
read.on('close',()=>setTimeout(()=>{clearInterval(keep);process.exit(0)},150));`
  )
  const client = new McpStdioClient({
    command: process.execPath,
    args: [file],
    cwd: dir,
    env: { ...process.env } as any,
    roots: []
  })
  await client.start(signal())
  const pid = Number((await client.callTool('pid', {}, signal())).content[0].text)
  const began = Date.now(),
    first = client.close(),
    second = client.close()
  let done = false
  void second.then(() => {
    done = true
  })
  await new Promise((resolve) => setTimeout(resolve, 35))
  assert.equal(done, false)
  await Promise.all([first, second])
  assert.ok(Date.now() - began >= 100)
  assert.throws(() => process.kill(pid, 0))
})

test('resource waits return native jobs, cancel independently, and notify only after ownership releases', async (t) => {
  const closing = deferred(),
    browsers = new BrowserSessions(
      () => options('profile'),
      directory(t),
      {},
      () => fake({ close: () => closing.promise })
    )
  await browsers.call('holder', undefined, 'holder', 'browser_snapshot', {}, signal())
  const states = new SessionStates(),
    waits = new BrowserResourceWaits(browsers, states),
    jobs: any[] = []
  const agent = {
    session: { id: 'waiting', seq: 17 },
    ctx: {
      jobs: {
        start: (spec: any) => {
          const id = 'job-' + jobs.length
          const hooks = spec.run({ id })
          jobs.push({ id, spec, hooks })
          return id
        }
      }
    }
  }
  const first = waits.start(agent, 30000, signal())
  assert.equal(first.jobId, 'job-0')
  assert.deepEqual(waits.start(agent, 1000, signal()), { jobId: first.jobId, existing: true })
  jobs[0].hooks.cancel('stop waiting')
  assert.equal((await jobs[0].hooks.done).status, 'killed')
  assert.equal(browsers.holder(), 'holder', 'cancelling a waiter must not stop the owner')
  waits.start(agent, 30000, signal())
  let finished = false
  const done = jobs[1].hooks.done.then((value: any) => {
    finished = true
    return value
  })
  const release = browsers.close('holder')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(finished, false)
  closing.resolve()
  await release
  const outcome = await done,
    result = JSON.parse(outcome.result)
  assert.equal(outcome.status, 'completed')
  assert.equal(result.available, true)
  assert.equal(result.reserved, false)
  assert.equal(result.sourceSessionId, 'waiting')
  assert.equal(result.sourceSeq, 17)
  await waits.dispose()
})

test('closing all browsers drains other connections even when one fails to release', async (t) => {
  const other = deferred(),
    dir = directory(t)
  let count = 0,
    fail = true
  const browsers = new BrowserSessions(
    () => options('isolated'),
    dir,
    {},
    () => {
      const index = ++count
      return fake({
        close: async () => {
          if (index === 1 && fail) throw Error('release failed')
          if (index === 2) await other.promise
        }
      })
    }
  )
  await browsers.call('a', undefined, 'a', 'browser_snapshot', {}, signal())
  await browsers.call('b', undefined, 'b', 'browser_snapshot', {}, signal())
  let returned = false
  const closing = assert.rejects(browsers.closeAll(), /部分浏览器/).then(() => {
    returned = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(returned, false)
  other.resolve()
  await closing
  assert.deepEqual(browsers.active, ['a'])
  assert.equal(browsers.ownership()[0].phase, 'close-failed')
  fail = false
  await browsers.closeAll()
})

test('unresponsive MCP shutdown confirms process exit after forced termination', async (t) => {
  const dir = directory(t),
    file = join(dir, 'server.mjs')
  writeFileSync(
    file,
    `import {createInterface} from 'node:readline';
setInterval(()=>{},1000);createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{}}:{content:[{type:'text',text:String(process.pid)}]}})+'\\n')});`
  )
  const client = new McpStdioClient({
    command: process.execPath,
    args: [file],
    cwd: dir,
    env: { ...process.env } as any,
    roots: []
  })
  await client.start(signal())
  const pid = Number((await client.callTool('pid', {}, signal())).content[0].text)
  await client.close()
  assert.throws(() => process.kill(pid, 0))
  assert.equal(client.alive, false)
})
