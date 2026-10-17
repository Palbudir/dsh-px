import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import {
  nativeSkillProjectRoot,
  skillAction,
  observeFile
} from '../packages/dsh-px-memory/src/native-resources'

test('Skills management follows native Git-root discovery and fences explicit destination/version', async () => {
  const root = resolve(tmpdir(), 'px-skill-repo'),
    cwd = join(root, 'nested', 'source'),
    home = join(tmpdir(), 'px-skill-home'),
    files = new Map<string, { type: string; version: string; text?: string }>()
  files.set(join(root, '.git'), { type: 'directory', version: 'git' })
  const fs = {
    resolve: async (p: string, o?: any) => resolve(o?.cwd ?? cwd, p),
    stat: async (p: string) => files.get(p),
    processPath: (p: string) => p,
    contains: (p: string, c: string) => {
      const r = relative(p, c)
      return r === '' || (!r.startsWith('..' + sep) && r !== '..' && !resolve(c).startsWith('OTHER:'))
    },
    readText: async (p: string) => files.get(p)!.text,
    writeText: async (p: string, text: string, guard: any, _signal: unknown, policy: any) => {
      assert.equal(policy.sessionId, 's')
      assert.equal(policy.workspaceRoot, cwd)
      if (policy.mode === 'read-only')
        throw Object.assign(new Error('file access denied'), { code: 'FS_SANDBOX_DENIED' })
      const old = files.get(p)
      if (guard.kind === 'createIfAbsent') assert.equal(old, undefined)
      else assert.equal(guard.version, old?.version)
      const version = String(Number(old?.version ?? 0) + 1)
      files.set(p, { type: 'file', version, text })
      return { version }
    }
  }
  let mode = 'workspace-write'
  const skills = { list: async () => [], get: async () => undefined },
    services: Record<string, any> = {
      fs,
      skills,
      agents: { get: () => ({ session: { id: 's', header: { cwd } } }) },
      sandboxPolicy: {
        resolve: ({ session }: any) => ({ mode, sessionId: session.id, workspaceRoot: session.header.cwd })
      }
    },
    host = { get: (name: string) => services[name] },
    caller = { sessionId: 's', project: cwd }
  assert.equal(await nativeSkillProjectRoot(fs, cwd), root)
  const listing = await skillAction(host, caller, home, { action: 'list' }),
    target = join(root, '.dsh', 'skills')
  assert.equal(listing.directories.project, target)
  const input = {
    action: 'save',
    scope: 'project',
    name: 'review-result',
    description: 'Verify receipts',
    body: 'Read the result before concluding.',
    enabled: true,
    expectedRoot: target
  }
  await assert.rejects(
    skillAction(host, caller, home, { ...input, expectedRoot: join(cwd, '.dsh', 'skills') }),
    /目录已变化/
  )
  const saved = await skillAction(host, caller, home, input)
  assert.equal(saved.path, join(target, 'review-result', 'SKILL.md'))
  assert.match(files.get(saved.path)!.text!, /disable-model-invocation: false/)
  const disabled = await skillAction(host, caller, home, { ...input, enabled: false, version: saved.version })
  assert.match(files.get(saved.path)!.text!, /user-invocable: false/)
  await assert.rejects(skillAction(host, caller, home, { ...input, version: saved.version }), /已变化/)
  mode = 'read-only'
  await assert.rejects(
    skillAction(host, caller, home, { ...input, version: disabled.version }),
    (e: any) => e.status === 403
  )
  assert.equal(files.get(saved.path)!.version, disabled.version)
  const ref = await observeFile(host, caller, saved.path)
  assert.equal(ref?.version, disabled.version)
  files.delete(saved.path)
  assert.equal(await observeFile(host, caller, saved.path), undefined)
})
