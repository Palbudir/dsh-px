import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { MemoryStore } from '../packages/dsh-px-memory/src/store'
import { KnowledgeBank } from '../packages/dsh-px-memory/src/knowledge'
import { pxKnowledgeSource, knowledgeContractText } from '../packages/dsh-px-memory/src/knowledge-source'
import { MemoryCompositionRunner } from 'dsh-mnemon/testing'
import { GENERAL_VIEW_STRATEGY } from 'dsh-mnemon-strategy-general'

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'px-knowledge-cd-')),
    projectA = join(root, 'a'),
    projectB = join(root, 'b')
  mkdirSync(projectA)
  mkdirSync(projectB)
  const identities = new MemoryStore(join(root, 'memory.json'))
  identities.bind('session-a')
  let s = identities.read()
  s = identities.action(s.revision, { type: 'create', name: '另一人格' }, 'session-b', projectA)
  const other = s.personas.find((p) => p.id !== 'default')!
  identities.bind('session-c', { personaId: other.id })
  const bank = new KnowledgeBank(join(root, 'knowledge'), identities)
  t.after(async () => {
    await bank.dispose()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    identities,
    bank,
    a: { sessionId: 'session-a', project: projectA },
    b: { sessionId: 'session-b', project: projectA },
    aElsewhere: { sessionId: 'session-a', project: projectB }
  }
}
test('four scopes isolate persona and project with actual Mnemon document engine', async (t) => {
  const { bank, a, b, aElsewhere } = fixture(t)
  for (const scope of ['persona', 'persona-project', 'project', 'global'] as const) {
    const before = await bank.catalog(a, scope)
    await bank.write(a, scope, { key: '共同测试主题', body: 'scope-canary', revision: before.revision })
    const other = await bank.catalog(b, scope),
      elsewhere = await bank.catalog(aElsewhere, scope)
    assert.equal(other.documents.length, scope === 'project' || scope === 'global' ? 1 : 0, scope)
    assert.equal(elsewhere.documents.length, scope === 'persona' || scope === 'global' ? 1 : 0, scope)
    if (scope === 'persona') {
      const own = await bank.catalog(a, scope)
      await assert.rejects(bank.read(b, scope, own.documents[0].id), (error: any) => error.status === 404)
    }
  }
})
test('correction replaces current body, fences concurrent writes and invalidates shared descendants', async (t) => {
  const { bank, a } = fixture(t)
  const start = await bank.catalog(a, 'persona')
  const first = await bank.write(a, 'persona', {
    key: '发布条件',
    body: 'OLD_WRONG_791',
    revision: start.revision
  })
  const project = await bank.share(
    a,
    'persona',
    first.document.id,
    'project',
    (await bank.catalog(a, 'project')).revision,
    1
  )
  const global = await bank.share(
    a,
    'project',
    project.document.id,
    'global',
    (await bank.catalog(a, 'global')).revision,
    1
  )
  const revised = await bank.write(a, 'persona', {
    key: '发布条件',
    body: 'NEW_CORRECT_820',
    revision: first.revision
  })
  assert.equal(revised.document.id, first.document.id)
  assert.equal(revised.document.revision, 2)
  await assert.rejects(
    bank.write(a, 'persona', { key: '发布条件', body: 'late old result', revision: first.revision }),
    /已经变化/
  )
  assert.equal((await bank.search(a, 'persona', 'OLD_WRONG_791')).results.length, 0)
  assert.equal((await bank.search(a, 'project', 'OLD_WRONG_791')).results.length, 0)
  const stale = await bank.read(a, 'global', global.document.id)
  assert.equal(stale.document.current, false)
  assert.equal(stale.document.body, undefined)
  assert.match((await bank.read(a, 'global', global.document.id, true)).document.body, /OLD_WRONG/)
  await assert.rejects(
    bank.share(
      a,
      'project',
      project.document.id,
      'persona-project',
      (await bank.catalog(a, 'persona-project')).revision,
      1
    ),
    /不能继续分享/
  )
})
test('archive removes current knowledge while historical access stays explicit', async (t) => {
  const { bank, a } = fixture(t),
    before = await bank.catalog(a, 'project')
  const made = await bank.write(a, 'project', {
    key: '验收口径',
    body: 'ARCHIVE_CANARY_37',
    revision: before.revision
  })
  await bank.archive(a, 'project', made.document.id, made.revision, 1)
  assert.equal((await bank.search(a, 'project', 'ARCHIVE_CANARY_37')).results.length, 0)
  assert.equal((await bank.read(a, 'project', made.document.id)).document.body, undefined)
  assert.match((await bank.read(a, 'project', made.document.id, true)).document.body, /ARCHIVE_CANARY/)
})
test('public Mnemon compiler composes PX source and enforces readonly routes with bounded exact reads', async (t) => {
  const { bank, a } = fixture(t),
    runtime = new MemoryCompositionRunner({ strategyTypeId: 'general' })
  let contract = ''
  t.after(() => runtime.dispose())
  await runtime.mount(
    {
      name: 'px-knowledge-test',
      inject: ['mnemonMemory'],
      apply(ctx: any) {
        ctx.effect(() =>
          ctx.mnemonMemory.installContributions(
            {
              sources: [
                pxKnowledgeSource(
                  bank,
                  () => true,
                  async () => {},
                  (_caller, key) => {
                    contract = knowledgeContractText(key)
                  }
                )
              ],
              strategies: [GENERAL_VIEW_STRATEGY]
            },
            { instanceId: 'px-knowledge-test' }
          )
        )
      }
    },
    { instanceId: 'px-knowledge-test' }
  )
  const initial = await bank.catalog(a, 'persona')
  const saved = await bank.write(a, 'persona', {
    key: '长来源',
    body: '起点' + '正文'.repeat(9000) + '终点',
    revision: initial.revision
  })
  const turn = await runtime.beginTurn({
    scope: { storage: 'workspace', workspaceId: a.project, sessionId: a.sessionId }
  })
  t.after(() => turn.release())
  assert.equal(turn.view.routes.length, 3)
  assert.equal(turn.view.actionOffers.length, 3)
  for (const item of [...turn.view.routes, ...turn.view.actionOffers]) assert.ok(contract.includes(item.id))
  const route = turn.view.routes.find((r) => r.sourceRouteId === 'read')!.id
  const first = await turn.executeRoute(route, { scope: 'persona', id: saved.document.id })
  assert.equal(first.truncated, true)
  assert.equal(first.items[1].text.length, 12000)
  const next = await turn.executeRoute(route, {
    scope: 'persona',
    id: saved.document.id,
    offset: 12000
  })
  assert.match(next.items[1].text, /终点$/)
  await assert.rejects(
    turn.executeRoute(route, {
      action: 'write',
      scope: 'persona',
      key: 'bad',
      body: 'bad',
      revision: saved.revision
    }),
    /只读|query|Route|unsupported|unknown|property/i
  )
  const catalogRoute = turn.view.routes.find((r) => r.sourceRouteId === 'catalog')!.id
  const empty = await turn.executeRoute(catalogRoute, { scope: 'project' }),
    control = JSON.parse(empty.items[0].text)
  assert.equal(control.kind, 'CONTROL')
  assert.equal(control.matches, 0)
  assert.equal(typeof control.revision, 'string')
  const created = await turn.executeAction(
    turn.view.actionOffers.find((a) => a.sourceActionId === 'write')!.id,
    { scope: 'project', key: 'control-write', body: 'current-control-value', revision: control.revision },
    () => true
  )
  assert.equal(created.completion, 'committed')
  const request = { scope: { storage: 'workspace' as const, workspaceId: a.project, sessionId: a.sessionId } }
  const second = await runtime.beginTurn(request)
  t.after(() => second.release())
  await second.executeRoute(second.view.routes.find((r) => r.sourceRouteId === 'search')!.id, {
    scope: 'visible',
    query: 'current-control-value'
  })
  const third = await runtime.beginTurn(request)
  t.after(() => third.release())
  assert.deepEqual(
    second.view.consistency.sourceRevisions,
    third.view.consistency.sourceRevisions,
    'read access time must not change prompt content identity'
  )
})
test('file freshness references suppress obsolete knowledge until it is explicitly revalidated', async (t) => {
  const f = fixture(t),
    versions = new Map([['source.ts', 'version-1']])
  const bank = new KnowledgeBank(join(f.root, 'file-sources'), f.identities, async (_caller, path) =>
    versions.has(path)
      ? { path, version: versions.get(path)!, observedAt: new Date().toISOString() }
      : undefined
  )
  t.after(() => bank.dispose())
  const start = await bank.catalog(f.a, 'project'),
    saved = await bank.write(f.a, 'project', {
      key: '文件结论',
      body: 'FILE_CANARY_527',
      revision: start.revision,
      sourcePaths: ['source.ts']
    })
  assert.equal(saved.document.current, true)
  versions.set('source.ts', 'version-2')
  assert.equal((await bank.search(f.a, 'project', 'FILE_CANARY_527')).results.length, 0)
  assert.equal(
    (await bank.read(f.a, 'project', saved.document.id)).document.sourceState,
    'file-source-changed'
  )
  const updated = await bank.write(f.a, 'project', {
    key: '文件结论',
    body: 'FILE_CORRECTED_528',
    revision: (await bank.catalog(f.a, 'project')).revision,
    sourcePaths: ['source.ts']
  })
  assert.equal(updated.document.current, true)
  versions.delete('source.ts')
  assert.equal((await bank.read(f.a, 'project', saved.document.id)).document.current, false)
})
