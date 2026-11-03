import test from 'node:test'
import assert from 'node:assert/strict'
import { AudiencePolicies } from '../packages/shared/audience-policy'
const binding = {
  channel: {
    provider: 'peer',
    accountId: 'local',
    conversationId: 'pair',
    access: 'public' as const,
    publicInstructions: ''
  }
}
test('public execution rules fail closed on missing/unloaded owners and old disposers cannot remove replacement', () => {
  const policies = new AudiencePolicies()
  assert.match(policies.check({ name: 'shell' }, binding)!, /未就绪/)
  const definition = {
    section: 'px-peer',
    check: (exec: any) => (exec.name === 'read' ? undefined : 'denied')
  }
  const release = policies.register('peer', definition)
  definition.section = 'changed'
  assert.equal(policies.section('peer'), 'px-peer')
  assert.equal(policies.check({ name: 'read' }, binding), undefined)
  assert.equal(policies.check({ name: 'shell' }, binding), 'denied')
  assert.throws(() => policies.register('peer', definition), /已被注册/)
  release()
  assert.match(policies.check({ name: 'read' }, binding)!, /未就绪/)
  const fresh = policies.register('peer', { section: 'px-peer-new', check: () => 'revoked' })
  release()
  assert.equal(policies.section('peer'), 'px-peer-new')
  assert.equal(policies.check({}, binding), 'revoked')
  fresh()
})

test('public job access excludes host unowned work and foreign owners without consuming output', () => {
  const policies = new AudiencePolicies()
  policies.register('peer', { section: 'px-peer', check: () => undefined })
  let owner: string | undefined,
    reads = 0
  const exec = {
    name: 'job_output',
    arguments: { job_id: 'job-1' },
    agent: {
      session: { id: 'public-session' },
      ctx: {
        jobs: {
          get: () => ({ owner }),
          read: () => {
            reads++
          }
        }
      }
    }
  }
  assert.match(policies.check(exec, binding)!, /自己拥有/)
  owner = 'private-session'
  assert.match(policies.check(exec, binding)!, /自己拥有/)
  owner = 'public-session'
  assert.equal(policies.check(exec, binding), undefined)
  assert.equal(policies.check({ ...exec, name: 'job_kill' }, binding), undefined)
  assert.match(policies.check({ ...exec, name: 'job_list' }, binding)!, /不能列出/)
  assert.equal(reads, 0)
})
