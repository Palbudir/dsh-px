import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexImportedSessions } from '../packages/dsh-px-workspace/src/import-index'
test('import indexing restores native memberships and cold titles without running agents, and does not repeat completed receipts', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-index-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'backups', 'px-import-' + randomUUID())
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'import.json')
  writeFileSync(path, JSON.stringify({ complete: true, sessions: ['project/parent', 'project/child'] }))
  const actions: string[] = []
  const host = {
    sessionController: {
      inspect: async (id: string) => ({
        meta: { id, cwd: root, origin: id === 'child' ? 'subagent' : undefined }
      }),
      projections: async ({ sessionId }: { sessionId: string }) => {
        actions.push('project:' + sessionId)
      },
      prompt: () => assert.fail('indexing must never run an Agent')
    },
    workspaceRegistry: {
      create: async () => ({
        attachSession: async (id: string) => {
          actions.push('attach:' + id)
        }
      })
    }
  }
  await indexImportedSessions(root, host, new AbortController().signal)
  assert.deepEqual(actions, ['project:parent', 'attach:parent'])
  const result = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(result.indexedSessions, 1)
  assert.deepEqual(result.skippedSessions, ['child'])
  await indexImportedSessions(root, host, new AbortController().signal)
  assert.equal(actions.length, 2)
})
