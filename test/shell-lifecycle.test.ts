import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  rmdirSync,
  renameSync
} from 'node:fs'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServiceState } from '../src/main/service-state'
import { freshHeartbeat, requestShellAction, writeShellJson } from '../packages/shared/shell-protocol'
import { serveShellActions } from '../src/main/shell-actions'
import { classifyNavigation, openExternalSafely } from '../src/main/navigation'
import { createRotatingLog } from '../src/main/rotating-log'
import { activityMessage, isIdle, waitUntilIdle } from '../src/main/lifecycle'
import { prepareAfterServiceStops, stopUnreadyChild, waitForGracefulStop } from '../src/main/graceful-stop'

test('failed startup cancellation does not treat a live child as stopped', async () => {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null,
    kill: (): boolean => false
  })
  await assert.rejects(stopUnreadyChild(child, 15), /尚未确认/)
  assert.equal(child.exitCode, null)
  assert.equal(child.listenerCount('exit'), 0)
  child.kill = () => {
    setTimeout(() => {
      child.exitCode = 0
      child.emit('exit')
    }, 5)
    return true
  }
  await stopUnreadyChild(child, 100)
  assert.equal(child.exitCode, 0)
  assert.equal(child.listenerCount('exit'), 0)
})

test('recovery must stop the old service before any profile preparation', async () => {
  const child = { exitCode: null as number | null, signalCode: null }
  const events: string[] = []
  const prepare = async () => {
    events.push('prepare')
    return 'ready'
  }
  await assert.rejects(
    prepareAfterServiceStops(
      child,
      async () => {
        throw new Error('old service refused stop')
      },
      prepare
    ),
    /refused/
  )
  await assert.rejects(
    prepareAfterServiceStops(child, async () => {}, prepare),
    /尚未退出/
  )
  assert.equal(events.length, 0)
  assert.equal(
    await prepareAfterServiceStops(
      child,
      async () => {
        events.push('stop')
        child.exitCode = 0
      },
      prepare
    ),
    'ready'
  )
  assert.deepEqual(events, ['stop', 'prepare'])
})
import { assertNoPendingMaintenance, prepareHarnessHome } from '../src/main/prepare-home'

test('a new desktop preserves live prior Agent ownership instead of clearing it', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpx-orphan-record-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'service-state.json')
  const previous = JSON.stringify({
    phase: 'starting',
    pid: process.pid,
    lastAgentPid: process.pid,
    ownerPid: 999999999,
    instanceId: randomUUID()
  })
  writeFileSync(file, previous)
  assert.throws(() => createServiceState(dir), /上次记录的进程编号仍被使用/)
  assert.equal(readFileSync(file, 'utf8'), previous)
  writeFileSync(file, JSON.stringify({ ...JSON.parse(previous), phase: 'stopped', pid: null }))
  const resumed = createServiceState(dir)
  resumed.dispose()
})

test('child identity is persisted before readiness and survives failed connection', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpx-early-child-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const state = createServiceState(dir)
  state.recordChild(process.pid)
  assert.equal(JSON.parse(readFileSync(join(dir, 'service-state.json'), 'utf8')).phase, 'starting')
  state.set('error', 'connection failed')
  assert.equal(JSON.parse(readFileSync(join(dir, 'service-state.json'), 'utf8')).lastAgentPid, process.pid)
  state.dispose()
})

test('an interrupted offline maintenance transaction blocks native startup before mutation', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dshpx-maintenance-start-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  assertNoPendingMaintenance(home)
  writeFileSync(join(home, '.dsh-px-maintenance-transaction.json'), '{}')
  assert.throws(() => assertNoPendingMaintenance(home), /recover/)
})

test('offline maintenance can identify the desktop and last child after shutdown', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpx-offline-state-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const heartbeat = createServiceState(dir)
  heartbeat.set('running', 'test', 12345)
  heartbeat.set('draining', 'waiting')
  heartbeat.dispose()
  const state = JSON.parse(readFileSync(join(dir, 'service-state.json'), 'utf8'))
  assert.equal(state.ownerPid, process.pid)
  assert.equal(state.lastAgentPid, 12345)
  assert.equal(state.pid, null)
  assert.equal(state.phase, 'stopped')
  assert.ok(Number.isFinite(Date.parse(state.ownerStartedAt)))
  assert.equal(freshHeartbeat(dir), null)
})

