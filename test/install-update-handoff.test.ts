import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installerLogPath, parseInstallerLog, previousInstallFailure } from '../src/main/installer-log'
import { assertInstallRegistration } from '../src/main/install-registration'

const { nsisAppGuid } = await import(pathToFileURL(resolve('scripts/nsis-guid.mjs')).href)
const { prepareInstallerRecovery } = await import(
  pathToFileURL(resolve('scripts/installer-recovery.mjs')).href
)

test('the NSIS registry GUID matches the key electron-builder writes for DSH-PX Desktop', () => {
  assert.equal(nsisAppGuid('com.palbudir.dshpx.desktop'), '77968efd-2ef8-565e-9082-8a54e960920f')
  assert.match(
    nsisAppGuid('com.example.app'),
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  )
})

test('installer traces report the last run, including legacy error codes and recovery relaunches', () => {
  assert.deepEqual(parseInstallerLog(''), { state: 'none' })
  const legacyFailure =
    'pid=1 stage=init error=80\r\npid=1 stage=wait-for-exit error=80\r\npid=1 stage=failed error=80\r\n'
  assert.deepEqual(parseInstallerLog(legacyFailure), { state: 'failed', pid: '1', reason: '' })
  const thenInstalled = legacyFailure + 'pid=2 stage=init reason=\npid=2 stage=installed reason=\n'
  assert.deepEqual(parseInstallerLog(thenInstalled), { state: 'installed', pid: '2' })
  assert.deepEqual(
    parseInstallerLog(
      'pid=3 stage=failed reason=请选择空文件夹\npid=3 stage=relaunch-available reason=请选择空文件夹\n'
    ),
    {
      state: 'failed',
      pid: '3',
      reason: '请选择空文件夹'
    }
  )
  // An interactive run that was closed early is not reported as a failed update.
  assert.equal(
    parseInstallerLog('pid=4 stage=init reason=\npid=4 stage=wait-for-exit reason=\n').state,
    'incomplete'
  )
})

test('the update window names a failed earlier installation of the offered version only', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-installer-log-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.equal(previousInstallFailure(root, '0.4.1-alpha.1'), undefined)
  mkdirSync(join(root, 'dsh-px-desktop-updater', 'installer-logs'), { recursive: true })
  writeFileSync(
    installerLogPath(root, '0.4.1-alpha.1'),
    'pid=9 stage=init reason=\npid=9 stage=failed reason=空间不足\n'
  )
  assert.match(previousInstallFailure(root, '0.4.1-alpha.1') ?? '', /0\.4\.1-alpha\.1 未完成：空间不足/)
  assert.equal(previousInstallFailure(root, '0.4.2-alpha.1'), undefined)
  assert.equal(previousInstallFailure(root, '../escape'), undefined)
  assert.equal(previousInstallFailure(undefined, '0.4.1-alpha.1'), undefined)
})

test('Desktop installation is refused before quitting when the install registration is missing or elsewhere', async () => {
  const key = 'Software\\77968efd-2ef8-565e-9082-8a54e960920f'
  const exe = 'D:\\Apps\\Programs\\DSH-PX Desktop\\DSH-PX Desktop.exe'
  const reads: string[] = []
  const registry = (value: string | undefined) => async (k: string, name: string) => {
    reads.push(`${k}:${name}`)
    return value
  }
  await assertInstallRegistration(key, exe, registry('D:\\Apps\\Programs\\DSH-PX Desktop\\'), 'win32')
  await assertInstallRegistration(key, exe, registry('d:\\APPS\\programs\\dsh-px desktop'), 'win32')
  assert.deepEqual(reads[0], `${key}:InstallLocation`)
  await assert.rejects(
    assertInstallRegistration(key, exe, registry(undefined), 'win32'),
    /缺少 Windows 安装登记.*客户端保持运行.*reg add/
  )
  await assert.rejects(
    assertInstallRegistration(key, exe, registry('D:\\Other'), 'win32'),
    /另一个目录（D:\\Other）/
  )
  // Other platforms have no NSIS registration to check.
  await assertInstallRegistration(key, exe, registry(undefined), 'linux')
})

