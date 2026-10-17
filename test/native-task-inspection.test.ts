import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectNativeTasks, describeNativeTasks } from '../src/main/native-task-inspection'

const agent = (status: string, source = 'user-approval', nextTurn = false) => ({
  id: 'session-a',
  status,
  inbox: {
    nextTurn: nextTurn ? [{ source: { kind: source } }] : [],
    nextStep: nextTurn ? [] : [{ source: { kind: source } }]
  }
})
const emptyJobs = { list: () => [] }
test('idle permission notification is not active work, while pending user or unknown input remains protected', () => {
  const notice = inspectNativeTasks([agent('idle')], emptyJobs)
  assert.equal(notice.active, false)
  assert.equal(notice.configurationNotices, 1)
  assert.equal(inspectNativeTasks([agent('idle', 'user')], emptyJobs).active, true)
  assert.equal(inspectNativeTasks([agent('idle', 'unrecognized')], emptyJobs).active, true)
  assert.equal(inspectNativeTasks([agent('idle', 'user-approval', true)], emptyJobs).active, true)
})
test('running agent or stopping job still requires confirmation and reasons are bounded', () => {
  const report = inspectNativeTasks([agent('running')], { list: () => [{ id: 'job-1', status: 'stopping' }] })
  assert.equal(report.active, true)
  assert.equal(report.total, 2)
  assert.equal(report.items.filter((x) => x.kind === 'background-job').length, 1)
  assert.match(describeNativeTasks(report, true), /session-a.*等待确认/)
  const titled = inspectNativeTasks(
    [{ ...agent('running'), ctx: { get: () => ({ stateOf: () => ({ title: '正在核对版本' }) }) } }],
    emptyJobs
  )
  assert.match(describeNativeTasks(titled, true), /正在核对版本/)
  const many = inspectNativeTasks(
    Array.from({ length: 25 }, (_, i) => ({ ...agent('running'), id: `s${i}` })),
    emptyJobs
  )
  assert.equal(many.total, 25)
  assert.equal(many.items.length, 20)
  assert.match(describeNativeTasks(many, true), /另有 5 项/)
})