test('desktop commands require a fresh instance heartbeat and a real process receipt', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpx-actions-'))
  const instanceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const heartbeat = createServiceState(dir, { instanceId })
  t.after(() => {
    heartbeat.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  heartbeat.set('running', 'test', 12)
  assert.equal(freshHeartbeat(dir)?.instanceId, instanceId)
  await assert.rejects(requestShellAction(dir, 'check', { timeoutMs: 30, pollMs: 5 }), /未确认接收/)
  assert.equal(readdirSync(join(dir, 'update-bridge/requests')).filter((n) => n.endsWith('.json')).length, 0)
  const actions: string[] = []
  const stop = serveShellActions({
    dir,
    instanceId,
    onAction: (request) => {
      actions.push(request.action)
      return { message: 'started' }
    }
  })
  t.after(stop)
  const receipt = await requestShellAction(dir, 'check')
  assert.equal(receipt.instanceId, instanceId)
  assert.equal(actions[0], 'check')
  const state = JSON.parse(readFileSync(join(dir, 'service-state.json'), 'utf8'))
  writeFileSync(
    join(dir, 'service-state.json'),
    JSON.stringify({ ...state, updatedAt: '2000-01-01T00:00:00Z' })
  )
  assert.equal(freshHeartbeat(dir), null)
  await assert.rejects(requestShellAction(dir, 'install'), /未连接/)
})

test('a new desktop instance rejects requests addressed to a previous process', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpx-old-action-'))
  const heartbeat = createServiceState(dir, { instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' })
  heartbeat.set('running', 'old')
  t.after(() => {
    heartbeat.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const stop = serveShellActions({
    dir,
    instanceId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    onAction: () => {
      assert.fail('old process command must not run')
    }
  })
  t.after(stop)
  await assert.rejects(requestShellAction(dir, 'restart'), /实例已变化/)
})

test('graceful wait accounts for background jobs, queue entries and unknown state; cancellation remains possible', async () => {
  assert.equal(
    isIdle({ known: true, runningAgents: 0, runningJobs: 0, queuedInputs: 0, openTerminals: 0 }),
    true
  )
  assert.equal(
    isIdle({ known: true, runningAgents: 0, runningJobs: 1, queuedInputs: 0, openTerminals: 0 }),
    false
  )
  assert.equal(
    isIdle({ known: true, runningAgents: 0, runningJobs: 0, queuedInputs: NaN, openTerminals: 0 }),
    false
  )
  assert.equal(
    isIdle({ known: false, runningAgents: 0, runningJobs: 0, queuedInputs: 0, openTerminals: 0 }),
    false
  )
  assert.equal(
    isIdle({ known: true, runningAgents: 0, runningJobs: 0, queuedInputs: 0, openTerminals: 1 }),
    false
  )
  assert.match(
    activityMessage({ known: true, runningAgents: 0, runningJobs: 0, queuedInputs: 0, openTerminals: 1 }),
    /请先关闭终端/
  )
  assert.equal(isIdle({ known: true, runningAgents: 0, runningJobs: 0, queuedInputs: 0 } as any), false)
  const controller = new AbortController(),
    messages: string[] = []
  const pending = waitUntilIdle({
    signal: controller.signal,
    interval: 1,
    activity: async () => ({
      known: true,
      runningAgents: 1,
      runningJobs: 0,
      queuedInputs: 0,
      openTerminals: 0
    }),
    update: (m) => {
      messages.push(m)
      controller.abort(new Error('cancel wait'))
    }
  })
  await assert.rejects(pending, /cancel wait/)
  assert.equal(messages.length, 1)
  let n = 0
  await waitUntilIdle({
    signal: new AbortController().signal,
    interval: 1,
    activity: async () => ({
      known: ++n > 1,
      runningAgents: 0,
      runningJobs: 0,
      queuedInputs: 0,
      openTerminals: 0
    }),
    update: () => {}
  })
  assert.equal(n, 2)
})

test('navigation parses exact origins and rejects unsupported schemes and credentials', () => {
  const origin = 'http://127.0.0.1:3099/'
  assert.equal(classifyNavigation(origin + '?token=local', origin), 'internal')
  assert.equal(classifyNavigation('http://127.0.0.1.example.com/', origin), 'external')
  assert.equal(classifyNavigation('http://localhost.example.com/', 'http://localhost:3099'), 'external')
  assert.equal(classifyNavigation('http://127.0.0.1:3080/', origin), 'external')
  for (const url of [
    'javascript:alert(1)',
    'file:///C:/test.exe',
    'custom:run',
    'https://user:secret@example.com',
    'not url'
  ])
    assert.equal(classifyNavigation(url, origin), 'blocked')
})

test('failed OS URL handoff is reported without an unhandled rejection or service failure', async () => {
  let message = ''
  assert.equal(
    await openExternalSafely(
      'https://example.com',
      async () => {
        throw new Error('launcher unavailable')
      },
      (text) => {
        message = text
      }
    ),
    false
  )
  assert.equal(message, 'launcher unavailable')
  assert.equal(
    await openExternalSafely(
      'https://example.com',
      async () => {},
      () => {}
    ),
    true
  )
  assert.equal(
    await openExternalSafely(
      'file:///C:/test.exe',
      async () => {
        assert.fail('unsupported URL must not launch')
      },
      () => {}
    ),
    false
  )
})

test('desktop log rotation preserves bounded previous logs and leaves session files untouched', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpx-log-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'session.jsonl'), 'keep')
  const file = join(dir, 'desktop.log'),
    log = createRotatingLog(file, 64, 2)
  for (let i = 0; i < 5; i++) log.write(String(i).repeat(60))
  assert.equal(readFileSync(file, 'utf8'), '4'.repeat(60))
  assert.equal(readFileSync(file + '.1', 'utf8'), '3'.repeat(60))
  assert.equal(readFileSync(file + '.2', 'utf8'), '2'.repeat(60))
  assert.equal(readFileSync(join(dir, 'session.jsonl'), 'utf8'), 'keep')
})

test('receipt storage failures neither strand an action lock nor cause unhandled rejection', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpx-receipt-io-'))
  const instanceId = randomUUID(),
    requestId = randomUUID(),
    receipts = join(dir, 'update-bridge/receipts')
  const heartbeat = createServiceState(dir, { instanceId })
  heartbeat.set('running', 'test')
  const calls: string[] = []
  let finish!: () => void
  const stop = serveShellActions({
    dir,
    instanceId,
    onAction: async (request) => {
      calls.push(request.action)
      if (request.action === 'open-log')
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      return { message: 'completed' }
    }
  })
  t.after(() => {
    stop()
    heartbeat.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const blocked = join(receipts, requestId + '.json'),
    request = join(dir, 'update-bridge/requests', requestId + '.json')
  mkdirSync(blocked)
  writeShellJson(request, {
    id: requestId,
    instanceId,
    action: 'restart',
    createdAt: new Date().toISOString()
  })
  for (let i = 0; i < 100 && existsSync(request); i++) await new Promise((resolve) => setTimeout(resolve, 5))
  rmdirSync(blocked)
  await requestShellAction(dir, 'restart')
  assert.deepEqual(calls, ['restart'])
  await requestShellAction(dir, 'open-log')
  renameSync(receipts, receipts + '.saved')
  finish()
  await new Promise((resolve) => setTimeout(resolve, 30))
  renameSync(receipts + '.saved', receipts)
  await requestShellAction(dir, 'check')
  assert.deepEqual(calls, ['restart', 'open-log', 'check'])
})

class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: string | null = null
}
test('graceful stop survives a closed HTTP socket only with the matching durable acknowledgement', async () => {
  const child = new FakeChild()
  await waitForGracefulStop({
    child,
    acknowledgement: () => ({ acceptedAt: new Date().toISOString() }),
    trigger: async () => {
      setTimeout(() => {
        child.exitCode = 0
        child.emit('exit')
      }, 10)
      throw new Error('socket closed')
    },
    timeoutMs: 100
  })
  assert.equal(child.listenerCount('exit'), 0)
  const alive = new FakeChild()
  await assert.rejects(
    waitForGracefulStop({
      child: alive,
      acknowledgement: () => null,
      trigger: async () => {
        throw new Error('HTTP 503')
      }
    }),
    /503/
  )
  assert.equal(alive.listenerCount('exit'), 0)
})
test('late activity returns to idle waiting, and disposal failure/timeout never pretends that the process exited', async () => {
  for (const code of ['NEW_ACTIVITY', 'DISPOSE_FAILED']) {
    const child = new FakeChild()
    await assert.rejects(
      waitForGracefulStop({
        child,
        acknowledgement: () => ({ acceptedAt: new Date().toISOString(), error: code, errorCode: code }),
        trigger: async () => {},
        timeoutMs: 100,
        pollMs: 1
      }),
      (error: any) => error.status === (code === 'NEW_ACTIVITY' ? 409 : 503)
    )
    assert.equal(child.exitCode, null)
    assert.equal(child.listenerCount('exit'), 0)
  }
  const child = new FakeChild()
  await assert.rejects(
    waitForGracefulStop({
      child,
      acknowledgement: () => ({ acceptedAt: new Date().toISOString() }),
      trigger: async () => {},
      timeoutMs: 5,
      pollMs: 1
    }),
    /未能.*正常停止/
  )
  assert.equal(child.exitCode, null)
  assert.equal(child.listenerCount('exit'), 0)
})

test('a crash or external kill during graceful shutdown is not a clean completion', async () => {
  for (const result of [
    { exitCode: 1, signalCode: null },
    { exitCode: null, signalCode: 'SIGKILL' }
  ]) {
    const child = new FakeChild()
    await assert.rejects(
      waitForGracefulStop({
        child,
        acknowledgement: () => ({ acceptedAt: new Date().toISOString() }),
        trigger: async () => {
          Object.assign(child, result)
          child.emit('exit')
        },
        timeoutMs: 100
      }),
      /异常退出/
    )
    assert.equal(child.listenerCount('exit'), 0)
  }
})

test('home preparation awaits journal recovery before inspecting or writing the profile', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dshpx-prepare-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  let release!: () => void,
    copied = false,
    migrated = false
  const pending = prepareHarnessHome(
    {
      home,
      seedHome: join(home, 'seed'),
      profileName: 'web',
      dshDir: join(home, 'dsh'),
      identity: 'next',
      onProgress: () => {},
      migrate: async () => {
        migrated = true
      }
    },
    {
      recover: async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return 'restored'
      },
      materialize: async () => {
        copied = true
        return { linked: 0, copied: 0, skipped: 0, total: 0, ms: 0 }
      }
    }
  )
  await Promise.resolve()
  assert.equal(copied, false)
  assert.equal(migrated, false)
  release()
  await pending
  assert.equal(copied, true)
  assert.equal(migrated, true)
})

