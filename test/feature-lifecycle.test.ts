import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceStore } from '../packages/dsh-px-workspace/src/store'
import { apply } from '../packages/dsh-px-workspace/src/index'
test('disabling the schedule feature removes its route and stops automatic delivery; enabling restores the saved task', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-feature-')),
    previous = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const coreOff: Array<() => void> = [],
    featureOff: Array<() => void> = [],
    routes = new Map<string, unknown>()
  let runtime: any,
    delivered = 0
  t.after(() => {
    featureOff.reverse().forEach((f) => f())
    coreOff.reverse().forEach((f) => f())
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(root, { recursive: true, force: true })
  })
  const store = new WorkspaceStore(join(root, 'storages', 'dsh-px-workspace', 'workspace.json'))
  store.update((state) =>
    state.schedules.push({
      id: 'schedule-test',
      sessionId: 'owner',
      title: 'test',
      prompt: 'fixture',
      timing: { kind: 'once', at: Date.now() + 500 },
      enabled: true,
      nextAt: Date.now() + 500,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      history: [],
      updatedAt: Date.now()
    })
  )
  apply({
    inject: (names, callback) => {
      if (names.includes('workspaceRegistry')) return
      callback({
        provide: (_name, value) => {
          runtime = value
        },
        sessions: { get: () => ({ header: { id: 'owner' }, snapshotEvents: () => [] }) },
        sessionController: {
          inspect: async () => ({ meta: { id: 'owner' }, events: [] }),
          prompt: async () => {
            delivered++
            return { accepted: true }
          }
        },
        connection: { requestRejection: () => undefined },
        webServer: {
          register: (route) => {
            routes.set(route.path, route)
            return () => {
              routes.delete(route.path)
            }
          }
        },
        effect: (fn) => {
          coreOff.push(fn())
        }
      })
    }
  })
  assert.equal(routes.has('/dsh-px-workspace/schedules'), false)
  const owner = { effect: (fn: () => () => void) => featureOff.push(fn()) }
  runtime.mount(owner, 'schedules')
  assert.equal(routes.has('/dsh-px-workspace/schedules'), true)
  featureOff
    .splice(0)
    .reverse()
    .forEach((f) => f())
  assert.equal(routes.has('/dsh-px-workspace/schedules'), false)
  await new Promise((r) => setTimeout(r, 2200))
  assert.equal(delivered, 0)
  runtime.mount(owner, 'schedules')
  await new Promise((r) => setTimeout(r, 2200))
  assert.equal(delivered, 1)
})
