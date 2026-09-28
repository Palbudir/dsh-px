import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const load = (name: string): Promise<any> => import(pathToFileURL(resolve('scripts', name)).href)
const { canonical, sha256 } = await load('review-core.mjs')
const { acquireReviewLock } = await load('review-worker.mjs')
const { installReviewParser } = await load('review-parser.mjs')
const {
  verifyLoopInstallation,
  acquireLoopLock,
  runInstalledWorker,
  runReviewLoop,
  requestLoopStop,
  LOOP_INTERVAL_MS
} = await load('review-loop.mjs')
const fakeWorker = `console.log(JSON.stringify({fake:true,args:process.argv.slice(2),cwd:process.cwd(),cleanNodeOptions:!process.env.NODE_OPTIONS&&!process.env.NODE_PATH}));console.error('fake worker stderr');process.exit(Number(process.env.DSHPX_FAKE_WORKER_EXIT??0));\n`

function fixture(t: TestContext) {
  const parent = realpathSync(tmpdir()),
    root = realpathSync(mkdtempSync(join(parent, 'dshpx-loop-fixture-')))
  const directory = join(root, 'trusted installation')
  const children: ChildProcess[] = []
  mkdirSync(directory)
  for (const file of ['review-loop.mjs', 'review-core.mjs', 'review-parser.mjs'])
    copyFileSync(resolve('scripts', file), join(directory, file))
  writeFileSync(join(directory, 'review-worker.mjs'), fakeWorker)
  const parserFiles = installReviewParser(resolve('.'), directory)
  function seal(extra: Record<string, string> = {}) {
    const files = Object.fromEntries(
      ['review-loop.mjs', 'review-core.mjs', 'review-parser.mjs', 'review-worker.mjs'].map((name) => [
        name,
        sha256(readFileSync(join(directory, name)))
      ])
    )
    Object.assign(files, parserFiles, extra)
    const workerDigest = sha256(canonical(files))
    writeFileSync(join(directory, 'installation.json'), JSON.stringify({ files, workerDigest }))
    writeFileSync(
      join(directory, 'worker.json'),
      JSON.stringify({ directory, repository: 'Palbudir/dsh-px', branch: 'master', workerDigest })
    )
    writeFileSync(
      join(directory, 'public-policy.json'),
      JSON.stringify({ repository: 'Palbudir/dsh-px', branch: 'master', workerDigest })
    )
    return workerDigest
  }
  seal()
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      const closed = once(child, 'close')
      assert.equal(child.kill(), true, 'only this fixture-owned child may be terminated')
      await closed
    }
    assert.ok(root.startsWith(parent + sep))
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    directory,
    seal,
    track: (child: ChildProcess) => {
      children.push(child)
      return child
    },
    readState: () => JSON.parse(readFileSync(join(directory, 'review-loop-state.json'), 'utf8'))
  }
}

async function waitForFile(path: string) {
  const deadline = Date.now() + 10000
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw Error('fixture signal did not arrive: ' + path)
    await new Promise((done) => setTimeout(done, 10))
  }
}

