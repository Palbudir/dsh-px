import { execFile } from 'node:child_process'
import { win32 } from 'node:path'

/** Reads one HKCU value; resolves undefined when the key or value is absent. */
export type RegistryReader = (key: string, value: string) => Promise<string | undefined>

/** Query HKCU through reg.exe; no shell, bounded output, absent keys are not errors. */
export const readUserRegistry: RegistryReader = (key, value) =>
  new Promise((done) => {
    execFile(
      'reg.exe',
      ['query', `HKCU\\${key}`, '/v', value],
      { windowsHide: true, timeout: 10000, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) return done(undefined)
        const line = String(stdout)
          .split(/\r?\n/)
          .find((row) => row.trim().startsWith(value + ' '))
        const match = line ? /\sREG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line) : null
        done(match ? match[1]!.trim() : undefined)
      }
    )
  })

const normalize = (path: string): string =>
  win32
    .resolve(path)
    .replace(/[\\/]+$/, '')
    .toLowerCase()

/**
 * The silent installer only replaces a directory the current user's registry records as this application's
 * install location; otherwise its preflight refuses the non-empty folder and exits without notice.
 * Check that precondition before quitting so the user gets an actionable message instead of a vanished app.
 * @param registryKey - `Software\<electron-builder APP_GUID>` of this build.
 * @param executable - Path of the running application executable.
 * @throws Error with a user-facing explanation when the update would fail.
 */
export async function assertInstallRegistration(
  registryKey: string,
  executable: string,
  read: RegistryReader = readUserRegistry,
  platform = process.platform
): Promise<void> {
  if (platform !== 'win32') return
  // Registration paths are Windows paths on every host that runs these checks, including CI.
  const directory = win32.dirname(executable)
  const registered = await read(registryKey, 'InstallLocation')
  if (registered !== undefined && normalize(registered) === normalize(directory)) return
  const detail =
    registered === undefined ? '当前客户端缺少 Windows 安装登记' : `安装登记指向另一个目录（${registered}）`
  throw new Error(
    `${detail}，自动更新无法替换正在使用的客户端，已取消本次安装，客户端保持运行。` +
      `请在命令行执行：reg add "HKCU\\${registryKey}" /v InstallLocation /t REG_SZ /d "${directory}" /f ，然后重新安装更新。`
  )
}