test('a package.json written by interrupted first run does not skip resuming third-party files', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dshpx-resume-seed-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const profile = join(home, 'profiles/web')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), '{}')
  writeFileSync(join(home, '.dsh-px-seed-claimed'), 'owned unfinished seed')
  let copies = 0
  const options = {
    home,
    seedHome: join(home, 'seed'),
    profileName: 'web',
    dshDir: join(home, 'dsh'),
    identity: 'next',
    onProgress: () => {},
    migrate: async () => {
      assert.equal(existsSync(join(profile, 'third-party.js')), true)
    }
  }
  const dependencies = {
    recover: async () => 'none' as const,
    materialize: async () => {
      copies++
      writeFileSync(join(profile, 'third-party.js'), 'completed')
      return { linked: 0, copied: 1, skipped: 0, total: 1, ms: 0 }
    }
  }
  await prepareHarnessHome(options, dependencies)
  await prepareHarnessHome(options, dependencies)
  assert.equal(copies, 1)
})

test('an existing unclaimed profile is never relabelled as an interrupted app seed', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dshpx-unclaimed-profile-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const profile = join(home, 'profiles/web')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), '{}')
  writeFileSync(join(profile, 'custom-v2.js'), 'user-owned')
  let copied = false,
    migrated = false
  await prepareHarnessHome(
    {
      home,
      seedHome: join(home, 'seed'),
      profileName: 'web',
      dshDir: join(home, 'dsh'),
      identity: 'next',
      onProgress: () => {},
      migrate: async (initialSeed) => {
        assert.equal(initialSeed, false)
        migrated = true
      }
    },
    {
      recover: async () => 'none',
      materialize: async () => {
        assert.equal(existsSync(join(home, '.dsh-px-seed-claimed')), false)
        copied = true
        writeFileSync(join(profile, 'obsolete-v1.js'), 'seed-old-extra')
        return { linked: 0, copied: 0, skipped: 0, total: 0, ms: 0 }
      }
    }
  )
  assert.equal(copied, false)
  assert.equal(migrated, true)
  assert.equal(existsSync(join(profile, 'obsolete-v1.js')), false)
  assert.equal(readFileSync(join(profile, 'custom-v2.js'), 'utf8'), 'user-owned')
  assert.equal(existsSync(join(home, '.dsh-px-seed-claimed')), false)
})

test('a missing manifest in an existing profile never grants ownership of user files to the seed', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dshpx-missing-manifest-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const profile = join(home, 'profiles/web')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'custom-plugin.js'), 'user-owned')
  const options = {
    home,
    seedHome: join(home, 'seed'),
    profileName: 'web',
    dshDir: join(home, 'dsh'),
    identity: 'next',
    onProgress: () => {},
    migrate: async () => {
      assert.fail('existing damaged profile must not migrate')
    }
  }
  const dependencies = {
    recover: async () => 'none' as const,
    materialize: async () => {
      assert.fail('must not overwrite user files')
    }
  }
  await assert.rejects(prepareHarnessHome(options, dependencies), /既有工作配置缺少/)
  assert.equal(existsSync(join(home, '.dsh-px-seed-claimed')), false)
  assert.equal(readFileSync(join(profile, 'custom-plugin.js'), 'utf8'), 'user-owned')
  rmSync(join(profile, 'custom-plugin.js'))
  writeFileSync(join(home, '.dsh-px-materialized'), 'previous complete install')
  await assert.rejects(prepareHarnessHome(options, dependencies), /既有工作配置缺少/)
  assert.equal(existsSync(join(home, '.dsh-px-seed-claimed')), false)
})
