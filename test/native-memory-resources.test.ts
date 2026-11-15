import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { personaSkillDirectory } from '../packages/dsh-px-memory/src/persona-skills'
import { Context } from '@deepseek-ai/cordis'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import {
  nativeSkillProjectRoot,
  skillAction,
  observeFile,
  awaitSkillDiscovery
} from '../packages/dsh-px-memory/src/native-resources'

test('Skill adoption discovery confirms native content instead of file existence or an older cached skill', async () => {
  const expected = {
    name: 'review-result',
    path: '/isolated/SKILL.md',
    content: '---\nname: review-result\ndescription: Check receipts\n---\nNew procedure.\n'
  }
  let calls = 0
  const host = {
    get: (name: string) =>
      name === 'skills'
        ? {
            get: async () => {
              calls++
              return {
                name: expected.name,
                path: expected.path,
                description: 'Check receipts',
                content: calls === 1 ? 'Old procedure.' : 'New procedure.'
              }
            }
          }
        : undefined
  }
  assert.equal(await awaitSkillDiscovery(host, { sessionId: 's', project: '/isolated' }, expected), 'ready')
  assert.equal(calls, 2)
  assert.equal(
    await awaitSkillDiscovery({ get: () => undefined }, { sessionId: 's', project: '/isolated' }, expected),
    'pending'
  )
})

test('Skill discovery compares native target identity for path aliases and rejects another file with identical content', async () => {
  const expected = {
    name: 'review-result',
    path: 'c:/project/SKILL.md',
    content: '---\nname: review-result\ndescription: Check receipts\n---\nProcedure.\n'
  }
  let foundKey = 'native-file-a'
  const host = {
    get: (name: string) =>
      name === 'skills'
        ? {
            get: async () => ({
              name: expected.name,
              path: 'C:/Project/SKILL.md',
              description: 'Check receipts',
              content: 'Procedure.'
            })
          }
        : name === 'fs'
          ? {
              resolve: async (path: string) => ({
                targetKey: path === expected.path ? 'native-file-a' : foundKey
              })
            }
          : undefined
  }
  assert.equal(await awaitSkillDiscovery(host, { sessionId: 's', project: 'c:/project' }, expected), 'ready')
  foundKey = 'native-file-b'
  assert.equal(
    await awaitSkillDiscovery(host, { sessionId: 's', project: 'c:/project' }, expected),
    'pending'
  )
})

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

test('human private Skill save is one-call only and rejects forged actors, links and changed ownership', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'px-skill-human-')),
    project = join(home, 'workspace'),
    root = personaSkillDirectory(home, 'owner'),
    target = join(root, 'procedure', 'SKILL.md'),
    policy = Object.freeze({ mode: 'workspace-write', workspaceRoot: project })
  mkdirSync(project)
  t.after(() => {
    assert.ok(resolve(home).startsWith(resolve(tmpdir()) + sep))
    rmSync(home, { recursive: true, force: true })
  })
  let currentOwner = 'owner',
    writes = 0,
    resolved = 0,
    changeOwnerOnResolve = false
  const files = new Map<string, { type: string; version: string; text: string }>(),
    filesystem = {
      resolve: async (path: string) => {
        resolved++
        if (changeOwnerOnResolve && path === target) currentOwner = 'other'
        return { targetKey: resolve(path) }
      },
      processPath: (t: any) => t.targetKey,
      contains: (p: any, c: any) => {
        const rel = relative(p.targetKey, c.targetKey)
        return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep))
      },
      stat: async (t: any) => files.get(t.targetKey),
      readText: async (t: any) => files.get(t.targetKey)!.text,
      writeText: async (t: any, text: string, intent: any, _signal: unknown, perCall: any) => {
        if (perCall.mode !== 'danger-full-access')
          throw Object.assign(new Error('native policy denied'), { code: 'FS_SANDBOX_DENIED' })
        assert.equal(t.targetKey, target, 'only the exact managed file receives a one-call policy')
        assert.notEqual(perCall, policy)
        writes++
        if (intent.kind === 'createIfAbsent') assert.equal(files.has(t.targetKey), false)
        else assert.equal(intent.version, files.get(t.targetKey)?.version)
        const version = String(writes)
        files.set(t.targetKey, { type: 'file', version, text })
        return { version }
      }
    },
    services: Record<string, any> = {
      fs: filesystem,
      skills: { list: async () => [], get: async () => undefined },
      agents: { get: () => ({ session: { id: 's', header: { cwd: project } } }) },
      sandboxPolicy: { resolve: () => policy },
      pxMemoryChannels: { inspect: () => ({ binding: {}, persona: { id: currentOwner } }) }
    },
    host = { get: (key: string) => services[key] },
    caller = { sessionId: 's', project },
    input = {
      action: 'save',
      scope: 'persona',
      name: 'procedure',
      expectedRoot: root,
      description: 'A private procedure',
      body: 'Check the result.',
      enabled: true
    }
  await assert.rejects(
    skillAction(host, caller, home, { ...input, actor: 'human' }),
    (e: any) => e.status === 403
  )
  assert.equal(writes, 0, 'request-body actor does not confer manual authority')
  const saved = await skillAction(host, { ...caller, actor: 'human' }, home, input)
  assert.equal(saved.path, target)
  assert.equal(policy.mode, 'workspace-write')
  await assert.rejects(
    skillAction(host, { ...caller, actor: 'model' }, home, { ...input, version: saved.version }),
    (e: any) => e.status === 403
  )
  await assert.rejects(
    skillAction(host, { ...caller, actor: 'human' }, home, { ...input, version: 'stale' }),
    /已变化/
  )
  assert.equal(writes, 1)
  changeOwnerOnResolve = true
  await assert.rejects(
    skillAction(host, { ...caller, actor: 'human' }, home, { ...input, version: saved.version }),
    /人格或资料范围/
  )
  assert.equal(writes, 1)
  changeOwnerOnResolve = false
  currentOwner = 'owner'
  mkdirSync(root, { recursive: true })
  symlinkSync(project, join(root, 'procedure'), 'junction')
  await assert.rejects(
    skillAction(host, { ...caller, actor: 'human' }, home, { ...input, version: saved.version }),
    /包含链接/
  )
  assert.equal(writes, 1)
  assert.ok(resolved > 0)
})

