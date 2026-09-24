import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CommandGuidanceIndex,
  hasWindowsChildPipeFailure
} from '../packages/dsh-px-taskflow/src/command-guidance'
import { EvidenceIndex, evidenceDetail, type Event } from '../packages/dsh-px-taskflow/src/evidence'
import { commandRetryDraft } from '../packages/dsh-px-taskflow/src/command-retry-draft'
import { appendToDraft } from '../packages/shared/client-input'

const failure =
  'Error: spawn EPERM\n at ChildProcess.spawn (node:internal/child_process:441:11)\n[exit code: 1]'
const original = { command: 'npm test', workdir: 'C:\\Projects\\fixture', timeoutMs: 60000 }
function configured() {
  const index = new CommandGuidanceIndex()
  index.observe('sandbox/mode', { mode: 'workspace-write' })
  index.observe('approval/policy', { policy: 'ask' })
  return index
}
function failed(index: CommandGuidanceIndex, id = 'failed', args: any = original, seq = 3) {
  index.start(id, 'pwsh', args, seq)
  index.finish(id, 'error', failure)
}
test('guidance requires a failed pwsh with a nonzero terminal marker and a Node spawn error', () => {
  assert.equal(hasWindowsChildPipeFailure(failure), true)
  assert.equal(hasWindowsChildPipeFailure(failure.replace('[exit code: 1]', '[exit code: 0]')), false)
  assert.equal(hasWindowsChildPipeFailure('spawn EPERM\n[exit code: 1]'), false)
  const index = configured()
  index.start('read', 'read', original, 1)
  index.finish('read', 'error', failure)
  assert.equal(index.guidance('read', 'win32'), undefined)
  index.start('ok', 'pwsh', original, 2)
  index.finish('ok', 'returned', failure)
  assert.equal(index.guidance('ok', 'win32'), undefined)
  failed(index)
  assert.deepEqual(index.guidance('failed', 'win32')?.request, original)
  assert.equal(index.guidance('failed', 'linux'), undefined)
})
test('complete original command is retained independently of the clipped execution input', () => {
  const command = 'npm test # ' + 'x'.repeat(2000)
  const events: Event[] = [
    { seq: 0, time: 0, type: 'sandbox/mode', data: { mode: 'workspace-write' } },
    { seq: 1, time: 0, type: 'approval/policy', data: { policy: 'ask' } },
    {
      seq: 2,
      time: 0,
      type: 'tool/call',
      data: { callId: 'c', name: 'pwsh', arguments: JSON.stringify({ ...original, command }) }
    },
    {
      seq: 3,
      time: 1,
      type: 'tool/result',
      data: {
        message: {
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c',
              content: [{ type: 'text', text: failure }],
              isError: false
            }
          ]
        }
      }
    }
  ]
  const index = new EvidenceIndex().update(events)
  assert.equal(evidenceDetail(index, 'c')!.input.length, 1200)
  assert.equal(index.snapshot().commands.guidance('c', 'win32')?.request?.command, command)
  assert.equal(index.snapshot().commands.guidance('c', 'win32')?.request?.workdir, original.workdir)
})
test('missing, oversized or ambiguous workdir arguments yield explanation only', () => {
  for (const args of [
    { command: 'npm test' },
    { ...original, command: 'x'.repeat(20001) },
    { ...original, workdir: './other' }
  ]) {
    const index = configured()
    failed(index, 'a', args)
    const guidance = index.guidance('a', 'win32')!
    assert.equal(guidance.request, undefined)
    assert.match(guidance.unavailableReason!, /完整原命令|明确工作目录/)
  }
})
test('rejection, cancellation or unavailable approval suppress repeated suggestions for the same command', () => {
  for (const outcome of ['rejected', 'cancelled', 'unavailable']) {
    const index = configured()
    failed(index)
    index.start('retry', 'pwsh', { ...original, sandbox_permissions: 'danger-full-access' }, 10)
    index.observe('approval/asked', { id: 'approval', callId: 'retry', toolName: 'pwsh' })
    index.observe('approval/decided', { id: 'approval', outcome })
    index.finish('retry', 'error', 'approval did not allow execution')
    failed(index, 'again', original, 15)
    for (const id of ['failed', 'again']) {
      assert.equal(index.guidance(id, 'win32')?.request, undefined)
      assert.match(index.guidance(id, 'win32')?.unavailableReason ?? '', /拒绝、取消或未完成/)
    }
  }
})
test('completed approved execution suppresses the earlier retry; policy changes are checked on each read', () => {
  const index = configured()
  failed(index)
  index.start('allowed', 'pwsh', { ...original, sandbox_permissions: 'danger-full-access' }, 10)
  index.observe('approval/asked', { id: 'approval', callId: 'allowed', toolName: 'pwsh' })
  index.observe('approval/decided', { id: 'approval', outcome: 'allowed-once' })
  index.finish('allowed', 'returned', 'tests 3, pass 3, fail 0')
  assert.match(index.guidance('failed', 'win32')!.unavailableReason!, /之后已有/)
  failed(index, 'new-failure', original, 20)
  assert.ok(index.guidance('new-failure', 'win32')!.request)
  index.observe('approval/policy', { policy: 'never' })
  assert.equal(index.guidance('new-failure', 'win32')!.request, undefined)
  index.observe('approval/policy', { policy: 'ask' })
  index.observe('sandbox/mode', { mode: 'danger-full-access' })
  assert.equal(index.guidance('new-failure', 'win32')!.request, undefined)
})
test('an incomplete denied retry cannot leave the earlier complete-command suggestion enabled', () => {
  const index = configured()
  failed(index)
  index.start(
    'implicit-cwd',
    'pwsh',
    { command: original.command, sandbox_permissions: 'danger-full-access' },
    10
  )
  index.observe('approval/asked', { id: 'approval', callId: 'implicit-cwd', toolName: 'pwsh' })
  index.observe('approval/decided', { id: 'approval', outcome: 'rejected' })
  assert.equal(index.guidance('failed', 'win32')?.request, undefined)
})
test('preparation preserves exact command and workdir, only appends to the named session draft, and never submits', () => {
  const request = { ...original, command: 'npm test # literal ``` must remain data' }
  const text = commandRetryDraft(request)
  const parameters = JSON.parse(text.match(/```json\n([\s\S]*)\n```$/)![1])
  assert.equal(parameters.command, request.command)
  assert.equal(parameters.workdir, request.workdir)
  assert.equal(parameters.sandbox_permissions, 'danger-full-access')
  assert.match(text, /只有我选择允许一次后才能执行/)
  const drafts = { a: '已有草稿 A', b: '已有草稿 B' },
    notifications: string[] = []
  const scopes: any = {}
  for (const id of ['a', 'b'] as const)
    scopes[id] = {
      id,
      bail(scope: unknown, event: string, patch: any) {
        assert.equal(scope, scopes[id])
        assert.equal(event, 'slash/input-insert-text')
        assert.equal(patch.span.draftRev, 7)
        assert.equal(patch.span.start, drafts[id].length)
        drafts[id] += patch.text
        return true
      }
    }
  const ctx = {
    sessions: { scope: (id: string) => scopes[id] },
    conversation: {
      input: {
        for: (scope: any) => ({
          state: {
            getSnapshot: () => ({ draft: drafts[scope.id as 'a' | 'b'], draftRev: 7, phase: 'plain' })
          },
          notify: (_level: unknown, notice: string) => notifications.push(notice)
        })
      }
    }
  }
  appendToDraft(ctx, 'a', text, '尚未执行')
  assert.ok(drafts.a.startsWith('已有草稿 A\n\n'))
  assert.equal(drafts.b, '已有草稿 B')
  assert.deepEqual(notifications, ['尚未执行'])
  assert.equal(Object.hasOwn(ctx, 'execute'), false)
})
