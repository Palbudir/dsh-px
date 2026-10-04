import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

test('Desktop bootstrap canonicalizes an aliased data directory before deriving its profile', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'px-profile-path-')),
    physical = join(root, 'physical'),
    alias = join(root, 'alias')
  t.after(() => {
    assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  mkdirSync(physical)
  writeFileSync(join(physical, 'preserved.txt'), 'existing data')
  symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const script = readFileSync('scripts/prepare-native-desktop.mjs', 'utf8')
  const template = script.match(/const bootstrap = `([\s\S]*?)`\n/)
  assert.ok(template)
  // Execute the actual startup prefix; loading the application module is the next, separate phase.
  const startup = template[1].slice(0, template[1].lastIndexOf('\nimport('))
  const paths: Record<string, string> = {},
    env: Record<string, string> = { DSH_PX_USER_DATA_DIR: alias }
  const require = createRequire(import.meta.url)
  runInNewContext(startup, {
    require: (name: string) =>
      name === 'electron'
        ? {
            app: {
              setName: () => {},
              on: () => {},
              setPath: (key: string, value: string) => {
                paths[key] = value
              }
            },
            dialog: {}
          }
        : require(name),
    process: { env }
  })
  assert.equal(paths.userData, realpathSync(physical))
  assert.equal(env.DSH_HOME, join(realpathSync(physical), 'dsh-home'))
  assert.equal(env.DSH_PX_DOCUMENTS_DIRECTORY, join(realpathSync(physical), 'documents'))
  assert.equal(readFileSync(join(physical, 'preserved.txt'), 'utf8'), 'existing data')
})
