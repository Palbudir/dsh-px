import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { zstdCompressSync } from 'node:zlib'
import { withManagedProfileMaintenance } from '../src/main/managed-plugins'
import {
  assertOffline,
  atomicJson,
  hash,
  maintenanceJournal,
  maintenancePaths,
  pendingInfo,
  preserveInterrupted,
  privateFile,
  readJson,
  type MaintenancePaths
} from '../src/maintenance/core'
import { readSessionHeader } from '../src/maintenance/session-header'
import {
  applyBackupCleanup,
  listBackups,
  planBackupCleanup,
  recoverBackupCleanup
} from '../src/maintenance/backups'
import {
  applyQaArchive,
  archiveInfo,
  listQa,
  planQaArchive,
  recoverQaArchive,
  restoreQaArchive
} from '../src/maintenance/qa'

function fixture(t: { after: (fn: () => void) => void }) {
  mkdirSync(resolve('build-test'), { recursive: true })
  const root = realpathSync(mkdtempSync(join(resolve('build-test'), 'maintenance-fixture-')))
  const userData = join(root, 'user'),
    home = join(userData, 'dsh-home'),
    repoRoot = join(root, 'repo')
  const qa = join(repoRoot, 'build-test', 'project'),
    real = join(root, 'real-project')
  for (const path of [qa, real, join(home, 'profiles/web'), join(home, 'storages/dsh-px-workspace')])
    mkdirSync(path, { recursive: true })
  writeFileSync(join(home, 'profiles/web/package.json'), '{}')
  atomicJson(join(userData, 'service-state.json'), {
    instanceId: randomUUID(),
    ownerPid: 2147483646,
    lastAgentPid: 2147483645,
    ownerStartedAt: '2026-01-01T00:00:00.000Z',
    pid: null,
    phase: 'stopped'
  })
  const writeSession = (id: string, cwd: string, version = 3) => {
    const file = join(home, 'sessions', 'fixture', id, 'session.v3.jsonl.zstd')
    mkdirSync(join(file, '..'), { recursive: true })
    const first = zstdCompressSync(
      Buffer.from(
        JSON.stringify({
          type: 'session',
          version,
          id,
          cwd,
          createdAt: 1,
          isSeeded: false,
          delegationDepth: 0
        }) + '\n'
      )
    )
    writeFileSync(file, Buffer.concat([first, Buffer.from('PRIVATE_DIALOGUE_FRAME_MUST_NOT_BE_READ')]))
    return { file, first }
  }
  const qaSession = writeSession('session-qa', qa),
    realSession = writeSession('session-real', real)
  const workspace = join(home, 'storages/workspace.json'),
    business = join(home, 'storages/dsh-px-workspace/workspace.json')
  atomicJson(workspace, {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['workspace'], archivedSessionIds: ['previously-hidden'] },
    tables: {
      workspaces: {
        workspace: {
          path: qa,
          title: 'fixture',
          sessionIds: ['session-qa', 'session-real'],
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01'
        }
      }
    }
  })
  const task = {
    id: 'task-qa',
    sessionId: 'session-qa',
    title: 'QA fixture',
    prompt: 'paused fixture requirement',
    timing: { kind: 'interval', minutes: 10 },
    enabled: false,
    nextAt: null,
    updatedAt: 100,
    timeZone: 'UTC',
    history: []
  }
  const annotation = {
    id: 'note',
    sessionId: 'session-real',
    messageId: 'message',
    seq: 1,
    role: 'user',
    sourceHash: 'a'.repeat(64),
    quote: 'ANNOTATION_BODY_STAYS_ONLY_IN_ORIGINAL_STORE',
    note: '',
    updatedAt: 1
  }
  atomicJson(business, { version: 1, annotations: [annotation], schedules: [task] })
  writeFileSync(join(home, '.credentials.yaml'), 'CREDENTIALS_MUST_NOT_BE_READ_OR_ARCHIVED')
  const paths = maintenancePaths({ userData, repoRoot })
  t.after(() => {
    assert.ok(root.startsWith(realpathSync(resolve('build-test')) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    home,
    userData,
    repoRoot,
    qa,
    real,
    qaSession,
    realSession,
    workspace,
    business,
    task,
    annotation,
    paths,
    writeSession
  }
}
function backups(f: ReturnType<typeof fixture>, count = 4) {
  const ids = Array.from({ length: count }, () => randomUUID())
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index],
      directory = join(f.home, 'backups/managed-profiles', id)
    mkdirSync(join(directory, 'profile/node_modules'), { recursive: true })
    writeFileSync(join(directory, 'profile/package.json'), '{"private":true}')
    atomicJson(join(directory, 'backup.json'), {
      id,
      identity: `v${index}`,
      createdAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      profileName: 'web',
      path: `backups/managed-profiles/${id}/profile`,
      state: 'committed'
    })
  }
  return ids
}
test('QA identification reads only the exact v3 header frame and skips ordinary project sessions', (t) => {
  const f = fixture(t)
  const header = readSessionHeader(f.qaSession.file)
  assert.equal(header.bytesRead, f.qaSession.first.length)
  assert.equal(header.id, 'session-qa')
  assert.equal(listQa(f.paths).total, 1)
  assert.equal(listQa(f.paths).sessions[0].id, 'session-qa')
  assert.throws(() => readSessionHeader(f.writeSession('future', f.qa, 4).file), /不支持/)
  for (const tail of ['\n\n', '\n \t\n']) {
    const broken = zstdCompressSync(
      Buffer.from(JSON.stringify({ type: 'session', version: 3, id: 'session-qa', cwd: f.qa }) + tail)
    )
    writeFileSync(f.qaSession.file, broken)
    assert.throws(() => readSessionHeader(f.qaSession.file), /独立会话头/)
  }
})
test('offline maintenance rejects live/recycled PIDs and legacy heartbeat records', (t) => {
  const f = fixture(t)
  assert.doesNotThrow(() => assertOffline(f.paths))
  const file = join(f.userData, 'service-state.json'),
    state = readJson(file)
  for (const patch of [{ ownerPid: process.pid }, { lastAgentPid: process.pid }]) {
    atomicJson(file, { ...state, ...patch })
    assert.throws(() => assertOffline(f.paths), /进程仍存在/)
  }
  atomicJson(file, { ...state, phase: 'running' })
  assert.throws(() => assertOffline(f.paths), /正常停机/)
  atomicJson(file, { pid: null, phase: 'stopped' })
  assert.throws(() => assertOffline(f.paths), /缺少可验证/)
})
test('backup cleanup requires explicit confirmation, preserves newest two and unlinks nested junctions without following', async (t) => {
  const f = fixture(t),
    ids = backups(f)
  const external = join(f.root, 'external-backup-target')
  mkdirSync(external)
  writeFileSync(join(external, 'keep.txt'), 'keep')
  symlinkSync(
    external,
    join(f.home, 'backups/managed-profiles', ids[0], 'profile/node_modules/external'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  assert.equal(listBackups(f.paths, 0, 1).items.length, 1)
  await assert.rejects(planBackupCleanup(f.paths, [ids[3]]), /最近两份/)
  const plan = await planBackupCleanup(f.paths, ids.slice(0, 2))
  await assert.rejects(applyBackupCleanup(f.paths, plan.id, 'wrong'), /确认值/)
  assert.equal(existsSync(join(f.home, maintenanceJournal)), false)
  await applyBackupCleanup(f.paths, plan.id, plan.confirmation)
  assert.deepEqual(new Set(listBackups(f.paths).items.map((row) => row.id)), new Set(ids.slice(2)))
  assert.equal(readFileSync(join(external, 'keep.txt'), 'utf8'), 'keep')
})
test('backup cleanup rejects escaped metadata before moving a tree', async (t) => {
  const f = fixture(t),
    ids = backups(f)
  const metadata = join(f.home, 'backups/managed-profiles', ids[0], 'backup.json')
  atomicJson(metadata, { ...readJson(metadata), path: '../../outside' })
  await assert.rejects(planBackupCleanup(f.paths, [ids[0]]), /格式或路径/)
  assert.ok(existsSync(join(f.home, 'backups/managed-profiles', ids[0], 'profile/package.json')))
})
test('a backup profile junction is rejected even when its manifest resembles a real profile', async (t) => {
  const f = fixture(t),
    ids = backups(f),
    profile = join(f.home, 'backups/managed-profiles', ids[0], 'profile')
  const external = join(f.root, 'external-profile')
  mkdirSync(external)
  writeFileSync(join(external, 'package.json'), '{"private":true}')
  renameSync(profile, profile + '.saved')
  symlinkSync(external, profile, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(planBackupCleanup(f.paths, [ids[0]]), /链接|Junction/)
  assert.equal(readFileSync(join(external, 'package.json'), 'utf8'), '{"private":true}')
})
test('ambiguous session IDs and new log data invalidate QA selection without reading conversation bodies', async (t) => {
  const f = fixture(t),
    plan = await planQaArchive(f.paths, ['session-qa'], [])
  writeFileSync(
    f.qaSession.file,
    Buffer.concat([readFileSync(f.qaSession.file), Buffer.from('NEW_PRIVATE_EVENT')])
  )
  await assert.rejects(applyQaArchive(f.paths, plan.id, plan.confirmation), /会话在计划后已变化/)
  assert.equal(pendingInfo(f.paths).pending, false)
  const directory = join(f.home, 'sessions/another/session-qa')
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'session.v3.jsonl.zstd'),
    zstdCompressSync(
      Buffer.from(JSON.stringify({ type: 'session', version: 3, id: 'session-qa', cwd: f.real }) + '\n')
    )
  )
  assert.equal(
    listQa(f.paths).sessions.some((row) => row.id === 'session-qa'),
    false
  )
  await assert.rejects(planQaArchive(f.paths, ['session-qa'], []), /不能确认/)
})
test('restoring visibility does not require recreating an archived temporary project directory', async (t) => {
  const f = fixture(t),
    plan = await planQaArchive(f.paths, ['session-qa'], ['task-qa'])
  await applyQaArchive(f.paths, plan.id, plan.confirmation)
  assert.ok(f.qa.startsWith(join(f.repoRoot, 'build-test') + sep))
  rmSync(f.qa, { recursive: true, force: true })
  await restoreQaArchive(f.paths, plan.id, archiveInfo(f.paths, plan.id).confirmation)
  assert.equal(readJson(f.workspace).global.archivedSessionIds.includes('session-qa'), false)
  assert.equal(readJson(f.business).schedules[0].enabled, false)
})
test('restore refuses a new normal-project log reusing an archived global session ID', async (t) => {
  const f = fixture(t),
    plan = await planQaArchive(f.paths, ['session-qa'], [])
  await applyQaArchive(f.paths, plan.id, plan.confirmation)
  const confirmation = archiveInfo(f.paths, plan.id).confirmation
  const duplicate = join(f.home, 'sessions/another-project/session-qa')
  mkdirSync(duplicate, { recursive: true })
  writeFileSync(
    join(duplicate, 'session.v3.jsonl.zstd'),
    zstdCompressSync(
      Buffer.from(JSON.stringify({ type: 'session', version: 3, id: 'session-qa', cwd: f.real }) + '\n')
    )
  )
  const before = hash(readFileSync(f.workspace))
  await assert.rejects(restoreQaArchive(f.paths, plan.id, confirmation), /重复日志来源/)
  assert.equal(hash(readFileSync(f.workspace)), before)
})
test('backup cleanup can resume after an interruption without deleting protected backups', async (t) => {
  const f = fixture(t),
    ids = backups(f),
    plan = await planBackupCleanup(f.paths, ids.slice(0, 2))
  await assert.rejects(
    applyBackupCleanup(f.paths, plan.id, plan.confirmation, () => {
      throw new Error('fixture interruption')
    }),
    /fixture interruption/
  )
  const pending = pendingInfo(f.paths)
  assert.equal(pending.pending, true)
  await recoverBackupCleanup(f.paths, pending.recoverConfirmation!)
  assert.equal(listBackups(f.paths).total, 2)
  assert.equal(pendingInfo(f.paths).pending, false)
})
test('maintenance shares the migration lease and refuses unresolved migration journals', async (t) => {
  const f = fixture(t)
  let release!: () => void,
    entered = false
  const first = withManagedProfileMaintenance({ home: f.home, profileName: 'web' }, async () => {
    entered = true
    await new Promise<void>((resolve) => {
      release = resolve
    })
  })
  while (!entered) await new Promise((resolve) => setTimeout(resolve, 5))
  let completed = false
  const second = planQaArchive(f.paths, ['session-qa'], []).then((plan) => {
    completed = true
    return plan
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(completed, false)
  release()
  await first
  await second
  atomicJson(join(f.home, '.dsh-px-profile-transaction.json'), { schemaVersion: 1 })
  await assert.rejects(planQaArchive(f.paths, ['session-qa'], []), /未完成的插件迁移/)
})
test('QA plans cannot select a normal project, enabled schedule, or an unknown workspace schema', async (t) => {
  const f = fixture(t)
  await assert.rejects(planQaArchive(f.paths, ['session-real'], []), /不能确认/)
  const state = readJson(f.business)
  state.schedules[0].enabled = true
  state.schedules[0].nextAt = Date.now() + 60000
  atomicJson(f.business, state)
  await assert.rejects(planQaArchive(f.paths, [], ['task-qa']), /未暂停/)
  state.schedules[0].enabled = false
  state.schedules[0].nextAt = null
  state.schedules[0].history = [{ requestId: 'uncertain-fixture', time: 1, status: 'uncertain' }]
  atomicJson(f.business, state)
  assert.equal(listQa(f.paths).schedules[0].pending, true)
  await assert.rejects(planQaArchive(f.paths, [], ['task-qa']), /未结算/)
  const workspace = readJson(f.workspace)
  workspace.unit.version = 3
  atomicJson(f.workspace, workspace)
  await assert.rejects(planQaArchive(f.paths, ['session-qa'], []), /版本或状态/)
})
test('QA archive preserves all logs, does not copy annotations or credentials, and restore merges new data paused', async (t) => {
  const f = fixture(t),
    logHash = hash(readFileSync(f.qaSession.file))
  const plan = await planQaArchive(f.paths, ['session-qa'], ['task-qa'])
  await assert.rejects(applyQaArchive(f.paths, plan.id, 'wrong'), /确认值/)
  await applyQaArchive(f.paths, plan.id, plan.confirmation)
  assert.ok(readJson(f.workspace).global.archivedSessionIds.includes('session-qa'))
  assert.equal(readJson(f.business).schedules.length, 0)
  const archiveText = readFileSync(privateFile(f.paths, 'archives', plan.id), 'utf8')
  assert.doesNotMatch(archiveText, /PRIVATE_DIALOGUE|ANNOTATION_BODY|CREDENTIALS/)
  assert.equal(hash(readFileSync(f.qaSession.file)), logHash)
  const workspace = readJson(f.workspace)
  workspace.global.archivedSessionIds.push('new-user-hidden')
  workspace.global.newField = 'keep'
  atomicJson(f.workspace, workspace)
  const business = readJson(f.business)
  business.schedules.push({
    ...f.task,
    id: 'new-user-task',
    sessionId: 'session-real',
    enabled: true,
    nextAt: Date.now() + 60000
  })
  atomicJson(f.business, business)
  await restoreQaArchive(f.paths, plan.id, archiveInfo(f.paths, plan.id).confirmation)
  assert.deepEqual(readJson(f.workspace).global.archivedSessionIds, ['previously-hidden', 'new-user-hidden'])
  assert.equal(readJson(f.workspace).global.newField, 'keep')
  const restored = readJson(f.business)
  assert.deepEqual(restored.annotations, [f.annotation])
  assert.equal(restored.schedules.find((s: any) => s.id === 'task-qa').enabled, false)
  assert.equal(restored.schedules.find((s: any) => s.id === 'task-qa').nextAt, null)
  assert.equal(restored.schedules.find((s: any) => s.id === 'new-user-task').enabled, true)
  assert.equal(hash(readFileSync(f.qaSession.file)), logHash)
})
test('stale QA plans and same-ID restore conflicts never overwrite newer user records', async (t) => {
  const f = fixture(t),
    plan = await planQaArchive(f.paths, ['session-qa'], ['task-qa'])
  const changed = readJson(f.workspace)
  changed.global.newField = true
  atomicJson(f.workspace, changed)
  await assert.rejects(applyQaArchive(f.paths, plan.id, plan.confirmation), /计划过期/)
  assert.equal(pendingInfo(f.paths).pending, false)
  const fresh = await planQaArchive(f.paths, ['session-qa'], ['task-qa'])
  await applyQaArchive(f.paths, fresh.id, fresh.confirmation)
  const state = readJson(f.business)
  state.schedules.push({ ...f.task, title: 'New same-ID user task' })
  atomicJson(f.business, state)
  const before = hash(readFileSync(f.business)),
    workspaceBefore = hash(readFileSync(f.workspace))
  await assert.rejects(
    restoreQaArchive(f.paths, fresh.id, archiveInfo(f.paths, fresh.id).confirmation),
    /同 ID/
  )
  assert.equal(hash(readFileSync(f.business)), before)
  assert.equal(hash(readFileSync(f.workspace)), workspaceBefore)
  assert.equal(pendingInfo(f.paths).pending, false)
})
test('QA archive and restore recover each interrupted atomic step from a durable delta archive', async (t) => {
  const f = fixture(t),
    plan = await planQaArchive(f.paths, ['session-qa'], ['task-qa'])
  await assert.rejects(
    applyQaArchive(f.paths, plan.id, plan.confirmation, (key) => {
      if (key === 'workspace') throw new Error('interrupt')
    }),
    /interrupt/
  )
  await assert.rejects(planQaArchive(f.paths, ['session-qa'], []), /未完成的维护事务/)
  await recoverQaArchive(f.paths, pendingInfo(f.paths).recoverConfirmation!)
  assert.equal(readJson(f.business).schedules.length, 0)
  await assert.rejects(
    restoreQaArchive(f.paths, plan.id, archiveInfo(f.paths, plan.id).confirmation, (key) => {
      if (key === 'workspace') throw new Error('interrupt restore')
    }),
    /interrupt restore/
  )
  await recoverQaArchive(f.paths, pendingInfo(f.paths).recoverConfirmation!)
  assert.equal(readJson(f.business).schedules[0].enabled, false)
  assert.equal(readJson(f.workspace).global.archivedSessionIds.includes('session-qa'), false)
})
test('conflicting interrupted QA work can preserve current data then restore missing archived rows without replacement', async (t) => {
  const f = fixture(t),
    plan = await planQaArchive(f.paths, ['session-qa'], ['task-qa'])
  await assert.rejects(
    applyQaArchive(f.paths, plan.id, plan.confirmation, (key) => {
      if (key === 'business') throw new Error('interrupted')
    }),
    /interrupted/
  )
  const state = readJson(f.business)
  state.schedules.push({ ...f.task, id: 'new-user-task' })
  atomicJson(f.business, state)
  await assert.rejects(recoverQaArchive(f.paths, pendingInfo(f.paths).recoverConfirmation!), /发生变化/)
  const before = hash(readFileSync(f.business))
  await preserveInterrupted(f.paths, pendingInfo(f.paths).keepCurrentConfirmation!)
  assert.equal(hash(readFileSync(f.business)), before)
  assert.equal(pendingInfo(f.paths).pending, false)
  await restoreQaArchive(f.paths, plan.id, archiveInfo(f.paths, plan.id).confirmation)
  assert.deepEqual(
    new Set(readJson(f.business).schedules.map((s: any) => s.id)),
    new Set(['task-qa', 'new-user-task'])
  )
})
