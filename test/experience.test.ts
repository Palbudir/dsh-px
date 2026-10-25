import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { ExperienceBank, type ExperienceCaller } from '../packages/dsh-px-memory/src/experience'

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'px-experience-')),
    project = join(root, 'project'),
    otherProject = join(root, 'other')
  for (const path of [project, otherProject]) mkdirSync(join(path, '.git'), { recursive: true })
  const store = new MemoryStore(join(root, 'identity.json'))
  store.bind('a')
  store.action(store.read().revision, { type: 'create', name: '另一人格' }, 'b', project)
  const bank = new ExperienceBank(join(root, 'experience'), join(root, 'home'), store, join(root, 'agents'))
  t.after(async () => {
    await bank.dispose()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  const a: ExperienceCaller = { sessionId: 'a', project, actor: 'model' },
    b: ExperienceCaller = { sessionId: 'b', project, actor: 'model' }
  return { root, project, otherProject, bank, store, a, b }
}
const skill = (body: string) =>
  `---\nname: checked-procedure\ndescription: A tested procedure\n---\n\n${body}\n`
async function draft(
  bank: ExperienceBank,
  caller: ExperienceCaller,
  content = skill('Inspect evidence before reporting success.')
) {
  const before = await bank.read(caller, 'overview')
  return bank.write(
    caller,
    'draft-record',
    { skillName: 'checked-procedure', content, notes: 'Test candidate', targetRoot: 'project-dsh' },
    before.revision
  )
}

test('native Skill candidates are persona/project private; explicit human adoption alone writes a shared Skill', async (t) => {
  const { bank, a, b, project, otherProject } = fixture(t)
  const created = await draft(bank, a),
    id = created.value.id
  assert.equal((await bank.read(a, 'drafts')).value.length, 1)
  assert.equal((await bank.read(b, 'drafts')).value.length, 0)
  assert.equal((await bank.read({ ...a, project: otherProject }, 'drafts')).value.length, 0)
  const target = join(project, '.dsh/skills/checked-procedure/SKILL.md')
  assert.equal(existsSync(target), false)
  const current = await bank.read(a, 'overview')
  await assert.rejects(bank.adopt(a, id, current.revision, 'project'), /明确选择共享/)
  await bank.adopt({ ...a, actor: 'human' }, id, current.revision, 'project')
  assert.match(readFileSync(target, 'utf8'), /Inspect evidence/)
  assert.equal((await bank.read(b, 'drafts')).value.length, 0)
  assert.ok((await bank.read(b, 'catalog')).value.skills.some((row: any) => row.name === 'checked-procedure'))
})

test('concurrent candidate edits keep original revision; a task cannot save after its source persona changes', async (t) => {
  const { bank, a, store, project } = fixture(t)
  const created = await draft(bank, a),
    id = created.value.id,
    before = await bank.read(a, 'overview')
  const results = await Promise.allSettled(
    ['first', 'second'].map((body) =>
      bank.write(a, 'draft-update', { id, content: skill(body) }, before.revision)
    )
  )
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  const expectedPersona = bank.identity(a).personaId
  store.action(store.read().revision, { type: 'create', name: '已切换人格' }, a.sessionId, project)
  await assert.rejects(bank.read({ ...a, personaId: expectedPersona }, 'overview'), /来源人格已变化/)
})

test('native adoption rejects an existing Skill changed after drafting and keeps the new file intact', async (t) => {
  const { bank, a, project } = fixture(t)
  const path = join(project, '.dsh/skills/checked-procedure/SKILL.md')
  mkdirSync(join(project, '.dsh/skills/checked-procedure'), { recursive: true })
  writeFileSync(path, skill('original'))
  const candidate = await draft(bank, a, skill('candidate'))
  writeFileSync(path, skill('external correction'))
  const current = await bank.read(a, 'overview')
  await assert.rejects(
    bank.adopt({ ...a, actor: 'human' }, candidate.value.id, current.revision, 'project'),
    /changed|modified|hash|invalid/i
  )
  assert.match(readFileSync(path, 'utf8'), /external correction/)
})

test('adopting an update cannot silently turn project-only consent into a global write', async (t) => {
  const { bank, a, root } = fixture(t)
  const path = join(root, 'home/skills/checked-procedure/SKILL.md')
  mkdirSync(join(root, 'home/skills/checked-procedure'), { recursive: true })
  writeFileSync(path, skill('original global'))
  const candidate = await draft(bank, a, skill('reviewed global update'))
  assert.equal(candidate.value.action, 'update')
  const current = await bank.read(a, 'overview')
  await assert.rejects(
    bank.adopt({ ...a, actor: 'human' }, candidate.value.id, current.revision, 'project'),
    /范围必须/
  )
  assert.match(readFileSync(path, 'utf8'), /original global/)
  await bank.adopt({ ...a, actor: 'human' }, candidate.value.id, current.revision, 'global')
  assert.match(readFileSync(path, 'utf8'), /reviewed global update/)
})

test('cancelling a queued analysis write prevents its candidate from being committed', async (t) => {
  const { bank, a } = fixture(t)
  const before = await bank.read(a, 'overview')
  const controller = new AbortController()
  const caller = { ...a, signal: controller.signal }
  const pending = bank.write(
    caller,
    'draft-record',
    { skillName: 'checked-procedure', content: skill('must not save'), notes: 'cancelled' },
    before.revision
  )
  controller.abort(new Error('analysis cancelled'))
  await assert.rejects(pending, /analysis cancelled/)
  assert.equal((await bank.read(a, 'drafts')).value.length, 0)
})
