import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { importLegacyData, planLegacyImport } from '../src/main/import-legacy'

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'px-import-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'old'),
    target = join(root, 'new')
  mkdirSync(join(source, 'sessions', 'project', 'old-session'), { recursive: true })
  mkdirSync(join(target, 'sessions', 'project', 'current-session'), { recursive: true })
  writeFileSync(join(source, 'sessions', 'project', 'old-session', 'session.v3.jsonl.zstd'), 'old log bytes')
  writeFileSync(
    join(target, 'sessions', 'project', 'current-session', 'session.v4.jsonl.zstd'),
    'current log bytes'
  )
  writeFileSync(join(target, '.credentials.yaml'), 'current credentials')
  return { source, target }
}
test('offline import adds old logs and attachments while retaining current sessions and credentials', (t) => {
  const f = fixture(t)
  mkdirSync(join(f.source, 'attachments'))
  writeFileSync(join(f.source, 'attachments', 'image'), 'image bytes')
  const before = readFileSync(join(f.target, '.credentials.yaml'))
  const r = importLegacyData(f.source, f.target)
  assert.equal(r.sessions, 1)
  assert.equal(r.attachments, 1)
  assert.deepEqual(readFileSync(join(f.target, '.credentials.yaml')), before)
  assert.equal(
    readFileSync(join(f.target, 'sessions', 'project', 'current-session', 'session.v4.jsonl.zstd'), 'utf8'),
    'current log bytes'
  )
  assert.equal(
    readFileSync(join(f.source, 'sessions', 'project', 'old-session', 'session.v3.jsonl.zstd'), 'utf8'),
    'old log bytes'
  )
  assert.equal(JSON.parse(readFileSync(r.report, 'utf8')).complete, true)
})
test('session collisions, active profiles and overlapping homes stop before copying', (t) => {
  const f = fixture(t)
  mkdirSync(join(f.target, 'sessions', 'project', 'old-session'))
  assert.equal(planLegacyImport(f.source, f.target).conflicts.length, 1)
  assert.throws(() => importLegacyData(f.source, f.target), /冲突/)
  assert.throws(() => planLegacyImport(f.source, f.source), /独立/)
  assert.throws(() => planLegacyImport(f.source, join(f.source, 'child')), /独立/)
  rmSync(join(f.target, 'sessions', 'project', 'old-session'), { recursive: true })
  mkdirSync(join(f.target, 'profiles', 'desktop'), { recursive: true })
  writeFileSync(join(f.target, 'profiles', 'desktop', 'lock'), 'active')
  assert.throws(() => importLegacyData(f.source, f.target), /退出/)
  assert.equal(existsSync(join(f.target, 'backups')), false)
})
test('imported schedules are paused and existing plugin records are preserved', (t) => {
  const f = fixture(t)
  const state = {
    version: 1,
    annotations: [],
    schedules: [
      {
        id: 'schedule-1',
        sessionId: 'old-session',
        title: 'old',
        prompt: 'do work',
        timing: { kind: 'interval', minutes: 60 },
        enabled: true,
        nextAt: Date.now() + 60000,
        timeZone: 'UTC',
        history: [],
        updatedAt: Date.now()
      }
    ]
  }
  mkdirSync(join(f.source, 'storages', 'dsh-px-workspace'), { recursive: true })
  writeFileSync(join(f.source, 'storages', 'dsh-px-workspace', 'workspace.json'), JSON.stringify(state))
  const result = importLegacyData(f.source, f.target)
  assert.equal(result.schedulesPaused, 1)
  const imported = JSON.parse(
    readFileSync(join(f.target, 'storages', 'dsh-px-workspace', 'workspace.json'), 'utf8')
  )
  assert.equal(imported.schedules[0].enabled, false)
  assert.equal(imported.schedules[0].nextAt, null)
  assert.equal(state.schedules[0].enabled, true)
})
