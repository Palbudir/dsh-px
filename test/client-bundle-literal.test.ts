import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

test('the shipped native client wrapper preserves multiline user-facing strings exactly', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-client-literal-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'lib'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'px-literal-fixture',
      version: '0.0.1',
      exports: { './client': './lib/client.js' }
    })
  )
  writeFileSync(
    join(root, 'src/client.tsx'),
    'export const inject=[];export function apply(){return `引用：\n> 原句\n\n我的批注：说明`}'
  )
  execFileSync(process.execPath, [resolve('scripts/plugins/build-client.mjs'), root], {
    windowsHide: true,
    stdio: 'pipe'
  })
  let exported: any
  runInNewContext(readFileSync(join(root, 'lib/client.js'), 'utf8'), {
    window: {
      __ModuleLoader__: {
        load: (module: any) => {
          exported = module.factory(() => {
            throw Error('Unexpected import')
          })
        }
      }
    }
  })
  assert.equal(exported.apply(), '引用：\n> 原句\n\n我的批注：说明')
})