test('installer recovery always explains a silent failure and records why the app was still running', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-installer-recovery-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const app = join(root, 'app'),
    output = join(root, 'out')
  mkdirSync(join(app, 'scripts'), { recursive: true })
  mkdirSync(join(app, 'installer'), { recursive: true })
  writeFileSync(
    join(app, 'scripts/installer.nsh'),
    [
      '!macro customHeader',
      '    Function InstallerCheckAppRunning',
      '      !insertmacro customCheckAppRunning',
      '    FunctionEnd',
      '!macroend',
      '!macro customInit',
      '  ${If} $InstallerError != ""',
      '    SetErrorLevel 2',
      '    Quit',
      '  ${EndIf}',
      '!macroend',
      '!macro customCheckAppRunning',
      '        ${If} $R1 >= 40',
      '          ${ExitDo}',
      '        ${EndIf}',
      '    ${If} $R0 == 0',
      '      MessageBox MB_OK|MB_ICONINFORMATION "$(INSTALLER_RUNNING)" /SD IDOK',
      '      SetErrorLevel 2',
      '      Quit',
      '    ${EndIf}',
      '!macroend',
      ''
    ].join('\n')
  )
  writeFileSync(
    join(app, 'scripts/installer-directories.nsh'),
    '!macro dshStageApplication\n!macroend\nFunction dshPromoteDirectories\nFunctionEnd\n!macro dshFinishDirectories\n!macroend\n'
  )
  writeFileSync(
    join(app, 'installer/lifecycle.nsh'),
    'Function .onInstFailed\n  SetErrorLevel 2\n  Quit\nFunctionEnd\n'
  )
  prepareInstallerRecovery(app, output)
  const main = readFileSync(join(output, 'scripts/installer.nsh'), 'utf8')
  assert.match(main, /\$\{If\} \$R1 >= 240/)
  assert.match(
    main,
    /!ifndef BUILD_UNINSTALLER\n\s+StrCpy \$InstallerError "\$\(INSTALLER_RUNNING\)"\n\s+!endif\n\s+MessageBox/
  )
  assert.equal(main.match(/!insertmacro PxInstallerFail/g)?.length, 2)
  const recovery = readFileSync(join(output, 'scripts/px-recovery.nsh'), 'utf8')
  assert.match(recovery, /stage=\$\{Stage\} reason=\$InstallerError/)
  assert.doesNotMatch(recovery, /GetLastError/)
  // The silent notice follows the relaunch branch instead of living inside it.
  const relaunchEnd = recovery.indexOf('!insertmacro PxInstallerTrace "relaunch-available"')
  const notice = recovery.indexOf('${If} ${Silent}')
  assert.ok(relaunchEnd > 0 && notice > relaunchEnd)
  const between = recovery.slice(relaunchEnd, notice)
  assert.equal(between.match(/\$\{EndIf\}/g)?.length, 2, 'both relaunch conditions close before the notice')
  // Unattended acceptance runs suppress only the dialog, never the trace or the exit code.
  const quiet = recovery.slice(notice)
  assert.match(
    quiet,
    /\$\{GetOptions\} \$R0 "--px-quiet-failure" \$R1\s+\$\{If\} \$\{Errors\}\s+System::Call 'user32::MessageBoxW/
  )
})

test('installer acceptance refuses to run outside a CI runner', () => {
  const script = readFileSync('scripts/installer-acceptance.ps1', 'utf8')
  assert.match(script, /if \(\$env:CI -ne 'true' -or -not \$env:RUNNER_TEMP\) \{\s+throw/)
  assert.match(script, /--px-quiet-failure/)
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const inspect = workflow.indexOf('- name: Inspect and hash the installer')
  const acceptance = workflow.indexOf('- name: Installer acceptance from the published Desktop')
  const upload = workflow.indexOf('- name: Upload inspected release assets', inspect)
  assert.ok(inspect > 0 && acceptance > inspect && upload > acceptance, 'acceptance gates the Desktop upload')
})
