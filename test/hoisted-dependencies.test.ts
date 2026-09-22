import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { copyHoistedDependencies } from '../scripts/copy-hoisted-dependencies'

test('装配保留包内版本与 CLI，缺失的提升依赖完整复制，不混合两个版本', t => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-hoisted-'))
  const cleanup = realpathSync(root)
  assert.ok(cleanup.startsWith(realpathSync(tmpdir()) + sep) && basename(cleanup).startsWith('dshpx-hoisted-'))
  t.after(() => rmSync(cleanup, { recursive: true, force: true }))
  const source = join(root, 'source'), destination = join(root, 'destination'), cli = join(root, 'cli-directory')
  for (const base of [source, destination]) for (const rel of ['.bin', '@scope/pkg']) mkdirSync(join(base, rel), { recursive: true })
  mkdirSync(cli); writeFileSync(join(cli, 'index.js'), 'hoisted-cli')
  symlinkSync(cli, join(source, '.bin/cordis'), process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(join(destination, '.bin/cordis'), 'bundled-cli')
  writeFileSync(join(source, '.bin/new-tool'), 'new-cli')
  writeFileSync(join(source, '@scope/pkg/index.js'), 'hoisted-v2')
  writeFileSync(join(source, '@scope/pkg/v2-only.js'), 'must-not-mix')
  writeFileSync(join(destination, '@scope/pkg/index.js'), 'bundled-v1')
  mkdirSync(join(source, '@scope/new')); writeFileSync(join(source, '@scope/new/index.js'), 'new-scoped')
  mkdirSync(join(source, 'unscoped')); writeFileSync(join(source, 'unscoped/index.js'), 'new-unscoped')
  copyHoistedDependencies(source, destination)
  copyHoistedDependencies(source, destination)
  assert.equal(readFileSync(join(destination, '.bin/cordis'), 'utf8'), 'bundled-cli')
  assert.ok(lstatSync(join(destination, '.bin/cordis')).isFile())
  assert.equal(readFileSync(join(destination, '@scope/pkg/index.js'), 'utf8'), 'bundled-v1')
  assert.equal(existsSync(join(destination, '@scope/pkg/v2-only.js')), false)
  assert.equal(readFileSync(join(destination, '@scope/new/index.js'), 'utf8'), 'new-scoped')
  assert.equal(readFileSync(join(destination, 'unscoped/index.js'), 'utf8'), 'new-unscoped')
  assert.equal(readFileSync(join(destination, '.bin/new-tool'), 'utf8'), 'new-cli')
})
