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
import { spawnSync } from 'node:child_process'

function startup(directory: string, emulateElectronAlias = false) {
  const script = readFileSync('scripts/prepare-native-desktop.mjs', 'utf8')
  const template = script.match(/const bootstrap = `([\s\S]*?)`\n/)
  assert.ok(template)
  const boundary = template[1].lastIndexOf('\nimport(')
  assert.ok(boundary > 0, 'bootstrap application import boundary must remain explicit')
  const paths: Record<string, string> = {},
    env: Record<string, string> = { DSH_PX_USER_DATA_DIR: directory }
  const require = createRequire(import.meta.url)
  runInNewContext(template[1].slice(0, boundary), {
    require: (name: string) => {
      if (name === 'electron')
        return {
          app: {
            setName: () => {},
            on: () => {},
            setPath: (key: string, value: string) => {
              paths[key] = value
            }
          },
          dialog: {}
        }
      // Packaged Electron's ordinary sync wrapper preserves a Windows 8.3 alias.
      // Its native function and async realpath correctly expand the same physical directory.
      if (name === 'node:fs' && emulateElectronAlias)
        return {
          ...require(name),
          realpathSync: Object.assign((path: string) => path, { native: realpathSync.native })
        }
      return require(name)
    },
    process: { env }
  })
  return { paths, env }
}
function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'px-profile-path-'))
  t.after(() => {
    assert.ok(realpathSync.native(root).startsWith(realpathSync.native(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  return root
}
test('Desktop bootstrap canonicalizes an aliased data directory before deriving its profile', (t) => {
  const root = fixture(t),
    physical = join(root, 'physical'),
    alias = join(root, 'alias')
  mkdirSync(physical)
  writeFileSync(join(physical, 'preserved.txt'), 'existing data')
  symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const { paths, env } = startup(alias)
  assert.equal(paths.userData, realpathSync.native(physical))
  assert.equal(env.DSH_HOME, join(realpathSync.native(physical), 'dsh-home'))
  assert.equal(env.DSH_PX_DOCUMENTS_DIRECTORY, join(realpathSync.native(physical), 'documents'))
  assert.equal(readFileSync(join(physical, 'preserved.txt'), 'utf8'), 'existing data')
})
test(
  'Windows 8.3 short names expand even when Electron ordinary realpath preserves the alias',
  { skip: process.platform !== 'win32' },
  (t) => {
    const root = fixture(t)
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:PX_TEST_DIRECTORY).ShortPath'
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, PX_TEST_DIRECTORY: root },
        timeout: 15000
      }
    )
    assert.equal(result.status, 0, result.stderr)
    const short = result.stdout.trim(),
      full = realpathSync.native(root)
    assert.ok(short)
    if (short.toLowerCase() === full.toLowerCase()) {
      t.skip('This filesystem does not provide 8.3 aliases')
      return
    }
    assert.equal(realpathSync.native(short), full)
    const { paths, env } = startup(short, true)
    assert.equal(paths.userData, full)
    assert.equal(env.DSH_HOME, join(full, 'dsh-home'))
  }
)
