import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import {
  PersonaSkillFiles,
  personaSkillProvider,
  installPersonaSkillProviders
} from '../packages/dsh-px-memory/src/persona-skills'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { HistoryIndex, historyRecord } from '../packages/dsh-px-memory/src/history'
import { DatabaseSync } from 'node:sqlite'

function fixture(t: any) {
  const home = mkdtempSync(join(tmpdir(), 'px-private-skills-')),
    files = new PersonaSkillFiles(home)
  t.after(() => {
    assert.ok(resolve(home).startsWith(resolve(tmpdir()) + sep))
    rmSync(home, { recursive: true, force: true })
  })
  const write = (id: string, name: string, body: string, enabled = true) => {
    const dir = join(files.directory(id), name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${id} procedure\ndsh-px-managed: true\ndsh-px-persona: ${id}\ndisable-model-invocation: ${!enabled}\nuser-invocable: ${enabled}\n---\n\n${body}\n`
    )
  }
  return { home, files, write }
}

test('private skill invocations and bodies are not re-exported by generic history or handoff views', () => {
  assert.equal(
    historyRecord({
      seq: 1,
      time: 1,
      type: 'tool/call',
      data: { name: 'skill', callId: 'skill-call', arguments: { name: 'private-check' } }
    }),
    undefined
  )
  assert.equal(
    historyRecord(
      {
        seq: 2,
        time: 2,
        type: 'tool/result',
        data: {
          message: {
            role: 'tool',
            toolCallId: 'skill-call',
            content: [{ type: 'text', text: 'PRIVATE-SKILL-CONTENT' }]
          }
        }
      },
      () => 'skill'
    ),
    undefined
  )
  assert.equal(
    historyRecord({
      seq: 3,
      time: 3,
      type: 'user/message',
      data: {
        source: { kind: 'skill-invocation', name: 'private-check', form: 'instructions' },
        content: [{ type: 'text', text: 'PRIVATE-SKILL-CONTENT' }]
      }
    }),
    undefined
  )
})

test('older history caches cannot retain Skill content after the export policy changes', async (t) => {
  const f = fixture(t),
    store = new MemoryStore(join(f.home, 'memory.json'))
  store.bind('a', { locked: true })
  const path = join(f.home, 'history.sqlite'),
    previous = new HistoryIndex(path, store)
  await previous.close()
  const legacy = new DatabaseSync(path)
  legacy.exec(
    "INSERT INTO sessions(id,cwd,title) VALUES('a','',''); INSERT INTO records VALUES('a',2,1,'tool-result',0,'PRIVATE-SKILL-731'); INSERT INTO search VALUES('a',2,0,'PRIVATE-SKILL-731'); PRAGMA user_version=0;"
  )
  legacy.close()
  const before = store.read(),
    current = new HistoryIndex(path, store)
  try {
    assert.deepEqual(current.search('a', 'PRIVATE-SKILL-731'), [])
    assert.deepEqual(store.read(), before)
  } finally {
    await current.close()
  }
})

test('private Skill files retain owner identity and reject traversal, incorrect ownership and stale candidates', async (t) => {
  const f = fixture(t),
    controller = new AbortController()
  f.write('persona-a', 'private-check', 'A PROCEDURE')
  let owner: string | undefined = 'persona-a'
  const provider = personaSkillProvider(f.files, () => owner, controller)
  const snapshot: any = await provider.list({})
  assert.equal(snapshot.complete, true)
  const candidate = snapshot.candidates[0]
  assert.equal((await provider.get(candidate, {}))?.content, 'A PROCEDURE')
  owner = 'persona-b'
  assert.equal(await provider.get(candidate, {}), undefined)
  assert.deepEqual(((await provider.list({})) as any).candidates, [])
  owner = 'persona-a'
  f.write('persona-a', 'private-check', 'REVISED A PROCEDURE')
  assert.equal(await provider.get(candidate, {}), undefined)
  const updated: any = await provider.list({})
  assert.equal((await provider.get(updated.candidates[0], {}))?.content, 'REVISED A PROCEDURE')
  await assert.rejects(f.files.read('persona-a', '../private-check'), /技能名/)
  const wrong = join(f.files.directory('persona-a'), 'wrong-owner')
  mkdirSync(wrong)
  writeFileSync(
    join(wrong, 'SKILL.md'),
    '---\nname: wrong-owner\ndescription: x\ndsh-px-managed: true\ndsh-px-persona: persona-b\n---\nB PRIVATE'
  )
  await assert.rejects(f.files.read('persona-a', 'wrong-owner'), /身份/)
  controller.abort(new Error('disposed'))
  await assert.rejects(provider.list({}), /disposed/)
})

test('installed private provider is scoped to each Agent and removed when the memory plugin stops', async (t) => {
  const f = fixture(t),
    store = new MemoryStore(join(f.home, 'memory.json'))
  const aId = store.createPersona('A').id,
    bId = store.createPersona('B').id
  store.bind('session-a', { personaId: aId, locked: true })
  store.bind('session-b', { personaId: bId, locked: true })
  f.write(aId, 'a-only', 'ONLY A NATIVE PROVIDER')
  f.write(bId, 'b-only', 'ONLY B NATIVE PROVIDER')
  const app = new Context(),
    registry = app.plugin(SkillRegistry)
  await registry.await()
  let resolveRun!: () => void, rejectRun!: (error: unknown) => void
  const done = new Promise<void>((resolve, reject) => {
    resolveRun = resolve
    rejectRun = reject
  })
  const feature = app.inject(['skills'], (host) => {
    const a: any = { session: { id: 'session-a' } },
      b: any = { session: { id: 'session-b' } }
    const sa = createScope(host, a),
      sb = createScope(host, b)
    a.ctx = sa.ctx
    b.ctx = sb.ctx
    host.provide('agents', { list: () => [a, b] })
    const stop = installPersonaSkillProviders(host, store, f.home)
    const run = async () => {
      try {
        // Prompt assembly is the actual consumer boundary; the hook waits for scoped registration.
        await Promise.resolve()
        await (host as any).waterfall('system-prompt/assemble', {}, { agent: a }, () => ({ sections: [] }))
        assert.equal((await host.skills.get('a-only', { scope: a }))?.content, 'ONLY A NATIVE PROVIDER')
        assert.equal(await host.skills.get('a-only', { scope: b }), undefined)
        assert.equal((await host.skills.get('b-only', { scope: b }))?.content, 'ONLY B NATIVE PROVIDER')
        await stop()
        assert.equal(await host.skills.get('a-only', { scope: a }), undefined)
        assert.equal(await host.skills.get('b-only', { scope: b }), undefined)
      } finally {
        await stop()
        await sa.dispose()
        await sb.dispose()
      }
    }
    void run().then(resolveRun, rejectRun)
  })
  try {
    await done
  } finally {
    await feature.dispose()
    await registry.dispose()
  }
})

test('real pinned native Skill registry isolates names and bodies, shares public skills and rechecks revocation', async (t) => {
  const f = fixture(t)
  f.write('persona-a', 'private-check', 'A PRIVATE')
  f.write('persona-b', 'private-check', 'B PRIVATE')
  f.write('persona-a', 'a-only', 'ONLY A')
  const app = new Context(),
    registry = app.plugin(SkillRegistry)
  await registry.await()
  let resolveRun!: () => void, rejectRun!: (error: unknown) => void
  const done = new Promise<void>((resolve, reject) => {
    resolveRun = resolve
    rejectRun = reject
  })
  const feature = app.inject(['skills'], (host) => {
    const a = {},
      b = {},
      sa = createScope(host, a),
      sb = createScope(host, b)
    const run = async () => {
      let revoked = false
      try {
        host.skills.register({
          name: 'common-check',
          description: 'Shared procedure',
          source: 'runtime',
          content: 'COMMON'
        })
        let invalidateA!: () => void
        sa.ctx.skills.registerProvider((control) => {
          invalidateA = control.invalidate
          return personaSkillProvider(f.files, () => (revoked ? undefined : 'persona-a'), control)
        })
        sb.ctx.skills.registerProvider((control) => personaSkillProvider(f.files, () => 'persona-b', control))
        assert.deepEqual(
          (await host.skills.list()).map((s) => s.name),
          ['common-check']
        )
        assert.deepEqual(
          (await host.skills.list({ scope: b })).map((s) => s.name),
          ['common-check', 'private-check']
        )
        assert.equal(await host.skills.get('a-only', { scope: b }), undefined)
        assert.equal((await host.skills.get('private-check', { scope: a }))?.content, 'A PRIVATE')
        assert.equal((await host.skills.get('private-check', { scope: b }))?.content, 'B PRIVATE')
        assert.equal((await host.skills.get('common-check', { scope: a }))?.content, 'COMMON')
        f.write('persona-a', 'private-check', 'A DISABLED', false)
        invalidateA()
        assert.equal((await host.skills.get('private-check', { scope: a }))?.invocation.modelInvocable, false)
        revoked = true
        invalidateA()
        assert.equal(await host.skills.get('private-check', { scope: a }), undefined)
        assert.deepEqual(
          (await host.skills.list({ scope: a })).map((s) => s.name),
          ['common-check']
        )
        assert.equal((await host.skills.get('private-check', { scope: b }))?.content, 'B PRIVATE')
      } finally {
        await sa.dispose()
        await sb.dispose()
      }
    }
    void run().then(resolveRun, rejectRun)
  })
  try {
    await done
  } finally {
    await feature.dispose()
    await registry.dispose()
  }
})
