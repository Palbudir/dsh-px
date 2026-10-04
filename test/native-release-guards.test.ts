import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { build } from 'esbuild'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const brand = await import(pathToFileURL(resolve('scripts/brand-native-installer.mjs')).href)

function temp(t: any, label: string) {
  const parent = realpathSync(tmpdir()),
    root = realpathSync(mkdtempSync(join(parent, `dshpx-${label}-`)))
  t.after(() => {
    assert.ok(root.startsWith(parent + sep))
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })

test('a non-candidate Pack build is refused on a dirty checkout or without the exact HEAD', async (t) => {
  const root = temp(t, 'native-pack-guard')
  const repo = join(root, 'repo')
  mkdirSync(join(repo, 'config'), { recursive: true })
  writeFileSync(join(repo, 'config', 'native-pack.json'), readFileSync('config/native-pack.json'))
  const entry = join(root, 'build-native-pack.mjs')
  await build({
    entryPoints: [resolve('scripts/build-native-pack.ts')],
    outfile: entry,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    logLevel: 'silent'
  })
  const identity = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid']
  assert.equal(git(repo, 'init', '--quiet').status, 0)
  git(repo, 'add', '-A')
  assert.equal(git(repo, ...identity, 'commit', '--quiet', '-m', 'fixture').status, 0)
  const head = git(repo, 'rev-parse', 'HEAD').stdout.trim()
  const run = (output: string, ...args: string[]) =>
    spawnSync(process.execPath, [entry, output, ...args], {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, DSH_PX_REPO: repo, NODE_OPTIONS: '' },
      timeout: 60000
    })
  for (const args of [[], ['--expect-head=abc'], [`--expect-head=${'f'.repeat(40)}`]]) {
    const output = join(root, 'out-head')
    const result = run(output, ...args)
    assert.notEqual(result.status, 0, args.join(' '))
    assert.match(result.stderr, /--expect-head/)
    assert.equal(existsSync(output), false, 'refusal happens before any output or download')
  }
  writeFileSync(join(repo, 'untracked.txt'), 'dirty')
  const dirty = run(join(root, 'out-dirty'), `--expect-head=${head}`)
  assert.notEqual(dirty.status, 0)
  assert.match(dirty.stderr, /clean checkout/)
  assert.equal(existsSync(join(root, 'out-dirty')), false)
})
test('installer strings are fully rebranded without changing the string table shape', () => {
  const official = [
    '; NSIS owns installer localization independently of the Electron application locale.',
    'LangString INSTALLER_INSTALL ${LANG_ENGLISH} "Install now"',
    'LangString INSTALLER_RUNNING ${LANG_ENGLISH} "DeepSeek Harness is running. Quit it from the system tray and try again."',
    'LangString INSTALLER_RUNNING ${LANG_SIMPCHINESE} "DeepSeek Harness 正在运行，请先在系统托盘中退出应用后重试。"',
    ''
  ].join('\n')
  const branded = brand.brandInstallerStrings(official)
  assert.doesNotMatch(branded, /DeepSeek|Harness/)
  assert.equal((branded.match(/^LangString/gm) ?? []).length, 3)
  assert.match(branded, /DSH-PX Desktop is running/)
  assert.throws(() => brand.brandInstallerStrings('LangString A ${LANG_ENGLISH} "x"\n'), /anchors/)
})

test('the NSIS wrapper predefines both /ifndef symbols before including the unchanged official script', () => {
  const text = brand.installerWrapper({
    stringsFile: 'C:/build/px/installer/strings.nsh',
    buildDirectory: 'C:/build/px/installer/ui',
    officialInstaller: 'C:/build/upstream/apps/desktop/scripts/installer.nsh'
  })
  const lines = text
    .trim()
    .split('\n')
    .filter((line: string) => !line.startsWith(';'))
  assert.equal(lines.length, 3)
  assert.match(lines[0], /^!define INSTALLER_STRINGS_FILE ".*strings\.nsh"$/)
  assert.match(lines[1], /^!define INSTALLER_BUILD_DIR ".*ui"$/)
  assert.match(lines[2], /^!include ".*installer\.nsh"$/)
  assert.throws(() =>
    brand.installerWrapper({ stringsFile: 'C:/a"b', buildDirectory: 'C:/x', officialInstaller: 'C:/y' })
  )
})

test('uninstall keeps %USERPROFILE%\\.dsh-px data and offers no deletion choice', () => {
  const bootstrap =
    "process.env.DSH_HOME=override?join(userData,'dsh-home'):join(require('node:os').homedir(),'.dsh-px');"
  const uninstall =
    'StrCpy $UnTarget "$APPDATA\\${PRODUCT_FILENAME}"\nStrCpy $UnTarget "$APPDATA\\${APP_PACKAGE_NAME}"\n'
  brand.assertDataPreserved({ bootstrap, uninstall })
  assert.throws(
    () => brand.assertDataPreserved({ bootstrap: bootstrap.replace(".dsh-px'", "dsh-home'"), uninstall }),
    /\.dsh-px/
  )
  assert.throws(
    () =>
      brand.assertDataPreserved({
        bootstrap,
        uninstall: uninstall + 'StrCpy $UnTarget "$PROFILE\\.dsh-px"\n'
      }),
    /data preservation/
  )
  assert.throws(
    () =>
      brand.assertDataPreserved({
        bootstrap,
        uninstall: uninstall + 'MessageBox MB_YESNO "Delete all data?"\n'
      }),
    /deletion choice/
  )
})

test('the branded builder keeps the official helper preparation and refuses directory probes', () => {
  const source = brand.brandedBuilderModule({
    builder: 'builder.mjs',
    officialUi: 'C:/o',
    pxUi: 'C:/p',
    wrapper: 'C:/p/installer.nsh'
  })
  assert.match(source, /const official=config\.beforeBuild/)
  assert.match(source, /await official\(context\)/)
  assert.match(source, /window-frame\.dll/)
  assert.match(source, /differentialPackage:true/)
  assert.match(source, /DSH_PX_DIRECTORY_PROBE/)
  for (const name of brand.BRAND_BITMAPS) assert.ok(source.includes(name))
})

test(
  'installer bitmaps use the official sizes and are 24-bit BMPs',
  { skip: process.platform !== 'win32' },
  (t) => {
    const root = temp(t, 'installer-bitmaps')
    // A 1x1 PNG is enough to exercise the real image script.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    writeFileSync(join(root, 'icon.png'), png)
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolve('scripts/brand-installer-images.ps1'),
        '-Icon',
        join(root, 'icon.png'),
        '-OutputDirectory',
        join(root, 'ui')
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 60000 }
    )
    assert.equal(result.status, 0, result.stderr)
    const sizes: Record<string, [number, number]> = {
      brand: [600, 196],
      'brand-2x': [1200, 392],
      'brand-dark': [600, 196],
      'brand-dark-2x': [1200, 392],
      'uninstaller-sidebar': [164, 314]
    }
    for (const name of brand.BRAND_BITMAPS) {
      const bytes = readFileSync(join(root, 'ui', `${name}.bmp`))
      assert.equal(bytes.toString('latin1', 0, 2), 'BM', name)
      assert.deepEqual([bytes.readInt32LE(18), Math.abs(bytes.readInt32LE(22))], sizes[name], name)
      assert.equal(bytes.readUInt16LE(28), 24, name)
      assert.ok(statSync(join(root, 'ui', `${name}.bmp`)).size > 1000)
    }
  }
)