test('private human saves preserve real native filesystem policy and compare-and-write protection', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'px-skill-native-policy-')),
    project = join(home, 'workspace'),
    app: any = new Context(),
    fibers: any[] = []
  mkdirSync(project)
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
    assert.ok(resolve(home).startsWith(resolve(tmpdir()) + sep))
    rmSync(home, { recursive: true, force: true })
  })
  for (const [plugin, config] of [
    [SessionProjections, {}],
    [SandboxPolicy, { mode: 'read-only', workspaceRoot: project }],
    [SandboxedFileSystem, { cwd: project }]
  ] as const) {
    const f = app.plugin(plugin, config)
    fibers.push(f)
    await f.await()
  }
  let native: any
  const injected = app.inject(['fs', 'sandboxPolicy'], (ctx: any) => {
    native = ctx
  })
  fibers.push(injected)
  await injected.await()
  const policy = native.sandboxPolicy.resolve(),
    services: Record<string, any> = {
      fs: native.fs,
      sandboxPolicy: { resolve: () => native.sandboxPolicy.resolve() },
      agents: { get: () => ({ session: { id: 's', header: { cwd: project } } }) },
      skills: { list: async () => [], get: async () => undefined },
      pxMemoryChannels: { inspect: () => ({ binding: {}, persona: { id: 'owner' } }) }
    },
    host = { get: (name: string) => services[name] },
    caller = { sessionId: 's', project },
    input = {
      action: 'save',
      scope: 'persona',
      name: 'procedure',
      expectedRoot: personaSkillDirectory(home, 'owner'),
      description: 'Native write acceptance',
      body: 'First procedure.',
      enabled: true
    }
  await assert.rejects(skillAction(host, caller, home, input), (error: any) => error.status === 403)
  const first = await skillAction(host, { ...caller, actor: 'human' }, home, input)
  const second = await skillAction(host, { ...caller, actor: 'human' }, home, {
    ...input,
    version: first.version,
    body: 'Corrected procedure.'
  })
  assert.notEqual(first.version, second.version)
  await assert.rejects(
    skillAction(host, { ...caller, actor: 'human' }, home, { ...input, version: first.version }),
    /已变化/
  )
  assert.deepEqual(native.sandboxPolicy.resolve(), policy)
  await assert.rejects(
    native.fs.writeText(await native.fs.resolve(first.path), 'model overwrite', undefined, undefined, policy),
    { code: 'FS_SANDBOX_DENIED' }
  )
  assert.match(await native.fs.readText(await native.fs.resolve(first.path)), /Corrected procedure/)
})
