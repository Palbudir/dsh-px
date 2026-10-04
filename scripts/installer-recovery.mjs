import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const recovery = readFileSync(new URL('./installer-recovery.nsh', import.meta.url), 'utf8')

/** Patch private copies of the pinned scripts, retaining native extraction and directory rollback. */
export function prepareInstallerRecovery(app, output) {
  mkdirSync(join(output, 'scripts'), { recursive: true })
  cpSync(join(app, 'installer'), join(output, 'installer'), {
    recursive: true,
    filter: (p) => !p.endsWith('.cpp') && !p.endsWith('.h') && !p.includes('assets')
  })
  let main = readFileSync(join(app, 'scripts/installer.nsh'), 'utf8').replaceAll('\r\n', '\n')
  if (main.split('${If} $R1 >= 40').length !== 2) throw Error('Installer process-wait anchor changed')
  main = '!include "${__FILEDIR__}\\px-recovery.nsh"\n' + main
  main = main
    .replace('${If} $R1 >= 40', '${If} $R1 >= 240')
    .replace('!macro customInit\n', '!macro customInit\n  !insertmacro PxInstallerTrace "init"\n')
    .replace(
      '    Function InstallerCheckAppRunning',
      '    !insertmacro PxInstallerRecoveryFunctions\n    Function InstallerCheckAppRunning'
    )
    .replace(
      '!macro customCheckAppRunning\n',
      '!macro customCheckAppRunning\n  !insertmacro PxInstallerTrace "wait-for-exit"\n'
    )
  for (const [relative, initial] of [
    ['scripts/installer.nsh', main],
    [
      'scripts/installer-directories.nsh',
      readFileSync(join(app, 'scripts/installer-directories.nsh'), 'utf8')
    ],
    ['installer/lifecycle.nsh', readFileSync(join(app, 'installer/lifecycle.nsh'), 'utf8')]
  ]) {
    let text = initial
      .replaceAll('\r\n', '\n')
      .replace(/SetErrorLevel 2\n\s*Quit/g, '!insertmacro PxInstallerFail')
    if (relative.endsWith('installer-directories.nsh'))
      text = text
        .replace(/Call dshRollbackDirectories(\n\s+SetErrors\n\s+Return)/g, 'Call PxRecoverInstallFailure$1')
        .replace(
          '!macro dshStageApplication\n',
          '!macro dshStageApplication\n  !insertmacro PxInstallerTrace "extract"\n'
        )
        .replace(
          'Function dshPromoteDirectories\n',
          'Function dshPromoteDirectories\n  !insertmacro PxInstallerTrace "promote"\n'
        )
        .replace(
          '!macro dshFinishDirectories\n',
          '!macro dshFinishDirectories\n  !insertmacro PxInstallerTrace "installed"\n'
        )
    writeFileSync(join(output, relative), text)
  }
  writeFileSync(join(output, 'scripts/px-recovery.nsh'), recovery)
  return join(output, 'scripts/installer.nsh')
}
