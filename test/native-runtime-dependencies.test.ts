import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  applyRuntimeDependencyOverrides,
  verifyPackagedDependencyOverrides,
  ZOD_SOURCE
} from '../scripts/native-runtime-dependencies.mjs'

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'px-runtime-deps-'))
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  const source = join(root, ZOD_SOURCE),
    target = join(root, 'node_modules/zod')
  mkdirSync(source, { recursive: true })
  mkdirSync(target, { recursive: true })
  const files = [
    ['package.json', JSON.stringify({ name: 'zod', version: '4.6.7' })],
    ['index.js', 'export const fixed = true;']
  ]
  const inventory: any = {
    schemaVersion: 1,
    files: files.map(([name, content]) => {
      writeFileSync(join(source, name), content)
      return {
        path: ZOD_SOURCE + '/' + name,
        bytes: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
        executable: false
      }
    })
  }
  writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'zod', version: '4.4.3' }))
  writeFileSync(join(target, 'obsolete.js'), 'old only')
  inventory.files.push({ path: 'node_modules/zod/obsolete.js', bytes: 8, sha256: 'old' })
  return { root, source, target, inventory }
}

test('private runtime dependency override verifies source, replaces obsolete files and updates cache identity deterministically', (t) => {
  const f = fixture(t),
    before = JSON.stringify(f.inventory)
  assert.equal(applyRuntimeDependencyOverrides(f.root, f.inventory).version, '4.6.7')
  assert.equal(JSON.parse(readFileSync(join(f.target, 'package.json'), 'utf8')).version, '4.6.7')
  assert.ok(!f.inventory.files.some((entry: any) => entry.path.endsWith('obsolete.js')))
  assert.notEqual(JSON.stringify(f.inventory), before)
  const first = JSON.stringify(f.inventory)
  applyRuntimeDependencyOverrides(f.root, f.inventory)
  assert.equal(JSON.stringify(f.inventory), first)
})

test('altered fixed source is rejected before touching the original dependency', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.source, 'index.js'), 'altered')
  assert.throws(() => applyRuntimeDependencyOverrides(f.root, f.inventory), /differs/)
  assert.equal(JSON.parse(readFileSync(join(f.target, 'package.json'), 'utf8')).version, '4.4.3')
})

test('a dependency redirect cannot cause writes to another directory', (t) => {
  const f = fixture(t),
    other = join(f.root, 'other')
  mkdirSync(other)
  writeFileSync(join(other, 'keep'), 'preserved')
  assert.ok(resolve(f.target).startsWith(resolve(f.root) + sep))
  rmSync(f.target, { recursive: true })
  symlinkSync(other, f.target, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => applyRuntimeDependencyOverrides(f.root, f.inventory), /redirect/)
  assert.equal(readFileSync(join(other, 'keep'), 'utf8'), 'preserved')
})

test('release verification rejects old shell bytes, missing host records and leftover files', (t) => {
  const f = fixture(t)
  applyRuntimeDependencyOverrides(f.root, f.inventory)
  const files = new Map<string, Buffer>()
  for (const entry of f.inventory.files.filter((e: any) => e.path.startsWith(ZOD_SOURCE + '/'))) {
    const name = entry.path.slice(ZOD_SOURCE.length + 1)
    for (const prefix of ['node_modules/zod/', 'dsh/node_modules/zod/'])
      files.set(prefix + name, readFileSync(join(f.source, name)))
  }
  const notePath = 'dsh/px-dependency-overrides.json'
  files.set(notePath, readFileSync(join(f.root, 'px-dependency-overrides.json')))
  const verify = () =>
    verifyPackagedDependencyOverrides([...files.keys()], (p: string) => files.get(p)!, f.inventory)
  verify()
  const original = files.get('node_modules/zod/index.js')!
  files.set('node_modules/zod/index.js', Buffer.from('old'))
  assert.throws(verify, /bytes differ/)
  files.set('node_modules/zod/index.js', original)
  files.set('dsh/node_modules/zod/obsolete.js', Buffer.from('old'))
  assert.throws(verify, /file list/)
  files.delete('dsh/node_modules/zod/obsolete.js')
  files.set(notePath, Buffer.from('{}'))
  assert.throws(verify, /record is missing/)
})