test('a crashed loop and a new real lease in the initialization gap cannot falsely acknowledge a stop', async (t) => {
  const f = fixture(t),
    helper = join(f.root, 'fake-loop-owner.mjs')
  writeFileSync(
    helper,
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [directory,prefix,gap]=process.argv.slice(2);
const write=fs.writeFileSync;
let held=false,finish;
if(gap==='gap'){
 fs.writeFileSync=(path,...args)=>{
  if(!held&&String(path).includes('review-loop-state.json.')&&String(path).endsWith('.tmp')){
   held=true;write(prefix+'.gap','held');
   const deadline=Date.now()+10000, memory=new Int32Array(new SharedArrayBuffer(4));
   while(!fs.existsSync(prefix+'.release')){if(Date.now()>deadline)throw Error('gap timed out');Atomics.wait(memory,0,0,20)}
  }
  return write(path,...args);
 };
 syncBuiltinESMExports();
}
process.on('message',message=>{if(message==='finish')finish?.({exitCode:0,signal:null})});
const {runReviewLoop}=await import(pathToFileURL(join(directory,'review-loop.mjs')).href);
await runReviewLoop({directory},{invoke:()=>new Promise(resolve=>{finish=resolve;write(prefix+'.running','running')})});
write(prefix+'.stopped','stopped');process.disconnect();
`
  )
  const start = (prefix: string, gap = '') =>
    f.track(
      spawn(process.execPath, [helper, f.directory, prefix, gap], {
        cwd: f.directory,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }
      })
    )
  const firstPrefix = join(f.root, 'old'),
    first = start(firstPrefix)
  await waitForFile(firstPrefix + '.running')
  const previous = f.readState()
  assert.equal(previous.phase, 'running')
  const crashed = once(first, 'close')
  assert.equal(first.kill(), true)
  await crashed
  assert.equal(f.readState().instanceId, previous.instanceId)
  const secondPrefix = join(f.root, 'new'),
    second = start(secondPrefix, 'gap')
  await waitForFile(secondPrefix + '.gap')
  assert.equal(acquireLoopLock(f.directory), null, 'the new process really holds the OS-backed lease')
  const stale = f.readState()
  stale.pid = second.pid // Simulated PID reuse must not become authority for an old instance.
  writeFileSync(join(f.directory, 'review-loop-state.json'), JSON.stringify(stale))
  await assert.rejects(
    async () => await requestLoopStop(f.directory, { timeoutMs: 120, pollMs: 10 }),
    /not acknowledged|not confirmed/
  )
  writeFileSync(secondPrefix + '.release', 'continue')
  await waitForFile(secondPrefix + '.running')
  assert.notEqual(f.readState().instanceId, previous.instanceId)
  const stopped = once(second, 'close')
  const stopCli = spawnSync(process.execPath, [join(f.directory, 'review-loop.mjs'), '--stop'], {
    cwd: f.directory,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }
  })
  assert.equal(stopCli.status, 0, `Stop CLI failed: ${stopCli.stderr}\n${stopCli.stdout}`)
  const receipt = JSON.parse(stopCli.stdout)
  assert.equal(receipt.requested, true)
  assert.equal(receipt.instanceId, f.readState().instanceId)
  assert.ok(receipt.requestId)
  assert.equal(second.exitCode, null, 'acknowledgement does not kill the active worker')
  assert.equal(acquireLoopLock(f.directory), null)
  second.send('finish')
  await stopped
  assert.equal(f.readState().phase, 'stopped')
  assert.equal(f.readState().runs, 1)
  acquireLoopLock(f.directory)()
})

test('concurrent stop callers succeed only for their matching owner receipt', async (t) => {
  const f = fixture(t),
    controller = new AbortController()
  let finish!: (value: unknown) => void
  const running = runReviewLoop(
    { directory: f.directory, signal: controller.signal },
    {
      invoke: () =>
        new Promise((resolve) => {
          finish = resolve
        })
    }
  )
  void running.catch(() => {})
  const requests: Promise<any>[] = []
  try {
    const first = requestLoopStop(f.directory, { timeoutMs: 2000, pollMs: 10 })
    requests.push(first)
    void first.catch(() => {})
    const firstId = JSON.parse(readFileSync(join(f.directory, 'review-loop-stop.json'), 'utf8')).requestId
    const second = requestLoopStop(f.directory, { timeoutMs: 2000, pollMs: 10 })
    requests.push(second)
    void second.catch(() => {})
    const secondId = JSON.parse(readFileSync(join(f.directory, 'review-loop-stop.json'), 'utf8')).requestId
    assert.notEqual(firstId, secondId)
    const results = await Promise.allSettled(requests)
    assert.ok(results.some((result) => result.status === 'fulfilled'))
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        assert.equal(result.value.requestId, [firstId, secondId][index])
        assert.equal(result.value.instanceId, f.readState().instanceId)
      } else assert.match(String(result.reason), /not confirmed|not acknowledged/)
    }
    assert.equal(
      acquireLoopLock(f.directory),
      null,
      'acknowledgement keeps the worker lease alive until completion'
    )
    finish({ exitCode: 0, signal: null })
    await running
  } finally {
    controller.abort()
    finish?.({ exitCode: 0, signal: null })
    await running.catch(() => {})
    await Promise.allSettled(requests)
  }
})

test('stale receipts and expired stop requests cannot stand in for owner acceptance', async (t) => {
  const f = fixture(t),
    controller = new AbortController()
  let finish!: (value: unknown) => void
  const running = runReviewLoop(
    { directory: f.directory, signal: controller.signal },
    {
      invoke: () =>
        new Promise((resolve) => {
          finish = resolve
        })
    }
  )
  void running.catch(() => {})
  const instanceId = f.readState().instanceId
  const expired = {
    instanceId,
    requestId: '11111111-1111-4111-8111-111111111111',
    requestedAt: new Date(Date.now() - 5000).toISOString(),
    expiresAt: new Date(Date.now() - 1000).toISOString()
  }
  try {
    writeFileSync(join(f.directory, 'review-loop-stop.json'), JSON.stringify(expired))
    await new Promise((done) => setTimeout(done, 120))
    assert.equal(f.readState().stopReceipt, undefined)
    assert.equal(existsSync(join(f.directory, 'review-loop-stop-ack.json')), false)
  } finally {
    controller.abort()
    finish?.({ exitCode: 0, signal: null })
    await running.catch(() => {})
  }
  const unlock = acquireLoopLock(f.directory)
  writeFileSync(
    join(f.directory, 'review-loop-state.json'),
    JSON.stringify({ instanceId, phase: 'running', pid: process.pid })
  )
  writeFileSync(
    join(f.directory, 'review-loop-stop-ack.json'),
    JSON.stringify({ instanceId, requestId: expired.requestId, acceptedAt: new Date().toISOString() })
  )
  try {
    await assert.rejects(requestLoopStop(f.directory, { timeoutMs: 100, pollMs: 10 }), /not acknowledged/)
  } finally {
    unlock()
  }
})
class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
}

test('loop rejects repository execution, altered scripts, escaped manifests and a mismatched installation identity', (t) => {
  const f = fixture(t)
  assert.equal(verifyLoopInstallation(f.directory).directory, f.directory)
  assert.throws(() => verifyLoopInstallation(resolve('scripts')), /outside a Git checkout/)
  writeFileSync(join(f.directory, 'review-worker.mjs'), fakeWorker + '// changed')
  assert.throws(() => verifyLoopInstallation(f.directory), /Trusted scripts changed/)
  f.seal({ '../untrusted.mjs': 'a'.repeat(64) })
  assert.throws(() => verifyLoopInstallation(f.directory), /Invalid trusted script manifest/)
  f.seal()
  const config = JSON.parse(readFileSync(join(f.directory, 'worker.json'), 'utf8'))
  config.directory = f.root
  writeFileSync(join(f.directory, 'worker.json'), JSON.stringify(config))
  assert.throws(() => verifyLoopInstallation(f.directory), /path mismatch/)
})

test('trusted scripts and output files cannot be shared hardlinks', async (t) => {
  const f = fixture(t),
    worker = join(f.directory, 'review-worker.mjs')
  linkSync(worker, join(f.root, 'linked-worker.mjs'))
  assert.throws(() => verifyLoopInstallation(f.directory), /private regular file/)
  rmSync(join(f.root, 'linked-worker.mjs'))
  const unrelated = join(f.root, 'unrelated.txt')
  writeFileSync(unrelated, 'keep')
  linkSync(unrelated, join(f.directory, 'worker-latest.log'))
  let spawned = false
  assert.throws(
    () =>
      runInstalledWorker(verifyLoopInstallation(f.directory), {
        spawnChild: () => {
          spawned = true
        }
      }),
    /private regular file/
  )
  assert.equal(spawned, false)
  assert.equal(readFileSync(unrelated, 'utf8'), 'keep')
})

test('one loop holds its own SQLite lease without occupying the worker lease', (t) => {
  const f = fixture(t),
    unlock = acquireLoopLock(f.directory)
  assert.equal(acquireLoopLock(f.directory), null)
  const workerUnlock = acquireReviewLock(f.directory)
  assert.equal(typeof workerUnlock, 'function')
  workerUnlock()
  unlock()
  unlock()
  acquireLoopLock(f.directory)()
  writeFileSync(join(f.directory, 'review-loop-lock.sqlite'), 'not a sqlite database')
  assert.throws(() => acquireLoopLock(f.directory))
})

test('native fake child uses fixed trusted args and cwd; latest log is overwritten and exit code preserved', async (t) => {
  const f = fixture(t),
    installation = verifyLoopInstallation(f.directory),
    log = join(f.directory, 'worker-latest.log')
  writeFileSync(log, 'old log content')
  const result = await runInstalledWorker(installation)
  assert.equal(result.exitCode, 0)
  const content = readFileSync(log, 'utf8')
  assert.doesNotMatch(content, /old log content/)
  assert.match(content, /fake worker stderr/)
  const row = content
    .split(/\r?\n/)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .find((value) => value?.fake)
  assert.deepEqual(row.args, ['--publish'])
  assert.equal(row.cwd, f.directory)
  assert.equal(row.cleanNodeOptions, true)
  const child = new FakeChild()
  const failed = runInstalledWorker(installation, {
    spawnChild: (exe: string, args: string[], options: any) => {
      assert.equal(exe, process.execPath)
      assert.deepEqual(args, [installation.worker, '--publish'])
      assert.equal(options.shell, false)
      assert.equal(options.windowsHide, true)
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('worker failed'))
        child.emit('close', 37, null)
      })
      return child
    }
  })
  assert.equal((await failed).exitCode, 37)
  assert.match(readFileSync(log, 'utf8'), /"exitCode":37/)
})

test('an error event does not release an active child; only close settles and output is bounded', async (t) => {
  const f = fixture(t),
    child = new FakeChild()
  let settled = false
  const pending = runInstalledWorker(verifyLoopInstallation(f.directory), {
    maxLogBytes: 1024,
    spawnChild: () => child
  }).then((result: any) => {
    settled = true
    return result
  })
  child.stdout.emit('data', Buffer.alloc(20000, 65))
  child.emit('error', Error('fixture launch or child failure'))
  await Promise.resolve()
  assert.equal(settled, false)
  child.emit('close', null, 'SIGTERM')
  assert.equal((await pending).exitCode, 1)
  const log = readFileSync(join(f.directory, 'worker-latest.log'), 'utf8')
  assert.ok(Buffer.byteLength(log) < 1600)
  assert.match(log, /Further output omitted/)
})

test('CLI defaults to stopped; an installed fake --publish --once runs exactly once with the native code', (t) => {
  const f = fixture(t)
  const invoke = (args: string[], exit = '0') =>
    spawnSync(process.execPath, [join(f.directory, 'review-loop.mjs'), ...args], {
      cwd: f.directory,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', DSHPX_FAKE_WORKER_EXIT: exit }
    })
  const idle = invoke([])
  assert.equal(idle.status, 0)
  assert.match(idle.stdout, /Not started/)
  assert.equal(existsSync(join(f.directory, 'worker-latest.log')), false)
  assert.equal(invoke(['--once']).status, 1)
  const once = invoke(['--publish', '--once'], '37')
  assert.equal(once.status, 37)
  assert.equal(JSON.parse(once.stdout).runs, 1)
  assert.equal(f.readState().lastWorker.exitCode, 37)
  assert.equal(f.readState().phase, 'stopped')
})

test('duplicate loop start does no work and sequential polling retries after a real worker failure', async (t) => {
  const f = fixture(t),
    controller = new AbortController()
  let calls = 0,
    active = 0,
    peak = 0,
    waits = 0
  const result = await runReviewLoop(
    { directory: f.directory, signal: controller.signal },
    {
      invoke: async () => {
        active++
        peak = Math.max(peak, active)
        calls++
        assert.ok(calls <= 2, 'the loop must stop after the requested two rounds')
        const duplicate = await runReviewLoop(
          { directory: f.directory, once: true },
          {
            invoke: () => {
              assert.fail('duplicate invoked worker')
            }
          }
        )
        assert.equal(duplicate.busy, true)
        await Promise.resolve()
        active--
        if (calls === 2) controller.abort()
        return { exitCode: calls === 1 ? 37 : 0, signal: null }
      },
      wait: async (ms: number) => {
        assert.equal(ms, LOOP_INTERVAL_MS)
        assert.equal(active, 0)
        waits++
      }
    }
  )
  assert.equal(calls, 2)
  assert.equal(peak, 1)
  assert.equal(waits, 1)
  assert.equal(result.runs, 2)
  assert.equal(f.readState().lastWorker.exitCode, 0)
  acquireLoopLock(f.directory)()
})

test('stop waits for the owned worker, prevents the next run and does not poison a future instance', async (t) => {
  const f = fixture(t),
    controller = new AbortController()
  let finish!: (value: unknown) => void,
    settled = false,
    calls = 0
  const pending = runReviewLoop(
    { directory: f.directory, signal: controller.signal },
    {
      invoke: () => {
        calls++
        return new Promise((resolve) => {
          finish = resolve
        })
      }
    }
  ).then((value: unknown) => {
    settled = true
    return value
  })
  void pending.catch(() => {})
  try {
    const stop = await requestLoopStop(f.directory)
    assert.equal(stop.requested, true)
    assert.equal(acquireLoopLock(f.directory), null)
    await Promise.resolve()
    assert.equal(settled, false)
    finish({ exitCode: 0, signal: null })
    await pending
  } finally {
    controller.abort()
    finish?.({ exitCode: 0, signal: null })
    await pending.catch(() => {})
  }
  assert.equal(calls, 1)
  assert.equal(f.readState().phase, 'stopped')
  assert.equal((await requestLoopStop(f.directory)).requested, false)
  await runReviewLoop(
    { directory: f.directory, once: true },
    {
      invoke: async () => {
        calls++
        return { exitCode: 0, signal: null }
      }
    }
  )
  assert.equal(calls, 2, 'a stop token applies only to the instance it names')
})

test('stop during the wait exits without another worker and a changed installation is never launched', async (t) => {
  const f = fixture(t),
    controller = new AbortController()
  let calls = 0
  const pending = runReviewLoop(
    { directory: f.directory, intervalMs: 30000, signal: controller.signal },
    {
      invoke: async () => {
        calls++
        return { exitCode: 0, signal: null }
      }
    }
  )
  void pending.catch(() => {})
  try {
    await Promise.resolve()
    await requestLoopStop(f.directory)
    await pending
  } finally {
    controller.abort()
    await pending.catch(() => {})
  }
  assert.equal(calls, 1)
  await assert.rejects(
    runReviewLoop(
      { directory: f.directory },
      {
        invoke: async () => {
          calls++
          assert.equal(calls, 2, 'changed code must not launch another worker')
          return { exitCode: 0, signal: null }
        },
        wait: async () => {
          writeFileSync(join(f.directory, 'review-worker.mjs'), fakeWorker + '// new reviewed installation')
          f.seal()
        }
      }
    ),
    /identity changed/
  )
  assert.equal(calls, 2)
  assert.match(f.readState().error, /identity changed/)
  acquireLoopLock(f.directory)()
})

for (const setting of ['codexOverrides', 'codex', 'authHome', 'policy'])
  test(`a ${setting}-only change stops after waiting without changing the code digest`, async (t) => {
    const f = fixture(t),
      before = verifyLoopInstallation(f.directory)
    let calls = 0
    const file = join(f.directory, setting === 'policy' ? 'public-policy.json' : 'worker.json')
    await assert.rejects(
      runReviewLoop(
        { directory: f.directory },
        {
          invoke: async () => {
            calls++
            assert.equal(calls, 1, 'changed configuration must not launch another worker')
            return { exitCode: 0, signal: null }
          },
          wait: async () => {
            const value = JSON.parse(readFileSync(file, 'utf8'))
            if (setting === 'policy') value.maxAgeHours = 24
            else
              value[setting] =
                setting === 'codexOverrides' ? ['model="different-fixture"'] : 'changed-fixture-path'
            writeFileSync(file, JSON.stringify(value))
          }
        }
      ),
      /identity changed.*verify configuration and policy/
    )
    assert.equal(calls, 1, 'changed settings must never enter a second worker')
    const after = verifyLoopInstallation(f.directory)
    assert.equal(after.digest, before.digest, 'workerDigest remains the unchanged code manifest digest')
    assert.notEqual(after.identity, before.identity)
    assert.equal(f.readState().installationIdentity, before.identity)
    assert.equal(f.readState().phase, 'stopped')
    assert.doesNotMatch(JSON.stringify(f.readState()), /different-fixture|changed-fixture-path/)
    await runReviewLoop(
      { directory: f.directory, once: true },
      {
        invoke: async () => {
          calls++
          return { exitCode: 0, signal: null }
        }
      }
    )
    assert.equal(calls, 2, 'only a separate explicit start can bind the new validated identity')
    assert.equal(f.readState().installationIdentity, after.identity)
  })

test('configuration changes during a worker are detected before starting the next wait', async (t) => {
  const f = fixture(t)
  let calls = 0
  await assert.rejects(
    runReviewLoop(
      { directory: f.directory },
      {
        invoke: async () => {
          calls++
          const file = join(f.directory, 'worker.json'),
            value = JSON.parse(readFileSync(file, 'utf8'))
          value.codexOverrides = ['model="changed-during-worker"']
          writeFileSync(file, JSON.stringify(value))
          return { exitCode: 0, signal: null }
        },
        wait: async () => assert.fail('changed installation must not enter another wait')
      }
    ),
    /identity changed/
  )
  assert.equal(calls, 1)
  assert.equal(
    f.readState().lastWorker.exitCode,
    0,
    'preserve the real completed worker result without inventing a check'
  )
  assert.equal(f.readState().phase, 'stopped')
  acquireLoopLock(f.directory)()
})
